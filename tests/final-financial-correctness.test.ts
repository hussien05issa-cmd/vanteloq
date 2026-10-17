import assert from "node:assert/strict";
import test from "node:test";
import { buildPurchaseCommitmentBoard, type PurchaseCommitmentOrderInput } from "../domain/purchase-commitments.ts";
import { calculateCashFlowIntelligence, type CashFlowItem } from "../domain/cash-flow-intelligence.ts";
import { buildThirteenWeekCashFlow } from "../domain/thirteen-week-cash-flow.ts";
import { forecastCash } from "../server/bookloq.ts";
import { advisorDailySeries, advisorKpis, type AdvisorDay } from "../domain/advisor-kpis.ts";

const asOf = "2026-10-04";
function order(id: string, currency: string, unitCostCents: number): PurchaseCommitmentOrderInput {
  return { id, orderNumber: id, supplierName: "Fictional supplier", status: "sent", orderDate: asOf,
    expectedDeliveryDate: null, committedCashDate: null, currency, totalCents: unitCostCents,
    lines: [{ sku: id, description: id, quantity: 1, receivedQuantity: 0, unitCostCents, previousCostCents: null }] };
}
function item(id: string, amountCents: number, direction: "in" | "out" = "in"): CashFlowItem {
  return { id, label: id, dueDate: asOf, amountCents, direction, certainty: "confirmed" };
}

test("purchasing keeps CAD and USD commitments separate instead of reporting a combined money total", () => {
  const board = buildPurchaseCommitmentBoard([order("cad", "CAD", 10_000), order("usd", "USD", 20_000)]);
  assert.equal(board.totalRemainingMerchandiseCents, null);
  assert.deepEqual(board.vendors.map(v => [v.currency, v.remainingMerchandiseCents]), [["CAD", 10_000], ["USD", 20_000]]);
  assert.equal(buildPurchaseCommitmentBoard([order("one", "CAD", 10_000), order("two", "CAD", 20_000)]).totalRemainingMerchandiseCents, 30_000);
  assert.equal(buildPurchaseCommitmentBoard([]).totalRemainingMerchandiseCents, 0);
});

test("cash decisions reject aggregate precision loss in otherwise valid individual amounts", () => {
  const limit = Number.MAX_SAFE_INTEGER;
  const items = [item("one", limit), item("two", 2)];
  assert.throws(() => forecastCash(0, items, asOf), /precision|integer/i);
  assert.throws(() => calculateCashFlowIntelligence({ asOf, openingCashCents: 0, safetyThresholdCents: 0, items }), /precision|integer/i);
  assert.throws(() => buildThirteenWeekCashFlow({
    asOf, openingCashCents: 0, safetyThresholdCents: 0, actualTransactions: [],
    forecastItems: items.map(row => ({ ...row, certainty: "confirmed" as const })),
  }), /precision|integer/i);
});

test("daily cash net is exact and independent of order when large signed movements cancel", () => {
  const items = [item("receipt-a", Number.MAX_SAFE_INTEGER), item("receipt-b", 2), item("payment", Number.MAX_SAFE_INTEGER, "out")];
  for (const rows of [items, [...items].reverse()]) {
    const result = calculateCashFlowIntelligence({ asOf, openingCashCents: 10, safetyThresholdCents: 0, items: rows });
    assert.equal(result.liquidity30Cents, 12);
    assert.equal(result.minimumCashCents, 10);
  }
});

test("13-week cash rejects duplicate obligations and rolled-over source dates", () => {
  const base = { asOf, openingCashCents: 10_000, safetyThresholdCents: 0, actualTransactions: [] };
  const row = { id: "same", dueDate: asOf, label: "Outstanding bill", amountCents: 100, direction: "out" as const, certainty: "confirmed" as const };
  assert.throws(() => buildThirteenWeekCashFlow({ ...base, forecastItems: [row, row] }), /duplicate/i);
  assert.throws(() => buildThirteenWeekCashFlow({ ...base, forecastItems: [{ ...row, dueDate: "2026-02-30" }] }), /date/i);
});

test("purchase commitment accumulation fails instead of rounding a whole cent away", () => {
  assert.throws(() => buildPurchaseCommitmentBoard([order("large", "CAD", Number.MAX_SAFE_INTEGER), order("small", "CAD", 2)]), /precision|integer/i);
});

test("AI daily sales preserve exact signed cancellation while unsafe or missing totals remain unavailable", () => {
  const rows: AdvisorDay[] = [Number.MAX_SAFE_INTEGER, 2, -Number.MAX_SAFE_INTEGER].map((netSalesCents, i) => ({
    date: asOf, locationRef: String(i), netSalesCents, grossProfitCents: 0, transactions: 1,
    discountsCents: 0, refundsCents: 0, unitsSold: 1, labourCostCents: 0,
    inventoryValueCents: 0, accountsPayableCents: 0,
  }));
  for (const values of [rows, [...rows].reverse()]) {
    assert.equal(advisorDailySeries(values)[0].netSalesCents, 2);
    assert.equal(advisorKpis(values).current?.netSalesCents, 2);
  }
  assert.equal(advisorDailySeries(rows.slice(0, 2))[0].netSalesCents, null);
  assert.equal(advisorDailySeries([{ ...rows[0], netSalesCents: null }])[0].netSalesCents, null);
});
