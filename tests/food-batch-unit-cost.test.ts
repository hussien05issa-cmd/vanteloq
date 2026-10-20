import assert from "node:assert/strict";
import test from "node:test";
import { foodOperationalReview } from "../domain/food-analytics.ts";
import type { SectorRecord } from "../domain/sector-operations.ts";

function batch(id: string, portions: number | null, waste: number | null, cost: number | null, extra: Partial<SectorRecord> = {}): SectorRecord {
  return { id, locationId: "one", version: 1, state: "reviewed", updatedAt: 1, kind: "prep_batch", title: id, source: "Fictional batch sheet", sourceDate: "2026-10-04", dueDate: "", currency: "CAD", notes: "", batch: null,
    values: { recipeId: "recipe", preparedDate: "2026-10-04", portions, wastePortions: waste, actualCost: cost }, ...extra };
}
const scope = { locationId: "one" };
const unitCost = (rows: SectorRecord[]) => foodOperationalReview(rows, scope).batches[0].ingredientCostPerUsablePortion;

test("usable-portion cost divides aggregate ingredient cost by aggregate usable output", () => {
  const result = foodOperationalReview([batch("small", 10000, 5000, 1000), batch("large", 90000, 0, 9000)], scope).batches[0];
  assert.equal(result.ingredientCost, 10000);
  assert.equal(result.usableMilli, 95000);
  assert.equal(result.ingredientCostPerUsablePortion, 105);
  // Averaging the individual 200- and 100-minor-unit rates would incorrectly give 150.
});
test("fractional portions round the final minor-unit amount once and preserve verified zero cost", () => {
  assert.equal(unitCost([batch("half", 2500, 500, 101)]), 51);
  assert.equal(unitCost([batch("zero", 2500, 500, 0)]), 0);
});
test("missing cost, missing quantities and no usable output remain unavailable", () => {
  assert.equal(unitCost([batch("known", 10000, 0, 1000), batch("unknown-cost", 10000, 0, null)]), null);
  assert.equal(unitCost([batch("unknown-waste", 10000, null, 1000)]), null);
  assert.equal(unitCost([batch("unknown-prepared", null, 0, 1000)]), null);
  assert.equal(unitCost([batch("no-output", 10000, 10000, 1000)]), null);
});
test("the arithmetic uses BigInt intermediates and withholds unsafe totals or results", () => {
  assert.equal(unitCost([batch("large-safe", 1000, 0, Number.MAX_SAFE_INTEGER)]), Number.MAX_SAFE_INTEGER);
  assert.equal(unitCost([batch("unsafe-rate", 1, 0, Number.MAX_SAFE_INTEGER)]), null);
  assert.equal(unitCost([batch("large-total", 1000, 0, Number.MAX_SAFE_INTEGER), batch("extra", 1000, 0, 1)]), null);
});
test("currencies, recipes, activity dates and permitted input scope remain separate", () => {
  const otherRecipe = batch("other", 1000, 0, 900, { values: { recipeId: "other", preparedDate: "2026-10-04", portions: 1000, wastePortions: 0, actualCost: 900 } });
  const result = foodOperationalReview([batch("cad", 1000, 0, 200), batch("jpy", 1000, 0, 900, { currency: "JPY" }), otherRecipe,
    batch("outside-location", 1000, 0, 9999, { locationId: "two" }), batch("draft", 1000, 0, 9999, { state: "draft" })], scope);
  assert.deepEqual(result.batches.map(row => [row.recipeId, row.currency, row.ingredientCostPerUsablePortion]), [["recipe", "CAD", 200], ["recipe", "JPY", 900], ["other", "CAD", 900]]);
  assert.equal(foodOperationalReview(result.records, { ...scope, from: "2026-10-05" }).batches.length, 0);
});
