import { getD1 } from "../db";
import { ApiError } from "./api";
import type { AccessContext } from "./authorization";
import { effectivePermissions } from "./permissions";
import { getTenantEntitlements } from "./entitlements/engine";
import { authorizedLocationDataScope } from "./location-access";
import { buildRetailIntelligence, retailKey, type RetailLine, type RetailLot, type RetailMeasurement, type RetailStock } from "../domain/retail-intelligence";
import { businessTimestampRange } from "../domain/business-period";
import { businessClock } from "../domain/intraday-sales";
import { parseCommercePeriod } from "../domain/commerce-intelligence";
import type { RetailAccess, RetailReport } from "../domain/retail-intelligence";
import { scopeExternalRef } from "../domain/integration-source";
import { commerceSourceAuthority } from "./integrations/source-authority";
import { reportSaleLinesSql } from "./integrations/report-sale-lines";

export function retailPeriod(from: string | null, to: string | null, timeZone: string) {
  const today = businessClock(new Date(), timeZone)!.date;
  try {
    const period = parseCommercePeriod(from, to, today);
    if (period.days > 366 || period.to > today) throw new Error("Choose a past or current reporting period of 366 days or less.");
    return period;
  } catch (error) { throw new ApiError(400, "RETAIL_PERIOD_INVALID", error instanceof Error ? error.message : "Choose a valid period."); }
}
export async function retailAccess(context: AccessContext): Promise<RetailAccess> {
  const [permissions, entitlement] = await Promise.all([effectivePermissions(context), getTenantEntitlements(context)]);
  const has = (permission: string) => permissions.some(value => value === permission);
  return { inventory: has("inventory.view") && entitlement.features.includes("inventory.lots"), customers: (has("customers.totals") || has("customers.identity")) && entitlement.features.includes("ai.tools.customers"),
    labour: has("payroll.totals"), profit: has("metrics.profit"), costs: has("finance.costs") || has("inventory.value"),
    expiry: has("inventory.view") && entitlement.features.includes("inventory.expiry"), edit: ["owner", "admin", "manager"].includes(context.role) && has("data.import") };
}
export const approvedRetailSource = (alias: string, connectionColumn = "connection_id", providerColumn = "provider") => `EXISTS (
  SELECT 1 FROM integration_connections approved WHERE approved.organization_id = ${alias}.organization_id
    AND approved.id = ${alias}.${connectionColumn} AND approved.provider = ${alias}.${providerColumn}
    AND approved.status = 'connected' AND approved.data_promotion_status = 'approved'
    AND (approved.provider <> 'moneris' OR approved.source_namespace LIKE 'production:%')
    AND (approved.sync_lease_owner IS NULL OR approved.sync_lease_expires_at IS NULL OR approved.sync_lease_expires_at <= CAST(strftime('%s','now') AS INTEGER)))`;

export async function retailOutlets(context: AccessContext, locationId: string | null) {
  const scope = await authorizedLocationDataScope(context, locationId);
  const mappings = await getD1().prepare(`SELECT m.provider, m.connection_id AS connectionId, m.external_location_ref AS externalRef,
    c.source_namespace AS sourceNamespace, l.name AS locationName, l.id AS locationId
    FROM integration_location_mappings m JOIN integration_connections c ON c.id = m.connection_id AND c.organization_id = m.organization_id
    JOIN organization_locations l ON l.id = m.local_location_id AND l.organization_id = m.organization_id AND l.status = 'active'
    WHERE m.organization_id = ? AND m.status = 'mapped' AND ${approvedRetailSource("m")}
    ORDER BY l.name, m.provider, m.connection_id, m.external_location_ref LIMIT 501`).bind(context.organizationId).all<{ provider: string; connectionId: string; externalRef: string; sourceNamespace: string | null; locationName: string; locationId: string }>();
  if ((mappings.results ?? []).length > 500) throw new ApiError(413, "RETAIL_OUTLET_LIMIT", "Narrow the workspace location scope.");
  return (mappings.results ?? []).filter(row => scope.locationIds === null || scope.locationIds.includes(row.locationId))
    .map(row => ({ provider: row.provider, connectionId: row.connectionId, outletRef: scopeExternalRef(row.sourceNamespace ?? "legacy", row.externalRef)!, locationId: row.locationId, label: row.locationName + " · " + row.provider }));
}
export async function readRetailMeasurements(context: AccessContext, locationId: string | null, access: RetailAccess) {
  const scope = await authorizedLocationDataScope(context, locationId);
  const result = await getD1().prepare(`SELECT id, kind, provider, connection_id AS connectionId, outlet_ref AS outletRef,
    period_from AS "from", period_to AS "to", source_label AS source, values_json AS valuesJson, version, updated_at AS updatedAt
    FROM retail_measurements m WHERE m.organization_id = ? AND ${approvedRetailSource("m")}
    ORDER BY updated_at DESC LIMIT 2001`).bind(context.organizationId).all<{ id: string; kind: RetailMeasurement["kind"]; provider: string; connectionId: string; outletRef: string; from: string; to: string; source: string; valuesJson: string; version: number; updatedAt: number }>();
  if ((result.results ?? []).length > 2000) throw new ApiError(413, "RETAIL_INPUT_LIMIT", "Archive older retail evidence before adding more.");
  return (result.results ?? []).filter(row => (row.kind === "catalog" || row.kind === "stock" && access.inventory || row.kind === "loyalty" && access.customers || row.kind === "labour" && access.labour)
    && (row.outletRef === "" || scope.providerLocations === null || scope.providerLocations?.some(p => p.provider === row.provider && p.connectionId === row.connectionId && p.externalLocationRef === row.outletRef)))
    .map(row => ({ ...row, entries: JSON.parse(row.valuesJson) as Array<{ reference: string; values: RetailMeasurement["values"] }> }));
}
export async function readRetailReport(context: AccessContext, locationId: string | null, from: string | null, to: string | null) {
  const period = retailPeriod(from, to, context.organization.timezone), access = await retailAccess(context), scope = await authorizedLocationDataScope(context, locationId);
  const localIds = scope.locationIds ?? scope.locations.map(location => location.id);
  const salesAuthority = await commerceSourceAuthority({ organizationId: context.organizationId, localLocationIds: localIds, factFamily: "sales", salesLineFacts: true });
  if (salesAuthority.status === "conflict") throw new ApiError(409, "RETAIL_SOURCE_OVERLAP", "Sales sources overlap or are still syncing. Open Reports to review the authoritative source for this location before combining records.");
  const locations = salesAuthority.selections.flatMap(selection => selection.externalOutletRef ? [{ provider: selection.provider, connectionId: selection.connectionId, externalLocationRef: selection.externalOutletRef }] : []);
  if (locations.length > 30) throw new ApiError(413, "RETAIL_SCOPE_LIMIT", "Select a location with 30 or fewer source outlets for detailed receipt analysis.");
  const locationSql = locations === null ? "" : locations.length ? ` AND (${locations.map(() => "(l.provider = ? AND l.connection_id = ? AND l.outlet_ref = ?)").join(" OR ")})` : " AND 0=1";
  const bindings = locations?.flatMap(p => [p.provider, p.connectionId, p.externalLocationRef]) ?? [];
  const window = businessTimestampRange("l.sold_at", period.comparisonFrom, period.to, context.organization.timezone), db = getD1();
  const [lines, stocks, lots, measured] = await Promise.all([
    db.prepare(`SELECT l.provider, l.connection_id AS connectionId, l.external_sale_id AS saleId, l.external_line_id AS lineId,
      l.product_ref AS productRef,
      coalesce(l.sku, CASE WHEN p.name NOT LIKE 'R-Series item %' THEN p.sku END) AS sku,
      coalesce(CASE WHEN p.name NOT LIKE 'R-Series item %' THEN p.name END, l.product_name, p.name, l.sku, 'Unclassified item') AS name,
      CASE WHEN l.provider IN ('lightspeed-r','lightspeed') THEN p.category_name ELSE p.category_ref END AS category, NULL AS itemType, l.customer_ref AS customerRef, l.outlet_ref AS outletRef, l.sold_at AS soldAt,
      l.quantity_milli AS quantityMilli, l.net_sales_cents AS netCents, l.discount_cents AS discountCents,
      CASE WHEN l.cost_cents <> 0 OR (l.provider='lightspeed' AND (l.cost_known=1 OR COALESCE(p.owner_cost_cents,p.default_cost_cents) IS NOT NULL)) THEN l.cost_cents ELSE NULL END AS costCents,
      CASE WHEN l.provider='lightspeed-r' AND NOT EXISTS (
        SELECT 1 FROM integration_sync_runs normalization WHERE normalization.id=l.sync_run_id
          AND normalization.organization_id=l.organization_id AND normalization.connection_id=l.connection_id
          AND CASE WHEN json_valid(normalization.cursor_after) THEN json_extract(normalization.cursor_after,'$.version') ELSE 0 END>=5
      ) THEN 1 ELSE 0 END AS historicalRepairPending
      FROM ${reportSaleLinesSql} l LEFT JOIN commerce_products p ON p.organization_id = l.organization_id AND p.provider = l.provider AND p.connection_id = l.connection_id AND p.external_product_id = l.product_ref
      WHERE l.organization_id = ? AND ${approvedRetailSource("l")}${locationSql} AND ${window.sql}
      ORDER BY l.sold_at, l.provider, l.connection_id, l.external_sale_id, l.external_line_id LIMIT 50001`)
      .bind(context.organizationId, ...bindings, ...window.bindings).all<RetailLine & { historicalRepairPending: number }>(),
    access.inventory ? db.prepare(`SELECT source_provider AS provider, source_connection_id AS connectionId, location_ref AS locationRef,
      sku, name, on_hand_quantity AS onHand, reorder_point AS reorderPoint, updated_at AS updatedAt
      FROM inventory_balances b WHERE organization_id = ? AND ${approvedRetailSource("b", "source_connection_id", "source_provider")} ORDER BY name LIMIT 5001`)
      .bind(context.organizationId).all<RetailStock & { locationRef: string }>() : { results: [] },
    access.expiry ? db.prepare(`SELECT product_name AS name, sku, location_ref AS locationRef, expiration_date AS expirationDate,
      quantity_remaining AS quantity, unit_cost_cents AS costCents FROM inventory_lots
      WHERE organization_id = ? AND quantity_remaining > 0 AND expiration_date IS NOT NULL AND source_system <> 'pos'
      ORDER BY expiration_date LIMIT 5001`).bind(context.organizationId).all<RetailLot>() : { results: [] },
    readRetailMeasurements(context, locationId, access),
  ]);
  if ((lines.results ?? []).length > 50000 || (stocks.results ?? []).length > 5000 || (lots.results ?? []).length > 5000) throw new ApiError(413, "RETAIL_EVIDENCE_LIMIT", "This selection exceeds the complete-record analysis limit. Narrow the dates or location; Vanteloq will not calculate from a partial sample.");
  const inventoryAuthority = access.inventory ? await commerceSourceAuthority({ organizationId: context.organizationId, localLocationIds: localIds, factFamily: "inventory" }) : null;
  const scopedStocks = (stocks.results ?? []).map(row => ({ ...row, key: retailKey(row.provider, row.connectionId, row.locationRef, row.sku), outletRef: row.locationRef.slice(row.provider.length + 1), updatedAt: row.updatedAt < 1e12 ? row.updatedAt * 1000 : row.updatedAt }))
    .filter(row => inventoryAuthority?.status !== "conflict" && inventoryAuthority?.selections.some(p => p.provider === row.provider && p.connectionId === row.connectionId && p.externalOutletRef === row.outletRef));
  const scopedLots = (lots.results ?? []).filter(row => scope.locationRefs === null || scope.locationRefs.includes(row.locationRef)).map(row => ({ ...row, costCents: access.costs ? row.costCents : null }));
  const measurements = measured.flatMap(m => m.entries.map(entry => ({ kind: m.kind, provider: m.provider, connectionId: m.connectionId, outletRef: m.outletRef, from: m.from, to: m.to, source: m.source, ...entry })));
  if (access.labour) {
    const outlets = await retailOutlets(context, locationId), measuredLocations = new Set<string>();
    for (const measurement of measurements.filter(m => m.kind === "labour" && m.from === period.from && m.to === period.to)) {
      const outlet = outlets.find(o => o.provider === measurement.provider && o.connectionId === measurement.connectionId && o.outletRef === measurement.outletRef);
      if (!outlet) { measurement.values.complete = false; continue; }
      if (measuredLocations.has(outlet.locationId)) throw new ApiError(409, "RETAIL_LABOUR_OVERLAP", "Two paid-hours datasets cover the same physical location and period. Remove the duplicate before analyzing labour efficiency.");
      measuredLocations.add(outlet.locationId);
      measurement.values.outletKeys = JSON.stringify(outlets.filter(o => o.locationId === outlet.locationId).map(o => retailKey(o.provider, o.connectionId, o.outletRef)));
    }
  }
  const report = buildRetailIntelligence({
    lines: (lines.results ?? []).map(row => ({ ...row, costCents: access.profit || access.costs ? row.costCents : null, customerRef: access.customers ? row.customerRef : null })),
    stock: scopedStocks, lots: scopedLots, measurements: measurements.map(row => row.kind === "stock" && !access.costs ? { ...row, values: { ...row.values, openingValueCents: null, closingValueCents: null } } : row),
    period, timeZone: context.organization.timezone, asOfDate: businessClock(new Date(), context.organization.timezone)!.date,
  });
  const redactTotals = <T extends { grossProfitCents: number | null }>(totals: T): T => ({ ...totals, grossProfitCents: access.profit ? totals.grossProfitCents : null });
  const dataQualityWarnings = inventoryAuthority?.status === "conflict" ? ["Inventory sources overlap or are syncing. Resolve the inventory authority in Reports; stock calculations are withheld."] : [];
  const pendingRepair = (lines.results ?? []).filter(row => row.historicalRepairPending).length;
  if (pendingRepair) dataQualityWarnings.push(`Historical discount correction is still importing for ${pendingRepair} line records. Revenue, discount and profit figures for this selection are provisional. Finish the R-Series history sync before using them for decisions.`);
  if (report.products.some(product => /^R-Series item /.test(product.name))) dataQualityWarnings.push("Some product identities are awaiting the full POS catalogue. Review catalogue coverage before using product names, SKUs or category comparisons.");
  const safe: RetailReport = { ...report, dataQualityWarnings, current: redactTotals(report.current), prior: redactTotals(report.prior),
    products: report.products.map(row => ({ ...row, grossProfitCents: access.profit ? row.grossProfitCents : null, marginRate: access.profit ? row.marginRate : null })),
    customers: access.customers ? report.customers : null, operations: access.labour ? report.operations : null };
  return { report: safe, access, source: { sourceCount: new Set((lines.results ?? []).map(row => retailKey(row.provider, row.connectionId))).size, lineCount: (lines.results ?? []).length, approvedConnectionsOnly: true, scope: scope.selectedLocation?.name ?? (scope.locationIds === null ? "All locations" : "Permitted locations") } };
}
