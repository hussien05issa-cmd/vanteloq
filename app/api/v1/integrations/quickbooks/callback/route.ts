import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { integrationConnections, integrationOAuthStates, memberships, users, workspaces } from "../../../../../../db/schema";
import { recordAudit } from "../../../../../../server/audit";
import type { AccessContext } from "../../../../../../server/authorization";
import { ApiError, handleApi } from "../../../../../../server/api";
import { requireFeature } from "../../../../../../server/entitlements/engine";
import {
  exchangeQuickBooksAuthorizationCode,
  quickBooksReadiness,
  quickBooksStateHash,
  revokeQuickBooksAuthorization,
  saveQuickBooksTokens,
  verifyQuickBooksCompany,
  QUICKBOOKS_PROVIDER,
} from "../../../../../../server/integrations/quickbooks";
import { requirePermission } from "../../../../../../server/permissions";

function returnUrl(request: Request, status: "connected" | "declined" | "failed") {
  return new URL(`/?integration=quickbooks&connection=${status}`, new URL(request.url).origin).toString();
}

async function callbackActor(organizationId: string, actorUserId: string): Promise<AccessContext> {
  const [actor] = await getDb().select({
    userId: users.id,
    email: users.email,
    displayName: users.displayName,
    authSubject: users.authSubject,
    authProvider: users.authProvider,
    role: memberships.role,
    organizationId: memberships.organizationId,
    organization: workspaces,
  }).from(users).innerJoin(memberships, and(
    eq(memberships.userId, users.id),
    eq(memberships.organizationId, organizationId),
  )).innerJoin(workspaces, eq(workspaces.id, memberships.organizationId)).where(and(
    eq(users.id, actorUserId),
    eq(users.status, "active"),
    eq(memberships.status, "active"),
  )).limit(1);
  if (!actor || (actor.role !== "owner" && actor.role !== "admin")) {
    throw new ApiError(403, "QUICKBOOKS_INITIATOR_INELIGIBLE", "The account that started this connection can no longer manage accounting integrations.");
  }
  const context: AccessContext = {
    identity: {
      email: actor.email,
      displayName: actor.displayName,
      subject: actor.authSubject,
      provider: actor.authProvider ?? "sites",
      emailVerified: true,
      assuranceLevel: null,
      sessionId: null,
    },
    userId: actor.userId,
    organizationId: actor.organizationId,
    role: actor.role,
    authSubject: actor.authSubject,
    authProvider: actor.authProvider,
    organization: actor.organization,
  };
  await requireFeature(context, "bookloq.reconciliation");
  await requirePermission(context, "integrations.manage");
  return context;
}

export async function GET(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    const url = new URL(request.url);
    const providerError = url.searchParams.get("error");
    const code = url.searchParams.get("code")?.trim() ?? "";
    const state = url.searchParams.get("state")?.trim() ?? "";
    const realmId = url.searchParams.get("realmId")?.trim() ?? "";
    if ((!providerError && (!code || code.length > 2_048 || !/^\d{1,32}$/.test(realmId))) || !/^[A-Za-z0-9_-]{43}$/.test(state)) {
      throw new ApiError(400, "QUICKBOOKS_CALLBACK_INVALID", "QuickBooks returned an incomplete callback.");
    }
    const now = new Date();
    const stateHash = await quickBooksStateHash(state);
    const [storedState] = await getDb().select().from(integrationOAuthStates).where(and(
      eq(integrationOAuthStates.stateHash, stateHash),
      eq(integrationOAuthStates.provider, QUICKBOOKS_PROVIDER),
      isNull(integrationOAuthStates.consumedAt),
      gt(integrationOAuthStates.expiresAt, now),
    )).limit(1);
    if (!storedState) throw new ApiError(400, "QUICKBOOKS_STATE_INVALID", "The QuickBooks authorization attempt expired or was already used. Start again.");
    const context = await callbackActor(storedState.organizationId, storedState.actorUserId);
    const [consumed] = await getDb().update(integrationOAuthStates).set({ consumedAt: now }).where(and(
      eq(integrationOAuthStates.stateHash, stateHash),
      eq(integrationOAuthStates.provider, QUICKBOOKS_PROVIDER),
      isNull(integrationOAuthStates.consumedAt),
      gt(integrationOAuthStates.expiresAt, now),
    )).returning({ stateHash: integrationOAuthStates.stateHash });
    if (!consumed) throw new ApiError(400, "QUICKBOOKS_STATE_INVALID", "The QuickBooks authorization attempt expired or was already used. Start again.");
    const [pending] = await getDb().select({ id: integrationConnections.id }).from(integrationConnections).where(and(
      eq(integrationConnections.id, storedState.connectionId),
      eq(integrationConnections.organizationId, context.organizationId),
      eq(integrationConnections.provider, QUICKBOOKS_PROVIDER),
      eq(integrationConnections.status, "pending"),
    )).limit(1);
    if (!pending) throw new ApiError(409, "QUICKBOOKS_CONNECTION_MISSING", "The QuickBooks connection attempt is no longer available. Start again.");
    if (providerError) {
      await getDb().delete(integrationConnections).where(and(
        eq(integrationConnections.id, pending.id),
        eq(integrationConnections.organizationId, context.organizationId),
        eq(integrationConnections.provider, QUICKBOOKS_PROVIDER),
      ));
      await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
        action: "integration.authorization_declined", resourceType: "integration", resourceId: pending.id,
        details: { provider: QUICKBOOKS_PROVIDER, connectionId: pending.id },
      });
      return Response.redirect(returnUrl(request, "declined"), 303);
    }

    let accessToken = "";
    let preserveGrant = false;
    try {
      const token = await exchangeQuickBooksAuthorizationCode(code);
      accessToken = token.accessToken;
      const company = await verifyQuickBooksCompany(realmId, token.accessToken);
      const [existing] = await getDb().select({
        id: integrationConnections.id,
        organizationId: integrationConnections.organizationId,
      }).from(integrationConnections).where(and(
        eq(integrationConnections.provider, QUICKBOOKS_PROVIDER),
        eq(integrationConnections.externalAccountRef, company.realmId),
        eq(integrationConnections.status, "connected"),
      )).limit(1);
      preserveGrant = Boolean(existing);
      if (existing && existing.organizationId !== context.organizationId) {
        throw new ApiError(409, "QUICKBOOKS_COMPANY_UNAVAILABLE", "This QuickBooks company is already assigned to another organization.");
      }
      const readiness = quickBooksReadiness();
      const connectionId = existing?.id ?? pending.id;
      if (existing) {
        await getDb().update(integrationConnections).set({
          status: "connected",
          externalAccountName: company.name,
          domainPrefix: null,
          apiVersion: readiness.apiVersion,
          scopesJson: JSON.stringify(token.scopes),
          dataPromotionStatus: "staging",
          connectedAt: now,
          lastSuccessfulSyncAt: null,
          lastSyncCursor: null,
          lastErrorCode: null,
          updatedAt: now,
        }).where(and(
          eq(integrationConnections.id, existing.id),
          eq(integrationConnections.organizationId, context.organizationId),
          eq(integrationConnections.provider, QUICKBOOKS_PROVIDER),
        ));
        await saveQuickBooksTokens(context.organizationId, existing.id, token);
        await getDb().delete(integrationConnections).where(and(
          eq(integrationConnections.id, pending.id),
          eq(integrationConnections.organizationId, context.organizationId),
          eq(integrationConnections.provider, QUICKBOOKS_PROVIDER),
        ));
      } else {
        const [connected] = await getDb().update(integrationConnections).set({
          status: "connected",
          externalAccountRef: company.realmId,
          externalAccountName: company.name,
          domainPrefix: null,
          apiVersion: readiness.apiVersion,
          scopesJson: JSON.stringify(token.scopes),
          dataPromotionStatus: "staging",
          connectedAt: now,
          lastSuccessfulSyncAt: null,
          lastSyncCursor: null,
          lastErrorCode: null,
          updatedAt: now,
        }).where(and(
          eq(integrationConnections.id, pending.id),
          eq(integrationConnections.organizationId, context.organizationId),
          eq(integrationConnections.provider, QUICKBOOKS_PROVIDER),
          eq(integrationConnections.status, "pending"),
        )).returning({ id: integrationConnections.id });
        if (!connected) throw new ApiError(409, "QUICKBOOKS_CONNECTION_MISSING", "The QuickBooks connection attempt is no longer available. Start again.");
        await saveQuickBooksTokens(context.organizationId, pending.id, token);
        preserveGrant = true;
      }
      await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
        action: "integration.connected", resourceType: "integration_connection", resourceId: connectionId,
        details: { provider: QUICKBOOKS_PROVIDER, connectionId, environment: readiness.environment, mode: readiness.mode, companyVerified: true, ledgerImportEnabled: false, dataPromotionEnabled: false },
      });
      return Response.redirect(returnUrl(request, "connected"), 303);
    } catch (error) {
      if (accessToken && !preserveGrant) await revokeQuickBooksAuthorization(accessToken).catch(() => false);
      const errorCode = error instanceof ApiError ? error.code : "QUICKBOOKS_CONNECTION_FAILED";
      await getDb().update(integrationConnections).set({
        status: "error", dataPromotionStatus: "blocked", connectedAt: null, lastErrorCode: errorCode, updatedAt: new Date(),
      }).where(and(
        eq(integrationConnections.id, pending.id),
        eq(integrationConnections.organizationId, context.organizationId),
        eq(integrationConnections.provider, QUICKBOOKS_PROVIDER),
      ));
      await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
        action: "integration.connection_failed", resourceType: "integration_connection", resourceId: pending.id,
        details: { provider: QUICKBOOKS_PROVIDER, connectionId: pending.id, errorCode, dataPromotionEnabled: false },
      });
      return Response.redirect(returnUrl(request, "failed"), 303);
    }
  });
}
