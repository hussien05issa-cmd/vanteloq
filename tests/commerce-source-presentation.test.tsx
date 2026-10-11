import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CommerceReportCoverage, formatCommerceSourceTimestamp } from "../app/commerce-intelligence-workspace";

test("source-local commerce times remain business wall times across device time zones and DST", () => {
  const previous = process.env.TZ;
  try {
    for (const deviceZone of ["UTC", "America/Denver", "Asia/Tokyo"]) {
      process.env.TZ = deviceZone;
      const local = formatCommerceSourceTimestamp("2026-11-01T01:30:00", "America/Edmonton");
      assert.match(local, /Nov 1, 2026.*1:30 a\.m\./);
      assert.match(local, /America\/Edmonton \(source local time\)$/);
      assert.equal(formatCommerceSourceTimestamp("2026-11-01 01:30:00", "America/Edmonton"), local);
      assert.match(formatCommerceSourceTimestamp("2026-03-08T02:30:00", "America/Edmonton"), /2:30 a\.m\..*source local time/,
        "Do not invent an instant for an offset-free provider time at a DST transition");
      assert.match(formatCommerceSourceTimestamp("2026-10-02T00:15:00Z", "America/Edmonton"), /Oct 1, 2026.*6:15 p\.m\..*America\/Edmonton$/);
      assert.match(formatCommerceSourceTimestamp("2026-10-02T00:15:00Z", "Asia/Tokyo"), /Oct 2, 2026.*9:15 a\.m\..*Asia\/Tokyo$/);
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test("unavailable and malformed source times do not crash commerce tables", () => {
  assert.equal(formatCommerceSourceTimestamp(null, "America/Edmonton"), "Not supplied");
  for (const value of ["not-a-date", "2026-02-30T10:00:00", "2026-10-02T24:00:00", "2026-10-02T10:60:00", "2026-10-02"]) {
    assert.equal(formatCommerceSourceTimestamp(value, "America/Edmonton"), "Time unavailable", value);
  }
  assert.equal(formatCommerceSourceTimestamp("2026-10-02T00:15:00Z", "invalid/timezone"), "Time unavailable");
});

test("report coverage preserves supplied limits and does not certify provider completeness", () => {
  const displayedEvidence = { saleLines: false, inventory: true, customers: true, suppliers: true, products: true };
  const warning = "The transaction preview shows the newest 1,000 lines. Aggregated product totals use all stored matching lines.";
  const complete = renderToStaticMarkup(<CommerceReportCoverage readiness={{ databaseViewComplete: true, displayedEvidence, limitations: [warning] }} />);
  assert.match(complete, /Aggregated values include the matching stored records/);
  assert.match(complete, /Provider completeness and reconciliation are not certified/);
  assert.ok(complete.includes(warning));
  const limited = renderToStaticMarkup(<CommerceReportCoverage readiness={{ databaseViewComplete: false, displayedEvidence, limitations: ["Stock is a dated current snapshot."] }} />);
  assert.match(limited, /limited preview/);
  assert.match(limited, /Narrow the dates or location/);
  assert.match(limited, /Stock is a dated current snapshot/);
});
