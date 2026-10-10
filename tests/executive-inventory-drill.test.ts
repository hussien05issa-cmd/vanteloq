import assert from "node:assert/strict";
import test from "node:test";
import { executivePeriod } from "../domain/executive-metrics.ts";
import { buildMetricResults } from "../server/data-trust.ts";
import { buildExecutiveReport } from "../server/executive-report.ts";

const period = executivePeriod(new URLSearchParams("period=today"), "2026-10-09");
function source(inventory: number | null) {
  return {
    metrics: buildMetricResults({ rows: [{ businessDate: period.to, sourceImportId: "fixture-import", updatedAt: "2026-10-09T12:00:00Z" }], currency: "CAD", periodStart: period.from, periodEnd: period.to, comparisonPeriodStart: period.comparisonFrom, comparisonPeriodEnd: period.comparisonTo, freshnessStatus: "current", values: { inventory_value: inventory, net_sales: 50000 } }),
    previous: null, insights: [],
    trend: [{ date: period.to, netSalesCents: 50000, grossProfitCents: null, transactionCount: 4, averageTransactionCents: 12500, unitsSold: 4, inventoryValueCents: inventory }],
  };
}

test("commerce inventory opens Inventory while sales retain Sales and the selected evidence period", () => {
  const report = buildExecutiveReport(period, source(12345), null, null, "commerce");
  const inventory = report.metrics.find(metric => metric.key === "inventory_value")!;
  assert.equal(inventory.drill, "Inventory");
  assert.equal(inventory.value, 12345);
  assert.deepEqual(inventory.trend, [{ date: period.to, value: 12345 }]);
  assert.equal(report.metrics.find(metric => metric.key === "net_revenue")?.drill, "Sales");
  assert.deepEqual(report.period, period);
});

test("missing and zero commerce inventory keep their meaning when routed to Inventory", () => {
  for (const value of [null, 0]) {
    const inventory = buildExecutiveReport(period, source(value), null, null, "commerce").metrics.find(metric => metric.key === "inventory_value")!;
    assert.equal(inventory.drill, "Inventory");
    assert.equal(inventory.value, value);
    assert.deepEqual(inventory.trend, value === null ? [] : [{ date: period.to, value: 0 }]);
  }
});

test("ledger inventory continues to open BookLoQ and never substitutes commerce stock values", () => {
  const inventory = buildExecutiveReport(period, source(12345), null, "No posted ledger", "ledger").metrics.find(metric => metric.key === "inventory_value")!;
  assert.equal(inventory.drill, "BookLoQ");
  assert.equal(inventory.value, null);
  assert.equal(inventory.source, "BookLoQ posted ledger");
});
