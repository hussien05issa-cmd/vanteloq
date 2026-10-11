import { withPosPublicationProof } from "../pos-publication";
import { and, eq } from "drizzle-orm";
import { businessDateForTimestamp } from "../../../domain/intraday-sales";
import { getD1, getDb } from "../../../db";
import { integrationConnections, integrationLocationMappings, integrationSyncRuns } from "../../../db/schema";
import { scopeExternalRef, unscopedExternalRef } from "../../../domain/integration-source";
import { recordAudit } from "../../audit";
import { ApiError, enforceRateLimit, jsonResponse, } from "../../api";
import { acquireIntegrationSyncLease, releaseIntegrationSyncLease, renewIntegrationSyncLease, requireOwnedIntegrationConnection, sqliteTimestampSeconds } from "../../integrations/connection";
import { SHOPIFY_ONLINE_LOCATION_REF, SHOPIFY_POS_PROVIDER, fetchShopifyIdentity, shopifyGraphql, shopifySha256 } from "../../integrations/shopify-pos";
import { applyOwnerInventoryCosts } from "../../inventory-costs";
import { SHOPIFY_FINANCIAL_VERSION, normalizeShopifyOrder, requireShopifyCurrency, shopifyMoney, exactShopifySum, type ShopifyMoney, type ShopifyOrder } from "../shopify-financials";

const ORDERS_QUERY = `query VanteloqShopifyOrders($orderQuery: String!, $after: String) {
  orders(first: 100, after: $after, sortKey: CREATED_AT, reverse: true, query: $orderQuery) {
    nodes { id name sourceName createdAt updatedAt displayFinancialStatus cancelledAt test taxesIncluded retailLocation { id } customer { id }
      currentTotalPriceSet { shopMoney { amount currencyCode } } currentSubtotalPriceSet { shopMoney { amount currencyCode } } currentTotalTaxSet { shopMoney { amount currencyCode } } currentTotalDiscountsSet { shopMoney { amount currencyCode } } totalRefundedSet { shopMoney { amount currencyCode } }
      lineItems(first: 100) { nodes { id name quantity currentQuantity discountedTotalSet { shopMoney { amount currencyCode } } totalDiscountSet { shopMoney { amount currencyCode } } variant { id sku product { title } } } pageInfo { hasNextPage endCursor } }
      transactions { id kind status gateway processedAt amountSet { shopMoney { amount currencyCode } } }
    } pageInfo { hasNextPage endCursor }
  }
}`;

const PRODUCT_VARIANTS_QUERY = `query VanteloqShopifyProductVariants($after: String) {
  productVariants(first: 100, after: $after) {
    nodes { id sku title price inventoryQuantity updatedAt product { id title vendor productType status updatedAt }
      inventoryItem { unitCost { amount currencyCode } inventoryLevels(first: 50) { nodes { location { id name } quantities(names: ["available"]) { name quantity } } pageInfo { hasNextPage endCursor } } }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

const CUSTOMERS_QUERY = `query VanteloqShopifyCustomers($after: String) {
  customers(first: 100, after: $after, sortKey: UPDATED_AT) { nodes { id updatedAt } pageInfo { hasNextPage endCursor } }
}`;

type Money = ShopifyMoney;
type Page<T> = { nodes: T[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
type Customer = { id: string; updatedAt?: string | null };
type Order = ShopifyOrder;
type Product = { id: string; title: string; vendor?: string | null; productType?: string | null; status?: string; updatedAt?: string };
type ProductVariant = { id: string; sku?: string | null; title?: string | null; price?: string | null; inventoryQuantity?: number | null; updatedAt?: string | null; product: Product; inventoryItem?: { unitCost?: Money | null; inventoryLevels?: { pageInfo?: { hasNextPage: boolean }; nodes: Array<{ location: { id: string; name: string }; quantities: Array<{ name: string; quantity: number }> }> } | null } | null };
type Checkpoint = { version: 2; orders: string | null; products: string | null; customers: string | null; complete: { orders: boolean; products: boolean; customers: boolean } };
const emptyCheckpoint = (): Checkpoint => ({ version: 2, orders: null, products: null, customers: null, complete: { orders: false, products: false, customers: false } });
function parseCheckpoint(value: string | null): Checkpoint { if (!value) return emptyCheckpoint(); try { const parsed = JSON.parse(value) as Checkpoint; return parsed.version === 2 && parsed.complete ? parsed : emptyCheckpoint(); } catch { return emptyCheckpoint(); } }
function tender(gateway?: string | null): "cash" | "card" | "gift_card" | "store_credit" | "other" { const name = (gateway ?? "").toLowerCase(); if (name.includes("cash")) return "cash"; if (name.includes("gift")) return "gift_card"; if (name.includes("credit") && name.includes("store")) return "store_credit"; if (name && !name.includes("manual")) return "card"; return "other"; }
async function batches(statements: D1PreparedStatement[]) { let changed = 0; for (let index = 0; index < statements.length; index += 75) { const result = await getD1().batch(statements.slice(index, index + 75)); changed += result.reduce((sum, row) => sum + Number(row.meta.changes ?? 0), 0); } return changed; }

import type { SyncContext, SyncTrigger } from "./types";

export async function runSync(request: Request, requestId: string, context: SyncContext, input: Record<string, unknown>, trigger: SyncTrigger, shopifyProvider: "shopify" | "shopify-pos") {
    const provider = shopifyProvider; const isCommerce = provider !== SHOPIFY_POS_PROVIDER; const providerLabel = isCommerce ? "Shopify e-commerce" : "Shopify POS";
     const reason = trigger === "scheduled" || input.reason === "manual" ? "manual" : "auto";
    const connection = await requireOwnedIntegrationConnection(context.organizationId, provider, typeof input.connectionId === "string" ? input.connectionId : null, { connected: true });
    if (!connection.domainPrefix) throw new ApiError(409, "SHOPIFY_NOT_CONNECTED", "Reconnect the Shopify store before synchronizing it.");
    if (reason === "auto") return jsonResponse({ provider, connectionId: connection.id, skipped: true, nextStep: `${providerLabel} background refresh is controlled by the automatic sync setting.` });
    if (trigger === "manual") await enforceRateLimit(`${provider}:manual-sync`, context.organizationId, 30, 3600);
    const lease = await acquireIntegrationSyncLease(context.organizationId, provider, connection.id);
    if (!lease) return jsonResponse({ provider: provider, connectionId: connection.id, coalesced: true, nextStep: "This Shopify store is already synchronizing." });
    const startedAt = new Date(); const runId = `${provider}-${crypto.randomUUID()}`; const importId = `provider-${provider}-${runId}`; const previous = parseCheckpoint(connection.lastSyncCursor); const database = getD1();
    const leaseWhere = and(eq(integrationConnections.id, connection.id), eq(integrationConnections.organizationId, context.organizationId), eq(integrationConnections.provider, provider), eq(integrationConnections.syncLeaseOwner, lease.owner), eq(integrationConnections.syncVersion, lease.version));
    const publishRequested = Boolean(connection.promotionAuthorizedAt || connection.dataPromotionStatus === "approved");
    const guard = () => database.prepare(`INSERT INTO integration_connections (id) SELECT ? WHERE NOT EXISTS (
      SELECT 1 FROM integration_connections WHERE id=? AND organization_id=? AND provider=? AND status='connected'
      AND sync_lease_owner=? AND sync_version=? AND sync_lease_expires_at>?)`)
      .bind(connection.id, connection.id, context.organizationId, provider, lease.owner, lease.version, sqliteTimestampSeconds());
    try {
      const [demoted] = await getDb().update(integrationConnections).set({ dataPromotionStatus: "staging", promotionAuthorizedAt: publishRequested ? connection.promotionAuthorizedAt ?? startedAt : null }).where(leaseWhere).returning({ id: integrationConnections.id });
      if (!demoted) throw new ApiError(409, "INTEGRATION_SYNC_LEASE_LOST", "This Shopify synchronization was superseded.");
      const identity = await fetchShopifyIdentity(context.organizationId, connection.id, connection.domainPrefix, provider);
      requireShopifyCurrency(identity.shop.currencyCode, context.organization.currency);
      await database.prepare(`INSERT INTO integration_sync_runs (id, organization_id, provider, connection_id, mode, status, cursor_before, records_read, records_staged, duplicates_skipped, warning_count, started_at, created_by_user_id) VALUES (?, ?, ?, ?, 'incremental', 'running', ?, 0, 0, 0, 0, ?, ?)`)
        .bind(runId, context.organizationId, provider, connection.id, connection.lastSyncCursor, sqliteTimestampSeconds(startedAt.getTime()), context.userId).run();
      const emptyPage = <T,>(): Page<T> => ({ nodes: [], pageInfo: { hasNextPage: false, endCursor: null } });
      const orders = previous.complete.orders ? emptyPage<Order>() : (await shopifyGraphql<{ orders: Page<Order> }>(context.organizationId, connection.id, connection.domainPrefix, ORDERS_QUERY, {
        orderQuery: isCommerce ? "source_name:web" : "source_name:pos",
        after: previous.orders,
      }, fetch, provider)).orders;
      await renewIntegrationSyncLease(lease);
      const productVariants = previous.complete.products ? emptyPage<ProductVariant>() : (await shopifyGraphql<{ productVariants: Page<ProductVariant> }>(context.organizationId, connection.id, connection.domainPrefix, PRODUCT_VARIANTS_QUERY, {
        after: previous.products,
      }, fetch, provider)).productVariants;
      await renewIntegrationSyncLease(lease);
      const customers = previous.complete.customers ? emptyPage<Customer>() : (await shopifyGraphql<{ customers: Page<Customer> }>(context.organizationId, connection.id, connection.domainPrefix, CUSTOMERS_QUERY, {
        after: previous.customers,
      }, fetch, provider)).customers;
      const data = {
        orders: orders ?? emptyPage<Order>(),
        productVariants: productVariants ?? emptyPage<ProductVariant>(),
        customers: customers ?? emptyPage<Customer>(),
      };
      await renewIntegrationSyncLease(lease);
      const mappings = await getDb().select().from(integrationLocationMappings).where(and(eq(integrationLocationMappings.organizationId, context.organizationId), eq(integrationLocationMappings.provider, provider), eq(integrationLocationMappings.connectionId, connection.id)));
      const mapped = new Set(mappings.filter((row) => row.status === "mapped").map((row) => row.externalLocationRef)); const unmapped = mappings.filter((row) => row.status === "unmapped").length; const scoped = (value: string | null) => scopeExternalRef(connection.sourceNamespace, value); const now = Date.now();
      // Normalize the complete page before any source records are changed.
      const normalizedOrders = data.orders.nodes.map(order => ({ order, financial: normalizeShopifyOrder(order, context.organization.currency) }));
      for (const variant of data.productVariants.nodes) {
        if (variant.inventoryItem?.unitCost != null) shopifyMoney(variant.inventoryItem.unitCost, context.organization.currency);
        shopifyMoney({ amount: variant.price, currencyCode: identity.shop.currencyCode }, context.organization.currency);
        if (variant.inventoryItem?.inventoryLevels?.pageInfo?.hasNextPage !== false) throw new ApiError(409, "SHOPIFY_INVENTORY_PAGE_REQUIRED", "Complete Shopify inventory pages before publication.");
      }
      const suppliers = [...new Set(data.productVariants.nodes.map((variant) => variant.product.vendor?.trim()).filter((value): value is string => Boolean(value)))];
      const supplierStatements = await Promise.all(suppliers.map(async (name) => database.prepare(`INSERT INTO commerce_suppliers (id, organization_id, provider, connection_id, external_supplier_id, name, archived, source_updated_at, source_payload_hash, sync_run_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?) ON CONFLICT(organization_id, provider, connection_id, external_supplier_id) DO UPDATE SET name=excluded.name, source_payload_hash=excluded.source_payload_hash, sync_run_id=excluded.sync_run_id, updated_at=excluded.updated_at`).bind(crypto.randomUUID(), context.organizationId, provider, connection.id, scoped(name.toLowerCase()), name.slice(0, 160), await shopifySha256(name), runId, now)));
      const importedSuppliers = await batches(supplierStatements);
      const variants = data.productVariants.nodes.map((variant) => ({ product: variant.product, variant }));
      const productStatements = await Promise.all(variants.map(async ({ product, variant }) => { const external = scoped(variant.id); const sku = variant.sku?.trim() || variant.id.split("/").at(-1) || variant.id; const variantTitle = variant.title?.trim(); const name = variantTitle && variantTitle !== "Default Title" ? `${product.title} · ${variantTitle}` : product.title; const sourceUpdatedAt = variant.updatedAt || product.updatedAt || null; const hash = await shopifySha256(JSON.stringify([sourceUpdatedAt, variant.id, variant.price, variant.inventoryItem?.unitCost?.amount])); return database.prepare(`INSERT INTO commerce_products (id, organization_id, provider, connection_id, external_product_id, sku, name, category_ref, supplier_ref, default_cost_cents, default_price_cents, archived, source_updated_at, source_payload_hash, sync_run_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(organization_id, provider, connection_id, external_product_id) DO UPDATE SET sku=excluded.sku, name=excluded.name, category_ref=excluded.category_ref, supplier_ref=excluded.supplier_ref, default_cost_cents=excluded.default_cost_cents, default_price_cents=excluded.default_price_cents, archived=excluded.archived, source_updated_at=excluded.source_updated_at, source_payload_hash=excluded.source_payload_hash, sync_run_id=excluded.sync_run_id, updated_at=excluded.updated_at`).bind(crypto.randomUUID(), context.organizationId, provider, connection.id, external, sku.slice(0, 160), name.slice(0, 240), scoped(product.productType || null), scoped(product.vendor?.toLowerCase() || null), variant.inventoryItem?.unitCost != null ? shopifyMoney(variant.inventoryItem.unitCost, context.organization.currency) : null, shopifyMoney({ amount: variant.price, currencyCode: identity.shop.currencyCode }, context.organization.currency), product.status === "ARCHIVED" ? 1 : 0, sourceUpdatedAt, hash, runId, now); }));
      const importedProducts = await batches(productStatements);
      const customersById = new Map<string, Customer>(); for (const customer of data.customers.nodes) customersById.set(customer.id, customer); for (const order of data.orders.nodes) if (order.customer?.id) customersById.set(order.customer.id, order.customer);
      const customerStatements = await Promise.all([...customersById.values()].map(async (customer) => { const display = "Shopify customer"; return database.prepare(`INSERT INTO commerce_customers (id, organization_id, provider, connection_id, external_customer_id, display_name, first_name, last_name, email, phone, archived, source_updated_at, source_payload_hash, sync_run_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, 0, ?, ?, ?, ?) ON CONFLICT(organization_id, provider, connection_id, external_customer_id) DO UPDATE SET display_name=excluded.display_name, first_name=NULL, last_name=NULL, email=NULL, phone=NULL, source_updated_at=excluded.source_updated_at, source_payload_hash=excluded.source_payload_hash, sync_run_id=excluded.sync_run_id, updated_at=excluded.updated_at`).bind(crypto.randomUUID(), context.organizationId, provider, connection.id, scoped(customer.id), display, customer.updatedAt || null, await shopifySha256(JSON.stringify([customer.id, customer.updatedAt])), runId, now); }));
      const importedCustomers = await batches(customerStatements);
      const completedOrders = normalizedOrders.filter(row => row.financial.state === "completed");
      let importedLines = 0, importedPayments = 0, stagedSales = 0;
      for (const { order, financial } of normalizedOrders) {
        const old = await database.prepare(`SELECT outlet_ref outletRef, external_version version FROM integration_staged_sales
          WHERE organization_id=? AND provider=? AND connection_id=? AND external_sale_id=? ORDER BY staged_at DESC,id DESC LIMIT 1`)
          .bind(context.organizationId, provider, connection.id, scoped(order.id)).first<{outletRef:string|null;version:string}>();
        const oldVersion = old?.version.startsWith(SHOPIFY_FINANCIAL_VERSION + ":") ? old.version.slice(SHOPIFY_FINANCIAL_VERSION.length + 1) : old?.version;
        if (oldVersion && Date.parse(oldVersion) > Date.parse(order.updatedAt)) continue;
        const location = isCommerce ? SHOPIFY_ONLINE_LOCATION_REF : order.retailLocation?.id ?? (old?.outletRef ? unscopedExternalRef(connection.sourceNamespace, old.outletRef) : null);
        if (!location || !mapped.has(location)) throw new ApiError(409, "SHOPIFY_LOCATION_UNMAPPED", "Map the order's verified Shopify location before publication.");
        const statements = [guard(),
          database.prepare(`DELETE FROM commerce_sale_lines WHERE organization_id=? AND provider=? AND connection_id=? AND external_sale_id=? AND external_line_id NOT IN (SELECT value FROM json_each(?))`)
            .bind(context.organizationId, provider, connection.id, scoped(order.id), JSON.stringify(financial.lines.map(line => scoped(line.id)))),
          database.prepare(`DELETE FROM commerce_payments WHERE organization_id=? AND provider=? AND connection_id=? AND external_sale_id=? AND external_payment_id NOT IN (SELECT value FROM json_each(?))`)
            .bind(context.organizationId, provider, connection.id, scoped(order.id), JSON.stringify(financial.payments.map(payment => scoped(payment.id)))),
        ];
        for (const line of financial.lines) statements.push(database.prepare(`INSERT INTO commerce_sale_lines
          (id, organization_id, provider, connection_id, external_sale_id, external_line_id, product_ref, customer_ref, outlet_ref, sold_at, sku, product_name, quantity_milli, net_sales_cents, cost_cents, discount_cents, source_payload_hash, sync_run_id, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
          ON CONFLICT(organization_id,provider,connection_id,external_sale_id,external_line_id) DO UPDATE SET
          product_ref=excluded.product_ref,customer_ref=excluded.customer_ref,outlet_ref=excluded.outlet_ref,sold_at=excluded.sold_at,sku=excluded.sku,product_name=excluded.product_name,
          quantity_milli=excluded.quantity_milli,net_sales_cents=excluded.net_sales_cents,discount_cents=excluded.discount_cents,source_payload_hash=excluded.source_payload_hash,sync_run_id=excluded.sync_run_id,updated_at=excluded.updated_at`)
          .bind(crypto.randomUUID(), context.organizationId, provider, connection.id, scoped(order.id), scoped(line.id), scoped(line.variant?.id ?? null), scoped(order.customer?.id ?? null), scoped(location), financial.soldAt,
            line.variant?.sku ?? null, (line.variant?.product?.title ?? line.name).slice(0,240), line.quantity, line.net, line.discount, await shopifySha256(JSON.stringify(line)), runId, now));
        for (const payment of financial.payments) statements.push(database.prepare(`INSERT INTO commerce_payments
          (id,organization_id,provider,connection_id,external_payment_id,external_sale_id,payment_type_ref,payment_type_name,category,amount_cents,paid_at,outlet_ref,source_payload_hash,sync_run_id,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(organization_id,provider,connection_id,external_payment_id) DO UPDATE SET
          external_sale_id=excluded.external_sale_id,payment_type_ref=excluded.payment_type_ref,payment_type_name=excluded.payment_type_name,category=excluded.category,
          amount_cents=excluded.amount_cents,paid_at=excluded.paid_at,outlet_ref=excluded.outlet_ref,source_payload_hash=excluded.source_payload_hash,sync_run_id=excluded.sync_run_id,updated_at=excluded.updated_at`)
          .bind(crypto.randomUUID(), context.organizationId, provider, connection.id, scoped(payment.id), scoped(order.id), scoped(payment.gateway ?? "other"), (payment.gateway ?? "Other").slice(0,120),
            tender(payment.gateway), payment.amount, payment.paidAt, scoped(location), await shopifySha256(JSON.stringify(payment)), runId, now));
        statements.push(database.prepare(`INSERT INTO integration_staged_sales
          (id,organization_id,provider,connection_id,external_sale_id,external_version,outlet_ref,sold_at,state,total_cents,tax_cents,cost_cents,discount_cents,line_count,units_milli,source_payload_hash,sync_run_id,staged_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?) ON CONFLICT(organization_id,provider,connection_id,external_sale_id,external_version) DO UPDATE SET
          outlet_ref=excluded.outlet_ref,sold_at=excluded.sold_at,state=excluded.state,total_cents=excluded.total_cents,tax_cents=excluded.tax_cents,discount_cents=excluded.discount_cents,
          line_count=excluded.line_count,units_milli=excluded.units_milli,source_payload_hash=excluded.source_payload_hash,sync_run_id=excluded.sync_run_id,staged_at=excluded.staged_at`)
          .bind(crypto.randomUUID(), context.organizationId, provider, connection.id, scoped(order.id), financial.version, scoped(location), financial.soldAt, financial.state, financial.total, financial.tax,
            financial.discount, financial.lines.length, financial.unitsMilli, await shopifySha256(JSON.stringify(financial)), runId, now));
        await database.batch(statements);
        importedLines += financial.lines.length; importedPayments += financial.payments.length; stagedSales++;
      }
      const inventoryStatements: D1PreparedStatement[] = []; for (const { product, variant } of variants) { const sku = variant.sku?.trim() || variant.id.split("/").at(-1) || variant.id; for (const level of variant.inventoryItem?.inventoryLevels?.nodes ?? []) { if (!mapped.has(level.location.id)) continue; const available = level.quantities.find((quantity) => quantity.name === "available")?.quantity ?? variant.inventoryQuantity ?? 0; inventoryStatements.push(database.prepare(`INSERT INTO inventory_balances (id, organization_id, location_ref, sku, name, on_hand_quantity, reorder_point, version, source_provider, source_connection_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?) ON CONFLICT(organization_id, location_ref, sku) DO UPDATE SET name=excluded.name, on_hand_quantity=excluded.on_hand_quantity, version=inventory_balances.version+1, source_provider=excluded.source_provider, source_connection_id=excluded.source_connection_id, updated_at=excluded.updated_at`).bind(crypto.randomUUID(), context.organizationId, `${provider}:${scoped(level.location.id)}`, sku.slice(0, 160), product.title.slice(0, 240), Math.max(0, available), provider, connection.id, now)); } }
      const importedInventory = await batches(inventoryStatements);
      await database.prepare(`UPDATE commerce_sale_lines AS line SET cost_cents=COALESCE((SELECT ROUND(COALESCE(product.owner_cost_cents, product.default_cost_cents) * line.quantity_milli / 1000.0) FROM commerce_products product WHERE product.organization_id=line.organization_id AND product.provider=line.provider AND product.connection_id=line.connection_id AND product.external_product_id=line.product_ref), 0) WHERE line.organization_id=? AND line.provider=? AND line.connection_id=?`).bind(context.organizationId, provider, connection.id).run();
      await database.prepare(`UPDATE integration_staged_sales AS sale SET cost_cents=COALESCE((SELECT SUM(line.cost_cents) FROM commerce_sale_lines line WHERE line.organization_id=sale.organization_id AND line.provider=sale.provider AND line.connection_id=sale.connection_id AND line.external_sale_id=sale.external_sale_id), 0) WHERE sale.organization_id=? AND sale.provider=? AND sale.connection_id=?`).bind(context.organizationId, provider, connection.id).run();
      await applyOwnerInventoryCosts(context.organizationId, connection.id, now, { publishDailyMetrics: false });
      const missing = await database.prepare(`SELECT COUNT(*) count FROM commerce_sale_lines line LEFT JOIN commerce_products product ON product.organization_id=line.organization_id AND product.provider=line.provider AND product.connection_id=line.connection_id AND product.external_product_id=line.product_ref WHERE line.organization_id=? AND line.provider=? AND line.connection_id=? AND line.net_sales_cents>0 AND (line.product_ref IS NULL OR (product.owner_cost_cents IS NULL AND product.default_cost_cents IS NULL))`).bind(context.organizationId, provider, connection.id).first<{ count: number }>(); const missingCostCount = Number(missing?.count ?? 0);
      const completedAt = new Date(); const pageComplete = { orders: !data.orders.pageInfo.hasNextPage, products: !data.productVariants.pageInfo.hasNextPage, customers: !data.customers.pageInfo.hasNextPage }; const allComplete = pageComplete.orders && pageComplete.products && pageComplete.customers; let cursor = JSON.stringify(allComplete ? emptyCheckpoint() : { version: 2, orders: data.orders.pageInfo.endCursor, products: data.productVariants.pageInfo.endCursor, customers: data.customers.pageInfo.endCursor, complete: pageComplete } satisfies Checkpoint); const warningCount = unmapped + missingCostCount; const recordsRead = data.orders.nodes.length + data.productVariants.nodes.length + data.customers.nodes.length; const recordsStaged = stagedSales + importedProducts + importedCustomers + importedSuppliers + importedLines + importedPayments + importedInventory;
      const publishCanonical = publishRequested && allComplete && mapped.size > 0 && unmapped === 0 && missingCostCount === 0;
      let publishedMetrics = 0; await database.prepare(`INSERT INTO data_imports (id, organization_id, import_type, status, file_name, row_count, idempotency_key, imported_by_user_id, created_at) VALUES (?, ?, 'manual_entry', 'processing', ?, 0, ?, ?, ?)`).bind(importId, context.organizationId, `${providerLabel} read-only sync`, runId, context.userId, now).run();
      const latest = await database.prepare(`SELECT * FROM (SELECT external_version version,state,outlet_ref outletRef,sold_at soldAt,total_cents totalCents,tax_cents taxCents,cost_cents costCents,discount_cents discountCents,units_milli unitsMilli,
        row_number() OVER (PARTITION BY external_sale_id ORDER BY staged_at DESC,id DESC) rank FROM integration_staged_sales WHERE organization_id=? AND provider=? AND connection_id=?) WHERE rank=1`)
        .bind(context.organizationId, provider, connection.id).all<{version:string;state:string;outletRef:string;soldAt:string;totalCents:number;taxCents:number;costCents:number;discountCents:number;unitsMilli:number|null}>();
      const historyPending = (latest.results ?? []).some(sale => !sale.version.startsWith(SHOPIFY_FINANCIAL_VERSION + ":") || sale.unitsMilli === null);
      const canPublish = publishCanonical && !historyPending;
      const groups = new Map<string, {date:string;location:string;net:number;cost:number;discounts:number;transactions:number;units:number}>();
      if (canPublish) for (const sale of latest.results ?? []) {
        if (sale.state !== "completed") continue;
        const raw = unscopedExternalRef(connection.sourceNamespace, sale.outletRef) ?? sale.outletRef;
        if (!mapped.has(raw)) throw new ApiError(409, "SHOPIFY_LOCATION_UNMAPPED", "Review every historical Shopify location before publication.");
        const date = businessDateForTimestamp(sale.soldAt, context.organization.timezone);
        if (!date) throw new ApiError(409, "SHOPIFY_FINANCIAL_REVIEW_REQUIRED", "Shopify records require valid business dates.");
        const key = `${date}:${raw}`, row = groups.get(key) ?? { date, location:`${provider}:${scoped(raw)}`, net:0,cost:0,discounts:0,transactions:0,units:0 };
        row.net = exactShopifySum([row.net,sale.totalCents,-sale.taxCents]); row.cost = exactShopifySum([row.cost,sale.costCents]);
        row.discounts = exactShopifySum([row.discounts,sale.discountCents]); row.transactions++; row.units = exactShopifySum([row.units,sale.unitsMilli! / 1000]); groups.set(key,row);
      }
      await renewIntegrationSyncLease(lease);
      const publication = [guard()];
      if (canPublish) {
        publication.push(database.prepare(`DELETE FROM daily_business_metrics WHERE organization_id=? AND source_connection_id=?`).bind(context.organizationId,connection.id));
        for (const row of groups.values()) publication.push(database.prepare(`INSERT INTO daily_business_metrics
          (organization_id,business_date,location_ref,gross_sales_cents,net_sales_cents,cost_of_goods_cents,transaction_count,units_sold,refunds_cents,discounts_cents,labour_cost_cents,source_provider,source_connection_id,source_import_id,created_by_user_id,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,0,?,0,?,?,?,?,?,?) ON CONFLICT(organization_id,business_date,location_ref) DO UPDATE SET
          gross_sales_cents=excluded.gross_sales_cents,net_sales_cents=excluded.net_sales_cents,cost_of_goods_cents=excluded.cost_of_goods_cents,transaction_count=excluded.transaction_count,
          units_sold=excluded.units_sold,refunds_cents=excluded.refunds_cents,discounts_cents=excluded.discounts_cents,source_provider=excluded.source_provider,source_connection_id=excluded.source_connection_id,source_import_id=excluded.source_import_id,updated_at=excluded.updated_at`)
          .bind(context.organizationId,row.date,row.location,exactShopifySum([row.net,row.discounts]),row.net,row.cost,row.transactions,row.units,row.discounts,provider,connection.id,importId,context.userId,now,now));
        publishedMetrics = groups.size;
      }
      if (canPublish) cursor = withPosPublicationProof(cursor, importId, groups.size, lease.version);
      const errorCode = !allComplete ? "SHOPIFY_SYNC_MORE_PAGES" : historyPending ? "SHOPIFY_HISTORY_REVIEW_REQUIRED" : unmapped ? "SHOPIFY_LOCATION_UNMAPPED" : missingCostCount ? "SHOPIFY_PRODUCT_COST_REQUIRED" : null;
      publication.push(database.prepare(`UPDATE data_imports SET status='completed',row_count=? WHERE id=? AND organization_id=?`).bind(recordsStaged+publishedMetrics,importId,context.organizationId));
      publication.push(database.prepare(`UPDATE integration_connections SET last_successful_sync_at=?,last_sync_cursor=?,data_promotion_status=?,promotion_authorized_at=?,last_error_code=?,sync_lease_owner=NULL,sync_lease_expires_at=NULL,updated_at=?
        WHERE id=? AND organization_id=? AND provider=? AND sync_lease_owner=? AND sync_version=?`)
        .bind(allComplete && !historyPending ? sqliteTimestampSeconds(completedAt.getTime()) : connection.lastSuccessfulSyncAt ? sqliteTimestampSeconds(connection.lastSuccessfulSyncAt.getTime()) : null,
          cursor,canPublish ? "approved" : "staging",canPublish ? null : publishRequested ? sqliteTimestampSeconds((connection.promotionAuthorizedAt ?? startedAt).getTime()) : null,errorCode,sqliteTimestampSeconds(completedAt.getTime()),connection.id,context.organizationId,provider,lease.owner,lease.version));
      await database.batch(publication);
      await getDb().update(integrationSyncRuns).set({ status:"completed",cursorAfter:cursor,recordsRead,recordsStaged,warningCount:warningCount+Number(historyPending)+Number(!allComplete),completedAt }).where(eq(integrationSyncRuns.id,runId));
      await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId, action: "integration.data_imported", resourceType: "integration_sync_run", resourceId: runId, details: { provider: provider, connectionId: connection.id, recordsRead, recordsStaged, products: importedProducts, customers: importedCustomers, suppliers: importedSuppliers, inventory: importedInventory, saleLines: importedLines, payments: importedPayments, missingCostCount, unmappedLocations: unmapped, dataPromotionEnabled: canPublish } });
      return jsonResponse({ provider, connectionId: connection.id, backfillComplete: allComplete, run: { id: runId, status: "completed", recordsRead, recordsStaged, duplicatesSkipped: 0, warningCount }, reconciliation: { orders: completedOrders.length, saleLines: importedLines, payments: importedPayments, refunds: 0, products: variants.length, customers: customersById.size, suppliers: suppliers.length, inventoryBalances: inventoryStatements.length, locations: mappings.length, unmappedLocations: unmapped, missingItemCosts: missingCostCount, dailyMetrics: publishedMetrics }, readyForReview: warningCount === 0 && allComplete && !historyPending, stagingOnly: !canPublish, dataPromotionEnabled: canPublish, nextStep: historyPending && allComplete ? "Some historical Shopify records need revalidation before reporting. Review source history access and sync again." : !allComplete ? `Continue the resumable ${providerLabel} history import.` : unmapped ? `Map every ${providerLabel} location, then review the import.` : missingCostCount ? "Add verified item costs in Shopify or Vanteloq before profit is published." : canPublish ? `${providerLabel} data is synchronized and available across Vanteloq.` : `Review and approve this ${providerLabel} import, then run one final sync to publish it.` });
    } catch (error) { const code = error instanceof ApiError ? error.code : "SHOPIFY_SYNC_FAILED"; await getDb().update(integrationSyncRuns).set({ status: "failed", errorCode: code, completedAt: new Date() }).where(eq(integrationSyncRuns.id, runId)); await getDb().update(integrationConnections).set({ dataPromotionStatus: "staging", promotionAuthorizedAt: null, lastErrorCode: code, updatedAt: new Date() }).where(leaseWhere); throw error; } finally { await releaseIntegrationSyncLease(lease); }
}
