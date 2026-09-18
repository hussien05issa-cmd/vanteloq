import { ApiError } from "../server/api";
import { isCalendarDate } from "./calendar-date";
import { invoiceLineAmounts, invoiceTotals } from "./invoice-amounts";

const CURRENCY = /^[A-Z]{3}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}$/;

export type InvoiceParty = {
  name: string;
  address: string;
  email: string;
  phone: string;
  taxNumber: string;
};

export type InvoiceLineInput = {
  description: string;
  quantityMilli: number;
  unitPriceCents: number;
  taxRateBasisPoints: number;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
};

export type CustomerInvoiceInput = {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  currency: string;
  locationRef: string;
  purchaseOrderRef: string;
  issuer: InvoiceParty;
  customerId: string | null;
  customer: InvoiceParty;
  notes: string;
  paymentInstructions: string;
  lines: InvoiceLineInput[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
};

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new ApiError(400, "INVALID_INVOICE", `${label} is required.`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknown(value: Record<string, unknown>, allowed: readonly string[]) {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw new ApiError(400, "UNKNOWN_FIELD", `Unexpected invoice field: ${unknown}.`);
}

function text(value: unknown, label: string, maximum: number, required = true, multiline = false): string {
  if (typeof value !== "string") {
    if (!required && (value === undefined || value === null)) return "";
    throw new ApiError(400, "INVALID_INVOICE", `Enter a valid ${label}.`);
  }
  const normalized = value.replace(/\r\n?/g, "\n").trim().normalize("NFC");
  const controls = multiline ? /[\u0000-\u0009\u000b-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/;
  if ((required && !normalized) || normalized.length > maximum || controls.test(normalized)) {
    throw new ApiError(400, "INVALID_INVOICE", `Enter a valid ${label}.`);
  }
  return normalized;
}

function safeInteger(value: unknown, label: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) {
    throw new ApiError(400, "INVALID_INVOICE", `Enter a valid ${label}.`);
  }
  return Number(value);
}

function party(value: unknown, label: string): InvoiceParty {
  const input = object(value, label);
  rejectUnknown(input, ["name", "address", "email", "phone", "taxNumber"]);
  const email = text(input.email, `${label} email`, 254, false);
  if (email && !EMAIL.test(email)) throw new ApiError(400, "INVALID_INVOICE", `Enter a valid ${label} email.`);
  return {
    name: text(input.name, `${label} name`, 180),
    address: text(input.address, `${label} address`, 500, true, true),
    email,
    phone: text(input.phone, `${label} phone`, 60, false),
    taxNumber: text(input.taxNumber, `${label} tax number`, 80, false),
  };
}

export function parseCustomerInvoice(value: unknown): CustomerInvoiceInput {
  const input = object(value, "Invoice");
  rejectUnknown(input, ["invoiceNumber", "invoiceDate", "dueDate", "currency", "locationRef", "purchaseOrderRef", "issuer", "customerId", "customer", "notes", "paymentInstructions", "lines"]);
  const invoiceDate = text(input.invoiceDate, "invoice date", 10);
  const dueDate = text(input.dueDate, "due date", 10);
  if (!isCalendarDate(invoiceDate)) throw new ApiError(400, "INVALID_INVOICE", "Enter a valid invoice date.");
  if (!isCalendarDate(dueDate) || dueDate < invoiceDate) throw new ApiError(400, "INVALID_INVOICE", "The due date must be on or after the invoice date.");
  const currency = text(input.currency, "currency", 3).toUpperCase();
  if (!CURRENCY.test(currency)) throw new ApiError(400, "INVALID_INVOICE", "Enter a valid three-letter currency code.");
  if (!Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > 100) {
    throw new ApiError(400, "INVALID_INVOICE", "An invoice requires between 1 and 100 line items.");
  }
  const lines = input.lines.map((raw, index) => {
    const line = object(raw, `Line ${index + 1}`);
    rejectUnknown(line, ["description", "quantityMilli", "unitPriceCents", "taxRateBasisPoints"]);
    const quantityMilli = safeInteger(line.quantityMilli, `quantity for line ${index + 1}`, 1_000_000_000);
    if (quantityMilli <= 0) throw new ApiError(400, "INVALID_INVOICE", `Line ${index + 1} requires a quantity greater than zero.`);
    const unitPriceCents = safeInteger(line.unitPriceCents, `unit price for line ${index + 1}`, 100_000_000_000);
    const taxRateBasisPoints = safeInteger(line.taxRateBasisPoints ?? 0, `tax rate for line ${index + 1}`, 10_000);
    let amounts;
    try { amounts = invoiceLineAmounts(quantityMilli, unitPriceCents, taxRateBasisPoints); }
    catch { throw new ApiError(400, "INVALID_INVOICE", `Line ${index + 1} exceeds the supported amount.`); }
    return {
      description: text(line.description, `description for line ${index + 1}`, 500),
      quantityMilli,
      unitPriceCents,
      taxRateBasisPoints,
      ...amounts,
    };
  });
  let totals;
  try { totals = invoiceTotals(lines); }
  catch { throw new ApiError(400, "INVALID_INVOICE", "The invoice exceeds the supported amount."); }
  const customerId = input.customerId === null || input.customerId === undefined || input.customerId === "" ? null : text(input.customerId, "customer", 180);
  return {
    invoiceNumber: text(input.invoiceNumber, "invoice number", 80),
    invoiceDate,
    dueDate,
    currency,
    locationRef: text(input.locationRef ?? "all", "location", 180, false) || "all",
    purchaseOrderRef: text(input.purchaseOrderRef, "purchase order reference", 120, false),
    issuer: party(input.issuer, "business"),
    customerId,
    customer: party(input.customer, "customer"),
    notes: text(input.notes, "invoice notes", 2_000, false, true),
    paymentInstructions: text(input.paymentInstructions, "payment instructions", 2_000, false, true),
    lines,
    ...totals,
  };
}
