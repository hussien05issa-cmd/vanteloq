import { ApiError } from "../api.ts";
import { beginSquareSyncWindow, record, records, squareLineNetSalesCents } from "./square.ts";

export const SQUARE_FINANCIAL_VERSION = "financial-v2";
export const SQUARE_RETURN_PREFIX = "return:";
export type SquareFinancialLine = { id: string; product: string | null; name: string | null; quantity: number; net: number; discount: number };
export type SquareFinancialEvent = { id: string; state: "completed" | "voided"; total: number; tax: number; discount: number; lineCount: number; lines: SquareFinancialLine[] };

export function beginSquareFinancialWindow(cursor: string | null, now: Date) {
  let saved: Record<string, unknown> = {};
  try { saved = cursor ? record(JSON.parse(cursor)) : {}; } catch { /* Rebuild unverified history. */ }
  const refreshingHistory = saved.financialVersion !== SQUARE_FINANCIAL_VERSION;
  return { window: beginSquareSyncWindow(refreshingHistory ? null : cursor, now), refreshingHistory };
}

function fail(code: string, message: string): never { throw new ApiError(409, code, message); }
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
function exact(values: number[]) {
  const n = values.reduce((s, v) => s + BigInt(v), BigInt(0));
  if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < BigInt(Number.MIN_SAFE_INTEGER)) fail("SQUARE_MONEY_INVALID", "Square amounts exceed supported precision.");
  return Number(n);
}
/** Currency is never inferred from the workspace label or converted implicitly. */
export function requireSquareCurrency(value: unknown, currency: string, depth = 0): void {
  if (depth > 30) fail("SQUARE_MONEY_INVALID", "Square returned an unsupported monetary structure.");
  if (Array.isArray(value)) { value.forEach(v => requireSquareCurrency(v, currency, depth + 1)); return; }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (key === "currency" && child !== currency) fail("SQUARE_CURRENCY_MISMATCH", "Square records must use the workspace currency. Review this source before publishing; no currency conversion was applied.");
    if (typeof child === "object" && child !== null) requireSquareCurrency(child, currency, depth + 1);
  }
}
export function squareFinancialMoney(value: unknown, currency: string, optional = false, signed = false): number {
  if (value === undefined && optional) return 0;
  const money = record(value);
  if (money.currency !== currency) fail("SQUARE_CURRENCY_MISMATCH", "Square money must specify the workspace currency. No currency conversion was applied.");
  if (!Number.isSafeInteger(money.amount) || (!signed && Number(money.amount) < 0)) fail("SQUARE_MONEY_INVALID", "Square returned an invalid monetary amount.");
  return Number(money.amount);
}
function quantity(value: unknown): number {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,3})?$/.test(value)) fail("SQUARE_ORDER_REVIEW_REQUIRED", "Square quantities need exact supported item precision.");
  const [whole, fraction = ""] = value.split(".");
  const n = BigInt(whole) * BigInt(1000) + BigInt(fraction.padEnd(3, "0") || "0");
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) fail("SQUARE_ORDER_REVIEW_REQUIRED", "Square quantity exceeds supported precision.");
  return Number(n);
}

/** Keep sale and return events separate: the existing staged contract is tax-inclusive total minus tax.
 * Never estimate item allocation for custom refunds, service charges or cash rounding adjustments. */
export function normalizeSquareFinancialOrder(order: Record<string, unknown>, currency: string): SquareFinancialEvent[] {
  const id = text(order.id);
  if (!id) fail("SQUARE_ORDER_REVIEW_REQUIRED", "Square returned an order without a stable identifier.");
  const blank = (eventId: string): SquareFinancialEvent => ({ id: eventId, state: "voided", total: 0, tax: 0, discount: 0, lineCount: 0, lines: [] });
  if (order.state !== "COMPLETED") return [blank(id), blank(SQUARE_RETURN_PREFIX + id)];
  requireSquareCurrency(order, currency);
  const money = (v: unknown, optional = false, signed = false) => squareFinancialMoney(v, currency, optional, signed);
  const total = money(order.total_money), tax = money(order.total_tax_money, true), tip = money(order.total_tip_money, true);
  const discount = money(order.total_discount_money, true);
  if (money(order.total_service_charge_money, true) !== 0 || records(order.service_charges).length || Object.keys(record(order.rounding_adjustment)).length) {
    fail("SQUARE_ORDER_REVIEW_REQUIRED", "Square service charges or cash rounding need an explicit allocation before publication.");
  }
  const line = (raw: Record<string, unknown>, lineId: string, returned: boolean): SquareFinancialLine => {
    money(raw.total_money); money(raw.total_tax_money, true); money(raw.total_discount_money, true);
    const net = squareLineNetSalesCents(raw), qty = quantity(raw.quantity);
    if (qty <= 0) fail("SQUARE_ORDER_REVIEW_REQUIRED", "Square item quantities must be positive before returns are signed.");
    if (returned && (raw.item_type === "CUSTOM_AMOUNT" || !text(raw.source_line_item_uid))) fail("SQUARE_RETURN_REVIEW_REQUIRED", "A Square return needs its original item reference. Custom refund allocation is not inferred.");
    return { id: lineId, product: text(raw.catalog_object_id), name: text(raw.name), quantity: returned ? -qty : qty, net: returned ? -net : net, discount: returned ? 0 : money(raw.total_discount_money, true) };
  };
  const saleRows = records(order.line_items);
  const saleLines = saleRows.map((raw) => {
    const uid = text(raw.uid);
    if (!uid) fail("SQUARE_ORDER_REVIEW_REQUIRED", "Square returned an item without a stable identifier.");
    return line(raw, uid, false);
  });
  const returnedRows = records(order.returns).flatMap(ret => records(ret.return_line_items).map(raw => ({ raw, source: text(ret.source_order_id) })));
  const returnLines = returnedRows.map(({ raw, source }) => {
    const uid = text(raw.uid) ?? text(raw.source_line_item_uid);
    if (!uid || !source) fail("SQUARE_RETURN_REVIEW_REQUIRED", "A Square return needs a stable source order and item reference.");
    return line(raw, source + ":" + uid, true);
  });
  for (const lines of [saleLines, returnLines]) if (new Set(lines.map(l => l.id)).size !== lines.length) fail("SQUARE_ORDER_REVIEW_REQUIRED", "Square returned duplicate item identifiers.");
  const returns = record(order.return_amounts);
  const returnTotal = money(returns.total_money, true), returnTax = money(returns.tax_money, true), returnTip = money(returns.tip_money, true);
  if (money(returns.service_charge_money, true) !== 0 || returnTip !== 0) fail("SQUARE_RETURN_REVIEW_REQUIRED", "Returned service charges or tips require separate reviewed allocation.");
  const saleTotal = exact([total, -tip]);
  if (saleTotal < tax || exact(saleRows.map(raw => money(raw.total_money))) !== saleTotal || exact(saleRows.map(raw => money(raw.total_tax_money, true))) !== tax
      || exact(saleLines.map(l => l.discount)) !== discount) {
    fail("SQUARE_ORDER_REVIEW_REQUIRED", "Square order and item amounts do not reconcile. Review them before publication.");
  }
  if (exact(returnedRows.map(({ raw }) => money(raw.total_money))) !== returnTotal || exact(returnedRows.map(({ raw }) => money(raw.total_tax_money, true))) !== returnTax || returnTax > returnTotal) {
    fail("SQUARE_RETURN_REVIEW_REQUIRED", "Square return totals need complete itemized amounts. Refund allocation is not inferred.");
  }
  if (records(order.refunds).length && !returnLines.length) fail("SQUARE_RETURN_REVIEW_REQUIRED", "Square refund records require their itemized return order before publication.");
  const net = record(order.net_amounts);
  if (returnLines.length || Object.keys(net).length) {
    if (money(net.total_money, false, true) !== exact([total, -returnTotal])
        || money(net.tax_money, false, true) !== exact([tax, -returnTax])
        || (net.tip_money !== undefined && money(net.tip_money, false, true) !== exact([tip, -returnTip]))) {
      fail("SQUARE_RETURN_REVIEW_REQUIRED", "Square net amounts do not reconcile to the sale and return components.");
    }
  }
  const count = (lines: SquareFinancialLine[]) => exact(lines.map(l => Math.max(0, Math.round(Math.abs(l.quantity) / 1000))));
  return [
    { id, state: saleLines.length ? "completed" : "voided", total: saleTotal, tax, discount, lineCount: count(saleLines), lines: saleLines },
    { id: SQUARE_RETURN_PREFIX + id, state: returnLines.length ? "completed" : "voided", total: returnTotal ? -returnTotal : 0, tax: returnTax ? -returnTax : 0, discount: 0, lineCount: count(returnLines), lines: returnLines },
  ];
}

/** Units retain the existing completed-sale convention; returns do not add another sale transaction. */
export function squareDailyFinancialAmounts(sale: { totalCents: number; taxCents: number; discountCents: number; costCents: number; lineCount: number; isReturn: boolean }) {
  const net = exact([sale.totalCents, -sale.taxCents]);
  if ((sale.isReturn && net > 0) || (!sale.isReturn && net < 0)) fail("SQUARE_ORDER_REVIEW_REQUIRED", "Square event direction requires review.");
  return { net, gross: sale.isReturn ? 0 : exact([net, sale.discountCents]), refunds: sale.isReturn ? -net : 0, cost: sale.costCents,
    discounts: sale.isReturn ? 0 : sale.discountCents, transactions: sale.isReturn ? 0 : 1, units: sale.isReturn ? 0 : sale.lineCount };
}
