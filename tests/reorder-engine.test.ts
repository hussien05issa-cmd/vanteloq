import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateReorderRecommendation,
  type ReorderInputs,
} from "../domain/reorder-engine.ts";

const baseInputs: ReorderInputs = {
  onHandUnits: 20,
  incomingUnits: 0,
  averageDailyDemand: 10,
  demandStdDevDaily: 2,
  leadTimeDays: 7,
  reviewPeriodDays: 7,
  serviceLevelZ: 1.65,
  seasonalityFactor: 1,
  promotionFactor: 1,
  casePackUnits: 12,
  minimumOrderUnits: 48,
  unitCostCents: 500,
  availableCashCents: 100_000,
  cashSafetyThresholdCents: 30_000,
  accountsPayableCents: 20_000,
  payrollCommitmentsCents: 0,
  taxCommitmentsCents: 0,
  debtCommitmentsCents: 0,
  otherCommitmentsCents: 0,
  shelfLifeDays: null,
  storageCapacityUnits: null,
  demandHistoryDays: 84,
  dataAgeHours: 4,
};

test("the recommendation respects demand, lead time, pack size and the cash floor", () => {
  const recommendation = calculateReorderRecommendation(baseInputs);
  assert.equal(recommendation.forecastDemandUnits, 140);
  assert.equal(recommendation.safetyStockUnits, 9);
  assert.equal(recommendation.unconstrainedUnits, 132);
  assert.equal(recommendation.recommendedUnits, 96);
  assert.equal(recommendation.recommendedUnits % baseInputs.casePackUnits, 0);
  assert.equal(recommendation.cashAfterOrderCents, 32_000);
  assert.equal(recommendation.cashThresholdBreached, false);
  assert.deepEqual(recommendation.constrainedBy, ["Cash safety threshold"]);
  assert.equal(recommendation.requiresHumanApproval, true);
});

test("the engine blocks ordering when commitments consume cash above the safety threshold", () => {
  const recommendation = calculateReorderRecommendation({
    ...baseInputs,
    availableCashCents: 50_000,
  });
  assert.equal(recommendation.status, "blocked");
  assert.equal(recommendation.recommendedUnits, 0);
  assert.equal(recommendation.cashAfterOrderCents, 30_000);
  assert.equal(recommendation.cashThresholdBreached, false);
  assert.ok(recommendation.constrainedBy.includes("Cash safety threshold"));
});

test("shelf life and storage capacity cap over-ordering", () => {
  const recommendation = calculateReorderRecommendation({
    ...baseInputs,
    availableCashCents: 500_000,
    shelfLifeDays: 7,
    storageCapacityUnits: 80,
  });
  assert.equal(recommendation.recommendedUnits, 48);
  assert.ok(recommendation.constrainedBy.includes("Shelf life"));
  assert.ok(recommendation.constrainedBy.includes("Storage capacity"));
  assert.equal(recommendation.requiresHumanApproval, true);
});

test("sufficient on-hand stock produces no suggested order", () => {
  const recommendation = calculateReorderRecommendation({
    ...baseInputs,
    onHandUnits: 200,
  });
  assert.equal(recommendation.status, "no_order");
  assert.equal(recommendation.recommendedUnits, 0);
  assert.ok(recommendation.scenarios.every((scenario) => scenario.cashAfterOrderCents >= baseInputs.cashSafetyThresholdCents));
});
