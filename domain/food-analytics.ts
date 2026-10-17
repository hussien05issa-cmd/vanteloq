import { sectorReport, type SectorKind, type SectorRecord } from "./sector-operations";
import { businessClock } from "./intraday-sales";

export const FOOD_REVIEW_KINDS: readonly SectorKind[] = ["prep_batch", "service_period", "delivery_order"];
export const FOOD_REVIEW_DATE_MIN = "0001-01-01";
export const FOOD_REVIEW_DATE_MAX = "9999-12-31";
export type FoodReviewScope = { locationId: string; from?: string; to?: string };
export type FoodBatchReview = {
  recipeId: string; currency: string; records: SectorRecord[]; completeBatches: number;
  preparedMilli: number | null; unusableMilli: number | null; usableMilli: number | null;
  wasteBasisPoints: number | null; ingredientCost: number | null; ingredientCostPerUsablePortion: number | null;
};
export type FoodDeliveryReview = {
  provider: string; currency: string; records: SectorRecord[]; costCompleteOrders: number;
  netSales: number | null; contribution: number | null; contributionBasisPoints: number | null;
  unresolvedSettlements: number; unknownSettlements: number;
};
const numeric = (record: SectorRecord, field: string) => {
  const value = record.values[field];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
};
function safe(value: bigint): number | null {
  return value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(value);
}
function sum(values: (number | null)[]): number | null {
  return !values.length || values.some(value => value === null) ? null : safe(values.reduce<bigint>((total, value) => total + BigInt(value!), BigInt(0)));
}
function basisPoints(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator <= 0) return null;
  const n = BigInt(numerator), d = BigInt(denominator), absolute = n < BigInt(0) ? -n : n;
  return safe((n < BigInt(0) ? -BigInt(1) : BigInt(1)) * ((absolute * BigInt(10_000) + d / BigInt(2)) / d));
}
const validDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= FOOD_REVIEW_DATE_MIN && value <= FOOD_REVIEW_DATE_MAX && Number.isFinite(Date.parse(value + "T00:00:00Z")) && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
export function foodReviewDateRangeError({ from, to }: Pick<FoodReviewScope, "from" | "to">): string | null {
  if (from && !validDate(from)) return `Enter a valid review start date from ${FOOD_REVIEW_DATE_MIN} through ${FOOD_REVIEW_DATE_MAX}.`;
  if (to && !validDate(to)) return `Enter a valid review end date from ${FOOD_REVIEW_DATE_MIN} through ${FOOD_REVIEW_DATE_MAX}.`;
  if (from && to && from > to) return "Use an ordered review date range. The end date must be on or after the start date.";
  return null;
}
export function foodReviewToday(timezone: string, now: Date): string | null {
  try { return businessClock(now, timezone)?.date ?? null; } catch { return null; }
}
export function foodReviewDate(record: SectorRecord): string | null {
  const date = record.kind === "prep_batch" ? record.values.preparedDate : record.kind === "service_period" ? record.values.serviceDate : record.sourceDate;
  return validDate(date) ? date : null;
}

/** Read-only summaries of the supplied page(s), never a claim of complete POS activity. */
export function foodOperationalReview(input: readonly SectorRecord[], scope: FoodReviewScope) {
  const dateError = foodReviewDateRangeError(scope);
  if (dateError) throw new Error(dateError);
  const latest = new Map<string, SectorRecord>();
  for (const record of input) {
    if (record.locationId !== scope.locationId || !FOOD_REVIEW_KINDS.includes(record.kind)) continue;
    const previous = latest.get(record.id);
    if (!previous || record.version > previous.version) latest.set(record.id, record);
  }
  const all = [...latest.values()], reviewed = all.filter(record => ["reviewed", "active", "completed"].includes(record.state));
  let undated = 0;
  const records = reviewed.filter(record => {
    const date = foodReviewDate(record);
    if (!date) { undated++; return false; }
    return (!scope.from || date >= scope.from) && (!scope.to || date <= scope.to);
  });
  const batchGroups = new Map<string, SectorRecord[]>(), deliveryGroups = new Map<string, SectorRecord[]>();
  for (const record of records) {
    if (record.kind === "prep_batch") {
      // An unlinked recipe is its own unknown population, never merged into another recipe.
      const key = JSON.stringify([record.values.recipeId ?? record.id, record.currency]);
      batchGroups.set(key, [...(batchGroups.get(key) ?? []), record]);
    }
    if (record.kind === "delivery_order") {
      const key = JSON.stringify([String(record.values.provider ?? "Unspecified provider").trim().toLowerCase(), record.currency]);
      deliveryGroups.set(key, [...(deliveryGroups.get(key) ?? []), record]);
    }
  }
  const batches: FoodBatchReview[] = [...batchGroups.values()].map(rows => {
    const complete = rows.filter(row => {
      const prepared = numeric(row, "portions"), waste = numeric(row, "wastePortions");
      return prepared !== null && prepared > 0 && waste !== null && waste <= prepared;
    });
    const fullyCovered = complete.length === rows.length;
    const preparedMilli = fullyCovered ? sum(rows.map(row => numeric(row, "portions"))) : null;
    const unusableMilli = fullyCovered ? sum(rows.map(row => numeric(row, "wastePortions"))) : null;
    const usableMilli = preparedMilli !== null && unusableMilli !== null ? preparedMilli - unusableMilli : null;
    const ingredientCost = sum(rows.map(row => numeric(row, "actualCost")));
    // Portion quantities use thousandths; divide aggregate cost by aggregate usable
    // output before rounding once to the currency's minor unit. Never average rates.
    const ingredientCostPerUsablePortion = ingredientCost !== null && usableMilli !== null && usableMilli > 0
      ? safe((BigInt(ingredientCost) * BigInt(1000) + BigInt(usableMilli) / BigInt(2)) / BigInt(usableMilli)) : null;
    return { recipeId: String(rows[0].values.recipeId ?? ""), currency: rows[0].currency, records: rows,
      completeBatches: complete.length, preparedMilli, unusableMilli,
      usableMilli, ingredientCost, ingredientCostPerUsablePortion,
      wasteBasisPoints: basisPoints(unusableMilli, preparedMilli) };
  });
  const deliveries: FoodDeliveryReview[] = [...deliveryGroups.values()].map(rows => {
    const reports = rows.map(row => sectorReport(row));
    const contributionValues = reports.map(report => report.metrics.find(metric => metric.label === "Order contribution")?.value ?? null);
    const gaps = reports.map(report => report.metrics.find(metric => metric.label === "Unreconciled settlement")?.value ?? null);
    const netSales = sum(rows.map(row => numeric(row, "netSales"))), contribution = sum(contributionValues);
    return { provider: String(rows[0].values.provider ?? "Unspecified provider"), currency: rows[0].currency, records: rows,
      costCompleteOrders: contributionValues.filter(value => value !== null).length, netSales, contribution,
      contributionBasisPoints: basisPoints(contribution, netSales),
      unresolvedSettlements: gaps.filter((gap, index) => gap !== null && gap !== 0 && !(rows[index].values.resolved === true && rows[index].notes.trim())).length,
      unknownSettlements: gaps.filter(gap => gap === null).length };
  });
  // Service windows can overlap. Keep source periods separate instead of summing double-counted sales or averaging rates.
  const services = records.filter(record => record.kind === "service_period").sort((a, b) => foodReviewDate(b)!.localeCompare(foodReviewDate(a)!) || a.title.localeCompare(b.title));
  return { batches, services, deliveries, records, excludedStates: all.length - reviewed.length, undated };
}
