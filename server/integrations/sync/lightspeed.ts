import { and, eq } from "drizzle-orm";
import { getD1, getDb } from "../../../db";
import { integrationConnections, integrationLocationMappings, integrationSyncRuns } from "../../../db/schema";
import { scopeExternalRef, unscopedExternalRef } from "../../../domain/integration-source";
import { recordAudit } from "../../audit";
import { ApiError, enforceRateLimit, jsonResponse } from "../../api";
import { applyOwnerInventoryCosts } from "../../inventory-costs";
import { fetchLightspeedCollection, fetchLightspeedRetailer, LIGHTSPEED_PROVIDER as PROVIDER, validateLightspeedGrantedScopes, type NormalizedLightspeedSale } from "../lightspeed";
import { buildXDailyMetrics, normalizeXCommerceSale, normalizeXCustomer, normalizeXInventory, normalizeXProduct, normalizeXSupplier } from "../lightspeed-commerce";
import { acquireIntegrationSyncLease, releaseIntegrationSyncLease, renewIntegrationSyncLease, requireOwnedIntegrationConnection } from "../connection";
import type { SyncContext, SyncTrigger } from "./types";

const resources = ["products", "customers", "suppliers", "sales", "inventory"] as const;
type Resource = typeof resources[number];
type Checkpoint = { version: 2; resources: Record<Resource, { after: string | null; complete: boolean }>; watermark: string | null; cycleComplete: boolean };
function checkpoint(value: string | null): Checkpoint {
  const empty = { version: 2 as const, resources: Object.fromEntries(resources.map(key => [key, { after: null, complete: false }])) as Checkpoint["resources"], watermark: null, cycleComplete: false };
  try {
    const parsed = JSON.parse(value ?? "null") as Checkpoint;
    if (parsed?.version !== 2 || !resources.every(key => parsed.resources[key] && (parsed.resources[key].after === null || /^\d+$/.test(parsed.resources[key].after!)) && typeof parsed.resources[key].complete === "boolean")) return empty;
    return parsed;
  } catch { return empty; }
}

export async function runSync(request: Request, requestId: string, context: SyncContext, input: Record<string, unknown>, trigger: SyncTrigger) {
  if (trigger === "manual") await enforceRateLimit("lightspeed:sync", context.organizationId, 30, 3600);
  const connection = await requireOwnedIntegrationConnection(context.organizationId, PROVIDER, typeof input.connectionId === "string" ? input.connectionId : null, { connected: true });
  validateLightspeedGrantedScopes(JSON.parse(connection.scopesJson).join(" "));
  const lease = await acquireIntegrationSyncLease(context.organizationId, PROVIDER, connection.id);
  if (!lease) return jsonResponse({ coalesced: true, provider: PROVIDER, connectionId: connection.id });
  const runId = "lightspeed-" + crypto.randomUUID(), startedAt = new Date(), database = getD1();
  const before = checkpoint(connection.lastSyncCursor), next: Checkpoint = structuredClone(before);
  const scoped = (value: string | null) => scopeExternalRef(connection.sourceNamespace, value);
  const leaseWhere = and(eq(integrationConnections.id, connection.id), eq(integrationConnections.organizationId, context.organizationId), eq(integrationConnections.provider, PROVIDER), eq(integrationConnections.syncLeaseOwner, lease.owner), eq(integrationConnections.syncVersion, lease.version));
  let recordsRead = 0, recordsStaged = 0;
  try {
    await getDb().insert(integrationSyncRuns).values({ id: runId, organizationId: context.organizationId, provider: PROVIDER, connectionId: connection.id, mode: "incremental", status: "running", cursorBefore: connection.lastSyncCursor, recordsRead: 0, recordsStaged: 0, warningCount: 0, startedAt, createdByUserId: context.userId });
    const retailer = await fetchLightspeedRetailer(context.organizationId, connection.id);
    if (retailer.domainPrefix !== connection.domainPrefix) throw new ApiError(409, "LIGHTSPEED_RETAILER_CHANGED", "The retailer does not match the authorized account. Reconnect it.");
    if (retailer.currency !== context.organization.currency) throw new ApiError(409, "LIGHTSPEED_CURRENCY_MISMATCH", "The X-Series currency must match this workspace. No currency conversion has been assumed.");
    const mappings = await getDb().select().from(integrationLocationMappings).where(and(eq(integrationLocationMappings.organizationId, context.organizationId), eq(integrationLocationMappings.provider, PROVIDER), eq(integrationLocationMappings.connectionId, connection.id)));
    const mapped = new Set(mappings.filter(row => row.status === "mapped").map(row => row.externalLocationRef));
    let unmapped = mappings.filter(row => row.status === "unmapped").length;
    const pages = {} as Record<Resource, Record<string, unknown>[]>;
    // Catalog history precedes stock references. Every resource retains its own
    // version cursor across bounded history pages and incremental cycles.
    for (const resource of resources) {
      if (before.resources[resource].complete || (resource === "inventory" && !next.resources.products.complete)) { pages[resource] = []; continue; }
      const page = await fetchLightspeedCollection(context.organizationId, connection.id, resource, { after: before.resources[resource].after, maxPages: 1 });
      pages[resource] = page.data; recordsRead += page.data.length;
      next.resources[resource] = { after: page.cursor, complete: !page.hasMore };
      await renewIntegrationSyncLease(lease);
    }
    let products, customers, suppliers, sales, inventory;
    try {
      products = await Promise.all(pages.products.map(normalizeXProduct));
      customers = await Promise.all(pages.customers.map(normalizeXCustomer));
      suppliers = await Promise.all(pages.suppliers.map(normalizeXSupplier));
      sales = await Promise.all(pages.sales.map(normalizeXCommerceSale));
      inventory = pages.inventory.map(normalizeXInventory);
    } catch {
      throw new ApiError(502, "LIGHTSPEED_RECORDS_INVALID", "An X-Series record is incomplete or its sale lines do not reconcile. The cursor is preserved for review and retry.");
    }
    const unknown = new Set([...sales.map(row => row.sale.outletRef), ...inventory.map(row => row.outletRef)].filter((ref): ref is string => Boolean(ref) && !mappings.some(mapping => mapping.externalLocationRef === ref)));
    for (const ref of unknown) await getDb().insert(integrationLocationMappings).values({ id: crypto.randomUUID(), organizationId: context.organizationId, provider: PROVIDER, connectionId: connection.id, externalLocationRef: ref, externalName: "New X-Series outlet", lastSeenAt: startedAt, status: "unmapped", createdAt: startedAt, updatedAt: startedAt }).onConflictDoNothing();
    unmapped += unknown.size;
    // Failed writes must never expose a partially replaced ledger after expiry.
    // An existing approval survives as a grant for a later successful retry.
    const authorized = Boolean(connection.promotionAuthorizedAt || connection.dataPromotionStatus === "approved");
    await getDb().update(integrationConnections).set({ dataPromotionStatus: "staging", promotionAuthorizedAt: connection.promotionAuthorizedAt ?? (authorized ? startedAt : null) }).where(leaseWhere);
    const now = Date.now(), key = ["organization_id", "provider", "connection_id"];
    const common = () => ({ id: crypto.randomUUID(), organization_id: context.organizationId, provider: PROVIDER, connection_id: connection.id, sync_run_id: runId, updated_at: now });
    const prepare = (table: string, unique: string[], values: Record<string, string | number | null>) => {
      // Identifiers below are fixed application schema, never user/provider input.
      const columns = Object.keys(values), updates = columns.filter(column => !["id", ...unique].includes(column));
      return database.prepare("INSERT INTO " + table + " (" + columns.join(",") + ") VALUES (" + columns.map(() => "?").join(",") + ") ON CONFLICT(" + unique.join(",") + ") DO UPDATE SET " + updates.map(column => column + "=excluded." + column).join(",")).bind(...Object.values(values));
    };
    const batch = async (statements: D1PreparedStatement[]) => {
      for (let index = 0; index < statements.length; index += 50) {
        await renewIntegrationSyncLease(lease);
        const results = await database.batch(statements.slice(index, index + 50));
        recordsStaged += results.reduce((sum, row) => sum + Number(row.meta.changes ?? 0), 0);
      }
    };
    await batch(products.map(row => prepare("commerce_products", [...key, "external_product_id"], { ...common(), external_product_id: scoped(row.externalProductId), sku: row.sku, name: row.name, category_ref: scoped(row.categoryRef), category_name: row.categoryName, supplier_ref: scoped(row.supplierRef), default_cost_cents: row.defaultCostCents, default_price_cents: row.defaultPriceCents, archived: +row.archived, source_updated_at: row.sourceUpdatedAt, source_payload_hash: row.sourcePayloadHash })));
    await batch(customers.map(row => prepare("commerce_customers", [...key, "external_customer_id"], { ...common(), external_customer_id: scoped(row.externalCustomerId), display_name: row.displayName, first_name: row.firstName, last_name: row.lastName, email: null, phone: null, archived: +row.archived, source_updated_at: row.sourceUpdatedAt, source_payload_hash: row.sourcePayloadHash })));
    await batch(suppliers.map(row => prepare("commerce_suppliers", [...key, "external_supplier_id"], { ...common(), external_supplier_id: scoped(row.externalSupplierId), name: row.name, archived: +row.archived, source_updated_at: row.sourceUpdatedAt, source_payload_hash: row.sourcePayloadHash })));
    for (const bundle of sales) {
      const sale = bundle.sale, saleRef = scoped(sale.externalSaleId);
      // Ignore an older provider version, including a stale page replay.
      const latest = await database.prepare("SELECT MAX(CAST(external_version AS INTEGER)) version FROM integration_staged_sales WHERE organization_id=? AND provider=? AND connection_id=? AND external_sale_id=?").bind(context.organizationId, PROVIDER, connection.id, saleRef).first<{version:number|null}>();
      if (latest?.version !== null && latest?.version !== undefined && BigInt(latest.version) > BigInt(sale.externalVersion)) continue;
      await batch([
        database.prepare("DELETE FROM commerce_sale_lines WHERE organization_id=? AND provider=? AND connection_id=? AND external_sale_id=?").bind(context.organizationId, PROVIDER, connection.id, saleRef),
        database.prepare("DELETE FROM commerce_payments WHERE organization_id=? AND provider=? AND connection_id=? AND external_sale_id=?").bind(context.organizationId, PROVIDER, connection.id, saleRef),
        ...bundle.lines.map(row => prepare("commerce_sale_lines", [...key, "external_sale_id", "external_line_id"], { ...common(), external_sale_id: saleRef, external_line_id: scoped(row.externalLineId), product_ref: scoped(row.productRef), customer_ref: scoped(row.customerRef), outlet_ref: scoped(row.outletRef), sold_at: row.soldAt, sku: row.sku, product_name: row.productName, quantity_milli: row.quantityMilli, net_sales_cents: row.netSalesCents, cost_cents: row.costCents ?? 0, cost_known: row.costCents === null ? 0 : 1, discount_cents: row.discountCents, source_payload_hash: row.sourcePayloadHash })),
        ...bundle.payments.map(row => prepare("commerce_payments", [...key, "external_payment_id"], { ...common(), external_payment_id: scoped(row.externalPaymentId), external_sale_id: saleRef, payment_type_ref: scoped(row.paymentTypeRef), payment_type_name: row.paymentTypeName, category: row.category, amount_cents: row.amountCents, paid_at: row.paidAt, outlet_ref: scoped(row.outletRef), source_payload_hash: row.sourcePayloadHash })),
        prepare("integration_staged_sales", [...key, "external_sale_id", "external_version"], { id: crypto.randomUUID(), organization_id: context.organizationId, provider: PROVIDER, connection_id: connection.id, external_sale_id: saleRef, external_version: sale.externalVersion, outlet_ref: scoped(sale.outletRef), sold_at: sale.soldAt, state: sale.state, total_cents: sale.totalCents, tax_cents: sale.taxCents, cost_cents: sale.costCents, discount_cents: sale.discountCents, line_count: sale.lineCount, source_payload_hash: sale.sourcePayloadHash, sync_run_id: runId, staged_at: now }),
      ]);
    }
    const productMap = new Map<string,{id:string;sku:string;name:string}>();
    const inventoryProductIds = [...new Set(inventory.map(row => scoped(row.productRef)!))];
    for (let index=0; index<inventoryProductIds.length; index+=90) {
      const ids=inventoryProductIds.slice(index,index+90);
      const rows=await database.prepare("SELECT external_product_id id,sku,name FROM commerce_products WHERE organization_id=? AND provider=? AND connection_id=? AND external_product_id IN ("+ids.map(()=>"?").join(",")+")").bind(context.organizationId,PROVIDER,connection.id,...ids).all<{id:string;sku:string;name:string}>();
      for (const row of rows.results ?? []) productMap.set(row.id,row);
    }
    await batch(inventory.map(row => {
      const product = productMap.get(scoped(row.productRef)!);
      if (!product) throw new ApiError(502, "LIGHTSPEED_PRODUCT_REQUIRED", "Inventory references a product outside the imported catalog. The cursor is preserved.");
      return prepare("inventory_balances", ["organization_id", "location_ref", "sku"], { id: crypto.randomUUID(), organization_id: context.organizationId, location_ref: "lightspeed:" + scoped(row.outletRef), sku: product.sku, name: product.name, on_hand_quantity: row.onHandQuantity, reorder_point: row.reorderPoint, version: now, source_provider: PROVIDER, source_connection_id: connection.id, updated_at: now });
    }));
    await applyOwnerInventoryCosts(context.organizationId, connection.id, now, { publishDailyMetrics: false });
    await database.prepare(`UPDATE commerce_sale_lines AS l SET cost_cents=COALESCE((SELECT ROUND(COALESCE(p.owner_cost_cents,p.default_cost_cents)*l.quantity_milli/1000.0) FROM commerce_products p WHERE p.organization_id=l.organization_id AND p.provider=l.provider AND p.connection_id=l.connection_id AND p.external_product_id=l.product_ref),0) WHERE l.organization_id=? AND l.provider=? AND l.connection_id=? AND l.cost_known=0`).bind(context.organizationId, PROVIDER, connection.id).run();
    const costs = await database.prepare(`SELECT COUNT(*) count FROM commerce_sale_lines l LEFT JOIN commerce_products p ON p.organization_id=l.organization_id AND p.provider=l.provider AND p.connection_id=l.connection_id AND p.external_product_id=l.product_ref WHERE l.organization_id=? AND l.provider=? AND l.connection_id=? AND l.quantity_milli<>0 AND l.cost_known=0 AND l.cost_cents=0 AND COALESCE(p.owner_cost_cents,p.default_cost_cents) IS NULL`).bind(context.organizationId, PROVIDER, connection.id).first<{count:number}>();
    const missingCosts = Number(costs?.count ?? 0), backfillComplete = resources.every(resource => next.resources[resource].complete);
    const publish = authorized && backfillComplete && unmapped === 0 && mapped.size > 0 && missingCosts === 0;
    let publishedMetrics = 0;
    if (publish) {
      const latest = await database.prepare(`SELECT external_sale_id externalSaleId, external_version externalVersion, outlet_ref outletRef, sold_at soldAt, state, total_cents totalCents, tax_cents taxCents, discount_cents discountCents, line_count lineCount, source_payload_hash sourcePayloadHash,
        COALESCE((SELECT SUM(cost_cents) FROM commerce_sale_lines l WHERE l.organization_id=s.organization_id AND l.provider=s.provider AND l.connection_id=s.connection_id AND l.external_sale_id=s.external_sale_id),0) costCents,
        COALESCE((SELECT SUM(quantity_milli) FROM commerce_sale_lines l WHERE l.organization_id=s.organization_id AND l.provider=s.provider AND l.connection_id=s.connection_id AND l.external_sale_id=s.external_sale_id),0) unitsMilli
        FROM (SELECT *,ROW_NUMBER() OVER(PARTITION BY external_sale_id ORDER BY CAST(external_version AS INTEGER) DESC, staged_at DESC,id DESC) rank FROM integration_staged_sales WHERE organization_id=? AND provider=? AND connection_id=?) s WHERE rank=1`).bind(context.organizationId, PROVIDER, connection.id).all<NormalizedLightspeedSale & {unitsMilli:number}>();
      const metrics = buildXDailyMetrics((latest.results ?? []).filter(sale => mapped.has(unscopedExternalRef(connection.sourceNamespace, sale.outletRef) ?? "") && (connection.sourceNamespace === "legacy" || sale.externalSaleId.startsWith(connection.sourceNamespace + ":"))), context.organization.timezone);
      const importId = "provider-" + runId;
      await database.prepare("INSERT INTO data_imports(id,organization_id,import_type,status,file_name,row_count,idempotency_key,imported_by_user_id,created_at) VALUES (?,?,'manual_entry','completed','X-Series read-only sync',?,?,?,?)").bind(importId, context.organizationId, metrics.length, runId, context.userId, now).run();
      await batch([
        database.prepare("DELETE FROM daily_business_metrics WHERE organization_id=? AND source_provider=? AND source_connection_id=?").bind(context.organizationId, PROVIDER, connection.id),
        ...metrics.map(row => prepare("daily_business_metrics", ["organization_id", "business_date", "location_ref"], { organization_id: context.organizationId, business_date: row.businessDate, location_ref: row.locationRef, gross_sales_cents: row.grossSalesCents, net_sales_cents: row.netSalesCents, cost_of_goods_cents: row.costOfGoodsCents, transaction_count: row.transactionCount, units_sold: row.unitsSold, refunds_cents: row.refundsCents, discounts_cents: row.discountsCents, labour_cost_cents: 0, source_provider: PROVIDER, source_connection_id: connection.id, source_import_id: importId, created_by_user_id: context.userId, created_at: now, updated_at: now })),
      ]);
      publishedMetrics = metrics.length;
    }
    next.cycleComplete = backfillComplete;
    if (backfillComplete) { next.watermark = new Date().toISOString(); for (const resource of resources) next.resources[resource].complete = false; }
    const cursor = JSON.stringify(next), completedAt = new Date();
    const errorCode = unmapped ? "LIGHTSPEED_LOCATION_UNMAPPED" : missingCosts ? "LIGHTSPEED_ITEM_COST_REQUIRED" : null;
    await getDb().update(integrationSyncRuns).set({ status: "completed", cursorAfter: cursor, recordsRead, recordsStaged, warningCount: unmapped + missingCosts, completedAt }).where(eq(integrationSyncRuns.id, runId));
    await renewIntegrationSyncLease(lease);
    const updated = await getDb().update(integrationConnections).set({ lastSuccessfulSyncAt: completedAt, lastSyncCursor: cursor, dataPromotionStatus: publish ? "approved" : "staging", promotionAuthorizedAt: publish ? null : connection.promotionAuthorizedAt ?? (authorized ? startedAt : null), lastErrorCode: errorCode, syncLeaseOwner: null, syncLeaseExpiresAt: null, updatedAt: completedAt }).where(leaseWhere).returning({id: integrationConnections.id});
    if (!updated.length) throw new ApiError(409, "INTEGRATION_SYNC_LEASE_LOST", "The X-Series sync was superseded before publication.");
    await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId, action: "integration.data_imported", resourceType: "integration_sync_run", resourceId: runId, details: { provider: PROVIDER, connectionId: connection.id, recordsRead, recordsStaged, publishedMetrics, missingCosts, unmapped, backfillComplete } });
    return jsonResponse({ provider: PROVIDER, connectionId: connection.id, backfillComplete, run: { id: runId, status: "completed", recordsRead, recordsStaged, warningCount: unmapped + missingCosts }, reconciliation: { sales: sales.length, products: products.length, customers: customers.length, suppliers: suppliers.length, inventoryBalances: inventory.length, unmappedLocations: unmapped, missingItemCosts: missingCosts, dailyMetrics: publishedMetrics }, readyForReview: backfillComplete && !errorCode, stagingOnly: !publish, dataPromotionEnabled: publish, nextStep: errorCode ? "Review outlet mappings and supply missing item costs, then sync again." : !backfillComplete ? "History import is continuing. Automatic sync resumes from the saved checkpoints." : publish ? "X-Series data is synchronized and available across Vanteloq." : "Review and approve this import to use it in reports." });
  } catch (error) {
    const code = error instanceof ApiError ? error.code : "LIGHTSPEED_SYNC_FAILED";
    await getDb().update(integrationSyncRuns).set({ status: "failed", errorCode: code, completedAt: new Date() }).where(eq(integrationSyncRuns.id, runId));
    await getDb().update(integrationConnections).set({ lastErrorCode: code, updatedAt: new Date() }).where(leaseWhere);
    throw error;
  } finally { await releaseIntegrationSyncLease(lease); }
}
