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
  const result = buildCommandCentre(rows, "CAD", new Date("2026-08-04T12:00:00Z"));
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

test("an old import cannot present an expired forecast as the current outlook", () => {
  const rows = Array.from({ length: 60 }, (_, i) => row(dateOffset("2026-08-15", i - 59), "current"));
  const result = buildCommandCentre(rows, "CAD", new Date("2026-09-10T12:00:00Z"));
  assert.equal(result.current?.days, 30);
  assert.equal(result.forecast.available, false);
  assert.equal(result.forecast.totalNetSalesCents, null);
  assert.deepEqual(result.forecast.points, []);
  assert.ok("unavailableReason" in result.forecast);
  assert.match(result.forecast.unavailableReason ?? "", /Refresh verified sales/);
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

test("partial thirty-day periods preserve recorded totals but withhold business trends", () => {
  const latest = "2026-08-03";
  const rows = Array.from({ length: 60 }, (_, i) => row(dateOffset(latest, i - 59), i >= 30 ? "current" : "previous"));
  rows.splice(5, 1);
  const result = buildCommandCentre(rows, "CAD", new Date("2026-08-04T12:00:00Z"));
  assert.equal(result.previous?.days, 29);
  assert.equal(result.current?.netSalesCents, 2_400_000);
  assert.equal(result.comparisons?.netSalesRate, null);
  assert.equal(result.periodComparisons?.thirtyDays.comparable, false);
  assert.equal(result.periodComparisons?.sevenDays.comparable, true);
  assert.deepEqual(result.insights.map(insight => insight.id), ["history-readiness"]);
  assert.equal(result.dataQuality.status, "limited");
});

test("one missing location-day cannot hide behind another location's complete dates", () => {
  const rows = Array.from({ length: 60 }, (_, i) => ["north", "south"].map(locationRef => ({
    ...row(dateOffset("2026-08-03", i - 59), i >= 30 ? "current" : "previous"), locationRef,
  }))).flat();
  const complete = buildCommandCentre(rows, "CAD");
  assert.equal(complete.periodComparisons?.thirtyDays.comparable, true);
  const missing = buildCommandCentre(rows.filter((_, i) => i !== 109), "CAD", new Date("2026-08-04T12:00:00Z"));
  assert.equal(missing.current?.days, 30);
  assert.equal(missing.periodComparisons?.thirtyDays.coverage.current.missingLocationDays, 1);
  assert.equal(missing.comparisons?.netSalesRate, null);
  assert.equal(missing.forecast.available, false);
});

test("a newly observed store with no baseline does not create an artificial growth comparison", () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({ ...row(dateOffset("2026-08-03", i - 59), "previous"), locationRef: "north" }));
  rows.push(...rows.slice(-30).map(item => ({ ...item, locationRef: "south" })));
  const result = buildCommandCentre(rows, "CAD");
  assert.equal(result.current?.netSalesCents, 6_000_000);
  assert.equal(result.periodComparisons?.thirtyDays.coverage.previous.missingLocationDays, 30);
  assert.equal(result.comparisons?.netSalesRate, null);
});

test("forecast gaps are withheld and modeled gross losses are preserved", () => {
  const latest = "2026-08-03";
  const rows = Array.from({ length: 60 }, (_, i) => ({ ...row(dateOffset(latest, i - 59), "current"), netSalesCents: 10_000, costOfGoodsCents: 20_000 }));
  const result = buildCommandCentre(rows, "CAD", new Date("2026-08-04T12:00:00Z"));
  assert.equal(result.forecast.available, true);
  assert.ok(result.forecast.points.every(point => point.grossProfitCents === -10_000));
  rows.splice(50, 1);
  assert.equal(buildCommandCentre(rows, "CAD", new Date("2026-08-04T12:00:00Z")).forecast.available, false);
});

test("margin rates use percentage points and do not turn association into causation", () => {
  const rows = Array.from({ length: 60 }, (_, i) => row(dateOffset("2026-08-03", i - 59), i >= 30 ? "current" : "previous"));
  const result = buildCommandCentre(rows, "CAD");
  const insight = result.insights.find(item => item.id === "margin-trend")!;
  assert.match(insight.title, /percentage points/);
  assert.match(insight.probableCause, /does not isolate/);
  assert.doesNotMatch(result.insights.find(item => item.id === "sales-trend")!.suggestedTask.expectedImpact, /opportunity/);
});


test("missing provider labour stays unavailable across totals, comparisons and provenance", () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({ ...row(dateOffset("2026-08-03", i - 59), "current"), sourceProvider: "lightspeed-r", labourCostCents: 0 }));
  const result = buildCommandCentre(rows, "CAD");
  assert.equal(result.current?.labourCostCents, null);
  assert.equal(result.current?.contributionCents, null);
  assert.equal(result.current?.labourRate, null);
  assert.equal(result.previous?.labourCostCents, null);
  assert.equal(result.periodComparisons?.sevenDays.current.contributionCents, null);
  for (const key of ["labour_cost", "labour_rate", "contribution_after_labour"]) {
    assert.equal(result.metrics[key].actuality, "unavailable");
    assert.equal(result.metrics[key].value, null);
  }
  assert.equal(result.insights.some(item => item.id === "labour-pressure"), false);
});

test("explicit zero labour is valid, but legacy zero and partly missing locations are unknown", () => {
  const recorded = { ...row("2026-08-03", "current"), labourCostCents: 0, labourCostReported: true, locationRef: "one" };
  const verified = buildCommandCentre([recorded], "CAD");
  assert.equal(verified.current?.labourCostCents, 0);
  assert.equal(verified.current?.contributionCents, 30000);
  assert.equal(verified.metrics.labour_cost.actuality, "actual");
  assert.equal(buildCommandCentre([{ ...recorded, labourCostReported: null }], "CAD").current?.labourCostCents, null);
  const mixed = buildCommandCentre([recorded, { ...recorded, sourceProvider: "square", locationRef: "two" }], "CAD");
  assert.equal(mixed.current?.netSalesCents, 160000);
  assert.equal(mixed.current?.labourCostCents, null);
  assert.equal(mixed.current?.contributionCents, null);
});
