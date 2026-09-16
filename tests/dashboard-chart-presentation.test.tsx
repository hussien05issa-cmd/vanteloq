import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import FinanceChart, { financeChartDomain } from "../app/finance-chart";
import { MetricSparkline } from "../app/dashboard-charts";
import { OutflowCategoryDonut } from "../app/bookloq-dashboard-visuals";

test("cash chart axes use whole-cent 1/2/5 steps, include zero and contain signed source values", () => {
  for (const values of [[0], [1], [-1], [-303, -105], [-328060, 738610], [-9_000_000_000_000, 8_000_000_000_000], [NaN, 0, Infinity]]) {
    const original = [...values];
    const domain = financeChartDomain(values);
    assert.deepEqual(values, original);
    assert.ok(domain.max > domain.min);
    assert.ok(domain.ticks.includes(0));
    assert.ok(domain.step >= 1);
    const normalizedStep = domain.step / 10 ** Math.floor(Math.log10(domain.step));
    assert.ok([1, 2, 5].includes(normalizedStep), String(domain.step));
    for (const value of values.filter(Number.isFinite)) assert.ok(domain.min <= value && domain.max >= value);
    for (const tick of domain.ticks) assert.ok(Number.isFinite(tick));
    assert.ok(domain.ticks.length >= 2 && domain.ticks.length <= 7);
  }
  assert.equal(financeChartDomain([-303, -105]).max, 0);
  assert.equal(financeChartDomain([1]).step, 1);
});

test("cash axes label the zero baseline and one-cent intervals without hiding small amounts", () => {
  const html = renderToStaticMarkup(<FinanceChart title="Cash Movement" description="Fictional cents" currency="CAD" series={[{ label: "Net", kind: "line", color: "blue" }]} points={[
    { label: "Sep 1", detail: "September 1", values: [-1] }, { label: "Sep 2", detail: "September 2", values: [1] },
  ]}/>);
  const axes = [...html.matchAll(/<text class="finance-chart-axis"[^>]*>([^<]+)<\/text>/g)].map(match => match[1]);
  assert.ok(axes.includes("$0"));
  assert.ok(axes.includes("$0.01"));
  assert.ok(axes.includes("-$0.01"));
  assert.doesNotMatch(html, /NaN|Infinity/);
});

test("finance inspection defaults to the latest exact period with one keyboard chart target", () => {
  const html = renderToStaticMarkup(<FinanceChart title="Cash Movement" description="Fictional records" currency="CAD" series={[
    { label: "Inflows", kind: "bar", color: "mint" }, { label: "Outflows", kind: "bar", color: "coral" }, { label: "Net Movement", kind: "line", color: "blue" },
  ]} points={[
    { label: "Sep 1", detail: "September 1", values: [10050, -105, 9945] },
    { label: "Sep 2", detail: "September 2", values: [0, -303, -303] },
  ]}/>);
  assert.match(html, /<option value="1" selected="">September 2/);
  assert.equal((html.match(/<button type="button"[^>]*tabindex="0"/g) ?? []).length, 1);
  const readout = html.split('class="finance-chart-readout"')[1].split("</dl>")[0];
  assert.match(readout, /Inspect Period/);
  assert.match(readout, /\$0\.00/);
  assert.match(readout, /-\$3\.03/);
  assert.doesNotMatch(readout, /\$99\.45/);
  assert.match(html, /<caption>|scope="col"/);
});

test("non-finite and sparse finance values stay unavailable without invalid coordinates or table shifts", () => {
  const html = renderToStaticMarkup(<FinanceChart title="Cash Movement" description="Fictional records" currency="CAD" series={[
    { label: "Cash In", kind: "bar", color: "mint" }, { label: "Cash Out", kind: "bar", color: "coral" }, { label: "Net", kind: "line", color: "blue" },
  ]} points={[
    { label: "Sep 1", detail: "September 1", values: [NaN, -105, Infinity] },
    { label: "Sep 2", detail: "September 2", values: [0] },
  ]}/>);
  assert.doesNotMatch(html, /NaN|Infinity|undefined/);
  assert.match(html, /-\$1\.05/);
  assert.match(html, /\$0\.00/);
  const rows = html.split("<tbody>")[1].split("</tbody>")[0].match(/<tr>.*?<\/tr>/g) ?? [];
  assert.equal(rows.length, 2);
  for (const row of rows) assert.equal((row.match(/<td>/g) ?? []).length, 3);
  assert.equal((rows[1].match(/Not available/g) ?? []).length, 2);
});

test("an entirely unavailable finance series never becomes a zero-dollar chart", () => {
  const html = renderToStaticMarkup(<FinanceChart title="Cash Movement" description="Fictional records" currency="CAD" series={[{ label: "Net", kind: "line", color: "blue" }]} points={[{ label: "Sep", detail: "September", values: [NaN] }]}/>);
  assert.doesNotMatch(html, /<svg|<select|\$0\.00|NaN|Infinity/);
  assert.match(html, /No records are available/);
});

test("outflow segments reconcile every cent and retain exact amounts for grouped categories", () => {
  const categories = [101, 200, 300, 400, 500, 600].map((amountCents, index) => ({ name: `Category ${index + 1}`, amountCents, shareBasisPoints: 0 }));
  const before = JSON.stringify(categories);
  const html = renderToStaticMarkup(<OutflowCategoryDonut categories={categories} totalCents={2101} currency="CAD"/>);
  assert.equal(JSON.stringify(categories), before);
  assert.match(html, /Category amounts add up to \$21\.01/);
  assert.match(html, /Remaining Categories/);
  assert.match(html, /\$3\.01/);
  assert.match(html, /View All 6 Categories/);
  for (const value of ["$1.01", "$2.00", "$3.00", "$4.00", "$5.00", "$6.00"]) assert.ok(html.includes(value), value);
  const shares = [...html.matchAll(/stroke-dasharray="([\d.]+) [\d.]+"/g)].map(match => Number(match[1]));
  assert.equal(shares.length, 5);
  assert.ok(Math.abs(shares.reduce((sum, value) => sum + value, 0) - 100) < 0.00000001);
  assert.equal((html.match(/<button type="button" aria-pressed="false"/g) ?? []).length, 5);
});

test("a mismatched, zero, negative or unsafe category total never presents a misleading donut", () => {
  for (const [amountCents, totalCents] of [[100, 101], [0, 0], [-100, 100], [NaN, 100], [Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER + 1]]) {
    const html = renderToStaticMarkup(<OutflowCategoryDonut categories={[{ name: "Inventory", amountCents, shareBasisPoints: 10000 }]} totalCents={totalCents} currency="CAD"/>);
    assert.match(html, /category amounts match/);
    assert.doesNotMatch(html, /<svg|<button|NaN|Infinity/);
  }
});

test("large category totals use the expanded amount layout without dropping precision", () => {
  const html = renderToStaticMarkup(<OutflowCategoryDonut categories={[{ name: "Inventory", amountCents: 12345678901, shareBasisPoints: 10000 }]} totalCents={12345678901} currency="CAD"/>);
  assert.match(html, /has-wide-amount/);
  assert.match(html, /\$123,456,789\.01/);
});

test("sparkline fills do not bridge missing values and each gradient has a unique identifier", () => {
  const gap = renderToStaticMarkup(<MetricSparkline values={[100, NaN, -100]} tone="indigo"/>);
  assert.doesNotMatch(gap, /metric-sparkline-fill|NaN|Infinity/);
  assert.equal((gap.match(/M[\d.,-]+/g) ?? []).length, 2);
  const html = renderToStaticMarkup(<><MetricSparkline values={[10, 0, -10]} tone="indigo"/><MetricSparkline values={[10, 20, 15]} tone="emerald"/></>);
  const ids = [...html.matchAll(/<linearGradient id="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, 2);
  assert.equal(new Set(ids).size, 2);
  assert.equal((html.match(/metric-sparkline-fill/g) ?? []).length, 2);
});
