import assert from "node:assert/strict";
import test from "node:test";
import { buildCommandCentre, type MetricRow } from "../server/intelligence.ts";
import { buildOperatingSystem } from "../server/operating-system.ts";
import { buildServerOwnerBriefing, type ServerOwnerBriefingInput } from "../server/owner-briefing.ts";

const now = new Date("2026-10-03T16:00:00Z");
const hours = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
  .map(day => ({ day, open: "09:00", close: "17:00", closed: false }));

function fixture(): ServerOwnerBriefingInput {
  const rows: MetricRow[] = Array.from({ length: 60 }, (_, index) => ({
    businessDate: new Date(now.getTime() - (59 - index) * 86_400_000).toISOString().slice(0, 10),
    grossSalesCents: index < 30 ? 10_000 : 9_000,
    netSalesCents: index < 30 ? 10_000 : 9_000,
    costOfGoodsCents: 5_000, transactionCount: 10, unitsSold: 10, refundsCents: 0, discountsCents: 0,
    labourCostCents: null, cashBalanceCents: -10_000, accountsPayableCents: 20_000, inventoryValueCents: null,
    sourceImportId: "fixture-import", locationRef: "permitted-location", updatedAt: new Date("2026-10-03T15:00:00Z"),
  }));
  const commandCentre = buildCommandCentre(rows, "CAD", now);
  return {
    now, timezone: "America/Edmonton", hours: JSON.stringify(hours), scopeLabel: "All locations", selectedLocation: false,
    currency: "CAD", permissions: ["dashboard.view", "insights.view", "metrics.cash", "finance.bank_balances", "finance.ap_ar", "metrics.revenue", "metrics.profit", "sales.view", "integrations.view"],
    features: ["business.brief.basic", "bookloq", "analytics.sales.basic", "pos.reporting.core", "products.margin"],
    sourceConflict: false, bankSourceIncomplete: false, expectedReportingScopes: [["permitted-location"]],
    dailyRows: rows, commandCentre, operatingSystem: buildOperatingSystem({ ...commandCentre, currency: "CAD" }),
  };
}

test("verified negative current cash is critical, while payables above cash are a dated-review prompt", () => {
  const input = fixture();
  const briefing = buildServerOwnerBriefing(input);
  assert.equal(briefing.criticalCount, 1);
  const cash = briefing.priorities.find(item => item.id === "owner:negative-cash")!;
  assert.equal(cash.severity, "critical");
  assert.equal(cash.category, "cash");
  assert.equal(cash.evidence[0].value, "-$100.00");
  assert.equal(cash.evidence[0].asOf, "2026-10-03T15:00:00.000Z");
  const payables = briefing.priorities.find(item => item.id === "owner:payables-review")!;
  assert.equal(payables.severity, "high");
  assert.equal(payables.dueDate, null);
  assert.match(payables.detail, /Due dates.*not established/);
});

test("payables exceeding positive cash do not create a critical alert or a payment deadline", () => {
  const input = fixture();
  input.dailyRows = input.dailyRows.map(row => ({ ...row, cashBalanceCents: 10_000 }));
  input.commandCentre.metrics.operating_cash.value = 10_000;
  const result = buildServerOwnerBriefing(input);
  assert.equal(result.criticalCount, 0);
  assert.equal(result.priorities.find(item => item.category === "payables")?.dueDate, null);
});

test("stale, aging, missing, syncing and conflicting sources suppress financial claims", () => {
  for (const state of ["stale", "aging", "missing", "syncing", "conflict"]) {
    const input = fixture();
    if (state === "conflict") input.sourceConflict = true;
    else if (state === "syncing") input.commandCentre.source.syncing = true;
    else input.commandCentre.source.freshness = state;
    const result = buildServerOwnerBriefing(input);
    assert.equal(result.criticalCount, 0, state);
    assert.equal(result.priorities.length, 1, state);
    assert.equal(result.priorities[0].category, "data", state);
    assert.equal(result.priorities[0].evidence[0].value, state);
    assert.doesNotMatch(JSON.stringify(result), /\$100|\$200/);
  }
});

test("incomplete comparison coverage downgrades verified financial urgency and omits trend claims", () => {
  const input = fixture();
  input.commandCentre.dataQuality.status = "limited";
  const result = buildServerOwnerBriefing(input);
  assert.equal(result.criticalCount, 0);
  assert.equal(result.priorities.find(item => item.id === "owner:negative-cash")?.severity, "high");
  assert.ok(result.priorities.some(item => item.id === "owner:history-review"));
  assert.ok(result.priorities.every(item => !item.id.startsWith("decision:")));
});

test("a missing latest balance is not filled from an older snapshot or interpreted as zero", () => {
  const input = fixture();
  input.dailyRows = input.dailyRows.map((row, index) => index === 59 ? { ...row, cashBalanceCents: null } : row);
  const result = buildServerOwnerBriefing(input);
  assert.equal(result.criticalCount, 0);
  assert.ok(result.priorities.some(item => item.id === "owner:finance-evidence"));
  assert.ok(result.priorities.every(item => !["cash", "payables"].includes(item.category)));
});

test("a location missing from the latest balance snapshot prevents a combined financial claim", () => {
  const input = fixture();
  input.dailyRows = [...input.dailyRows, { ...input.dailyRows[0], locationRef: "another-permitted-location" }];
  const result = buildServerOwnerBriefing(input);
  assert.equal(result.criticalCount, 0);
  assert.ok(result.priorities.every(item => !["cash", "payables"].includes(item.category)));
});

test("an authorized location with no records prevents an all-locations critical or trend claim", () => {
  const input = fixture();
  input.expectedReportingScopes = [["permitted-location"], ["location-with-no-records"]];
  const result = buildServerOwnerBriefing(input);
  assert.equal(result.criticalCount, 0);
  assert.equal(result.priorities.length, 1);
  assert.equal(result.priorities[0].category, "data");
  assert.match(String(result.priorities[0].evidence[0].value), /incomplete location coverage/);
});

test("unavailable, estimated, stale, nonfinite and future-dated cash evidence cannot become critical", () => {
  for (const override of [
    { value: null }, { value: Number.NaN }, { actuality: "estimate" as const }, { freshnessStatus: "stale" as const },
    { sourceRecords: 0 }, { sourceTimestamp: null }, { sourceTimestamp: "2026-10-04T15:00:00Z" },
    { sourceTimestamp: "2026-09-30T15:00:00Z" }, { currency: "USD" },
  ]) {
    const input = fixture();
    Object.assign(input.commandCentre.metrics.operating_cash, override);
    const result = buildServerOwnerBriefing(input);
    assert.equal(result.criticalCount, 0, JSON.stringify(override));
    assert.ok(result.priorities.every(item => !["cash", "payables"].includes(item.category)));
  }
});

test("verified bank cash uses its own source metadata and timestamp without requiring a daily cash value", () => {
  const input = fixture();
  input.dailyRows = input.dailyRows.map(row => ({ ...row, cashBalanceCents: null }));
  Object.assign(input.commandCentre.metrics.operating_cash, {
    calculationVersion: "plaid-cash.v1", sourceSystem: "Plaid read-only bank feed", confidenceLevel: "high",
    sourceTimestamp: "2026-10-03T15:30:00Z", periodStart: "2026-10-03", periodEnd: "2026-10-03",
  });
  const result = buildServerOwnerBriefing(input);
  assert.equal(result.criticalCount, 1);
  assert.match(result.priorities[0].evidence[0].source, /Plaid read-only bank feed/);
  assert.equal(result.priorities[0].evidence[0].asOf, "2026-10-03T15:30:00Z");
});

test("a syncing or unavailable bank connection cannot turn the remaining accounts into a critical cash claim", () => {
  const input = fixture();
  input.bankSourceIncomplete = true;
  Object.assign(input.commandCentre.metrics.operating_cash, { calculationVersion: "plaid-cash.v1", confidenceLevel: "high" });
  const result = buildServerOwnerBriefing(input);
  assert.equal(result.criticalCount, 0);
  assert.ok(result.priorities.every(item => !["cash", "payables"].includes(item.category)));
  assert.ok(result.priorities.some(item => item.id === "owner:finance-evidence"));
});

test("Free features and missing insight permission do not expose paid decision or finance priorities", () => {
  for (const restriction of ["free", "no-insights"]) {
    const input = fixture();
    if (restriction === "free") input.features = ["dashboard.core", "analytics.sales.basic", "products.margin", "reporting.basic"];
    else input.permissions = input.permissions.filter(value => value !== "insights.view");
    const result = buildServerOwnerBriefing(input);
    assert.deepEqual(result.priorities, [], restriction);
    assert.equal(result.criticalCount, 0);
  }
});

test("cash permission and BookLoQ access remain independent of otherwise authorized sales decisions", () => {
  for (const restriction of ["metrics.cash", "finance.bank_balances", "bookloq"]) {
    const input = fixture();
    input.permissions = input.permissions.filter(value => value !== restriction);
    input.features = input.features.filter(value => value !== restriction);
    const result = buildServerOwnerBriefing(input);
    assert.ok(result.priorities.every(item => !["cash", "payables"].includes(item.category)), restriction);
    assert.ok(result.priorities.some(item => item.id === "decision:sales-trend"), restriction);
  }
});

test("redacted sales and profit permissions prevent decision text or figures from being promoted", () => {
  const input = fixture();
  input.permissions = input.permissions.filter(value => !["metrics.revenue", "metrics.profit"].includes(value));
  const result = buildServerOwnerBriefing(input);
  assert.ok(result.priorities.every(item => !item.id.startsWith("decision:")));
});

test("Free source setup stays within its authorized sales destination", () => {
  const input = fixture();
  input.features = ["dashboard.core", "analytics.sales.basic"];
  input.commandCentre.ready = false;
  const result = buildServerOwnerBriefing(input);
  assert.equal(result.priorities[0].destination, "Sales");
  assert.equal(result.priorities[0].category, "data");
});

test("location schedule basis and independent reporting dates are explicit without mutating source data", () => {
  const input = fixture();
  input.selectedLocation = true;
  input.scopeLabel = "Permitted location";
  input.timezone = "America/Vancouver";
  const before = JSON.stringify(input);
  const result = buildServerOwnerBriefing(input);
  assert.equal(result.schedule.localTime, "09:00");
  assert.equal(result.scopeLabel, "Permitted location");
  assert.match(result.hoursBasis, /Organization hours.*location-specific hours are not recorded/);
  assert.deepEqual(result.reportingPeriod, { from: "2026-09-04", to: "2026-10-03" });
  assert.match(result.priorities.find(item => item.id === "decision:sales-trend")!.detail, /2026-09-04 to 2026-10-03/);
  assert.equal(JSON.stringify(input), before);
});

test("Pulse amounts come from verified metrics and label individual periods and cash snapshot time", () => {
  const input = fixture();
  Object.assign(input.commandCentre.metrics.operating_cash, {
    calculationVersion: "plaid-cash.v1", sourceSystem: "Plaid read-only bank feed", confidenceLevel: "high",
    sourceTimestamp: "2026-10-03T15:30:00Z", periodStart: "2026-10-03", periodEnd: "2026-10-03",
  });
  const result = buildServerOwnerBriefing(input);
  assert.deepEqual(result.pulseMetrics.map(metric => metric.value), ["$2,700.00", "$1,200.00", "-$100.00"]);
  assert.match(result.pulseMetrics[0].detail, /Recorded period: 2026-09-04 to 2026-10-03/);
  assert.match(result.pulseMetrics[1].detail, /Recorded period: 2026-09-04 to 2026-10-03/);
  assert.match(result.pulseMetrics[2].detail, /Snapshot: 2026-10-03.*Plaid read-only bank feed.*2026-10-03T15:30:00Z/);
  assert.doesNotMatch(result.pulseMetrics[2].detail, /2026-09-04/);
});

test("Pulse withholds all values during sync, conflicts, stale data or missing authorized locations", () => {
  for (const state of ["syncing", "conflict", "stale", "missing-location"]) {
    const input = fixture();
    if (state === "syncing") input.commandCentre.source.syncing = true;
    else if (state === "conflict") input.sourceConflict = true;
    else if (state === "stale") input.commandCentre.source.freshness = "stale";
    else input.expectedReportingScopes = [["permitted-location"], ["missing-location"]];
    const result = buildServerOwnerBriefing(input);
    assert.ok(result.pulseMetrics.every(metric => metric.value === "—"), state);
    assert.ok(result.pulseMetrics.every(metric => /Totals are withheld/.test(metric.detail)), state);
  }
});

test("Pulse Free access permits authorized sales summaries but never unlocks cash", () => {
  const input = fixture();
  input.features = ["dashboard.core", "analytics.sales.basic", "products.margin", "reporting.basic"];
  const result = buildServerOwnerBriefing(input);
  assert.equal(result.pulseMetrics[0].value, "$2,700.00");
  assert.equal(result.pulseMetrics[1].value, "$1,200.00");
  assert.equal(result.pulseMetrics[2].value, "—");
  assert.match(result.pulseMetrics[2].detail, /workspace access/);
  input.permissions = input.permissions.filter(permission => permission !== "metrics.profit");
  assert.equal(buildServerOwnerBriefing(input).pulseMetrics[1].value, "—");
  input.permissions = input.permissions.filter(permission => permission !== "metrics.revenue");
  assert.ok(buildServerOwnerBriefing(input).pulseMetrics.every(metric => metric.value === "—"));
});

test("Pulse distinguishes recorded zero from missing and rejects stale, estimated or invalid individual metrics", () => {
  const input = fixture();
  input.commandCentre.metrics.net_sales.value = 0;
  assert.equal(buildServerOwnerBriefing(input).pulseMetrics[0].value, "$0.00");
  for (const override of [
    { value: null }, { value: Number.NaN }, { value: Number.MAX_SAFE_INTEGER + 1 }, { actuality: "estimate" as const },
    { freshnessStatus: "aging" as const }, { sourceTimestamp: "2026-09-30T15:00:00Z" }, { sourceTimestamp: "2026-10-04T15:00:00Z" },
    { currency: "USD" }, { sourceRecords: 0 }, { periodStart: null },
  ]) {
    const candidate = fixture();
    Object.assign(candidate.commandCentre.metrics.net_sales, override);
    assert.equal(buildServerOwnerBriefing(candidate).pulseMetrics[0].value, "—", JSON.stringify(override));
  }
});

test("Pulse cash uses complete snapshot verification and not a carried-forward or partial-bank balance", () => {
  const input = fixture();
  input.dailyRows = input.dailyRows.map((row, index) => index === 59 ? { ...row, cashBalanceCents: null } : row);
  assert.equal(buildServerOwnerBriefing(input).pulseMetrics[2].value, "—");
  Object.assign(input.commandCentre.metrics.operating_cash, { calculationVersion: "plaid-cash.v1", confidenceLevel: "high" });
  input.bankSourceIncomplete = true;
  assert.equal(buildServerOwnerBriefing(input).pulseMetrics[2].value, "—");
});

test("Pulse explicitly labels limited history as recorded rows rather than a complete reporting period", () => {
  const input = fixture();
  input.commandCentre.dataQuality.status = "limited";
  const result = buildServerOwnerBriefing(input);
  assert.match(result.pulseMetrics[0].detail, /Recorded rows only; period coverage may be incomplete/);
  assert.match(result.pulseMetrics[1].detail, /Recorded rows only; period coverage may be incomplete/);
  assert.doesNotMatch(result.pulseMetrics[2].detail, /period coverage/);
});
