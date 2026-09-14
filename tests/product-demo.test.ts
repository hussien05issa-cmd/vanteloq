import assert from "node:assert/strict";
import test from "node:test";
import { retailDemo } from "../domain/retail-demo";
import { demoAnalysis, demoRecords, demoScenario } from "../domain/product-demo";

test("sample totals reconcile across shops and use the production KPI definitions", () => {
  const all = demoAnalysis("all", "complete").kpis;
  assert.equal(all.current?.netSalesCents, 2_459_361);
  assert.equal(all.current?.transactions, 420);
  assert.equal(all.current?.grossProfitCents, 1_233_021); // Daily summaries aggregate the exact receipt-line cents.
  const retail = retailDemo();
  assert.equal(all.current!.netSalesCents, retail.current.netCents);
  assert.equal(all.current!.grossProfitCents, retail.current.grossProfitCents);
  assert.equal(all.current!.transactions, retail.current.purchaseBaskets);
  assert.equal(all.current!.start, retail.period.from);
  assert.equal(all.current!.end, retail.period.to);
  assert.equal(all.previous!.netSalesCents, retail.prior.netCents);
  assert.equal(all.comparisonComplete, true);
  assert.equal(all.netProfitCents, null);
  const central = demoAnalysis("central", "complete").kpis.current!;
  const riverside = demoAnalysis("riverside", "complete").kpis.current!;
  assert.notEqual(central.netSalesCents, riverside.netSalesCents);
  assert.equal(central.netSalesCents! + riverside.netSalesCents!, all.current.netSalesCents);
  assert.equal(central.transactions! + riverside.transactions!, all.current.transactions);
});

test("a missing cost blocks profit and scenarios for every location choice", () => {
  for (const location of ["all", "central", "riverside"] as const) {
    const full = demoAnalysis(location, "complete").kpis.current!;
    const limited = demoAnalysis(location, "missing-cost").kpis.current!;
    assert.equal(limited.netSalesCents, full.netSalesCents);
    assert.equal(limited.grossProfitCents, null);
    assert.equal(limited.grossMarginPercent, null);
    assert.equal(demoScenario(limited.netSalesCents!, limited.grossProfitCents, 5, 0), null);
  }
});

test("missing comparison days do not become zero sales or a growth claim", () => {
  const complete = demoAnalysis("all", "complete").kpis;
  const limited = demoAnalysis("all", "missing-days").kpis;
  assert.deepEqual(limited.current, complete.current);
  assert.equal(limited.previous?.observedDays, 21);
  assert.equal(limited.comparisonComplete, false);
  assert.equal(limited.salesChangePercent, null);
});

test("scenario arithmetic preserves actual records and handles adverse assumptions", () => {
  const records = demoRecords();
  const baseline = structuredClone(records);
  assert.deepEqual(demoScenario(10000, 4000, 5, 10), { salesCents: 10500, costCents: 6600, profitCents: 3900, marginPercent: 3900 / 10500 * 100, profitChangeCents: -100 });
  assert.equal(demoScenario(10000, 1000, -20, 30)?.profitCents, -3700);
  assert.equal(demoScenario(10000, 4000, 0, 0)?.profitChangeCents, 0);
  assert.equal(demoScenario(10000, 4000, NaN, 0), null);
  assert.equal(demoScenario(10000, 4000, 21, 0), null);
  assert.deepEqual(records, baseline);
});
