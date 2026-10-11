import assert from "node:assert/strict";
import test from "node:test";
import { normalizeShopifyOrder, shopifyMoney, type ShopifyOrder } from "../server/integrations/shopify-financials.ts";
import { normalizeLightspeedRSale, buildLightspeedRDailyMetrics } from "../server/integrations/lightspeed-r.ts";

export const money = (amount: string, currencyCode = "CAD") => ({ shopMoney: { amount, currencyCode } });
export const order = (overrides: Partial<ShopifyOrder> = {}): ShopifyOrder => ({
  id: "gid://shopify/Order/1", createdAt: "2026-10-08T12:00:00Z", updatedAt: "2026-10-08T12:00:00Z", displayFinancialStatus: "PAID", taxesIncluded: false, test: false, retailLocation: {id:"pos-location"},
  currentTotalPriceSet: money("105.00"), currentTotalTaxSet: money("5.00"), currentTotalDiscountsSet: money("0"), totalRefundedSet: money("0"),
  lineItems: { pageInfo: { hasNextPage: false }, nodes: [
    { id: "line-1", name: "Fixture A", quantity: 3, currentQuantity: 3, discountedTotalSet: money("60"), totalDiscountSet: money("0"), variant: { id: "p1", sku: "A" } },
    { id: "line-2", name: "Fixture B", quantity: 2, currentQuantity: 2, discountedTotalSet: money("40"), totalDiscountSet: money("0"), variant: { id: "p2", sku: "B" } },
  ] }, transactions: [], ...overrides,
});
test("Shopify money validates currency and exact minor units without substituting zeros", () => {
  assert.equal(shopifyMoney({ amount: "0.00", currencyCode: "CAD" }, "CAD"), 0);
  assert.equal(shopifyMoney({ amount: "1.0100", currencyCode: "CAD" }, "CAD"), 101);
  for (const value of [undefined, {}, { amount: "5" }, { amount: "5", currencyCode: "USD" }, { amount: "-1", currencyCode: "CAD" }, { amount: "1.001", currencyCode: "CAD" }, { amount: "NaN", currencyCode: "CAD" }, { amount: "90071992547410", currencyCode: "CAD" }]) assert.throws(() => shopifyMoney(value, "CAD"));
});
test("Shopify receipt reconciles tax-exclusive sales and five units independently of two line records", () => {
  const normalized = normalizeShopifyOrder(order(), "CAD");
  assert.equal(normalized.total - normalized.tax, 10000);
  assert.equal(normalized.total - normalized.tax - 6000, 4000);
  assert.equal(normalized.unitsMilli, 5000);
  assert.equal(normalized.lines.length, 2);
});
test("authoritative cancellation/test/unpaid snapshots remove earlier financial contributions", () => {
  for (const input of [{ cancelledAt: "2026-10-09T01:00:00Z" }, { test: true }, { displayFinancialStatus: "VOIDED" }, { displayFinancialStatus: "PENDING" }]) {
    const normalized = normalizeShopifyOrder(order(input), "CAD");
    assert.equal(normalized.total, 0); assert.equal(normalized.unitsMilli, 0); assert.deepEqual(normalized.lines, []); assert.deepEqual(normalized.payments, []);
  }
});
test("removed Shopify lines are absent while remaining complete amounts reconcile", () => {
  const input = order({ currentTotalPriceSet: money("63"), currentTotalTaxSet: money("3") });
  input.lineItems.nodes[1].currentQuantity = 0;
  const normalized = normalizeShopifyOrder(input, "CAD");
  assert.deepEqual(normalized.lines.map(line => line.id), ["line-1"]); assert.equal(normalized.unitsMilli, 3000);
});
test("truncated and unsupported allocations remain reviewable instead of claiming verified totals", () => {
  const truncated = order(); truncated.lineItems.pageInfo = { hasNextPage: true };
  const changedQuantity = order(); changedQuantity.lineItems.nodes[0].currentQuantity = 2;
  const foreignLine = order(); foreignLine.lineItems.nodes[0].discountedTotalSet = money("60", "USD");
  for (const input of [truncated, changedQuantity, foreignLine, order({ taxesIncluded: true }), order({ displayFinancialStatus: "PARTIALLY_REFUNDED" }), order({ totalRefundedSet: money("1") }), order({ currentTotalTaxSet: money("106") }), order({ currentTotalPriceSet: money("110") })]) assert.throws(() => normalizeShopifyOrder(input, "CAD"));
});
test("R-Series units retain independent quantity evidence, including fractional items", async () => {
  const raw = { saleID:"fixture", completed:true, shopID:"1", completeTime:"2026-10-08T12:00:00Z", total:"50",taxTotal:"0",calcFIFOCost:"20",SaleLines:{SaleLine:[{unitQuantity:"3"},{unitQuantity:"2"}]} };
  const normalized = await normalizeLightspeedRSale(raw);
  assert.equal(normalized.lineCount, 2); assert.equal(normalized.unitsMilli,5000); assert.equal(buildLightspeedRDailyMetrics([normalized])[0].unitsSold,5);
  const fractional = await normalizeLightspeedRSale({...raw,SaleLines:{SaleLine:[{unitQuantity:"0.125"},{unitQuantity:"0.375"}]}});
  assert.equal(buildLightspeedRDailyMetrics([fractional])[0].unitsSold,0.5);
  for (const SaleLines of [undefined,{SaleLine:[{}]},{SaleLine:[{unitQuantity:"bad"}]},{SaleLine:[{unitQuantity:"0.0001"}]}]) {
    const legacy = await normalizeLightspeedRSale({...raw,SaleLines}); assert.equal(legacy.unitsMilli,null);
    assert.throws(() => buildLightspeedRDailyMetrics([legacy]), /quantity history/i);
  }
});
