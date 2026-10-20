import assert from "node:assert/strict";
import test from "node:test";
import { foodOperationalReview, foodReviewDateRangeError, foodReviewToday } from "../domain/food-analytics.ts";
import { SECTOR_DEFINITIONS, validateSectorContent, type SectorKind, type SectorRecord } from "../domain/sector-operations.ts";

function record(id: string, kind: SectorKind, values: Record<string, unknown> = {}, extra: Partial<SectorRecord> = {}): SectorRecord {
  const defaults = Object.fromEntries(SECTOR_DEFINITIONS[kind].fields.map(field => [field.key, null]));
  const content = validateSectorContent({ kind, title: id, source: "Fictional test records", sourceDate: "2026-10-04", dueDate: "", currency: "CAD", notes: "", values: { ...defaults, ...values }, batch: null });
  return { ...content, id, locationId: "one", version: 1, state: "reviewed", updatedAt: 1, ...extra };
}
const scope = { locationId: "one" };
const batch = (id: string, values: Record<string, unknown> = {}, extra: Partial<SectorRecord> = {}) => record(id, "prep_batch", { recipeId: "recipe", preparedDate: "2026-10-04", portions: 10000, wastePortions: 0, actualCost: 1000, ...values }, extra);
const delivery = (id: string, values: Record<string, unknown> = {}, extra: Partial<SectorRecord> = {}) => record(id, "delivery_order", { provider: "Provider", orderRef: id, netSales: 10000, taxTips: 1000, fees: 2500, adjustments: 0, payout: 8500, foodCost: 2000, packaging: 500, incrementalLabour: 0, resolved: false, ...values }, extra);

test("production loss is weighted by the same prepared portions, with recipes and currencies separate", () => {
  const result = foodOperationalReview([
    batch("small", { portions: 10000, wastePortions: 5000 }),
    batch("large", { portions: 90000, wastePortions: 0 }),
    batch("other-recipe", { recipeId: "other" }),
    batch("usd", {}, { currency: "USD" }),
  ], scope);
  assert.equal(result.batches.length, 3);
  assert.equal(result.batches[0].preparedMilli, 100000);
  assert.equal(result.batches[0].usableMilli, 95000);
  assert.equal(result.batches[0].wasteBasisPoints, 500);
  assert.equal(result.batches[0].ingredientCost, 2000);
});
test("missing batch evidence is not turned into a zero-waste or zero-cost total", () => {
  const result = foodOperationalReview([batch("known"), batch("unknown", { wastePortions: null, actualCost: null })], scope).batches[0];
  assert.equal(result.completeBatches, 1);
  assert.equal(result.records.length, 2);
  assert.equal(result.preparedMilli, null);
  assert.equal(result.wasteBasisPoints, null);
  assert.equal(result.ingredientCost, null);
  assert.equal(foodOperationalReview([], scope).batches.length, 0);
});
test("scope uses activity dates, latest versions and reviewed states without mixing locations", () => {
  const result = foodOperationalReview([
    batch("versioned", { portions: 1000 }), batch("versioned", { portions: 2000 }, { version: 2 }),
    batch("cancelled", {}, { state: "cancelled" }), batch("draft", {}, { state: "draft" }),
    batch("elsewhere", {}, { locationId: "two" }), batch("earlier", { preparedDate: "2026-10-03" }),
    batch("undated", { preparedDate: null }),
  ], { ...scope, from: "2026-10-04", to: "2026-10-04" });
  assert.equal(result.records.length, 1);
  assert.equal(result.batches[0].preparedMilli, 2000);
  assert.equal(result.excludedStates, 2);
  assert.equal(result.undated, 1);
  assert.throws(() => foodOperationalReview([], { ...scope, from: "2026-10-05", to: "2026-10-04" }), /ordered/);
  assert.throws(() => foodOperationalReview([], { ...scope, from: "2026-02-30" }), /valid/);
});
test("delivery margin includes all withheld costs, weights source sales and never counts tax as sales", () => {
  const result = foodOperationalReview([delivery("one"), delivery("two", { netSales: 30000, taxTips: 3000, fees: 1000, adjustments: 2000, payout: 30000, foodCost: 6000 })], scope).deliveries[0];
  assert.equal(result.netSales, 40000);
  assert.equal(result.contribution, 25500);
  assert.equal(result.contributionBasisPoints, 6375);
  assert.equal(result.unresolvedSettlements, 0);
  assert.equal(result.costCompleteOrders, 2);
});
test("delivery unknown costs suppress the group margin and preserve unresolved versus unmeasured settlement", () => {
  const result = foodOperationalReview([delivery("unknown-cost", { foodCost: null, payout: null }), delivery("gap", { payout: 8000 })], scope).deliveries[0];
  assert.equal(result.netSales, 20000);
  assert.equal(result.contribution, null);
  assert.equal(result.contributionBasisPoints, null);
  assert.equal(result.costCompleteOrders, 1);
  assert.equal(result.unknownSettlements, 1);
  assert.equal(result.unresolvedSettlements, 1);
});
test("zero delivery sales cannot produce a percentage and negative contribution stays negative", () => {
  const zero = foodOperationalReview([delivery("zero", { netSales: 0 })], scope).deliveries[0];
  assert.equal(zero.contributionBasisPoints, null);
  const loss = foodOperationalReview([delivery("loss", { netSales: 4000 })], scope).deliveries[0];
  assert.equal(loss.contribution, -1000);
  assert.equal(loss.contributionBasisPoints, -2500);
});
test("a delivery settlement resolution requires its recorded explanation", () => {
  const withoutEvidence = delivery("gap", { payout: 8000, resolved: true });
  assert.equal(foodOperationalReview([withoutEvidence], scope).deliveries[0].unresolvedSettlements, 1);
  assert.equal(foodOperationalReview([{ ...withoutEvidence, notes: "Reviewed source shows retained provider adjustment." }], scope).deliveries[0].unresolvedSettlements, 0);
});
test("service periods stay separate even when their dates and windows overlap", () => {
  const rows = [record("all-day", "service_period", { serviceDate: "2026-10-04", daypart: "All day" }), record("lunch", "service_period", { serviceDate: "2026-10-04", daypart: "Lunch" })];
  const result = foodOperationalReview(rows, scope);
  assert.equal(result.services.length, 2);
  assert.equal(result.batches.length, 0);
  assert.equal(result.deliveries.length, 0);
});
test("delivery filters use source date while batches and service use their own activity dates", () => {
  const rows = [delivery("dated", {}, { sourceDate: "2026-10-03" }), batch("batch", { preparedDate: "2026-10-03" }), record("service", "service_period", { serviceDate: "2026-10-03" })];
  assert.equal(foodOperationalReview(rows, { ...scope, from: "2026-10-03", to: "2026-10-03" }).records.length, 3);
  assert.equal(foodOperationalReview(rows, { ...scope, from: "2026-10-04" }).records.length, 0);
});
test("today follows the selected location across midnight and rejects unsupported clocks", () => {
  const now = new Date("2026-10-04T01:00:00Z");
  assert.equal(foodReviewToday("UTC", now), "2026-10-04");
  assert.equal(foodReviewToday("America/Denver", now), "2026-10-03");
  assert.equal(foodReviewToday("Asia/Tokyo", now), "2026-10-04");
  assert.equal(foodReviewToday("Invalid/Timezone", now), null);
  assert.equal(foodReviewToday("UTC", new Date("invalid")), null);
});
test("date ranges validate both bounds before comparing their order", () => {
  for (const value of ["10000-01-01", "2026-02-30", "2026-1-01", "0000-01-01", "not-a-date"]) {
    assert.match(foodReviewDateRangeError({ from: value })!, /valid review start date/);
    assert.match(foodReviewDateRangeError({ to: value })!, /valid review end date/);
    assert.throws(() => foodOperationalReview([], { ...scope, from: value }), /valid review start date/);
  }
  assert.equal(foodReviewDateRangeError({ from: "0001-01-01", to: "9999-12-31" }), null);
  assert.equal(foodReviewDateRangeError({ from: "", to: "" }), null);
  assert.equal(foodReviewDateRangeError({ from: "2024-02-29", to: "2024-02-29" }), null);
  assert.match(foodReviewDateRangeError({ from: "2026-10-05", to: "2026-10-04" })!, /ordered/);
});
