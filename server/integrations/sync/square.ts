import { and, eq } from "drizzle-orm";
import { businessDateForTimestamp } from "../../../domain/intraday-sales";
import { getD1, getDb } from "../../../db";
import { integrationConnections, integrationLocationMappings, integrationSyncRuns } from "../../../db/schema";
import { scopeExternalRef, unscopedExternalRef } from "../../../domain/integration-source";
import { recordAudit } from "../../audit";
import { ApiError, enforceRateLimit, jsonResponse, } from "../../api";
import { buildSquareCustomerSearchBody, buildSquareOrderSearchBody, record, records, SQUARE_PROVIDER, squareRequest, squareSha256 } from "../../integrations/square";
import { beginSquareFinancialWindow, normalizeSquareFinancialOrder, requireSquareCurrency, squareFinancialMoney, squareDailyFinancialAmounts, SQUARE_FINANCIAL_VERSION, SQUARE_RETURN_PREFIX } from "../square-financials";
import { acquireIntegrationSyncLease, releaseIntegrationSyncLease, renewIntegrationSyncLease, requireOwnedIntegrationConnection, sqliteTimestampSeconds } from "../../integrations/connection";
import { applyOwnerInventoryCosts } from "../../inventory-costs";

const PAGE_SIZE = 100;
const IMPORT_LABEL = "Square read-only sync";
type Sale = { id: string; state: "completed" | "voided"; version: string; location: string; soldAt: string; total: number; tax: number; discount: number; lineCount: number; hash: string; customer: string | null; lines: Line[] };
type Line = { id: string; saleId: string; product: string | null; customer: string | null; location: string; soldAt: string; sku: string | null; name: string | null; quantity: number; net: number; discount: number; hash: string };

function text(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }
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

import type { SyncContext, SyncTrigger } from "./types";

export async function runSync(request: Request, requestId: string, context: SyncContext, input: Record<string, unknown>, trigger: SyncTrigger) {
    
    const reason = trigger === "scheduled" || input.reason === "manual" ? "manual" : "auto";
    const connection = await requireOwnedIntegrationConnection(context.organizationId, SQUARE_PROVIDER, typeof input.connectionId === "string" ? input.connectionId : null, { connected: true });
    if (reason === "auto") return jsonResponse({ provider: SQUARE_PROVIDER, connectionId: connection.id, skipped: true, nextStep: "Square background refresh is controlled by the automatic sync setting." });
    const lease = await acquireIntegrationSyncLease(context.organizationId, SQUARE_PROVIDER, connection.id);
    if (!lease) return jsonResponse({ provider: SQUARE_PROVIDER, connectionId: connection.id, coalesced: true, nextStep: "This Square seller is already synchronizing." });
    const startedAt = new Date();
    const runId = `square-${crypto.randomUUID()}`;
    const importId = `provider-square-${runId}`;
    const { window: previous, refreshingHistory } = beginSquareFinancialWindow(connection.lastSyncCursor, startedAt);
    const currency = context.organization.currency;
    try {
      if (trigger === "manual") await enforceRateLimit("square:manual-sync", context.organizationId, 30, 3600);
      if (refreshingHistory) {
        // Prior versions discarded currency and returns. Rebuild and review their history before reuse.
        const oldest = await getD1().prepare(`SELECT MIN(sold_at) soldAt FROM integration_staged_sales WHERE organization_id=? AND provider=? AND connection_id=?`)
          .bind(context.organizationId, SQUARE_PROVIDER, connection.id).first<{ soldAt: string | null }>();
        const oldestAt = timestamp(oldest?.soldAt);
        if (oldestAt && oldestAt < previous.windowStart) previous.windowStart = oldestAt;
        await getDb().update(integrationConnections).set({ dataPromotionStatus: "staging", promotionAuthorizedAt: null })
          .where(and(eq(integrationConnections.id, connection.id), eq(integrationConnections.organizationId, context.organizationId), eq(integrationConnections.syncLeaseOwner, lease.owner), eq(integrationConnections.syncVersion, lease.version)));
      }
      await getD1().prepare(`INSERT INTO integration_sync_runs (id, organization_id, provider, connection_id, mode, status, cursor_before, records_read, records_staged, duplicates_skipped, warning_count, started_at, created_by_user_id) VALUES (?, ?, ?, ?, 'incremental', 'running', ?, 0, 0, 0, 0, ?, ?)`)
        .bind(runId, context.organizationId, SQUARE_PROVIDER, connection.id, connection.lastSyncCursor, sqliteTimestampSeconds(startedAt.getTime()), context.userId).run();
      const mappings = await getDb().select().from(integrationLocationMappings).where(and(eq(integrationLocationMappings.organizationId, context.organizationId), eq(integrationLocationMappings.provider, SQUARE_PROVIDER), eq(integrationLocationMappings.connectionId, connection.id)));
      const mappedLocations = mappings.filter((mapping) => mapping.status === "mapped").map((mapping) => mapping.externalLocationRef);
      const unmapped = mappings.filter((mapping) => mapping.status === "unmapped").length;
      if (!mappings.length) throw new ApiError(409, "SQUARE_LOCATIONS_REQUIRED", "Refresh and map the Square seller locations before synchronizing.");

      const [catalogBody, customerBody, orderBody, paymentBody] = (await Promise.all([
        previous.completed?.includes("catalog") ? {} : squareRequest(context.organizationId, connection.id, "/v2/catalog/search", { method: "POST", body: { object_types: ["ITEM", "ITEM_VARIATION"], include_deleted_objects: true, limit: PAGE_SIZE, cursor: previous.catalog || undefined } }),
        previous.completed?.includes("customers") ? {} : squareRequest(context.organizationId, connection.id, "/v2/customers/search", { method: "POST", body: buildSquareCustomerSearchBody(previous.customers) }),
        previous.completed?.includes("orders") ? {} : squareRequest(context.organizationId, connection.id, "/v2/orders/search", { method: "POST", body: buildSquareOrderSearchBody(mappedLocations, previous) }),
        previous.completed?.includes("payments") ? {} : squareRequest(context.organizationId, connection.id, `/v2/payments?updated_at_begin_time=${encodeURIComponent(previous.windowStart)}&updated_at_end_time=${encodeURIComponent(previous.windowEnd)}&sort_field=UPDATED_AT&sort_order=ASC&limit=${PAGE_SIZE}${previous.payments ? `&cursor=${encodeURIComponent(previous.payments)}` : ""}`),
      ])).map(record);
      const hasMore = Boolean(text(orderBody.cursor) || text(catalogBody.cursor) || text(customerBody.cursor) || text(paymentBody.cursor));

      const catalog = records(catalogBody.objects);
      const itemNames = new Map<string, string>();
      for (const object of catalog.filter((row) => row.type === "ITEM")) itemNames.set(String(object.id), text(record(object.item_data).name) ?? "Square item");
      const products = await Promise.all(catalog.filter((row) => row.type === "ITEM_VARIATION").map(async (variation) => {
        const data = record(variation.item_variation_data);
        const id = String(variation.id);
        requireSquareCurrency(data, currency);
        return { id, sku: text(data.sku) ?? id, name: text(data.name) ?? itemNames.get(String(data.item_id)) ?? "Square item", category: null, price: squareFinancialMoney(data.price_money, currency, true) || null, archived: Boolean(variation.is_deleted), updatedAt: timestamp(variation.updated_at), hash: await hash(variation) };
      }));
      const customers = await Promise.all(records(customerBody.customers).map(async (customer) => {
        const given = text(customer.given_name); const family = text(customer.family_name); const company = text(customer.company_name);
        return { id: String(customer.id), display: company ?? ([given, family].filter(Boolean).join(" ") || "Square customer"), given, family, email: text(customer.email_address), phone: text(customer.phone_number), updatedAt: timestamp(customer.updated_at), hash: await hash(customer) };
      }));
      const sales: Sale[] = [];
      for (const order of records(orderBody.orders)) {
        const id = text(order.id); const location = text(order.location_id); const soldAt = timestamp(order.closed_at) ?? timestamp(order.updated_at) ?? timestamp(order.created_at);
        if (!id || !location || !soldAt) throw new ApiError(409, "SQUARE_ORDER_REVIEW_REQUIRED", "Square orders need a stable identifier, location and date before publication.");
        const customer = text(order.customer_id);
        for (const event of normalizeSquareFinancialOrder(order, currency)) {
          const lines: Line[] = await Promise.all(event.lines.map(async line => ({ ...line, saleId: event.id, customer, location, soldAt, sku: line.product, hash: await hash(line) })));
          sales.push({ ...event, version: `${SQUARE_FINANCIAL_VERSION}:${String(order.version ?? 0)}:${text(order.updated_at) ?? soldAt}`, location, soldAt, hash: await hash(order), customer, lines });
        }
      }
      const payments = await Promise.all(records(paymentBody.payments).filter((payment) => payment.status === "COMPLETED" && text(payment.order_id) && text(payment.location_id)).map(async (payment) => {
        requireSquareCurrency(payment, currency);
        return { id: String(payment.id), saleId: String(payment.order_id), location: String(payment.location_id), type: paymentCategory(payment), amount: squareFinancialMoney(payment.amount_money, currency), paidAt: timestamp(payment.created_at), hash: await hash(payment) };
      }));

      const variationIds = products.map((product) => product.id).slice(0, 100);
      const inventoryBody = variationIds.length ? await squareRequest(context.organizationId, connection.id, "/v2/inventory/counts/batch-retrieve", { method: "POST", body: { catalog_object_ids: variationIds, location_ids: mappedLocations, states: ["IN_STOCK"] } }) : {};
      const inventory = records(inventoryBody.counts);
      const scoped = (value: string | null) => scopeExternalRef(connection.sourceNamespace, value);
      const database = getD1(); const now = Date.now();
      await renewIntegrationSyncLease(lease);

      const importedProducts = await batches(products.map((product) => database.prepare(`INSERT INTO commerce_products (id, organization_id, provider, connection_id, external_product_id, sku, name, category_ref, supplier_ref, default_cost_cents, default_price_cents, archived, source_updated_at, source_payload_hash, sync_run_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?) ON CONFLICT(organization_id, provider, connection_id, external_product_id) DO UPDATE SET sku=excluded.sku, name=excluded.name, default_price_cents=excluded.default_price_cents, archived=excluded.archived, source_updated_at=excluded.source_updated_at, source_payload_hash=excluded.source_payload_hash, sync_run_id=excluded.sync_run_id, updated_at=excluded.updated_at`).bind(crypto.randomUUID(), context.organizationId, SQUARE_PROVIDER, connection.id, scoped(product.id), product.sku, product.name, product.price, product.archived ? 1 : 0, product.updatedAt, product.hash, runId, now)));
      const importedCustomers = await batches(customers.map((customer) => database.prepare(`INSERT INTO commerce_customers (id, organization_id, provider, connection_id, external_customer_id, display_name, first_name, last_name, email, phone, archived, source_updated_at, source_payload_hash, sync_run_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?) ON CONFLICT(organization_id, provider, connection_id, external_customer_id) DO UPDATE SET display_name=excluded.display_name, first_name=excluded.first_name, last_name=excluded.last_name, email=excluded.email, phone=excluded.phone, source_updated_at=excluded.source_updated_at, source_payload_hash=excluded.source_payload_hash, sync_run_id=excluded.sync_run_id, updated_at=excluded.updated_at`).bind(crypto.randomUUID(), context.organizationId, SQUARE_PROVIDER, connection.id, scoped(customer.id), customer.display, customer.given, customer.family, customer.email, customer.phone, customer.updatedAt, customer.hash, runId, now)));
      // Each provider order is a complete item snapshot, including an absent return tombstone.
      // An archived product cannot be recosted by the shared owner-cost updater. Preserve its
      // old quantity/product/cost snapshot together, rather than attaching an old cost to new units.
      for (const sale of sales.filter(sale => mappedLocations.includes(sale.location) && sale.lines.length)) {
        const archivedChange = await database.prepare(`SELECT 1 present
          FROM commerce_sale_lines line
          JOIN json_each(?) incoming ON line.external_line_id=json_extract(incoming.value,'$.id')
          LEFT JOIN commerce_products old_product ON old_product.organization_id=line.organization_id AND old_product.provider=line.provider AND old_product.connection_id=line.connection_id AND old_product.external_product_id=line.product_ref
          LEFT JOIN commerce_products new_product ON new_product.organization_id=line.organization_id AND new_product.provider=line.provider AND new_product.connection_id=line.connection_id AND new_product.external_product_id=json_extract(incoming.value,'$.product')
          WHERE line.organization_id=? AND line.provider=? AND line.connection_id=? AND line.external_sale_id=?
            AND (old_product.archived=1 OR new_product.archived=1)
            AND (line.quantity_milli<>json_extract(incoming.value,'$.quantity') OR line.product_ref IS NOT json_extract(incoming.value,'$.product')) LIMIT 1`)
          .bind(JSON.stringify(sale.lines.map(line => ({ id: scoped(line.id), product: scoped(line.product), quantity: line.quantity }))), context.organizationId, SQUARE_PROVIDER, connection.id, scoped(sale.id)).first();
        if (archivedChange) throw new ApiError(409, "SQUARE_ARCHIVED_COST_REVIEW_REQUIRED", "A changed Square line references an archived product. Review its quantity, product and historical cost together before publication.");
      }
      // Clear obsolete lines so corrections cannot retain stale returned quantities or owner costs.
      await batches(sales.filter(sale => mappedLocations.includes(sale.location)).map(sale => database.prepare(`DELETE FROM commerce_sale_lines WHERE organization_id=? AND provider=? AND connection_id=? AND external_sale_id=? AND external_line_id NOT IN (SELECT value FROM json_each(?))`).bind(context.organizationId, SQUARE_PROVIDER, connection.id, scoped(sale.id), JSON.stringify(sale.lines.map(line => scoped(line.id))))));
      const importedLines = await batches(sales.flatMap((sale) => sale.lines).filter((line) => mappedLocations.includes(line.location)).map((line) => database.prepare(`INSERT INTO commerce_sale_lines (id, organization_id, provider, connection_id, external_sale_id, external_line_id, product_ref, customer_ref, outlet_ref, sold_at, sku, product_name, quantity_milli, net_sales_cents, cost_cents, discount_cents, source_payload_hash, sync_run_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?) ON CONFLICT(organization_id, provider, connection_id, external_sale_id, external_line_id) DO UPDATE SET product_ref=excluded.product_ref, customer_ref=excluded.customer_ref, outlet_ref=excluded.outlet_ref, sold_at=excluded.sold_at, sku=excluded.sku, product_name=excluded.product_name, quantity_milli=excluded.quantity_milli, net_sales_cents=excluded.net_sales_cents, discount_cents=excluded.discount_cents, source_payload_hash=excluded.source_payload_hash, sync_run_id=excluded.sync_run_id, updated_at=excluded.updated_at`).bind(crypto.randomUUID(), context.organizationId, SQUARE_PROVIDER, connection.id, scoped(line.saleId), scoped(line.id), scoped(line.product), scoped(line.customer), scoped(line.location), line.soldAt, line.sku, line.name, line.quantity, line.net, line.discount, line.hash, runId, now)));
      const importedPayments = await batches(payments.filter((payment) => mappedLocations.includes(payment.location)).map((payment) => database.prepare(`INSERT INTO commerce_payments (id, organization_id, provider, connection_id, external_payment_id, external_sale_id, payment_type_ref, payment_type_name, category, amount_cents, paid_at, outlet_ref, source_payload_hash, sync_run_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(organization_id, provider, connection_id, external_payment_id) DO UPDATE SET external_sale_id=excluded.external_sale_id, payment_type_name=excluded.payment_type_name, category=excluded.category, amount_cents=excluded.amount_cents, paid_at=excluded.paid_at, outlet_ref=excluded.outlet_ref, source_payload_hash=excluded.source_payload_hash, sync_run_id=excluded.sync_run_id, updated_at=excluded.updated_at`).bind(crypto.randomUUID(), context.organizationId, SQUARE_PROVIDER, connection.id, scoped(payment.id), scoped(payment.saleId), payment.type === "card" ? "Card" : payment.type === "cash" ? "Cash" : payment.type === "gift_card" ? "Gift card" : "Other", payment.type, payment.amount, payment.paidAt, scoped(payment.location), payment.hash, runId, now)));
      const productById = new Map(products.map((product) => [product.id, product]));
      const importedInventory = await batches(inventory.filter((count) => text(count.location_id) && text(count.catalog_object_id) && mappedLocations.includes(String(count.location_id))).map((count) => { const product = productById.get(String(count.catalog_object_id)); return database.prepare(`INSERT INTO inventory_balances (id, organization_id, location_ref, sku, name, on_hand_quantity, reorder_point, version, source_provider, source_connection_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?) ON CONFLICT(organization_id, location_ref, sku) DO UPDATE SET name=excluded.name, on_hand_quantity=excluded.on_hand_quantity, version=inventory_balances.version+1, source_provider=excluded.source_provider, source_connection_id=excluded.source_connection_id, updated_at=excluded.updated_at`).bind(crypto.randomUUID(), context.organizationId, `${SQUARE_PROVIDER}:${scoped(String(count.location_id))}`, product?.sku ?? String(count.catalog_object_id), product?.name ?? "Square item", Number(text(count.quantity) ?? 0), SQUARE_PROVIDER, connection.id, now); }));
      const stagedSales = await batches(sales.filter((sale) => mappedLocations.includes(sale.location)).map((sale) => database.prepare(`INSERT INTO integration_staged_sales (id, organization_id, provider, connection_id, external_sale_id, external_version, outlet_ref, sold_at, state, total_cents, tax_cents, cost_cents, discount_cents, line_count, source_payload_hash, sync_run_id, staged_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?) ON CONFLICT(organization_id, provider, connection_id, external_sale_id, external_version) DO NOTHING`).bind(crypto.randomUUID(), context.organizationId, SQUARE_PROVIDER, connection.id, scoped(sale.id), sale.version, scoped(sale.location), sale.soldAt, sale.state, sale.total, sale.tax, sale.discount, sale.lineCount, sale.hash, runId, now)));

      if (!hasMore) {
        const legacy = await database.prepare(`SELECT COUNT(*) count FROM (SELECT external_version, row_number() OVER (PARTITION BY external_sale_id ORDER BY staged_at DESC, id DESC) rank FROM integration_staged_sales WHERE organization_id=? AND provider=? AND connection_id=?) WHERE rank=1 AND external_version NOT LIKE ?`)
          .bind(context.organizationId, SQUARE_PROVIDER, connection.id, `${SQUARE_FINANCIAL_VERSION}:%`).first<{ count: number }>();
        if (Number(legacy?.count ?? 0)) throw new ApiError(409, "SQUARE_HISTORY_REVIEW_REQUIRED", "Some historical Square orders could not be revalidated. Keep this source in staging and review its history before publication.");
      }
      const publish = !refreshingHistory && Boolean(connection.promotionAuthorizedAt || connection.dataPromotionStatus === "approved") && unmapped === 0 && !hasMore;
      // Prepare owner costs in staging, but publish them with revenue in one snapshot.
      const costCoverage = await applyOwnerInventoryCosts(context.organizationId, connection.id, now, { publishDailyMetrics: false });
      // The shared owner-cost updater preserves archived snapshots but cannot cost a new archived return.
      // Its coverage query treats a saved owner cost as known, so explicitly stop an uncosted reversal.
      const archivedReturn = await database.prepare(`SELECT 1 present FROM commerce_sale_lines line JOIN commerce_products product ON product.organization_id=line.organization_id AND product.provider=line.provider AND product.connection_id=line.connection_id AND product.external_product_id=line.product_ref WHERE line.organization_id=? AND line.provider=? AND line.connection_id=? AND line.quantity_milli<0 AND line.cost_cents=0 AND product.archived=1 AND COALESCE(product.owner_cost_cents,product.default_cost_cents,0)<>0 LIMIT 1`)
        .bind(context.organizationId, SQUARE_PROVIDER, connection.id).first();
      if (archivedReturn) throw new ApiError(409, "SQUARE_RETURN_REVIEW_REQUIRED", "An archived Square item's returned cost needs review before publication. No zero-cost reversal was inferred.");
      let dailyMetrics = 0;
      await database.prepare(`INSERT INTO data_imports (id, organization_id, import_type, status, file_name, row_count, idempotency_key, imported_by_user_id, created_at) VALUES (?, ?, 'manual_entry', 'processing', ?, 0, ?, ?, ?)`).bind(importId, context.organizationId, IMPORT_LABEL, runId, context.userId, now).run();
      if (publish) {
        await renewIntegrationSyncLease(lease);
        const latest = await database.prepare(`SELECT external_sale_id externalSaleId, outlet_ref outletRef, sold_at soldAt, total_cents totalCents, tax_cents taxCents,
          COALESCE((SELECT SUM(line.cost_cents) FROM commerce_sale_lines line
            WHERE line.organization_id=sale.organization_id AND line.provider=sale.provider
              AND line.connection_id=sale.connection_id AND line.external_sale_id=sale.external_sale_id), sale.cost_cents) costCents,
          discount_cents discountCents, line_count lineCount
          FROM (SELECT *, row_number() OVER (PARTITION BY external_sale_id ORDER BY staged_at DESC, id DESC) rank
            FROM integration_staged_sales WHERE organization_id=? AND provider=? AND connection_id=?) sale
          WHERE rank=1 AND state='completed'`).bind(context.organizationId, SQUARE_PROVIDER, connection.id).all<{ externalSaleId: string; outletRef: string; soldAt: string; totalCents: number; taxCents: number; costCents: number; discountCents: number; lineCount: number }>();
        const grouped = new Map<string, { date: string; location: string; gross: number; net: number; cost: number; transactions: number; units: number; discounts: number; refunds: number }>();
        for (const sale of latest.results ?? []) {
          if (!sale.soldAt) continue;
          const rawLocation = unscopedExternalRef(connection.sourceNamespace, sale.outletRef) ?? sale.outletRef;
          const location = `${SQUARE_PROVIDER}:${scopeExternalRef(connection.sourceNamespace, rawLocation)}`;
          const date = businessDateForTimestamp(sale.soldAt, context.organization.timezone); if (!date) continue; const key = `${date}:${location}`;
          const row = grouped.get(key) ?? { date, location, gross: 0, net: 0, cost: 0, transactions: 0, units: 0, discounts: 0, refunds: 0 };
          const amounts = squareDailyFinancialAmounts({ ...sale, isReturn: (unscopedExternalRef(connection.sourceNamespace, sale.externalSaleId) ?? sale.externalSaleId).startsWith(SQUARE_RETURN_PREFIX) });
          row.net += amounts.net; row.gross += amounts.gross; row.refunds += amounts.refunds; row.cost += amounts.cost; row.transactions += amounts.transactions; row.units += amounts.units; row.discounts += amounts.discounts; grouped.set(key, row);
        }
        const metricStatements = [
          // A failed ownership check deliberately violates the connection constraint,
          // aborting this entire batch before any previously published row is removed.
          database.prepare(`INSERT INTO integration_connections (id) SELECT ?
            WHERE NOT EXISTS (
              SELECT 1 FROM integration_connections
              WHERE id=? AND organization_id=? AND provider=? AND status='connected'
                AND sync_lease_owner=? AND sync_version=? AND sync_lease_expires_at>?
            )`).bind(connection.id, connection.id, context.organizationId, SQUARE_PROVIDER,
              lease.owner, lease.version, sqliteTimestampSeconds()),
          database.prepare(`DELETE FROM daily_business_metrics WHERE organization_id=? AND source_connection_id=?`).bind(context.organizationId, connection.id),
        ];
        for (const row of grouped.values()) {
          metricStatements.push(database.prepare(`INSERT INTO daily_business_metrics (organization_id, business_date, location_ref, gross_sales_cents, net_sales_cents, cost_of_goods_cents, transaction_count, units_sold, refunds_cents, discounts_cents, labour_cost_cents, inventory_value_cents, cash_balance_cents, accounts_payable_cents, source_provider, source_connection_id, source_import_id, created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?) ON CONFLICT(organization_id, business_date, location_ref) DO UPDATE SET gross_sales_cents=excluded.gross_sales_cents, net_sales_cents=excluded.net_sales_cents, cost_of_goods_cents=excluded.cost_of_goods_cents, transaction_count=excluded.transaction_count, units_sold=excluded.units_sold, refunds_cents=excluded.refunds_cents, discounts_cents=excluded.discounts_cents, source_provider=excluded.source_provider, source_connection_id=excluded.source_connection_id, source_import_id=excluded.source_import_id, updated_at=excluded.updated_at`).bind(context.organizationId, row.date, row.location, row.gross, row.net, row.cost, row.transactions, row.units, row.refunds, row.discounts, SQUARE_PROVIDER, connection.id, importId, context.userId, now, now));
        }
        // D1 batch is transactional: a failed insert must not leave the old snapshot deleted.
        await database.batch(metricStatements);
        dailyMetrics = grouped.size;
      }
      const completedAt = new Date();
      const completed = Object.entries({ orders: orderBody, catalog: catalogBody, customers: customerBody, payments: paymentBody })
        .filter(([, body]) => !text(body.cursor)).map(([key]) => key);
      const cursor = { ...previous, financialVersion: SQUARE_FINANCIAL_VERSION, completed, orders: text(orderBody.cursor) ?? undefined, catalog: text(catalogBody.cursor) ?? undefined, customers: text(customerBody.cursor) ?? undefined, payments: text(paymentBody.cursor) ?? undefined, watermark: hasMore ? previous.watermark : previous.windowEnd };
      const cursorAfter = JSON.stringify(cursor);
      const recordsRead = catalog.length + customers.length + records(orderBody.orders).length + records(paymentBody.payments).length + inventory.length;
      const recordsStaged = stagedSales + importedProducts + importedCustomers + importedLines + importedPayments + importedInventory;
      await database.prepare(`UPDATE data_imports SET status='completed', row_count=? WHERE id=? AND organization_id=?`).bind(recordsStaged + dailyMetrics, importId, context.organizationId).run();
      await getDb().update(integrationSyncRuns).set({ status: "completed", cursorAfter, recordsRead, recordsStaged, warningCount: unmapped + Number(hasMore), completedAt }).where(eq(integrationSyncRuns.id, runId));
      const [updated] = await getDb().update(integrationConnections).set({
        lastSuccessfulSyncAt: hasMore ? connection.lastSuccessfulSyncAt : completedAt,
        lastSyncCursor: cursorAfter,
        dataPromotionStatus: refreshingHistory ? "staging" : hasMore ? connection.dataPromotionStatus : publish ? "approved" : "staging",
        promotionAuthorizedAt: refreshingHistory || publish ? null : connection.promotionAuthorizedAt,
        lastErrorCode: hasMore ? "SQUARE_SYNC_MORE_PAGES" : unmapped ? "SQUARE_LOCATION_UNMAPPED" : costCoverage.missingCostLines ? "SQUARE_PRODUCT_COST_UNAVAILABLE" : null,
        syncLeaseOwner: null, syncLeaseExpiresAt: null, updatedAt: completedAt,
      }).where(and(eq(integrationConnections.id, connection.id), eq(integrationConnections.organizationId, context.organizationId), eq(integrationConnections.provider, SQUARE_PROVIDER), eq(integrationConnections.syncLeaseOwner, lease.owner), eq(integrationConnections.syncVersion, lease.version))).returning({ id: integrationConnections.id });
      if (!updated) throw new ApiError(409, "INTEGRATION_SYNC_LEASE_LOST", "The Square sync was superseded before it could publish.");
      await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId, action: "integration.data_imported", resourceType: "integration_sync_run", resourceId: runId, details: { provider: SQUARE_PROVIDER, connectionId: connection.id, recordsRead, recordsStaged, orders: records(orderBody.orders).length, products: importedProducts, customers: importedCustomers, payments: importedPayments, inventory: importedInventory, dailyMetrics, productCostAvailable: costCoverage.missingCostLines === 0 } });
      return jsonResponse({ provider: SQUARE_PROVIDER, connectionId: connection.id, hasMore, run: { id: runId, status: "completed", recordsRead, recordsStaged, duplicatesSkipped: 0, warningCount: unmapped + costCoverage.missingCostLines + Number(hasMore) }, reconciliation: { orders: records(orderBody.orders).length, completedSales: sales.filter(sale => sale.state === "completed" && !sale.id.startsWith(SQUARE_RETURN_PREFIX)).length, openSales: 0, voidedSales: 0, saleLines: importedLines, payments: importedPayments, products: importedProducts, customers: importedCustomers, inventoryBalances: importedInventory, unmappedLocations: unmapped, missingProductCosts: costCoverage.missingCostLines, dailyMetrics }, readyForReview: !hasMore && unmapped === 0, stagingOnly: !publish, dataPromotionEnabled: publish, nextStep: hasMore ? "More Square records remain. Run Sync again to continue the saved import before reviewing or publishing it." : publish ? costCoverage.missingCostLines ? "Square is synchronized. Add the missing unit costs in Inventory to unlock verified margin reporting." : "Square sales, payments, customers, catalog, inventory and owner-managed costs are synchronized." : unmapped ? "Map every Square location, then re-sync." : "Review and approve this Square import, then run one final sync to publish verified sales data." });
    } catch (error) {
      const code = error instanceof ApiError ? error.code : "SQUARE_SYNC_FAILED";
      await getDb().update(integrationSyncRuns).set({ status: "failed", errorCode: code, completedAt: new Date() }).where(eq(integrationSyncRuns.id, runId));
      // Partial staging writes or invalid source money must not remain approved after the lease ends.
      await getDb().update(integrationConnections).set({ dataPromotionStatus: "staging", promotionAuthorizedAt: null, lastErrorCode: code, updatedAt: new Date() }).where(and(eq(integrationConnections.id, connection.id), eq(integrationConnections.organizationId, context.organizationId), eq(integrationConnections.provider, SQUARE_PROVIDER), eq(integrationConnections.syncLeaseOwner, lease.owner), eq(integrationConnections.syncVersion, lease.version)));
      throw error;
    } finally { await releaseIntegrationSyncLease(lease); }
}
