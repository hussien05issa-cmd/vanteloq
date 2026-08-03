import { ApiError } from "./api";

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}$/;
const PHONE = /^[0-9+().\-\s]{0,30}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const IDEMPOTENCY_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const industries = ["Retail", "Food & beverage", "Health & wellness", "Professional services", "Hospitality", "E-commerce", "Other"] as const;
const timezones = ["America/Edmonton", "America/Vancouver", "America/Toronto", "America/Halifax"] as const;
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
    "fiscalYearStart", "taxNumber", "hours", "sourceMode", "selectedPos",
  ]);

  const businessEmail = requiredString(value.businessEmail, "business email", 254).toLowerCase();
  if (!EMAIL.test(businessEmail)) throw new ApiError(400, "INVALID_FIELD", "Enter a valid business email.");
  const phone = optionalString(value.phone, "phone number", 30);
  if (!PHONE.test(phone)) throw new ApiError(400, "INVALID_FIELD", "Enter a valid phone number.");
  const postalCode = requiredString(value.postalCode, "postal code", 12).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9 -]{1,10}[A-Z0-9]$/.test(postalCode)) {
    throw new ApiError(400, "INVALID_FIELD", "Enter a valid postal code.");
  }
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
    country: selected(value.country ?? "Canada", ["Canada", "United States"] as const, "country"),
    province: requiredString(value.province, "province or state", 80),
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
  };
}

export function taskCreateInput(value: Record<string, unknown>) {
  rejectUnknown(value, ["title", "detail", "priority", "assignee", "dueDate"]);
  const dueDate = optionalString(value.dueDate, "due date", 10);
  if (dueDate && !DATE.test(dueDate)) throw new ApiError(400, "INVALID_FIELD", "Enter a valid due date.");
  return {
    title: requiredString(value.title, "task title", 120),
    detail: optionalString(value.detail, "task details", 2_000),
    priority: selected(value.priority ?? "medium", ["high", "medium", "low"] as const, "priority"),
    assignee: optionalString(value.assignee, "assignee", 80) || "Owner",
    dueDate: dueDate || null,
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

