import { and, eq } from "drizzle-orm";
import { getD1, getDb } from "../../../../../../db";
import { integrationConnections, integrationLocationMappings, integrationSyncRuns } from "../../../../../../db/schema";
import { scopeExternalRef, unscopedExternalRef } from "../../../../../../domain/integration-source";
import { recordAudit } from "../../../../../../server/audit";
import { requireAccess } from "../../../../../../server/authorization";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, requireSameOrigin } from "../../../../../../server/api";
import {
  buildCloverDailyMetrics, CLOVER_PROVIDER, fetchCloverConnectionCollection, fetchCloverMerchant,
  normalizeCloverCustomer, normalizeCloverInventoryItem, normalizeCloverOrder, normalizeCloverPayments,
  type NormalizedCloverSale,
} from "../../../../../../server/integrations/clover";
import {
  acquireIntegrationSyncLease, releaseIntegrationSyncLease, renewIntegrationSyncLease,
  requireOwnedIntegrationConnection, sqliteTimestampSeconds,
} from "../../../../../../server/integrations/connection";
import { requirePermission } from "../../../../../../server/permissions";
import { applyOwnerInventoryCosts } from "../../../../../../server/inventory-costs";

const PAGE_SIZE = 100;
const IMPORT_LABEL = "Clover read-only sync";

type Checkpoint = {
  version: 1;
  ordersOffset: number;
  itemsOffset: number;
  customersOffset: number;
  paymentsOffset: number;
  ordersComplete: boolean;
  itemsComplete: boolean;
  customersComplete: boolean;
  paymentsComplete: boolean;
  watermark: string | null;
};

function parseCheckpoint(value: string | null): Checkpoint {
  const empty: Checkpoint = { version: 1, ordersOffset: 0, itemsOffset: 0, customersOffset: 0, paymentsOffset: 0, ordersComplete: false, itemsComplete: false, customersComplete: false, paymentsComplete: false, watermark: null };
  if (!value) return empty;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (parsed.version !== 1) return empty;
    const number = (key: string) => Math.max(0, Number.isInteger(parsed[key]) ? Number(parsed[key]) : 0);
    return {
      version: 1, ordersOffset: number("ordersOffset"), itemsOffset: number("itemsOffset"), customersOffset: number("customersOffset"), paymentsOffset: number("paymentsOffset"),
      ordersComplete: parsed.ordersComplete === true, itemsComplete: parsed.itemsComplete === true,
      customersComplete: parsed.customersComplete === true, paymentsComplete: parsed.paymentsComplete === true,
      watermark: typeof parsed.watermark === "string" ? parsed.watermark : null,
    };
  } catch { return empty; }
}

function nextCheckpoint(previous: Checkpoint, counts: { orders: number; items: number; customers: number; payments: number }, completedAt: Date) {
  const complete = {
    orders: previous.ordersComplete || counts.orders < PAGE_SIZE,
    items: previous.itemsComplete || counts.items < PAGE_SIZE,
    customers: previous.customersComplete || counts.customers < PAGE_SIZE,
    payments: previous.paymentsComplete || counts.payments < PAGE_SIZE,
  };
  if (complete.orders && complete.items && complete.customers && complete.payments) {
    return JSON.stringify({ version: 1, ordersOffset: 0, itemsOffset: 0, customersOffset: 0, paymentsOffset: 0, ordersComplete: false, itemsComplete: false, customersComplete: false, paymentsComplete: false, watermark: completedAt.toISOString() } satisfies Checkpoint);
  }
  return JSON.stringify({
    version: 1,
    ordersOffset: complete.orders ? previous.ordersOffset : previous.ordersOffset + counts.orders,
    itemsOffset: complete.items ? previous.itemsOffset : previous.itemsOffset + counts.items,
    customersOffset: complete.customers ? previous.customersOffset : previous.customersOffset + counts.customers,
    paymentsOffset: complete.payments ? previous.paymentsOffset : previous.paymentsOffset + counts.payments,
    ordersComplete: complete.orders, itemsComplete: complete.items, customersComplete: complete.customers, paymentsComplete: complete.payments,
    watermark: previous.watermark,
  } satisfies Checkpoint);
}

async function runBatches(statements: D1PreparedStatement[]) {
  let changed = 0;
  const database = getD1();
  for (let index = 0; index < statements.length; index += 75) {
    const result = await database.batch(statements.slice(index, index + 75));
    changed += result.reduce((sum, row) => sum + Number(row.meta.changes ?? 0), 0);
  }
  return changed;
}

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, ["owner", "admin"], "pos.reporting.core");
    await requirePermission(context, "integrations.manage");
    const input = await request.json().catch(() => ({})) as { reason?: unknown; connectionId?: unknown };
    const reason = input.reason === "manual" ? "manual" : "auto";
    const connection = await requireOwnedIntegrationConnection(context.organizationId, CLOVER_PROVIDER, typeof input.connectionId === "string" ? input.connectionId : null, { connected: true });
    if (!connection.externalAccountRef) throw new ApiError(409, "CLOVER_NOT_CONNECTED", "Authorize a Clover merchant before synchronizing it.");
    if (reason === "auto") return jsonResponse({ provider: CLOVER_PROVIDER, connectionId: connection.id, skipped: true, nextStep: "Clover refreshes remain owner-initiated until the durable worker schedule is enabled." });
    const lease = await acquireIntegrationSyncLease(context.organizationId, CLOVER_PROVIDER, connection.id);
    if (!lease) return jsonResponse({ provider: CLOVER_PROVIDER, connectionId: connection.id, coalesced: true, nextStep: "This Clover merchant is already synchronizing." });
    const startedAt = new Date();
    const runId = `clover-${crypto.randomUUID()}`;
    const importId = `provider-clover-${runId}`;
    const previous = parseCheckpoint(connection.lastSyncCursor);
    try {
      await enforceRateLimit("clover:manual-sync", context.organizationId, 30, 3600);
      await getD1().prepare(`
        INSERT INTO integration_sync_runs
          (id, organization_id, provider, connection_id, mode, status, cursor_before, cursor_after,
           records_read, records_staged, duplicates_skipped, warning_count, error_code,
           started_at, completed_at, created_by_user_id)
        VALUES (?, ?, ?, ?, 'incremental', 'running', ?, NULL, 0, 0, 0, 0, NULL, ?, NULL, ?)
      `).bind(runId, context.organizationId, CLOVER_PROVIDER, connection.id, connection.lastSyncCursor, sqliteTimestampSeconds(startedAt.getTime()), context.userId).run();

      const merchant = await fetchCloverMerchant(context.organizationId, connection.id, connection.externalAccountRef);
      if (String(merchant.id ?? "") !== connection.externalAccountRef) throw new ApiError(409, "CLOVER_MERCHANT_CHANGED", "The authorized Clover merchant changed. Reconnect before importing data.");
      const queryBase = { limit: PAGE_SIZE };
      const [ordersPage, itemsPage, customersPage, paymentsPage] = await Promise.all([
        previous.ordersComplete ? Promise.resolve({ elements: [] as Record<string, unknown>[] }) : fetchCloverConnectionCollection(context.organizationId, connection.id, connection.externalAccountRef, "orders", { ...queryBase, offset: previous.ordersOffset, expand: "lineItems,payments,customers,refunds" }),
        previous.itemsComplete ? Promise.resolve({ elements: [] as Record<string, unknown>[] }) : fetchCloverConnectionCollection(context.organizationId, connection.id, connection.externalAccountRef, "items", { ...queryBase, offset: previous.itemsOffset, expand: "categories,itemStock" }),
        previous.customersComplete ? Promise.resolve({ elements: [] as Record<string, unknown>[] }) : fetchCloverConnectionCollection(context.organizationId, connection.id, connection.externalAccountRef, "customers", { ...queryBase, offset: previous.customersOffset, expand: "emailAddresses,phoneNumbers" }),
        previous.paymentsComplete ? Promise.resolve({ elements: [] as Record<string, unknown>[] }) : fetchCloverConnectionCollection(context.organizationId, connection.id, connection.externalAccountRef, "payments", { ...queryBase, offset: previous.paymentsOffset, expand: "tender,order" }),
      ]);
      await renewIntegrationSyncLease(lease);

      const normalizedProducts = await Promise.all(itemsPage.elements.map((item) => normalizeCloverInventoryItem(connection.externalAccountRef!, item)));
      const normalizedOrders: Awaited<ReturnType<typeof normalizeCloverOrder>>[] = [];
      let normalizationWarnings = 0;
      for (const order of ordersPage.elements) {
        try { normalizedOrders.push(await normalizeCloverOrder(connection.externalAccountRef, order)); }
        catch { normalizationWarnings += 1; }
      }
      const customers = [] as Awaited<ReturnType<typeof normalizeCloverCustomer>>[];
      for (const customer of customersPage.elements) {
        try { customers.push(await normalizeCloverCustomer(customer)); } catch { normalizationWarnings += 1; }
      }
      const paymentCandidates = paymentsPage.elements.filter((payment) => {
        const order = payment.order;
        return Boolean(order && typeof order === "object" && !Array.isArray(order) && typeof (order as Record<string, unknown>).id === "string");
      });
      normalizationWarnings += paymentsPage.elements.length - paymentCandidates.length;
      const payments = await normalizeCloverPayments(connection.externalAccountRef, paymentCandidates);

      const mappings = await getDb().select().from(integrationLocationMappings).where(and(
        eq(integrationLocationMappings.organizationId, context.organizationId), eq(integrationLocationMappings.provider, CLOVER_PROVIDER), eq(integrationLocationMappings.connectionId, connection.id),
      ));
      const mappedRaw = new Set(mappings.filter((row) => row.status === "mapped").map((row) => row.externalLocationRef));
      const unmapped = mappings.filter((row) => row.status === "unmapped").length;
      const scoped = (value: string | null) => scopeExternalRef(connection.sourceNamespace, value);
      const database = getD1();
      const now = Date.now();

      const productStatements = normalizedProducts.map(({ product }) => database.prepare(`
        INSERT INTO commerce_products
          (id, organization_id, provider, connection_id, external_product_id, sku, name, category_ref, supplier_ref,
           default_cost_cents, default_price_cents, archived, source_updated_at, source_payload_hash, sync_run_id, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(organization_id, provider, connection_id, external_product_id) DO UPDATE SET
          sku=excluded.sku, name=excluded.name, category_ref=excluded.category_ref,
          default_cost_cents=excluded.default_cost_cents, default_price_cents=excluded.default_price_cents,
          archived=excluded.archived, source_updated_at=excluded.source_updated_at,
          source_payload_hash=excluded.source_payload_hash, sync_run_id=excluded.sync_run_id, updated_at=excluded.updated_at
      `).bind(crypto.randomUUID(), context.organizationId, CLOVER_PROVIDER, connection.id, scoped(product.externalProductId), product.sku, product.name, scoped(product.categoryRef), product.defaultCostCents, product.defaultPriceCents, product.archived ? 1 : 0, product.sourceUpdatedAt, product.sourcePayloadHash, runId, now));
      const importedProducts = await runBatches(productStatements);

      const customerStatements = customers.map((customer) => database.prepare(`
        INSERT INTO commerce_customers
          (id, organization_id, provider, connection_id, external_customer_id, display_name, first_name, last_name, email, phone, archived, source_updated_at, source_payload_hash, sync_run_id, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(organization_id, provider, connection_id, external_customer_id) DO UPDATE SET
          display_name=excluded.display_name, first_name=excluded.first_name, last_name=excluded.last_name,
          email=excluded.email, phone=excluded.phone, source_updated_at=excluded.source_updated_at,
          source_payload_hash=excluded.source_payload_hash, sync_run_id=excluded.sync_run_id, updated_at=excluded.updated_at
      `).bind(crypto.randomUUID(), context.organizationId, CLOVER_PROVIDER, connection.id, scoped(customer.externalCustomerId), customer.displayName, customer.firstName, customer.lastName, customer.email, customer.phone, customer.archived ? 1 : 0, customer.sourceUpdatedAt, customer.sourcePayloadHash, runId, now));
      const importedCustomers = await runBatches(customerStatements);

      const lines = normalizedOrders.flatMap((row) => row.lines);
      const sales = normalizedOrders.map((row) => row.sale);
      const lineStatements = lines.filter((line) => mappedRaw.has(line.outletRef)).map((line) => database.prepare(`
        INSERT INTO commerce_sale_lines
          (id, organization_id, provider, connection_id, external_sale_id, external_line_id, product_ref, customer_ref, outlet_ref, sold_at, sku, product_name, quantity_milli, net_sales_cents, cost_cents, discount_cents, source_payload_hash, sync_run_id, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
        ON CONFLICT(organization_id, provider, connection_id, external_sale_id, external_line_id) DO UPDATE SET
          product_ref=excluded.product_ref, customer_ref=excluded.customer_ref, outlet_ref=excluded.outlet_ref,
          sold_at=excluded.sold_at, sku=excluded.sku, product_name=excluded.product_name,
          quantity_milli=excluded.quantity_milli, net_sales_cents=excluded.net_sales_cents,
          discount_cents=excluded.discount_cents, source_payload_hash=excluded.source_payload_hash,
          sync_run_id=excluded.sync_run_id, updated_at=excluded.updated_at
      `).bind(crypto.randomUUID(), context.organizationId, CLOVER_PROVIDER, connection.id, scoped(line.externalSaleId), scoped(line.externalLineId), scoped(line.productRef), scoped(line.customerRef), scoped(line.outletRef), line.soldAt, line.sku, line.productName, line.quantityMilli, line.netSalesCents, line.discountCents, line.sourcePayloadHash, runId, now));
      const importedLines = await runBatches(lineStatements);

      const paymentStatements = payments.filter((payment) => mappedRaw.has(payment.outletRef)).map((payment) => database.prepare(`
        INSERT INTO commerce_payments
          (id, organization_id, provider, connection_id, external_payment_id, external_sale_id, payment_type_ref, payment_type_name, category, amount_cents, paid_at, outlet_ref, source_payload_hash, sync_run_id, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(organization_id, provider, connection_id, external_payment_id) DO UPDATE SET
          external_sale_id=excluded.external_sale_id, payment_type_ref=excluded.payment_type_ref,
          payment_type_name=excluded.payment_type_name, category=excluded.category, amount_cents=excluded.amount_cents,
          paid_at=excluded.paid_at, outlet_ref=excluded.outlet_ref, source_payload_hash=excluded.source_payload_hash,
          sync_run_id=excluded.sync_run_id, updated_at=excluded.updated_at
      `).bind(crypto.randomUUID(), context.organizationId, CLOVER_PROVIDER, connection.id, scoped(payment.externalPaymentId), scoped(payment.externalSaleId), scoped(payment.paymentTypeRef), payment.paymentTypeName, payment.category, payment.amountCents, payment.paidAt, scoped(payment.outletRef), payment.sourcePayloadHash, runId, now));
      const importedPayments = await runBatches(paymentStatements);

      const inventoryStatements = normalizedProducts.filter(({ balance }) => mappedRaw.has(balance.outletRef)).map(({ balance }) => database.prepare(`
        INSERT INTO inventory_balances
          (id, organization_id, location_ref, sku, name, on_hand_quantity, reorder_point, version, source_provider, source_connection_id, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
        ON CONFLICT(organization_id, location_ref, sku) DO UPDATE SET
          name=excluded.name, on_hand_quantity=excluded.on_hand_quantity, reorder_point=excluded.reorder_point,
          version=inventory_balances.version+1, source_provider=excluded.source_provider,
          source_connection_id=excluded.source_connection_id, updated_at=excluded.updated_at
      `).bind(crypto.randomUUID(), context.organizationId, `${CLOVER_PROVIDER}:${scoped(balance.outletRef)}`, balance.sku, balance.name, balance.onHandQuantity, balance.reorderPoint, CLOVER_PROVIDER, connection.id, now));
      const importedInventory = await runBatches(inventoryStatements);

      const stagedStatements = sales.map((sale) => database.prepare(`
        INSERT INTO integration_staged_sales
          (id, organization_id, provider, connection_id, external_sale_id, external_version, outlet_ref, sold_at, state, total_cents, tax_cents, cost_cents, discount_cents, line_count, source_payload_hash, sync_run_id, staged_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
        ON CONFLICT(organization_id, provider, connection_id, external_sale_id, external_version) DO NOTHING
      `).bind(crypto.randomUUID(), context.organizationId, CLOVER_PROVIDER, connection.id, scoped(sale.externalSaleId), sale.externalVersion, scoped(sale.outletRef), sale.soldAt, sale.state, sale.totalCents, sale.taxCents, sale.discountCents, sale.lineCount, sale.sourcePayloadHash, runId, now));
      const stagedSales = await runBatches(stagedStatements);

      // Clover's item cost is per unit while its quantity is fixed-point x1000.
      // Recompute canonical and staged COGS from the authoritative item catalog;
      // never infer missing costs from price or margin.
      await database.prepare(`
        UPDATE commerce_sale_lines AS line
        SET cost_cents = COALESCE((
          SELECT ROUND(product.default_cost_cents * line.quantity_milli / 1000.0)
          FROM commerce_products product
          WHERE product.organization_id=line.organization_id AND product.provider=line.provider
            AND product.connection_id=line.connection_id AND product.external_product_id=line.product_ref
            AND product.default_cost_cents IS NOT NULL
        ), 0)
        WHERE line.organization_id=? AND line.provider=? AND line.connection_id=?
      `).bind(context.organizationId, CLOVER_PROVIDER, connection.id).run();
      await database.prepare(`
        UPDATE integration_staged_sales AS sale
        SET cost_cents = COALESCE((
          SELECT SUM(line.cost_cents) FROM commerce_sale_lines line
          WHERE line.organization_id=sale.organization_id AND line.provider=sale.provider
            AND line.connection_id=sale.connection_id AND line.external_sale_id=sale.external_sale_id
        ), 0)
        WHERE sale.organization_id=? AND sale.provider=? AND sale.connection_id=?
      `).bind(context.organizationId, CLOVER_PROVIDER, connection.id).run();

      await applyOwnerInventoryCosts(context.organizationId, connection.id, now);

      const missingCost = await database.prepare(`
        SELECT COUNT(*) count FROM commerce_sale_lines line
        LEFT JOIN commerce_products product ON product.organization_id=line.organization_id AND product.provider=line.provider
          AND product.connection_id=line.connection_id AND product.external_product_id=line.product_ref
        WHERE line.organization_id=? AND line.provider=? AND line.connection_id=? AND line.net_sales_cents>0
          AND (line.product_ref IS NULL OR (product.owner_cost_cents IS NULL AND product.default_cost_cents IS NULL))
      `).bind(context.organizationId, CLOVER_PROVIDER, connection.id).first<{ count: number }>();
      const missingCostCount = Number(missingCost?.count ?? 0);
      const publishRequested = Boolean(connection.promotionAuthorizedAt || connection.dataPromotionStatus === "approved");
      const publishCanonical = publishRequested && unmapped === 0 && normalizationWarnings === 0 && missingCostCount === 0;

      let publishedMetrics = 0;
      await database.prepare(`INSERT INTO data_imports (id, organization_id, import_type, status, file_name, row_count, idempotency_key, imported_by_user_id, created_at) VALUES (?, ?, 'manual_entry', 'processing', ?, 0, ?, ?, ?)`)
        .bind(importId, context.organizationId, IMPORT_LABEL, runId, context.userId, now).run();
      if (publishCanonical) {
        const latest = await database.prepare(`
          SELECT external_sale_id externalSaleId, outlet_ref outletRef, sold_at soldAt, state,
            total_cents totalCents, tax_cents taxCents, cost_cents costCents,
            discount_cents discountCents, line_count lineCount, external_version externalVersion,
            source_payload_hash sourcePayloadHash
          FROM (SELECT *, row_number() OVER (PARTITION BY external_sale_id ORDER BY staged_at DESC, id DESC) rank
            FROM integration_staged_sales WHERE organization_id=? AND provider=? AND connection_id=?) WHERE rank=1
        `).bind(context.organizationId, CLOVER_PROVIDER, connection.id).all<NormalizedCloverSale>();
        const metrics = buildCloverDailyMetrics((latest.results ?? []).map((sale) => ({ ...sale, outletRef: unscopedExternalRef(connection.sourceNamespace, sale.outletRef) ?? sale.outletRef })), connection.sourceNamespace);
        await database.prepare(`DELETE FROM daily_business_metrics WHERE organization_id=? AND source_connection_id=?`).bind(context.organizationId, connection.id).run();
        for (const row of metrics) {
          await database.prepare(`
            INSERT INTO daily_business_metrics
              (organization_id, business_date, location_ref, gross_sales_cents, net_sales_cents, cost_of_goods_cents,
               transaction_count, units_sold, refunds_cents, discounts_cents, labour_cost_cents, inventory_value_cents,
               cash_balance_cents, accounts_payable_cents, source_provider, source_connection_id, source_import_id,
               created_by_user_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(organization_id, business_date, location_ref) DO UPDATE SET
              gross_sales_cents=excluded.gross_sales_cents, net_sales_cents=excluded.net_sales_cents,
              cost_of_goods_cents=excluded.cost_of_goods_cents, transaction_count=excluded.transaction_count,
              units_sold=excluded.units_sold, refunds_cents=excluded.refunds_cents,
              discounts_cents=excluded.discounts_cents, source_provider=excluded.source_provider,
              source_connection_id=excluded.source_connection_id, source_import_id=excluded.source_import_id, updated_at=excluded.updated_at
          `).bind(context.organizationId, row.businessDate, row.locationRef, row.grossSalesCents, row.netSalesCents, row.costOfGoodsCents, row.transactionCount, row.unitsSold, row.refundsCents, row.discountsCents, CLOVER_PROVIDER, connection.id, importId, context.userId, now, now).run();
        }
        publishedMetrics = metrics.length;
      }

      const completedAt = new Date();
      const cursor = nextCheckpoint(previous, { orders: ordersPage.elements.length, items: itemsPage.elements.length, customers: customersPage.elements.length, payments: paymentsPage.elements.length }, completedAt);
      const warningCount = normalizationWarnings + unmapped + missingCostCount;
      const recordsRead = ordersPage.elements.length + itemsPage.elements.length + customersPage.elements.length + paymentsPage.elements.length;
      const recordsStaged = stagedSales + importedProducts + importedCustomers + importedLines + importedPayments + importedInventory;
      await database.prepare(`UPDATE data_imports SET status='completed', row_count=? WHERE id=? AND organization_id=?`).bind(recordsStaged + publishedMetrics, importId, context.organizationId).run();
      await getDb().update(integrationSyncRuns).set({ status: "completed", cursorAfter: cursor, recordsRead, recordsStaged, warningCount, completedAt }).where(eq(integrationSyncRuns.id, runId));
      await renewIntegrationSyncLease(lease);
      const status = publishCanonical ? "approved" : "staging";
      const [updated] = await getDb().update(integrationConnections).set({
        externalAccountName: typeof merchant.name === "string" ? merchant.name.slice(0, 160) : connection.externalAccountName,
        lastSuccessfulSyncAt: completedAt, lastSyncCursor: cursor, dataPromotionStatus: status,
        promotionAuthorizedAt: publishCanonical ? null : connection.promotionAuthorizedAt,
        lastErrorCode: normalizationWarnings ? "CLOVER_NORMALIZATION_WARNINGS" : unmapped ? "CLOVER_LOCATION_UNMAPPED" : missingCostCount ? "CLOVER_ITEM_COST_REQUIRED" : null,
        syncLeaseOwner: null, syncLeaseExpiresAt: null, updatedAt: completedAt,
      }).where(and(
        eq(integrationConnections.id, connection.id), eq(integrationConnections.organizationId, context.organizationId),
        eq(integrationConnections.provider, CLOVER_PROVIDER), eq(integrationConnections.syncLeaseOwner, lease.owner), eq(integrationConnections.syncVersion, lease.version),
      )).returning({ id: integrationConnections.id });
      if (!updated) throw new ApiError(409, "INTEGRATION_SYNC_LEASE_LOST", "The Clover sync was superseded before it could publish.");
      await recordAudit({
        request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
        action: "integration.data_imported", resourceType: "integration_sync_run", resourceId: runId,
        details: { provider: CLOVER_PROVIDER, connectionId: connection.id, recordsRead, recordsStaged, publishedMetrics, products: importedProducts, customers: importedCustomers, inventory: importedInventory, saleLines: importedLines, payments: importedPayments, missingCostCount, unmappedLocations: unmapped, dataPromotionEnabled: publishCanonical },
      });
      return jsonResponse({
        provider: CLOVER_PROVIDER, connectionId: connection.id,
        run: { id: runId, status: "completed", recordsRead, recordsStaged, warningCount },
        reconciliation: { orders: sales.length, saleLines: lines.length, payments: payments.length, products: normalizedProducts.length, customers: customers.length, inventoryBalances: normalizedProducts.length, locations: mappings.length, unmappedLocations: unmapped, missingItemCosts: missingCostCount, dailyMetrics: publishedMetrics },
        readyForReview: sales.length > 0 && warningCount === 0,
        stagingOnly: !publishCanonical,
        dataPromotionEnabled: publishCanonical,
        nextStep: publishCanonical ? "Clover data is synchronized and available across Vanteloq." : missingCostCount ? "Add item costs in Clover, then re-sync so gross profit can be calculated without estimates." : unmapped ? "Map the Clover merchant to a Vanteloq location, then review the import." : "Review and approve this Clover import, then run one final sync to publish it.",
      });
    } catch (error) {
      const code = error instanceof ApiError ? error.code : "CLOVER_SYNC_FAILED";
      await getDb().update(integrationSyncRuns).set({ status: "failed", errorCode: code, completedAt: new Date() }).where(eq(integrationSyncRuns.id, runId));
      await getDb().update(integrationConnections).set({ lastErrorCode: code, updatedAt: new Date() }).where(and(eq(integrationConnections.id, connection.id), eq(integrationConnections.organizationId, context.organizationId), eq(integrationConnections.provider, CLOVER_PROVIDER)));
      throw error;
    } finally {
      await releaseIntegrationSyncLease(lease);
    }
  });
}
