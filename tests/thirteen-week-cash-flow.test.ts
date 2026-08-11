import assert from "node:assert/strict";
import test from "node:test";
import { buildThirteenWeekCashFlow } from "../domain/thirteen-week-cash-flow.ts";

test("13-week cash flow separates actual, confirmed, and expected movements", () => {
  const result = buildThirteenWeekCashFlow({
    asOf: "2026-08-11",
    openingCashCents: 500_000,
    safetyThresholdCents: 150_000,
    actualTransactions: [
      { postingDate: "2026-08-10", amountCents: -20_000 },
      { postingDate: "2026-08-11", amountCents: 75_000 },
      { postingDate: "2026-08-12", amountCents: 999_000 },
    ],
    forecastItems: [
      { id: "bill-1", dueDate: "2026-08-13", amountCents: 100_000, direction: "out", certainty: "confirmed", label: "Supplier bill" },
      { id: "overdue-1", dueDate: "2026-08-01", amountCents: 20_000, direction: "out", certainty: "confirmed", label: "Overdue supplier bill" },
      { id: "invoice-1", dueDate: "2026-08-14", amountCents: 60_000, direction: "in", certainty: "expected", label: "Customer invoice" },
      { id: "po-1", dueDate: "2026-08-20", amountCents: 80_000, direction: "out", certainty: "confirmed", label: "Approved purchase order" },
    ],
  });

  assert.equal(result.status, "available");
  assert.equal(result.weeks.length, 13);
  assert.equal(result.weeks[0].weekStart, "2026-08-10");
  assert.equal(result.weeks[0].actualNetCents, 55_000);
  assert.equal(result.weeks[0].confirmedNetCents, -120_000);
  assert.equal(result.weeks[0].overdueItemCount, 1);
  assert.equal(result.weeks[0].expectedNetCents, 60_000);
  assert.equal(result.weeks[0].conservativeClosingCashCents, 380_000);
  assert.equal(result.weeks[0].planningClosingCashCents, 440_000);
  assert.equal(result.weeks[1].confirmedNetCents, -80_000);
  assert.equal(result.purchasingCapacityCents, 150_000);
});

test("cash flow fails closed without a verified opening cash balance", () => {
  const result = buildThirteenWeekCashFlow({
    asOf: "2026-08-11",
    openingCashCents: null,
    safetyThresholdCents: 100_000,
    actualTransactions: [],
    forecastItems: [],
  });
  assert.equal(result.status, "unavailable");
  assert.equal(result.purchasingCapacityCents, null);
  assert.ok(result.weeks.every((week) => week.conservativeClosingCashCents === null));
});

test("foreign-currency and undated commitments block purchasing capacity", () => {
  const result = buildThirteenWeekCashFlow({
    asOf: "2026-08-11",
    openingCashCents: 500_000,
    safetyThresholdCents: 100_000,
    actualTransactions: [],
    forecastItems: [
      { id: "bill-1", dueDate: "2026-08-20", amountCents: 120_000, direction: "out", certainty: "confirmed", label: "Supplier bill" },
    ],
    excludedCurrencyItemCount: 1,
    undatedCommittedItemCount: 1,
    decisionBlocks: ["foreign_currency_obligations", "undated_purchase_commitments"],
  });

  assert.equal(result.status, "needs_review");
  assert.equal(result.capacityStatus, "currency_review_required");
  assert.equal(result.purchasingCapacityCents, null);
  assert.equal(result.observedOpeningCashCents, 500_000);
  assert.equal(result.openingCashCents, 500_000);
  assert.equal(result.weeks[1].conservativeClosingCashCents, 380_000);
});

test("an undated commitment preserves the verified forecast while withholding only decision capacity", () => {
  const result = buildThirteenWeekCashFlow({
    asOf: "2026-08-11",
    openingCashCents: 500_000,
    safetyThresholdCents: 100_000,
    actualTransactions: [],
    forecastItems: [],
    undatedCommittedItemCount: 1,
    decisionBlocks: ["undated_purchase_commitments"],
  });

  assert.equal(result.status, "needs_review");
  assert.equal(result.capacityStatus, "commitment_date_required");
  assert.equal(result.purchasingCapacityCents, null);
  assert.equal(result.openingCashCents, 500_000);
  assert.ok(result.weeks.every((week) => week.conservativeClosingCashCents === 500_000));
});
