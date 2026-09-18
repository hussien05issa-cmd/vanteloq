import { metricDefinition, type MetricUnit } from "./metric-registry.ts";

export type FreshnessStatus = "current" | "aging" | "stale" | "missing";
export type ConfidenceLevel = "high" | "medium" | "low" | "unavailable";
export type MetricActuality = "actual" | "estimate" | "forecast" | "unavailable";

export type TrustedMetricRow = {
  businessDate: string;
  sourceImportId?: string | null;
  locationRef?: string;
  updatedAt?: Date | number | string | null;
};

export type MetricResult = {
  metricId: string;
  metricName: string;
  value: number | null;
  unit: MetricUnit;
  currency: string | null;
  actuality: MetricActuality;
  periodStart: string | null;
  periodEnd: string | null;
  comparisonPeriodStart: string | null;
  comparisonPeriodEnd: string | null;
  sourceSystem: string;
  sourceAccount: string;
  sourceRecords: number;
  sourceTimestamp: string | null;
  calculationMethod: string;
  calculationVersion: string;
  freshnessStatus: FreshnessStatus;
  confidenceLevel: ConfidenceLevel;
  confidenceBasis: string[];
  limitations: string[];
  generatedAt: string;
};

type BuildInput = {
  rows: TrustedMetricRow[];
  currency: string;
  periodStart: string;
  periodEnd: string;
  comparisonPeriodStart: string;
  comparisonPeriodEnd: string;
  freshnessStatus: FreshnessStatus;
  generatedAt?: string;
  values: Record<string, number | null>;
};

function confidence(input: BuildInput): { level: ConfidenceLevel; basis: string[] } {
  if (!input.rows.length) return { level: "unavailable", basis: ["No verified source records"] };
  const uniqueDates = new Set(input.rows.map((row) => row.businessDate)).size;
  const importCount = new Set(input.rows.map((row) => row.sourceImportId).filter(Boolean)).size;
  const basis = [
    `${uniqueDates} verified business date${uniqueDates === 1 ? "" : "s"}`,
    importCount ? `${importCount} source import${importCount === 1 ? "" : "s"}` : "Source import reference unavailable",
    `${input.freshnessStatus} source freshness`,
  ];
  if (input.freshnessStatus === "stale" || uniqueDates < 7) return { level: "low", basis };
  if (input.freshnessStatus === "aging" || uniqueDates < 28) return { level: "medium", basis };
  return { level: "high", basis };
}

export function normalizedSourceTimestamp(value: Date | number | string): string | null {
  let milliseconds = value instanceof Date ? value.getTime() : typeof value === "number"
    ? (Math.abs(value) < 100_000_000_000 ? value * 1000 : value) : Date.parse(value);
  // Older raw R-Series writes stored milliseconds in a seconds-mode column.
  // Drizzle decodes them a second time; preserve the original instant on read.
  if (milliseconds >= Date.UTC(2000, 0, 1) * 1000 && milliseconds <= (Date.now() + 86_400_000) * 1000) milliseconds /= 1000;
  if (!Number.isFinite(milliseconds) || Math.abs(milliseconds) > 8_640_000_000_000_000) return null;
  return new Date(milliseconds).toISOString();
}

function sourceTimestamp(rows: TrustedMetricRow[]): string | null {
  const timestamps = rows
    .map((row) => row.updatedAt)
    .filter((value): value is Date | number | string => value !== null && value !== undefined)
    .map(normalizedSourceTimestamp)
    .filter((value): value is string => value !== null)
    .sort((left, right) => Date.parse(left) - Date.parse(right));
  return timestamps.at(-1) ?? null;
}

export function buildMetricResults(input: BuildInput): Record<string, MetricResult> {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const resultConfidence = confidence(input);
  const locations = new Set(input.rows.map((row) => row.locationRef || "all"));
  return Object.fromEntries(Object.entries(input.values).map(([key, value]) => {
    const definition = metricDefinition(key);
    const available = value !== null && input.rows.length > 0;
    return [key, {
      metricId: key,
      metricName: definition.label,
      value,
      unit: definition.unit,
      currency: definition.unit === "minor_currency" ? input.currency : null,
      actuality: available ? "actual" : "unavailable",
      periodStart: available ? input.periodStart : null,
      periodEnd: available ? input.periodEnd : null,
      comparisonPeriodStart: available ? input.comparisonPeriodStart : null,
      comparisonPeriodEnd: available ? input.comparisonPeriodEnd : null,
      sourceSystem: "Vanteloq verified daily summaries",
      sourceAccount: locations.has("all") ? "All locations" : `${locations.size} mapped location${locations.size === 1 ? "" : "s"}`,
      sourceRecords: input.rows.length,
      sourceTimestamp: sourceTimestamp(input.rows),
      calculationMethod: definition.formula,
      calculationVersion: definition.calculationVersion,
      freshnessStatus: available ? input.freshnessStatus : "missing",
      confidenceLevel: available ? resultConfidence.level : "unavailable",
      confidenceBasis: available ? resultConfidence.basis : ["Required metric inputs are unavailable"],
      limitations: definition.exclusions.concat(definition.edgeCases),
      generatedAt,
    } satisfies MetricResult];
  }));
}
