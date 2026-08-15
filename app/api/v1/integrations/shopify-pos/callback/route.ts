import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { integrationConnections, integrationLocationMappings, integrationOAuthStates, integrationSecrets, memberships, organizationLocations, users, workspaces } from "../../../../../../db/schema";
import { recordAudit } from "../../../../../../server/audit";
import type { AccessContext } from "../../../../../../server/authorization";
import { ApiError, handleApi } from "../../../../../../server/api";
import { exchangeShopifyCode, fetchShopifyIdentity, fetchShopifyLocations, normalizeShopDomain, saveShopifyToken, SHOPIFY_API_VERSION, SHOPIFY_POS_PROVIDER, SHOPIFY_POS_READ_SCOPES, shopifySha256, verifyShopifyCallback } from "../../../../../../server/integrations/shopify-pos";
import { requirePermission } from "../../../../../../server/permissions";

function returnUrl(request: Request, status: "connected" | "declined" | "failed") { return new URL(`/?integration=shopify-pos&connection=${status}`, new URL(request.url).origin).toString(); }
export async function GET(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    const url = new URL(request.url);
    const code = url.searchParams.get("code")?.trim() ?? "";
    const state = url.searchParams.get("state")?.trim() ?? "";
    const shop = normalizeShopDomain(url.searchParams.get("shop") ?? "");
    if (!code || code.length > 4096 || !/^[A-Za-z0-9_-]{43}$/u.test(state) || !await verifyShopifyCallback(url)) throw new ApiError(400, "SHOPIFY_CALLBACK_INVALID", "Shopify returned an invalid callback. Start the connection again.");
    const now = new Date();
    const [stored] = await getDb().select().from(integrationOAuthStates).where(and(eq(integrationOAuthStates.stateHash, await shopifySha256(state)), eq(integrationOAuthStates.provider, SHOPIFY_POS_PROVIDER), isNull(integrationOAuthStates.consumedAt), gt(integrationOAuthStates.expiresAt, now))).limit(1);
    if (!stored) throw new ApiError(400, "SHOPIFY_STATE_INVALID", "The Shopify connection attempt expired or was already used.");
    const [actor] = await getDb().select({ userId: users.id, email: users.email, displayName: users.displayName, authSubject: users.authSubject, authProvider: users.authProvider, role: memberships.role, organizationId: memberships.organizationId, organization: workspaces }).from(users).innerJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.organizationId, stored.organizationId))).innerJoin(workspaces, eq(workspaces.id, memberships.organizationId)).where(and(eq(users.id, stored.actorUserId), eq(users.status, "active"), eq(memberships.status, "active"))).limit(1);
    if (!actor || (actor.role !== "owner" && actor.role !== "admin")) throw new ApiError(403, "SHOPIFY_INITIATOR_INELIGIBLE", "The account that started this connection can no longer manage integrations.");
    const context: AccessContext = { identity: { email: actor.email, displayName: actor.displayName, subject: actor.authSubject, provider: actor.authProvider ?? "sites", emailVerified: true, assuranceLevel: null, sessionId: null }, userId: actor.userId, organizationId: actor.organizationId, role: actor.role, authSubject: actor.authSubject, authProvider: actor.authProvider, organization: actor.organization };
    await requirePermission(context, "integrations.manage");
    const [consumed] = await getDb().update(integrationOAuthStates).set({ consumedAt: now }).where(and(eq(integrationOAuthStates.stateHash, stored.stateHash), isNull(integrationOAuthStates.consumedAt), gt(integrationOAuthStates.expiresAt, now))).returning({ stateHash: integrationOAuthStates.stateHash });
    if (!consumed) throw new ApiError(400, "SHOPIFY_STATE_INVALID", "The Shopify connection attempt expired or was already used.");
    const connectionId = stored.connectionId;
    const [pending] = await getDb().select().from(integrationConnections).where(and(eq(integrationConnections.id, connectionId), eq(integrationConnections.organizationId, context.organizationId), eq(integrationConnections.provider, SHOPIFY_POS_PROVIDER), eq(integrationConnections.status, "pending"), eq(integrationConnections.domainPrefix, shop))).limit(1);
    if (!pending) throw new ApiError(409, "SHOPIFY_CONNECTION_MISSING", "The Shopify connection attempt is no longer available.");
    try {
      const token = await exchangeShopifyCode(shop, code);
      await saveShopifyToken(context.organizationId, connectionId, token.accessToken);
      const identity = await fetchShopifyIdentity(context.organizationId, connectionId, shop);
      if (normalizeShopDomain(identity.shop.myshopifyDomain) !== shop) throw new ApiError(409, "SHOPIFY_STORE_CHANGED", "The authorized Shopify store changed. Start again.");
      const locations = await fetchShopifyLocations(context.organizationId, connectionId, shop);
      const localLocations = await getDb().select({ id: organizationLocations.id }).from(organizationLocations).where(and(eq(organizationLocations.organizationId, context.organizationId), eq(organizationLocations.status, "active")));
      const autoLocationId = locations.length === 1 && localLocations.length === 1 ? localLocations[0].id : null;
      for (const location of locations) await getDb().insert(integrationLocationMappings).values({ id: crypto.randomUUID(), organizationId: context.organizationId, provider: SHOPIFY_POS_PROVIDER, connectionId, externalLocationRef: location.id, externalName: location.name.slice(0, 160), localLocationId: autoLocationId, status: autoLocationId ? "mapped" : "unmapped", lastSeenAt: now, createdAt: now, updatedAt: now }).onConflictDoUpdate({ target: [integrationLocationMappings.organizationId, integrationLocationMappings.provider, integrationLocationMappings.connectionId, integrationLocationMappings.externalLocationRef], set: { externalName: location.name.slice(0, 160), lastSeenAt: now, updatedAt: now } });
      const [connected] = await getDb().update(integrationConnections).set({ status: "connected", externalAccountRef: shop, externalAccountName: identity.shop.name.slice(0, 160), apiVersion: SHOPIFY_API_VERSION, scopesJson: JSON.stringify(token.scopes.length ? token.scopes : SHOPIFY_POS_READ_SCOPES), dataPromotionStatus: "staging", connectedAt: now, lastErrorCode: null, updatedAt: now }).where(and(eq(integrationConnections.id, connectionId), eq(integrationConnections.status, "pending"))).returning({ id: integrationConnections.id });
      if (!connected) throw new ApiError(409, "SHOPIFY_CONNECTION_MISSING", "The Shopify connection changed before it could complete.");
      await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId, action: "integration.connected", resourceType: "integration", resourceId: connectionId, details: { provider: SHOPIFY_POS_PROVIDER, shop, locations: locations.length, locationAutoMapped: Boolean(autoLocationId), protectedCustomerDataApproved: false } });
      return Response.redirect(returnUrl(request, "connected"), 303);
    } catch (error) {
      await getDb().delete(integrationSecrets).where(and(eq(integrationSecrets.organizationId, context.organizationId), eq(integrationSecrets.connectionId, connectionId)));
      await getDb().update(integrationConnections).set({ status: "error", dataPromotionStatus: "blocked", lastErrorCode: error instanceof ApiError ? error.code : "SHOPIFY_CONNECTION_FAILED", updatedAt: new Date() }).where(eq(integrationConnections.id, connectionId));
      return Response.redirect(returnUrl(request, "failed"), 303);
    }
  });
}
