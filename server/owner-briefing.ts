import { buildOwnerBriefing, type OwnerBriefingSignal } from "../domain/owner-briefing.ts";
import { normalizedSourceTimestamp, type MetricResult } from "./data-trust.ts";
import type { MetricRow } from "./intelligence.ts";
import type { OperatingDecision } from "./operating-system.ts";

export type ServerOwnerBriefingInput = {
  now: Date;
  timezone: string;
  hours: unknown;
  scopeLabel: string;
  selectedLocation: boolean;
  currency: string;
  permissions: readonly string[];
  features: readonly string[];
  sourceConflict: boolean;
  bankSourceIncomplete: boolean;
  /** Each authorized reporting scope must have at least one accepted reference. */
  expectedReportingScopes: readonly (readonly string[])[];
  /** Already authorized tenant/location rows, used only to verify balance provenance. */
  dailyRows: readonly MetricRow[];
  commandCentre: {
    ready: boolean;
    source: { freshness: string; syncing?: boolean; latestBusinessDate: string | null; rowCount: number };
    metrics: Record<string, MetricResult>;
    dataQuality: { status: string };
  };
  operatingSystem: { decisions: readonly OperatingDecision[] };
};

const maximumBalanceAgeMs = 48 * 60 * 60 * 1000;

function currentTimestamp(value: string | null, now: Date) {
  if (!value) return false;
  const age = now.getTime() - Date.parse(value);
  return Number.isFinite(age) && age >= 0 && age <= maximumBalanceAgeMs;
}

function verifiedMetric(metric: MetricResult | undefined, now: Date): metric is MetricResult & { value: number } {
  return Boolean(metric && typeof metric.value === "number" && Number.isFinite(metric.value)
    && metric.actuality === "actual" && metric.freshnessStatus === "current"
    && metric.confidenceLevel !== "unavailable" && metric.sourceRecords > 0
    && metric.sourceSystem.trim() && currentTimestamp(metric.sourceTimestamp, now));
}

/** Daily metric metadata describes a reporting window, not necessarily its carried-forward balance. */
function verifiedBalance(input: ServerOwnerBriefingInput, key: "operating_cash" | "accounts_payable", field: "cashBalanceCents" | "accountsPayableCents") {
  const metric = input.commandCentre.metrics[key];
  if (!verifiedMetric(metric, input.now) || metric.unit !== "minor_currency" || metric.currency !== input.currency
    || !Number.isSafeInteger(metric.value)) return null;
  if (key === "operating_cash" && metric.calculationVersion === "plaid-cash.v1") {
    return !input.bankSourceIncomplete && metric.confidenceLevel === "high" ? metric : null;
  }
  const date = input.commandCentre.source.latestBusinessDate;
  if (!date || metric.periodEnd !== date) return null;
  const latest = input.dailyRows.filter(row => row.businessDate === date);
  const expectedLocations = new Set(input.dailyRows.map(row => row.locationRef || "all"));
  const reportedLocations = new Set(latest.map(row => row.locationRef || "all"));
  if (!latest.length || [...expectedLocations].some(location => !reportedLocations.has(location))) return null;
  let total = 0;
  const timestamps: string[] = [];
  for (const row of latest) {
    const value = row[field];
    const asOf = row.updatedAt == null ? null : normalizedSourceTimestamp(row.updatedAt);
    if (typeof value !== "number" || !Number.isSafeInteger(value) || !currentTimestamp(asOf, input.now)) return null;
    total += value;
    timestamps.push(asOf!);
  }
  if (!Number.isSafeInteger(total) || total !== metric.value) return null;
  return { ...metric, sourceTimestamp: timestamps.sort()[0] };
}

function metricEvidence(metric: MetricResult & { value: number }) {
  const value = metric.unit === "minor_currency" && metric.currency
    ? new Intl.NumberFormat("en-CA", { style: "currency", currency: metric.currency }).format(metric.value / 100)
    : metric.unit === "ratio" ? new Intl.NumberFormat("en-CA", { style: "percent", maximumFractionDigits: 1 }).format(metric.value)
      : metric.value;
  return {
    label: metric.metricName,
    value,
    source: `${metric.sourceSystem}${metric.periodStart && metric.periodEnd ? `; ${metric.periodStart} to ${metric.periodEnd}` : ""}`,
    asOf: metric.sourceTimestamp,
  };
}

/** Receives permission-filtered facts. It neither loads additional records nor performs actions. */
export function buildServerOwnerBriefing(input: ServerOwnerBriefingInput) {
  const { commandCentre, permissions, features } = input;
  const hasPermission = (value: string) => permissions.includes(value);
  const hasFeature = (value: string) => features.includes(value);
  const paidBriefing = hasFeature("business.brief.basic") && hasPermission("insights.view");
  const canViewCash = hasFeature("bookloq") && hasPermission("metrics.cash") && hasPermission("finance.bank_balances");
  const canViewPayables = canViewCash && hasPermission("finance.ap_ar");
  const sourceDestination = hasFeature("pos.reporting.core") && hasPermission("integrations.view") ? "Integrations"
    : hasFeature("analytics.sales.basic") && hasPermission("sales.view") ? "Sales"
      : hasFeature("reporting.basic") && hasPermission("reports.operational") ? "Reports" : null;
  const signals: OwnerBriefingSignal[] = [];
  const latestRefs = new Set(input.dailyRows.filter(row => row.businessDate === commandCentre.source.latestBusinessDate).map(row => row.locationRef || "all"));
  const completeScope = input.expectedReportingScopes.length > 0
    && input.expectedReportingScopes.every(refs => refs.some(ref => latestRefs.has(ref)));
  const sourceBlocked = input.sourceConflict || commandCentre.source.syncing || !commandCentre.ready
    || commandCentre.source.freshness !== "current" || !completeScope;
  const sourceState = input.sourceConflict ? "conflict" : commandCentre.source.syncing ? "syncing"
    : !commandCentre.ready ? "missing" : !completeScope ? "incomplete location coverage" : commandCentre.source.freshness;
  const cash = !sourceBlocked && canViewCash ? verifiedBalance(input, "operating_cash", "cashBalanceCents") : null;
  const payables = !sourceBlocked && canViewPayables ? verifiedBalance(input, "accounts_payable", "accountsPayableCents") : null;
  const pulseMetric = (label: string, key: "net_sales" | "gross_profit" | "operating_cash", allowed: boolean) => {
    const unavailable = (detail: string) => ({ label, value: "—", detail });
    if (!allowed) return unavailable("Not available for the current workspace access.");
    if (sourceBlocked) return unavailable(`Review source coverage (${sourceState}). Totals are withheld.`);
    const metric = key === "operating_cash" ? cash ?? undefined : commandCentre.metrics[key];
    if (!verifiedMetric(metric, input.now) || metric.unit !== "minor_currency" || metric.currency !== input.currency
      || !Number.isSafeInteger(metric.value) || !metric.periodStart || !metric.periodEnd) {
      return unavailable("Verify a current, complete source record before using this amount.");
    }
    const period = key === "operating_cash" ? `Snapshot: ${metric.periodEnd}` : `Recorded period: ${metric.periodStart} to ${metric.periodEnd}`;
    const coverage = key !== "operating_cash" && commandCentre.dataQuality.status !== "usable"
      ? " Recorded rows only; period coverage may be incomplete." : "";
    return { label, value: String(metricEvidence(metric).value), detail: `${period} · ${metric.sourceSystem} · Updated ${metric.sourceTimestamp}.${coverage}` };
  };
  const pulseMetrics = [
    pulseMetric("Net sales", "net_sales", hasFeature("analytics.sales.basic") && hasPermission("metrics.revenue")),
    pulseMetric("Gross profit", "gross_profit", hasFeature("products.margin") && hasPermission("metrics.revenue") && hasPermission("metrics.profit")),
    pulseMetric("Cash balance", "operating_cash", canViewCash),
  ];
  if (sourceBlocked && sourceDestination) {
    signals.push({
      id: "owner:source-review", category: "data", severity: sourceState === "conflict" ? "high" : "medium",
      title: sourceState === "conflict" ? "Resolve the reporting source conflict" : sourceState === "syncing" ? "Source records are being refreshed"
        : sourceState === "missing" ? "Add verified operating records" : "Refresh the operating evidence",
      detail: "Financial urgency is not assessed from incomplete, conflicting or out-of-date operating evidence.",
      nextStep: sourceState === "syncing" ? "Wait for the refresh to finish, then review the latest records."
        : sourceState === "conflict" ? "Review the reporting source for overlapping locations before using totals."
          : "Review source coverage and the latest recorded date before making operating decisions.",
      destination: sourceDestination,
      evidence: [{ label: "Source status", value: sourceState, source: "Authorized command-centre source checks" }],
    });
  }
  if (!sourceBlocked && paidBriefing) {
    if (cash && cash.value < 0) {
      signals.push({
        id: "owner:negative-cash", category: "cash", severity: commandCentre.dataQuality.status === "usable" ? "critical" : "high", title: "The verified cash balance is negative",
        detail: "The latest verified cash snapshot is below zero. This balance does not establish insolvency or identify which bills are due today.",
        nextStep: "Review available bank funds, pending transactions and dated commitments before authorizing payments.",
        destination: "BookLoQ", evidence: [metricEvidence(cash)],
      });
    }
    if (cash && payables && payables.value > cash.value) {
      signals.push({
        id: "owner:payables-review", category: "payables", severity: "high", title: "Review cash against recorded payables",
        detail: "Recorded payables exceed the verified cash balance. Due dates, expected receipts and other obligations are not established by these snapshots.",
        nextStep: "Review invoice due dates and expected receipts before sequencing payments or new purchases.",
        destination: "BookLoQ", evidence: [metricEvidence(cash), metricEvidence(payables)],
      });
    }
    if (canViewCash && (!cash || (canViewPayables && !payables))) {
      signals.push({
        id: "owner:finance-evidence", category: "data", severity: "medium", title: "Verify the financial snapshot",
        detail: "A current, complete cash or payable snapshot is unavailable. Missing amounts are not treated as zero or as a cash emergency.",
        nextStep: "Review bank balances and recorded commitments in BookLoQ before assessing payment capacity.",
        destination: "BookLoQ", evidence: [{ label: "Snapshot coverage", value: "Verification required", source: "Authorized cash and payable evidence checks" }],
      });
    }
    if (commandCentre.dataQuality.status !== "usable" && sourceDestination) {
      signals.push({
        id: "owner:history-review", category: "data", severity: "medium", title: "Complete the comparison evidence",
        detail: "The available records do not establish a complete comparison period. Trend-based urgency is withheld.",
        nextStep: "Review missing dates and location coverage before comparing business performance.",
        destination: sourceDestination,
        evidence: [{ label: "Comparison coverage", value: commandCentre.dataQuality.status, source: "Verified daily summary coverage" }],
      });
    } else if (commandCentre.dataQuality.status === "usable") {
      for (const decision of input.operatingSystem.decisions) {
        // Only explicitly supported, authorized metrics are promoted. Money decisions are rebuilt above.
        const rule = decision.sourceRef === "sales-trend" ? { key: "net_sales", category: "sales" as const, destination: "Sales", allowed: hasPermission("metrics.revenue") && hasPermission("sales.view") && hasFeature("analytics.sales.basic") }
          : decision.sourceRef === "margin-trend" ? { key: "gross_margin", category: "sales" as const, destination: "Sales", allowed: hasPermission("metrics.revenue") && hasPermission("metrics.profit") && hasPermission("sales.view") && hasFeature("products.margin") }
            : decision.sourceRef === "labour-pressure" ? { key: "labour_rate", category: "operations" as const, destination: "Operations", allowed: hasPermission("metrics.revenue") && hasPermission("payroll.totals") && hasPermission("operations.tasks") && hasFeature("operations.basic") }
              : null;
        if (!rule?.allowed) continue;
        const metric = commandCentre.metrics[rule.key];
        if (!verifiedMetric(metric, input.now)) continue;
        signals.push({
          id: decision.id, category: rule.category,
          severity: decision.priority === "critical" ? "high" : decision.priority,
          title: decision.title,
          detail: `Review the recorded ${metric.periodStart ?? "unknown start"} to ${metric.periodEnd ?? "unknown end"} reporting period. This is not an intraday alert or an estimate of recoverable profit.`,
          nextStep: decision.decision, destination: rule.destination, evidence: [metricEvidence(metric)],
        });
      }
    }
  }
  const briefing = buildOwnerBriefing({ now: input.now, timezone: input.timezone, hours: input.hours, signals });
  return {
    ...briefing,
    pulseMetrics,
    scopeLabel: input.scopeLabel,
    hoursBasis: input.selectedLocation ? "Organization hours applied in the selected location's time zone; location-specific hours are not recorded." : "Organization hours and time zone.",
    reportingPeriod: commandCentre.metrics.net_sales?.periodStart && commandCentre.metrics.net_sales?.periodEnd
      ? { from: commandCentre.metrics.net_sales.periodStart, to: commandCentre.metrics.net_sales.periodEnd } : null,
    boundary: `${briefing.boundary} Priorities use the latest authorized command-centre evidence, independently of report filters.`,
  };
}
