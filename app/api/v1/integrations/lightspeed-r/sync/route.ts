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
    const requested = await request.json().catch(() => ({})) as { reason?: unknown };
    // Older open tabs did not send a reason. Treat them as lightweight refreshes
    // so stale clients cannot accidentally start full catalog backfills.
    const reason = requested.reason === "manual" ? "manual" : "auto";
    const [connection] = await getDb().select().from(integrationConnections).where(and(
      eq(integrationConnections.organizationId, context.organizationId),
      eq(integrationConnections.provider, LIGHTSPEED_R_PROVIDER),
      eq(integrationConnections.status, "connected"),
    )).limit(1);
    if (!connection?.externalAccountRef) {
      throw new ApiError(409, "LIGHTSPEED_R_NOT_CONNECTED", "Authorize R-Series before importing its data.");
    }

    const startedAt = new Date();
    const leaseWindowMs = reason === "auto" ? 5 * 60_000 : 60_000;
    const leaseBucket = Math.floor(startedAt.getTime() / leaseWindowMs);
    const runId = `lsr-${(await lightspeedRSha256(`${context.organizationId}:${leaseBucket}:${reason}`)).slice(0, 40)}`;
    const importId = `provider-${LIGHTSPEED_R_PROVIDER}-${runId}`;
    const previous = checkpoint(connection.lastSyncCursor);
    const lease = await getD1().prepare(`
      INSERT OR IGNORE INTO integration_sync_runs
        (id, organization_id, provider, mode, status, cursor_before, cursor_after,
         records_read, records_staged, duplicates_skipped, warning_count, error_code,
         started_at, completed_at, created_by_user_id)
      VALUES (?, ?, ?, 'incremental', 'running', ?, NULL, 0, 0, 0, 0, NULL, ?, NULL, ?)
    `).bind(runId, context.organizationId, LIGHTSPEED_R_PROVIDER, connection.lastSyncCursor, startedAt.getTime(), context.userId).run();
    if (Number(lease.meta.changes ?? 0) === 0) {
      const active = await getD1().prepare(`
        SELECT status, records_read AS recordsRead, records_staged AS recordsStaged,
               warning_count AS warningCount, completed_at AS completedAt
        FROM integration_sync_runs WHERE id = ? AND organization_id = ?
      `).bind(runId, context.organizationId).first();
      return jsonResponse({
        provider: LIGHTSPEED_R_PROVIDER,
        coalesced: true,
        run: { id: runId, ...(active ?? { status: "running" }) },
        nextStep: active?.status === "completed"
          ? "This account is already current for this sync window. No duplicate provider request was sent."
          : "A sync for this account is already running. Vanteloq will refresh when it completes.",
      });
    }
    try {
      await enforceRateLimit(`lightspeed-r:${reason}-sync`, context.organizationId, reason === "auto" ? 18 : 30, 3_600);
    } catch (error) {
      await getDb().update(integrationSyncRuns).set({
        status: "failed",
        errorCode: error instanceof ApiError ? error.code : "RATE_LIMIT_FAILED",
        completedAt: new Date(),
      }).where(and(
        eq(integrationSyncRuns.id, runId),
        eq(integrationSyncRuns.organizationId, context.organizationId),
      ));
      throw error;
    }

    try {
      const sourceAccount = reason === "manual"
        ? await fetchLightspeedRAccount(context.organizationId)
        : null;
      if (sourceAccount && sourceAccount.accountId !== connection.externalAccountRef) {
        throw new ApiError(409, "LIGHTSPEED_R_ACCOUNT_CHANGED", "The authorized R-Series account changed. Reconnect it before importing data.");
      }
      const existingCommerce = await getD1().prepare(`
        SELECT
          (SELECT count(*) FROM commerce_products WHERE organization_id = ? AND provider = ?) AS products,
          (SELECT count(*) FROM commerce_customers WHERE organization_id = ? AND provider = ?) AS customers,
          (SELECT count(*) FROM commerce_suppliers WHERE organization_id = ? AND provider = ?) AS suppliers,
          (SELECT count(*) FROM commerce_sale_lines WHERE organization_id = ? AND provider = ?) AS saleLines,
          (SELECT count(*) FROM commerce_payments WHERE organization_id = ? AND provider = ?) AS payments
      `).bind(
        context.organizationId, LIGHTSPEED_R_PROVIDER,
        context.organizationId, LIGHTSPEED_R_PROVIDER,
        context.organizationId, LIGHTSPEED_R_PROVIDER,
        context.organizationId, LIGHTSPEED_R_PROVIDER,
        context.organizationId, LIGHTSPEED_R_PROVIDER,
      ).first<{ products: number; customers: number; suppliers: number; saleLines: number; payments: number }>();
      const salesPage = reason === "auto" || previous.salesComplete
        ? { data: [], pages: 0, cursor: null as string | null }
        : await fetchLightspeedRCollection(context.organizationId, connection.externalAccountRef, "Sale", {
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
        connection.externalAccountRef,
        "PaymentType",
        { maxPages: 3 },
      );
      const saleLinesPage = reason === "auto" || (previous.saleLinesComplete && Number(existingCommerce?.saleLines ?? 0) > 0)
        ? { data: [], pages: 0, cursor: null as string | null }
        : await fetchLightspeedRCollection(context.organizationId, connection.externalAccountRef, "SaleLine", {
            maxPages: 3,
            cursor: previous.saleLinesCursor,
            modifiedSince: previous.saleLinesCursor || Number(existingCommerce?.saleLines ?? 0) === 0
              ? null
              : previous.watermark,
          });
      const itemsPage = reason === "auto" || (previous.itemsComplete && Number(existingCommerce?.products ?? 0) > 0)
        ? { data: [], pages: 0, cursor: null as string | null }
        : await fetchLightspeedRCollection(context.organizationId, connection.externalAccountRef, "Item", {
            maxPages: 3,
            cursor: previous.itemsCursor,
            modifiedSince: previous.itemsCursor || Number(existingCommerce?.products ?? 0) === 0
              ? null
              : previous.watermark,
            loadRelations: ["ItemShops", "Prices"],
          });
      const customersPage = reason === "auto" || (previous.customersComplete && Number(existingCommerce?.customers ?? 0) > 0)
        ? { data: [], pages: 0, cursor: null as string | null }
        : await fetchLightspeedRCollection(context.organizationId, connection.externalAccountRef, "Customer", {
            maxPages: 2,
            cursor: previous.customersCursor,
            modifiedSince: previous.customersCursor || Number(existingCommerce?.customers ?? 0) === 0
              ? null
              : previous.watermark,
          });
      const suppliersPage = reason === "auto" || (previous.suppliersComplete && Number(existingCommerce?.suppliers ?? 0) > 0)
        ? { data: [], pages: 0, cursor: null as string | null }
        : await fetchLightspeedRCollection(context.organizationId, connection.externalAccountRef, "Vendor", {
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
      for (const line of uniqueSaleLines) {
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

      const database = getD1();
      let stagedSales = 0;
      for (const sale of uniqueSales) {
        const result = await database.prepare(`
          INSERT OR IGNORE INTO integration_staged_sales
            (id, organization_id, provider, external_sale_id, external_version, outlet_ref, sold_at, state,
             total_cents, tax_cents, cost_cents, discount_cents, line_count, source_payload_hash, sync_run_id, staged_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          crypto.randomUUID(), context.organizationId, LIGHTSPEED_R_PROVIDER,
          sale.externalSaleId, sale.externalVersion, sale.outletRef, sale.soldAt, sale.state,
          sale.totalCents, sale.taxCents, sale.costCents, sale.discountCents, sale.lineCount,
          sale.sourcePayloadHash, runId, Date.now(),
        ).run();
        stagedSales += Number(result.meta.changes ?? 0);
      }
      let importedSaleLines = 0;
      for (const line of uniqueSaleLines) {
        const result = await database.prepare(`
          INSERT INTO commerce_sale_lines
            (id, organization_id, provider, external_sale_id, external_line_id, product_ref, customer_ref,
             outlet_ref, sold_at, sku, product_name, quantity_milli, net_sales_cents, cost_cents,
             discount_cents, source_payload_hash, sync_run_id, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(organization_id, provider, external_sale_id, external_line_id) DO UPDATE SET
            product_ref = excluded.product_ref, customer_ref = excluded.customer_ref,
            outlet_ref = excluded.outlet_ref, sold_at = excluded.sold_at, sku = excluded.sku,
            product_name = excluded.product_name, quantity_milli = excluded.quantity_milli,
            net_sales_cents = excluded.net_sales_cents, cost_cents = excluded.cost_cents,
            discount_cents = excluded.discount_cents, source_payload_hash = excluded.source_payload_hash,
            sync_run_id = excluded.sync_run_id, updated_at = excluded.updated_at
        `).bind(
          crypto.randomUUID(), context.organizationId, LIGHTSPEED_R_PROVIDER, line.externalSaleId,
          line.externalLineId, line.productRef, line.customerRef, line.outletRef, line.soldAt,
          line.sku, line.productName, line.quantityMilli, line.netSalesCents, line.costCents,
          line.discountCents, line.sourcePayloadHash, runId, Date.now(),
        ).run();
        importedSaleLines += Number(result.meta.changes ?? 0);
      }
      let importedPayments = 0;
      for (const payment of uniquePayments) {
        const result = await database.prepare(`
          INSERT INTO commerce_payments
            (id, organization_id, provider, external_payment_id, external_sale_id, payment_type_ref,
             payment_type_name, category, amount_cents, paid_at, outlet_ref, source_payload_hash,
             sync_run_id, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(organization_id, provider, external_payment_id) DO UPDATE SET
            external_sale_id = excluded.external_sale_id, payment_type_ref = excluded.payment_type_ref,
            payment_type_name = excluded.payment_type_name, category = excluded.category,
            amount_cents = excluded.amount_cents, paid_at = excluded.paid_at, outlet_ref = excluded.outlet_ref,
            source_payload_hash = excluded.source_payload_hash, sync_run_id = excluded.sync_run_id,
            updated_at = excluded.updated_at
        `).bind(
          crypto.randomUUID(), context.organizationId, LIGHTSPEED_R_PROVIDER, payment.externalPaymentId,
          payment.externalSaleId, payment.paymentTypeRef, payment.paymentTypeName, payment.category,
          payment.amountCents, payment.paidAt, payment.outletRef, payment.sourcePayloadHash, runId, Date.now(),
        ).run();
        importedPayments += Number(result.meta.changes ?? 0);
      }

      const ignoredMappings = await getDb().select({ externalLocationRef: integrationLocationMappings.externalLocationRef })
        .from(integrationLocationMappings).where(and(
          eq(integrationLocationMappings.organizationId, context.organizationId),
          eq(integrationLocationMappings.provider, LIGHTSPEED_R_PROVIDER),
          eq(integrationLocationMappings.status, "ignored"),
        ));
      const ignored = new Set(ignoredMappings.map((row) => row.externalLocationRef));
      const latest = await database.prepare(`
        SELECT external_sale_id AS externalSaleId, outlet_ref AS outletRef, sold_at AS soldAt, state,
               total_cents AS totalCents, tax_cents AS taxCents, cost_cents AS costCents,
               discount_cents AS discountCents, line_count AS lineCount
        FROM (
          SELECT *, row_number() OVER (
            PARTITION BY external_sale_id ORDER BY staged_at DESC, id DESC
          ) AS version_rank
          FROM integration_staged_sales
          WHERE organization_id = ? AND provider = ?
        )
        WHERE version_rank = 1
      `).bind(context.organizationId, LIGHTSPEED_R_PROVIDER).all<StagedSaleRow>();
      const dailyMetrics = buildLightspeedRDailyMetrics(
        (latest.results ?? []).filter((sale) => !sale.outletRef || !ignored.has(sale.outletRef)),
      );

      const now = Date.now();
      await database.prepare(`
        INSERT INTO data_imports
          (id, organization_id, import_type, status, file_name, row_count, idempotency_key, imported_by_user_id, created_at)
        VALUES (?, ?, 'manual_entry', 'processing', ?, 0, ?, ?, ?)
      `).bind(importId, context.organizationId, IMPORT_LABEL, runId, context.userId, now).run();

      for (const row of dailyMetrics) {
        await database.prepare(`
          INSERT INTO daily_business_metrics (
            organization_id, business_date, location_ref, gross_sales_cents, net_sales_cents,
            cost_of_goods_cents, transaction_count, units_sold, refunds_cents, discounts_cents,
            labour_cost_cents, inventory_value_cents, cash_balance_cents, accounts_payable_cents,
            source_import_id, created_by_user_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL, ?, ?, ?, ?)
          ON CONFLICT(organization_id, business_date, location_ref) DO UPDATE SET
            gross_sales_cents = excluded.gross_sales_cents,
            net_sales_cents = excluded.net_sales_cents,
            cost_of_goods_cents = excluded.cost_of_goods_cents,
            transaction_count = excluded.transaction_count,
            units_sold = excluded.units_sold,
            refunds_cents = excluded.refunds_cents,
            discounts_cents = excluded.discounts_cents,
            source_import_id = excluded.source_import_id,
            updated_at = excluded.updated_at
        `).bind(
          context.organizationId, row.businessDate, row.locationRef, row.grossSalesCents,
          row.netSalesCents, row.costOfGoodsCents, row.transactionCount, row.unitsSold,
          row.refundsCents, row.discountsCents, importId, context.userId, now, now,
        ).run();
      }
      await database.prepare(`
        DELETE FROM daily_business_metrics
        WHERE organization_id = ?
          AND location_ref LIKE 'lightspeed-r:%'
          AND source_import_id <> ?
      `).bind(context.organizationId, importId).run();

      let importedInventory = 0;
      for (const externalLocationRef of ignored) {
        await database.prepare(`
          DELETE FROM inventory_balances
          WHERE organization_id = ? AND location_ref = ?
        `).bind(context.organizationId, `${LIGHTSPEED_R_PROVIDER}:${externalLocationRef}`).run();
      }
      for (const balance of inventoryBalances) {
        if (ignored.has(balance.outletRef)) continue;
        const result = await database.prepare(`
          INSERT INTO inventory_balances
            (id, organization_id, location_ref, sku, name, on_hand_quantity, reorder_point, version, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
          ON CONFLICT(organization_id, location_ref, sku) DO UPDATE SET
            name = excluded.name,
            on_hand_quantity = excluded.on_hand_quantity,
            reorder_point = excluded.reorder_point,
            version = inventory_balances.version + 1,
            updated_at = excluded.updated_at
        `).bind(
          crypto.randomUUID(), context.organizationId, `${LIGHTSPEED_R_PROVIDER}:${balance.outletRef}`,
          balance.sku, balance.name, balance.onHandQuantity, balance.reorderPoint, now,
        ).run();
        importedInventory += Number(result.meta.changes ?? 0);
      }
      let importedProducts = 0;
      for (const product of products) {
        const result = await database.prepare(`
          INSERT INTO commerce_products
            (id, organization_id, provider, external_product_id, sku, name, category_ref, supplier_ref,
             default_cost_cents, default_price_cents, archived, source_updated_at, source_payload_hash,
             sync_run_id, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(organization_id, provider, external_product_id) DO UPDATE SET
            sku = excluded.sku, name = excluded.name, category_ref = excluded.category_ref,
            supplier_ref = excluded.supplier_ref, default_cost_cents = excluded.default_cost_cents,
            default_price_cents = excluded.default_price_cents, archived = excluded.archived,
            source_updated_at = excluded.source_updated_at, source_payload_hash = excluded.source_payload_hash,
            sync_run_id = excluded.sync_run_id, updated_at = excluded.updated_at
        `).bind(
          crypto.randomUUID(), context.organizationId, LIGHTSPEED_R_PROVIDER, product.externalProductId,
          product.sku, product.name, product.categoryRef, product.supplierRef, product.defaultCostCents,
          product.defaultPriceCents, product.archived ? 1 : 0, product.sourceUpdatedAt,
          product.sourcePayloadHash, runId, now,
        ).run();
        importedProducts += Number(result.meta.changes ?? 0);
      }
      let importedCustomers = 0;
      for (const customer of customers) {
        const result = await database.prepare(`
          INSERT INTO commerce_customers
            (id, organization_id, provider, external_customer_id, display_name, first_name, last_name,
             email, phone, archived, source_updated_at, source_payload_hash, sync_run_id, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(organization_id, provider, external_customer_id) DO UPDATE SET
            display_name = excluded.display_name, first_name = excluded.first_name, last_name = excluded.last_name,
            email = excluded.email, phone = excluded.phone, archived = excluded.archived,
            source_updated_at = excluded.source_updated_at, source_payload_hash = excluded.source_payload_hash,
            sync_run_id = excluded.sync_run_id, updated_at = excluded.updated_at
        `).bind(
          crypto.randomUUID(), context.organizationId, LIGHTSPEED_R_PROVIDER, customer.externalCustomerId,
          customer.displayName, customer.firstName, customer.lastName, customer.email, customer.phone,
          customer.archived ? 1 : 0, customer.sourceUpdatedAt, customer.sourcePayloadHash, runId, now,
        ).run();
        importedCustomers += Number(result.meta.changes ?? 0);
      }
      let importedSuppliers = 0;
      for (const supplier of suppliers) {
        const result = await database.prepare(`
          INSERT INTO commerce_suppliers
            (id, organization_id, provider, external_supplier_id, name, account_number, contact_name,
             email, phone, archived, source_updated_at, source_payload_hash, sync_run_id, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(organization_id, provider, external_supplier_id) DO UPDATE SET
            name = excluded.name, account_number = excluded.account_number, contact_name = excluded.contact_name,
            email = excluded.email, phone = excluded.phone, archived = excluded.archived,
            source_updated_at = excluded.source_updated_at, source_payload_hash = excluded.source_payload_hash,
            sync_run_id = excluded.sync_run_id, updated_at = excluded.updated_at
        `).bind(
          crypto.randomUUID(), context.organizationId, LIGHTSPEED_R_PROVIDER, supplier.externalSupplierId,
          supplier.name, supplier.accountNumber, supplier.contactName, supplier.email, supplier.phone,
          supplier.archived ? 1 : 0, supplier.sourceUpdatedAt, supplier.sourcePayloadHash, runId, now,
        ).run();
        importedSuppliers += Number(result.meta.changes ?? 0);
      }
      await database.prepare(`
        UPDATE data_imports SET status = 'completed', row_count = ?
        WHERE id = ? AND organization_id = ?
      `).bind(dailyMetrics.length + importedInventory + importedProducts + importedCustomers + importedSuppliers + importedSaleLines + importedPayments, importId, context.organizationId).run();

      const completedAt = new Date();
      const salesComplete = previous.salesComplete || salesPage.cursor === null;
      const saleLinesComplete = previous.saleLinesComplete || saleLinesPage.cursor === null;
      const itemsComplete = previous.itemsComplete || itemsPage.cursor === null;
      const customersComplete = previous.customersComplete || customersPage.cursor === null;
      const suppliersComplete = previous.suppliersComplete || suppliersPage.cursor === null;
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
      const safeCheckpoint = reason === "auto" || warnings > 0 ? connection.lastSyncCursor : computedCheckpoint;
      const recordsRead = recentSalesPage.data.length + salesPage.data.length + saleLinesPage.data.length + itemsPage.data.length + customersPage.data.length + suppliersPage.data.length + paymentTypesPage.data.length;
      const recordsImported = dailyMetrics.length + importedInventory + importedProducts + importedCustomers + importedSuppliers + importedSaleLines + importedPayments;
      const duplicatesSkipped = uniqueSales.length - stagedSales;
      await getDb().update(integrationSyncRuns).set({
        status: "completed",
        cursorAfter: safeCheckpoint,
        recordsRead,
        recordsStaged: stagedSales + importedInventory + importedProducts + importedCustomers + importedSuppliers + importedSaleLines + importedPayments,
        duplicatesSkipped,
        warningCount: warnings,
        completedAt,
      }).where(eq(integrationSyncRuns.id, runId));
      await getDb().update(integrationConnections).set({
        externalAccountName: sourceAccount?.name ?? connection.externalAccountName,
        lastSuccessfulSyncAt: completedAt,
        lastSyncCursor: safeCheckpoint,
        dataPromotionStatus: warnings === 0 ? "approved" : "staging",
        lastErrorCode: null,
        updatedAt: completedAt,
      }).where(and(
        eq(integrationConnections.organizationId, context.organizationId),
        eq(integrationConnections.provider, LIGHTSPEED_R_PROVIDER),
      ));
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
          recordsRead,
          stagedSales,
          dailyMetrics: dailyMetrics.length,
          inventoryBalances: importedInventory,
          products: importedProducts,
          customers: importedCustomers,
          suppliers: importedSuppliers,
          saleLines: importedSaleLines,
          payments: importedPayments,
          duplicatesSkipped,
          warningCount: warnings,
          dataPromotionEnabled: warnings === 0,
        },
      });

      return jsonResponse({
        provider: LIGHTSPEED_R_PROVIDER,
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
          dailyMetrics: dailyMetrics.length,
          inventoryBalances: importedInventory,
          products: importedProducts,
          customers: importedCustomers,
          suppliers: importedSuppliers,
          saleLines: importedSaleLines,
          payments: importedPayments,
        },
        imported: {
          dailyMetrics: dailyMetrics.length,
          inventoryBalances: importedInventory,
          products: importedProducts,
          customers: importedCustomers,
          suppliers: importedSuppliers,
          saleLines: importedSaleLines,
          payments: importedPayments,
        },
        stagingOnly: false,
        dataPromotionEnabled: warnings === 0,
        readyForReview: warnings === 0,
        nextStep: warnings > 0
          ? `Imported ${recordsImported} verified records. ${warnings} source record${warnings === 1 ? " needs" : "s need"} attention before the sync cursor can advance.`
          : salesComplete && saleLinesComplete && itemsComplete && customersComplete && suppliersComplete
            ? `R-Series is current. Sales, products, inventory, customers and suppliers are available to Vanteloq.`
            : `Imported ${recordsImported} records. Run sync again to continue the remaining R-Series backfill.` ,
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
        eq(integrationConnections.organizationId, context.organizationId),
        eq(integrationConnections.provider, LIGHTSPEED_R_PROVIDER),
      ));
      throw error;
    }
  });
}
