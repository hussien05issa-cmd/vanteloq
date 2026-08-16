import { getDb } from "../../../../../../db";
import { and, eq } from "drizzle-orm";
import { integrationConnections, integrationOAuthStates } from "../../../../../../db/schema";
import { recordAudit } from "../../../../../../server/audit";
import { requireAccess } from "../../../../../../server/authorization";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../../../server/api";
import { buildShopifyAuthorizationUrl, newShopifyState, normalizeShopDomain, SHOPIFY_API_VERSION, SHOPIFY_POS_PROVIDER, SHOPIFY_POS_READ_SCOPES, shopifyProviderFromRequest, shopifySha256 } from "../../../../../../server/integrations/shopify-pos";
import { requirePermission } from "../../../../../../server/permissions";

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    const provider = shopifyProviderFromRequest(request);
    const providerLabel = provider === SHOPIFY_POS_PROVIDER ? "Shopify POS" : "Shopify e-commerce";
    requireSameOrigin(request);
    const context = await requireAccess(request, ["owner", "admin"]);
    await requirePermission(context, "integrations.manage");
    await enforceRateLimit(`${provider}:authorize`, context.userId, 10, 3600);
    const input = await readJsonObject(request);
    if (typeof input.shop !== "string") throw new ApiError(400, "SHOPIFY_SHOP_REQUIRED", "Enter the store's permanent .myshopify.com domain.");
    const shop = normalizeShopDomain(input.shop);
    const state = newShopifyState();
    const [existing] = await getDb().select({ id: integrationConnections.id, organizationId: integrationConnections.organizationId, status: integrationConnections.status }).from(integrationConnections).where(and(eq(integrationConnections.provider, provider), eq(integrationConnections.domainPrefix, shop))).limit(1);
    if (existing?.organizationId !== undefined && existing.organizationId !== context.organizationId) throw new ApiError(409, "SHOPIFY_STORE_ALREADY_CONNECTED", "This Shopify store is already connected to another Vanteloq workspace.");
    if (existing?.status === "connected") throw new ApiError(409, "SHOPIFY_STORE_ALREADY_CONNECTED", "This Shopify store is already connected. Use Re-sync now instead of authorizing it again.");
    const connectionId = existing?.id ?? crypto.randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60_000);
    if (existing) {
      await getDb().delete(integrationOAuthStates).where(and(eq(integrationOAuthStates.organizationId, context.organizationId), eq(integrationOAuthStates.provider, provider), eq(integrationOAuthStates.connectionId, connectionId)));
      await getDb().update(integrationConnections).set({ status: "pending", externalAccountRef: shop, externalAccountName: `New ${providerLabel} store`, domainPrefix: shop, apiVersion: SHOPIFY_API_VERSION, scopesJson: JSON.stringify(SHOPIFY_POS_READ_SCOPES), dataPromotionStatus: "blocked", connectedAt: null, lastErrorCode: null, updatedAt: now }).where(and(eq(integrationConnections.id, connectionId), eq(integrationConnections.organizationId, context.organizationId)));
    } else {
      await getDb().insert(integrationConnections).values({ id: connectionId, organizationId: context.organizationId, provider, sourceNamespace: connectionId, status: "pending", externalAccountRef: shop, externalAccountName: `New ${providerLabel} store`, domainPrefix: shop, apiVersion: SHOPIFY_API_VERSION, scopesJson: JSON.stringify(SHOPIFY_POS_READ_SCOPES), dataPromotionStatus: "blocked", connectedAt: null, lastSuccessfulSyncAt: null, lastSyncCursor: null, lastErrorCode: null, createdAt: now, updatedAt: now });
    }
    await getDb().insert(integrationOAuthStates).values({ stateHash: await shopifySha256(state), organizationId: context.organizationId, actorUserId: context.userId, provider, connectionId, expiresAt, consumedAt: null, createdAt: now });
    await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId, action: "integration.authorization_started", resourceType: "integration", resourceId: connectionId, details: { provider, shop, scopes: SHOPIFY_POS_READ_SCOPES.join(","), expiresInSeconds: 600 } });
    return jsonResponse({ authorizationUrl: buildShopifyAuthorizationUrl(shop, state, provider), expiresAt: expiresAt.toISOString(), connectionId, permissions: [...SHOPIFY_POS_READ_SCOPES], mode: "read_only_staged_sync" });
  });
}
