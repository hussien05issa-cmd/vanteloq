import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import {
  integrationConnections,
  integrationLocationMappings,
  integrationOAuthStates,
  integrationSecrets,
  memberships,
  users,
  workspaces,
} from "../../../../../../db/schema";
import { recordAudit } from "../../../../../../server/audit";
import type { AccessContext } from "../../../../../../server/authorization";
import { ApiError, handleApi } from "../../../../../../server/api";
import {
  exchangeLightspeedRCode, fetchLightspeedRAccount, fetchLightspeedRCollection,
  LIGHTSPEED_R_PROVIDER, LIGHTSPEED_R_SCOPES, lightspeedRReadiness,
  lightspeedRSha256, saveLightspeedRTokens,
} from "../../../../../../server/integrations/lightspeed-r";
import { requirePermission } from "../../../../../../server/permissions";

function returnUrl(request: Request, status: "connected" | "declined" | "failed") {
  const url = new URL(request.url);
  return new URL(`/?integration=lightspeed-r&connection=${status}`, url.origin).toString();
}

export async function GET(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    const url = new URL(request.url);
    const providerError = url.searchParams.get("error")?.trim() ?? "";
    const code = url.searchParams.get("code")?.trim() ?? "";
    const state = url.searchParams.get("state")?.trim() ?? "";
    // R-Series authorization codes are opaque and can be substantially longer
    // than a conventional short code. Bound the input without imposing an
    // undocumented provider-specific 512-character limit.
    if ((!providerError && (!code || code.length > 4096)) || !/^[A-Za-z0-9_-]{43}$/.test(state)) {
      throw new ApiError(400, "LIGHTSPEED_R_CALLBACK_INVALID", "R-Series returned an incomplete callback.");
    }
    const stateHash = await lightspeedRSha256(state);
    const now = new Date();
    const [stored] = await getDb().select().from(integrationOAuthStates).where(and(
      eq(integrationOAuthStates.stateHash, stateHash),
      eq(integrationOAuthStates.provider, LIGHTSPEED_R_PROVIDER),
      isNull(integrationOAuthStates.consumedAt), gt(integrationOAuthStates.expiresAt, now),
    )).limit(1);
    if (!stored) throw new ApiError(400, "LIGHTSPEED_R_STATE_INVALID", "The R-Series authorization attempt expired or was already used. Start again.");

    // The browser's Supabase session lives in browser storage and cannot be
    // attached as an Authorization header to Lightspeed's top-level redirect.
    // The unguessable, one-time state identifies the exact initiating actor and
    // workspace. Re-check that actor's current status, role and permission before
    // consuming the state or storing any provider credential.
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
      eq(memberships.organizationId, stored.organizationId),
    )).innerJoin(workspaces, eq(workspaces.id, memberships.organizationId)).where(and(
      eq(users.id, stored.actorUserId),
      eq(users.status, "active"),
      eq(memberships.status, "active"),
    )).limit(1);
    if (!actor || (actor.role !== "owner" && actor.role !== "admin")) {
      throw new ApiError(403, "LIGHTSPEED_R_INITIATOR_INELIGIBLE", "The account that started this connection can no longer manage integrations.");
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
      eq(integrationOAuthStates.provider, LIGHTSPEED_R_PROVIDER),
      isNull(integrationOAuthStates.consumedAt),
      gt(integrationOAuthStates.expiresAt, now),
    )).returning({ stateHash: integrationOAuthStates.stateHash });
    if (!consumedState) {
      throw new ApiError(400, "LIGHTSPEED_R_STATE_INVALID", "The R-Series authorization attempt expired or was already used. Start again.");
    }

    const activeConnectionId = stored.connectionId;
    const [pendingConnection] = await getDb().select({ id: integrationConnections.id }).from(integrationConnections).where(and(
      eq(integrationConnections.id, activeConnectionId),
      eq(integrationConnections.organizationId, context.organizationId),
      eq(integrationConnections.provider, LIGHTSPEED_R_PROVIDER),
      eq(integrationConnections.status, "pending"),
    )).limit(1);
    if (!pendingConnection) {
      throw new ApiError(409, "LIGHTSPEED_R_CONNECTION_MISSING", "The R-Series connection attempt is no longer available. Start again.");
    }

    if (providerError) {
      const [deletedConnection] = await getDb().delete(integrationConnections).where(and(
        eq(integrationConnections.id, activeConnectionId),
        eq(integrationConnections.organizationId, context.organizationId),
        eq(integrationConnections.provider, LIGHTSPEED_R_PROVIDER),
        eq(integrationConnections.status, "pending"),
      )).returning({ id: integrationConnections.id });
      if (!deletedConnection) {
        throw new ApiError(409, "LIGHTSPEED_R_CONNECTION_MISSING", "The R-Series connection attempt is no longer available. Start again.");
      }
      await getDb().delete(integrationSecrets).where(and(
        eq(integrationSecrets.connectionId, activeConnectionId),
        eq(integrationSecrets.organizationId, context.organizationId),
        eq(integrationSecrets.provider, LIGHTSPEED_R_PROVIDER),
      ));
      await recordAudit({
        request,
        requestId,
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "integration.authorization_declined",
        resourceType: "integration",
        resourceId: activeConnectionId,
        details: {
          provider: LIGHTSPEED_R_PROVIDER,
          connectionId: activeConnectionId,
          reason: "provider_declined",
          dataPromotionEnabled: false,
        },
      });
      return Response.redirect(returnUrl(request, "declined"), 303);
    }

    let finalized = false;
    try {
      const token = await exchangeLightspeedRCode(code);
      const [tokenClaim] = await getDb().update(integrationConnections).set({ updatedAt: now }).where(and(
        eq(integrationConnections.id, activeConnectionId),
        eq(integrationConnections.organizationId, context.organizationId),
        eq(integrationConnections.provider, LIGHTSPEED_R_PROVIDER),
        eq(integrationConnections.status, "pending"),
      )).returning({ id: integrationConnections.id });
      if (!tokenClaim) {
        throw new ApiError(409, "LIGHTSPEED_R_CONNECTION_MISSING", "The R-Series connection attempt is no longer available. Start again.");
      }
      await saveLightspeedRTokens(context.organizationId, activeConnectionId, token);
      const account = await fetchLightspeedRAccount(context.organizationId, activeConnectionId);
      const readiness = lightspeedRReadiness();
      const [existing] = await getDb().select({ id: integrationConnections.id }).from(integrationConnections).where(and(
        eq(integrationConnections.organizationId, context.organizationId),
        eq(integrationConnections.provider, LIGHTSPEED_R_PROVIDER),
        eq(integrationConnections.externalAccountRef, account.accountId),
        eq(integrationConnections.status, "connected"),
      )).limit(1);
      if (existing && existing.id !== activeConnectionId) {
        const [deletedConnection] = await getDb().delete(integrationConnections).where(and(
          eq(integrationConnections.id, activeConnectionId),
          eq(integrationConnections.organizationId, context.organizationId),
          eq(integrationConnections.provider, LIGHTSPEED_R_PROVIDER),
          eq(integrationConnections.status, "pending"),
        )).returning({ id: integrationConnections.id });
        if (!deletedConnection) {
          throw new ApiError(409, "LIGHTSPEED_R_CONNECTION_MISSING", "The R-Series connection attempt is no longer available. Start again.");
        }
        await getDb().delete(integrationSecrets).where(and(
          eq(integrationSecrets.connectionId, activeConnectionId),
          eq(integrationSecrets.organizationId, context.organizationId),
          eq(integrationSecrets.provider, LIGHTSPEED_R_PROVIDER),
        ));
        await recordAudit({
          request,
          requestId,
          organizationId: context.organizationId,
          actorUserId: context.userId,
          action: "integration.authorization_reused",
          resourceType: "integration",
          resourceId: existing.id,
          details: {
            provider: LIGHTSPEED_R_PROVIDER,
            connectionId: existing.id,
            discardedConnectionId: activeConnectionId,
            reason: "account_already_connected",
            dataPromotionEnabled: false,
          },
        });
        return Response.redirect(returnUrl(request, "connected"), 303);
      }
      const [accountClaim] = await getDb().update(integrationConnections).set({
        status: "pending", externalAccountRef: account.accountId, externalAccountName: account.name,
        apiVersion: readiness.apiVersion, scopesJson: JSON.stringify(LIGHTSPEED_R_SCOPES),
        dataPromotionStatus: "blocked", connectedAt: null, lastErrorCode: null, updatedAt: now,
      }).where(and(
        eq(integrationConnections.id, activeConnectionId),
        eq(integrationConnections.organizationId, context.organizationId),
        eq(integrationConnections.provider, LIGHTSPEED_R_PROVIDER),
        eq(integrationConnections.status, "pending"),
      )).returning({ id: integrationConnections.id });
      if (!accountClaim) {
        throw new ApiError(409, "LIGHTSPEED_R_CONNECTION_MISSING", "The R-Series connection attempt is no longer available. Start again.");
      }
      const shops = await fetchLightspeedRCollection(context.organizationId, activeConnectionId, account.accountId, "Shop", { maxPages: 10 });
      for (const shop of shops.data) {
        const ref = typeof shop.shopID === "string" || typeof shop.shopID === "number" ? String(shop.shopID) : "";
        if (!ref) continue;
        const name = typeof shop.name === "string" && shop.name.trim() ? shop.name.trim().slice(0, 160) : "R-Series shop";
        await getDb().insert(integrationLocationMappings).values({
          id: crypto.randomUUID(), organizationId: context.organizationId, provider: LIGHTSPEED_R_PROVIDER, connectionId: activeConnectionId,
          externalLocationRef: ref, externalName: name, localLocationId: null, status: "unmapped",
          lastSeenAt: now, createdAt: now, updatedAt: now,
        }).onConflictDoUpdate({
          target: [integrationLocationMappings.organizationId, integrationLocationMappings.provider, integrationLocationMappings.connectionId, integrationLocationMappings.externalLocationRef],
          set: { externalName: name, lastSeenAt: now, updatedAt: now },
        });
      }
      const [connected] = await getDb().update(integrationConnections).set({ status: "connected", connectedAt: now, updatedAt: now }).where(and(
        eq(integrationConnections.id, activeConnectionId), eq(integrationConnections.organizationId, context.organizationId), eq(integrationConnections.provider, LIGHTSPEED_R_PROVIDER),
        eq(integrationConnections.status, "pending"),
      )).returning({ id: integrationConnections.id });
      if (!connected) {
        throw new ApiError(409, "LIGHTSPEED_R_CONNECTION_MISSING", "The R-Series connection attempt is no longer available. Start again.");
      }
      finalized = true;
      await recordAudit({
        request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
        action: "integration.connected", resourceType: "integration", resourceId: activeConnectionId,
        details: { provider: LIGHTSPEED_R_PROVIDER, connectionId: activeConnectionId, accountRef: account.accountId, shopsDiscovered: shops.data.length, dataPromotionEnabled: false },
      });
      return Response.redirect(returnUrl(request, "connected"), 303);
    } catch (error) {
      if (finalized) throw error;
      const errorCode = error instanceof ApiError ? error.code : "LIGHTSPEED_R_CONNECTION_FAILED";
      await getDb().delete(integrationSecrets).where(and(eq(integrationSecrets.organizationId, context.organizationId), eq(integrationSecrets.provider, LIGHTSPEED_R_PROVIDER), eq(integrationSecrets.connectionId, activeConnectionId)));
      await getDb().delete(integrationLocationMappings).where(and(
        eq(integrationLocationMappings.organizationId, context.organizationId),
        eq(integrationLocationMappings.provider, LIGHTSPEED_R_PROVIDER),
        eq(integrationLocationMappings.connectionId, activeConnectionId),
      ));
      await getDb().update(integrationConnections).set({ status: "error", dataPromotionStatus: "blocked", connectedAt: null, lastErrorCode: errorCode, updatedAt: new Date() }).where(and(
        eq(integrationConnections.id, activeConnectionId), eq(integrationConnections.organizationId, context.organizationId), eq(integrationConnections.provider, LIGHTSPEED_R_PROVIDER),
        eq(integrationConnections.status, "pending"),
      ));
      await recordAudit({
        request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
        action: "integration.connection_failed", resourceType: "integration", resourceId: activeConnectionId,
        details: { provider: LIGHTSPEED_R_PROVIDER, connectionId: activeConnectionId, errorCode, dataPromotionEnabled: false },
      });
      return Response.redirect(returnUrl(request, "failed"), 303);
    }
  });
}
