import { ApiError } from "../api";

export const SHOPIFY_FINANCIAL_VERSION = "financial-v2";
export type ShopifyMoney = { amount?: string | null; currencyCode?: string | null };
type MoneySet = { shopMoney?: ShopifyMoney };
export type ShopifyOrder = {
  id: string; createdAt: string; updatedAt: string; test?: boolean; taxesIncluded?: boolean;
  displayFinancialStatus?: string | null; cancelledAt?: string | null;
  retailLocation?: { id: string } | null; customer?: { id: string; updatedAt?: string | null } | null;
  currentTotalPriceSet?: MoneySet; currentTotalTaxSet?: MoneySet;
  currentTotalDiscountsSet?: MoneySet; totalRefundedSet?: MoneySet;
  lineItems: { pageInfo?: { hasNextPage: boolean }; nodes: Array<{
    id: string; name: string; quantity: number; currentQuantity: number;
    discountedTotalSet?: MoneySet; totalDiscountSet?: MoneySet;
    variant?: { id: string; sku?: string | null; product?: { title?: string | null } | null } | null;
  }> };
  transactions: Array<{ id: string; kind?: string; status?: string; gateway?: string | null;
    processedAt?: string | null; amountSet?: MoneySet }>;
};
function review(message: string): never { throw new ApiError(409, "SHOPIFY_FINANCIAL_REVIEW_REQUIRED", message); }
export function requireShopifyCurrency(actual: unknown, expected: string) {
  if (actual !== expected) throw new ApiError(409, "SHOPIFY_CURRENCY_MISMATCH", "Shopify money must match the workspace currency. No conversion was applied.");
  if (new Intl.NumberFormat("en", { style: "currency", currency: expected }).resolvedOptions().maximumFractionDigits !== 2) {
    review("This Shopify currency needs an explicit minor-unit contract before publication.");
  }
}
export function shopifyMoney(value: ShopifyMoney | undefined | null, currency: string): number {
  requireShopifyCurrency(value?.currencyCode, currency);
  if (typeof value?.amount !== "string" || !/^\d+(?:\.\d{1,2}0*)?$/.test(value.amount)) review("Shopify returned missing or unsupported money. No zero was substituted.");
  const [whole, fraction = ""] = value.amount.split(".");
  const cents = BigInt(whole) * BigInt(100) + BigInt(fraction.slice(0, 2).padEnd(2, "0"));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) review("Shopify money exceeds supported precision.");
  return Number(cents);
}
export function exactShopifySum(values: number[]) {
  if (values.some(value => !Number.isSafeInteger(value))) review("Shopify totals require exact integer minor units.");
  const total = values.reduce((sum, value) => sum + BigInt(value), BigInt(0));
  if (total > BigInt(Number.MAX_SAFE_INTEGER) || total < BigInt(Number.MIN_SAFE_INTEGER)) review("Shopify totals exceed supported precision.");
  return Number(total);
}
function timestamp(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) review("Shopify orders require a recorded date and version.");
  return value;
}

/** Only reconciled tax-exclusive item sales are supported here. Unsupported
 * refund/adjustment allocation stays staged instead of inventing ledger facts. */
export function normalizeShopifyOrder(order: ShopifyOrder, currency: string) {
  if (!order.id?.trim()) review("Shopify returned an order without a stable identifier.");
  const soldAt = timestamp(order.createdAt), version = `${SHOPIFY_FINANCIAL_VERSION}:${timestamp(order.updatedAt)}`;
  const empty = (state: "voided" | "open") => ({ id: order.id, version, soldAt, state, total: 0, tax: 0, discount: 0, unitsMilli: 0, lines: [], payments: [] });
  // Authoritative tombstones replace an earlier sale; the source history stays retained.
  if (order.cancelledAt || order.test === true || order.displayFinancialStatus === "VOIDED") return empty("voided");
  if (["PENDING", "AUTHORIZED", "EXPIRED"].includes(order.displayFinancialStatus ?? "")) return empty("open");
  if (order.displayFinancialStatus !== "PAID") review("Shopify refunds or partial payments need reviewed allocation before reporting.");
  if (order.lineItems?.pageInfo?.hasNextPage !== false) review("Complete all Shopify order line pages before publication.");
  if (order.taxesIncluded !== false) review("Tax-inclusive Shopify item prices need reviewed line-tax allocation before reporting.");
  const total = shopifyMoney(order.currentTotalPriceSet?.shopMoney, currency);
  const tax = shopifyMoney(order.currentTotalTaxSet?.shopMoney, currency);
  const discount = shopifyMoney(order.currentTotalDiscountsSet?.shopMoney, currency);
  if (tax > total || shopifyMoney(order.totalRefundedSet?.shopMoney, currency) !== 0) review("Shopify tax or refund amounts need reviewed allocation before reporting.");
  const lines = order.lineItems.nodes.flatMap(line => {
    if (!line.id?.trim() || !Number.isSafeInteger(line.currentQuantity) || line.currentQuantity < 0 || !Number.isSafeInteger(line.quantity) || line.quantity < 0) review("Shopify returned an invalid item quantity.");
    if (line.currentQuantity === 0) return [];
    if (line.currentQuantity !== line.quantity) review("Changed Shopify quantities need complete current line amounts before reporting.");
    const quantity = line.currentQuantity * 1000;
    if (!Number.isSafeInteger(quantity)) review("Shopify item quantity exceeds supported precision.");
    return [{ ...line, quantity, net: shopifyMoney(line.discountedTotalSet?.shopMoney, currency), discount: shopifyMoney(line.totalDiscountSet?.shopMoney, currency) }];
  });
  if (new Set(lines.map(line => line.id)).size !== lines.length) review("Shopify returned duplicate item identifiers.");
  if (exactShopifySum(lines.map(line => line.net)) !== total - tax || exactShopifySum(lines.map(line => line.discount)) !== discount) {
    review("Shopify item and order totals do not reconcile. Shipping, tips and other adjustments require reviewed allocation.");
  }
  const payments = order.transactions.filter(item => item.status === "SUCCESS" && ["SALE", "CAPTURE"].includes(item.kind ?? "")).map(item => {
    if (!item.id?.trim() || !item.processedAt) review("Shopify payments require stable identifiers and recorded dates.");
    return { ...item, paidAt: timestamp(item.processedAt), amount: shopifyMoney(item.amountSet?.shopMoney, currency) };
  });
  if (new Set(payments.map(item => item.id)).size !== payments.length) review("Shopify returned duplicate payment identifiers.");
  return { id: order.id, version, soldAt, state: "completed" as const, total, tax, discount,
    unitsMilli: exactShopifySum(lines.map(line => line.quantity)), lines, payments };
}
