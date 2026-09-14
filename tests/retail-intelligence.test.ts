import assert from "node:assert/strict";
import test from "node:test";
import { buildRetailIntelligence, revenueBridge, retailKey, type RetailLine, type RetailMeasurement } from "../domain/retail-intelligence.ts";
import { parseCommercePeriod } from "../domain/commerce-intelligence.ts";
import { parseMeasurementCsv, measurementTemplates } from "../domain/retail-measurements.ts";
import { projectAdvisorRetail } from "../domain/advisor-retail.ts";
import { retailDemo } from "../domain/retail-demo.ts";

const period = parseCommercePeriod("2026-09-11", "2026-09-11"), now = Date.parse("2026-09-11T18:00:00Z");
const line = (sale: string, product: string, changes: Partial<RetailLine> = {}): RetailLine => ({
  provider: "pos", connectionId: "a", saleId: sale, lineId: product, productRef: product, sku: product, name: product, category: product === "A" ? "Protein" : "Performance", itemType: "Powder",
  customerRef: null, outletRef: "one", soldAt: "2026-09-11T11:00:00", quantityMilli: 1000, netCents: 1000, discountCents: 0, costCents: 400, ...changes,
});
const analyze = (lines: RetailLine[], extra: Partial<Parameters<typeof buildRetailIntelligence>[0]> = {}) => buildRetailIntelligence({ lines, period, timeZone: "America/Edmonton", asOfDate: period.to, now, ...extra });
test("receipt and product identities include provider and connection; duplicates do not inflate totals", () => {
  const a = line("1", "A"), b = line("1", "A", { connectionId: "b", netCents: 2000 });
  const result = analyze([a, a, b]);
  assert.equal(result.current.netCents, 3000); assert.equal(result.current.purchaseBaskets, 2); assert.equal(result.products.length, 2);
  assert.throws(() => analyze([a, { ...a, netCents: 9 }]), /Conflicting/);
});
test("revenue bridge reconciles fractional averages and return effects to the cent", () => {
  for (let n = 1; n < 100; n++) {
    const current = { purchaseBaskets: n, purchaseNetCents: n * 1234 + 3, adjustmentsCents: -777 };
    const prior = { purchaseBaskets: 101 - n, purchaseNetCents: (101 - n) * 1381 + 7, adjustmentsCents: -321 };
    const result = revenueBridge(current, prior)!;
    assert.equal(result.reduce((v, row) => v + row.impactCents, 0), current.purchaseNetCents + current.adjustmentsCents - prior.purchaseNetCents - prior.adjustmentsCents);
  }
  assert.equal(revenueBridge({ purchaseBaskets: 0, purchaseNetCents: 0, adjustmentsCents: 0 }, { purchaseBaskets: 1, purchaseNetCents: 100, adjustmentsCents: 0 }), null);
});
test("basket support, confidence and lift use complete receipts within each account", () => {
  const rows = [1, 2, 3].flatMap(sale => [line(String(sale), "A"), line(String(sale), "B")]);
  rows.push(line("4", "A"), line("5", "B"), line("6", "C"), ...Array.from({ length: 20 }, (_, i) => line("foreign" + i, "A", { connectionId: "b" })));
  const result = analyze(rows), pair = result.baskets.products.pairs.find(p => p.aName === "A" && p.bName === "B")!;
  assert.equal(pair.count, 3); assert.equal(pair.baskets, 6); assert.equal(pair.support, .5); assert.equal(pair.confidence, .75); assert.equal(pair.lift, 1.125);
  assert.equal(result.current.itemsPerBasket, 29 / 26);
});
test("return-only receipts are separate from purchase baskets and fully returned items leave pairs", () => {
  const rows = [1, 2, 3].flatMap(sale => [line(String(sale), "A"), line(String(sale), "B")]);
  rows.push(line("1", "B", { lineId: "returnB", quantityMilli: -1000, netCents: -1000, costCents: -400 }));
  rows.push(line("refund", "A", { quantityMilli: -1000, netCents: -1000, costCents: -400 }));
  const result = analyze(rows);
  assert.equal(result.current.purchaseBaskets, 3); assert.equal(result.current.netCents, 4000); assert.equal(result.current.adjustmentsCents, -2000);
  assert.equal(result.current.grossProfitCents, 2400); assert.equal(result.baskets.products.pairs.length, 0);
});
test("fractional quantities and missing costs preserve their meaning", () => {
  const result = analyze([line("1", "A", { quantityMilli: 1250, costCents: null }), line("2", "B", { quantityMilli: 500 })]);
  assert.equal(result.current.units, 1.75); assert.equal(result.current.itemsPerBasket, .875); assert.equal(result.current.grossProfitCents, null);
  assert.equal(result.products.find(p => p.name === "A")!.marginRate, null); assert.equal(result.current.costCoverage, .5);
  assert.equal(result.baskets.sizeBands.reduce((v, row) => v + row.baskets, 0), 2);
  assert.equal(result.products[0].score, null);
});
test("repeat activity excludes guests, mismatched identities and cross-account identity collisions", () => {
  const result = analyze([line("1", "A", { customerRef: "private-customer" }), line("2", "A", { customerRef: "private-customer" }),
    line("3", "A"), line("4", "A"), line("5", "A", { customerRef: "private-customer", connectionId: "b" })]);
  assert.equal(result.customers.identifiedBuyers, 2); assert.equal(result.customers.repeatBuyers, 1); assert.equal(result.customers.repeatPurchaseRate, .5);
  assert.equal(result.customers.identityCoverage, .6); assert.equal(result.products.find(p => p.connectionId === "a")!.repeatPurchaseRate, 1);
  assert.doesNotMatch(JSON.stringify(projectAdvisorRetail(result)), /private-customer|connectionId|customerRef|saleId|lineId|productRef/);
});
test("unmatched sources or an absent baseline cannot produce a growth assertion", () => {
  const noBaseline = analyze([line("1", "A")]); assert.equal(noBaseline.comparison.growthRate, null); assert.equal(noBaseline.bridge, null);
  const otherSource = analyze([line("1", "A"), line("1", "A", { soldAt: "2026-09-10T11:00:00", connectionId: "b" })]);
  assert.equal(otherSource.comparison.comparable, false); assert.equal(otherSource.products[0].growthRate, null);
  const empty = analyze([]); assert.equal(empty.current.grossProfitCents, null); assert.equal(empty.current.averageBasketCents, null);
});
test("local hours and dates handle naive provider times, offsets and DST", () => {
  const result = analyze([line("1", "A", { soldAt: "2026-09-12T05:30:00Z" }), line("2", "A", { soldAt: "2026-09-11T23:30:00" }), line("3", "A", { soldAt: "2026-09-12T06:00:00Z" })]);
  assert.equal(result.current.netCents, 2000); assert.equal(result.hours[23].purchaseBaskets, 2); assert.equal(result.hours[0].netCents, null);
  const dst = analyze([line("1", "A", { soldAt: "2026-03-08T08:30:00Z" }), line("2", "A", { soldAt: "2026-03-08T09:30:00Z" })], { period: parseCommercePeriod("2026-03-08", "2026-03-08") });
  assert.equal(dst.hours[1].netCents, 1000); assert.equal(dst.hours[3].netCents, 1000); assert.equal(dst.hours[2].netCents, null);
});
test("inventory uses the exact outlet, period cost basis and explicit replenishment assumptions", () => {
  const stock = [{ key: "one", name: "A", sku: "A", provider: "pos", connectionId: "a", outletRef: "one", onHand: 20, reorderPoint: 3, updatedAt: now }];
  const measurements: RetailMeasurement[] = [{ kind: "stock", provider: "pos", connectionId: "a", outletRef: "one", reference: "A", from: period.from, to: period.to, source: "Verified ledger", values: { openingUnits: 10, receivedUnits: 5, openingValueCents: 1000, closingValueCents: 600 } }];
  const result = analyze([line("1", "A", { quantityMilli: 2000, costCents: 400 }), line("2", "A", { quantityMilli: 50000, outletRef: "two" })], { stock, measurements });
  assert.equal(result.inventory[0].dailyVelocity, 2); assert.equal(result.inventory[0].daysOfCover, 10); assert.equal(result.inventory[0].turnover, .5); assert.equal(result.inventory[0].daysOnHand, 2); assert.equal(result.inventory[0].sellThrough, 2 / 15);
  assert.equal(result.inventory[0].reorderUnits, 22);
  const stale = analyze([line("1", "A")], { stock: stock.map(s => ({ ...s, updatedAt: now - 72 * 3600_000 })) });
  assert.equal(stale.inventory[0].daysOfCover, null); assert.equal(stale.inventory[0].reorderUnits, null); assert.equal(stale.inventory[0].turnover, null);
});
test("labour efficiency needs complete hours and avoids double counting a location with two feeds", () => {
  const measurements: RetailMeasurement[] = [{ kind: "labour", provider: "pos", connectionId: "a", outletRef: "one", reference: "location", from: period.from, to: period.to, source: "Timesheet", values: { paidMinutes: 120, wagesCents: 4800, complete: true } }];
  assert.equal(analyze([line("1", "A", { netCents: 10000 })], { measurements }).operations.salesPerLabourHourCents, 5000);
  const rows = [line("1", "A", { netCents: 10000 }), line("1", "A", { connectionId: "b", netCents: 20000 })];
  assert.equal(analyze(rows, { measurements }).operations.salesPerLabourHourCents, null);
  measurements[0].values.outletKeys = JSON.stringify([retailKey("pos", "a", "one"), retailKey("pos", "b", "one")]);
  const complete = analyze(rows, { measurements }); assert.equal(complete.operations.paidHours, 2); assert.equal(complete.operations.salesPerLabourHourCents, 15000); assert.equal(complete.operations.averagePaidRateCents, 2400);
});
test("loyalty unknowns are not invented non-members and enrollment dates determine cohorts", () => {
  const measurements: RetailMeasurement[] = [{ kind: "loyalty", provider: "pos", connectionId: "a", outletRef: "", reference: "c", from: "", to: "", source: "Enrollment log", values: { memberSince: "2026-09-01" } }];
  const result = analyze([line("1", "A", { customerRef: "c" }), line("2", "A", { customerRef: "d" }), line("3", "A")], { measurements });
  assert.equal(result.customers.loyalty.member.baskets, 1); assert.equal(result.customers.loyalty.unknown.baskets, 2); assert.equal(result.customers.loyalty.beforeEnrollment.baskets, 0);
});
test("reviewed CSV rejects ambiguous numbers, duplicates, impossible dates and missing required evidence", () => {
  assert.equal(parseMeasurementCsv("stock", measurementTemplates.stock + "A,10.125,0,1000,\n")[0].values.openingUnits, 10.125);
  for (const value of ["A,NaN,1,1,1", "A,-1,1,1,1", "A,,1,1,1", "A,1e3,1,1,1", "A,1,1,1,1\nA,1,1,1,1"]) assert.throws(() => parseMeasurementCsv("stock", measurementTemplates.stock + value));
  assert.throws(() => parseMeasurementCsv("loyalty", measurementTemplates.loyalty + "c,2026-02-30"));
  assert.throws(() => parseMeasurementCsv("labour", measurementTemplates.labour + "location,120,4800,1000,,true"));
  assert.equal(parseMeasurementCsv("catalog", measurementTemplates.catalog + 'A,"Protein, premium",Powder')[0].values.category, "Protein, premium");
});
test("public demonstration uses real formulas, explicit missing costs and complete cent reconciliation", () => {
  const sample = retailDemo(), missing = retailDemo("all", true);
  assert.equal(sample.current.netCents, 2_459_361); assert.equal(sample.current.purchaseBaskets, 420);
  assert.equal(sample.bridge!.reduce((n, r) => n + r.impactCents, 0), sample.current.netCents - sample.prior.netCents);
  assert.ok(sample.products.every(p => p.score != null && p.score >= 0 && p.score <= 100));
  assert.equal(missing.current.grossProfitCents, null); assert.equal(missing.current.netCents, sample.current.netCents);
  assert.equal(retailDemo("central").current.netCents + retailDemo("riverside").current.netCents, sample.current.netCents);
});
test("unsafe monetary accumulation fails instead of silently rounding", () => {
  assert.throws(() => analyze([line("1", "A", { netCents: Number.MAX_SAFE_INTEGER }), line("2", "B", { netCents: 100 })]), /exact integer/);
});

test("same account with a different outlet cannot create a matched-period comparison", () => {
  const report = analyze([line("a", "A"), line("b", "A", { outletRef: "two", soldAt: "2026-09-10T11:00:00" })]);
  assert.equal(report.comparison.comparable, false); assert.equal(report.bridge, null);
});

test("anomaly flags need a variable same-weekday baseline and never invent missing days", () => {
  const span = parseCommercePeriod("2026-08-15", "2026-09-11");
  const dates = ["2026-07-24", "2026-07-31", "2026-08-07", "2026-08-14", "2026-08-21"];
  const amounts = [900, 1100, 950, 1050, 5000];
  const report = analyze(dates.map((day, i) => line(String(i), "A", { soldAt: day + "T11:00:00", netCents: amounts[i] })), { period: span });
  assert.equal(report.anomalies.length, 1); assert.equal(report.anomalies[0].baselineCents, 1000); assert.equal(report.anomalies[0].observations, 4);
  assert.equal(report.days.length, 5); assert.equal(report.hours[0].netCents, null);
  assert.equal(analyze(dates.map((day, i) => line(String(i), "A", { soldAt: day + "T11:00:00", netCents: i === 4 ? 5000 : 1000 })), { period: span }).anomalies.length, 0);
});

test("oversized baskets withhold pair analysis without sampling other metrics", () => {
  const rows = Array.from({ length: 101 }, (_, i) => line("large", String(i)));
  const report = analyze(rows); assert.equal(report.current.netCents, 101000); assert.equal(report.baskets.products.status, "large_basket"); assert.equal(report.products.length, 101);
});

test("a large selection retains all records and tied products receive equal scores", () => {
  const rows = Array.from({ length: 10000 }, (_, i) => line(String(i), String(i % 5)));
  const report = analyze(rows); assert.equal(report.current.purchaseBaskets, 10000); assert.equal(report.current.netCents, 10000000);
  assert.equal(new Set(report.products.map(row => row.score)).size, 1);
});
