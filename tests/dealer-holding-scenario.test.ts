import assert from "node:assert/strict";
import test from "node:test";
import { dealerHoldingScenario, dealerScenarioAmount, dealerScenarioDays, type DealerHoldingAssumptions, type DealerScenarioStock } from "../domain/dealer-holding-scenario.ts";
const stock: DealerScenarioStock = { currency: "CAD", ownership: "owned", availability: "available", postedCostCents: 2000000, costComplete: true };
const permissions = { costs: true, profit: true };
const assumptions: DealerHoldingAssumptions = { offerNowCents: 2500000, futurePriceCents: 2700000, dailyHoldingCents: 5000, waitingDays: 20, additionalCostConfirmed: true };
const result = (changes: Partial<DealerHoldingAssumptions> = {}, vehicle: Partial<DealerScenarioStock> = {}) => dealerHoldingScenario({ ...stock, ...vehicle }, permissions, { ...assumptions, ...changes });
function withheld(value: ReturnType<typeof result>) {
  assert.equal(value.available, false);
  for (const key of ["holdingCostCents", "offerContributionCents", "futureContributionCents", "differenceCents", "futurePriceToMatchCents"] as const) assert.equal(value[key], null);
}
test("one complete posted cost is used in both scenarios and only additional holding cost reduces the future", () => {
  assert.deepEqual(result(), { available: true, reason: null, holdingCostCents: 100000, offerContributionCents: 500000, futureContributionCents: 600000, differenceCents: 100000, futurePriceToMatchCents: 2600000 });
});
test("losses, zero daily cost and zero waiting days are preserved without optimistic clamps", () => {
  const loss = result({ offerNowCents: 1800000, futurePriceCents: 1900000 });
  assert.equal(loss.offerContributionCents, -200000);
  assert.equal(loss.futureContributionCents, -200000);
  assert.equal(loss.differenceCents, 0);
  assert.equal(result({ dailyHoldingCents: 0 }).holdingCostCents, 0);
  assert.equal(result({ waitingDays: 0 }).holdingCostCents, 0);
  const zero = result({ offerNowCents: 0, futurePriceCents: 0, dailyHoldingCents: 0, waitingDays: 0 }, { postedCostCents: 0 });
  assert.equal(zero.available, true); assert.equal(zero.futureContributionCents, 0);
});
test("unknown inputs and an unreviewed additional-cost basis withhold every result", () => {
  for (const key of ["offerNowCents", "futurePriceCents", "dailyHoldingCents", "waitingDays"] as const) withheld(result({ [key]: null }));
  withheld(result({ additionalCostConfirmed: false }));
  withheld(result({}, { postedCostCents: null }));
  withheld(result({}, { costComplete: false }));
});
test("cost and profit permissions protect against an overpopulated stock payload", () => {
  for (const access of [{ costs: false, profit: true }, { costs: true, profit: false }, { costs: false, profit: false }]) withheld(dealerHoldingScenario(stock, access, assumptions));
});
test("consignment, unknown ownership, closed stock and incompatible currencies do not produce owner margins", () => {
  for (const ownership of ["consignment", "unknown"] as const) withheld(result({}, { ownership }));
  for (const availability of ["delivered", "archived", "legacy_sold"] as const) withheld(result({}, { availability }));
  withheld(result({}, { currency: "JPY" }));
  withheld(result({}, { currency: "INVALID" }));
});
test("integer and BigInt range checks prevent invalid or overflowing scenarios", () => {
  for (const changes of [{ offerNowCents: -1 }, { futurePriceCents: 1.5 }, { dailyHoldingCents: NaN }, { waitingDays: -1 }, { waitingDays: 731 }, { waitingDays: 1.5 }, { dailyHoldingCents: Number.MAX_SAFE_INTEGER, waitingDays: 2 }]) withheld(result(changes));
  withheld(result({ offerNowCents: Number.MAX_SAFE_INTEGER, dailyHoldingCents: 1, waitingDays: 1 }));
  const exact = result({ offerNowCents: Number.MAX_SAFE_INTEGER, futurePriceCents: Number.MAX_SAFE_INTEGER, dailyHoldingCents: 0, waitingDays: 0 }, { postedCostCents: Number.MAX_SAFE_INTEGER });
  assert.equal(exact.available, true); assert.equal(exact.futureContributionCents, 0);
});
test("decimal amounts and waiting days parse exactly and leave unknowns null", () => {
  assert.equal(dealerScenarioAmount("1.20"), 120);
  assert.equal(dealerScenarioAmount("0"), 0);
  assert.equal(dealerScenarioAmount("10000000.00"), 1000000000);
  assert.equal(dealerScenarioAmount("  "), null);
  assert.equal(dealerScenarioDays(""), null);
  assert.equal(dealerScenarioDays("0"), 0);
  assert.equal(dealerScenarioDays("730"), 730);
  for (const value of ["1e3", "-1", "1.001", "$1", "1,000", "10000000.01"]) assert.throws(() => dealerScenarioAmount(value));
  for (const value of ["1.5", "-1", "1e2", "731"]) assert.throws(() => dealerScenarioDays(value));
});
