import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { businessDateForTimestamp } from "../domain/intraday-sales";
import { businessDayStart, businessTimestampRange, businessTimestampExtrema, businessDatesFromExtrema } from "../domain/business-period";
import { buildLightspeedRDailyMetrics } from "../server/integrations/lightspeed-r";

test("a Square evening sale belongs to the local day, not the next UTC day", () => {
  assert.equal(businessDateForTimestamp("2026-08-15T01:55:00Z", "America/Edmonton"), "2026-08-14");
  assert.equal(businessDateForTimestamp("2026-08-14T19:55:00-06:00", "America/Edmonton"), "2026-08-14");
  assert.equal(businessDateForTimestamp("2026-08-14T19:55:00", "America/Edmonton"), "2026-08-14");
  assert.equal(businessDateForTimestamp("invalid", "America/Edmonton"), null);
});

test("business-day windows follow daylight saving and fractional offsets", () => {
  const duration = (a: string, b: string) => Date.parse(businessDayStart(b, "America/Edmonton")) - Date.parse(businessDayStart(a, "America/Edmonton"));
  assert.equal(duration("2026-03-08", "2026-03-09"), 23 * 3600000);
  assert.equal(duration("2026-11-01", "2026-11-02"), 25 * 3600000);
  assert.equal(businessDayStart("2026-08-14", "Asia/Kathmandu"), "2026-08-13T18:15:00.000Z");
  assert.throws(() => businessDayStart("2026-02-30", "UTC"));
});

test("SQL sales, tender and cost windows agree for UTC, offset and local timestamps", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE records(id INTEGER, sold_at TEXT, cents INTEGER)");
    const insert = db.prepare("INSERT INTO records VALUES (?,?,?)");
    insert.run(1, "2026-08-15T01:55:00Z", 100);
    insert.run(2, "2026-08-14T19:55:00-06:00", 200);
    insert.run(3, "2026-08-14T19:55:00", 300);
    insert.run(4, "2026-08-14T05:59:59Z", 400);
    insert.run(5, "2026-08-15T06:00:00Z", 500);
    const window = businessTimestampRange("sold_at", "2026-08-14", "2026-08-14", "America/Edmonton");
    assert.deepEqual(db.prepare(`SELECT id FROM records WHERE ${window.sql} ORDER BY id`).all(...window.bindings).map(row=>row.id), [1,2,3]);
    assert.equal(db.prepare(`SELECT SUM(cents) total FROM records WHERE ${window.sql}`).get(...window.bindings)?.total, 600);
    const lower = businessTimestampRange("sold_at", "2026-08-14", null, "America/Edmonton");
    assert.deepEqual(db.prepare(`SELECT id FROM records WHERE ${lower.sql} ORDER BY id`).all(...lower.bindings).map(row=>row.id), [1,2,3,5]);
    const extrema = db.prepare(`SELECT ${businessTimestampExtrema("sold_at")} FROM records`).get();
    assert.deepEqual(businessDatesFromExtrema(extrema!, "America/Edmonton"), { earliestDate: "2026-08-13", latestDate: "2026-08-15" });
    assert.throws(() => businessTimestampRange("sold_at); DROP TABLE records", "2026-08-14", "2026-08-14", "UTC"));
  } finally { db.close(); }
});

test("R-Series groups offset and local evidence into the same business-day total", () => {
  const base = { outletRef: "shop", state: "completed", totalCents: 10500, taxCents: 500, costCents: 6000, discountCents: 0, lineCount: 1 };
  const metrics = buildLightspeedRDailyMetrics([
    { ...base, externalSaleId: "a", soldAt: "2026-08-15T01:00:00Z" },
    { ...base, externalSaleId: "b", soldAt: "2026-08-14T19:00:00" },
  ], "America/Edmonton");
  assert.equal(metrics.length, 1);
  assert.equal(metrics[0].businessDate, "2026-08-14");
  assert.equal(metrics[0].netSalesCents, 20000);
});
