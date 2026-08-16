import { and, eq, inArray } from "drizzle-orm";
import { getD1, getDb } from "../../../../../../db";
import { integrationConnections, integrationSecrets, integrationWebhookEvents } from "../../../../../../db/schema";
import { scopeExternalRef } from "../../../../../../domain/integration-source";
import { ApiError, handleApi, jsonResponse } from "../../../../../../server/api";
import { normalizeShopDomain, shopifyProviderFromRequest, shopifySha256, verifyShopifyWebhook } from "../../../../../../server/integrations/shopify-pos";

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
    const bytes = new Uint8Array(await request.arrayBuffer());
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
    const connections = await getDb().select().from(integrationConnections).where(and(
      terminalTopic
        ? inArray(integrationConnections.provider, ["shopify", "shopify-pos"])
        : eq(integrationConnections.provider, provider),
      eq(integrationConnections.domainPrefix, shop),
      eq(integrationConnections.status, "connected"),
    )).limit(10);
    if (!connections.length) return jsonResponse({ received: true, queued: false }, { status: 200 });
    const payloadHash = await shopifySha256(webhookId || bytes);
    const signatureHash = await shopifySha256(signature ?? "");
    const objectId = String(payload.id ?? record(payload.customer).id ?? webhookId ?? "event").slice(0, 160);
    let insertedCount = 0;
    for (const connection of connections) {
      const connectionProvider = connection.provider === "shopify-pos" ? "shopify-pos" : "shopify";
      const inserted = await getDb().insert(integrationWebhookEvents).values({
        id: crypto.randomUUID(), organizationId: connection.organizationId, provider: connectionProvider,
        connectionId: connection.id, payloadHash, signatureHash, eventType: topic, externalObjectRef: objectId,
        status: "queued", receivedAt: new Date(), processedAt: null,
      }).onConflictDoNothing({ target: [integrationWebhookEvents.organizationId, integrationWebhookEvents.provider, integrationWebhookEvents.connectionId, integrationWebhookEvents.payloadHash] }).returning({ id: integrationWebhookEvents.id });
      insertedCount += inserted.length;

      if (inserted.length && topic === "customers/redact") {
        const rawCustomerId = String(record(payload.customer).id ?? payload.customer_id ?? payload.id ?? "").trim();
        if (rawCustomerId) {
          const customerRef = scopeExternalRef(connection.sourceNamespace, `gid://shopify/Customer/${rawCustomerId}`);
          const database = getD1();
          await database.batch([
            database.prepare("UPDATE commerce_sale_lines SET customer_ref=NULL WHERE organization_id=? AND provider=? AND connection_id=? AND customer_ref=?").bind(connection.organizationId, connectionProvider, connection.id, customerRef),
            database.prepare("DELETE FROM commerce_customers WHERE organization_id=? AND provider=? AND connection_id=? AND external_customer_id=?").bind(connection.organizationId, connectionProvider, connection.id, customerRef),
          ]);
        }
      }
      if (inserted.length && (topic === "shop/redact" || topic === "app/uninstalled")) {
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
      }
      if (inserted.length) await getDb().update(integrationWebhookEvents).set({ status: terminalTopic ? "processed" : "queued", processedAt: terminalTopic ? new Date() : null }).where(eq(integrationWebhookEvents.id, inserted[0].id));
    }
    return jsonResponse({ received: true, queued: insertedCount > 0 && !terminalTopic, duplicate: insertedCount === 0 }, { status: 200 });
  });
}
