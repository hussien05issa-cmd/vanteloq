import { and, eq } from "drizzle-orm";
import { getD1, getDb } from "../../../../../../db";
import { integrationConnections, integrationSecrets, integrationWebhookEvents } from "../../../../../../db/schema";
import { ApiError, handleApi, jsonResponse, readRequestBytes } from "../../../../../../server/api";
import { normalizeShopDomain, shopifyProviderFromRequest, shopifySha256, verifyShopifyWebhook } from "../../../../../../server/integrations/shopify-pos";
import { releaseShopifyStoreIfUnused } from "../../../../../../server/integrations/shopify-store-lock";
import { findShopifyPrivacyConnections, parseShopifyPrivacyScope, privacyShop, queueShopifyPrivacyRequest, redactShopifyCustomer } from "../../../../../../server/integrations/shopify-privacy";

const MAXIMUM_WEBHOOK_BYTES = 256_000;
const PRIVACY_TOPICS = new Set(["customers/data_request", "customers/redact", "shop/redact"]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function POST(request: Request) {
  return handleApi(request, async () => {
    const provider = shopifyProviderFromRequest(request);
    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAXIMUM_WEBHOOK_BYTES) throw new ApiError(413, "SHOPIFY_WEBHOOK_TOO_LARGE", "The Shopify webhook is too large.");
    const bytes = await readRequestBytes(request, MAXIMUM_WEBHOOK_BYTES, "SHOPIFY_WEBHOOK_TOO_LARGE", "The Shopify webhook is too large.");
    if (bytes.byteLength > MAXIMUM_WEBHOOK_BYTES) throw new ApiError(413, "SHOPIFY_WEBHOOK_TOO_LARGE", "The Shopify webhook is too large.");
    const signature = request.headers.get("x-shopify-hmac-sha256");
    if (!await verifyShopifyWebhook(bytes, signature, provider)) throw new ApiError(401, "SHOPIFY_WEBHOOK_SIGNATURE_INVALID", "The Shopify webhook signature is invalid.");
    const topic = (request.headers.get("x-shopify-topic") ?? "unknown").trim().toLowerCase().slice(0, 160);
    const webhookId = (request.headers.get("x-shopify-webhook-id") ?? "").trim().slice(0, 160);
    let shop: string;
    try { shop = normalizeShopDomain(request.headers.get("x-shopify-shop-domain") ?? ""); }
    catch { throw new ApiError(400, "SHOPIFY_WEBHOOK_SHOP_INVALID", "The Shopify webhook store is invalid."); }
    let payload: Record<string, unknown>;
    try { payload = record(JSON.parse(new TextDecoder().decode(bytes))); }
    catch { throw new ApiError(400, "SHOPIFY_WEBHOOK_PAYLOAD_INVALID", "The Shopify webhook payload is invalid."); }
    const terminalTopic = PRIVACY_TOPICS.has(topic) || topic === "app/uninstalled";
    if (terminalTopic) privacyShop(payload, topic, shop);
    const dataRequest = topic === "customers/data_request" ? parseShopifyPrivacyScope(payload, shop) : null;
    const connections = terminalTopic ? await findShopifyPrivacyConnections(getD1(), shop) : await getDb().select().from(integrationConnections).where(and(
      eq(integrationConnections.provider, provider),
      eq(integrationConnections.domainPrefix, shop),
      eq(integrationConnections.status, "connected"),
    )).limit(10);
    if (!connections.length) return jsonResponse({ received: true, queued: false }, { status: 200 });
    const payloadHash = await shopifySha256(terminalTopic ? `${topic}:${new TextDecoder().decode(bytes)}` : webhookId || bytes);
    const signatureHash = await shopifySha256(signature ?? "");
    const objectId = terminalTopic ? null : String(payload.id ?? webhookId ?? "event").slice(0, 160);
    let insertedCount = 0;
    let pendingRequests = 0;
    for (const connection of connections) {
      const connectionProvider = connection.provider === "shopify-pos" ? "shopify-pos" : "shopify";
      const inserted = await getDb().insert(integrationWebhookEvents).values({
        id: crypto.randomUUID(), organizationId: connection.organizationId, provider: connectionProvider,
        connectionId: connection.id, payloadHash, signatureHash, eventType: topic, externalObjectRef: objectId,
        status: "queued", receivedAt: new Date(), processedAt: null,
      }).onConflictDoNothing({ target: [integrationWebhookEvents.organizationId, integrationWebhookEvents.provider, integrationWebhookEvents.connectionId, integrationWebhookEvents.payloadHash] }).returning({ id: integrationWebhookEvents.id });
      insertedCount += inserted.length;

      if (dataRequest) {
        // Retry queue creation even if an earlier receipt was persisted before a
        // database failure. A receipt alone is not a completed privacy response.
        const queued = await queueShopifyPrivacyRequest(getD1(), connection, dataRequest);
        pendingRequests += queued.status === "pending" ? 1 : 0;
        await getD1().prepare(`UPDATE integration_webhook_events SET external_object_ref=?,
          status=CASE WHEN EXISTS(SELECT 1 FROM shopify_privacy_requests WHERE id=? AND status='completed') THEN 'processed' ELSE 'queued' END,
          processed_at=(SELECT completed_at FROM shopify_privacy_requests WHERE id=?)
          WHERE organization_id=? AND connection_id=? AND payload_hash=? AND event_type='customers/data_request'`)
          .bind(queued.id, queued.id, queued.id, connection.organizationId, connection.id, payloadHash).run();
        continue;
      }
      const receipt = inserted.length ? { id: inserted[0].id, status: "queued" } : (await getDb().select({ id: integrationWebhookEvents.id, status: integrationWebhookEvents.status }).from(integrationWebhookEvents)
        .where(and(eq(integrationWebhookEvents.organizationId, connection.organizationId), eq(integrationWebhookEvents.connectionId, connection.id), eq(integrationWebhookEvents.payloadHash, payloadHash))).limit(1))[0];
      if (!receipt || receipt.status === "processed") continue;

      if (topic === "customers/redact") {
        await redactShopifyCustomer(getD1(), connection, payload);
      }
      if (topic === "shop/redact" || topic === "app/uninstalled") {
        const database = getD1();
        await database.batch([
          database.prepare("DELETE FROM commerce_sale_lines WHERE organization_id=? AND provider=? AND connection_id=?").bind(connection.organizationId, connectionProvider, connection.id),
          database.prepare("DELETE FROM commerce_payments WHERE organization_id=? AND provider=? AND connection_id=?").bind(connection.organizationId, connectionProvider, connection.id),
          database.prepare("DELETE FROM commerce_customers WHERE organization_id=? AND provider=? AND connection_id=?").bind(connection.organizationId, connectionProvider, connection.id),
          database.prepare("DELETE FROM commerce_products WHERE organization_id=? AND provider=? AND connection_id=?").bind(connection.organizationId, connectionProvider, connection.id),
          database.prepare("DELETE FROM commerce_suppliers WHERE organization_id=? AND provider=? AND connection_id=?").bind(connection.organizationId, connectionProvider, connection.id),
          database.prepare("DELETE FROM inventory_balances WHERE organization_id=? AND source_connection_id=?").bind(connection.organizationId, connection.id),
          database.prepare("DELETE FROM daily_business_metrics WHERE organization_id=? AND source_connection_id=?").bind(connection.organizationId, connection.id),
          database.prepare("DELETE FROM integration_staged_sales WHERE organization_id=? AND provider=? AND connection_id=?").bind(connection.organizationId, connectionProvider, connection.id),
        ]);
        await getDb().delete(integrationSecrets).where(and(eq(integrationSecrets.organizationId, connection.organizationId), eq(integrationSecrets.connectionId, connection.id)));
        await getDb().update(integrationConnections).set({ status: "revoked", dataPromotionStatus: "blocked", privacyDataDeletedAt: new Date(), externalAccountRef: null, domainPrefix: null, updatedAt: new Date() }).where(and(eq(integrationConnections.id, connection.id), eq(integrationConnections.organizationId, connection.organizationId)));
        await releaseShopifyStoreIfUnused(connection.organizationId, shop);
      }
      await getDb().update(integrationWebhookEvents).set({ status: terminalTopic ? "processed" : "queued", processedAt: terminalTopic ? new Date() : null }).where(eq(integrationWebhookEvents.id, receipt.id));
    }
    return jsonResponse({ received: true, queued: pendingRequests > 0 || (insertedCount > 0 && !terminalTopic), duplicate: insertedCount === 0 }, { status: 200 });
  });
}
