import assert from "node:assert/strict";
import test from "node:test";
import { buildProfitBreakdown } from "../domain/bookloq-profit-breakdown";

const profit = { revenueCents: 2_000_000, cogsCents: 900_000, expenseCents: 1_200_000, grossProfitCents: 1_100_000, operatingProfitCents: 800_000 };
test("posted expense breakdown subtracts cost of goods sold exactly once", () => {
  const rows = buildProfitBreakdown(profit, true)!;
  assert.deepEqual(rows.map(row => row.cents), [2_000_000, 900_000, 1_100_000, 300_000, 800_000]);
  assert.equal(rows[2].cents - rows[3].cents, rows[4].cents);
});
test("losses, zero revenue and expense credits keep their signs", () => {
  assert.equal(buildProfitBreakdown({ revenueCents: 0, cogsCents: 20, expenseCents: 50, grossProfitCents: -20, operatingProfitCents: -50 }, true)![4].cents, -50);
  assert.equal(buildProfitBreakdown({ revenueCents: 100, cogsCents: -20, expenseCents: -50, grossProfitCents: 120, operatingProfitCents: 150 }, true)![3].cents, -30);
  assert.ok(buildProfitBreakdown({ revenueCents: 0, cogsCents: 0, expenseCents: 0, grossProfitCents: 0, operatingProfitCents: 0 }, true));
});
test("unavailable, inconsistent or invalid evidence is withheld", () => {
  assert.equal(buildProfitBreakdown(profit, false), null);
  assert.equal(buildProfitBreakdown({ ...profit, grossProfitCents: 1 }, true), null);
  assert.equal(buildProfitBreakdown({ ...profit, operatingProfitCents: 1 }, true), null);
  for (const invalid of [NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(buildProfitBreakdown({ ...profit, revenueCents: invalid }, true), null);
  }
});
