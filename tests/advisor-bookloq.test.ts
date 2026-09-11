import assert from "node:assert/strict";
import test from "node:test";
import { projectAdvisorBookloq } from "../domain/advisor-bookloq.ts";
import { bookloqDemo } from "../domain/bookloq-demo.ts";

test("AI BookLoQ projection strips identities, raw records and unrecognized fields", () => {
  const projected = projectAdvisorBookloq({ bookloq: { settings: { status: "active", dataMode: "live", baseCurrency: "CAD" }, ledgerAccess: { available: true }, organization: { email: "private@example.invalid" }, transactions: [{ description: "Confidential payroll" }], summary: { revenueCents: 10000, accountsPayableCents: null, bankAccount: "123456789", cashLastSyncAt: "2026-09-11T10:00:00Z", totalExpensesCents: NaN } } });
  assert.equal(projected.status, "available");
  assert.equal(projected.values?.revenueCents, 10000);
  assert.equal(projected.values?.accountsPayableCents, null);
  assert.equal(projected.values?.totalExpensesCents, null);
  assert.doesNotMatch(JSON.stringify(projected), /private@|Confidential|123456789|"transactions":|bankAccount/);
});
test("demonstration and inactive ledgers cannot be presented as live AI evidence", () => {
  for (const settings of [{ status: "active", dataMode: "demonstration" }, { status: "suspended", dataMode: "live" }]) {
    const projected = projectAdvisorBookloq({ bookloq: { settings, summary: { revenueCents: 999999 } } });
    assert.equal(projected.status, "unavailable");
    assert.doesNotMatch(JSON.stringify(projected), /999999/);
  }
});
test("BookLoQ demo reserves known bills, separates expected receipts and blocks absent cash", () => {
  const baseline = bookloqDemo(600000, false, false), delayed = bookloqDemo(600000, true, false);
  assert.equal(Math.min(...baseline.weeks.map(week => week.conservativeClosingCashCents!)), 1200000);
  assert.deepEqual(baseline.weeks.map(week => week.conservativeClosingCashCents), delayed.weeks.map(week => week.conservativeClosingCashCents));
  assert.notDeepEqual(baseline.weeks.map(week => week.planningClosingCashCents), delayed.weeks.map(week => week.planningClosingCashCents));
  assert.equal(Math.min(...bookloqDemo(1000000, false, false).weeks.map(week => week.conservativeClosingCashCents!)), 800000);
  assert.ok(bookloqDemo(600000, false, true).weeks.every(week => week.conservativeClosingCashCents === null && week.planningClosingCashCents === null));
});
