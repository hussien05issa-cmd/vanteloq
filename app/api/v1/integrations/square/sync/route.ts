import { and, eq } from "drizzle-orm";
import { getD1, getDb } from "../../../../../../db";
import { integrationConnections, integrationLocationMappings, integrationSyncRuns } from "../../../../../../db/schema";
import { scopeExternalRef, unscopedExternalRef } from "../../../../../../domain/integration-source";
import { recordAudit } from "../../../../../../server/audit";
import { requireAccess } from "../../../../../../server/authorization";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, requireSameOrigin } from "../../../../../../server/api";
import { record, records, SQUARE_PROVIDER, squareRequest, squareSha256 } from "../../../../../../server/integrations/square";
import { acquireIntegrationSyncLease, releaseIntegrationSyncLease, requireOwnedIntegrationConnection, sqliteTimestampSeconds } from "../../../../../../server/integrations/connection";
import { requirePermission } from "../../../../../../server/permissions";

const PAGE_SIZE = 100;
const IMPORT_LABEL = "Square read-only sync";
type Cursor = { orders?: string; catalog?: string; customers?: string; payments?: string; watermark?: string };
type Sale = { id: string; version: string; location: string; soldAt: string; total: number; tax: number; discount: number; lineCount: number; hash: string; customer: string | null; lines: Line[] };
type Line = { id: string; saleId: string; product: string | null; customer: string | null; location: string; soldAt: string; sku: string | null; name: string | null; quantity: number; net: number; discount: number; hash: string };

function text(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function integer(value: unknown) { const number = Number(value); return Number.isFinite(number) ? Math.round(number) : 0; }
function money(value: unknown) { return integer(record(value).amount); }
function parseCursor(value: string | null): Cursor { try { return value ? record(JSON.parse(value)) as Cursor : {}; } catch { return {}; } }
function timestamp(value: unknown) { const valueText = text(value); if (!valueText) return null; const parsed = new Date(valueText); return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString(); }
async function hash(value: unknown) { return squareSha256(JSON.stringify(value)); }
async function batches(statements: D1PreparedStatement[]) {
  let changed = 0;
  for (let index = 0; index < statements.length; index += 75) {
    const result = await getD1().batch(statements.slice(index, index + 75));
    changed += result.reduce((sum, row) => sum + Number(row.meta.changes ?? 0), 0);
  }
  return changed;
}
function paymentCategory(payment: Record<string, unknown>) {
  if (Object.keys(record(payment.cash_details)).length) return "cash" as const;
  if (Object.keys(record(payment.card_details)).length) return "card" as const;
  if (Object.keys(record(payment.gift_card_details)).length) return "gift_card" as const;
  return "other" as const;
}

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, ["owner", "admin"]);
    await requirePermission(context, "integrations.manage");
    const input = await request.json().catch(() => ({})) as { reason?: unknown; connectionId?: unknown };
    const reason = input.reason === "manual" ? "manual" : "auto";
    const connection = await requireOwnedIntegrationConnection(context.organizationId, SQUARE_PROVIDER, typeof input.connectionId === "string" ? input.connectionId : null, { connected: true });
    if (reason === "auto") return jsonResponse({ provider: SQUARE_PROVIDER, connectionId: connection.id, skipped: true, nextStep: "Square refreshes remain owner-initiated until the durable schedule is enabled." });
    const lease = await acquireIntegrationSyncLease(context.organizationId, SQUARE_PROVIDER, connection.id);
    if (!lease) return jsonResponse({ provider: SQUARE_PROVIDER, connectionId: connection.id, coalesced: true, nextStep: "This Square seller is already synchronizing." });
    const startedAt = new Date();
    const runId = `square-${crypto.randomUUID()}`;
    const importId = `provider-square-${runId}`;
    const previous = parseCursor(connection.lastSyncCursor);
    try {
      await enforceRateLimit("square:manual-sync", context.organizationId, 30, 3600);
      await getD1().prepare(`INSERT INTO integration_sync_runs (id, organization_id, provider, connection_id, mode, status, cursor_before, records_read, records_staged, duplicates_skipped, warning_count, started_at, created_by_user_id) VALUES (?, ?, ?, ?, 'incremental', 'running', ?, 0, 0, 0, 0, ?, ?)`)
        .bind(runId, context.organizationId, SQUARE_PROVIDER, connection.id, connection.lastSyncCursor, sqliteTimestampSeconds(startedAt.getTime()), context.userId).run();
      const mappings = await getDb().select().from(integrationLocationMappings).where(and(eq(integrationLocationMappings.organizationId, context.organizationId), eq(integrationLocationMappings.provider, SQUARE_PROVIDER), eq(integrationLocationMappings.connectionId, connection.id)));
      const mappedLocations = mappings.filter((mapping) => mapping.status === "mapped").map((mapping) => mapping.externalLocationRef);
      const unmapped = mappings.filter((mapping) => mapping.status === "unmapped").length;
      if (!mappings.length) throw new ApiError(409, "SQUARE_LOCATIONS_REQUIRED", "Refresh and map the Square seller locations before synchronizing.");

      const startAt = previous.watermark ?? new Date(Date.now() - 2 * 365 * 24 * 60 * 60_000).toISOString();
      const [catalogBody, customerBody, orderBody, paymentBody] = await Promise.all([
        squareRequest(context.organizationId, connection.id, "/v2/catalog/search", { method: "POST", body: { object_types: ["ITEM", "ITEM_VARIATION"], include_deleted_objects: true, limit: PAGE_SIZE, cursor: previous.catalog || undefined } }),
        squareRequest(context.organizationId, connection.id, "/v2/customers/search", { method: "POST", body: { limit: PAGE_SIZE, cursor: previous.customers || undefined, query: { sort: { field: "UPDATED_AT", order: "ASC" } } } }),
        squareRequest(context.organizationId, connection.id, "/v2/orders/search", { method: "POST", body: { location_ids: mappedLocations.length ? mappedLocations : mappings.map((mapping) => mapping.externalLocationRef), cursor: previous.orders || undefined, limit: PAGE_SIZE, query: { filter: { state_filter: { states: ["COMPLETED"] }, date_time_filter: { created_at: { start_at: startAt } } }, sort: { sort_field: "CREATED_AT", sort_order: "ASC" } } } }),
        squareRequest(context.organizationId, connection.id, `/v2/payments?begin_time=${encodeURIComponent(startAt)}&limit=${PAGE_SIZE}${previous.payments ? `&cursor=${encodeURIComponent(previous.payments)}` : ""}`),
      ]);

      const catalog = records(catalogBody.objects);
      const itemNames = new Map<string, string>();
      for (const object of catalog.filter((row) => row.type === "ITEM")) itemNames.set(String(object.id), text(record(object.item_data).name) ?? "Square item");
      const products = await Promise.all(catalog.filter((row) => row.type === "ITEM_VARIATION").map(async (variation) => {
        const data = record(variation.item_variation_data);
        const id = String(variation.id);
        return { id, sku: text(data.sku) ?? id, name: text(data.name) ?? itemNames.get(String(data.item_id)) ?? "Square item", category: null, price: money(data.price_money) || null, archived: Boolean(variation.is_deleted), updatedAt: timestamp(variation.updated_at), hash: await hash(variation) };
      }));
      const customers = await Promise.all(records(customerBody.customers).map(async (customer) => {
        const given = text(customer.given_name); const family = text(customer.family_name); const company = text(customer.company_name);
        return { id: String(customer.id), display: company ?? ([given, family].filter(Boolean).join(" ") || "Square customer"), given, family, email: text(customer.email_address), phone: text(customer.phone_number), updatedAt: timestamp(customer.updated_at), hash: await hash(customer) };
      }));
      const sales: Sale[] = [];
      for (const order of records(orderBody.orders)) {
        const id = text(order.id); const location = text(order.location_id); const soldAt = timestamp(order.closed_at) ?? timestamp(order.updated_at) ?? timestamp(order.created_at);
        if (!id || !location || !soldAt || order.state !== "COMPLETED") continue;
        const customer = text(order.customer_id);
        const lines: Line[] = [];
        for (const [index, line] of records(order.line_items).entries()) {
          const lineId = text(line.uid) ?? `${id}:${index}`;
          const quantityNumber = Number(text(line.quantity) ?? 0);
          const net = money(record(line.total_money)) || Math.max(0, money(line.gross_sales_money) - money(line.total_discount_money));
          lines.push({ id: lineId, saleId: id, product: text(line.catalog_object_id), customer, location, soldAt, sku: text(line.catalog_object_id), name: text(line.name), quantity: Number.isFinite(quantityNumber) ? Math.round(quantityNumber * 1000) : 0, net, discount: money(line.total_discount_money), hash: await hash(line) });
        }
        sales.push({ id, version: `${String(order.version ?? 0)}:${text(order.updated_at) ?? soldAt}`, location, soldAt, total: money(order.total_money), tax: money(order.total_tax_money), discount: money(order.total_discount_money), lineCount: lines.reduce((sum, line) => sum + Math.max(0, Math.round(line.quantity / 1000)), 0), hash: await hash(order), customer, lines });
      }
      const payments = await Promise.all(records(paymentBody.payments).filter((payment) => payment.status === "COMPLETED" && text(payment.order_id) && text(payment.location_id)).map(async (payment) => ({ id: String(payment.id), saleId: String(payment.order_id), location: String(payment.location_id), type: paymentCategory(payment), amount: money(payment.amount_money), paidAt: timestamp(payment.created_at), hash: await hash(payment) })));

      const variationIds = products.map((product) => product.id).slice(0, 100);
      const inventoryBody = variationIds.length ? await squareRequest(context.organizationId, connection.id, "/v2/inventory/counts/batch-retrieve", { method: "POST", body: { catalog_object_ids: variationIds, location_ids: mappedLocations, states: ["IN_STOCK"] } }) : {};
      const inventory = records(inventoryBody.counts);
      const scoped = (value: string | null) => scopeExternalRef(connection.sourceNamespace, value);
      const database = getD1(); const now = Date.now();

      const importedProducts = await batches(products.map((product) => database.prepare(`INSERT INTO commerce_products (id, organization_id, provider, connection_id, external_product_id, sku, name, category_ref, supplier_ref, default_cost_cents, default_price_cents, archived, source_updated_at, source_payload_hash, sync_run_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?) ON CONFLICT(organization_id, provider, connection_id, external_product_id) DO UPDATE SET sku=excluded.sku, name=excluded.name, default_price_cents=excluded.default_price_cents, archived=excluded.archived, source_updated_at=excluded.source_updated_at, source_payload_hash=excluded.source_payload_hash, sync_run_id=excluded.sync_run_id, updated_at=excluded.updated_at`).bind(crypto.randomUUID(), context.organizationId, SQUARE_PROVIDER, connection.id, scoped(product.id), product.sku, product.name, product.price, product.archived ? 1 : 0, product.updatedAt, product.hash, runId, now)));
      const importedCustomers = await batches(customers.map((customer) => database.prepare(`INSERT INTO commerce_customers (id, organization_id, provider, connection_id, external_customer_id, display_name, first_name, last_name, email, phone, archived, source_updated_at, source_payload_hash, sync_run_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?) ON CONFLICT(organization_id, provider, connection_id, external_customer_id) DO UPDATE SET display_name=excluded.display_name, first_name=excluded.first_name, last_name=excluded.last_name, email=excluded.email, phone=excluded.phone, source_updated_at=excluded.source_updated_at, source_payload_hash=excluded.source_payload_hash, sync_run_id=excluded.sync_run_id, updated_at=excluded.updated_at`).bind(crypto.randomUUID(), context.organizationId, SQUARE_PROVIDER, connection.id, scoped(customer.id), customer.display, customer.given, customer.family, customer.email, customer.phone, customer.updatedAt, customer.hash, runId, now)));
      const importedLines = await batches(sales.flatMap((sale) => sale.lines).filter((line) => mappedLocations.includes(line.location)).map((line) => database.prepare(`INSERT INTO commerce_sale_lines (id, organization_id, provider, connection_id, external_sale_id, external_line_id, product_ref, customer_ref, outlet_ref, sold_at, sku, product_name, quantity_milli, net_sales_cents, cost_cents, discount_cents, source_payload_hash, sync_run_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?) ON CONFLICT(organization_id, provider, connection_id, external_sale_id, external_line_id) DO UPDATE SET product_ref=excluded.product_ref, customer_ref=excluded.customer_ref, outlet_ref=excluded.outlet_ref, sold_at=excluded.sold_at, sku=excluded.sku, product_name=excluded.product_name, quantity_milli=excluded.quantity_milli, net_sales_cents=excluded.net_sales_cents, discount_cents=excluded.discount_cents, source_payload_hash=excluded.source_payload_hash, sync_run_id=excluded.sync_run_id, updated_at=excluded.updated_at`).bind(crypto.randomUUID(), context.organizationId, SQUARE_PROVIDER, connection.id, scoped(line.saleId), scoped(line.id), scoped(line.product), scoped(line.customer), scoped(line.location), line.soldAt, line.sku, line.name, line.quantity, line.net, line.discount, line.hash, runId, now)));
      const importedPayments = await batches(payments.filter((payment) => mappedLocations.includes(payment.location)).map((payment) => database.prepare(`INSERT INTO commerce_payments (id, organization_id, provider, connection_id, external_payment_id, external_sale_id, payment_type_ref, payment_type_name, category, amount_cents, paid_at, outlet_ref, source_payload_hash, sync_run_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(organization_id, provider, connection_id, external_payment_id) DO UPDATE SET external_sale_id=excluded.external_sale_id, payment_type_name=excluded.payment_type_name, category=excluded.category, amount_cents=excluded.amount_cents, paid_at=excluded.paid_at, outlet_ref=excluded.outlet_ref, source_payload_hash=excluded.source_payload_hash, sync_run_id=excluded.sync_run_id, updated_at=excluded.updated_at`).bind(crypto.randomUUID(), context.organizationId, SQUARE_PROVIDER, connection.id, scoped(payment.id), scoped(payment.saleId), payment.type === "card" ? "Card" : payment.type === "cash" ? "Cash" : payment.type === "gift_card" ? "Gift card" : "Other", payment.type, payment.amount, payment.paidAt, scoped(payment.location), payment.hash, runId, now)));
      const productById = new Map(products.map((product) => [product.id, product]));
      const importedInventory = await batches(inventory.filter((count) => text(count.location_id) && text(count.catalog_object_id) && mappedLocations.includes(String(count.location_id))).map((count) => { const product = productById.get(String(count.catalog_object_id)); return database.prepare(`INSERT INTO inventory_balances (id, organization_id, location_ref, sku, name, on_hand_quantity, reorder_point, version, source_provider, source_connection_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?) ON CONFLICT(organization_id, location_ref, sku) DO UPDATE SET name=excluded.name, on_hand_quantity=excluded.on_hand_quantity, version=inventory_balances.version+1, source_provider=excluded.source_provider, source_connection_id=excluded.source_connection_id, updated_at=excluded.updated_at`).bind(crypto.randomUUID(), context.organizationId, `${SQUARE_PROVIDER}:${scoped(String(count.location_id))}`, product?.sku ?? String(count.catalog_object_id), product?.name ?? "Square item", Number(text(count.quantity) ?? 0), SQUARE_PROVIDER, connection.id, now); }));
      const stagedSales = await batches(sales.filter((sale) => mappedLocations.includes(sale.location)).map((sale) => database.prepare(`INSERT INTO integration_staged_sales (id, organization_id, provider, connection_id, external_sale_id, external_version, outlet_ref, sold_at, state, total_cents, tax_cents, cost_cents, discount_cents, line_count, source_payload_hash, sync_run_id, staged_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, 0, ?, ?, ?, ?, ?) ON CONFLICT(organization_id, provider, connection_id, external_sale_id, external_version) DO NOTHING`).bind(crypto.randomUUID(), context.organizationId, SQUARE_PROVIDER, connection.id, scoped(sale.id), sale.version, scoped(sale.location), sale.soldAt, sale.total, sale.tax, sale.discount, sale.lineCount, sale.hash, runId, now)));

      const publish = Boolean(connection.promotionAuthorizedAt || connection.dataPromotionStatus === "approved") && unmapped === 0;
      let dailyMetrics = 0;
      await database.prepare(`INSERT INTO data_imports (id, organization_id, import_type, status, file_name, row_count, idempotency_key, imported_by_user_id, created_at) VALUES (?, ?, 'manual_entry', 'processing', ?, 0, ?, ?, ?)`).bind(importId, context.organizationId, IMPORT_LABEL, runId, context.userId, now).run();
      if (publish) {
        const latest = await database.prepare(`SELECT outlet_ref outletRef, sold_at soldAt, total_cents totalCents, tax_cents taxCents, discount_cents discountCents, line_count lineCount FROM (SELECT *, row_number() OVER (PARTITION BY external_sale_id ORDER BY staged_at DESC, id DESC) rank FROM integration_staged_sales WHERE organization_id=? AND provider=? AND connection_id=?) WHERE rank=1 AND state='completed'`).bind(context.organizationId, SQUARE_PROVIDER, connection.id).all<{ outletRef: string; soldAt: string; totalCents: number; taxCents: number; discountCents: number; lineCount: number }>();
        const grouped = new Map<string, { date: string; location: string; gross: number; net: number; transactions: number; units: number; discounts: number }>();
        for (const sale of latest.results ?? []) {
          if (!sale.soldAt) continue;
          const rawLocation = unscopedExternalRef(connection.sourceNamespace, sale.outletRef) ?? sale.outletRef;
          const location = `${SQUARE_PROVIDER}:${scopeExternalRef(connection.sourceNamespace, rawLocation)}`;
          const date = sale.soldAt.slice(0, 10); const key = `${date}:${location}`;
          const row = grouped.get(key) ?? { date, location, gross: 0, net: 0, transactions: 0, units: 0, discounts: 0 };
          const net = Math.max(0, sale.totalCents - sale.taxCents);
          row.net += net; row.gross += net + Math.max(0, sale.discountCents); row.transactions += 1; row.units += Math.max(0, sale.lineCount); row.discounts += Math.max(0, sale.discountCents); grouped.set(key, row);
        }
        await database.prepare(`DELETE FROM daily_business_metrics WHERE organization_id=? AND source_connection_id=?`).bind(context.organizationId, connection.id).run();
        for (const row of grouped.values()) {
          await database.prepare(`INSERT INTO daily_business_metrics (organization_id, business_date, location_ref, gross_sales_cents, net_sales_cents, cost_of_goods_cents, transaction_count, units_sold, refunds_cents, discounts_cents, labour_cost_cents, inventory_value_cents, cash_balance_cents, accounts_payable_cents, source_provider, source_connection_id, source_import_id, created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, 0, ?, 0, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?) ON CONFLICT(organization_id, business_date, location_ref) DO UPDATE SET gross_sales_cents=excluded.gross_sales_cents, net_sales_cents=excluded.net_sales_cents, cost_of_goods_cents=0, transaction_count=excluded.transaction_count, units_sold=excluded.units_sold, discounts_cents=excluded.discounts_cents, source_provider=excluded.source_provider, source_connection_id=excluded.source_connection_id, source_import_id=excluded.source_import_id, updated_at=excluded.updated_at`).bind(context.organizationId, row.date, row.location, row.gross, row.net, row.transactions, row.units, row.discounts, SQUARE_PROVIDER, connection.id, importId, context.userId, now, now).run();
        }
        dailyMetrics = grouped.size;
      }
      const completedAt = new Date();
      const cursor: Cursor = { orders: text(orderBody.cursor) ?? undefined, catalog: text(catalogBody.cursor) ?? undefined, customers: text(customerBody.cursor) ?? undefined, payments: text(paymentBody.cursor) ?? undefined, watermark: text(orderBody.cursor) || text(catalogBody.cursor) || text(customerBody.cursor) || text(paymentBody.cursor) ? previous.watermark : completedAt.toISOString() };
      const cursorAfter = JSON.stringify(cursor);
      const recordsRead = catalog.length + customers.length + records(orderBody.orders).length + records(paymentBody.payments).length + inventory.length;
      const recordsStaged = stagedSales + importedProducts + importedCustomers + importedLines + importedPayments + importedInventory;
      await database.prepare(`UPDATE data_imports SET status='completed', row_count=? WHERE id=? AND organization_id=?`).bind(recordsStaged + dailyMetrics, importId, context.organizationId).run();
      await getDb().update(integrationSyncRuns).set({ status: "completed", cursorAfter, recordsRead, recordsStaged, warningCount: unmapped, completedAt }).where(eq(integrationSyncRuns.id, runId));
      const [updated] = await getDb().update(integrationConnections).set({ lastSuccessfulSyncAt: completedAt, lastSyncCursor: cursorAfter, dataPromotionStatus: publish ? "approved" : "staging", promotionAuthorizedAt: publish ? null : connection.promotionAuthorizedAt, lastErrorCode: unmapped ? "SQUARE_LOCATION_UNMAPPED" : "SQUARE_PRODUCT_COST_UNAVAILABLE", syncLeaseOwner: null, syncLeaseExpiresAt: null, updatedAt: completedAt }).where(and(eq(integrationConnections.id, connection.id), eq(integrationConnections.organizationId, context.organizationId), eq(integrationConnections.provider, SQUARE_PROVIDER), eq(integrationConnections.syncLeaseOwner, lease.owner), eq(integrationConnections.syncVersion, lease.version))).returning({ id: integrationConnections.id });
      if (!updated) throw new ApiError(409, "INTEGRATION_SYNC_LEASE_LOST", "The Square sync was superseded before it could publish.");
      await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId, action: "integration.data_imported", resourceType: "integration_sync_run", resourceId: runId, details: { provider: SQUARE_PROVIDER, connectionId: connection.id, recordsRead, recordsStaged, orders: sales.length, products: importedProducts, customers: importedCustomers, payments: importedPayments, inventory: importedInventory, dailyMetrics, productCostAvailable: false } });
      return jsonResponse({ provider: SQUARE_PROVIDER, connectionId: connection.id, run: { id: runId, status: "completed", recordsRead, recordsStaged, duplicatesSkipped: 0, warningCount: unmapped }, reconciliation: { orders: sales.length, completedSales: sales.length, openSales: 0, voidedSales: 0, saleLines: importedLines, payments: importedPayments, products: importedProducts, customers: importedCustomers, inventoryBalances: importedInventory, unmappedLocations: unmapped, dailyMetrics }, readyForReview: sales.length > 0 && unmapped === 0, stagingOnly: !publish, dataPromotionEnabled: publish, nextStep: publish ? "Square sales, payments, customers, catalog and inventory are synchronized. Gross profit stays unavailable until a verified product-cost source is connected." : unmapped ? "Map every Square location, then re-sync." : "Review and approve this Square import, then run one final sync to publish verified sales data." });
    } catch (error) {
      const code = error instanceof ApiError ? error.code : "SQUARE_SYNC_FAILED";
      await getDb().update(integrationSyncRuns).set({ status: "failed", errorCode: code, completedAt: new Date() }).where(eq(integrationSyncRuns.id, runId));
      await getDb().update(integrationConnections).set({ lastErrorCode: code, updatedAt: new Date() }).where(and(eq(integrationConnections.id, connection.id), eq(integrationConnections.organizationId, context.organizationId), eq(integrationConnections.provider, SQUARE_PROVIDER)));
      throw error;
    } finally { await releaseIntegrationSyncLease(lease); }
  });
}
