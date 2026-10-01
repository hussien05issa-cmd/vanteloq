import { ApiError } from "../api";
import { scopeExternalRef } from "../../domain/integration-source";
import { decryptIntegrationSecret, encryptIntegrationSecret } from "./lightspeed";
import { normalizeShopDomain, shopifySha256 } from "./shopify-pos";

type Row = Record<string, unknown>;
export type ShopifyPrivacyConnection = { id: string; organizationId: string; provider: string; sourceNamespace: string };
export type ShopifyPrivacyScope = { version: 1; shop: string; requestId: string; customerId: string | null; email: string | null; orderIds: string[] };
type PrivacyRequest = { id: string; organization_id: string; connection_id: string; provider: string; request_ciphertext: string; status: string; received_at: number; due_at: number; last_exported_at: number | null; last_export_complete: number; last_export_count: number | null };
const MAX_EXPORT_RECORDS = 1_000;
const record = (v: unknown): Row => v && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
function identifier(v: unknown): string | null {
  if (typeof v === "number" && (!Number.isSafeInteger(v) || v <= 0)) return null;
  const value = typeof v === "string" || typeof v === "number" ? String(v) : "";
  return /^[1-9]\d{0,31}$/.test(value) ? value : null;
}

export function privacyShop(payload: Row, topic: string, headerShop: string) {
  const value = topic === "app/uninstalled" ? payload.myshopify_domain : payload.shop_domain;
  if (typeof value !== "string" || normalizeShopDomain(value) !== headerShop) {
    throw new ApiError(400, "SHOPIFY_PRIVACY_SHOP_MISMATCH", "The signed Shopify privacy payload does not match its store.");
  }
  if ((topic === "shop/redact" && ["customer", "data_request", "orders_requested", "orders_to_redact"].some(key => key in payload))
    || (topic === "customers/redact" && (!Array.isArray(payload.orders_to_redact) || "data_request" in payload || "orders_requested" in payload))) {
    throw new ApiError(400, "SHOPIFY_PRIVACY_TOPIC_MISMATCH", "The signed privacy payload does not match this webhook topic.");
  }
}

export function parseShopifyPrivacyScope(payload: Row, shop: string): ShopifyPrivacyScope {
  const requestId = identifier(record(payload.data_request).id);
  const customer = record(payload.customer), customerId = identifier(customer.id);
  const email = typeof customer.email === "string" && customer.email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email) ? customer.email : null;
  if (!requestId || (!customerId && !email) || !Array.isArray(payload.orders_requested) || payload.orders_requested.length > 10_000) {
    throw new ApiError(400, "SHOPIFY_PRIVACY_SCOPE_INVALID", "Shopify returned an incomplete privacy request.");
  }
  const orderIds = payload.orders_requested.map(identifier);
  if (orderIds.some(id => id === null)) throw new ApiError(400, "SHOPIFY_PRIVACY_SCOPE_INVALID", "Shopify returned an invalid requested order identifier.");
  return { version: 1, shop, requestId, customerId, email, orderIds: [...new Set(orderIds as string[])] };
}

export async function redactShopifyCustomer(database: D1Database, connection: ShopifyPrivacyConnection, payload: Row) {
  const customer = record(payload.customer), customerId = identifier(customer.id);
  const email = typeof customer.email === "string" && customer.email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email) ? customer.email : null;
  const orderIds = Array.isArray(payload.orders_to_redact) ? payload.orders_to_redact.map(identifier) : [];
  if (orderIds.length > 10_000 || orderIds.some(id => id === null) || (!customerId && !email && !orderIds.length)) {
    throw new ApiError(400, "SHOPIFY_PRIVACY_SCOPE_INVALID", "Shopify returned an incomplete customer redaction scope.");
  }
  const customerRef = customerId ? scopeExternalRef(connection.sourceNamespace, `gid://shopify/Customer/${customerId}`) : null;
  const bindings = [connection.organizationId, connection.provider, connection.id];
  const matching = await database.prepare(`SELECT external_customer_id FROM commerce_customers WHERE organization_id=? AND provider=? AND connection_id=?
    AND (external_customer_id=? OR (? IS NOT NULL AND lower(email)=lower(?)))`).bind(...bindings, customerRef, email, email).all<{ external_customer_id: string }>();
  const refs = JSON.stringify([...new Set([customerRef, ...(matching.results ?? []).map(c => c.external_customer_id)].filter(Boolean))]);
  const orders = JSON.stringify(orderIds.map(id => scopeExternalRef(connection.sourceNamespace, `gid://shopify/Order/${id}`)));
  await database.batch([
    database.prepare(`UPDATE commerce_sale_lines SET customer_ref=NULL WHERE organization_id=? AND provider=? AND connection_id=?
      AND (customer_ref IN (SELECT value FROM json_each(?)) OR external_sale_id IN (SELECT value FROM json_each(?)))`).bind(...bindings, refs, orders),
    database.prepare("DELETE FROM commerce_customers WHERE organization_id=? AND provider=? AND connection_id=? AND external_customer_id IN (SELECT value FROM json_each(?))").bind(...bindings, refs),
  ]);
}

/** No names, customer identifiers or orders enter the staff-visible task/notification. */
export async function queueShopifyPrivacyRequest(database: D1Database, connection: ShopifyPrivacyConnection, scope: ShopifyPrivacyScope) {
  const requestHash = await shopifySha256(`${scope.shop}:${scope.requestId}`), now = Math.floor(Date.now() / 1000);
  const owner = await database.prepare(`SELECT m.user_id FROM memberships m JOIN users u ON u.id=m.user_id
    WHERE m.organization_id=? AND m.status='active' AND u.status='active' AND m.role IN ('owner','admin')
    ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END,m.user_id LIMIT 1`).bind(connection.organizationId).first<{ user_id: string }>();
  if (!owner) throw new ApiError(503, "SHOPIFY_PRIVACY_OWNER_UNAVAILABLE", "A workspace privacy administrator is required before this request can be acknowledged.");
  const id = crypto.randomUUID(), due = now + 30 * 86_400, ciphertext = await encryptIntegrationSecret(JSON.stringify(scope));
  await database.batch([
    database.prepare(`INSERT OR IGNORE INTO shopify_privacy_requests(id,organization_id,connection_id,provider,request_hash,request_ciphertext,received_at,due_at)
      VALUES(?,?,?,?,?,?,?,?)`).bind(id, connection.organizationId, connection.id, connection.provider, requestHash, ciphertext, now, due),
    database.prepare(`INSERT OR IGNORE INTO workspace_tasks(organization_id,title,detail,priority,status,assignee,due_date,source_type,source_ref,expected_impact,created_by_user_id,idempotency_key,created_at,updated_at)
      SELECT organization_id,'Respond to Shopify privacy request',
        'An authorized owner or administrator must open Integrations > Shopify privacy requests. Review the requested scope and customer export, verify the recipient, deliver the response through a secure channel, then record completion there. A download or this task alone does not fulfil the request.',
        'high','open','Owner',date(due_at,'unixepoch'),'alert','shopify-privacy:'||id,'Customer privacy response required',?,'shopify-privacy:'||id,?,?
      FROM shopify_privacy_requests WHERE organization_id=? AND connection_id=? AND request_hash=? AND status='pending'`)
      .bind(owner.user_id, now, now, connection.organizationId, connection.id, requestHash),
    database.prepare(`INSERT OR IGNORE INTO account_notifications(id,user_id,organization_id,notification_type,title,message,delivery_status,created_at)
      SELECT 'shopify-privacy:'||id,?,organization_id,'privacy_request','Shopify privacy response needed',
        'Open Integrations > Shopify privacy requests. Review and securely fulfil the request before its due date. No customer response has been sent.','in_app',?
      FROM shopify_privacy_requests WHERE organization_id=? AND connection_id=? AND request_hash=? AND status='pending'`)
      .bind(owner.user_id, now, connection.organizationId, connection.id, requestHash),
  ]);
  return (await database.prepare("SELECT id,status FROM shopify_privacy_requests WHERE organization_id=? AND connection_id=? AND request_hash=?")
    .bind(connection.organizationId, connection.id, requestHash).first<{ id: string; status: string }>())!;
}

export async function findShopifyPrivacyConnections(database: D1Database, shop: string) {
  // Prior releases erased domain_prefix on local disconnect. Recover only a
  // successful, tenant-and-connection-bound authorization audit, never a pending grant.
  const result = await database.prepare(`SELECT c.id,c.organization_id organizationId,c.provider,c.source_namespace sourceNamespace
    FROM integration_connections c WHERE c.provider IN ('shopify','shopify-pos') AND
    (c.domain_prefix=? AND (c.status='connected' OR c.connected_at IS NOT NULL) OR EXISTS (
      SELECT 1 FROM audit_events a WHERE a.organization_id=c.organization_id AND a.resource_id=c.id
      AND a.action='integration.connected' AND a.outcome='success'
      AND json_extract(CASE WHEN json_valid(a.details_json) THEN a.details_json ELSE '{}' END,'$.shop')=?)) ORDER BY c.id LIMIT 101`).bind(shop, shop).all<ShopifyPrivacyConnection>();
  if ((result.results?.length ?? 0) > 100) throw new ApiError(503, "SHOPIFY_PRIVACY_SCOPE_TOO_LARGE", "This store requires operator review before acknowledging its privacy request.");
  return result.results ?? [];
}

export async function listShopifyPrivacyRequests(database: D1Database, organizationId: string) {
  const rows = await database.prepare(`SELECT id,provider,status,received_at receivedAt,due_at dueAt,
    last_exported_at lastExportedAt,last_export_complete lastExportComplete,completed_at completedAt,completion_method completionMethod
    FROM shopify_privacy_requests WHERE organization_id=? ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END,due_at,id LIMIT 101`)
    .bind(organizationId).all();
  return { requests: (rows.results ?? []).slice(0, 100), hasMore: (rows.results?.length ?? 0) > 100 };
}

async function ownedRequest(database: D1Database, organizationId: string, id: string) {
  const request = await database.prepare("SELECT * FROM shopify_privacy_requests WHERE organization_id=? AND id=?").bind(organizationId, id).first<PrivacyRequest>();
  if (!request) throw new ApiError(404, "SHOPIFY_PRIVACY_NOT_FOUND", "The privacy request was not found.");
  return request;
}

/** Bounded local customer export. It never calls Shopify or sends a customer message. */
export async function exportShopifyPrivacyRequest(database: D1Database, organizationId: string, id: string) {
  const request = await ownedRequest(database, organizationId, id);
  if (request.status !== "pending") throw new ApiError(409, "SHOPIFY_PRIVACY_COMPLETED", "This request was completed and its identifying scope was erased.");
  const scope = JSON.parse(await decryptIntegrationSecret(request.request_ciphertext)) as ShopifyPrivacyScope;
  const connection = await database.prepare("SELECT source_namespace FROM integration_connections WHERE organization_id=? AND id=? AND provider=?")
    .bind(organizationId, request.connection_id, request.provider).first<{ source_namespace: string }>();
  if (!connection) throw new ApiError(409, "SHOPIFY_PRIVACY_SOURCE_MISSING", "The request's source could not be verified.");
  const customerRef = scope.customerId ? scopeExternalRef(connection.source_namespace, `gid://shopify/Customer/${scope.customerId}`) : null;
  const orderRefs = scope.orderIds.map(order => scopeExternalRef(connection.source_namespace, `gid://shopify/Order/${order}`)!);
  const bindings = [organizationId, request.provider, request.connection_id];
  const customers = await database.prepare(`SELECT external_customer_id,display_name,first_name,last_name,email,phone,archived,source_updated_at
    FROM commerce_customers WHERE organization_id=? AND provider=? AND connection_id=?
      AND (external_customer_id=? OR (? IS NOT NULL AND lower(email)=lower(?))) LIMIT 1001`)
    .bind(...bindings, customerRef, scope.email, scope.email).all<Row>();
  const customerRefs = [...new Set([customerRef, ...(customers.results ?? []).map(c => String(c.external_customer_id))].filter(Boolean))];
  // json_each uses one bound value, avoiding the database's SQL parameter limit.
  const saleCondition = "(customer_ref IN (SELECT value FROM json_each(?)) OR external_sale_id IN (SELECT value FROM json_each(?)))";
  const lines = await database.prepare(`SELECT external_sale_id,external_line_id,customer_ref,product_name,sku,quantity_milli,net_sales_cents,discount_cents,sold_at
    FROM commerce_sale_lines WHERE organization_id=? AND provider=? AND connection_id=? AND ${saleCondition} ORDER BY external_sale_id,external_line_id LIMIT 1001`)
    .bind(...bindings, JSON.stringify(customerRefs), JSON.stringify(orderRefs)).all<Row>();
  const allOrderRefs = [...new Set([...orderRefs, ...(lines.results ?? []).map(l => String(l.external_sale_id))])];
  const payments = await database.prepare(`SELECT external_sale_id,external_payment_id,payment_type_name,category,amount_cents,paid_at
    FROM commerce_payments WHERE organization_id=? AND provider=? AND connection_id=?
      AND external_sale_id IN (SELECT value FROM json_each(?)) ORDER BY external_payment_id LIMIT 1001`)
    .bind(...bindings, JSON.stringify(allOrderRefs)).all<Row>();
  const stagedOrders = await database.prepare(`SELECT external_sale_id,outlet_ref,sold_at,total_cents,discount_cents,line_count
    FROM integration_staged_sales WHERE organization_id=? AND provider=? AND connection_id=?
      AND external_sale_id IN (SELECT value FROM json_each(?)) ORDER BY external_sale_id,staged_at LIMIT 1001`)
    .bind(...bindings, JSON.stringify(allOrderRefs)).all<Row>();
  const groups = { customers: customers.results ?? [], saleLines: lines.results ?? [], payments: payments.results ?? [], stagedOrders: stagedOrders.results ?? [] };
  const boundedComplete = Object.values(groups).every(rows => rows.length <= MAX_EXPORT_RECORDS);
  const recordCount = Object.values(groups).reduce((count, rows) => count + rows.length, 0);
  const complete = boundedComplete && JSON.stringify(groups).length <= 2_000_000;
  await database.prepare(`UPDATE shopify_privacy_requests SET last_exported_at=?,last_export_complete=?,last_export_count=?
    WHERE organization_id=? AND id=? AND status='pending'`).bind(Math.floor(Date.now() / 1000), complete ? 1 : 0, recordCount, organizationId, id).run();
  if (!complete) throw new ApiError(409, "SHOPIFY_PRIVACY_EXPORT_REQUIRES_REVIEW", "This request exceeds the safe export limit. The request remains pending. Contact the privacy operator for a scoped export before recording completion.");
  return { requestId: id, provider: request.provider, requestedScope: scope, records: groups, complete: true,
    limitation: "Local imported Shopify customer, sale-line and payment records only. Review separate documents, communications, user uploads and any other retained systems before confirming fulfilment. Verify the recipient and send securely; Vanteloq has not transmitted this export." };
}

export async function completeShopifyPrivacyRequest(database: D1Database, input: { organizationId: string; userId: string; id: string; method: string; reference: string; confirmed: boolean }) {
  const request = await ownedRequest(database, input.organizationId, input.id);
  if (request.status === "completed") return { completed: true, duplicate: true };
  if (input.confirmed !== true || !["secure_delivery", "no_retained_data"].includes(input.method)
    || !input.reference.trim() || input.reference.length > 120 || /[\u0000-\u001f\u007f]/.test(input.reference)) {
    throw new ApiError(400, "SHOPIFY_PRIVACY_CONFIRMATION_REQUIRED", "Confirm the authorized response and enter a non-personal delivery or review reference.");
  }
  if (!request.last_exported_at || request.last_export_complete !== 1 || (input.method === "no_retained_data" && request.last_export_count !== 0)) {
    throw new ApiError(409, "SHOPIFY_PRIVACY_EXPORT_REQUIRED", "Review a complete customer export before confirming the response. A no-data response requires an empty export and review of other retained systems.");
  }
  const now = Math.floor(Date.now() / 1000);
  await database.batch([
    database.prepare(`UPDATE shopify_privacy_requests SET status='completed',request_ciphertext='',completed_at=?,completed_by_user_id=?,completion_method=?,completion_reference_hash=?
      WHERE organization_id=? AND id=? AND status='pending'`).bind(now, input.userId, input.method, await shopifySha256(input.reference.trim()), input.organizationId, input.id),
    database.prepare("UPDATE workspace_tasks SET status='done',updated_at=? WHERE organization_id=? AND source_ref=?")
      .bind(now, input.organizationId, `shopify-privacy:${input.id}`),
    database.prepare("UPDATE integration_webhook_events SET status='processed',processed_at=? WHERE organization_id=? AND connection_id=? AND event_type='customers/data_request' AND external_object_ref=?")
      .bind(now, input.organizationId, request.connection_id, input.id),
  ]);
  return { completed: true, duplicate: false };
}
