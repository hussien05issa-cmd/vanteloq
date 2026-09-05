import { requireOAuthBrowser } from "../../../../../../server/integrations/oauth-browser";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { integrationConnections, integrationLocationMappings, integrationOAuthStates, integrationSecrets, memberships, organizationLocations, users, workspaces } from "../../../../../../db/schema";
import { recordAudit } from "../../../../../../server/audit";
import type { AccessContext } from "../../../../../../server/authorization";
import { ApiError, handleApi } from "../../../../../../server/api";
import { exchangeSquareCode, fetchSquareLocations, fetchSquareMerchant, saveSquareTokens, SQUARE_API_VERSION, SQUARE_PROVIDER, SQUARE_READ_SCOPES, squareSha256 } from "../../../../../../server/integrations/square";
import { requirePermission } from "../../../../../../server/permissions";

function returnUrl(request: Request, status: "connected" | "declined" | "failed") { return new URL(`/?integration=square&connection=${status}`, new URL(request.url).origin).toString(); }
function label(value: unknown, fallback: string) { return typeof value === "string" && value.trim() ? value.trim().slice(0, 160) : fallback; }

export async function GET(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    const url = new URL(request.url);
    const providerError = url.searchParams.get("error")?.trim() ?? "";
    const code = url.searchParams.get("code")?.trim() ?? "";
    const state = url.searchParams.get("state")?.trim() ?? "";
    requireOAuthBrowser(request, "square", state);
    if ((!providerError && (!code || code.length > 4096)) || !/^[A-Za-z0-9_-]{43}$/.test(state)) throw new ApiError(400, "SQUARE_CALLBACK_INVALID", "Square returned an incomplete callback. Start the connection again.");
    const now = new Date();
    const stateHash = await squareSha256(state);
    const [stored] = await getDb().select().from(integrationOAuthStates).where(and(eq(integrationOAuthStates.stateHash, stateHash), eq(integrationOAuthStates.provider, SQUARE_PROVIDER), isNull(integrationOAuthStates.consumedAt), gt(integrationOAuthStates.expiresAt, now))).limit(1);
    if (!stored) throw new ApiError(400, "SQUARE_STATE_INVALID", "The Square connection attempt expired or was already used.");
    const [actor] = await getDb().select({ userId: users.id, email: users.email, displayName: users.displayName, authSubject: users.authSubject, authProvider: users.authProvider, role: memberships.role, organizationId: memberships.organizationId, organization: workspaces })
      .from(users).innerJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.organizationId, stored.organizationId))).innerJoin(workspaces, eq(workspaces.id, memberships.organizationId))
      .where(and(eq(users.id, stored.actorUserId), eq(users.status, "active"), eq(memberships.status, "active"))).limit(1);
    if (!actor || (actor.role !== "owner" && actor.role !== "admin")) throw new ApiError(403, "SQUARE_INITIATOR_INELIGIBLE", "The account that started this connection can no longer manage integrations.");
    const context: AccessContext = { identity: { email: actor.email, displayName: actor.displayName, subject: actor.authSubject, provider: actor.authProvider ?? "sites", emailVerified: true, assuranceLevel: null, sessionId: null }, userId: actor.userId, organizationId: actor.organizationId, role: actor.role, authSubject: actor.authSubject, authProvider: actor.authProvider, organization: actor.organization };
    await requirePermission(context, "integrations.manage");
    const [consumed] = await getDb().update(integrationOAuthStates).set({ consumedAt: now }).where(and(eq(integrationOAuthStates.stateHash, stateHash), eq(integrationOAuthStates.provider, SQUARE_PROVIDER), isNull(integrationOAuthStates.consumedAt), gt(integrationOAuthStates.expiresAt, now))).returning({ stateHash: integrationOAuthStates.stateHash });
    if (!consumed) throw new ApiError(400, "SQUARE_STATE_INVALID", "The Square connection attempt expired or was already used.");
    const connectionId = stored.connectionId;
    const [pending] = await getDb().select({ id: integrationConnections.id }).from(integrationConnections).where(and(
      eq(integrationConnections.id, connectionId), eq(integrationConnections.organizationId, context.organizationId),
      eq(integrationConnections.provider, SQUARE_PROVIDER), eq(integrationConnections.status, "pending"),
    )).limit(1);
    if (!pending) throw new ApiError(409, "SQUARE_CONNECTION_MISSING", "The Square connection attempt is no longer available.");
    if (providerError) {
      await getDb().delete(integrationConnections).where(and(
        eq(integrationConnections.id, connectionId), eq(integrationConnections.organizationId, context.organizationId),
        eq(integrationConnections.provider, SQUARE_PROVIDER), eq(integrationConnections.status, "pending"),
      ));
      await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId, action: "integration.authorization_declined", resourceType: "integration", resourceId: connectionId, details: { provider: SQUARE_PROVIDER } });
      return Response.redirect(returnUrl(request, "declined"), 303);
    }
    let finalized = false;
    try {
      const token = await exchangeSquareCode(code);
      await saveSquareTokens(context.organizationId, connectionId, token);
      const merchant = await fetchSquareMerchant(context.organizationId, connectionId);
      if (String(merchant.id ?? "") !== token.merchantId) throw new ApiError(409, "SQUARE_MERCHANT_CHANGED", "Square returned a different seller than the authorized token.");
      const [existing] = await getDb().select({ id: integrationConnections.id }).from(integrationConnections).where(and(
        eq(integrationConnections.organizationId, context.organizationId), eq(integrationConnections.provider, SQUARE_PROVIDER),
        eq(integrationConnections.externalAccountRef, token.merchantId), eq(integrationConnections.status, "connected"),
      )).limit(1);
      if (existing && existing.id !== connectionId) {
        await getDb().delete(integrationSecrets).where(eq(integrationSecrets.connectionId, connectionId));
        await getDb().delete(integrationConnections).where(and(eq(integrationConnections.id, connectionId), eq(integrationConnections.status, "pending")));
        return Response.redirect(returnUrl(request, "connected"), 303);
      }
      const locations = await fetchSquareLocations(context.organizationId, connectionId);
      const localLocations = await getDb().select({ id: organizationLocations.id }).from(organizationLocations).where(and(eq(organizationLocations.organizationId, context.organizationId), eq(organizationLocations.status, "active")));
      const autoLocationId = localLocations.length === 1 ? localLocations[0].id : null;
      for (const location of locations) {
        const locationId = typeof location.id === "string" ? location.id : "";
        if (!locationId) continue;
        const externalName = label(location.name, "Square location");
        await getDb().insert(integrationLocationMappings).values({ id: crypto.randomUUID(), organizationId: context.organizationId, provider: SQUARE_PROVIDER, connectionId, externalLocationRef: locationId, externalName, localLocationId: autoLocationId, status: autoLocationId ? "mapped" : "unmapped", lastSeenAt: now, createdAt: now, updatedAt: now }).onConflictDoUpdate({ target: [integrationLocationMappings.organizationId, integrationLocationMappings.provider, integrationLocationMappings.connectionId, integrationLocationMappings.externalLocationRef], set: { externalName, localLocationId: autoLocationId, status: autoLocationId ? "mapped" : "unmapped", lastSeenAt: now, updatedAt: now } });
      }
      const merchantName = label(merchant.business_name, label(merchant.country, "Square seller"));
      const [connected] = await getDb().update(integrationConnections).set({ status: "connected", externalAccountRef: token.merchantId, externalAccountName: merchantName, apiVersion: SQUARE_API_VERSION, scopesJson: JSON.stringify(SQUARE_READ_SCOPES), dataPromotionStatus: "staging", connectedAt: now, lastErrorCode: null, updatedAt: now }).where(and(eq(integrationConnections.id, connectionId), eq(integrationConnections.organizationId, context.organizationId), eq(integrationConnections.provider, SQUARE_PROVIDER), eq(integrationConnections.status, "pending"))).returning({ id: integrationConnections.id });
      if (!connected) throw new ApiError(409, "SQUARE_CONNECTION_MISSING", "The Square connection attempt changed before it could complete.");
      finalized = true;
      await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId, action: "integration.connected", resourceType: "integration", resourceId: connectionId, details: { provider: SQUARE_PROVIDER, merchantId: token.merchantId, locationCount: locations.length, locationAutoMapped: Boolean(autoLocationId) } });
      return Response.redirect(returnUrl(request, "connected"), 303);
    } catch (error) {
      if (finalized) throw error;
      const errorCode = error instanceof ApiError ? error.code : "SQUARE_CONNECTION_FAILED";
      await getDb().delete(integrationSecrets).where(and(eq(integrationSecrets.organizationId, context.organizationId), eq(integrationSecrets.provider, SQUARE_PROVIDER), eq(integrationSecrets.connectionId, connectionId)));
      await getDb().delete(integrationLocationMappings).where(and(eq(integrationLocationMappings.organizationId, context.organizationId), eq(integrationLocationMappings.provider, SQUARE_PROVIDER), eq(integrationLocationMappings.connectionId, connectionId)));
      await getDb().update(integrationConnections).set({ status: "error", dataPromotionStatus: "blocked", lastErrorCode: errorCode, updatedAt: new Date() }).where(and(eq(integrationConnections.id, connectionId), eq(integrationConnections.organizationId, context.organizationId), eq(integrationConnections.provider, SQUARE_PROVIDER)));
      await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId, action: "integration.connection_failed", resourceType: "integration", resourceId: connectionId, details: { provider: SQUARE_PROVIDER, errorCode } });
      return Response.redirect(returnUrl(request, "failed"), 303);
    }
  });
}
