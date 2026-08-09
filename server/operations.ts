import { ApiError } from "./api.ts";

export type PaymentLine = Readonly<{
  sku: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  lotId: string | null;
}>;

export type PaymentSettlement = Readonly<{
  sourceSystem: string;
  sourceEventId: string;
  paymentId: string;
  locationRef: string;
  customerEmail: string | null;
  currency: string;
  totalCents: number;
  occurredAt: Date;
  lines: readonly PaymentLine[];
}>;

export type OperationalWrite = Readonly<{
  eventId: string;
  movementId: string;
  sku: string;
  name: string;
  quantityDelta: number;
}>;

const text = (value: unknown, label: string, maximum: number): string => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maximum) {
    throw new ApiError(400, "INVALID_FIELD", `Enter a valid ${label}.`);
  }
  return value.trim();
};

const integer = (value: unknown, label: string, minimum: number, maximum: number): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new ApiError(400, "INVALID_FIELD", `Enter a valid ${label}.`);
  }
  return Number(value);
};

export function parsePaymentSettlement(value: Record<string, unknown>): PaymentSettlement {
  const allowed = new Set(["sourceSystem", "sourceEventId", "paymentId", "locationRef", "customerEmail", "currency", "totalCents", "occurredAt", "lines"]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new ApiError(400, "UNKNOWN_FIELD", `The field ${key} is not supported.`);
  if (!Array.isArray(value.lines) || value.lines.length < 1 || value.lines.length > 250) {
    throw new ApiError(400, "INVALID_LINES", "Provide between 1 and 250 payment lines.");
  }
  const lines = value.lines.map((candidate, index): PaymentLine => {
    if (!candidate || Array.isArray(candidate) || typeof candidate !== "object") throw new ApiError(400, "INVALID_LINE", `Payment line ${index + 1} is invalid.`);
    const row = candidate as Record<string, unknown>;
    for (const key of Object.keys(row)) if (!["sku", "name", "quantity", "unitPriceCents", "lotId"].includes(key)) throw new ApiError(400, "UNKNOWN_FIELD", `Payment line field ${key} is not supported.`);
    return {
      sku: text(row.sku, "SKU", 96),
      name: text(row.name, "item name", 180),
      quantity: integer(row.quantity, "quantity", 1, 100_000),
      unitPriceCents: integer(row.unitPriceCents, "unit price", 0, 100_000_000),
      lotId: row.lotId == null || row.lotId === "" ? null : text(row.lotId, "inventory lot", 100),
    };
  });
  const calculatedTotal = lines.reduce((sum, line) => sum + line.quantity * line.unitPriceCents, 0);
  const totalCents = integer(value.totalCents, "payment total", 0, 1_000_000_000_000);
  if (calculatedTotal !== totalCents) throw new ApiError(409, "TOTAL_MISMATCH", "Payment lines do not equal the settled total.");
  const occurredAtText = text(value.occurredAt, "event time", 40);
  const occurredAt = new Date(occurredAtText);
  if (Number.isNaN(occurredAt.valueOf()) || occurredAt.valueOf() > Date.now() + 300_000) throw new ApiError(400, "INVALID_FIELD", "Enter a valid event time.");
  const customerEmail = value.customerEmail == null || value.customerEmail === "" ? null : text(value.customerEmail, "customer email", 254).toLowerCase();
  if (customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) throw new ApiError(400, "INVALID_FIELD", "Enter a valid customer email.");
  const currency = text(value.currency, "currency", 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new ApiError(400, "INVALID_FIELD", "Enter a valid ISO currency code.");
  return {
    sourceSystem: text(value.sourceSystem, "source system", 64).toLowerCase(),
    sourceEventId: text(value.sourceEventId, "source event ID", 180),
    paymentId: text(value.paymentId, "payment ID", 180),
    locationRef: text(value.locationRef, "location", 96),
    customerEmail,
    currency,
    totalCents,
    occurredAt,
    lines,
  };
}

export function eventKey(organizationId: string, settlement: PaymentSettlement): string {
  return `payment:${organizationId}:${settlement.sourceSystem}:${settlement.sourceEventId}`;
}

export function buildInventoryWrites(eventId: string, settlement: PaymentSettlement): OperationalWrite[] {
  return settlement.lines.map((line, index) => ({
    eventId,
    movementId: `${eventId}:movement:${index + 1}`,
    sku: line.sku,
    name: line.name,
    quantityDelta: -line.quantity,
  }));
}

export function confirmationCopy(settlement: PaymentSettlement): { subject: string; bodyText: string } {
  const formatted = new Intl.NumberFormat("en-CA", { style: "currency", currency: settlement.currency }).format(settlement.totalCents / 100);
  return {
    subject: `Payment confirmation ${settlement.paymentId}`,
    bodyText: `Your payment of ${formatted} was received. Reference: ${settlement.paymentId}.`,
  };
}
