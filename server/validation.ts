import { ApiError } from "./api";

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}$/;
const PHONE = /^[0-9+().\-\s]{0,30}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const IDEMPOTENCY_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const industries = ["Retail", "Food & beverage", "Health & wellness", "Professional services", "Hospitality", "E-commerce", "Other"] as const;
const timezones = ["America/Edmonton", "America/Vancouver", "America/Toronto", "America/Halifax", "America/St_Johns", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"] as const;
const canadianRegions = ["AB", "BC", "MB", "NB", "NL", "NT", "NS", "NU", "ON", "PE", "QC", "SK", "YT"] as const;
const usRegions = ["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"] as const;
const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
const posProviders = ["", "Lightspeed", "Square", "Moneris", "Shopify POS", "Clover", "Other POS"] as const;

function rejectUnknown(value: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new ApiError(400, "UNKNOWN_FIELD", `Unexpected field: ${unknown[0]}.`);
}

function requiredString(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string") throw new ApiError(400, "INVALID_FIELD", `Enter a valid ${label}.`);
  const normalized = value.trim().normalize("NFC");
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new ApiError(400, "INVALID_FIELD", `Enter a valid ${label}.`);
  }
  return normalized;
}

function optionalString(value: unknown, label: string, maximum: number): string {
  if (value === undefined || value === null || value === "") return "";
  return requiredString(value, label, maximum);
}

function selected<T extends readonly string[]>(value: unknown, allowed: T, label: string): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new ApiError(400, "INVALID_FIELD", `Select a valid ${label}.`);
  }
  return value as T[number];
}

function validWebsite(value: unknown): string {
  const website = optionalString(value, "website", 200);
  if (!website) return "";
  try {
    const url = new URL(website);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("protocol");
    return url.toString();
  } catch {
    throw new ApiError(400, "INVALID_FIELD", "Enter a valid website URL beginning with https://.");
  }
}

export type BusinessHour = {
  day: (typeof days)[number];
  open: string;
  close: string;
  closed: boolean;
};

function businessHours(value: unknown): BusinessHour[] {
  if (!Array.isArray(value) || value.length !== 7) {
    throw new ApiError(400, "INVALID_HOURS", "Provide business hours for every day of the week.");
  }
  const seen = new Set<string>();
  const normalized = value.map((item) => {
    if (!item || Array.isArray(item) || typeof item !== "object") {
      throw new ApiError(400, "INVALID_HOURS", "Provide valid business hours.");
    }
    const row = item as Record<string, unknown>;
    rejectUnknown(row, ["day", "open", "close", "closed"]);
    const day = selected(row.day, days, "day");
    if (seen.has(day)) throw new ApiError(400, "INVALID_HOURS", "Each day may appear only once.");
    seen.add(day);
    const closed = row.closed === true;
    const open = typeof row.open === "string" ? row.open : "";
    const close = typeof row.close === "string" ? row.close : "";
    if (!closed && (!TIME.test(open) || !TIME.test(close) || open >= close)) {
      throw new ApiError(400, "INVALID_HOURS", `Enter valid opening and closing times for ${day}.`);
    }
    return { day, open: closed ? "" : open, close: closed ? "" : close, closed };
  });
  if (seen.size !== 7) throw new ApiError(400, "INVALID_HOURS", "Provide each day exactly once.");
  return normalized;
}

export function onboardingInput(value: Record<string, unknown>) {
  rejectUnknown(value, [
    "ownerName", "businessName", "legalName", "businessEmail", "phone", "website", "industry",
    "country", "province", "city", "address", "postalCode", "timezone", "currency",
    "fiscalYearStart", "taxNumber", "hours", "sourceMode", "selectedPos", "emailNotifications",
  ]);

  const businessEmail = requiredString(value.businessEmail, "business email", 254).toLowerCase();
  if (!EMAIL.test(businessEmail)) throw new ApiError(400, "INVALID_FIELD", "Enter a valid business email.");
  const phone = optionalString(value.phone, "phone number", 30);
  if (!PHONE.test(phone)) throw new ApiError(400, "INVALID_FIELD", "Enter a valid phone number.");
  const country = selected(value.country ?? "CA", ["CA", "US"] as const, "country");
  const postalCode = requiredString(value.postalCode, country === "CA" ? "postal code" : "ZIP code", 12).toUpperCase();
  const validPostal = country === "CA" ? /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d$/.test(postalCode) : /^\d{5}(?:-\d{4})?$/.test(postalCode);
  if (!validPostal) throw new ApiError(400, "INVALID_FIELD", `Enter a valid ${country === "CA" ? "Canadian postal code" : "U.S. ZIP code"}.`);
  const province = country === "CA" ? selected(value.province, canadianRegions, "province or territory") : selected(value.province, usRegions, "state");
  const sourceMode = selected(value.sourceMode ?? "connect_later", ["connect_later", "csv", "live"] as const, "data source mode");
  const selectedPos = selected(value.selectedPos ?? "", posProviders, "POS provider");
  if (sourceMode === "live" && !selectedPos) throw new ApiError(400, "INVALID_FIELD", "Select a POS provider to connect.");

  return {
    ownerName: requiredString(value.ownerName, "owner name", 120),
    businessName: requiredString(value.businessName, "business name", 120),
    legalName: requiredString(value.legalName, "legal business name", 160),
    businessEmail,
    phone,
    website: validWebsite(value.website),
    industry: selected(value.industry, industries, "industry"),
    country,
    province,
    city: requiredString(value.city, "city", 100),
    address: requiredString(value.address, "street address", 180),
    postalCode,
    timezone: selected(value.timezone, timezones, "timezone"),
    currency: selected(value.currency, ["CAD", "USD"] as const, "currency"),
    fiscalYearStart: selected(value.fiscalYearStart, months, "fiscal year start"),
    taxNumber: optionalString(value.taxNumber, "tax number", 32),
    hoursJson: JSON.stringify(businessHours(value.hours)),
    sourceMode,
    selectedPos,
    emailNotifications: value.emailNotifications !== false,
  };
}

export function taskCreateInput(value: Record<string, unknown>) {
  rejectUnknown(value, ["title", "detail", "priority", "assignee", "dueDate", "sourceType", "sourceRef", "expectedImpact"]);
  const dueDate = optionalString(value.dueDate, "due date", 10);
  if (dueDate && !DATE.test(dueDate)) throw new ApiError(400, "INVALID_FIELD", "Enter a valid due date.");
  return {
    title: requiredString(value.title, "task title", 120),
    detail: optionalString(value.detail, "task details", 2_000),
    priority: selected(value.priority ?? "medium", ["high", "medium", "low"] as const, "priority"),
    assignee: optionalString(value.assignee, "assignee", 80) || "Owner",
    dueDate: dueDate || null,
    sourceType: selected(value.sourceType ?? "manual", ["manual", "insight", "alert", "decision"] as const, "task source"),
    sourceRef: optionalString(value.sourceRef, "task source reference", 120) || null,
    expectedImpact: optionalString(value.expectedImpact, "expected impact", 500),
  };
}

export function taskUpdateInput(value: Record<string, unknown>) {
  rejectUnknown(value, ["id", "status"]);
  if (!Number.isSafeInteger(value.id) || Number(value.id) <= 0) {
    throw new ApiError(400, "INVALID_FIELD", "Select a valid task.");
  }
  return {
    id: Number(value.id),
    status: selected(value.status, ["open", "in_progress", "done"] as const, "task status"),
  };
}

export function idempotencyKey(request: Request): string {
  const value = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!IDEMPOTENCY_KEY.test(value)) {
    throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required.");
  }
  return value;
}

function integerValue(value: unknown, label: string, minimum: number, maximum = 1_000_000_000_000): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new ApiError(400, "INVALID_FIELD", `Enter a valid ${label}.`);
  }
  return Number(value);
}

function nullableInteger(value: unknown, label: string, minimum: number): number | null {
  if (value === undefined || value === null || value === "") return null;
  return integerValue(value, label, minimum);
}

export type DailyMetricInput = ReturnType<typeof dailyMetricRow>;

function dailyMetricRow(value: unknown) {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new ApiError(400, "INVALID_ROW", "Each daily metric row must be an object.");
  }
  const row = value as Record<string, unknown>;
  rejectUnknown(row, [
    "businessDate", "locationRef", "grossSalesCents", "netSalesCents", "costOfGoodsCents",
    "transactionCount", "unitsSold", "refundsCents", "discountsCents", "labourCostCents",
    "inventoryValueCents", "cashBalanceCents", "accountsPayableCents",
  ]);
  const businessDate = requiredString(row.businessDate, "business date", 10);
  if (!DATE.test(businessDate) || Number.isNaN(Date.parse(`${businessDate}T00:00:00Z`))) {
    throw new ApiError(400, "INVALID_FIELD", "Enter a valid business date.");
  }
  const grossSalesCents = integerValue(row.grossSalesCents, "gross sales amount", 0);
  const netSalesCents = integerValue(row.netSalesCents, "net sales amount", 0);
  if (netSalesCents > grossSalesCents) {
    throw new ApiError(400, "INVALID_FIELD", "Net sales cannot exceed gross sales.");
  }
  return {
    businessDate,
    locationRef: optionalString(row.locationRef, "location reference", 80) || "all",
    grossSalesCents,
    netSalesCents,
    costOfGoodsCents: integerValue(row.costOfGoodsCents, "cost of goods amount", 0),
    transactionCount: integerValue(row.transactionCount, "transaction count", 0, 10_000_000),
    unitsSold: integerValue(row.unitsSold, "units sold", 0, 100_000_000),
    refundsCents: integerValue(row.refundsCents ?? 0, "refund amount", 0),
    discountsCents: integerValue(row.discountsCents ?? 0, "discount amount", 0),
    labourCostCents: integerValue(row.labourCostCents ?? 0, "labour cost", 0),
    inventoryValueCents: nullableInteger(row.inventoryValueCents, "inventory value", 0),
    cashBalanceCents: nullableInteger(row.cashBalanceCents, "cash balance", -1_000_000_000_000),
    accountsPayableCents: nullableInteger(row.accountsPayableCents, "accounts payable", 0),
  };
}

export function dailyMetricImportInput(value: Record<string, unknown>) {
  rejectUnknown(value, ["importType", "fileName", "rows"]);
  const importType = selected(value.importType ?? "daily_summary_csv", ["daily_summary_csv", "manual_entry"] as const, "import type");
  const fileName = optionalString(value.fileName, "file name", 140);
  if (!Array.isArray(value.rows) || value.rows.length < 1 || value.rows.length > 366) {
    throw new ApiError(400, "INVALID_ROWS", "Provide between 1 and 366 daily metric rows per import.");
  }
  const rows = value.rows.map(dailyMetricRow);
  const keys = new Set<string>();
  for (const row of rows) {
    const key = `${row.businessDate}:${row.locationRef}`;
    if (keys.has(key)) throw new ApiError(400, "DUPLICATE_ROW", "An import cannot repeat the same date and location.");
    keys.add(key);
  }
  return { importType, fileName, rows };
}

export function businessEventCreateInput(value: Record<string, unknown>) {
  rejectUnknown(value, ["eventType", "title", "detail", "eventDate", "expectedOutcome", "reviewDate"]);
  const eventDate = requiredString(value.eventDate, "event date", 10);
  const reviewDate = optionalString(value.reviewDate, "review date", 10);
  if (!DATE.test(eventDate) || (reviewDate && !DATE.test(reviewDate))) {
    throw new ApiError(400, "INVALID_FIELD", "Enter valid event and review dates.");
  }
  if (reviewDate && reviewDate < eventDate) {
    throw new ApiError(400, "INVALID_FIELD", "The review date cannot be before the event date.");
  }
  return {
    eventType: selected(value.eventType, ["decision", "promotion", "hours", "staffing", "supplier_price", "stockout", "competitor", "construction", "other"] as const, "event type"),
    title: requiredString(value.title, "event title", 120),
    detail: optionalString(value.detail, "event details", 2_000),
    eventDate,
    expectedOutcome: optionalString(value.expectedOutcome, "expected outcome", 500),
    reviewDate: reviewDate || null,
  };
}
