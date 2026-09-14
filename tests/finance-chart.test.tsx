import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import FinanceChart from "../app/finance-chart";
import CashForecastChart from "../app/cash-forecast-chart";
import { bookloqDemo } from "../domain/bookloq-demo";
import { buildBusinessCashSummary } from "../domain/bookloq-cash-management";

test("cash timeline exactly partitions leap-year intervals and includes both boundary days", () => {
  for (const days of [30, 90, 365]) {
    const end = "2024-03-01";
    const rows = Array.from({ length: days }, (_, index) => ({
      postingDate: new Date(Date.parse(`${end}T00:00:00Z`) - index * 86400000).toISOString().slice(0, 10),
      amountCents: index % 2 ? -105 : 307, category: "Fixture", categorized: true, matched: false,
    }));
    const summary = buildBusinessCashSummary(rows, end, days);
    assert.equal(summary.timeline[0].startDate, summary.startDate);
    assert.equal(summary.timeline.at(-1)?.endDate, end);
    assert.equal(summary.timeline.reduce((sum, bucket) => sum + bucket.transactionCount, 0), days);
    assert.equal(summary.timeline.reduce((sum, bucket) => sum + bucket.inflowCents, 0), summary.inflowCents);
    assert.equal(summary.timeline.reduce((sum, bucket) => sum + bucket.outflowCents, 0), summary.outflowCents);
  }
});

test("aggregated source rows preserve weighted review coverage", () => {
  const summary = buildBusinessCashSummary([
    { postingDate: "2026-09-14", amountCents: 1001, recordCount: 1001, category: "Reviewed", categorized: true, matched: true },
    { postingDate: "2026-09-14", amountCents: -400, recordCount: 1, category: "Uncategorized", categorized: false, matched: false },
  ], "2026-09-14", 30);
  assert.equal(summary.transactionCount, 1002);
  assert.equal(summary.categorizedBasisPoints, Math.round(1001 * 10000 / 1002));
});

test("cash reporting rejects unsafe totals and keeps a one-day window valid", () => {
  const row = { postingDate: "2026-09-14", amountCents: Number.MAX_SAFE_INTEGER, category: "Fixture", categorized: true, matched: true };
  assert.throws(() => buildBusinessCashSummary([row, { ...row, amountCents: 1 }], row.postingDate, 30), /precision/);
  const day = buildBusinessCashSummary([{ ...row, amountCents: 100 }], row.postingDate, 1);
  assert.equal(day.timeline.length, 1);
  assert.equal(day.timeline[0].startDate, day.timeline[0].endDate);
});

test("financial chart keeps negative, zero and unknown values distinct in accessible evidence", () => {
  const html = renderToStaticMarkup(<FinanceChart title="Cash Movement" description="Fixture" currency="CAD" points={[
    { label: "Sep 14", detail: "2026-09-14", values: [-105, 0, null] },
  ]} series={[
    { label: "Outflow", kind: "bar", color: "coral" }, { label: "Net", kind: "line", color: "blue" }, { label: "Missing", kind: "line", color: "violet" },
  ]}/>);
  assert.match(html, /-\$1\.05/);
  assert.match(html, /Not available/);
  assert.match(html, /<caption>/);
  assert.match(html, /scope="col"/);
  assert.doesNotMatch(html, /Export chart CSV/);
  assert.doesNotMatch(html, /NaN|Infinity/);
});

test("forecast stays labelled and withholds the chart when opening bank evidence is missing", () => {
  const available = renderToStaticMarkup(<CashForecastChart flow={bookloqDemo(600000, false, false)} currency="CAD"/>);
  assert.match(available, /stroke-dasharray="5 7"/);
  assert.match(available, /Projected values, not recorded cash/);
  const unavailable = renderToStaticMarkup(<CashForecastChart flow={bookloqDemo(600000, false, true)} currency="CAD"/>);
  assert.match(unavailable, /Connect a verified cash source/);
  assert.doesNotMatch(unavailable, /<svg/);
});
