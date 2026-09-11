import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BusinessTrendChart, IntradaySalesChart, MetricSparkline, CashPositionRing } from "../app/dashboard-charts";
import ResourceGuideVisual from "../app/resource-guide-visual";
import { Metric } from "../app/vanteloq-app";
import { DataTable, FinancialKpi } from "../app/bookloq-workspace";
import WorkspaceIcon from "../app/workspace-icon";
import { chartDomain, chartY, comparisonCopy, quantityLabel, sourceDateFreshness } from "../domain/workspace-presentation";

test("invalid future timestamps never masquerade as current source evidence", () => {
  const now = Date.parse("2026-09-07T12:00:00Z");
  assert.equal(sourceDateFreshness(now * 1000, 31, "No source date", now).freshness, "Source timestamp requires review");
  assert.equal(sourceDateFreshness(now * 1000, 31, "No source date", now).status, "missing");
  assert.equal(sourceDateFreshness(NaN, 31, "No source date", now).status, "missing");
  assert.equal(sourceDateFreshness(null, 31, "No source date", now).freshness, "No source date");
  assert.equal(sourceDateFreshness(now, 31, "No source date", now).freshness, "Current through 2026-09-07");
  assert.equal(sourceDateFreshness(now - 40 * 86_400_000, 31, "No source date", now).status, "stale");
});

test("signed chart values stay within the plotted range, including all-negative series", () => {
  for (const values of [[-300, 100, 900], [-600, -100], [0], [15], [NaN, -25, Infinity]]) {
    const domain = chartDomain(values);
    assert.ok(domain.min <= 0 && domain.max >= 0 && domain.max > domain.min);
    for (const value of values.filter(Number.isFinite)) {
      assert.ok(chartY(value, 184, domain) >= 0);
      assert.ok(chartY(value, 184, domain) <= 184);
    }
  }
});
test("missing comparisons are neutral and quantities use correct grammar", () => {
  assert.equal(comparisonCopy(null, "last week"), "Comparison unavailable");
  assert.equal(comparisonCopy(NaN, "last week"), "Comparison unavailable");
  assert.equal(comparisonCopy(0, "last week"), "0% vs last week");
  assert.equal(quantityLabel(1, "line item"), "1 line item");
  assert.equal(quantityLabel(2, "line item"), "2 line items");
});
test("empty daily charts show guidance, not a fictitious zero-dollar graph", () => {
  const html = renderToStaticMarkup(<BusinessTrendChart currency="CAD" data={[]}/>);
  assert.match(html, /No verified daily records/);
  assert.doesNotMatch(html, /\$0|trend-gridline|chart-hit-zone/);
});
test("chart inspection preserves cents, losses, missing profit and table semantics", () => {
  const html = renderToStaticMarkup(<BusinessTrendChart currency="CAD" data={[
    { date: "2026-09-01", netSalesCents: 12345, grossProfitCents: null, transactionCount: 1 },
    { date: "2026-09-02", netSalesCents: -5025, grossProfitCents: -6010, transactionCount: 2 },
  ]}/>);
  assert.match(html, /\$123\.45/);
  assert.match(html, /-\$50\.25/);
  assert.match(html, /-\$60\.10/);
  assert.match(html, /Not available/);
  assert.match(html, /<select/);
  assert.match(html, /<caption/);
  assert.match(html, /scope="col"/);
  assert.doesNotMatch(html, /NaN|Infinity|role="button"/);
});
test("a single record is visibly plotted and keyboard-inspectable", () => {
  const html = renderToStaticMarkup(<BusinessTrendChart currency="CAD" data={[{ date: "2026-09-01", netSalesCents: 0, grossProfitCents: 0 }]}/>);
  assert.match(html, /cx="318"/);
  assert.match(html, /<select/);
  assert.match(html, /\$0\.00/);
});
test("zero-net intraday activity is not mistaken for an empty day", () => {
  const html = renderToStaticMarkup(<IntradaySalesChart currency="CAD" data={[
    { hour: 8, label: "8 a.m.", netSalesCents: 1000, grossProfitCents: 400, transactionCount: 1 },
    { hour: 9, label: "9 a.m.", netSalesCents: -1000, grossProfitCents: -400, transactionCount: 1 },
  ]}/>);
  assert.doesNotMatch(html, /No completed sales/);
  assert.match(html, /-\$10\.00/);
});
test("refund-only activity remains visible and genuinely empty hours have guidance", () => {
  assert.doesNotMatch(renderToStaticMarkup(<IntradaySalesChart currency="CAD" data={[{ hour: 9, label: "9 a.m.", netSalesCents: -1000, grossProfitCents: -400, transactionCount: 1 }]}/>), /No completed sales/);
  assert.match(renderToStaticMarkup(<IntradaySalesChart currency="CAD" data={[]}/>), /No completed sales received today/);
});
test("sparklines tolerate unavailable data without invalid SVG geometry", () => {
  const html = renderToStaticMarkup(<MetricSparkline tone="indigo" values={[30, NaN, -10]}/>);
  assert.doesNotMatch(html, /NaN|Infinity/);
  assert.equal(renderToStaticMarkup(<MetricSparkline tone="indigo" values={[]}/>), "");
});
test("metric unavailable states never receive a positive comparison treatment", () => {
  const html = renderToStaticMarkup(<Metric label="Gross profit" value="Not available" delta="+12% vs last week" detail="Verified costs required"/>);
  assert.match(html, /metric-unavailable/);
  assert.doesNotMatch(html, /metric-context positive|metric-accent/);
  assert.match(renderToStaticMarkup(<FinancialKpi label="Bank cash" value="Not available" note="Connect a bank source"/>), /bookloq-value-unavailable/);
});
test("financial records preserve table roles and original values", () => {
  const html = renderToStaticMarkup(<DataTable headings={["Invoice", "Balance"]} rows={[["INV-7", "$129.42"]]}/>);
  assert.match(html, /role="table"/);
  assert.match(html, /role="columnheader"/);
  assert.match(html, /role="cell"/);
  assert.match(html, /INV-7/);
  assert.match(html, /\$129\.42/);
});
test("functional navigation icons are decorative, not duplicate spoken labels", () => {
  for (const name of ["Dashboard", "Inventory", "Payroll", "Sales Tax", "Settings"]) {
    const html = renderToStaticMarkup(<WorkspaceIcon name={name}/>);
    assert.match(html, /aria-hidden="true"/);
    assert.match(html, /focusable="false"/);
  }
});

test("intraday comparison shares an exact-value table and exposes both chart modes", () => {
  const rows = [{ hour: 10, label: "10 a.m.", netSalesCents: 12345, grossProfitCents: 2345, transactionCount: 2 }];
  const html = renderToStaticMarkup(<IntradaySalesChart data={rows} comparison={[{ ...rows[0], netSalesCents: 10000 }]} comparisonDate="2026-08-31" asOf="2026-09-07T18:30:00Z" timeZone="America/Edmonton" currency="CAD"/>);
  assert.match(html, /Aug 31 net sales/);
  assert.match(html, /trend-comparison-line/);
  assert.match(html, /\$100\.00/);
  assert.match(html, /aria-pressed="true">Hourly/);
  assert.match(html, /Running total/);
  assert.match(html, /same local time/);
  assert.match(html, /12:30/);
});
test("cash shortfalls are signed and never presented as an uncommitted spending balance", () => {
  const html = renderToStaticMarkup(<CashPositionRing cashCents={100000} payableCents={125050} currency="CAD"/>);
  assert.match(html, /-\$250\.50/);
  assert.match(html, /is-shortfall/);
  assert.match(html, /Other obligations/);
  assert.doesNotMatch(html, /Uncommitted/);
  assert.match(renderToStaticMarkup(<CashPositionRing cashCents={-5025} payableCents={0} currency="CAD"/>), /-\$50\.25/);
  assert.match(renderToStaticMarkup(<CashPositionRing cashCents={100} payableCents={null} currency="CAD"/>), /Not available/);
  assert.doesNotMatch(renderToStaticMarkup(<CashPositionRing cashCents={NaN} payableCents={Infinity} currency="CAD"/>), /NaN|Infinity/);
});
test("guide labels occupy a separate heading, without floating chart abbreviations", () => {
  const html = renderToStaticMarkup(<ResourceGuideVisual category="finance" slug="how-to-calculate-gross-margin-small-business"/>);
  assert.match(html, /guide-visual-heading/);
  assert.match(html, /Net sales/);
  assert.match(html, /Product cost/);
  assert.match(html, /Gross profit/);
  assert.doesNotMatch(html, />%<|>SKU<|>VIEW</);
});
