import { ApiError } from "./api";

function alias(value: string) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error("Invalid commerce SQL alias.");
  return value;
}

/** A missing zero cannot certify a margin. Explicit zero and non-stock adjustments can. */
export function knownLineCostSql(value: string) {
  const line=alias(value);
  return `(${line}.cost_cents IS NOT NULL AND (${line}.cost_cents<>0 OR ${line}.cost_known=1 OR ${line}.quantity_milli=0))`;
}

export function completeLineCostSumSql(value: string) {
  const line=alias(value);
  return `CASE WHEN COUNT(${line}.external_line_id)>0 AND SUM(CASE WHEN ${knownLineCostSql(line)} THEN 0 ELSE 1 END)=0 THEN SUM(${line}.cost_cents) END`;
}

export type CommerceReportSourceScope = {
  provider:string; connectionId:string; localLocationId:string; externalOutletRef?:string|null;
  metricLocationRef?:string|null; accountName?:string|null; lastSuccessfulSyncAt?:string|null;
  availability?:"ready"|"needs_data"|"syncing"|"staging"|"unavailable";
};

/** Candidates already passed tenant and location access checks in source authority.
 * A provider-specific view does not borrow facts from the consolidated authority. */
export function providerSpecificCommerceScopes(connectionId:string,
  sales:readonly CommerceReportSourceScope[],inventory:readonly CommerceReportSourceScope[]) {
  const eligible=(scope:CommerceReportSourceScope)=>scope.connectionId===connectionId
    && (scope.availability==="ready"||scope.availability==="needs_data");
  const salesScopes=sales.filter(eligible),inventoryScopes=inventory.filter(eligible);
  if(!salesScopes.length&&!inventoryScopes.length) throw new ApiError(403,"COMMERCE_SOURCE_UNAVAILABLE",
    "The selected source is not approved and mapped to an accessible location, or it is still syncing. Refresh the connection and try again.");
  const providers=new Set([...salesScopes,...inventoryScopes].map(scope=>scope.provider));
  if(providers.size!==1) throw new ApiError(409,"COMMERCE_SOURCE_INVALID","The selected source identity needs review.");
  return {sales:salesScopes,inventory:inventoryScopes,provider:[...providers][0],
    locationIds:[...new Set([...salesScopes,...inventoryScopes].map(scope=>scope.localLocationId))],
    accountName:[...salesScopes,...inventoryScopes].find(scope=>scope.accountName)?.accountName??null};
}
