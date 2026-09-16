import test from "node:test";
import assert from "node:assert/strict";
import { parseDailyCsv } from "../domain/daily-summary-csv";
import { dailyMetricImportInput } from "../server/validation";

const header = "business_date,gross_sales,net_sales,cogs,transactions,units";
test("daily CSV preserves exact cents, zero sales and missing optional balances", () => {
  const [row] = parseDailyCsv(header + ',location\n2026-09-14,"$1,200.01",1190.01,600.09,20,35,"QA, Main"');
  assert.equal(row.grossSalesCents, 120001); assert.equal(row.netSalesCents, 119001); assert.equal(row.costOfGoodsCents, 60009);
  assert.equal(row.cashBalanceCents, null); assert.equal(row.refundsCents, 0); assert.equal(row.locationRef, "QA, Main");
  assert.equal(parseDailyCsv(header + "\n2026-09-14,0,0,0,0,0")[0].netSalesCents, 0);
});
test("daily CSV rejects missing values instead of manufacturing zero sales", () => {
  assert.throws(() => parseDailyCsv(header + "\n2026-09-14,100,,50,10,20"), /Row 2: net_sales is required/);
  for (const value of ["2.123", "1e3", "-2", "NaN", "Infinity"]) assert.throws(() => parseDailyCsv(header + `\n2026-09-14,${value},0,0,0,0`));
  assert.throws(() => parseDailyCsv(header + "\n2026-09-14,10,10,2,1.5,2"), /transactions.*whole number/);
});
test("daily CSV rejects impossible dates, duplicated records and malformed columns", () => {
  const row = "2026-09-14,100,100,50,10,20";
  assert.throws(() => parseDailyCsv(header + "\n2026-02-30,100,100,50,10,20"), /valid date/);
  assert.throws(() => parseDailyCsv(header + `\n${row}\n${row}`), /already appear/);
  assert.throws(() => parseDailyCsv(header + ",net_sales\n" + row + ",100"), /unique/);
  assert.throws(() => parseDailyCsv(header + "\n" + row + ",extra"), /expected 6 columns/);
  assert.throws(() => parseDailyCsv(header + '\n2026-09-14,"100,100,50,10,20'), /close the quoted/);
});
test("API validation independently rejects normalized impossible calendar dates", () => {
  const rows = parseDailyCsv(header + "\n2024-02-29,100,100,50,10,20");
  const body = { importType: "daily_summary_csv", fileName: "test.csv", rows };
  assert.equal(dailyMetricImportInput(body).rows.length, 1);
  rows[0].businessDate = "2026-02-30";
  assert.throws(() => dailyMetricImportInput(body), /valid business date/);
});


test("missing labour and an explicit zero remain different through CSV and API validation", () => {
  const [missing] = parseDailyCsv(header + "\n2026-09-14,100,100,50,10,20");
  const [zero] = parseDailyCsv(header + ",labour_cost\n2026-09-14,100,100,50,10,20,0");
  assert.equal(missing.labourCostCents, null);
  assert.equal(zero.labourCostCents, 0);
  const parse = (row: ReturnType<typeof parseDailyCsv>[number]) => dailyMetricImportInput({ rows: [row] }).rows[0];
  assert.equal(parse(missing).labourCostReported, false);
  assert.equal(parse(zero).labourCostReported, true);
});
