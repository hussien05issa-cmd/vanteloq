import { and, eq } from "drizzle-orm";
import { getD1, getDb } from "../../../../../../db";
import { integrationConnections, integrationSecrets, integrationWebhookEvents } from "../../../../../../db/schema";
import { scopeExternalRef } from "../../../../../../domain/integration-source";
import { ApiError, handleApi, jsonResponse } from "../../../../../../server/api";
import { normalizeShopDomain, SHOPIFY_POS_PROVIDER, shopifySha256, verifyShopifyWebhook } from "../../../../../../server/integrations/shopify-pos";

const MAXIMUM_WEBHOOK_BYTES = 256_000;
const PRIVACY_TOPICS = new Set(["customers/data_request", "customers/redact", "shop/redact"]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function POST(request: Request) {
  return handleApi(request, async () => {
    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAXIMUM_WEBHOOK_BYTES) throw new ApiError(413, "SHOPIFY_WEBHOOK_TOO_LARGE", "The Shopify webhook is too large.");
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > MAXIMUM_WEBHOOK_BYTES) throw new ApiError(413, "SHOPIFY_WEBHOOK_TOO_LARGE", "The Shopify webhook is too large.");
    const signature = request.headers.get("x-shopify-hmac-sha256");
    if (!await verifyShopifyWebhook(bytes, signature)) throw new ApiError(401, "SHOPIFY_WEBHOOK_SIGNATURE_INVALID", "The Shopify webhook signature is invalid.");
    const topic = (request.headers.get("x-shopify-topic") ?? "unknown").trim().toLowerCase().slice(0, 160);
    const webhookId = (request.headers.get("x-shopify-webhook-id") ?? "").trim().slice(0, 160);
    let shop: string;
    try { shop = normalizeShopDomain(request.headers.get("x-shopify-shop-domain") ?? ""); }
    catch { throw new ApiError(400, "SHOPIFY_WEBHOOK_SHOP_INVALID", "The Shopify webhook store is invalid."); }
    let payload: Record<string, unknown>;
    try { payload = record(JSON.parse(new TextDecoder().decode(bytes))); }
    catch { throw new ApiError(400, "SHOPIFY_WEBHOOK_PAYLOAD_INVALID", "The Shopify webhook payload is invalid."); }
    const connections = await getDb().select().from(integrationConnections).where(and(
      eq(integrationConnections.provider, SHOPIFY_POS_PROVIDER),
      eq(integrationConnections.domainPrefix, shop),
      eq(integrationConnections.status, "connected"),
    )).limit(2);
    if (connections.length !== 1) return jsonResponse({ received: true, queued: false }, { status: 200 });
    const connection = connections[0];
    const payloadHash = await shopifySha256(webhookId || bytes);
    const signatureHash = await shopifySha256(signature ?? "");
    const objectId = String(payload.id ?? record(payload.customer).id ?? webhookId ?? "event").slice(0, 160);
    const inserted = await getDb().insert(integrationWebhookEvents).values({
      id: crypto.randomUUID(), organizationId: connection.organizationId, provider: SHOPIFY_POS_PROVIDER,
      connectionId: connection.id, payloadHash, signatureHash, eventType: topic, externalObjectRef: objectId,
      status: "queued", receivedAt: new Date(), processedAt: null,
    }).onConflictDoNothing({ target: [integrationWebhookEvents.organizationId, integrationWebhookEvents.provider, integrationWebhookEvents.connectionId, integrationWebhookEvents.payloadHash] }).returning({ id: integrationWebhookEvents.id });

    if (inserted.length && topic === "customers/redact") {
      const rawCustomerId = String(record(payload.customer).id ?? payload.customer_id ?? payload.id ?? "").trim();
      if (rawCustomerId) {
        const customerRef = scopeExternalRef(connection.sourceNamespace, `gid://shopify/Customer/${rawCustomerId}`);
        const database = getD1();
        await database.batch([
          database.prepare("UPDATE commerce_sale_lines SET customer_ref=NULL WHERE organization_id=? AND provider=? AND connection_id=? AND customer_ref=?").bind(connection.organizationId, SHOPIFY_POS_PROVIDER, connection.id, customerRef),
          database.prepare("DELETE FROM commerce_customers WHERE organization_id=? AND provider=? AND connection_id=? AND external_customer_id=?").bind(connection.organizationId, SHOPIFY_POS_PROVIDER, connection.id, customerRef),
        ]);
      }
    }
    if (inserted.length && (topic === "shop/redact" || topic === "app/uninstalled")) {
      const database = getD1();
      await database.batch([
        database.prepare("DELETE FROM commerce_sale_lines WHERE organization_id=? AND provider=? AND connection_id=?").bind(connection.organizationId, SHOPIFY_POS_PROVIDER, connection.id),
        database.prepare("DELETE FROM commerce_payments WHERE organization_id=? AND provider=? AND connection_id=?").bind(connection.organizationId, SHOPIFY_POS_PROVIDER, connection.id),
        database.prepare("DELETE FROM commerce_customers WHERE organization_id=? AND provider=? AND connection_id=?").bind(connection.organizationId, SHOPIFY_POS_PROVIDER, connection.id),
        database.prepare("DELETE FROM commerce_products WHERE organization_id=? AND provider=? AND connection_id=?").bind(connection.organizationId, SHOPIFY_POS_PROVIDER, connection.id),
        database.prepare("DELETE FROM commerce_suppliers WHERE organization_id=? AND provider=? AND connection_id=?").bind(connection.organizationId, SHOPIFY_POS_PROVIDER, connection.id),
        database.prepare("DELETE FROM inventory_balances WHERE organization_id=? AND source_connection_id=?").bind(connection.organizationId, connection.id),
        database.prepare("DELETE FROM daily_business_metrics WHERE organization_id=? AND source_connection_id=?").bind(connection.organizationId, connection.id),
        database.prepare("DELETE FROM integration_staged_sales WHERE organization_id=? AND provider=? AND connection_id=?").bind(connection.organizationId, SHOPIFY_POS_PROVIDER, connection.id),
      ]);
      await getDb().delete(integrationSecrets).where(and(eq(integrationSecrets.organizationId, connection.organizationId), eq(integrationSecrets.connectionId, connection.id)));
      await getDb().update(integrationConnections).set({ status: "revoked", dataPromotionStatus: "blocked", privacyDataDeletedAt: new Date(), externalAccountRef: null, domainPrefix: null, updatedAt: new Date() }).where(and(eq(integrationConnections.id, connection.id), eq(integrationConnections.organizationId, connection.organizationId)));
    }
    if (inserted.length) await getDb().update(integrationWebhookEvents).set({ status: PRIVACY_TOPICS.has(topic) || topic === "app/uninstalled" ? "processed" : "queued", processedAt: PRIVACY_TOPICS.has(topic) || topic === "app/uninstalled" ? new Date() : null }).where(eq(integrationWebhookEvents.id, inserted[0].id));
    return jsonResponse({ received: true, queued: Boolean(inserted.length) && !PRIVACY_TOPICS.has(topic), duplicate: !inserted.length }, { status: 200 });
  });
}
