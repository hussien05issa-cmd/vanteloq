import { businessDateForTimestamp } from "../../domain/intraday-sales";
import { normalizeLightspeedSale, sha256Hex, type NormalizedLightspeedSale } from "./lightspeed";

export const xObject = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const xText = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim().slice(0, 240) : null;
const requiredText = (value: unknown) => { const text = xText(value); if (!text) throw new Error("Required provider identifier is missing"); return text; };
function number(value: unknown): number | null {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) > 1_000_000_000) throw new Error("Provider numeric value is invalid");
  return n;
}
export const xCents = (value: unknown) => { const n = number(value); return n === null ? null : Math.sign(n) * Math.round((Math.abs(n) + Number.EPSILON) * 100); };
const quantityMilli = (value: unknown) => { const n = number(value); if (n === null) throw new Error("Quantity is missing"); return Math.round(n * 1000); };
const extended = (total: unknown, unit: unknown, quantity: number) => xCents(total) ?? (number(unit) === null ? null : xCents(number(unit)! * quantity / 1000));
const timestamp = (value: unknown) => { const text = requiredText(value); if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) || !Number.isFinite(Date.parse(text))) throw new Error("Sale timestamp is invalid"); return new Date(text).toISOString(); };
const rows = (value: unknown) => { if (!Array.isArray(value) || value.some(row => !row || typeof row !== "object" || Array.isArray(row))) throw new Error("Provider collection is incomplete"); return value as Record<string, unknown>[]; };

export async function normalizeXCommerceSale(raw: Record<string, unknown>) {
  const sale = await normalizeLightspeedSale(raw);
  if (!/^\d+$/.test(sale.externalVersion) || !Number.isSafeInteger(Number(sale.externalVersion)) || !sale.outletRef) throw new Error("Sale version or outlet is missing");
  if (!["completed", "pending", "parked", "voided"].includes(sale.state)) throw new Error("Unknown sale state");
  // Tombstones and open receipts replace previously completed facts, without
  // manufacturing a trading timestamp or retaining their former lines.
  if (sale.state !== "completed") return { sale, lines: [], payments: [], missingCosts: 0 };
  sale.soldAt = timestamp(raw.date ?? raw.created_at);
  const rawLines = rows(raw.line_items);
  if (rawLines.length > 1000) throw new Error("Receipt exceeds the complete-import limit");
  const totals = xObject(raw.totals);
  if (xCents(totals.price) === null || xCents(totals.tax) === null) throw new Error("Sale totals are missing");
  if (sale.totalCents !== xCents(totals.price)! + sale.taxCents) throw new Error("Tax-inclusive sale total does not reconcile");
  const lines = await Promise.all(rawLines.map(async rawLine => {
    const pricing = xObject(rawLine.pricing), product = xObject(rawLine.product);
    const quantity = quantityMilli(rawLine.quantity);
    // Lightspeed pricing.total already includes its discounts and excludes tax.
    // Keep the provider's signed quantities and totals for returns and exchanges.
    const net = extended(pricing.total, pricing.price, quantity);
    if (net === null) throw new Error("Line price is missing");
    const cost = extended(pricing.cost_total, pricing.cost, quantity);
    const line = {
      externalSaleId: sale.externalSaleId, externalLineId: requiredText(rawLine.id),
      productRef: requiredText(product.id), customerRef: xText(raw.customer_id),
      outletRef: sale.outletRef!, soldAt: sale.soldAt!, sku: xText(product.sku), productName: xText(product.name),
      quantityMilli: quantity, netSalesCents: net, costCents: cost,
      discountCents: Math.abs(extended(pricing.discount_total, pricing.discount, quantity) ?? 0),
    };
    return { ...line, sourcePayloadHash: await sha256Hex(JSON.stringify(line)) };
  }));
  if (new Set(lines.map(line => line.externalLineId)).size !== lines.length) throw new Error("Duplicate receipt line identifiers");
  // Fail closed for unsupported charges or incomplete expansions. We do not
  // spread an unexplained sale-level amount across products or pretend it matches.
  if (lines.reduce((sum, line) => sum + line.netSalesCents, 0) !== xCents(totals.price)) throw new Error("Sale lines do not reconcile with the source net total");
  sale.costCents = lines.reduce((sum, line) => sum + (line.costCents ?? 0), 0);
  sale.discountCents = lines.reduce((sum, line) => sum + line.discountCents, 0);
  sale.sourcePayloadHash = await sha256Hex(JSON.stringify({ ...sale, sourcePayloadHash: undefined }));
  const payments = await Promise.all(rows(raw.payments ?? []).filter(payment => !payment.deleted_at).map(async rawPayment => {
    const type = xObject(rawPayment.type), amount = xCents(rawPayment.amount);
    if (amount === null) throw new Error("Payment amount is missing");
    const name = xText(type.name) ?? "Other", lower = name.toLowerCase();
    const category = /gift/.test(lower) ? "gift_card" : /store credit|on account/.test(lower) ? "store_credit" : /cash/.test(lower) ? "cash" : /card|visa|mastercard|amex|debit|eftpos/.test(lower) ? "card" : "other";
    const payment = { externalPaymentId: requiredText(rawPayment.id), externalSaleId: sale.externalSaleId, paymentTypeRef: xText(type.id), paymentTypeName: name, category, amountCents: amount, paidAt: timestamp(rawPayment.date ?? sale.soldAt), outletRef: sale.outletRef! };
    return { ...payment, sourcePayloadHash: await sha256Hex(JSON.stringify(payment)) };
  }));
  return { sale, lines, payments, missingCosts: lines.filter(line => line.costCents === null && line.quantityMilli !== 0).length };
}

export async function normalizeXProduct(raw: Record<string, unknown>) {
  const id = requiredText(raw.id), category = xObject(raw.product_category), legacyType = xObject(raw.type);
  const path = Array.isArray(category.category_path) ? category.category_path.map(item => xText(xObject(item).name)).filter(Boolean) : [];
  const leaf = xText(category.name); if (leaf && path.at(-1) !== leaf) path.push(leaf);
  const product = { externalProductId: id, sku: xText(raw.sku) ?? id, name: xText(raw.variant_name) ?? xText(raw.name) ?? "Archived product", categoryRef: xText(category.id) ?? xText(raw.product_type_id), categoryName: path.join(" / ") || xText(legacyType.name), supplierRef: xText(raw.supplier_id), defaultCostCents: xCents(raw.supply_price), defaultPriceCents: xCents(raw.price_excluding_tax), archived: Boolean(raw.deleted_at) || raw.active === false || raw.is_active === false, sourceUpdatedAt: xText(raw.updated_at) };
  return { ...product, sourcePayloadHash: await sha256Hex(JSON.stringify(product)) };
}

export function normalizeXInventory(raw: Record<string, unknown>) {
  const deleted = Boolean(raw.deleted_at), quantity = number(raw.current_inventory_level);
  if (!deleted && quantity === null) throw new Error("Inventory quantity is missing");
  return { productRef: requiredText(raw.product_id), outletRef: requiredText(raw.outlet_id), onHandQuantity: deleted ? 0 : quantity!, reorderPoint: number(raw.reorder_point) ?? 0 };
}

export async function normalizeXCustomer(raw: Record<string, unknown>) {
  const id = requiredText(raw.id), archived = Boolean(raw.deleted_at);
  // Do not import birth dates, free-text notes, tax IDs or marketing permissions.
  const row = { externalCustomerId: id, displayName: archived ? "Deleted customer" : [xText(raw.first_name), xText(raw.last_name)].filter(Boolean).join(" ") || xText(raw.company_name) || "Customer", firstName: archived ? null : xText(raw.first_name), lastName: archived ? null : xText(raw.last_name), archived, sourceUpdatedAt: xText(raw.updated_at) };
  return { ...row, sourcePayloadHash: await sha256Hex(JSON.stringify(row)) };
}

export async function normalizeXSupplier(raw: Record<string, unknown>) {
  const row = { externalSupplierId: requiredText(raw.id), name: xText(raw.name) ?? "Archived supplier", archived: Boolean(raw.deleted_at), sourceUpdatedAt: xText(raw.updated_at) };
  return { ...row, sourcePayloadHash: await sha256Hex(JSON.stringify(row)) };
}

export function buildXDailyMetrics(sales: Array<NormalizedLightspeedSale & { unitsMilli: number }>, timezone: string) {
  const result = new Map<string, { businessDate: string; locationRef: string; grossSalesCents: number; netSalesCents: number; costOfGoodsCents: number; transactionCount: number; unitsSold: number; refundsCents: number; discountsCents: number }>();
  for (const sale of sales) {
    if (sale.state !== "completed" || !sale.soldAt || !sale.outletRef) continue;
    const date = businessDateForTimestamp(sale.soldAt, timezone);
    if (!date) throw new Error("Invalid business timestamp");
    const key = `${date}:${sale.outletRef}`, net = sale.totalCents - sale.taxCents;
    const row = result.get(key) ?? { businessDate: date, locationRef: `lightspeed:${sale.outletRef}`, grossSalesCents: 0, netSalesCents: 0, costOfGoodsCents: 0, transactionCount: 0, unitsSold: 0, refundsCents: 0, discountsCents: 0 };
    row.netSalesCents += net; row.costOfGoodsCents += sale.costCents;
    row.unitsSold += Math.max(0, sale.unitsMilli / 1000);
    if (net < 0) row.refundsCents += -net;
    else { row.transactionCount++; row.grossSalesCents += net + sale.discountCents; row.discountsCents += sale.discountCents; }
    result.set(key, row);
  }
  return [...result.values()];
}
