import assert from "node:assert/strict";
import test from "node:test";
import { validateStudioScope, studioRecordedUtc, studioSalesSummary, excelMoneyValue, excelCountValue, excelQuantityValue, type StudioSalesRow } from "../domain/data-studio.ts";
import { businessClock } from "../domain/intraday-sales.ts";

const row = (netSalesCents: number, costOfGoodsCents: number | null): StudioSalesRow => ({
  id: "000012345678901234", businessDate: "2026-10-01", locationRef: "shop", sourceKind: "owner_summary",
  netSalesCents, costOfGoodsCents, transactionCount: 1, unitsSold: 1,
});
test("recorded update times normalize established Unix seconds and legacy milliseconds to explicit UTC", () => {
  const instant = "2026-10-01T09:10:11.000Z", milliseconds = Date.parse(instant);
  assert.equal(studioRecordedUtc(milliseconds / 1000), instant);
  assert.equal(studioRecordedUtc(milliseconds), instant);
  assert.equal(studioRecordedUtc(0), "1970-01-01T00:00:00.000Z");
  for (const invalid of [-1, 1.5, NaN, Infinity, 8_640_000_000_000_001]) assert.throws(() => studioRecordedUtc(invalid));
});
test("Studio computes weighted gross margin and preserves refund-only negative periods", () => {
  const s = studioSalesSummary([row(10000, 5000), row(1000, 900)]);
  assert.equal(s.netSalesCents, 11000); assert.equal(s.grossProfitCents, 5100);
  assert.equal(s.grossMargin, 5100 / 11000);
  const negative = studioSalesSummary([row(-1000, -600)]);
  assert.equal(negative.grossProfitCents, -400); assert.equal(negative.grossMargin, null);
});
test("Studio never turns missing costs or absent records into zero-valued profit", () => {
  const missing = studioSalesSummary([row(100, null), row(100, 0)]);
  assert.equal(missing.costOfGoodsCents, null); assert.equal(missing.grossProfitCents, null);
  assert.equal(missing.grossMargin, null); assert.equal(studioSalesSummary([]).netSalesCents, null);
  assert.equal(studioSalesSummary([row(100, 0)]).grossProfitCents, 100);
});
test("Studio refuses unsafe source amounts, accumulated overflow and fractional daily counts", () => {
  assert.throws(() => studioSalesSummary([row(Number.MAX_SAFE_INTEGER + 1, 1)]));
  assert.throws(() => studioSalesSummary([row(Number.MAX_SAFE_INTEGER, 0), row(1, 0)]));
  assert.throws(() => studioSalesSummary([row(Number.MAX_SAFE_INTEGER, -1)]));
  assert.throws(() => studioSalesSummary([{ ...row(1, 1), transactionCount: 0.5 }]));
});
test("POS quantities preserve exact thousandths, including returns and floating residue", () => {
  assert.equal(studioSalesSummary([{...row(100,0),unitsSold:0.125}, {...row(-10,0),unitsSold:-0.025}]).unitsSold, 0.1);
  assert.equal(studioSalesSummary([{...row(100,0),unitsSold:0.1+0.2}]).unitsSold, 0.3);
  assert.throws(() => studioSalesSummary([{...row(1,0),unitsSold:0.0001}]));
  assert.throws(() => studioSalesSummary([{...row(1,0),unitsSold:1_000_000_001}]));
  assert.equal(excelCountValue(Number.MAX_SAFE_INTEGER), "9007199254740991");
  assert.equal(excelQuantityValue(1_000_000_000_000.125), "1000000000000.125");
});
test("Studio validates strict scoped dates and refuses submitted authority or unknown fields", () => {
  const s = validateStudioScope({ from: "2024-02-29", to: "2024-03-01", location: null, connection: null }, "2026-10-11");
  assert.equal(s.from, "2024-02-29");
  for (const value of [
    { ...s, organizationId: "another" }, { ...s, from: "2026-02-29" }, { ...s, to: "2027-01-01" },
    { ...s, from: "2020-01-01", to: "2026-10-11" }, { ...s, location: ["shop"] },
  ]) assert.throws(() => validateStudioScope(value, "2026-10-11"));
});
test("XLSX money preserves values exceeding Excel's 15-digit precision as exact decimal text", () => {
  assert.equal(excelMoneyValue(12345), 123.45); assert.equal(excelMoneyValue(-12345), -123.45);
  assert.equal(excelMoneyValue(0), 0); assert.equal(excelMoneyValue(null), null);
  assert.equal(excelMoneyValue(9007199254740991), "90071992547409.91");
  assert.equal(excelMoneyValue(-9007199254740991), "-90071992547409.91");
});
test("calendar scopes use the business day in UTC, Denver and Tokyo across midnight and daylight saving",()=>{
  const instant=new Date("2026-03-08T06:30:00.000Z");
  for(const [zone,date] of [["UTC","2026-03-08"],["America/Denver","2026-03-07"],["Asia/Tokyo","2026-03-08"]]){
    const clock=businessClock(instant,zone)!; assert.equal(clock.date,date);
    assert.equal(validateStudioScope({from:date,to:date},clock.date).to,date);
    const next=new Date(`${date}T00:00:00Z`); next.setUTCDate(next.getUTCDate()+1);
    assert.throws(()=>validateStudioScope({from:date,to:next.toISOString().slice(0,10)},clock.date));
  }
});
