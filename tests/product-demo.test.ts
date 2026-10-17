import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { retailDemo, retailDemoInput } from "../domain/retail-demo";
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

test("fictional daily visits vary while exact weekly totals and whole receipts remain intact", () => {
  const input = retailDemoInput(), analysis = demoAnalysis("all", "complete");
  const current = input.lines.filter(line => line.soldAt.slice(0, 10) >= input.period.from);
  assert.deepEqual(analysis.weeks.map(week => week.salesCents), [615_183, 627_746, 601_249, 615_183]);
  assert.equal(current.reduce((sum, line) => sum + line.netCents, 0), 2_459_361);
  assert.equal(new Set(current.map(line => line.saleId)).size, 420);
  assert.equal(current.filter(line => line.soldAt.startsWith("2026-05")).reduce((sum, line) => sum + line.netCents, 0), 263_454);
  assert.equal(current.filter(line => line.soldAt.startsWith("2026-06")).reduce((sum, line) => sum + line.netCents, 0), 2_195_907);
  for (const outlet of ["central", "riverside"]) {
    const dailyRows = analysis.currentRows.filter(row => row.locationRef === outlet);
    assert.equal(dailyRows.length, 28);
    assert.ok(new Set(dailyRows.map(row => row.transactions)).size > 3, "visits exceed the old three-day cycle");
    assert.ok(new Set(dailyRows.map(row => row.netSalesCents)).size > 3, "receipt-derived sales have varied daily totals");
  }
  const receiptTimes = new Map<string, string>();
  for (const line of current) {
    const existing = receiptTimes.get(line.saleId);
    if (existing) assert.equal(line.soldAt, existing, "all lines of a receipt keep the same timestamp");
    receiptTimes.set(line.saleId, line.soldAt);
    assert.ok(Number.isFinite(Date.parse(line.soldAt)), "receipt timestamps remain valid");
    assert.ok(line.soldAt.slice(11, 13) >= "10" && line.soldAt.slice(11, 13) <= "18", "visits fall within fictional opening hours");
    const originalDay = Number(line.saleId.split("-")[1]) - 28;
    const allocatedDay = (Date.parse(line.soldAt.slice(0, 10)) - Date.parse(input.period.from)) / 86_400_000;
    assert.equal(Math.floor(allocatedDay / 7), Math.floor(originalDay / 7), "receipts remain in their original seven-day bucket");
  }
});

test("fictional date allocation preserves all receipt contents and the entire prior period", () => {
  const input = retailDemoInput();
  const current = input.lines.filter(line => line.soldAt.slice(0, 10) >= input.period.from);
  const prior = input.lines.filter(line => line.soldAt.slice(0, 10) < input.period.from);
  const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  // Fingerprints captured before changing the current-period dates.
  assert.equal(fingerprint(current.map(line => {
    const preserved = { ...line };
    delete (preserved as Partial<typeof preserved>).soldAt;
    return preserved;
  })), "4a34df8cc5752ea3bd7cf35e2dcb1593353d4787a2aca6ac64c9c8c4d9341716");
  assert.equal(fingerprint(prior), "f8a0d6c1da25bb77ff0f8993a219e03d4aa1113f83c1f6dc5853253d0cb23acc");
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
