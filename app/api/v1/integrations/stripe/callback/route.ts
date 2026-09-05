import { requireOAuthBrowser } from "../../../../../../server/integrations/oauth-browser";
import { and, eq, gt, isNull, ne, notExists } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { integrationConnections, integrationOAuthStates, memberships, users, workspaces } from "../../../../../../db/schema";
import { recordAudit } from "../../../../../../server/audit";
import type { AccessContext } from "../../../../../../server/authorization";
import { ApiError, handleApi } from "../../../../../../server/api";
import {
  exchangeStripeAuthorizationCode,
  revokeStripeConnection,
  sha256Hex,
  STRIPE_PROVIDER,
  stripeReadiness,
  verifyStripeAccount,
} from "../../../../../../server/integrations/stripe";
import { requirePermission } from "../../../../../../server/permissions";

function returnUrl(request: Request, status: "connected" | "declined" | "failed") {
  return new URL(`/?integration=stripe&connection=${status}`, new URL(request.url).origin).toString();
}

export async function GET(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    const url = new URL(request.url);
    const providerError = url.searchParams.get("error");
    const code = url.searchParams.get("code")?.trim() ?? "";
    const state = url.searchParams.get("state")?.trim() ?? "";
    requireOAuthBrowser(request, "stripe", state);
    if ((!providerError && (!code || code.length > 512)) || !/^[A-Za-z0-9_-]{43}$/.test(state)) {
      throw new ApiError(400, "STRIPE_CALLBACK_INVALID", "Stripe returned an incomplete callback.");
    }
    const stateHash = await sha256Hex(state);
    const now = new Date();
    const [storedState] = await getDb().select().from(integrationOAuthStates).where(and(
      eq(integrationOAuthStates.stateHash, stateHash),
      eq(integrationOAuthStates.provider, STRIPE_PROVIDER),
      isNull(integrationOAuthStates.consumedAt),
      gt(integrationOAuthStates.expiresAt, now),
    )).limit(1);
    if (!storedState) {
      throw new ApiError(400, "STRIPE_STATE_INVALID", "The Stripe authorization attempt expired or was already used. Start again.");
    }
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
      eq(memberships.organizationId, storedState.organizationId),
    )).innerJoin(workspaces, eq(workspaces.id, memberships.organizationId)).where(and(
      eq(users.id, storedState.actorUserId),
      eq(users.status, "active"),
      eq(memberships.status, "active"),
    )).limit(1);
    if (!actor || (actor.role !== "owner" && actor.role !== "admin")) {
      throw new ApiError(403, "STRIPE_INITIATOR_INELIGIBLE", "The account that started this connection can no longer manage integrations.");
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
    await requirePermission(context, "integrations.manage");
    const [consumedState] = await getDb().update(integrationOAuthStates).set({ consumedAt: now }).where(and(
      eq(integrationOAuthStates.stateHash, stateHash),
      eq(integrationOAuthStates.provider, STRIPE_PROVIDER),
      isNull(integrationOAuthStates.consumedAt),
      gt(integrationOAuthStates.expiresAt, now),
    )).returning({ stateHash: integrationOAuthStates.stateHash });
    if (!consumedState) {
      throw new ApiError(400, "STRIPE_STATE_INVALID", "The Stripe authorization attempt expired or was already used. Start again.");
    }
    const [pendingConnection] = await getDb().select({ id: integrationConnections.id }).from(integrationConnections).where(and(
      eq(integrationConnections.id, storedState.connectionId),
      eq(integrationConnections.organizationId, context.organizationId),
      eq(integrationConnections.provider, STRIPE_PROVIDER),
      eq(integrationConnections.status, "pending"),
    )).limit(1);
    if (!pendingConnection) {
      throw new ApiError(409, "STRIPE_CONNECTION_MISSING", "The Stripe connection attempt is no longer available. Start again.");
    }
    if (providerError) {
      await getDb().delete(integrationConnections).where(and(
        eq(integrationConnections.id, storedState.connectionId),
        eq(integrationConnections.organizationId, context.organizationId),
        eq(integrationConnections.provider, STRIPE_PROVIDER),
        eq(integrationConnections.status, "pending"),
      ));
      await recordAudit({
        request,
        requestId,
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "integration.authorization_declined",
        resourceType: "integration",
        resourceId: storedState.connectionId,
        details: { provider: STRIPE_PROVIDER, connectionId: storedState.connectionId },
      });
      return Response.redirect(returnUrl(request, "declined"), 303);
    }

    let finalized = false;
    let exchangedAccountId: string | null = null;
    let preserveProviderGrant = false;
    try {
      const authorization = await exchangeStripeAuthorizationCode(code);
      exchangedAccountId = authorization.stripe_user_id;
      const [tokenClaim] = await getDb().update(integrationConnections).set({ updatedAt: now }).where(and(
        eq(integrationConnections.id, storedState.connectionId),
        eq(integrationConnections.organizationId, context.organizationId),
        eq(integrationConnections.provider, STRIPE_PROVIDER),
        eq(integrationConnections.status, "pending"),
      )).returning({ id: integrationConnections.id });
      if (!tokenClaim) {
        throw new ApiError(409, "STRIPE_CONNECTION_MISSING", "The Stripe connection attempt is no longer available. Start again.");
      }
      const account = await verifyStripeAccount(authorization.stripe_user_id);
      const readiness = stripeReadiness();

      const connectedAccountOwners = () => getDb().select({
        id: integrationConnections.id,
        organizationId: integrationConnections.organizationId,
      }).from(integrationConnections).where(and(
        eq(integrationConnections.provider, STRIPE_PROVIDER),
        eq(integrationConnections.externalAccountRef, account.id),
        eq(integrationConnections.status, "connected"),
        ne(integrationConnections.id, storedState.connectionId),
      )).limit(2);
      const reuseExistingConnection = async (existingId: string) => {
        await getDb().delete(integrationConnections).where(and(
          eq(integrationConnections.id, storedState.connectionId),
          eq(integrationConnections.organizationId, context.organizationId),
          eq(integrationConnections.provider, STRIPE_PROVIDER),
          eq(integrationConnections.status, "pending"),
        ));
        await recordAudit({
          request,
          requestId,
          organizationId: context.organizationId,
          actorUserId: context.userId,
          action: "integration.authorization_reused",
          resourceType: "integration",
          resourceId: existingId,
          details: { provider: STRIPE_PROVIDER, connectionId: existingId },
        });
        return Response.redirect(returnUrl(request, "connected"), 303);
      };
      const existingOwners = await connectedAccountOwners();
      if (existingOwners.length > 0) {
        preserveProviderGrant = true;
        const existing = existingOwners.length === 1 ? existingOwners[0] : null;
        if (existing?.organizationId === context.organizationId) {
          return await reuseExistingConnection(existing.id);
        }
        throw new ApiError(409, "STRIPE_ACCOUNT_UNAVAILABLE", "This Stripe account is not available for this connection.");
      }

      const competingAccount = getDb().select({ id: integrationConnections.id }).from(integrationConnections).where(and(
        eq(integrationConnections.provider, STRIPE_PROVIDER),
        eq(integrationConnections.externalAccountRef, account.id),
        eq(integrationConnections.status, "connected"),
        ne(integrationConnections.id, storedState.connectionId),
      ));
      const [connected] = await getDb().update(integrationConnections).set({
        status: "connected",
        externalAccountRef: account.id,
        externalAccountName: account.id,
        domainPrefix: null,
        apiVersion: readiness.apiVersion,
        scopesJson: JSON.stringify([authorization.scope]),
        dataPromotionStatus: "blocked",
        connectedAt: now,
        lastSuccessfulSyncAt: null,
        lastSyncCursor: null,
        lastErrorCode: null,
        updatedAt: now,
      }).where(and(
        eq(integrationConnections.id, storedState.connectionId),
        eq(integrationConnections.organizationId, context.organizationId),
        eq(integrationConnections.provider, STRIPE_PROVIDER),
        eq(integrationConnections.status, "pending"),
        notExists(competingAccount),
      )).returning({ id: integrationConnections.id });
      if (!connected) {
        const ownersAfterRace = await connectedAccountOwners();
        if (ownersAfterRace.length > 0) preserveProviderGrant = true;
        const existing = ownersAfterRace.length === 1 ? ownersAfterRace[0] : null;
        if (existing?.organizationId === context.organizationId) {
          return await reuseExistingConnection(existing.id);
        }
        if (ownersAfterRace.length > 0) {
          throw new ApiError(409, "STRIPE_ACCOUNT_UNAVAILABLE", "This Stripe account is not available for this connection.");
        }
        throw new ApiError(409, "STRIPE_CONNECTION_MISSING", "The Stripe connection attempt is no longer available. Start again.");
      }
      finalized = true;
      await recordAudit({
        request,
        requestId,
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "integration.connected",
        resourceType: "integration",
        resourceId: storedState.connectionId,
        details: {
          provider: STRIPE_PROVIDER,
          mode: "read_only_staging",
          livemode: account.livemode,
          dataPromotionEnabled: false,
          connectionId: storedState.connectionId,
        },
      });
      return Response.redirect(returnUrl(request, "connected"), 303);
    } catch (error) {
      if (finalized) throw error;
      if (exchangedAccountId && !preserveProviderGrant) {
        const [existingConnectedOwner] = await getDb().select({ id: integrationConnections.id })
          .from(integrationConnections).where(and(
            eq(integrationConnections.provider, STRIPE_PROVIDER),
            eq(integrationConnections.externalAccountRef, exchangedAccountId),
            eq(integrationConnections.status, "connected"),
            ne(integrationConnections.id, storedState.connectionId),
          )).limit(1);
        preserveProviderGrant = Boolean(existingConnectedOwner);
      }
      const providerGrantRevoked = exchangedAccountId && !preserveProviderGrant
        ? await revokeStripeConnection(exchangedAccountId).catch(() => false)
        : null;
      const cleanupFailed = providerGrantRevoked === false;
      const errorCode = cleanupFailed
        ? "STRIPE_DEAUTHORIZATION_FAILED"
        : error instanceof ApiError ? error.code : "STRIPE_CONNECTION_FAILED";
      const connectionFilters = [
        eq(integrationConnections.id, storedState.connectionId),
        eq(integrationConnections.organizationId, context.organizationId),
        eq(integrationConnections.provider, STRIPE_PROVIDER),
      ];
      if (!cleanupFailed) connectionFilters.push(eq(integrationConnections.status, "pending"));
      await getDb().update(integrationConnections).set({
        status: "error",
        externalAccountRef: cleanupFailed ? exchangedAccountId : null,
        dataPromotionStatus: "blocked",
        connectedAt: null,
        lastErrorCode: errorCode,
        updatedAt: new Date(),
      }).where(and(...connectionFilters));
      await recordAudit({
        request,
        requestId,
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "integration.connection_failed",
        resourceType: "integration",
        resourceId: storedState.connectionId,
        details: {
          provider: STRIPE_PROVIDER,
          connectionId: storedState.connectionId,
          errorCode,
          providerGrantRevoked,
          dataPromotionEnabled: false,
        },
      });
      return Response.redirect(returnUrl(request, "failed"), 303);
    }
  });
}
