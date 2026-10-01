import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { ApiError } from "../server/api.ts";
import { beginSquareFinancialWindow, normalizeSquareFinancialOrder, requireSquareCurrency, squareDailyFinancialAmounts, squareFinancialMoney, SQUARE_FINANCIAL_VERSION } from "../server/integrations/square-financials.ts";

const money = (amount: number, currency = "CAD") => ({ amount, currency });
function item(total = 10500, tax = 500, discount = 0) {
  return { uid: "line-1", catalog_object_id: "product-1", quantity: "1", name: "Item", total_money: money(total), total_tax_money: money(tax), total_discount_money: money(discount) };
}
function order(): Record<string, unknown> {
  return { id: "order-1", state: "COMPLETED", total_money: money(10500), total_tax_money: money(500), total_discount_money: money(0), line_items: [item()] };
}
function exchange(): Record<string, unknown> {
  return {
    ...order(), total_money: money(1250), total_tax_money: money(250), line_items: [item(1250, 250)],
    returns: [{ source_order_id: "original-order", return_line_items: [{ ...item(1875, 375), source_line_item_uid: "original-line", item_type: "ITEM" }] }],
    return_amounts: { total_money: money(1875), tax_money: money(375) },
    net_amounts: { total_money: money(-625), tax_money: money(-125) },
    refunds: [{ amount_money: money(625) }],
  };
}
function daily(input: Record<string, unknown>) {
  return normalizeSquareFinancialOrder(input, "CAD").filter(event => event.state === "completed").map(event => squareDailyFinancialAmounts({ totalCents: event.total, taxCents: event.tax, discountCents: event.discount, costCents: 0, lineCount: event.lineCount, isReturn: event.id.startsWith("return:") }));
}
function code(fn: () => unknown, expected: string) {
  assert.throws(fn, error => error instanceof ApiError && error.code === expected);
}

test("Square sale uses tax-exclusive revenue and does not subtract discounts twice", () => {
  const source = { ...order(), total_money: money(9450), total_tax_money: money(450), total_discount_money: money(1000), line_items: [item(9450, 450, 1000)] };
  assert.deepEqual(daily(source), [{ net: 9000, gross: 10000, refunds: 0, cost: 0, discounts: 1000, transactions: 1, units: 1 }]);
});

test("Square collected tips do not become product revenue", () => {
  const source = { ...order(), total_money: money(12500), total_tip_money: money(2000) };
  const [event] = normalizeSquareFinancialOrder(source, "CAD");
  assert.equal(event.total, 10500);
  assert.equal(event.tax, 500);
  assert.equal(daily(source)[0].net, 10000);
});

test("Square published exchange example keeps both sale and itemized return components", () => {
  // Official example amounts: sale 1250 with 250 tax, return 1875 with 375 tax.
  const events = normalizeSquareFinancialOrder(exchange(), "CAD");
  assert.equal(events[0].id, "order-1");
  assert.equal(events[1].id, "return:order-1");
  assert.equal(events[1].lines[0].quantity, -1000);
  assert.equal(events[1].lines[0].net, -1500);
  const rows = daily(exchange());
  assert.equal(rows.reduce((sum, r) => sum + r.net, 0), -500);
  assert.equal(rows.reduce((sum, r) => sum + r.gross, 0), 1000);
  assert.equal(rows.reduce((sum, r) => sum + r.refunds, 0), 1500);
  assert.equal(rows.reduce((sum, r) => sum + r.transactions, 0), 1);
  assert.equal(rows.reduce((sum, r) => sum + r.units, 0), 1);
});

test("Square refund-only order has negative revenue without an invented sale transaction", () => {
  const source = { ...exchange(), total_money: money(0), total_tax_money: money(0), line_items: [], net_amounts: { total_money: money(-1875), tax_money: money(-375) } };
  assert.deepEqual(daily(source), [{ net: -1500, gross: 0, refunds: 1500, cost: 0, discounts: 0, transactions: 0, units: 0 }]);
  const refund = squareDailyFinancialAmounts({ totalCents: -1875, taxCents: -375, discountCents: 0, costCents: -800, lineCount: 1, isReturn: true });
  assert.equal(refund.cost, -800);
});

test("Square corrected orders emit a stable absent-return tombstone", () => {
  const [sale, absent] = normalizeSquareFinancialOrder(order(), "CAD");
  assert.equal(sale.state, "completed");
  assert.deepEqual(absent, { id: "return:order-1", state: "voided", total: 0, tax: 0, discount: 0, lineCount: 0, lines: [] });
  assert.equal(normalizeSquareFinancialOrder({ id: "order-1", state: "CANCELED" }, "CAD").every(event => event.state === "voided"), true);
});

test("Square money and nested amounts must match workspace currency", () => {
  for (const value of [{ amount: 100 }, money(100, "USD"), { amount: 100, currency: null }]) {
    code(() => squareFinancialMoney(value, "CAD"), "SQUARE_CURRENCY_MISMATCH");
  }
  code(() => normalizeSquareFinancialOrder({ ...order(), total_money: money(10500, "USD") }, "CAD"), "SQUARE_CURRENCY_MISMATCH");
  code(() => requireSquareCurrency({ line_items: [{ base_price_money: money(10000, "USD") }] }, "CAD"), "SQUARE_CURRENCY_MISMATCH");
  code(() => requireSquareCurrency({ amount_money: money(100, "CAD"), refunded_money: money(20, "USD") }, "CAD"), "SQUARE_CURRENCY_MISMATCH");
  assert.equal(squareFinancialMoney(money(100), "CAD"), 100);
});

test("Square unsafe and fractional money never silently rounds into cents", () => {
  for (const amount of [1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, -1]) code(() => squareFinancialMoney(money(amount), "CAD"), "SQUARE_MONEY_INVALID");
  assert.equal(squareFinancialMoney(money(-100), "CAD", false, true), -100);
});

test("Square custom refunds and missing return allocations require review", () => {
  const partial = { ...exchange(), returns: [] };
  code(() => normalizeSquareFinancialOrder(partial, "CAD"), "SQUARE_RETURN_REVIEW_REQUIRED");
  const custom = { ...exchange(), returns: [{ source_order_id: "original-order", return_line_items: [{ ...item(1875, 375), item_type: "CUSTOM_AMOUNT" }] }] };
  code(() => normalizeSquareFinancialOrder(custom, "CAD"), "SQUARE_RETURN_REVIEW_REQUIRED");
  code(() => normalizeSquareFinancialOrder({ ...order(), refunds: [{ amount_money: money(100) }] }, "CAD"), "SQUARE_RETURN_REVIEW_REQUIRED");
});

test("Square inconsistent provider net amounts and tax are rejected", () => {
  for (const source of [
    { ...exchange(), net_amounts: { total_money: money(625), tax_money: money(-125) } },
    { ...exchange(), net_amounts: { total_money: money(-625), tax_money: money(125) } },
    { ...exchange(), return_amounts: { total_money: money(1874), tax_money: money(375) } },
  ]) code(() => normalizeSquareFinancialOrder(source, "CAD"), "SQUARE_RETURN_REVIEW_REQUIRED");
  code(() => normalizeSquareFinancialOrder({ ...order(), total_tax_money: money(501) }, "CAD"), "SQUARE_ORDER_REVIEW_REQUIRED");
});

test("Square service charges and cash rounding are not inferred as item revenue", () => {
  for (const source of [
    { ...order(), total_service_charge_money: money(200) },
    { ...order(), rounding_adjustment: { amount_money: money(2) } },
  ]) code(() => normalizeSquareFinancialOrder(source, "CAD"), "SQUARE_ORDER_REVIEW_REQUIRED");
  code(() => normalizeSquareFinancialOrder({ ...exchange(), return_amounts: { total_money: money(1875), tax_money: money(375), tip_money: money(10) } }, "CAD"), "SQUARE_RETURN_REVIEW_REQUIRED");
});

test("Square item quantity precision and source identities cannot invent cost allocation", () => {
  for (const quantity of ["0", "-1", "0.0001", "invalid", "9007199254740992"]) {
    code(() => normalizeSquareFinancialOrder({ ...order(), line_items: [{ ...item(), quantity }] }, "CAD"), "SQUARE_ORDER_REVIEW_REQUIRED");
  }
  const [fractional] = normalizeSquareFinancialOrder({ ...order(), line_items: [{ ...item(), quantity: "0.125" }] }, "CAD");
  assert.equal(fractional.lines[0].quantity, 125);
  code(() => normalizeSquareFinancialOrder({ ...order(), line_items: [item(), item()] }, "CAD"), "SQUARE_ORDER_REVIEW_REQUIRED");
});

test("Square legacy financial history restarts safely while new paginated windows resume", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  const old = { version: 2, watermark: "2026-10-01T11:00:00Z", orders: "old-page", windowStart: "2026-10-01T10:00:00Z", windowEnd: "2026-10-01T11:00:00Z" };
  const restarted = beginSquareFinancialWindow(JSON.stringify(old), now);
  assert.equal(restarted.refreshingHistory, true);
  assert.equal(restarted.window.orders, undefined);
  assert.ok(restarted.window.windowStart < "2025-01-01");
  const resumed = beginSquareFinancialWindow(JSON.stringify({ ...old, financialVersion: SQUARE_FINANCIAL_VERSION }), now);
  assert.equal(resumed.refreshingHistory, false);
  assert.equal(resumed.window.orders, "old-page");
  assert.equal(resumed.window.windowEnd, "2026-10-01T11:00:00.000Z");
  assert.equal(beginSquareFinancialWindow("invalid", now).refreshingHistory, true);
});

test("Square archived snapshot guard catches changed quantity and product without changing historical costs", () => {
  const source = readFileSync("server/integrations/sync/square.ts", "utf8");
  const sql = source.match(/const archivedChange = await database\.prepare\(`([\s\S]*?)`\)/)?.[1];
  assert.ok(sql);
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE commerce_sale_lines (organization_id TEXT, provider TEXT, connection_id TEXT, external_sale_id TEXT, external_line_id TEXT, product_ref TEXT, quantity_milli INTEGER, cost_cents INTEGER)");
    db.exec("CREATE TABLE commerce_products (organization_id TEXT, provider TEXT, connection_id TEXT, external_product_id TEXT, archived INTEGER)");
    db.prepare("INSERT INTO commerce_products VALUES ('org','square','connection',?,?)").run("old", 1);
    db.prepare("INSERT INTO commerce_products VALUES ('org','square','connection',?,?)").run("new", 0);
    db.exec("INSERT INTO commerce_sale_lines VALUES ('org','square','connection','sale','line','old',2000,777)");
    const guard = (quantity: number, product: string | null, connection = "connection") => db.prepare(sql).get(JSON.stringify([{ id: "line", product, quantity }]), "org", "square", connection, "sale");
    assert.equal(guard(2000, "old"), undefined);
    assert.ok(guard(3000, "old"));
    assert.ok(guard(2000, "new"));
    assert.ok(guard(2000, null));
    assert.equal(guard(3000, "old", "another-account"), undefined);
    const saved = db.prepare("SELECT quantity_milli, product_ref, cost_cents FROM commerce_sale_lines").get();
    assert.equal(saved?.quantity_milli, 2000);
    assert.equal(saved?.product_ref, "old");
    assert.equal(saved?.cost_cents, 777);
    // The old item is active but the replacement item is archived: old cost still cannot be reused.
    db.exec("UPDATE commerce_products SET archived=CASE external_product_id WHEN 'new' THEN 1 ELSE 0 END");
    assert.ok(guard(2000, "new"));
    assert.equal(guard(3000, "old"), undefined);
  } finally { db.close(); }
});
