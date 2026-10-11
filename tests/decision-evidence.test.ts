import test from "node:test";
import assert from "node:assert/strict";
import { foodPeriodDecisionCards, settlementDecisionCards } from "../server/decision-evidence.ts";
import type { FoodSavedRecord } from "../domain/foodservice.ts";
import type { SavedBusinessWorkflow } from "../domain/business-workflows.ts";

const money = (minor: number) => ({ minor, currency: "CAD" });
const food: FoodSavedRecord = { id: "food-evidence", locationId: "allowed-location", version: 3, updatedAt: Date.parse("2026-10-08T10:00:00Z"), kind: "period", name: "Reviewed food period", source: "Owner-reviewed counts, receipts and recipe costing", asOfDate: "2026-10-08", from: "2026-10-01", to: "2026-10-07",
  payload: { currency: "CAD", opening: money(30_000), purchases: money(10_000), supplierCredits: money(0), transfersIn: money(0), transfersOut: money(0), closing: money(20_000), foodNetSales: money(50_000), totalNetSales: money(50_000), theoreticalCost: money(15_000), recordedWasteCost: money(2_000), labourCost: money(10_000), otherVariableCosts: money(1_000), closedChecks: 10 } };
const settlement: SavedBusinessWorkflow = { id: "settlement-evidence", locationId: "allowed-location", version: 4, updatedAt: Date.parse("2026-10-08T10:00:00Z"), state: "reviewed", kind: "settlement", name: "Reviewed settlement", source: "Explicit provider mapping and retained bank record", asOfDate: "2026-10-08", currency: "CAD", costCoverage: false, note: "", values: { provider: "Stripe", account: "merchant", payoutId: "payout-source", payoutDate: "2026-10-03", bankAmount: "95.00", bankReference: "retained-bank-source", batchType: "manual-reviewed" }, groups: { entries: [{ reference: "sale-source", orderReference: "order-source", type: "sale", amount: "100.00" }, { reference: "fee-source", type: "fee", amount: "-4.00" }] } };

test("saved food helper preserves historical source cutoff and version without a live-source claim", () => {
  const card = foodPeriodDecisionCards(food)[0];
  assert.equal(card.status, "recorded");
  assert.equal(card.value?.amount, 3_000);
  assert.equal(card.evidence.asOf, "2026-10-08");
  assert.deepEqual(card.evidence.period, { from: "2026-10-01", to: "2026-10-07" });
  assert.deepEqual(card.evidence.sources[0].recordIds, ["food-evidence:version:3"]);
  assert.match(card.evidence.sources[0].system, /Owner-reviewed counts/);
  assert.doesNotMatch(card.summary, /today|live|automatic|audited/i);
  assert.match(card.evidence.limitations.join(" "), /not ingredient quantities/);
});

test("saved food helper excludes recipes and withholds unavailable counts, costs and currency mismatch", () => {
  const recipe: FoodSavedRecord = { ...food, kind: "recipe", payload: { currency: "CAD", portions: "1", ingredients: null } };
  assert.deepEqual(foodPeriodDecisionCards(recipe), []);
  assert.equal(foodPeriodDecisionCards({ ...food, payload: { ...food.payload, closing: null } })[0].value, null);
  assert.equal(foodPeriodDecisionCards({ ...food, payload: { ...food.payload, recordedWasteCost: null } })[0].status, "unavailable");
  assert.equal(foodPeriodDecisionCards({ ...food, payload: { ...food.payload, theoreticalCost: { minor: 1, currency: "USD" } } })[0].status, "unavailable");
  assert.equal(foodPeriodDecisionCards({ ...food, to: "2026-10-09" })[0].status, "unavailable");
});

test("settlement helper preserves actual payout date and retained reviewed version", () => {
  const card = settlementDecisionCards(settlement)[0];
  assert.equal(card.status, "recorded");
  assert.equal(card.value?.amount, -100);
  assert.equal(card.evidence.asOf, "2026-10-08");
  assert.deepEqual(card.evidence.period, { from: "2026-10-03", to: "2026-10-03" });
  assert.deepEqual(card.evidence.sources[0].recordIds, ["settlement-evidence:version:4"]);
  assert.match(card.evidence.limitations.join(" "), /does not infer Stripe payout membership/);
});

test("a saved settlement draft, missing bank evidence or unreviewed mapping cannot present a numeric difference", () => {
  for (const record of [{ ...settlement, state: "draft" as const }, { ...settlement, values: { ...settlement.values, bankReference: "" } }, { ...settlement, values: { ...settlement.values, batchType: "" } }, { ...settlement, values: { ...settlement.values, payoutDate: "2026-10-09" } }]) {
    const card = settlementDecisionCards(record)[0];
    assert.equal(card.status, "unavailable");
    assert.equal(card.value, null);
  }
  assert.deepEqual(settlementDecisionCards({ ...settlement, kind: "custom" }), []);
});

test("server adapters do not rewrite saved facts or include another source version", () => {
  const before = JSON.stringify({ food, settlement });
  assert.deepEqual(foodPeriodDecisionCards(food), foodPeriodDecisionCards(food));
  assert.deepEqual(settlementDecisionCards(settlement), settlementDecisionCards(settlement));
  assert.equal(JSON.stringify({ food, settlement }), before);
});
