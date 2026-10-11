import assert from "node:assert/strict";
import test from "node:test";
import { recordedReportTrend } from "../app/control-workspaces";

test("daily report profit stays unknown if any included source lacks costs", () => {
  const rows = recordedReportTrend([
    { businessDate: "2026-10-01", netSalesCents: 10000, costOfGoodsCents: 4000, transactionCount: 2 },
    { businessDate: "2026-10-01", netSalesCents: 5000, costOfGoodsCents: null, transactionCount: 1 },
    { businessDate: "2026-10-02", netSalesCents: -1000, costOfGoodsCents: 0, transactionCount: 1 },
  ]);
  assert.deepEqual(rows, [
    { date: "2026-10-01", netSalesCents: 15000, grossProfitCents: null, transactionCount: 3 },
    { date: "2026-10-02", netSalesCents: -1000, grossProfitCents: -1000, transactionCount: 1 },
  ]);
  assert.equal(recordedReportTrend([
    { businessDate: "2026-10-01", netSalesCents: 5000, costOfGoodsCents: null, transactionCount: 1 },
    { businessDate: "2026-10-01", netSalesCents: 10000, costOfGoodsCents: 4000, transactionCount: 2 },
  ])[0].grossProfitCents, null);
});
