import assert from "node:assert/strict";
import test from "node:test";
import { commerceChangeRate, inventoryDecision, parseCommercePeriod } from "../domain/commerce-intelligence.ts";

test("custom commerce periods include both selected dates and use an equal preceding comparison", () => {
  assert.deepEqual(parseCommercePeriod("2026-07-10", "2026-07-24"), {
    from: "2026-07-10",
    to: "2026-07-24",
    toExclusive: "2026-07-25",
    days: 15,
    comparisonFrom: "2026-06-25",
    comparisonTo: "2026-07-09",
    comparisonToExclusive: "2026-07-10",
  });
});

test("commerce periods reject reversed and oversized ranges", () => {
  assert.throws(() => parseCommercePeriod("2026-08-12", "2026-08-01"), /start date/);
  assert.throws(() => parseCommercePeriod("2010-01-01", "2026-08-12"), /ten years/);
});

test("inventory decisions distinguish stockout, low stock, cover watch and healthy stock", () => {
  assert.equal(inventoryDecision(0, 4, 30, 30).stockStatus, "stockout");
  assert.equal(inventoryDecision(3, 4, 30, 30).stockStatus, "low");
  assert.equal(inventoryDecision(10, 4, 30, 30).stockStatus, "watch");
  assert.equal(inventoryDecision(30, 4, 30, 30).stockStatus, "healthy");
  assert.equal(inventoryDecision(3, 4, 30, 30).recommendedOrderUnits, 18);
});

test("change rates never fabricate a comparison when the baseline is zero", () => {
  assert.equal(commerceChangeRate(100, 0), null);
  assert.equal(commerceChangeRate(120, 100), 0.2);
  assert.equal(commerceChangeRate(80, 100), -0.2);
});
