// Provider evidence helpers. Unknown values stay reviewable instead of becoming zero.
export class CloverSourceEvidenceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CloverSourceEvidenceError";
    this.code = code;
  }
}

function review(code: string, message: string): never {
  throw new CloverSourceEvidenceError(code, message);
}

function object(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function sourceNumber(value: unknown): number | null {
  if (value == null || typeof value === "boolean") return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sourceInteger(value: unknown): number | null {
  const number = sourceNumber(value);
  return number != null && Number.isSafeInteger(number) ? number : null;
}

function expanded(value: unknown): Record<string, unknown>[] | null {
  const elements = Array.isArray(value) ? value : object(value).elements;
  if (!Array.isArray(elements)) return null;
  if (elements.some((entry) => entry == null || typeof entry !== "object" || Array.isArray(entry))) return null;
  return elements as Record<string, unknown>[];
}

export function cloverLineQuantityMilli(line: Record<string, unknown>): number {
  if (line.quantitySold != null) {
    const quantity = sourceNumber(line.quantitySold);
    if (quantity == null || quantity < 0) {
      return review("CLOVER_QUANTITY_INVALID", "Clover supplied an invalid reporting quantity.");
    }
    const scaled = quantity * 1000;
    const rounded = Math.round(scaled);
    if (!Number.isSafeInteger(rounded) || Math.abs(scaled - rounded) > 1e-7) {
      return review("CLOVER_QUANTITY_PRECISION", "Clover quantity exceeds supported precision.");
    }
    return rounded;
  }
  // This must be the source line's price type, not today's mutable catalog value.
  const priceType = text(object(line.item).priceType);
  if (priceType === "PER_UNIT") {
    const quantity = sourceInteger(line.unitQty);
    if (quantity == null || quantity < 0) {
      return review("CLOVER_QUANTITY_INVALID", "Clover PER_UNIT quantity is missing or invalid.");
    }
    return quantity;
  }
  if (priceType === "FIXED" || priceType === "VARIABLE") return 1000;
  if (line.unitQty == null && line.unitName == null) return 1000;
  return review("CLOVER_QUANTITY_EVIDENCE_REQUIRED", "Clover line quantity needs its reporting quantity or source price type.");
}

function discountGroup(calculated: unknown, values: unknown): number | null {
  if (calculated != null) {
    const amount = sourceInteger(calculated);
    if (amount == null) return review("CLOVER_DISCOUNT_INVALID", "Clover supplied an invalid discount amount.");
    return Math.abs(amount);
  }
  const discounts = expanded(values);
  if (discounts == null) return null;
  let total = 0;
  for (const discount of discounts) {
    const amount = sourceInteger(discount.amount);
    if (amount == null) {
      return review("CLOVER_DISCOUNT_ALLOCATION_REQUIRED", "Clover discount needs its calculated amount.");
    }
    total += Math.abs(amount);
    if (!Number.isSafeInteger(total)) return review("CLOVER_DISCOUNT_INVALID", "Clover discount total exceeds supported precision.");
  }
  return total;
}

export function cloverLineDiscountCents(line: Record<string, unknown>): number {
  const item = discountGroup(line.discountAmount, line.discounts);
  const order = discountGroup(line.orderLevelDiscountAmount, line.orderLevelDiscounts);
  if (item == null || order == null) {
    return review("CLOVER_DISCOUNT_EVIDENCE_REQUIRED", "Clover discount details are not complete enough for reporting.");
  }
  const total = item + order;
  if (!Number.isSafeInteger(total)) return review("CLOVER_DISCOUNT_INVALID", "Clover discount total exceeds supported precision.");
  return total;
}

export function cloverLineNetSalesCents(line: Record<string, unknown>, quantityMilli: number, discountCents: number): number {
  const netReporting = line.priceWithModifiersAndItemAndOrderDiscounts;
  const modifierReporting = line.priceWithModifiers;
  const supplied = netReporting ?? modifierReporting ?? line.price;
  const price = sourceInteger(supplied);
  if (price == null || price < 0) return review("CLOVER_LINE_AMOUNT_REQUIRED", "Clover line amount is missing or invalid.");
  if (netReporting != null) return price;
  if (modifierReporting == null && (expanded(line.modifications)?.length ?? 0) > 0) {
    return review("CLOVER_LINE_AMOUNT_REQUIRED", "Clover modified line needs its calculated reporting amount.");
  }
  const base = modifierReporting != null ? price : Math.round(price * quantityMilli / 1000);
  const net = base - discountCents;
  if (!Number.isSafeInteger(net) || net < 0) return review("CLOVER_LINE_AMOUNT_REQUIRED", "Clover line amount does not reconcile with its discounts.");
  return net;
}

export function cloverOrderReportingState(order: Record<string, unknown>): "completed" | "open" | "voided" {
  const state = text(order.state);
  if ((sourceInteger(order.deletedTimestamp) ?? 0) > 0 ||
      ["DELETED", "VOIDED", "CANCELLED", "CANCELED"].includes(state)) return "voided";
  const paymentState = text(order.paymentState);
  if (paymentState === "PAID") return "completed";
  if (paymentState === "OPEN" || paymentState === "PARTIALLY_PAID") return "open";
  if (["REFUNDED", "PARTIALLY_REFUNDED", "CREDITED"].includes(paymentState)) {
    return review("CLOVER_REFUND_REVIEW_REQUIRED", "Clover refund and credit records need reconciliation before reporting.");
  }
  return review("CLOVER_ORDER_STATUS_REQUIRED", "Clover payment status is missing or unsupported; a locked order is not proof of payment.");
}

export function cloverPaymentDisposition(payment: Record<string, unknown>): "posted" | "not_posted" {
  const result = text(payment.result);
  if (payment.voided != null && typeof payment.voided !== "boolean") {
    return review("CLOVER_PAYMENT_STATUS_REQUIRED", "Clover payment void status is invalid.");
  }
  if (payment.voided === true || result === "VOIDED") return "not_posted";
  if (object(payment.voidPaymentRef).id != null) {
    return review("CLOVER_PAYMENT_VOID_REVIEW_REQUIRED", "Clover linked payment void needs reconciliation.");
  }
  if (result === "SUCCESS") return "posted";
  if (["FAIL", "INITIATED", "PENDING", "AUTH", "OFFLINE_RETRYING"].includes(result)) return "not_posted";
  return review("CLOVER_PAYMENT_STATUS_REQUIRED", "Clover payment result needs reconciliation before reporting.");
}

// Scope quantity evidence to the same merchant connection and latest staged order.
// Missing/extra canonical lines remain unknown; an explicitly empty order is zero.
export const CLOVER_LATEST_SALES_SQL = `
  SELECT sale.external_sale_id externalSaleId, sale.outlet_ref outletRef, sale.sold_at soldAt, sale.state,
    sale.total_cents totalCents, sale.tax_cents taxCents, sale.cost_cents costCents,
    sale.discount_cents discountCents, sale.line_count lineCount, sale.external_version externalVersion,
    sale.source_payload_hash sourcePayloadHash,
    (SELECT CASE WHEN COUNT(*)=sale.line_count AND COUNT(*)=COUNT(line.quantity_milli)
      THEN CASE WHEN COUNT(*)=0 THEN 0 ELSE SUM(line.quantity_milli) END ELSE NULL END
      FROM commerce_sale_lines line
      WHERE line.organization_id=sale.organization_id AND line.provider=sale.provider
        AND line.connection_id=sale.connection_id AND line.external_sale_id=sale.external_sale_id) quantityMilli
  FROM (SELECT *, row_number() OVER (PARTITION BY external_sale_id ORDER BY staged_at DESC, id DESC) rank
    FROM integration_staged_sales WHERE organization_id=? AND provider=? AND connection_id=?) sale WHERE rank=1
`;
