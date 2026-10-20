import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import BookloqAdvertisingSpendPanel from "../app/bookloq-advertising-spend";
import { buildBookloqAdvertisingSpend } from "../domain/bookloq-advertising-spend";

const nowSeconds = Date.parse("2026-10-09T12:00:00Z") / 1000;
const spend = buildBookloqAdvertisingSpend({
  baseCurrency: "CAD", period: { start: "2026-10-01", end: "2026-10-09" }, nowSeconds, budgets: [],
  rows: [
    { selectionId: "fixture-cad", accountRef: "act_123456", accountName: "Fictional Canadian ads", scopeKind: "organization", locationId: null, metricDate: "2026-10-08", amountMinor: 18475, currency: "CAD", reportingTimezone: "America/Edmonton", updatedAt: nowSeconds, lastSyncedAt: nowSeconds },
    { selectionId: "fixture-usd", accountRef: "act_987654", accountName: "Fictional US ads", scopeKind: "organization", locationId: null, metricDate: "2026-10-08", amountMinor: 6250, currency: "USD", reportingTimezone: "America/New_York", updatedAt: nowSeconds, lastSyncedAt: nowSeconds },
  ],
});

test("restricted and absent advertising evidence never exposes account details", () => {
  assert.equal(renderToStaticMarkup(<BookloqAdvertisingSpendPanel context="expenses" />), "");
  assert.equal(renderToStaticMarkup(<BookloqAdvertisingSpendPanel context="expenses" spend={{ ...spend, status: "restricted" }} />), "");
});

test("source spend keeps its currency and review boundary in every financial context", () => {
  for (const context of ["expenses", "budget", "cash", "reports"] as const) {
    const html = renderToStaticMarkup(<BookloqAdvertisingSpendPanel context={context} spend={spend} />);
    assert.match(html, /CAD\s*184\.75/);
    assert.match(html, /USD\s*62\.50/);
    assert.match(html, /Ready to compare/);
    assert.match(html, /Needs review/);
    assert.match(html, /UTC/);
    assert.match(html, /not another expense/);
    assert.match(html, /not automatically an asset or cash movement/);
    assert.doesNotMatch(html, /<form|<button|Source verified/);
  }
});
