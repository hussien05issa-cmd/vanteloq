import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { isAwaitingSalesRecords, businessClock, businessDateOffset, cumulativeSalesHours, salesDay, sameWeekdayComparison, salesChange, type TimestampedSale } from "../domain/intraday-sales";

test("an absent feed differs from verified zero-dollar sales and refund-only activity", () => {
  const empty = { sourceGranularity: "intraday" as const, lastSaleAt: null, transactionCount: 0, refundsCents: 0 };
  assert.equal(isAwaitingSalesRecords(empty), true);
  assert.equal(isAwaitingSalesRecords({ ...empty, transactionCount: 1 }), false);
  assert.equal(isAwaitingSalesRecords({ ...empty, refundsCents: 100 }), false);
  assert.equal(isAwaitingSalesRecords({ ...empty, lastSaleAt: "2026-09-11T10:00:00" }), false);
  assert.equal(isAwaitingSalesRecords({ ...empty, sourceGranularity: "daily" }), false);
  assert.equal(isAwaitingSalesRecords({ ...empty, transactionCount: null }), false);
});

const zone = "America/Edmonton";
const asOf = new Date("2026-09-07T18:30:00Z");
function sale(overrides: Partial<TimestampedSale> = {}): TimestampedSale {
  return { externalSaleId: crypto.randomUUID(), connectionId: "a", outletRef: "shop", soldAt: "2026-09-07T10:00:00", state: "completed", totalCents: 10500, taxCents: 500, costCents: 6000, costVerified: true, discountCents: 0, lineCount: 2, ...overrides };
}
test("money is calculated in cents, excludes tax and preserves exact basket rounding", () => {
  const day = salesDay([sale(), sale({ totalCents: 5250, taxCents: 250, costCents: 2000 })], zone, asOf);
  assert.equal(day.netSalesCents, 15000);
  assert.equal(day.grossProfitCents, 7000);
  assert.equal(day.averageTransactionCents, 7500);
  assert.equal(day.transactionCount, 2);
  assert.equal(day.hourly.length, 13);
  assert.equal(day.hourly[10].netSalesCents, day.netSalesCents);
});
test("refunds reverse revenue and cost without inflating completed-sale counts", () => {
  const day = salesDay([sale(), sale({ totalCents: -2100, taxCents: -100, costCents: 1200 })], zone, asOf);
  assert.equal(day.netSalesCents, 8000);
  assert.equal(day.grossProfitCents, 3200);
  assert.equal(day.refundsCents, 2000);
  assert.equal(day.transactionCount, 1);
  assert.equal(day.averageTransactionCents, 8000);
});
test("loss-making transactions remain negative and unknown cost never becomes profit", () => {
  assert.equal(salesDay([sale({ costCents: 12000 })], zone, asOf).grossProfitCents, -2000);
  const day = salesDay([sale({ costVerified: false, costCents: 0 }), sale({ soldAt: "2026-09-07T11:00:00" })], zone, asOf);
  assert.equal(day.grossProfitCents, null);
  assert.equal(day.hourly[10].grossProfitCents, null);
  assert.equal(day.hourly[11].grossProfitCents, 4000);
  assert.equal(day.missingCostRecords, 1);
});
test("future transactions, voids, malformed dates and unparseable money cannot enter totals", () => {
  const day = salesDay([sale({ soldAt: "2026-09-07T12:31:00" }), sale({ soldAt: "2026-09-07T18:31:00Z" }), sale({ state: "voided" }), sale({ soldAt: "not-a-date" }), sale({ soldAt: "2026-02-30T10:00:00" }), sale({ totalCents: NaN })], zone, asOf);
  assert.equal(day.netSalesCents, 0);
  assert.equal(day.transactionCount, 0);
  assert.equal(day.averageTransactionCents, null);
  assert.equal(day.hourly.at(-1)?.hour, 12);
});
test("the organization's date takes precedence over the UTC date", () => {
  const now = new Date("2026-09-08T02:00:00Z");
  assert.equal(businessClock(now, zone)?.date, "2026-09-07");
  assert.equal(salesDay([sale({ soldAt: "2026-09-08T01:00:00Z" })], zone, now).netSalesCents, 10000);
  assert.equal(businessDateOffset("2026-01-03", -7), "2025-12-27");
});
test("mixed local and offset timestamps use local chronology for the latest sale", () => {
  const day = salesDay([sale({ soldAt: "2026-09-07T16:00:00Z" }), sale({ soldAt: "2026-09-07T11:00:00" })], zone, asOf);
  assert.equal(day.lastSaleAt, "2026-09-07T11:00:00");
});
test("same weekday comparisons stop at the same minute, not the end of last week", () => {
  const comparison = sameWeekdayComparison([sale(), sale({ soldAt: "2026-08-31T10:00:00", totalCents: 5250, taxCents: 250, costCents: 2000 }), sale({ soldAt: "2026-08-31T12:31:00", totalCents: 99999 })], zone, asOf, ["a"]);
  assert.ok(comparison);
  assert.equal(comparison.baselineDate, "2026-08-31");
  assert.equal(comparison.baseline.netSalesCents, 5000);
  assert.equal(comparison.changes.netSalesRate, 1);
  assert.equal(comparison.basis, "same_weekday_same_time");
  assert.equal(comparison.baseline.hourly.length, 13);
});
test("missing history from any contributing account withholds the comparison", () => {
  const input = [sale(), sale({ soldAt: "2026-08-31T10:00:00" })];
  assert.equal(sameWeekdayComparison(input, zone, asOf, ["a", "b"]), null);
  assert.equal(sameWeekdayComparison([sale()], zone, asOf, ["a"]), null);
  assert.equal(sameWeekdayComparison(input, zone, asOf, []), null);
});
test("a zero or unknown baseline never produces infinite percentage growth", () => {
  assert.equal(salesChange(100, 0), null);
  assert.equal(salesChange(100, null), null);
  assert.equal(salesChange(Infinity, 100), null);
  assert.equal(salesChange(-50, -100), .5);
});
test("running totals reconcile to daily totals and preserve unknown cumulative profit", () => {
  const hourly = salesDay([sale({ soldAt: "2026-09-07T09:00:00" }), sale({ soldAt: "2026-09-07T10:00:00", costVerified: false }), sale({ soldAt: "2026-09-07T11:00:00" })], zone, asOf).hourly;
  const result = cumulativeSalesHours(hourly);
  assert.equal(result.at(-1)?.netSalesCents, 30000);
  assert.equal(result[9].grossProfitCents, 4000);
  assert.equal(result[10].grossProfitCents, null);
  assert.equal(result[11].grossProfitCents, null);
  assert.equal(result[11].transactionCount, 3);
  assert.equal(hourly[11].netSalesCents, 10000);
});
test("DST repeated hours count past instants but never include future instants", () => {
  const cutoff = new Date("2026-11-01T08:30:00Z");
  const records = [sale({ soldAt: "2026-11-01T07:50:00Z" }), sale({ soldAt: "2026-11-01T08:20:00Z" }), sale({ soldAt: "2026-11-01T08:45:00Z" })];
  assert.equal(salesDay(records, zone, cutoff).transactionCount, 2);
  assert.equal(salesDay(records, zone, cutoff).lastSaleAt, "2026-11-01T08:20:00Z");
  assert.equal(salesDay([...records].reverse(), zone, cutoff).lastSaleAt, "2026-11-01T08:20:00Z");
  assert.equal(sameWeekdayComparison(records, zone, cutoff, ["a"]), null);
});
test("staging SQL selects the latest version, isolates tenants and does not revive moved records", () => {
  const route = readFileSync("app/api/v1/command-centre/route.ts", "utf8");
  const sql = route.match(/const staged = rSeriesCurrent \? await getD1\(\)\.prepare\(`([\s\S]*?)`\)/)?.[1].replace("${rSeriesPlaceholders}", "?");
  assert.ok(sql);
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE integration_staged_sales (id TEXT, organization_id TEXT, provider TEXT, connection_id TEXT, external_sale_id TEXT, outlet_ref TEXT, sold_at TEXT, state TEXT, total_cents INTEGER, tax_cents INTEGER, cost_cents INTEGER, discount_cents INTEGER, line_count INTEGER, staged_at INTEGER)");
    const insert = db.prepare("INSERT INTO integration_staged_sales VALUES (?, ?, 'lightspeed-r', ?, ?, 'shop', ?, ?, ?, 0, 1, 0, 1, ?)");
    insert.run("1", "owner", "a", "sale-1", "2026-09-07T10:00:00", "completed", 100, 1);
    insert.run("2", "owner", "a", "sale-1", "2026-09-07T10:00:00", "completed", 200, 2);
    insert.run("3", "other-tenant", "a", "sale-1", "2026-09-07T10:00:00", "completed", 999, 3);
    insert.run("4", "owner", "b", "sale-1", "2026-09-07T10:00:00", "completed", 999, 3);
    insert.run("5", "owner", "a", "moved", "2026-09-07T10:00:00", "completed", 999, 1);
    insert.run("6", "owner", "a", "moved", "2026-01-01T10:00:00", "completed", 999, 2);
    insert.run("7", "owner", "a", "void", "2026-09-07T10:00:00", "completed", 999, 1);
    insert.run("8", "owner", "a", "void", "2026-09-07T10:00:00", "voided", 999, 2);
    const rows = db.prepare(sql).all("owner", "lightspeed-r", "a", "2026-08-30");
    assert.equal(rows.length, 2);
    assert.equal(rows.find((row) => row.externalSaleId === "sale-1")?.totalCents, 200);
    assert.equal(rows.find((row) => row.externalSaleId === "void")?.state, "voided");
    assert.ok(route.includes("LIMIT 20001") && route.includes("!intradayTruncated"));
    assert.ok(route.includes("selectedCommerceLocationKeys.has(`${sale.connectionId}\\u0000${sale.outletRef}`)"));
    assert.match(route, /for \(const hour of commandCentre.todayComparison.baseline.hourly\) hour.grossProfitCents = null/);
  } finally { db.close(); }
});
