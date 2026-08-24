import { getD1 } from "../../db";
import { ApiError } from "../api";

export async function claimShopifyStore(organizationId: string, shopDomain: string) {
  const database = getD1();
  const now = Date.now();
  await database.prepare(`INSERT INTO shopify_store_locks
    (shop_domain, organization_id, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(shop_domain) DO NOTHING`)
    .bind(shopDomain, organizationId, now, now)
    .run();
  const owner = await database.prepare(`SELECT organization_id organizationId
    FROM shopify_store_locks WHERE shop_domain = ?`)
    .bind(shopDomain)
    .first<{ organizationId: string }>();
  if (!owner || owner.organizationId !== organizationId) {
    throw new ApiError(409, "SHOPIFY_STORE_ALREADY_CONNECTED", "This Shopify store is already connected to another Vanteloq workspace.");
  }
}

export async function releaseShopifyStoreIfUnused(organizationId: string, shopDomain: string | null) {
  if (!shopDomain) return;
  await getD1().prepare(`DELETE FROM shopify_store_locks
    WHERE shop_domain = ? AND organization_id = ?
      AND NOT EXISTS (
        SELECT 1 FROM integration_connections
        WHERE organization_id = ? AND provider IN ('shopify', 'shopify-pos')
          AND domain_prefix = ? AND status IN ('pending', 'connected')
      )`)
    .bind(shopDomain, organizationId, organizationId, shopDomain)
    .run();
}
