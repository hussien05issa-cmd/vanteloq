import { and, eq } from "drizzle-orm";
import { getD1, getDb } from "../../../../../../db";
import {
  integrationConnections,
  integrationLocationMappings,
  integrationSyncRuns,
} from "../../../../../../db/schema";
import { recordAudit } from "../../../../../../server/audit";
import { requireAccess } from "../../../../../../server/authorization";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, requireSameOrigin } from "../../../../../../server/api";
import {
  buildLightspeedRDailyMetrics,
  fetchLightspeedRAccount,
  fetchLightspeedRCollection,
  LIGHTSPEED_R_PROVIDER,
  normalizeLightspeedRInventoryItem,
  normalizeLightspeedRCustomer,
  normalizeLightspeedRProduct,
  normalizeLightspeedRSale,
  normalizeLightspeedRSaleLine,
  normalizeLightspeedRSaleLines,
  normalizeLightspeedRPayments,
  normalizeLightspeedRSupplier,
  lightspeedRPaymentTypeMap,
  lightspeedRSha256,
  type NormalizedLightspeedRSale,
} from "../../../../../../server/integrations/lightspeed-r";
import { requirePermission } from "../../../../../../server/permissions";
import {
  acquireIntegrationSyncLease,
  releaseIntegrationSyncLease,
  renewIntegrationSyncLease,
  requireOwnedIntegrationConnection,
  sqliteTimestampSeconds,
} from "../../../../../../server/integrations/connection";
import { scopeExternalRef } from "../../../../../../domain/integration-source";

const IMPORT_LABEL = "Lightspeed R-Series live sync";

type SyncCheckpoint = {
  version: 4;
  watermark: string | null;
  salesCursor: string | null;
  saleLinesCursor: string | null;
  itemsCursor: string | null;
  customersCursor: string | null;
  suppliersCursor: string | null;
  salesComplete: boolean;
  saleLinesComplete: boolean;
  itemsComplete: boolean;
  customersComplete: boolean;
  suppliersComplete: boolean;
};

type StagedSaleRow = Pick<NormalizedLightspeedRSale,
  "externalSaleId" | "outletRef" | "soldAt" | "state" | "totalCents" |
  "taxCents" | "costCents" | "discountCents" | "lineCount"
>;

function checkpoint(value: string | null): SyncCheckpoint {
  const empty: SyncCheckpoint = {
    version: 4,
    watermark: null,
    salesCursor: null,
    saleLinesCursor: null,
    itemsCursor: null,
    customersCursor: null,
    suppliersCursor: null,
    salesComplete: false,
    saleLinesComplete: false,
    itemsComplete: false,
    customersComplete: false,
    suppliersComplete: false,
  };
  if (!value) return empty;
  if (value.startsWith("https://api.lightspeedapp.com/") && value.includes("/Sale.json")) {
    return { ...empty, salesCursor: value };
  }
  if (!Number.isNaN(Date.parse(value))) return { ...empty, watermark: value };
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (parsed.version !== 1 && parsed.version !== 2 && parsed.version !== 3 && parsed.version !== 4) return empty;
    return {
      version: 4,
      watermark: typeof parsed.watermark === "string" ? parsed.watermark : null,
      salesCursor: typeof parsed.salesCursor === "string" ? parsed.salesCursor : null,
      saleLinesCursor: typeof parsed.saleLinesCursor === "string" ? parsed.saleLinesCursor : null,
      itemsCursor: typeof parsed.itemsCursor === "string" ? parsed.itemsCursor : null,
      customersCursor: typeof parsed.customersCursor === "string" ? parsed.customersCursor : null,
      suppliersCursor: typeof parsed.suppliersCursor === "string" ? parsed.suppliersCursor : null,
      salesComplete: parsed.salesComplete === true,
      saleLinesComplete: parsed.saleLinesComplete === true,
      itemsComplete: parsed.itemsComplete === true,
      customersComplete: parsed.customersComplete === true,
      suppliersComplete: parsed.suppliersComplete === true,
    };
  } catch {
    return empty;
  }
}

function nextCheckpoint(
  previous: SyncCheckpoint,
  completedAt: Date,
  salesCursor: string | null,
  saleLinesCursor: string | null,
  itemsCursor: string | null,
  customersCursor: string | null,
  suppliersCursor: string | null,
  salesComplete: boolean,
  saleLinesComplete: boolean,
  itemsComplete: boolean,
  customersComplete: boolean,
  suppliersComplete: boolean,
) {
  if (salesComplete && saleLinesComplete && itemsComplete && customersComplete && suppliersComplete) {
    return JSON.stringify({
      version: 4,
      watermark: completedAt.toISOString(),
      salesCursor: null,
      saleLinesCursor: null,
      itemsCursor: null,
      customersCursor: null,
      suppliersCursor: null,
      salesComplete: false,
      saleLinesComplete: false,
      itemsComplete: false,
      customersComplete: false,
      suppliersComplete: false,
    } satisfies SyncCheckpoint);
  }
  return JSON.stringify({
    version: 4,
    watermark: previous.watermark,
    salesCursor,
    saleLinesCursor,
    itemsCursor,
    customersCursor,
    suppliersCursor,
    salesComplete,
    saleLinesComplete,
    itemsComplete,
    customersComplete,
    suppliersComplete,
  } satisfies SyncCheckpoint);
}

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, ["owner", "admin"]);
    await requirePermission(context, "integrations.manage");
    const requested = await request.json().catch(() => ({})) as { reason?: unknown; connectionId?: unknown };
    // Older open tabs did not send a reason. Treat them as lightweight refreshes
    // so stale clients cannot accidentally start full catalog backfills.
    const reason = requested.reason === "manual" ? "manual" : "auto";
    const requestedConnectionId = typeof requested.connectionId === "string" ? requested.connectionId : null;
    const connection = await requireOwnedIntegrationConnection(context.organizationId, LIGHTSPEED_R_PROVIDER, requestedConnectionId, { connected: true });
    if (!connection?.externalAccountRef) {
      throw new ApiError(409, "LIGHTSPEED_R_NOT_CONNECTED", "Authorize R-Series before importing its data.");
    }
    if (reason === "auto") {
      return jsonResponse({
        provider: LIGHTSPEED_R_PROVIDER,
        connectionId: connection.id,
        skipped: true,
        stagingOnly: connection.dataPromotionStatus !== "approved",
        dataPromotionEnabled: connection.dataPromotionStatus === "approved",
        nextStep: "Automatic imports stay off while each R-Series refresh requires a reconciliation review.",
      });
    }
    const scopedRef = (value: string | null) => scopeExternalRef(connection.sourceNamespace, value);

    const startedAt = new Date();
    const syncLease = await acquireIntegrationSyncLease(context.organizationId, LIGHTSPEED_R_PROVIDER, connection.id);
    if (!syncLease) {
      const active = await getD1().prepare(`
        SELECT id, status, records_read AS recordsRead, records_staged AS recordsStaged,
               warning_count AS warningCount, completed_at AS completedAt
        FROM integration_sync_runs
        WHERE organization_id = ? AND provider = ? AND connection_id = ? AND status = 'running'
        ORDER BY started_at DESC LIMIT 1
      `).bind(context.organizationId, LIGHTSPEED_R_PROVIDER, connection.id).first();
      return jsonResponse({
        provider: LIGHTSPEED_R_PROVIDER,
        connectionId: connection.id,
        coalesced: true,
        run: active ?? { status: "running" },
        nextStep: "A sync for this account is already running. Vanteloq will refresh when it completes.",
      });
    }
    const runId = `lsr-${crypto.randomUUID()}`;
    const importId = `provider-${LIGHTSPEED_R_PROVIDER}-${runId}`;
    const previous = checkpoint(connection.lastSyncCursor);
    const claimed = await getDb().update(integrationConnections).set({
      lastErrorCode: null,
      updatedAt: startedAt,
    }).where(and(
      eq(integrationConnections.id, connection.id),
      eq(integrationConnections.organizationId, context.organizationId),
      eq(integrationConnections.provider, LIGHTSPEED_R_PROVIDER),
      eq(integrationConnections.status, "connected"),
      eq(integrationConnections.syncLeaseOwner, syncLease.owner),
      eq(integrationConnections.syncVersion, syncLease.version),
    )).returning({ id: integrationConnections.id });
    if (!claimed.length) {
      await releaseIntegrationSyncLease(syncLease);
      throw new ApiError(409, "INTEGRATION_SYNC_LEASE_LOST", "This synchronization was superseded before it could safely stage data.");
    }
    try {
      await getD1().prepare(`
      INSERT INTO integration_sync_runs
        (id, organization_id, provider, connection_id, mode, status, cursor_before, cursor_after,
         records_read, records_staged, duplicates_skipped, warning_count, error_code,
         started_at, completed_at, created_by_user_id)
      VALUES (?, ?, ?, ?, 'incremental', 'running', ?, NULL, 0, 0, 0, 0, NULL, ?, NULL, ?)
    `).bind(runId, context.organizationId, LIGHTSPEED_R_PROVIDER, connection.id, connection.lastSyncCursor, sqliteTimestampSeconds(startedAt.getTime()), context.userId).run();
      await enforceRateLimit("lightspeed-r:manual-sync", context.organizationId, 30, 3_600);
    } catch (error) {
      await getDb().update(integrationSyncRuns).set({
        status: "failed",
        errorCode: error instanceof ApiError ? error.code : "RATE_LIMIT_FAILED",
        completedAt: new Date(),
      }).where(and(
        eq(integrationSyncRuns.id, runId),
        eq(integrationSyncRuns.organizationId, context.organizationId),
      ));
      await getDb().update(integrationConnections).set({
        lastErrorCode: error instanceof ApiError ? error.code : "RATE_LIMIT_FAILED",
        updatedAt: new Date(),
      }).where(and(
        eq(integrationConnections.id, connection.id),
        eq(integrationConnections.organizationId, context.organizationId),
        eq(integrationConnections.provider, LIGHTSPEED_R_PROVIDER),
        eq(integrationConnections.syncLeaseOwner, syncLease.owner),
        eq(integrationConnections.syncVersion, syncLease.version),
      ));
      await releaseIntegrationSyncLease(syncLease);
      throw error;
    }

    try {
      const sourceAccount = await fetchLightspeedRAccount(context.organizationId, connection.id);
      if (sourceAccount && sourceAccount.accountId !== connection.externalAccountRef) {
        throw new ApiError(409, "LIGHTSPEED_R_ACCOUNT_CHANGED", "The authorized R-Series account changed. Reconnect it before importing data.");
      }
      const existingCommerce = await getD1().prepare(`
        SELECT
          (SELECT count(*) FROM commerce_products WHERE organization_id = ? AND provider = ? AND connection_id = ?) AS products,
          (SELECT count(*) FROM commerce_customers WHERE organization_id = ? AND provider = ? AND connection_id = ?) AS customers,
          (SELECT count(*) FROM commerce_suppliers WHERE organization_id = ? AND provider = ? AND connection_id = ?) AS suppliers,
          (SELECT count(*) FROM commerce_sale_lines WHERE organization_id = ? AND provider = ? AND connection_id = ?) AS saleLines,
          (SELECT count(*) FROM commerce_payments WHERE organization_id = ? AND provider = ? AND connection_id = ?) AS payments
      `).bind(
        context.organizationId, LIGHTSPEED_R_PROVIDER, connection.id,
        context.organizationId, LIGHTSPEED_R_PROVIDER, connection.id,
        context.organizationId, LIGHTSPEED_R_PROVIDER, connection.id,
        context.organizationId, LIGHTSPEED_R_PROVIDER, connection.id,
        context.organizationId, LIGHTSPEED_R_PROVIDER, connection.id,
      ).first<{ products: number; customers: number; suppliers: number; saleLines: number; payments: number }>();
      const salesPage = previous.salesComplete
        ? { data: [], pages: 0, cursor: null as string | null }
        : await fetchLightspeedRCollection(context.organizationId, connection.id, connection.externalAccountRef, "Sale", {
            maxPages: 3,
            cursor: previous.salesCursor,
            modifiedSince: previous.salesCursor ? null : previous.watermark,
            loadRelations: ["SaleLines", "SalePayments"],
          });
      // Do not make today's dashboard wait behind a long historical backfill.
      // R-Series supports timestamp filters on collection reads, so every run
      // also stages the newest 24 hours before continuing the saved cursor.
      const recentSalesPage = await fetchLightspeedRCollection(
        context.organizationId,
        connection.id,
        connection.externalAccountRef,
        "Sale",
        {
          maxPages: 1,
          modifiedSince: new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString(),
          loadRelations: ["SaleLines", "SalePayments"],
        },
      );
      const paymentTypesPage = await fetchLightspeedRCollection(
        context.organizationId,
        connection.id,
        connection.externalAccountRef,
        "PaymentType",
        { maxPages: 3 },
      );
      const saleLinesPage = previous.saleLinesComplete && Number(existingCommerce?.saleLines ?? 0) > 0
        ? { data: [], pages: 0, cursor: null as string | null }
        : await fetchLightspeedRCollection(context.organizationId, connection.id, connection.externalAccountRef, "SaleLine", {
            maxPages: 3,
            cursor: previous.saleLinesCursor,
            modifiedSince: previous.saleLinesCursor || Number(existingCommerce?.saleLines ?? 0) === 0
              ? null
              : previous.watermark,
          });
      const itemsPage = previous.itemsComplete && Number(existingCommerce?.products ?? 0) > 0
        ? { data: [], pages: 0, cursor: null as string | null }
        : await fetchLightspeedRCollection(context.organizationId, connection.id, connection.externalAccountRef, "Item", {
            maxPages: 3,
            cursor: previous.itemsCursor,
            modifiedSince: previous.itemsCursor || Number(existingCommerce?.products ?? 0) === 0
              ? null
              : previous.watermark,
            loadRelations: ["ItemShops", "Prices"],
          });
      const customersPage = previous.customersComplete && Number(existingCommerce?.customers ?? 0) > 0
        ? { data: [], pages: 0, cursor: null as string | null }
        : await fetchLightspeedRCollection(context.organizationId, connection.id, connection.externalAccountRef, "Customer", {
            maxPages: 2,
            cursor: previous.customersCursor,
            modifiedSince: previous.customersCursor || Number(existingCommerce?.customers ?? 0) === 0
              ? null
              : previous.watermark,
          });
      const suppliersPage = previous.suppliersComplete && Number(existingCommerce?.suppliers ?? 0) > 0
        ? { data: [], pages: 0, cursor: null as string | null }
        : await fetchLightspeedRCollection(context.organizationId, connection.id, connection.externalAccountRef, "Vendor", {
            maxPages: 2,
            cursor: previous.suppliersCursor,
            modifiedSince: previous.suppliersCursor || Number(existingCommerce?.suppliers ?? 0) === 0
              ? null
              : previous.watermark,
          });

      const normalizedSales: NormalizedLightspeedRSale[] = [];
      const normalizedSaleLines = [];
      const inventoryBalances = [];
      const products = [];
      const customers = [];
      const suppliers = [];
      const payments = [];
      const paymentTypes = lightspeedRPaymentTypeMap(paymentTypesPage.data);
      let warnings = 0;
      for (const source of [...recentSalesPage.data, ...salesPage.data]) {
        try {
          normalizedSales.push(await normalizeLightspeedRSale(source));
          normalizedSaleLines.push(...await normalizeLightspeedRSaleLines(source));
          payments.push(...await normalizeLightspeedRPayments(source, paymentTypes));
        } catch { warnings += 1; }
      }
      for (const source of saleLinesPage.data) {
        try { normalizedSaleLines.push(await normalizeLightspeedRSaleLine(source)); } catch { warnings += 1; }
      }
      for (const source of itemsPage.data) {
        // Catalog identity remains valid even when a particular shop-level
        // quantity relation is incomplete. Validate the two facts separately.
        try { products.push(await normalizeLightspeedRProduct(source)); } catch { warnings += 1; }
        try { inventoryBalances.push(...normalizeLightspeedRInventoryItem(source)); } catch { warnings += 1; }
      }
      for (const source of customersPage.data) {
        try { customers.push(await normalizeLightspeedRCustomer(source)); } catch { warnings += 1; }
      }
      for (const source of suppliersPage.data) {
        try { suppliers.push(await normalizeLightspeedRSupplier(source)); } catch { warnings += 1; }
      }
      const uniqueSales = [...new Map(normalizedSales.map((sale) => [`${sale.externalSaleId}:${sale.externalVersion}`, sale])).values()];
      const uniqueSaleLines = [...new Map(normalizedSaleLines.map((line) => [`${line.externalSaleId}:${line.externalLineId}`, line])).values()];
      const uniquePayments = [...new Map(payments.map((payment) => [payment.externalPaymentId, payment])).values()];
      // SaleLine is also a trustworthy catalog identity source. Preserve sold
      // products even if R-Series omits Item rows or a shop relation is partial;
      // later Item pages enrich these records with names, cost, price and stock.
      const knownProductRefs = new Set(products.map((product) => product.externalProductId));
      for (const line of warnings === 0 ? uniqueSaleLines : []) {
        if (!line.productRef || knownProductRefs.has(line.productRef)) continue;
        const fallback = {
          externalProductId: line.productRef,
          sku: line.sku || line.productRef,
          name: line.productName || line.sku || `R-Series item ${line.productRef}`,
          categoryRef: null,
          supplierRef: null,
          defaultCostCents: null,
          defaultPriceCents: null,
          archived: false,
          sourceUpdatedAt: line.soldAt,
        };
        products.push({ ...fallback, sourcePayloadHash: await lightspeedRSha256(JSON.stringify(fallback)) });
        knownProductRefs.add(line.productRef);
      }

      await renewIntegrationSyncLease(syncLease);

      const database = getD1();
      const ignoredMappings = await getDb().select({ externalLocationRef: integrationLocationMappings.externalLocationRef })
        .from(integrationLocationMappings).where(and(
          eq(integrationLocationMappings.organizationId, context.organizationId),
          eq(integrationLocationMappings.provider, LIGHTSPEED_R_PROVIDER),
          eq(integrationLocationMappings.connectionId, connection.id),
          eq(integrationLocationMappings.status, "ignored"),
        ));
      const ignoredRaw = new Set(ignoredMappings.map((row) => row.externalLocationRef));
      const ignored = new Set(ignoredMappings.map((row) => scopedRef(row.externalLocationRef)).filter((value): value is string => Boolean(value)));
      let stagedSales = 0;
      for (const sale of warnings === 0 ? uniqueSales : []) {
        const result = await database.prepare(`
          INSERT OR IGNORE INTO integration_staged_sales
            (id, organization_id, provider, connection_id, external_sale_id, external_version, outlet_ref, sold_at, state,
             total_cents, tax_cents, cost_cents, discount_cents, line_count, source_payload_hash, sync_run_id, staged_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          crypto.randomUUID(), context.organizationId, LIGHTSPEED_R_PROVIDER, connection.id,
          scopedRef(sale.externalSaleId), sale.externalVersion, scopedRef(sale.outletRef), sale.soldAt, sale.state,
          sale.totalCents, sale.taxCents, sale.costCents, sale.discountCents, sale.lineCount,
          sale.sourcePayloadHash, runId, Date.now(),
        ).run();
        stagedSales += Number(result.meta.changes ?? 0);
      }
      let importedSaleLines = 0;
      for (const line of warnings === 0 ? uniqueSaleLines.filter((row) => !row.outletRef || !ignoredRaw.has(row.outletRef)) : []) {
        const result = await database.prepare(`
          INSERT INTO commerce_sale_lines
            (id, organization_id, provider, connection_id, external_sale_id, external_line_id, product_ref, customer_ref,
             outlet_ref, sold_at, sku, product_name, quantity_milli, net_sales_cents, cost_cents,
             discount_cents, source_payload_hash, sync_run_id, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(organization_id, provider, connection_id, external_sale_id, external_line_id) DO UPDATE SET
            product_ref = excluded.product_ref, customer_ref = excluded.customer_ref,
            outlet_ref = excluded.outlet_ref, sold_at = excluded.sold_at, sku = excluded.sku,
            product_name = excluded.product_name, quantity_milli = excluded.quantity_milli,
            net_sales_cents = excluded.net_sales_cents, cost_cents = excluded.cost_cents,
            discount_cents = excluded.discount_cents, source_payload_hash = excluded.source_payload_hash,
            sync_run_id = excluded.sync_run_id, updated_at = excluded.updated_at
        `).bind(
          crypto.randomUUID(), context.organizationId, LIGHTSPEED_R_PROVIDER, connection.id, scopedRef(line.externalSaleId),
          scopedRef(line.externalLineId), scopedRef(line.productRef), scopedRef(line.customerRef), scopedRef(line.outletRef), line.soldAt,
          line.sku, line.productName, line.quantityMilli, line.netSalesCents, line.costCents,
          line.discountCents, line.sourcePayloadHash, runId, Date.now(),
        ).run();
        importedSaleLines += Number(result.meta.changes ?? 0);
      }
      let importedPayments = 0;
      for (const payment of warnings === 0 ? uniquePayments.filter((row) => !row.outletRef || !ignoredRaw.has(row.outletRef)) : []) {
        const result = await database.prepare(`
          INSERT INTO commerce_payments
            (id, organization_id, provider, connection_id, external_payment_id, external_sale_id, payment_type_ref,
             payment_type_name, category, amount_cents, paid_at, outlet_ref, source_payload_hash,
             sync_run_id, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(organization_id, provider, connection_id, external_payment_id) DO UPDATE SET
            external_sale_id = excluded.external_sale_id, payment_type_ref = excluded.payment_type_ref,
            payment_type_name = excluded.payment_type_name, category = excluded.category,
            amount_cents = excluded.amount_cents, paid_at = excluded.paid_at, outlet_ref = excluded.outlet_ref,
            source_payload_hash = excluded.source_payload_hash, sync_run_id = excluded.sync_run_id,
            updated_at = excluded.updated_at
        `).bind(
          crypto.randomUUID(), context.organizationId, LIGHTSPEED_R_PROVIDER, connection.id, scopedRef(payment.externalPaymentId),
          scopedRef(payment.externalSaleId), scopedRef(payment.paymentTypeRef), payment.paymentTypeName, payment.category,
          payment.amountCents, payment.paidAt, scopedRef(payment.outletRef), payment.sourcePayloadHash, runId, Date.now(),
        ).run();
        importedPayments += Number(result.meta.changes ?? 0);
      }

      const latest = await database.prepare(`
        SELECT external_sale_id AS externalSaleId, outlet_ref AS outletRef, sold_at AS soldAt, state,
               total_cents AS totalCents, tax_cents AS taxCents, cost_cents AS costCents,
               discount_cents AS discountCents, line_count AS lineCount
        FROM (
          SELECT *, row_number() OVER (
            PARTITION BY external_sale_id ORDER BY staged_at DESC, id DESC
          ) AS version_rank
          FROM integration_staged_sales
          WHERE organization_id = ? AND provider = ? AND connection_id = ?
        )
        WHERE version_rank = 1
      `).bind(context.organizationId, LIGHTSPEED_R_PROVIDER, connection.id).all<StagedSaleRow>();
      const dailyMetrics = warnings === 0
        ? buildLightspeedRDailyMetrics(
            (latest.results ?? []).filter((sale) => !sale.outletRef || !ignored.has(sale.outletRef)),
          )
        : [];
      const publishCanonical = connection.dataPromotionStatus === "approved" && warnings === 0;
      const publishedDailyMetrics = publishCanonical ? dailyMetrics : [];

      const now = Date.now();
      await database.prepare(`
        INSERT INTO data_imports
          (id, organization_id, import_type, status, file_name, row_count, idempotency_key, imported_by_user_id, created_at)
        VALUES (?, ?, 'manual_entry', 'processing', ?, 0, ?, ?, ?)
      `).bind(importId, context.organizationId, IMPORT_LABEL, runId, context.userId, now).run();

      if (publishCanonical) {
        await database.prepare(`
          DELETE FROM daily_business_metrics
          WHERE organization_id = ? AND location_ref IN (
            SELECT ? || ':' || CASE WHEN ? = 'legacy' THEN external_location_ref ELSE ? || ':' || external_location_ref END
            FROM integration_location_mappings
            WHERE organization_id = ? AND provider = ? AND connection_id = ?
          )
        `).bind(
          context.organizationId, LIGHTSPEED_R_PROVIDER, connection.sourceNamespace,
          connection.sourceNamespace, context.organizationId, LIGHTSPEED_R_PROVIDER, connection.id,
        ).run();

        for (const row of publishedDailyMetrics) {
          await database.prepare(`
          INSERT INTO daily_business_metrics (
            organization_id, business_date, location_ref, gross_sales_cents, net_sales_cents,
            cost_of_goods_cents, transaction_count, units_sold, refunds_cents, discounts_cents,
            labour_cost_cents, inventory_value_cents, cash_balance_cents, accounts_payable_cents,
            source_provider, source_connection_id, source_import_id, created_by_user_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(organization_id, business_date, location_ref) DO UPDATE SET
            gross_sales_cents = excluded.gross_sales_cents,
            net_sales_cents = excluded.net_sales_cents,
            cost_of_goods_cents = excluded.cost_of_goods_cents,
            transaction_count = excluded.transaction_count,
            units_sold = excluded.units_sold,
            refunds_cents = excluded.refunds_cents,
            discounts_cents = excluded.discounts_cents,
            source_provider = excluded.source_provider,
            source_connection_id = excluded.source_connection_id,
            source_import_id = excluded.source_import_id,
            updated_at = excluded.updated_at
          `).bind(
            context.organizationId, row.businessDate, row.locationRef, row.grossSalesCents,
            row.netSalesCents, row.costOfGoodsCents, row.transactionCount, row.unitsSold,
            row.refundsCents, row.discountsCents, LIGHTSPEED_R_PROVIDER, connection.id,
            importId, context.userId, now, now,
          ).run();
        }
      }

      let importedInventory = 0;
      if (publishCanonical) {
        for (const balance of inventoryBalances) {
          if (ignoredRaw.has(balance.outletRef)) continue;
          const result = await database.prepare(`
          INSERT INTO inventory_balances
            (id, organization_id, location_ref, sku, name, on_hand_quantity, reorder_point, version,
             source_provider, source_connection_id, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
          ON CONFLICT(organization_id, location_ref, sku) DO UPDATE SET
            name = excluded.name,
            on_hand_quantity = excluded.on_hand_quantity,
            reorder_point = excluded.reorder_point,
            version = inventory_balances.version + 1,
            source_provider = excluded.source_provider,
            source_connection_id = excluded.source_connection_id,
            updated_at = excluded.updated_at
          `).bind(
            crypto.randomUUID(), context.organizationId, `${LIGHTSPEED_R_PROVIDER}:${scopedRef(balance.outletRef)}`,
            balance.sku, balance.name, balance.onHandQuantity, balance.reorderPoint,
            LIGHTSPEED_R_PROVIDER, connection.id, now,
          ).run();
          importedInventory += Number(result.meta.changes ?? 0);
        }
      }
      let importedProducts = 0;
      for (const product of warnings === 0 ? products : []) {
        const result = await database.prepare(`
          INSERT INTO commerce_products
            (id, organization_id, provider, connection_id, external_product_id, sku, name, category_ref, supplier_ref,
             default_cost_cents, default_price_cents, archived, source_updated_at, source_payload_hash,
             sync_run_id, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(organization_id, provider, connection_id, external_product_id) DO UPDATE SET
            sku = excluded.sku, name = excluded.name, category_ref = excluded.category_ref,
            supplier_ref = excluded.supplier_ref, default_cost_cents = excluded.default_cost_cents,
            default_price_cents = excluded.default_price_cents, archived = excluded.archived,
            source_updated_at = excluded.source_updated_at, source_payload_hash = excluded.source_payload_hash,
            sync_run_id = excluded.sync_run_id, updated_at = excluded.updated_at
        `).bind(
          crypto.randomUUID(), context.organizationId, LIGHTSPEED_R_PROVIDER, connection.id, scopedRef(product.externalProductId),
          product.sku, product.name, scopedRef(product.categoryRef), scopedRef(product.supplierRef), product.defaultCostCents,
          product.defaultPriceCents, product.archived ? 1 : 0, product.sourceUpdatedAt,
          product.sourcePayloadHash, runId, now,
        ).run();
        importedProducts += Number(result.meta.changes ?? 0);
      }
      let importedCustomers = 0;
      for (const customer of warnings === 0 ? customers : []) {
        const result = await database.prepare(`
          INSERT INTO commerce_customers
            (id, organization_id, provider, connection_id, external_customer_id, display_name, first_name, last_name,
             email, phone, archived, source_updated_at, source_payload_hash, sync_run_id, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(organization_id, provider, connection_id, external_customer_id) DO UPDATE SET
            display_name = excluded.display_name, first_name = excluded.first_name, last_name = excluded.last_name,
            email = excluded.email, phone = excluded.phone, archived = excluded.archived,
            source_updated_at = excluded.source_updated_at, source_payload_hash = excluded.source_payload_hash,
            sync_run_id = excluded.sync_run_id, updated_at = excluded.updated_at
        `).bind(
          crypto.randomUUID(), context.organizationId, LIGHTSPEED_R_PROVIDER, connection.id, scopedRef(customer.externalCustomerId),
          customer.displayName, customer.firstName, customer.lastName, customer.email, customer.phone,
          customer.archived ? 1 : 0, customer.sourceUpdatedAt, customer.sourcePayloadHash, runId, now,
        ).run();
        importedCustomers += Number(result.meta.changes ?? 0);
      }
      let importedSuppliers = 0;
      for (const supplier of warnings === 0 ? suppliers : []) {
        const result = await database.prepare(`
          INSERT INTO commerce_suppliers
            (id, organization_id, provider, connection_id, external_supplier_id, name, account_number, contact_name,
             email, phone, archived, source_updated_at, source_payload_hash, sync_run_id, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(organization_id, provider, connection_id, external_supplier_id) DO UPDATE SET
            name = excluded.name, account_number = excluded.account_number, contact_name = excluded.contact_name,
            email = excluded.email, phone = excluded.phone, archived = excluded.archived,
            source_updated_at = excluded.source_updated_at, source_payload_hash = excluded.source_payload_hash,
            sync_run_id = excluded.sync_run_id, updated_at = excluded.updated_at
        `).bind(
          crypto.randomUUID(), context.organizationId, LIGHTSPEED_R_PROVIDER, connection.id, scopedRef(supplier.externalSupplierId),
          supplier.name, supplier.accountNumber, supplier.contactName, supplier.email, supplier.phone,
          supplier.archived ? 1 : 0, supplier.sourceUpdatedAt, supplier.sourcePayloadHash, runId, now,
        ).run();
        importedSuppliers += Number(result.meta.changes ?? 0);
      }
      await database.prepare(`
        UPDATE data_imports SET status = 'completed', row_count = ?
        WHERE id = ? AND organization_id = ?
      `).bind(publishedDailyMetrics.length + importedInventory + importedProducts + importedCustomers + importedSuppliers + importedSaleLines + importedPayments, importId, context.organizationId).run();

      const completedAt = new Date();
      const salesComplete = previous.salesComplete || salesPage.cursor === null;
      const saleLinesComplete = previous.saleLinesComplete || saleLinesPage.cursor === null;
      const itemsComplete = previous.itemsComplete || itemsPage.cursor === null;
      const customersComplete = previous.customersComplete || customersPage.cursor === null;
      const suppliersComplete = previous.suppliersComplete || suppliersPage.cursor === null;
      const backfillComplete = salesComplete && saleLinesComplete && itemsComplete && customersComplete && suppliersComplete;
      const computedCheckpoint = nextCheckpoint(
        previous,
        completedAt,
        salesPage.cursor,
        saleLinesPage.cursor,
        itemsPage.cursor,
        customersPage.cursor,
        suppliersPage.cursor,
        salesComplete,
        saleLinesComplete,
        itemsComplete,
        customersComplete,
        suppliersComplete,
      );
      const safeCheckpoint = warnings > 0 ? connection.lastSyncCursor : computedCheckpoint;
      const recordsRead = recentSalesPage.data.length + salesPage.data.length + saleLinesPage.data.length + itemsPage.data.length + customersPage.data.length + suppliersPage.data.length + paymentTypesPage.data.length;
      const recordsImported = publishedDailyMetrics.length + importedInventory + importedProducts + importedCustomers + importedSuppliers + importedSaleLines + importedPayments;
      const duplicatesSkipped = uniqueSales.length - stagedSales;
      const promotionStatus = connection.dataPromotionStatus === "approved" ? "approved" : "staging";
      await renewIntegrationSyncLease(syncLease);
      await getDb().update(integrationSyncRuns).set({
        status: "completed",
        cursorAfter: safeCheckpoint,
        recordsRead,
        recordsStaged: stagedSales + importedInventory + importedProducts + importedCustomers + importedSuppliers + importedSaleLines + importedPayments,
        duplicatesSkipped,
        warningCount: warnings,
        completedAt,
      }).where(eq(integrationSyncRuns.id, runId));
      const promoted = await getDb().update(integrationConnections).set({
        externalAccountName: sourceAccount?.name ?? connection.externalAccountName,
        lastSuccessfulSyncAt: warnings > 0 ? connection.lastSuccessfulSyncAt : completedAt,
        lastSyncCursor: safeCheckpoint,
        dataPromotionStatus: promotionStatus,
        lastErrorCode: warnings > 0 ? "LIGHTSPEED_R_RECONCILIATION_WARNINGS" : null,
        syncLeaseOwner: null,
        syncLeaseExpiresAt: null,
        updatedAt: completedAt,
      }).where(and(
        eq(integrationConnections.id, connection.id),
        eq(integrationConnections.organizationId, context.organizationId),
        eq(integrationConnections.provider, LIGHTSPEED_R_PROVIDER),
        eq(integrationConnections.syncLeaseOwner, syncLease.owner),
        eq(integrationConnections.syncVersion, syncLease.version),
      )).returning({ id: integrationConnections.id });
      if (!promoted.length) {
        throw new ApiError(409, "INTEGRATION_SYNC_LEASE_LOST", "This synchronization was superseded before it could safely publish data.");
      }
      await recordAudit({
        request,
        requestId,
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "integration.data_imported",
        resourceType: "integration_sync_run",
        resourceId: runId,
        details: {
          provider: LIGHTSPEED_R_PROVIDER,
          connectionId: connection.id,
          recordsRead,
          stagedSales,
          dailyMetrics: publishedDailyMetrics.length,
          inventoryBalances: importedInventory,
          products: importedProducts,
          customers: importedCustomers,
          suppliers: importedSuppliers,
          saleLines: importedSaleLines,
          payments: importedPayments,
          duplicatesSkipped,
          warningCount: warnings,
          publishedCanonical: publishCanonical,
          usingLastApprovedData: promotionStatus === "approved" && !publishCanonical,
          dataPromotionEnabled: promotionStatus === "approved",
        },
      });

      return jsonResponse({
        provider: LIGHTSPEED_R_PROVIDER,
        connectionId: connection.id,
        run: {
          id: runId,
          status: "completed",
          recordsRead,
          recordsStaged: stagedSales + importedInventory + importedProducts + importedCustomers + importedSuppliers + importedSaleLines + importedPayments,
          duplicatesSkipped,
          warningCount: warnings,
          pages: recentSalesPage.pages + salesPage.pages + saleLinesPage.pages + itemsPage.pages + customersPage.pages + suppliersPage.pages + paymentTypesPage.pages,
          cursorPreserved: safeCheckpoint,
        },
        reconciliation: {
          sourceRecords: recordsRead,
          stagedRecords: stagedSales,
          duplicateRecords: duplicatesSkipped,
          completedSales: uniqueSales.filter((sale) => sale.state === "completed").length,
          openSales: uniqueSales.filter((sale) => sale.state === "open").length,
          voidedSales: uniqueSales.filter((sale) => sale.state === "voided").length,
          dailyMetrics: publishedDailyMetrics.length,
          inventoryBalances: importedInventory,
          products: importedProducts,
          customers: importedCustomers,
          suppliers: importedSuppliers,
          saleLines: importedSaleLines,
          payments: importedPayments,
        },
        imported: {
          dailyMetrics: publishedDailyMetrics.length,
          inventoryBalances: importedInventory,
          products: importedProducts,
          customers: importedCustomers,
          suppliers: importedSuppliers,
          saleLines: importedSaleLines,
          payments: importedPayments,
        },
        stagingOnly: promotionStatus !== "approved",
        dataPromotionEnabled: promotionStatus === "approved",
        publishedCanonical: publishCanonical,
        usingLastApprovedData: promotionStatus === "approved" && !publishCanonical,
        readyForReview: warnings === 0 && backfillComplete && promotionStatus !== "approved",
        nextStep: warnings > 0
          ? `Imported ${recordsImported} verified records. ${warnings} source record${warnings === 1 ? " needs" : "s need"} attention before the sync cursor can advance.`
          : promotionStatus === "approved"
            ? "R-Series is current and the approved records are available to dashboard features."
          : backfillComplete
            ? `R-Series is current. Review the reconciliation, then approve this account before its records affect dashboard results.`
            : `Imported ${recordsImported} records. Run sync again to continue the remaining R-Series backfill before approval.` ,
      });
    } catch (error) {
      const code = error instanceof ApiError ? error.code : "LIGHTSPEED_R_SYNC_FAILED";
      await getD1().prepare(`UPDATE data_imports SET status = 'failed' WHERE id = ? AND organization_id = ?`)
        .bind(importId, context.organizationId).run().catch(() => undefined);
      await getDb().update(integrationSyncRuns).set({
        status: "failed",
        errorCode: code,
        completedAt: new Date(),
      }).where(eq(integrationSyncRuns.id, runId));
      await getDb().update(integrationConnections).set({
        lastErrorCode: code,
        updatedAt: new Date(),
      }).where(and(
        eq(integrationConnections.id, connection.id),
        eq(integrationConnections.organizationId, context.organizationId),
        eq(integrationConnections.provider, LIGHTSPEED_R_PROVIDER),
        eq(integrationConnections.syncLeaseOwner, syncLease.owner),
        eq(integrationConnections.syncVersion, syncLease.version),
      ));
      await releaseIntegrationSyncLease(syncLease);
      throw error;
    }
  });
}
