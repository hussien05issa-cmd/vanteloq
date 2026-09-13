import { businessTimestampRange } from "../../../../domain/business-period";
import { businessDateOffset, businessClock } from "../../../../domain/intraday-sales";
import { getD1 } from "../../../../db";
import { requireAccess } from "../../../../server/authorization";
import { ApiError, clientSource, enforceRateLimit, handleApi, jsonResponse } from "../../../../server/api";
import { effectivePermissions, requirePermission } from "../../../../server/permissions";
import { authorizedLocationDataScope } from "../../../../server/location-access";
import { commerceSourceAuthority } from "../../../../server/integrations/source-authority";
import { reportSaleLinesSql } from "../../../../server/integrations/report-sale-lines";
import { commerceChangeRate, inventoryDecision, parseCommercePeriod } from "../../../../domain/commerce-intelligence";
import {
  commerceResponseForMode,
  commerceViewFeature,
  type CommerceViewMode,
} from "../../../../domain/paid-feature-routing";

const readers = ["owner", "admin", "manager", "employee", "read_only"] as const;
type MetricRow = {
  netSalesCents: number | null;
  costCents: number | null;
  discountsCents: number | null;
  quantityMilli: number | null;
  transactions: number | null;
  knownCustomerTransactions: number | null;
};

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const url = new URL(request.url);
    const mode = url.searchParams.get("mode");
    const requiredFeature = commerceViewFeature(mode);
    const context = await requireAccess(request, readers, requiredFeature ?? "dashboard.core");
    if (!requiredFeature) {
      throw new ApiError(400, "COMMERCE_MODE_INVALID", "Choose Sales, Inventory, Customers, or Suppliers.");
    }
    await requirePermission(context, "dashboard.view");
    await requirePermission(context, "metrics.revenue");
    await enforceRateLimit("commerce-intelligence:read", `${context.userId}:${clientSource(request)}`, 90, 60);
    const permissions = await effectivePermissions(context);
    const canReadCustomerIdentity = permissions.includes("customers.identity");
    const canReadCustomerTotals = permissions.includes("customers.totals") || canReadCustomerIdentity;
    const canReadProductCosts = permissions.includes("inventory.value") || permissions.includes("finance.costs");
    const canReadProfit = permissions.includes("metrics.profit");
    const canReadSuppliers = permissions.includes("purchasing.view");
    const canReadInventory = permissions.includes("inventory.view");
    const canManageCosts = permissions.includes("inventory.adjust");
    const canImportCosts = canManageCosts && permissions.includes("data.import");
    let period;
    try {
      period = parseCommercePeriod(url.searchParams.get("from"), url.searchParams.get("to"), businessClock(new Date(), context.organization.timezone)!.date);
    } catch (error) {
      throw new ApiError(400, "COMMERCE_PERIOD_INVALID", error instanceof Error ? error.message : "Choose a valid date range.");
    }
    const locationAccess = await authorizedLocationDataScope(context, url.searchParams.get("location"));
    const salesAuthority = await commerceSourceAuthority({ organizationId: context.organizationId, localLocationIds: locationAccess.locationIds ?? locationAccess.locations.map(location => location.id), factFamily: "sales", salesLineFacts: true });
    if (salesAuthority.status === "conflict") throw new ApiError(409, "COMMERCE_SOURCE_OVERLAP", "Sales sources overlap or are syncing. Review the authoritative source in Reports before combining records.");
    const salesScopes = JSON.stringify(salesAuthority.selections.map(item => ({ p: item.provider, c: item.connectionId, o: item.externalOutletRef })));
    const providerLocations = locationAccess.providerLocations ?? [];
    const restricted = locationAccess.locationRefs !== null;
    const blocked = restricted && providerLocations.length === 0;
    const authorizedSaleLocationSql = restricted
      ? blocked
        ? " AND 0 = 1"
        : ` AND (${providerLocations.map(() => "(l.provider = ? AND l.connection_id = ? AND l.outlet_ref = ?)").join(" OR ")})`
      : "";
    const authorizedSaleLocationBindings = restricted && !blocked
      ? providerLocations.flatMap((item) => [item.provider, item.connectionId, item.externalLocationRef])
      : [];
    const saleLocationSql = authorizedSaleLocationSql + " AND EXISTS (SELECT 1 FROM json_each(?) rs WHERE json_extract(rs.value,'$.p')=l.provider AND json_extract(rs.value,'$.c')=l.connection_id AND json_extract(rs.value,'$.o')=l.outlet_ref)";
    const saleLocationBindings = [...authorizedSaleLocationBindings, salesScopes];
    const inventoryAuthority = canReadInventory ? await commerceSourceAuthority({ organizationId: context.organizationId, localLocationIds: locationAccess.locationIds ?? locationAccess.locations.map(location => location.id), factFamily: "inventory" }) : null;
    const inventoryScopes = JSON.stringify(inventoryAuthority?.status === "conflict" ? [] : inventoryAuthority?.selections.map(item => ({ p: item.provider, c: item.connectionId, o: item.metricLocationRef })) ?? []);
    const authorizedInventoryLocationSql = restricted
      ? blocked
        ? " AND 0 = 1"
        : ` AND (${providerLocations.map(() => "(b.source_provider = ? AND b.source_connection_id = ? AND b.location_ref = ?)").join(" OR ")})`
      : "";
    const authorizedInventoryLocationBindings = restricted && !blocked
      ? providerLocations.flatMap((item) => [item.provider, item.connectionId, `${item.provider}:${item.externalLocationRef}`])
      : [];
    const inventoryLocationSql = authorizedInventoryLocationSql + " AND EXISTS (SELECT 1 FROM json_each(?) ri WHERE json_extract(ri.value,'$.p')=b.source_provider AND json_extract(ri.value,'$.c')=b.source_connection_id AND json_extract(ri.value,'$.o')=b.location_ref)";
    const inventoryLocationBindings = [...authorizedInventoryLocationBindings, inventoryScopes];
    const approved = (alias: string, connectionColumn = "connection_id", organizationColumn = "organization_id") => ` AND EXISTS (
      SELECT 1 FROM integration_connections approved
      WHERE approved.id = ${alias}.${connectionColumn}
        AND approved.organization_id = ${alias}.${organizationColumn}
        AND approved.provider = ${alias}.${connectionColumn === "source_connection_id" ? "source_provider" : "provider"}
        AND approved.status = 'connected'
        AND approved.data_promotion_status = 'approved'
        AND (approved.provider <> 'moneris' OR approved.source_namespace LIKE 'production:%')
        AND (approved.sync_lease_owner IS NULL OR approved.sync_lease_expires_at IS NULL OR approved.sync_lease_expires_at <= CAST(strftime('%s','now') AS INTEGER))
    )`;
    const periodWindow = (from: string, toExclusive: string) => businessTimestampRange("l.sold_at", from, businessDateOffset(toExclusive, -1), context.organization.timezone);
    const currentWindow = periodWindow(period.from, period.toExclusive);
    const salePeriodSql = ` AND ${currentWindow.sql}`;
    const database = getD1();
    // A legacy zero cost has no evidence of being a verified free product.
    // Only complete, non-zero line costs can support a historical profit figure.
    const canViewVerifiedProfit = canReadProfit;
    const metrics = async (from: string, toExclusive: string) => database.prepare(`
      SELECT coalesce(sum(l.net_sales_cents), 0) AS netSalesCents,
             CASE WHEN count(l.external_line_id)>0 AND sum(CASE WHEN l.cost_cents IS NULL OR l.cost_cents=0 THEN 1 ELSE 0 END)=0 THEN sum(l.cost_cents) END AS costCents,
             coalesce(sum(l.discount_cents), 0) AS discountsCents,
             coalesce(sum(l.quantity_milli), 0) AS quantityMilli,
             count(DISTINCT l.provider || char(0) || l.connection_id || char(0) || l.external_sale_id) AS transactions,
             count(DISTINCT CASE WHEN l.customer_ref IS NOT NULL THEN l.provider || char(0) || l.connection_id || char(0) || l.external_sale_id END) AS knownCustomerTransactions
      FROM ${reportSaleLinesSql} l
      WHERE l.organization_id = ?${approved("l")}${saleLocationSql}${salePeriodSql}
    `).bind(context.organizationId, ...saleLocationBindings, ...periodWindow(from, toExclusive).bindings).first<MetricRow>();

    const [currentRaw, comparisonRaw, lineRows, inventoryRows, customerRows, supplierRows, productRows] = await Promise.all([
      metrics(period.from, period.toExclusive),
      metrics(period.comparisonFrom, period.comparisonToExclusive),
      database.prepare(`
        SELECT l.provider, l.connection_id AS connectionId, l.external_sale_id AS externalSaleId, l.external_line_id AS externalLineId,
               l.product_ref AS productRef, l.customer_ref AS customerRef, l.outlet_ref AS outletRef,
               l.sold_at AS soldAt, l.sku, coalesce(l.product_name, p.name, l.sku, 'Unclassified item') AS productName,
               l.quantity_milli AS quantityMilli, l.net_sales_cents AS netSalesCents,
               nullif(l.cost_cents, 0) AS costCents, l.discount_cents AS discountCents,
               c.display_name AS customerName, c.email AS customerEmail, c.phone AS customerPhone
        FROM ${reportSaleLinesSql} l
        LEFT JOIN commerce_products p ON p.organization_id = l.organization_id AND p.provider = l.provider AND p.connection_id = l.connection_id AND p.external_product_id = l.product_ref
        LEFT JOIN commerce_customers c ON c.organization_id = l.organization_id AND c.provider = l.provider AND c.connection_id = l.connection_id AND c.external_customer_id = l.customer_ref
        WHERE l.organization_id = ?${approved("l")}${saleLocationSql}${salePeriodSql}
        ORDER BY l.sold_at DESC, l.external_sale_id DESC, l.external_line_id DESC LIMIT 1000
      `).bind(context.organizationId, ...saleLocationBindings, ...currentWindow.bindings).all<Record<string, unknown>>(),
      canReadInventory ? database.prepare(`
        SELECT b.source_provider AS provider, b.source_connection_id AS connectionId, b.location_ref AS locationRef,
               b.sku, b.name, b.on_hand_quantity AS onHandQuantity, b.reorder_point AS reorderPoint,
               b.updated_at AS updatedAt, p.external_product_id AS externalProductId, p.category_ref AS categoryRef,
               p.supplier_ref AS supplierRef, p.default_cost_cents AS defaultCostCents, p.default_price_cents AS defaultPriceCents,
               p.owner_cost_cents AS ownerCostCents, p.owner_cost_source AS ownerCostSource,
               p.owner_cost_updated_at AS ownerCostUpdatedAt,
               coalesce(p.owner_cost_cents, p.default_cost_cents) AS effectiveCostCents,
               coalesce(sales.quantity_milli, 0) AS periodQuantityMilli,
               coalesce(sales.net_sales_cents, 0) AS periodNetSalesCents,
               sales.cost_cents AS periodCostCents,
               coalesce(sales.discount_cents, 0) AS periodDiscountCents
        FROM inventory_balances b
        LEFT JOIN commerce_products p ON p.organization_id = b.organization_id AND p.provider = b.source_provider AND p.connection_id = b.source_connection_id AND p.sku = b.sku AND p.archived = 0 AND (SELECT count(*) FROM commerce_products unique_product WHERE unique_product.organization_id=b.organization_id AND unique_product.provider=b.source_provider AND unique_product.connection_id=b.source_connection_id AND unique_product.sku=b.sku AND unique_product.archived=0)=1
        LEFT JOIN (
          SELECT l.provider, l.connection_id, l.outlet_ref, l.sku, sum(l.quantity_milli) quantity_milli, sum(l.net_sales_cents) net_sales_cents,
                 CASE WHEN count(l.external_line_id)>0 AND sum(CASE WHEN l.cost_cents IS NULL OR l.cost_cents=0 THEN 1 ELSE 0 END)=0 THEN sum(l.cost_cents) END cost_cents, sum(l.discount_cents) discount_cents
          FROM ${reportSaleLinesSql} l WHERE l.organization_id = ? AND ${currentWindow.sql}${saleLocationSql}
          GROUP BY l.provider, l.connection_id, l.outlet_ref, l.sku
        ) sales ON sales.provider = b.source_provider AND sales.connection_id = b.source_connection_id AND sales.sku = b.sku AND b.location_ref = sales.provider || ':' || sales.outlet_ref
        WHERE b.organization_id = ?${approved("b", "source_connection_id")}${inventoryLocationSql}
        ORDER BY CASE WHEN b.on_hand_quantity <= 0 THEN 0 WHEN b.on_hand_quantity <= b.reorder_point THEN 1 ELSE 2 END, b.name COLLATE NOCASE LIMIT 2000
      `).bind(context.organizationId, ...currentWindow.bindings, ...saleLocationBindings, context.organizationId, ...inventoryLocationBindings).all<Record<string, unknown>>() : Promise.resolve({ results: [] }),
      canReadCustomerTotals ? database.prepare(`
        SELECT c.provider, c.connection_id AS connectionId, c.external_customer_id AS externalCustomerId, c.display_name AS displayName,
               c.email, c.phone, c.source_updated_at AS sourceUpdatedAt,
               count(DISTINCT l.provider || char(0) || l.connection_id || char(0) || l.external_sale_id) AS transactionCount,
               coalesce(sum(l.net_sales_cents), 0) AS netSalesCents, CASE WHEN count(l.external_line_id)>0 AND sum(CASE WHEN l.cost_cents IS NULL OR l.cost_cents=0 THEN 1 ELSE 0 END)=0 THEN sum(l.cost_cents) END AS costCents,
               coalesce(sum(l.discount_cents), 0) AS discountCents, max(l.sold_at) AS lastPurchaseAt
        FROM commerce_customers c
        LEFT JOIN ${reportSaleLinesSql} l ON l.organization_id = c.organization_id AND l.provider = c.provider AND l.connection_id = c.connection_id
          AND l.customer_ref = c.external_customer_id AND ${currentWindow.sql}${saleLocationSql}
        WHERE c.organization_id = ? AND c.archived = 0${approved("c")}${restricted ? " AND l.external_line_id IS NOT NULL" : ""}
        GROUP BY c.provider, c.connection_id, c.external_customer_id
        ORDER BY netSalesCents DESC, c.display_name COLLATE NOCASE LIMIT 1000
      `).bind(...currentWindow.bindings, ...saleLocationBindings, context.organizationId).all<Record<string, unknown>>() : Promise.resolve({ results: [] }),
      canReadSuppliers ? database.prepare(`
        SELECT s.provider, s.connection_id AS connectionId, s.external_supplier_id AS externalSupplierId, s.name, s.account_number AS accountNumber,
               s.contact_name AS contactName, s.email, s.phone, s.source_updated_at AS sourceUpdatedAt,
               count(DISTINCT p.external_product_id) AS productCount,
               coalesce(sum(l.quantity_milli), 0) AS periodQuantityMilli,
               coalesce(sum(l.net_sales_cents), 0) AS periodNetSalesCents,
               CASE WHEN count(l.external_line_id)>0 AND sum(CASE WHEN l.cost_cents IS NULL OR l.cost_cents=0 THEN 1 ELSE 0 END)=0 THEN sum(l.cost_cents) END AS periodCostCents
        FROM commerce_suppliers s
        LEFT JOIN commerce_products p ON p.organization_id = s.organization_id AND p.provider = s.provider AND p.connection_id = s.connection_id AND p.supplier_ref = s.external_supplier_id AND p.archived = 0
        LEFT JOIN ${reportSaleLinesSql} l ON l.organization_id = p.organization_id AND l.provider = p.provider AND l.connection_id = p.connection_id
          AND l.product_ref = p.external_product_id AND ${currentWindow.sql}${saleLocationSql}
        WHERE s.organization_id = ? AND s.archived = 0${approved("s")}${restricted ? " AND l.external_line_id IS NOT NULL" : ""}
        GROUP BY s.provider, s.connection_id, s.external_supplier_id
        ORDER BY periodNetSalesCents DESC, s.name COLLATE NOCASE LIMIT 1000
      `).bind(...currentWindow.bindings, ...saleLocationBindings, context.organizationId).all<Record<string, unknown>>() : Promise.resolve({ results: [] }),
      database.prepare(`
        SELECT json_array(l.provider, l.connection_id, coalesce(l.product_ref, l.sku, l.product_name, 'unclassified')) AS productRef,
               coalesce(max(l.product_name), max(l.sku), 'Unclassified item') AS name,
               sum(l.quantity_milli) AS quantityMilli, sum(l.net_sales_cents) AS netSalesCents,
               CASE WHEN count(l.external_line_id)>0 AND sum(CASE WHEN l.cost_cents IS NULL OR l.cost_cents=0 THEN 1 ELSE 0 END)=0 THEN sum(l.cost_cents) END AS costCents, sum(l.discount_cents) AS discountCents,
               count(DISTINCT l.provider || char(0) || l.connection_id || char(0) || l.external_sale_id) AS transactionCount
        FROM ${reportSaleLinesSql} l
        WHERE l.organization_id = ?${approved("l")}${saleLocationSql}${salePeriodSql}
        GROUP BY l.provider, l.connection_id, coalesce(l.product_ref, l.sku, l.product_name, 'unclassified')
        ORDER BY netSalesCents DESC LIMIT 250
      `).bind(context.organizationId, ...saleLocationBindings, ...currentWindow.bindings).all<Record<string, unknown>>(),
    ]);

    const normalizeMetric = (row: MetricRow | null) => {
      const netSalesCents = Number(row?.netSalesCents ?? 0);
      const costCents = row?.costCents == null ? null : Number(row.costCents);
      const discountsCents = Number(row?.discountsCents ?? 0);
      const transactions = Number(row?.transactions ?? 0);
      const units = Number(row?.quantityMilli ?? 0) / 1000;
      return {
        netSalesCents,
        costCents: canReadProductCosts ? costCents : null,
        grossProfitCents: canViewVerifiedProfit && costCents != null ? netSalesCents - costCents : null,
        grossMarginRate: canViewVerifiedProfit && costCents != null && netSalesCents > 0 ? (netSalesCents - costCents) / netSalesCents : null,
        discountsCents,
        discountRate: netSalesCents + discountsCents ? discountsCents / (netSalesCents + discountsCents) : null,
        transactions,
        units,
        averageTransactionCents: transactions ? Math.round(netSalesCents / transactions) : null,
        unitsPerTransaction: transactions ? units / transactions : null,
        knownCustomerTransactions: Number(row?.knownCustomerTransactions ?? 0),
      };
    };
    const current = normalizeMetric(currentRaw);
    const comparison = normalizeMetric(comparisonRaw);
    const inventory = (inventoryRows.results ?? []).map((row) => {
      const onHand = Number(row.onHandQuantity ?? 0);
      const reorderPoint = Number(row.reorderPoint ?? 0);
      const unitsSold = Number(row.periodQuantityMilli ?? 0) / 1000;
      const decision = inventoryDecision(onHand, reorderPoint, Math.max(0, unitsSold), period.days);
      const updated = Number(row.updatedAt), updatedMs = updated < 1e12 ? updated * 1000 : updated;
      const fresh = Number.isFinite(updatedMs) && Date.now() - updatedMs <= 36 * 3600_000 && updatedMs <= Date.now() + 300_000;
      const forward = fresh && period.to === businessClock(new Date(), context.organization.timezone)!.date && unitsSold > 0;
      return {
        provider: String(row.provider ?? "unknown"),
        connectionId: String(row.connectionId ?? ""),
        locationRef: String(row.locationRef ?? ""),
        externalProductId: row.externalProductId == null ? null : String(row.externalProductId),
        sku: String(row.sku ?? ""),
        name: String(row.name ?? row.sku ?? "Unclassified item"),
        categoryRef: row.categoryRef == null ? null : String(row.categoryRef),
        onHandQuantity: onHand,
        reorderPoint,
        updatedAt: row.updatedAt,
        periodNetSalesCents: Number(row.periodNetSalesCents ?? 0),
        periodDiscountCents: Number(row.periodDiscountCents ?? 0),
        supplierRef: canReadSuppliers ? row.supplierRef : null,
        defaultCostCents: canReadProductCosts ? row.defaultCostCents : null,
        ownerCostCents: canReadProductCosts ? row.ownerCostCents : null,
        effectiveCostCents: canReadProductCosts ? row.effectiveCostCents : null,
        costSource: canReadProductCosts
          ? row.ownerCostCents != null
            ? row.ownerCostSource
            : row.defaultCostCents != null
              ? "provider"
              : null
          : null,
        costUpdatedAt: canReadProductCosts ? row.ownerCostUpdatedAt : null,
        periodCostCents: canReadProductCosts ? row.periodCostCents : null,
        unitsSold,
        ...decision,
        stockStatus: fresh ? decision.stockStatus : "unknown",
        daysOfCover: forward ? decision.daysOfCover : null,
        recommendedOrderUnits: forward ? decision.recommendedOrderUnits : null,
      };
    });
    const safeLines = (lineRows.results ?? []).map((row) => {
      const net = Number(row.netSalesCents ?? 0);
      const cost = row.costCents == null ? null : Number(row.costCents);
      return {
        ...row,
        customerRef: canReadCustomerIdentity ? row.customerRef : null,
        customerName: canReadCustomerIdentity ? row.customerName : null,
        customerEmail: canReadCustomerIdentity ? row.customerEmail : null,
        customerPhone: canReadCustomerIdentity ? row.customerPhone : null,
        costCents: canReadProductCosts ? cost : null,
        grossProfitCents: canViewVerifiedProfit && cost != null ? net - cost : null,
        marginRate: canViewVerifiedProfit && cost != null && net > 0 ? (net - cost) / net : null,
      };
    });
    const customers = (customerRows.results ?? []).map((row) => {
      const transactions = Number(row.transactionCount ?? 0);
      const net = Number(row.netSalesCents ?? 0);
      const cost = row.costCents == null ? null : Number(row.costCents);
      return {
        ...row,
        externalCustomerId: canReadCustomerIdentity ? row.externalCustomerId : null,
        displayName: canReadCustomerIdentity ? row.displayName : "Known customer",
        email: canReadCustomerIdentity ? row.email : null,
        phone: canReadCustomerIdentity ? row.phone : null,
        costCents: canReadProductCosts ? cost : null,
        grossProfitCents: canViewVerifiedProfit && cost != null ? net - cost : null,
        averageTransactionCents: transactions ? Math.round(net / transactions) : null,
      };
    });
    const suppliers = (supplierRows.results ?? []).map((row) => {
      const net = Number(row.periodNetSalesCents ?? 0);
      const cost = row.periodCostCents == null ? null : Number(row.periodCostCents);
      return {
        ...row,
        periodCostCents: canReadProductCosts ? cost : null,
        periodGrossProfitCents: canViewVerifiedProfit && cost != null ? net - cost : null,
        periodMarginRate: canViewVerifiedProfit && cost != null && net > 0 ? (net - cost) / net : null,
        lowStockItems: inventory.filter((item) => item.provider === row.provider && item.connectionId === row.connectionId && item.supplierRef === row.externalSupplierId && item.stockStatus !== "healthy").length,
      };
    });
    const products = (productRows.results ?? []).map((row) => {
      const net = Number(row.netSalesCents ?? 0);
      const cost = row.costCents == null ? null : Number(row.costCents);
      const discounts = Number(row.discountCents ?? 0);
      return {
        productRef: String(row.productRef ?? "unclassified"),
        name: String(row.name ?? "Unclassified item"),
        quantityMilli: Number(row.quantityMilli ?? 0),
        netSalesCents: net,
        discountCents: discounts,
        transactionCount: Number(row.transactionCount ?? 0),
        costCents: canReadProductCosts ? cost : null,
        grossProfitCents: canViewVerifiedProfit && cost != null ? net - cost : null,
        marginRate: canViewVerifiedProfit && cost != null && net > 0 ? (net - cost) / net : null,
        discountRate: net + discounts ? discounts / (net + discounts) : null,
      };
    });
    const alerts = [
      ...inventory.filter((item) => item.stockStatus === "stockout").slice(0, 8).map((item) => ({ type: "stockout", severity: "urgent", title: `${item.name} is out of stock`, detail: item.dailyVelocity > 0 ? `${item.dailyVelocity.toFixed(1)} units/day sold in the selected period.` : "No current velocity is available.", action: item.recommendedOrderUnits == null ? "Refresh stock and review current-period velocity before planning an order." : `Review an order of ${item.recommendedOrderUnits} units.` })),
      ...inventory.filter((item) => item.stockStatus === "low" || item.stockStatus === "watch").slice(0, 8).map((item) => ({ type: "low_stock", severity: "warning", title: `${item.name} needs stock review`, detail: item.daysOfCover == null ? `${item.onHandQuantity} units on hand.` : `${item.daysOfCover.toFixed(1)} estimated days of cover.`, action: item.recommendedOrderUnits == null ? "Refresh stock and review current-period velocity before planning an order." : `Review an order of ${item.recommendedOrderUnits} units.` })),
      ...products.filter((item) => typeof item.marginRate === "number" && item.marginRate < 0.25 && Number(item.netSalesCents) > 0).slice(0, 6).map((item) => ({ type: "low_margin", severity: "warning", title: `${item.name} has a low gross margin`, detail: `${(Number(item.marginRate) * 100).toFixed(1)}% in the selected period.`, action: "Review cost, price and discounting." })),
      ...products.filter((item) => item.discountRate !== null && item.discountRate > 0.15 && item.netSalesCents > 0).slice(0, 6).map((item) => ({ type: "discount", severity: "review", title: `${item.name} is highly discounted`, detail: `${((item.discountRate ?? 0) * 100).toFixed(1)}% of pre-discount sales value.`, action: "Check promotion profitability." })),
      ...(current.transactions >= 10 && comparison.averageTransactionCents && current.averageTransactionCents && current.averageTransactionCents < comparison.averageTransactionCents * 0.9
        ? [{ type: "basket", severity: "review", title: "Average basket is below the prior matched period", detail: `${((commerceChangeRate(current.averageTransactionCents, comparison.averageTransactionCents) ?? 0) * 100).toFixed(1)}% versus the preceding ${period.days}-day period.`, action: "Review attach-rate opportunities among frequently co-purchased items." }]
        : []),
    ];
    const response = {
      source: "normalized-commerce",
      period: { from: period.from, to: period.to, days: period.days, comparisonFrom: period.comparisonFrom, comparisonTo: period.comparisonTo },
      kpis: {
        ...current,
        changes: {
          netSalesRate: commerceChangeRate(current.netSalesCents, comparison.netSalesCents),
          grossProfitRate: current.grossProfitCents == null || comparison.grossProfitCents == null ? null : commerceChangeRate(current.grossProfitCents, comparison.grossProfitCents),
          grossMarginPointChange: current.grossMarginRate == null || comparison.grossMarginRate == null ? null : current.grossMarginRate - comparison.grossMarginRate,
          transactionsRate: commerceChangeRate(current.transactions, comparison.transactions),
          averageTransactionRate: current.averageTransactionCents == null || comparison.averageTransactionCents == null ? null : commerceChangeRate(current.averageTransactionCents, comparison.averageTransactionCents),
        },
      },
      comparison,
      saleLines: permissions.includes("sales.transactions") ? safeLines : [],
      inventory,
      customers,
      suppliers,
      products,
      alerts,
      permissions: {
        customerIdentity: canReadCustomerIdentity,
        productCosts: canReadProductCosts,
        profit: canViewVerifiedProfit,
        suppliers: canReadSuppliers,
        inventory: canReadInventory,
        manageCosts: canManageCosts,
        importCosts: canImportCosts,
      },
      profitAvailability: !canViewVerifiedProfit ? "permission_required" : current.grossProfitCents != null ? "verified" : "Complete verified line costs are required. Unknown legacy zero costs are withheld.",
      locationScope: restricted ? { id: locationAccess.selectedLocation?.id ?? "accessible", name: locationAccess.selectedLocation?.name ?? "Accessible locations" } : null,
    };
    return jsonResponse(commerceResponseForMode(mode as CommerceViewMode, response));
  });
}
