import assert from "node:assert/strict";
import test from "node:test";
import { buildMetricResults } from "../server/data-trust.ts";
import { metricDefinition, metricRegistry } from "../server/metric-registry.ts";

const rows = Array.from({ length: 30 }, (_, index) => ({
  businessDate: `2026-07-${String(index + 1).padStart(2, "0")}`,
  locationRef: "main",
  sourceImportId: "import-verified-july",
  updatedAt: Date.UTC(2026, 6, index + 1, 23, 0),
}));

test("the metric registry defines the calculation and accounting contract", () => {
  const margin = metricDefinition("gross_margin");
  assert.match(margin.formula, /gross_profit \/ net_sales/);
  assert.equal(margin.calculationVersion, "2026.08.1");
  assert.ok(margin.requiredInputs.includes("net_sales"));
  assert.ok(margin.validSourceSystems.includes("verified_pos_summary"));
  assert.match(margin.refundTreatment, /canonical net-sales treatment/i);
  assert.ok(metricRegistry.every((metric) => metric.description && metric.rounding && metric.timezoneTreatment));
});

test("metric results carry reproducible source, period, freshness and confidence metadata", () => {
  const metrics = buildMetricResults({
    rows,
    currency: "CAD",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-30",
    comparisonPeriodStart: "2026-06-01",
    comparisonPeriodEnd: "2026-06-30",
    freshnessStatus: "current",
    generatedAt: "2026-07-31T00:00:00.000Z",
    values: { net_sales: 1_250_000, gross_margin: 0.425 },
  });

  assert.equal(metrics.net_sales.value, 1_250_000);
  assert.equal(metrics.net_sales.actuality, "actual");
  assert.equal(metrics.net_sales.sourceRecords, 30);
  assert.equal(metrics.net_sales.sourceAccount, "1 mapped location");
  assert.equal(metrics.net_sales.confidenceLevel, "high");
  assert.equal(metrics.net_sales.calculationVersion, "2026.08.1");
  assert.equal(metrics.gross_margin.unit, "ratio");
  assert.equal(metrics.gross_margin.currency, null);
});

test("missing inputs remain unavailable instead of becoming zero", () => {
  const metrics = buildMetricResults({
    rows: [],
    currency: "CAD",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-30",
    comparisonPeriodStart: "2026-06-01",
    comparisonPeriodEnd: "2026-06-30",
    freshnessStatus: "missing",
    generatedAt: "2026-07-31T00:00:00.000Z",
    values: { operating_cash: null },
  });

  assert.equal(metrics.operating_cash.value, null);
  assert.equal(metrics.operating_cash.actuality, "unavailable");
  assert.equal(metrics.operating_cash.confidenceLevel, "unavailable");
  assert.equal(metrics.operating_cash.periodStart, null);
});
