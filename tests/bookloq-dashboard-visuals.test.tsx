import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import BookloqDashboardVisuals from "../app/bookloq-dashboard-visuals";
import type { BookLoQData } from "../app/bookloq-workspace";
import { buildBusinessCashSummary } from "../domain/bookloq-cash-management";

function fixture({ empty = false, restricted = false, exports = false, demonstration = false, zero = false } = {}) {
  const rows = empty ? [] : zero ? [{ postingDate: "2026-09-16", amountCents: 0, category: "Reviewed", categorized: true, matched: true }] : [
    { postingDate: "2026-09-16", amountCents: 30_000, category: "Deposits", categorized: true, matched: true },
    { postingDate: "2026-09-15", amountCents: -50_000, category: "Inventory", categorized: true, matched: false },
    { postingDate: "2026-09-14", amountCents: -10_000, category: "Uncategorized", categorized: false, matched: false },
  ];
  return {
    transactionAccess: { available: !restricted, reason: restricted ? "permissions" : null },
    settings: demonstration ? { baseCurrency: "CAD", dataMode: "demonstration" } : null,
    organization: { name: "Fictional Test", currency: "CAD" },
    permissions: exports ? ["export_data"] : [],
    cashActivity: { days30: buildBusinessCashSummary(rows, "2026-09-16", 30), days90: buildBusinessCashSummary(rows, "2026-09-16", 90), months12: buildBusinessCashSummary(rows, "2026-09-16", 365) },
  } as BookLoQData;
}
const render = (data: BookLoQData) => renderToStaticMarkup(<BookloqDashboardVisuals data={data} onReview={() => {}}/>);

test("dashboard cash observations retain exact amounts, period, signs and evidence boundaries", () => {
  const html = render(fixture());
  for (const text of ["2026-08-18 to 2026-09-16", "$300.00", "$600.00", "-$300.00", "Inventory", "$500.00", "83.3%", "66.7%", "33.3%", "3 recorded transactions", "Review Transactions", "not profit", "Pending records and other currencies are excluded"]) assert.ok(html.includes(text), text);
  assert.match(html, /aria-pressed="true">30 Days/);
  assert.match(html, /aria-pressed="false">90 Days/);
  assert.match(html, /View data table/);
  assert.doesNotMatch(html, /Export chart CSV|Current Bank Balance|Revenue grew|NaN|Infinity/);
});

test("missing activity stays unavailable while recorded zero remains real", () => {
  const empty = render(fixture({ empty: true }));
  assert.match(empty, /No eligible bank activity is available/);
  assert.match(empty, /Not available/);
  assert.doesNotMatch(empty, /\$0\.00|Review Coverage|<svg/);
  const zero = render(fixture({ zero: true }));
  assert.match(zero, /\$0\.00/);
  assert.match(zero, /1 recorded transaction/);
  assert.match(zero, /No Recorded Outflows/);
  assert.doesNotMatch(zero, /No eligible bank activity is available/);
});

test("cash data and exports respect access even when fixture payload contains numbers", () => {
  const restricted = render(fixture({ restricted: true, exports: true }));
  assert.match(restricted, /Your role does not include access to cash activity/);
  assert.doesNotMatch(restricted, /\$300\.00|\$500\.00|Export chart CSV|Review Transactions/);
  assert.match(render(fixture({ exports: true })), /Export chart CSV/);
  assert.match(render(fixture({ demonstration: true })), /Fictional example records/);
});
