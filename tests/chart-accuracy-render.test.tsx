import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BusinessTrendChart } from "../app/dashboard-charts";
import { MarketingReportVisual } from "../app/marketing-reporting";
import { SearchVisibilityChart, MeasurementTrend } from "../app/growth-workspace";
import type { MarketingReport } from "../domain/marketing-reporting";

test("Period Trend does not draw a sales line or area through a missing calendar interval", () => {
  const html = renderToStaticMarkup(<BusinessTrendChart currency="CAD" data={[
    { date: "2026-08-01", netSalesCents: 10001, grossProfitCents: 5000 },
    { date: "2026-08-02", netSalesCents: -5999, grossProfitCents: null },
    { date: "2026-08-10", netSalesCents: 42000, grossProfitCents: 12000 },
  ]}/>);
  const sales = html.match(/<path d="([^"]*)" class="trend-sales-line"/)?.[1] ?? "";
  assert.equal((sales.match(/M/g) ?? []).length, 2);
  assert.equal((sales.match(/L/g) ?? []).length, 1);
  const fillPaths = [...html.matchAll(/<path d="([^"]*)" fill="url\([^)]*\)"/g)].map(match => match[1]);
  assert.equal(fillPaths.length, 1);
  assert.equal((fillPaths[0].match(/M/g) ?? []).length, 1);
  assert.match(html, /-\$59\.99/);
  assert.equal((html.match(/<option value=/g) ?? []).length, 3);
});

test("marketing categories render negative amounts to the left of zero, not as invisible zero bars", () => {
  const report: MarketingReport = {
    dataset: "google_analytics", view: "channels", period: { start: "2026-09-01", end: "2026-09-17" }, previousPeriod: null,
    columns: [{ key: "revenue", label: "Revenue", unit: "currency" }], rows: [{ label: "Returns", values: { revenue: -50 } }, { label: "Sales", values: { revenue: 150 } }],
    totals: {}, previous: null, currency: "CAD", timeZone: "America/Toronto", fetchedAt: "2026-09-17T00:00:00Z", warnings: [], limitations: [], truncated: false,
  };
  const html = renderToStaticMarkup(<MarketingReportVisual report={report}/>);
  assert.match(html, /class="is-negative" style="left:0%;width:25%"/);
  assert.match(html, /left:25%;width:75%/);
  assert.match(html, /-\$50\.00/);
  assert.match(html, /mr-chart-unit">CAD/);
});

test("search rank chart has numeric scale labels and keeps lower-is-better meaning", () => {
  const html = renderToStaticMarkup(<SearchVisibilityChart rows={[
    { query: "fictional supplements", observedDate: "2026-09-01", position: 4, sourceSystem: "owner" },
    { query: "fictional supplements", observedDate: "2026-09-02", position: 8, sourceSystem: "owner" },
  ]}/>);
  const ticks = [...html.matchAll(/<text class="growth-axis-label"[^>]*>([^<]+)<\/text>/g)].map(match => match[1]);
  assert.deepEqual(ticks, ["4", "5", "6", "7", "8"]);
  assert.match(html, /Lower is better/);
});

test("measurement scale has numeric labels and gaps without adding source records", () => {
  const rows: Parameters<typeof MeasurementTrend>[0]["rows"] = [
    { provider: "google", dataset: "google_analytics", selectionId: "fixture", scopeKind: "organization", localLocationId: null, metricDate: "2026-09-01", resourceName: "Fixture", metrics: { analytics_sessions: 25 } },
    { provider: "google", dataset: "google_analytics", selectionId: "fixture", scopeKind: "organization", localLocationId: null, metricDate: "2026-09-03", resourceName: "Fixture", metrics: { analytics_sessions: 50 } },
  ];
  const html = renderToStaticMarkup(<MeasurementTrend rows={rows} metric="analytics_sessions" labelText="Website sessions"/>);
  assert.ok((html.match(/class="growth-axis-label"/g) ?? []).length >= 2);
  const path = html.match(/<path d="([^"]*)"/)?.[1] ?? "";
  assert.equal((path.match(/M/g) ?? []).length, 2);
  assert.equal((path.match(/ L/g) ?? []).length, 0);
  assert.match(html, /Website sessions/);
  assert.doesNotMatch(html, /NaN|Infinity/);
});
