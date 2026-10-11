import { businessTimestampRange } from "../domain/business-period";
import type { CanonicalCommerceCoverage } from "../domain/provider-feature-coverage";

type Scope = {
  organizationId:string; connectionId:string; metricRefs:string[]; outletRefs:string[]; locationIds:string[];
  catalogDimensionsAllowed:boolean; start:string|null; end:string|null; timeZone:string;
};

/** Presence is not completeness. The caller has already authorized the connection
 * and locations; every query repeats both boundaries. JSON lists keep the D1
 * parameter count bounded even when the workspace has many mapped locations. */
export function providerCoverageQueries(input:Scope) {
  const base=[input.organizationId,input.connectionId], metrics=JSON.stringify([...new Set(input.metricRefs)]), outlets=JSON.stringify([...new Set(input.outletRefs)]), locations=JSON.stringify([...new Set(input.locationIds)]);
  const window=businessTimestampRange("paid_at",input.start,input.end,input.timeZone);
  const dates=`${input.start?" AND business_date>=?":""}${input.end?" AND business_date<=?":""}`;
  const catalog=(table:"commerce_products"|"commerce_customers"|"commerce_suppliers")=>input.catalogDimensionsAllowed
    ? {sql:`SELECT 1 present FROM ${table} WHERE organization_id=? AND connection_id=? AND archived=0 LIMIT 1`,bindings:base}
    : {sql:"SELECT 1 present WHERE 0",bindings:[]};
  return [
    {sql:`SELECT 1 present FROM daily_business_metrics WHERE organization_id=? AND source_connection_id=? AND location_ref IN (SELECT value FROM json_each(?))${dates} LIMIT 1`,bindings:[...base,metrics,...[input.start,input.end].filter((date):date is string=>Boolean(date))]},
    {sql:`SELECT 1 present FROM commerce_payments WHERE organization_id=? AND connection_id=? AND outlet_ref IN (SELECT value FROM json_each(?)) AND paid_at IS NOT NULL AND amount_cents>0 AND ${window.sql} LIMIT 1`,bindings:[...base,outlets,...window.bindings]},
    catalog("commerce_products"),
    {sql:"SELECT 1 present FROM inventory_balances WHERE organization_id=? AND source_connection_id=? AND location_ref IN (SELECT value FROM json_each(?)) LIMIT 1",bindings:[...base,metrics]},
    catalog("commerce_customers"),catalog("commerce_suppliers"),
    {sql:"SELECT 1 present FROM integration_location_mappings WHERE organization_id=? AND connection_id=? AND status='mapped' AND local_location_id IN (SELECT value FROM json_each(?)) LIMIT 1",bindings:[...base,locations]},
  ];
}

export async function loadProviderCoverage(database:D1Database,input:Scope):Promise<CanonicalCommerceCoverage> {
  const result=await database.batch(providerCoverageQueries(input).map(q=>database.prepare(q.sql).bind(...q.bindings)));
  const [sales,payments,products,inventory,customers,suppliers,locations]=result.map(row=>Boolean(row.results?.length));
  return {sales,payments,products,inventory,customers,suppliers,locations};
}
