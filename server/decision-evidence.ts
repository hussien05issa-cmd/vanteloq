import { buildDecisionCards, type DecisionCard } from "../domain/decision-cards";
import type { FoodSavedRecord } from "../domain/foodservice";
import type { SavedBusinessWorkflow } from "../domain/business-workflows";

/** Called only after the existing record readers enforce tenant, role and location access.
 * These are historical calculations at the reviewed source cutoff, never a live-sync claim. */
export function foodPeriodDecisionCards(record: FoodSavedRecord): DecisionCard[] {
  if (record.kind !== "period" || !record.from || !record.to) return [];
  return buildDecisionCards({ asOf: record.asOfDate, currency: record.payload.currency, kinds: ["food_variance"], food: {
    record, context: { period: { from: record.from, to: record.to }, asOf: record.asOfDate, currency: record.payload.currency,
      freshness: "current", coverage: "complete", sources: [{ system: `Reviewed food period: ${record.source}`, currency: record.payload.currency, recordIds: [`${record.id}:version:${record.version}`] }] },
  } });
}

export function settlementDecisionCards(record: SavedBusinessWorkflow): DecisionCard[] {
  if (record.kind !== "settlement") return [];
  return buildDecisionCards({ asOf: record.asOfDate, currency: record.currency, kinds: ["payout_difference"], settlement: {
    record, context: { period: { from: record.asOfDate, to: record.asOfDate }, asOf: record.asOfDate, currency: record.currency,
      freshness: "current", coverage: "complete", sources: [{ system: `Reviewed settlement: ${record.source}`, currency: record.currency, recordIds: [`${record.id}:version:${record.version}`] }] },
  } });
}
