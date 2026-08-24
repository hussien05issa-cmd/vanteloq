import assert from "node:assert/strict";
import test from "node:test";
import { buildCommandCentre, measureEventImpact, type MetricRow } from "../server/intelligence.ts";
import { businessEventCreateInput } from "../server/validation.ts";

function dateOffset(iso: string, days: number) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function row(date: string, period: "previous" | "current"): MetricRow {
  const current = period === "current";
  return {
    businessDate: date,
    grossSalesCents: current ? 90_000 : 105_000,
    netSalesCents: current ? 80_000 : 100_000,
    costOfGoodsCents: 50_000,
    transactionCount: current ? 80 : 100,
    unitsSold: current ? 110 : 140,
    refundsCents: current ? 2_000 : 1_000,
    discountsCents: current ? 10_000 : 5_000,
    labourCostCents: current ? 20_000 : 15_000,
    inventoryValueCents: 2_000_000,
    cashBalanceCents: 1_200_000,
    accountsPayableCents: 700_000,
  };
}

test("empty workspaces never receive invented metrics or insights", () => {
  const result = buildCommandCentre([], "CAD");
  assert.equal(result.ready, false);
  assert.equal(result.current, null);
  assert.equal(result.periodComparisons, null);
  assert.equal(result.forecast.available, false);
  assert.equal(result.forecast.totalNetSalesCents, null);
  assert.deepEqual(result.insights, []);
  assert.equal(result.dataQuality.status, "blocked");
});

test("the engine detects supported sales, margin and labour exceptions", () => {
  const latest = "2026-08-03";
  const rows: MetricRow[] = [];
  for (let offset = -59; offset <= 0; offset++) rows.push(row(dateOffset(latest, offset), offset >= -29 ? "current" : "previous"));
  const result = buildCommandCentre(rows, "CAD");
  assert.equal(result.ready, true);
  assert.equal(result.current?.days, 30);
  assert.equal(result.previous?.days, 30);
  assert.ok(result.insights.some(insight => insight.id === "sales-trend" && insight.severity === "attention"));
  assert.ok(result.insights.some(insight => insight.id === "margin-trend" && insight.missingInformation.includes("SKU-level cost changes")));
  assert.ok(result.insights.every(insight => insight.evidence.length > 0 && insight.suggestedTask.title.length > 0));
  assert.equal(result.source.verifiedDays, 60);
  assert.equal(result.forecast?.available, true);
  assert.equal(result.forecast?.points.length, 7);
  assert.equal(result.periodComparisons?.sevenDays.comparable, true);
});

test("multiple locations on one business date count as one verified day", () => {
  const rows = [
    { ...row("2026-08-01", "current"), locationRef: "lightspeed-r:1" },
    { ...row("2026-08-01", "current"), locationRef: "lightspeed-r:2" },
    { ...row("2026-08-02", "current"), locationRef: "lightspeed-r:1" },
  ];
  const result = buildCommandCentre(rows, "CAD");
  assert.equal(result.source.rowCount, 3);
  assert.equal(result.source.verifiedDays, 2);
  assert.equal(result.current?.days, 2);
  assert.equal(result.current?.netSalesCents, 240_000);
  assert.equal(result.forecast?.available, false);
});

test("business memory requires enough verified days on both sides", () => {
  const eventDate = "2026-07-15";
  const incomplete = [row("2026-07-14", "previous"), row("2026-07-15", "current")];
  assert.equal(measureEventImpact(incomplete, eventDate).measurable, false);
  const complete: MetricRow[] = [];
  for (let offset = -14; offset <= 13; offset++) complete.push(row(dateOffset(eventDate, offset), offset >= 0 ? "current" : "previous"));
  const measured = measureEventImpact(complete, eventDate);
  assert.equal(measured.measurable, true);
  if (measured.measurable) assert.ok((measured.changeRate ?? 0) < 0);
});

test("business memory counts distinct dates rather than location rows", () => {
  const eventDate = "2026-07-15";
  const rows: MetricRow[] = [];
  for (let offset = -4; offset <= 3; offset++) {
    rows.push({ ...row(dateOffset(eventDate, offset), offset >= 0 ? "current" : "previous"), locationRef: "north" });
    rows.push({ ...row(dateOffset(eventDate, offset), offset >= 0 ? "current" : "previous"), locationRef: "south" });
  }

  assert.equal(measureEventImpact(rows, eventDate).measurable, false);
});

test("business events reject impossible calendar dates and existing bad rows fail safely", () => {
  assert.throws(() => businessEventCreateInput({
    eventType: "decision",
    title: "Invalid date",
    detail: "Regression test",
    eventDate: "2026-13-01",
    expectedOutcome: "None",
    reviewDate: "",
  }), (error: unknown) => (
    error instanceof Error
    && "code" in error
    && error.code === "INVALID_FIELD"
  ));
  const result = measureEventImpact([], "2026-13-01");
  assert.equal(result.measurable, false);
  assert.match(result.reason ?? "", /invalid/i);
});
