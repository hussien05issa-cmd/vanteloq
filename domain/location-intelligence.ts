import { isCalendarDate } from "./calendar-date";
import { exactSum } from "./executive-metrics";

export type LocationMetricRow = {
  businessDate: string; locationRef: string; sourceConnectionId: string | null;
  netSalesCents: number; costOfGoodsCents: number; transactionCount: number;
  inventoryValueCents: number | null; updatedAt: Date;
};
export type LocationMetricScope = { connectionId: string; metricLocationRef: string | null };
export function locationReportingPeriod(to: string | null) {
  if (!isCalendarDate(to)) return null;
  const start = new Date(`${to}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 29);
  return { from: start.toISOString().slice(0, 10), to, days: 30 };
}

/** A populated date is observed evidence, not proof of a complete provider import.
 * Require every authoritative outlet on every date before showing period totals.
 * Daily facts use workspace currency and business dates; no FX conversion is inferred. */
export function locationPeriodMetrics(input: {
  locationId: string; locationCurrency: string; currency: string; timeZone: string; today: string;
  period: ReturnType<typeof locationReportingPeriod>; rows: readonly LocationMetricRow[];
  scopes: readonly LocationMetricScope[]; authority: "ready" | "conflict" | "needs_data";
  queryComplete: boolean; permissions: readonly string[];
}) {
  const { period } = input;
  const scopes = [...new Map(input.scopes.filter(scope => scope.metricLocationRef).map(scope => [JSON.stringify([scope.connectionId, scope.metricLocationRef]), scope])).values()];
  const scopeKey = (row: LocationMetricRow) => JSON.stringify([row.sourceConnectionId, row.locationRef]);
  const keys = new Set(scopes.length ? scopes.map(scope => JSON.stringify([scope.connectionId, scope.metricLocationRef])) : [JSON.stringify([null, input.locationId])]);
  const rows = input.rows.filter(row => period && isCalendarDate(row.businessDate) && row.businessDate >= period.from && row.businessDate <= period.to && keys.has(scopeKey(row)));
  const observations = new Set(rows.map(row => JSON.stringify([scopeKey(row), row.businessDate])));
  const observedDays = new Set(rows.map(row => row.businessDate)).size;
  const expected = period ? period.days * keys.size : 0;
  const complete = input.queryComplete && input.authority === "ready" && expected > 0 && observations.size === expected && observations.size === rows.length;
  const currencyMatches = /^[A-Z]{3}$/.test(input.currency) && input.locationCurrency === input.currency;
  const stale = Boolean(period && (Date.parse(`${input.today}T00:00:00Z`) - Date.parse(`${period.to}T00:00:00Z`)) > 7 * 86400000);
  const limitations: string[] = [];
  if (input.authority === "conflict") limitations.push("Sales sources overlap or are syncing. Review the authoritative source in Reports.");
  if (input.authority === "needs_data") limitations.push("An authoritative source is unavailable or has no approved records. Refresh it before comparing this location.");
  if (!input.queryComplete) limitations.push("The complete-record limit was reached. No partial totals are shown.");
  if (!period) limitations.push("No dated authoritative sales records are available.");
  else if (!complete && input.authority === "ready" && input.queryComplete) limitations.push(`Observed ${observations.size} of ${expected} required date and source records. Missing dates are unknown, not closed days or zero sales.`);
  if (!currencyMatches) limitations.push("Daily facts use the workspace currency. This location uses a different or unknown currency, so monetary totals are withheld.");
  if (stale) limitations.push("The latest recorded business date is more than seven days old. These historical totals do not establish current performance.");
  let netSalesCents: number | null = null, transactionCount: number | null = null, grossProfitCents: number | null = null, inventoryValueCents: number | null = null;
  let exact = true;
  if (complete) {
    try {
      if (input.permissions.includes("metrics.revenue")) {
        if (currencyMatches) netSalesCents = exactSum(rows.map(row => row.netSalesCents));
        transactionCount = exactSum(rows.map(row => row.transactionCount));
      }
      // A daily provider aggregate does not carry attributable-cost completeness
      // or an inventory valuation scope. Do not promote its placeholder amounts.
      if (currencyMatches && !scopes.length) {
        if (input.permissions.includes("metrics.profit")) grossProfitCents = exactSum([exactSum(rows.map(row => row.netSalesCents)), -exactSum(rows.map(row => row.costOfGoodsCents))]);
        const closing = rows.find(row => row.businessDate === period!.to)?.inventoryValueCents;
        if (input.permissions.includes("inventory.value") && closing != null && Number.isSafeInteger(closing)) inventoryValueCents = closing;
      }
    } catch { exact = false; netSalesCents = transactionCount = grossProfitCents = inventoryValueCents = null; limitations.push("Amounts exceed exact integer arithmetic. Review the source records before using these totals."); }
  }
  if (scopes.length && input.permissions.includes("metrics.profit")) limitations.push("Gross profit requires attributable cost-completeness evidence beyond the daily provider totals.");
  if (scopes.length && input.permissions.includes("inventory.value")) limitations.push("Inventory value requires a separately verified stock valuation; sales-source daily totals are insufficient.");
  const canReadActivity = input.permissions.includes("metrics.revenue") || input.permissions.includes("metrics.profit") || input.permissions.includes("inventory.value");
  const timestamps = rows.map(row => row.updatedAt.getTime()).filter(Number.isFinite);
  return {
    period: canReadActivity && period ? `30 days through ${period.to}` : null,
    from: canReadActivity ? period?.from ?? null : null, to: canReadActivity ? period?.to ?? null : null, currency: input.currency, locationCurrency: input.locationCurrency, timeZone: input.timeZone,
    days: canReadActivity ? observedDays : 0,
    netSalesCents, grossProfitCents, transactionCount, inventoryValueCents,
    lastUpdatedAt: canReadActivity && timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null,
    status: !canReadActivity ? "permission_required" : input.authority === "conflict" ? "source_conflict" : !complete || !exact ? "needs_data" : !currencyMatches ? "currency_mismatch" : stale ? "stale" : "recorded",
    coverage: { complete: canReadActivity && complete && exact, observedRecords: canReadActivity ? observations.size : null, expectedRecords: canReadActivity ? expected : null, expectedDays: canReadActivity ? period?.days ?? 0 : 0, sourceScopes: canReadActivity ? keys.size : 0, queryComplete: input.queryComplete },
    profitAvailability: !input.permissions.includes("metrics.profit") ? "permission_required" : grossProfitCents !== null ? "owner_reviewed" : "needs_cost_evidence",
    comparisonEligible: canReadActivity && complete && exact && currencyMatches && !stale,
    limitations: canReadActivity ? [...limitations, "Recorded daily summaries are not an audit or proof that every provider transaction was imported. Store opening and comparable-period calendars have not been verified."] : ["Your role cannot access this location's financial or activity metrics."],
  };
}
