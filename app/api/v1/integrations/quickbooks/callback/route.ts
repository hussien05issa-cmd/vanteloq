import { requireOAuthBrowser } from "../../../../../../server/integrations/oauth-browser";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { integrationConnections, integrationOAuthStates, memberships, users, workspaces } from "../../../../../../db/schema";
import { recordAudit } from "../../../../../../server/audit";
import type { AccessContext } from "../../../../../../server/authorization";
import { ApiError, handleApi } from "../../../../../../server/api";
import { requireFeature } from "../../../../../../server/entitlements/engine";
import {
  exchangeQuickBooksAuthorizationCode,
  acquireQuickBooksGrantLease,
  quickBooksReadiness,
  quickBooksStateHash,
  revokeQuickBooksAuthorization,
  saveQuickBooksTokens,
  verifyQuickBooksCompany,
  QUICKBOOKS_PROVIDER,
} from "../../../../../../server/integrations/quickbooks";
import { releaseIntegrationSyncLease, type IntegrationSyncLease } from "../../../../../../server/integrations/connection";
import { requirePermission } from "../../../../../../server/permissions";

function returnUrl(request: Request, status: "connected" | "declined" | "failed") {
  return new URL(`/?integration=quickbooks&connection=${status}`, new URL(request.url).origin).toString();
}

async function callbackActor(initiation: typeof integrationOAuthStates.$inferSelect): Promise<AccessContext> {
  const { organizationId, actorUserId } = initiation;
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
  // This proof was recorded from the verified session at authorization, never
  // from callback parameters. It is usable only after the browser-bound,
  // unexpired one-time state above has been checked. Re-check the actor's
  // identity, current membership, entitlement and permission before exchange.
  if (!initiation.initiatorAuthSubject || initiation.initiatorAuthSubject !== actor.authSubject
    || initiation.initiatorAuthProvider !== actor.authProvider) {
    throw new ApiError(403, "QUICKBOOKS_INITIATOR_SESSION_INVALID", "Start a new QuickBooks connection from your signed-in workspace.");
  }
  const context: AccessContext = {
    identity: {
      email: actor.email,
      displayName: actor.displayName,
      subject: actor.authSubject,
      provider: actor.authProvider ?? "sites",
      emailVerified: true,
      assuranceLevel: initiation.initiatorAssuranceLevel === "aal2" ? "aal2" : initiation.initiatorAssuranceLevel === "aal1" ? "aal1" : null,
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
    requireOAuthBrowser(request, "quickbooks", state);
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
    const context = await callbackActor(storedState);
    const [consumed] = await getDb().update(integrationOAuthStates).set({ consumedAt: now }).where(and(
      eq(integrationOAuthStates.stateHash, stateHash),
      eq(integrationOAuthStates.provider, QUICKBOOKS_PROVIDER),
      isNull(integrationOAuthStates.consumedAt),
      gt(integrationOAuthStates.expiresAt, now),
    )).returning({ stateHash: integrationOAuthStates.stateHash });
    if (!consumed) throw new ApiError(400, "QUICKBOOKS_STATE_INVALID", "The QuickBooks authorization attempt expired or was already used. Start again.");
    const [pending] = await getDb().select({ id: integrationConnections.id, sourceNamespace: integrationConnections.sourceNamespace }).from(integrationConnections).where(and(
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
    let grantLease: IntegrationSyncLease | null = null;
    let pendingLease: IntegrationSyncLease | null = null;
    let grantSaved = false;
    let savedNamespace = pending.sourceNamespace;
    try {
      const token = await exchangeQuickBooksAuthorizationCode(code, pending.sourceNamespace);
      accessToken = token.accessToken;
      const company = await verifyQuickBooksCompany(realmId, token.accessToken, pending.sourceNamespace);
      const [existing] = await getDb().select({
        id: integrationConnections.id,
        organizationId: integrationConnections.organizationId,
        sourceNamespace: integrationConnections.sourceNamespace,
        status: integrationConnections.status,
      }).from(integrationConnections).where(and(
        eq(integrationConnections.provider, QUICKBOOKS_PROVIDER),
        eq(integrationConnections.externalAccountRef, company.realmId),
        or(eq(integrationConnections.status, "connected"), eq(integrationConnections.status, "error"), eq(integrationConnections.status, "pending")),
      )).limit(1);
      preserveGrant = Boolean(existing);
      if (existing && existing.organizationId !== context.organizationId) {
        throw new ApiError(409, "QUICKBOOKS_COMPANY_UNAVAILABLE", "This QuickBooks company is already assigned to another organization.");
      }
      pendingLease = await acquireQuickBooksGrantLease(context.organizationId, pending.id);
      const [activeAttempt] = await getDb().select({ id: integrationConnections.id }).from(integrationConnections).where(and(
        eq(integrationConnections.id, pending.id), eq(integrationConnections.organizationId, context.organizationId),
        eq(integrationConnections.provider, QUICKBOOKS_PROVIDER), eq(integrationConnections.status, "pending"),
        eq(integrationConnections.sourceNamespace, pending.sourceNamespace), eq(integrationConnections.syncLeaseOwner, pendingLease.owner),
        eq(integrationConnections.syncVersion, pendingLease.version), gt(integrationConnections.syncLeaseExpiresAt, new Date()),
      )).limit(1);
      if (!activeAttempt) throw new ApiError(409, "QUICKBOOKS_GRANT_CHANGED", "This authorization attempt was removed. Start a new connection.");
      const readiness = quickBooksReadiness();
      const connectionId = existing?.id ?? pending.id;
      grantLease = existing ? await acquireQuickBooksGrantLease(context.organizationId, connectionId) : pendingLease;
      if (existing) {
        // The pending attempt still owns its unique namespace. Preserve its
        // verified app/environment binding with a distinct generation for the
        // existing connection; never rebind it from current global settings.
        savedNamespace = pending.sourceNamespace.replace(/:[^:]+$/, `:${crypto.randomUUID()}`);
        const [reconnected] = await getDb().update(integrationConnections).set({
          status: "pending",
          sourceNamespace: savedNamespace,
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
          eq(integrationConnections.status, existing.status),
          eq(integrationConnections.sourceNamespace, existing.sourceNamespace),
          eq(integrationConnections.syncLeaseOwner, grantLease.owner),
          eq(integrationConnections.syncVersion, grantLease.version),
          gt(integrationConnections.syncLeaseExpiresAt, new Date()),
        )).returning({ id: integrationConnections.id });
        if (!reconnected) throw new ApiError(409, "QUICKBOOKS_GRANT_CHANGED", "The company connection changed during authorization. Start again.");
        await saveQuickBooksTokens(context.organizationId, existing.id, token, savedNamespace, grantLease, { lease: pendingLease, sourceNamespace: pending.sourceNamespace });
        grantSaved = true;
        await getDb().delete(integrationConnections).where(and(
          eq(integrationConnections.id, pending.id),
          eq(integrationConnections.organizationId, context.organizationId),
          eq(integrationConnections.provider, QUICKBOOKS_PROVIDER),
        ));
      } else {
        const [connected] = await getDb().update(integrationConnections).set({
          status: "pending",
          sourceNamespace: pending.sourceNamespace,
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
          eq(integrationConnections.sourceNamespace, pending.sourceNamespace),
          eq(integrationConnections.syncLeaseOwner, grantLease.owner),
          eq(integrationConnections.syncVersion, grantLease.version),
          gt(integrationConnections.syncLeaseExpiresAt, new Date()),
        )).returning({ id: integrationConnections.id });
        if (!connected) throw new ApiError(409, "QUICKBOOKS_CONNECTION_MISSING", "The QuickBooks connection attempt is no longer available. Start again.");
        await saveQuickBooksTokens(context.organizationId, pending.id, token, pending.sourceNamespace, grantLease, { lease: pendingLease, sourceNamespace: pending.sourceNamespace });
        grantSaved = true;
        preserveGrant = true;
      }
      await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
        action: "integration.connected", resourceType: "integration_connection", resourceId: connectionId,
        details: { provider: QUICKBOOKS_PROVIDER, connectionId, environment: readiness.environment, mode: readiness.mode, companyVerified: true, ledgerImportEnabled: false, dataPromotionEnabled: false },
      });
      return Response.redirect(returnUrl(request, "connected"), 303);
    } catch (error) {
      if (accessToken && !preserveGrant) await revokeQuickBooksAuthorization(accessToken, pending.sourceNamespace).catch(() => false);
      const errorCode = error instanceof ApiError ? error.code : "QUICKBOOKS_CONNECTION_FAILED";
      if (!grantSaved && grantLease && grantLease.connectionId !== pending.id) {
        // A failed reconnect save cannot leave the previous secret readable
        // under the new authorization generation.
        await getDb().update(integrationConnections).set({
          status: "error", dataPromotionStatus: "blocked", connectedAt: null, lastErrorCode: errorCode, updatedAt: new Date(),
        }).where(and(
          eq(integrationConnections.id, grantLease.connectionId),
          eq(integrationConnections.organizationId, context.organizationId),
          eq(integrationConnections.provider, QUICKBOOKS_PROVIDER),
          eq(integrationConnections.sourceNamespace, savedNamespace),
          eq(integrationConnections.status, "pending"),
          eq(integrationConnections.syncLeaseOwner, grantLease.owner),
          eq(integrationConnections.syncVersion, grantLease.version),
        ));
      }
      if (!grantSaved) await getDb().update(integrationConnections).set({
        status: "error", dataPromotionStatus: "blocked", connectedAt: null, lastErrorCode: errorCode, updatedAt: new Date(),
      }).where(and(
        eq(integrationConnections.id, pending.id),
        eq(integrationConnections.organizationId, context.organizationId),
        eq(integrationConnections.provider, QUICKBOOKS_PROVIDER),
        eq(integrationConnections.sourceNamespace, pending.sourceNamespace),
        ...(pendingLease ? [eq(integrationConnections.syncLeaseOwner, pendingLease.owner), eq(integrationConnections.syncVersion, pendingLease.version)] : [isNull(integrationConnections.syncLeaseOwner)]),
        or(eq(integrationConnections.status, "pending"), ...(grantLease ? [and(
          eq(integrationConnections.status, "connected"),
          eq(integrationConnections.syncLeaseOwner, grantLease.owner),
          eq(integrationConnections.syncVersion, grantLease.version),
        )] : [])),
      ));
      await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
        action: "integration.connection_failed", resourceType: "integration_connection", resourceId: pending.id,
        details: { provider: QUICKBOOKS_PROVIDER, connectionId: pending.id, errorCode, dataPromotionEnabled: false },
      });
      return Response.redirect(returnUrl(request, "failed"), 303);
    } finally {
      try {
        if (grantLease && grantLease !== pendingLease) await releaseIntegrationSyncLease(grantLease);
      } finally {
        if (pendingLease) await releaseIntegrationSyncLease(pendingLease);
      }
    }
  });
}
