import assert from "node:assert/strict";
import test from "node:test";
import { calculateCashFlowIntelligence } from "../domain/cash-flow-intelligence.ts";
import { forecastCash } from "../server/bookloq.ts";
import { budgetControl, bookloqReportHeadings } from "../domain/bookloq-budget.ts";

test("outstanding overdue bills stay in cash forecasts and reduce spendable capacity", () => {
  const items = [
    { id: "bill", label: "Overdue bill", dueDate: "2026-08-30", amountCents: 40_000, direction: "out" as const, certainty: "confirmed" as const },
    { id: "invoice", label: "Expected receipt", dueDate: "2026-09-20", amountCents: 20_000, direction: "in" as const, certainty: "probable" as const },
  ];
  const result = calculateCashFlowIntelligence({ openingCashCents: 100_000, safetyThresholdCents: 10_000, asOf: "2026-09-16", items });
  assert.equal(result.liquidity30Cents, 100_000 - 40_000 + 20_000);
  assert.equal(result.purchasingCapacityCents, 100_000 - 10_000 - 40_000);
  assert.equal(forecastCash(100_000, items, "2026-09-16")[1].closingCashCents, 80_000);
});

test("daily cash risk is independent of row order and excludes beyond-horizon movements", () => {
  const items = [
    { id: "out", label: "Payment", dueDate: "2026-09-20", amountCents: 120_000, direction: "out" as const, certainty: "confirmed" as const },
    { id: "in", label: "Receipt", dueDate: "2026-09-20", amountCents: 100_000, direction: "in" as const, certainty: "probable" as const },
    { id: "future", label: "Outside horizon", dueDate: "2027-01-01", amountCents: 900_000, direction: "out" as const, certainty: "confirmed" as const },
  ];
  const input = { openingCashCents: 100_000, safetyThresholdCents: 10_000, asOf: "2026-09-16" };
  const forward = calculateCashFlowIntelligence({ ...input, items });
  const reverse = calculateCashFlowIntelligence({ ...input, items: [...items].reverse() });
  assert.equal(forward.minimumCashCents, 80_000);
  assert.equal(forward.minimumCashCents, reverse.minimumCashCents);
  assert.equal(forward.risk, "low");
});

test("supplier warning reserves other confirmed obligations due today", () => {
  const result = calculateCashFlowIntelligence({ openingCashCents: 100_000, safetyThresholdCents: 10_000, asOf: "2026-09-16", items: [
    { id: "supplier", label: "supplier", dueDate: "2026-09-16", amountCents: 80_000, direction: "out", certainty: "confirmed", category: "supplier" },
    { id: "payroll", label: "payroll", dueDate: "2026-09-16", amountCents: 30_000, direction: "out", certainty: "confirmed", category: "payroll" },
  ] });
  assert.equal(result.minimumCashCents, -10_000);
  assert.match(result.warning ?? "", /before payroll/);
});

test("budget comparisons use scoped actuals, preserve missingness and distinguish revenue", () => {
  const budget = { budgetCents: 50_000, actualCents: 20_000, committedCents: 0, forecastCents: 0, accountType: "expense" };
  assert.equal(budgetControl(budget).variance, 30_000);
  assert.equal(budgetControl({ ...budget, accountType: "revenue" }).variance, -30_000);
  assert.equal(budgetControl({ ...budget, actualCents: undefined }).variance, null);
  assert.equal(budgetControl({ ...budget, budgetCents: 0 }).utilization, null);
  assert.deepEqual(bookloqReportHeadings("trial"), ["Code", "Account", "Debits", "Credits"]);
});
