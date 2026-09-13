import { and, eq } from "drizzle-orm";
import { getD1, getDb } from "../../../db";
import {
  integrationConnections,
  integrationLocationMappings,
  integrationSyncRuns,
} from "../../../db/schema";
import { recordAudit } from "../../audit";
import { ApiError, enforceRateLimit, jsonResponse, } from "../../api";
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
} from "../../integrations/lightspeed-r";
import {
  acquireIntegrationSyncLease,
  releaseIntegrationSyncLease,
  renewIntegrationSyncLease,
  requireOwnedIntegrationConnection,
  sqliteTimestampSeconds,
} from "../../integrations/connection";
import { scopeExternalRef } from "../../../domain/integration-source";
import { applyOwnerInventoryCosts } from "../../inventory-costs";

const IMPORT_LABEL = "Lightspeed R-Series live sync";

type SyncCheckpoint = {
  version: 5;
  catalogVersion: number;
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

type LightspeedRCollectionPage = Awaited<ReturnType<typeof fetchLightspeedRCollection>> & { failed?: boolean };

function checkpoint(value: string | null): SyncCheckpoint {
  const empty: SyncCheckpoint = {
    version: 5,
    catalogVersion: 0,
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
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    // Version 5 repairs historical pre-discount line totals and catalogue coverage.
    // Older checkpoints restart the bounded, resumable import without deleting records.
    if (parsed.version !== 5) return empty;
    return {
      version: 5,
      catalogVersion: parsed.catalogVersion === 1 ? 1 : 0,
      watermark: typeof parsed.watermark === "string" ? parsed.watermark : null,
      salesCursor: typeof parsed.salesCursor === "string" ? parsed.salesCursor : null,
      saleLinesCursor: typeof parsed.saleLinesCursor === "string" ? parsed.saleLinesCursor : null,
      itemsCursor: parsed.catalogVersion === 1 && typeof parsed.itemsCursor === "string" ? parsed.itemsCursor : null,
      customersCursor: typeof parsed.customersCursor === "string" ? parsed.customersCursor : null,
      suppliersCursor: typeof parsed.suppliersCursor === "string" ? parsed.suppliersCursor : null,
      salesComplete: parsed.salesComplete === true,
      saleLinesComplete: parsed.saleLinesComplete === true,
      itemsComplete: parsed.catalogVersion === 1 && parsed.itemsComplete === true,
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
  catalogVersion: number,
) {
  if (salesComplete && saleLinesComplete && itemsComplete && customersComplete && suppliersComplete) {
    return JSON.stringify({
      version: 5,
      catalogVersion,
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
    version: 5,
    catalogVersion,
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

import type { SyncContext, SyncTrigger } from "./types";

export async function runSync(request: Request, requestId: string, context: SyncContext, input: Record<string, unknown>, trigger: SyncTrigger) {
    const requested = input;
    // Older open tabs did not send a reason. Treat them as lightweight refreshes
    // so stale clients cannot accidentally start full catalog backfills.
    const reason = trigger === "scheduled" || requested.reason === "manual" ? "manual" : "auto";
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
        nextStep: "Use the connection’s automatic sync setting to continue imports in the background.",
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
    let publicationPointerDemoted = false;
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
      if (trigger === "manual") await enforceRateLimit("lightspeed-r:manual-sync", context.organizationId, 30, 3_600);
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
            // A large retailer backfill advances through the persisted cursor
            // one provider page per Worker invocation. This keeps the edge
            // request bounded while still making resumable progress.
            maxPages: 1,
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
      const coverageWarnings = new Set<string>();
      const optionalCollection = async (
        dataset: string,
        resource: Parameters<typeof fetchLightspeedRCollection>[3],
        options: Parameters<typeof fetchLightspeedRCollection>[4],
      ): Promise<LightspeedRCollectionPage> => {
        try {
          return await fetchLightspeedRCollection(
            context.organizationId,
            connection.id,
            connection.externalAccountRef!,
            resource,
            options,
          );
        } catch (error) {
          if (!(error instanceof ApiError) || !["LIGHTSPEED_R_PROVIDER_ERROR", "LIGHTSPEED_R_RATE_LIMITED"].includes(error.code)) {
            throw error;
          }
          coverageWarnings.add(dataset);
          return { data: [], pages: 0, cursor: null, failed: true };
        }
      };
      // Import decision-critical datasets before optional tender labels. A
      // provider error in one collection must never suppress valid pages from
      // another collection in the same sync run.
      const saleLinesPage = previous.saleLinesComplete && Number(existingCommerce?.saleLines ?? 0) > 0
        ? { data: [], pages: 0, cursor: null as string | null }
        : await optionalCollection("sale line details", "SaleLine", {
            maxPages: 1,
            cursor: previous.saleLinesCursor,
            modifiedSince: previous.saleLinesCursor || Number(existingCommerce?.saleLines ?? 0) === 0
              ? null
              : previous.watermark,
          });
      const itemsPage = previous.itemsComplete && Number(existingCommerce?.products ?? 0) > 0
        ? { data: [], pages: 0, cursor: null as string | null }
        : await optionalCollection("products and inventory", "Item", {
            maxPages: 1,
            cursor: previous.itemsCursor,
            modifiedSince: previous.catalogVersion !== 1 || previous.itemsCursor || Number(existingCommerce?.products ?? 0) === 0
              ? null
              : previous.watermark,
            loadRelations: ["ItemShops", "ItemPrices", "Category"],
          });
      const customersPage = previous.customersComplete && Number(existingCommerce?.customers ?? 0) > 0
        ? { data: [], pages: 0, cursor: null as string | null }
        : await optionalCollection("customers", "Customer", {
            maxPages: 1,
            cursor: previous.customersCursor,
            modifiedSince: previous.customersCursor || Number(existingCommerce?.customers ?? 0) === 0
              ? null
              : previous.watermark,
          });
      const suppliersPage = previous.suppliersComplete && Number(existingCommerce?.suppliers ?? 0) > 0
        ? { data: [], pages: 0, cursor: null as string | null }
        : await optionalCollection("suppliers", "Vendor", {
            maxPages: 1,
            cursor: previous.suppliersCursor,
            modifiedSince: previous.suppliersCursor || Number(existingCommerce?.suppliers ?? 0) === 0
              ? null
              : previous.watermark,
          });
      const paymentTypesPage = await optionalCollection("payment types", "PaymentType", { maxPages: 1 });

      const normalizedSales: NormalizedLightspeedRSale[] = [];
      const normalizedSaleLines = [];
      const inventoryBalances = [];
      const products = [];
      const customers = [];
      const suppliers = [];
      const payments = [];
      const paymentTypes = lightspeedRPaymentTypeMap(paymentTypesPage.data);
      const normalizationWarnings = { sales: 0, saleLines: 0, products: 0, inventory: 0, customers: 0, suppliers: 0 };
      for (const source of [...recentSalesPage.data, ...salesPage.data]) {
        try {
          normalizedSales.push(await normalizeLightspeedRSale(source));
          normalizedSaleLines.push(...await normalizeLightspeedRSaleLines(source));
          payments.push(...await normalizeLightspeedRPayments(source, paymentTypes));
        } catch { normalizationWarnings.sales += 1; }
      }
      for (const source of saleLinesPage.data) {
        try { normalizedSaleLines.push(await normalizeLightspeedRSaleLine(source)); } catch { normalizationWarnings.saleLines += 1; }
      }
      for (const source of itemsPage.data) {
        // Catalog identity remains valid even when a particular shop-level
        // quantity relation is incomplete. Validate the two facts separately.
        try { products.push(await normalizeLightspeedRProduct(source)); } catch { normalizationWarnings.products += 1; }
        try { inventoryBalances.push(...normalizeLightspeedRInventoryItem(source)); } catch { normalizationWarnings.inventory += 1; }
      }
      for (const source of customersPage.data) {
        try { customers.push(await normalizeLightspeedRCustomer(source)); } catch { normalizationWarnings.customers += 1; }
      }
      for (const source of suppliersPage.data) {
        try { suppliers.push(await normalizeLightspeedRSupplier(source)); } catch { normalizationWarnings.suppliers += 1; }
      }
      const warnings = Object.values(normalizationWarnings).reduce((sum, value) => sum + value, 0);
      const uniqueSales = [...new Map(normalizedSales.map((sale) => [`${sale.externalSaleId}:${sale.externalVersion}`, sale])).values()];
      const saleContext = new Map(normalizedSales.map((sale) => [sale.externalSaleId, sale]));
      const uniqueSaleLines = await Promise.all(
        [...new Map(normalizedSaleLines.map((line) => [`${line.externalSaleId}:${line.externalLineId}`, line])).values()]
          .map(async (line) => {
            const sale = saleContext.get(line.externalSaleId);
            if (!sale || (line.outletRef && line.soldAt)) return line;
            const { sourcePayloadHash: discardedSourcePayloadHash, ...source } = line;
            void discardedSourcePayloadHash;
            const enriched = {
              ...source,
              outletRef: source.outletRef || sale.outletRef,
              soldAt: source.soldAt || sale.soldAt,
            };
            return {
              ...enriched,
              sourcePayloadHash: await lightspeedRSha256(JSON.stringify(enriched)),
            };
          }),
      );
      const uniquePayments = [...new Map(payments.map((payment) => [payment.externalPaymentId, payment])).values()];
      // SaleLine is also a trustworthy catalog identity source. Preserve sold
      // products even if R-Series omits Item rows or a shop relation is partial;
      // later Item pages enrich these records with names, cost, price and stock.
      const catalogProductRefs = new Set(products.map((product) => product.externalProductId));
      const knownProductRefs = new Set(catalogProductRefs);
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

      await renewIntegrationSyncLease(syncLease);

      const database = getD1();
      const runWriteBatches = async (statements: D1PreparedStatement[]) => {
        let changes = 0;
        for (let index = 0; index < statements.length; index += 50) {
          await renewIntegrationSyncLease(syncLease);
          const results = await database.batch(statements.slice(index, index + 50));
          changes += results.reduce((sum, result) => sum + Number(result.meta.changes ?? 0), 0);
        }
        return changes;
      };
      const locationMappings = await getDb().select({
        externalLocationRef: integrationLocationMappings.externalLocationRef,
        status: integrationLocationMappings.status,
      })
        .from(integrationLocationMappings).where(and(
          eq(integrationLocationMappings.organizationId, context.organizationId),
          eq(integrationLocationMappings.provider, LIGHTSPEED_R_PROVIDER),
          eq(integrationLocationMappings.connectionId, connection.id),
        ));
      const mappedRaw = new Set(locationMappings.filter((row) => row.status === "mapped").map((row) => row.externalLocationRef));
      const mapped = new Set([...mappedRaw].map((value) => scopedRef(value)).filter((value): value is string => Boolean(value)));
      const unmappedLocations = locationMappings.filter((row) => row.status === "unmapped").length;
      const publicationAuthorized = connection.dataPromotionStatus === "approved" || connection.promotionAuthorizedAt !== null;
      const publicationWarnings = normalizationWarnings.sales + unmappedLocations;
      const publishCanonical = publicationAuthorized && publicationWarnings === 0;
      const stagedSaleStatements = uniqueSales.map((sale) => database.prepare(`
          INSERT OR IGNORE INTO integration_staged_sales
            (id, organization_id, provider, connection_id, external_sale_id, external_version, outlet_ref, sold_at, state,
             total_cents, tax_cents, cost_cents, discount_cents, line_count, source_payload_hash, sync_run_id, staged_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          crypto.randomUUID(), context.organizationId, LIGHTSPEED_R_PROVIDER, connection.id,
          scopedRef(sale.externalSaleId), sale.externalVersion, scopedRef(sale.outletRef), sale.soldAt, sale.state,
          sale.totalCents, sale.taxCents, sale.costCents, sale.discountCents, sale.lineCount,
          sale.sourcePayloadHash, runId, Date.now(),
        ));
      const stagedSales = await runWriteBatches(stagedSaleStatements);
      if (publishCanonical && connection.dataPromotionStatus === "approved") {
        const hidden = await getDb().update(integrationConnections).set({
          dataPromotionStatus: "staging",
          promotionAuthorizedAt: connection.promotionAuthorizedAt ?? startedAt,
          updatedAt: new Date(),
        }).where(and(
          eq(integrationConnections.id, connection.id),
          eq(integrationConnections.organizationId, context.organizationId),
          eq(integrationConnections.provider, LIGHTSPEED_R_PROVIDER),
          eq(integrationConnections.dataPromotionStatus, "approved"),
          eq(integrationConnections.syncLeaseOwner, syncLease.owner),
          eq(integrationConnections.syncVersion, syncLease.version),
        )).returning({ id: integrationConnections.id });
        if (!hidden.length) {
          throw new ApiError(409, "INTEGRATION_SYNC_LEASE_LOST", "This synchronization was superseded before it could safely publish data.");
        }
        publicationPointerDemoted = true;
      }
      const saleLineStatements = uniqueSaleLines.filter((row) => !row.outletRef || mappedRaw.has(row.outletRef)).map((line) => database.prepare(`
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
        ));
      const importedSaleLines = await runWriteBatches(saleLineStatements);
      const paymentStatements = uniquePayments.filter((row) => !row.outletRef || mappedRaw.has(row.outletRef)).map((payment) => database.prepare(`
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
        ));
      const importedPayments = await runWriteBatches(paymentStatements);

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
      const dailyMetrics = normalizationWarnings.sales === 0
        ? buildLightspeedRDailyMetrics(
            (latest.results ?? []).filter((sale) => !sale.outletRef || mapped.has(sale.outletRef)),
            context.organization.timezone,
          )
        : [];
      const verifiedSalesReady = dailyMetrics.length > 0 && unmappedLocations === 0;
      const publishedDailyMetrics = publishCanonical ? dailyMetrics : [];

      const now = Date.now();
      await renewIntegrationSyncLease(syncLease);
      await database.prepare(`
        INSERT INTO data_imports
          (id, organization_id, import_type, status, file_name, row_count, idempotency_key, imported_by_user_id, created_at)
        VALUES (?, ?, 'manual_entry', 'processing', ?, 0, ?, ?, ?)
      `).bind(importId, context.organizationId, IMPORT_LABEL, runId, context.userId, now).run();

      if (publishCanonical) {
        await renewIntegrationSyncLease(syncLease);
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
          await renewIntegrationSyncLease(syncLease);
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
      {
        const inventoryStatements = inventoryBalances
          .filter((balance) => mappedRaw.has(balance.outletRef))
          .map((balance) => database.prepare(`
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
          ));
        importedInventory = await runWriteBatches(inventoryStatements);
      }
      const productStatements = products.map((product) => database.prepare(`
          INSERT INTO commerce_products
            (id, organization_id, provider, connection_id, external_product_id, sku, name, category_ref, category_name, supplier_ref,
             default_cost_cents, default_price_cents, archived, source_updated_at, source_payload_hash,
             sync_run_id, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(organization_id, provider, connection_id, external_product_id) ${catalogProductRefs.has(product.externalProductId) ? `DO UPDATE SET
            sku = excluded.sku, name = excluded.name, category_ref = excluded.category_ref, category_name = excluded.category_name,
            supplier_ref = excluded.supplier_ref, default_cost_cents = excluded.default_cost_cents,
            default_price_cents = excluded.default_price_cents, archived = excluded.archived,
            source_updated_at = excluded.source_updated_at, source_payload_hash = excluded.source_payload_hash,
            sync_run_id = excluded.sync_run_id, updated_at = excluded.updated_at` : "DO NOTHING"}
        `).bind(
          crypto.randomUUID(), context.organizationId, LIGHTSPEED_R_PROVIDER, connection.id, scopedRef(product.externalProductId),
          product.sku, product.name, scopedRef(product.categoryRef), "categoryName" in product ? product.categoryName ?? null : null, scopedRef(product.supplierRef), product.defaultCostCents,
          product.defaultPriceCents, product.archived ? 1 : 0, product.sourceUpdatedAt,
          product.sourcePayloadHash, runId, now,
        ));
      const importedProducts = await runWriteBatches(productStatements);
      const customerStatements = customers.map((customer) => database.prepare(`
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
        ));
      const importedCustomers = await runWriteBatches(customerStatements);
      const supplierStatements = suppliers.map((supplier) => database.prepare(`
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
        ));
      const importedSuppliers = await runWriteBatches(supplierStatements);
      await applyOwnerInventoryCosts(context.organizationId, connection.id, now);
      await renewIntegrationSyncLease(syncLease);
      await database.prepare(`
        UPDATE data_imports SET status = 'completed', row_count = ?
        WHERE id = ? AND organization_id = ?
      `).bind(publishedDailyMetrics.length + importedInventory + importedProducts + importedCustomers + importedSuppliers + importedSaleLines + importedPayments, importId, context.organizationId).run();

      const completedAt = new Date();
      const salesComplete = previous.salesComplete || salesPage.cursor === null;
      const saleLinesComplete = previous.saleLinesComplete || (!saleLinesPage.failed && saleLinesPage.cursor === null);
      const itemsComplete = previous.itemsComplete || (!itemsPage.failed && itemsPage.cursor === null);
      const customersComplete = previous.customersComplete || (!customersPage.failed && customersPage.cursor === null);
      const suppliersComplete = previous.suppliersComplete || (!suppliersPage.failed && suppliersPage.cursor === null);
      const backfillComplete = salesComplete && saleLinesComplete && itemsComplete && customersComplete && suppliersComplete;
      // Keep the primary sales cursor eligible for another incremental read
      // while any secondary dataset is unavailable. The 24-hour fast path
      // updates today's dashboard, and the preserved watermark prevents older
      // sales from being skipped during a longer provider-side outage.
      const checkpointSalesComplete = coverageWarnings.size > 0 ? false : salesComplete;
      const computedCheckpoint = nextCheckpoint(
        previous,
        completedAt,
        salesPage.cursor,
        saleLinesPage.cursor,
        itemsPage.cursor,
        customersPage.cursor,
        suppliersPage.cursor,
        checkpointSalesComplete,
        saleLinesComplete,
        itemsComplete,
        customersComplete,
        suppliersComplete,
        itemsPage.failed ? previous.catalogVersion : 1,
      );
      const safeCheckpoint = computedCheckpoint;
      const recordsRead = recentSalesPage.data.length + salesPage.data.length + saleLinesPage.data.length + itemsPage.data.length + customersPage.data.length + suppliersPage.data.length + paymentTypesPage.data.length;
      const recordsImported = publishedDailyMetrics.length + importedInventory + importedProducts + importedCustomers + importedSuppliers + importedSaleLines + importedPayments;
      const duplicatesSkipped = uniqueSales.length - stagedSales;
      const promotionStatus = publishCanonical || connection.dataPromotionStatus === "approved" ? "approved" : "staging";
      await renewIntegrationSyncLease(syncLease);
      await getDb().update(integrationSyncRuns).set({
        status: "completed",
        cursorAfter: safeCheckpoint,
        recordsRead,
        recordsStaged: stagedSales + importedInventory + importedProducts + importedCustomers + importedSuppliers + importedSaleLines + importedPayments,
        duplicatesSkipped,
        // Missing optional catalog datasets remain visible as coverage warnings,
        // but they must not invalidate an otherwise reconciled sales run.
        warningCount: warnings + unmappedLocations,
        completedAt,
      }).where(eq(integrationSyncRuns.id, runId));
      const promoted = await getDb().update(integrationConnections).set({
        externalAccountName: sourceAccount?.name ?? connection.externalAccountName,
        // A reconciliation warning may still contribute valid independent
        // catalog records, but it must not replace the last approved sales
        // pointer or advance the canonical sales cursor.
        lastSuccessfulSyncAt: publicationWarnings > 0 ? connection.lastSuccessfulSyncAt : completedAt,
        lastSyncCursor: publicationWarnings > 0 ? connection.lastSyncCursor : safeCheckpoint,
        dataPromotionStatus: promotionStatus,
        promotionAuthorizedAt: promotionStatus === "approved" ? null : connection.promotionAuthorizedAt,
        lastErrorCode: publicationWarnings > 0
          ? "LIGHTSPEED_R_RECONCILIATION_WARNINGS"
          : warnings > 0
            ? "LIGHTSPEED_R_PARTIAL_COVERAGE"
            : null,
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
          unmappedLocations,
          duplicatesSkipped,
          warningCount: warnings,
          coverageWarningCount: coverageWarnings.size,
          coverageWarningDatasets: [...coverageWarnings].join(","),
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
        coverageWarnings: [...coverageWarnings],
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
        backfillComplete,
        readyForReview: warnings === 0 && verifiedSalesReady && promotionStatus !== "approved",
        nextStep: unmappedLocations > 0
          ? `Map or ignore ${unmappedLocations} R-Series shop${unmappedLocations === 1 ? "" : "s"}, then re-sync. Dashboard data remains locked until every discovered shop has an explicit destination.`
          : warnings > 0
          ? `Imported ${recordsImported} verified records. ${warnings} source record${warnings === 1 ? " needs" : "s need"} attention before the sync cursor can advance.`
          : promotionStatus === "approved"
            ? coverageWarnings.size
              ? `Approved records remain available. ${[...coverageWarnings].join(", ")} will retry on the next sync.${!backfillComplete ? " Historical import is still in progress." : ""}`
              : !backfillComplete
                ? "Approved records remain available. Run sync again to continue the remaining history before treating the import as complete."
                : "R-Series is current and the approved records are available to dashboard features."
          : verifiedSalesReady
            ? coverageWarnings.size || !backfillComplete
              ? `Verified sales are ready for review. Approve them to populate the dashboard while ${[...coverageWarnings, ...(!backfillComplete ? ["remaining history"] : [])].join(" and ")} continue syncing.`
              : `R-Series is current. Review the reconciliation, then approve this account before its records affect dashboard results.`
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
        dataPromotionStatus: publicationPointerDemoted ? "staging" : connection.dataPromotionStatus,
        promotionAuthorizedAt: publicationPointerDemoted
          ? (connection.promotionAuthorizedAt ?? startedAt)
          : connection.promotionAuthorizedAt,
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
}