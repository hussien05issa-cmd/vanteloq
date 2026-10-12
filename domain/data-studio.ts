import { isCalendarDate } from "./calendar-date.ts";
import { exactSum } from "./executive-metrics.ts";

export const STUDIO_VERSION = "studio-v1";
export const STUDIO_MAX_RECORDS = 2000;
export const STUDIO_MAX_RESULT_BYTES = 2 * 1024 * 1024;
export const STUDIO_MAX_DAYS = 366;
export type StudioScope = { from: string; to: string; location: string | null; connection: string | null };
export type StudioSalesRow = {
  id: string; businessDate: string; locationRef: string; sourceKind: "owner_summary" | "provider_summary";
  netSalesCents: number; transactionCount: number; unitsSold: number;
  costOfGoodsCents?: number | null; discountsCents?: number; refundsCents?: number;
  sourceProvider?: string; sourceConnectionId?: string | null; sourceImportId?: string | null; updatedUtc?: string;
};
export type StudioSummary = ReturnType<typeof studioSalesSummary>;
export type StudioExecutiveReview = {
  version: typeof STUDIO_VERSION;
  metadata: {
    organizationId: string; currency: string; timeZone: string; from: string; to: string;
    locationIds: string[]; generatedUtc: string; extractionUtc: string; specificationHash: string;
    snapshotHash: string; consistency: "component_read_transactions"; calculationVersion: string;
    dataMode: "stored_records"; rowCount: number; limit: number; truncated: false; canExport: boolean;
    sourceAuthority: string; providerHistoryCertified: false;
    recordedDayCount: number; calendarDayCount: number; latestRecordUpdateUtc: string | null;
  };
  sales: { state: "recorded" | "unavailable"; reason: string | null; rows: StudioSalesRow[]; summary: StudioSummary | null };
  margin: { state: "recorded" | "unavailable" | "restricted"; reason: string | null };
  inventory: { state: "recorded" | "unavailable" | "restricted"; reason: string; ledgerCents?: number };
  cash: { state: "recorded" | "unavailable" | "restricted"; reason: string; ledgerCents?: number };
  ledger?: { generatedUtc: string; lastPostedUtc: string | null; dataMode: "live" | "demonstration"; revisionHash: string;
    from: string; to: string; calculationVersion: string; boundary: string; foreignCurrencyEntriesExcluded: number;
    revenueCents: number; grossProfitCents: number; operatingProfitCents: number; netEarningsCents: number;
    assetsCents: number; liabilitiesCents: number; equityCents: number; balanceDifferenceCents: number };
  limitations: string[];
};

export class StudioValidationError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "StudioValidationError"; }
}

export function validateStudioScope(value: unknown, today: string): StudioScope {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new StudioValidationError("STUDIO_SCOPE_INVALID", "Choose a valid analysis period and location.");
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some(key => !["from", "to", "location", "connection"].includes(key))) throw new StudioValidationError("STUDIO_SCOPE_INVALID", "Use only the supported scope fields. Business authority comes from your signed-in account.");
  const { from, to } = raw;
  if (!isCalendarDate(from) || !isCalendarDate(to) || from < "1900-01-01" || to < from || to > today || (Date.parse(to) - Date.parse(from)) / 86400000 + 1 > STUDIO_MAX_DAYS) throw new StudioValidationError("STUDIO_PERIOD_INVALID", `Choose valid dates ending no later than today, covering at most ${STUDIO_MAX_DAYS} days.`);
  const ref = (value: unknown) => {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string" || value.length > 180 || /[\u0000-\u001f\u007f]/.test(value)) throw new StudioValidationError("STUDIO_SCOPE_INVALID", "Choose a valid reporting location or connection.");
    return value;
  };
  return { from, to, location: ref(raw.location), connection: ref(raw.connection) };
}

/** Existing daily-record writers use Unix seconds or legacy milliseconds.
 * Match the established owner-cost instant convention without changing records. */
export function studioRecordedUtc(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new StudioValidationError("STUDIO_SOURCE_INVALID", "A recorded update time needs review.");
  const milliseconds = value < 100_000_000_000 ? value * 1000 : value;
  if (!Number.isSafeInteger(milliseconds) || milliseconds > 8_640_000_000_000_000) throw new StudioValidationError("STUDIO_SOURCE_INVALID", "A recorded update time needs review.");
  return new Date(milliseconds).toISOString();
}

function exact(value: number, nonnegative = false) {
  if (!Number.isSafeInteger(value) || (nonnegative && value < 0)) throw new StudioValidationError("STUDIO_AMOUNT_INVALID", "A source value exceeds exact supported units. Review it before analysing or exporting.");
  return value;
}

/** POS quantities use thousandths. Normalize only floating accumulation noise;
 * a fourth decimal or a quantity outside the declared bound is refused. */
export function studioQuantityMilli(value: number): number {
  if (!Number.isFinite(value) || Math.abs(value) > 1_000_000_000) throw new StudioValidationError("STUDIO_QUANTITY_INVALID", "A recorded quantity exceeds the supported one-billion-unit bound. Review it before exporting.");
  const scaled = value * 1000, nearest = Math.round(scaled);
  if (!Number.isSafeInteger(nearest) || Math.abs(scaled - nearest) > Math.max(1, Math.abs(scaled)) * Number.EPSILON * 4) throw new StudioValidationError("STUDIO_QUANTITY_INVALID", "Recorded quantities must use at most three decimal places. No unverified quantity was rounded.");
  return nearest;
}

export function studioSalesSummary(rows: readonly StudioSalesRow[]) {
  for (const row of rows) {
    exact(row.netSalesCents); exact(row.transactionCount, true); studioQuantityMilli(row.unitsSold);
    if (row.discountsCents !== undefined) exact(row.discountsCents);
    if (row.refundsCents !== undefined) exact(row.refundsCents);
    if (row.costOfGoodsCents !== undefined && row.costOfGoodsCents !== null) {
      exact(row.costOfGoodsCents);
      try { exactSum([row.netSalesCents, -row.costOfGoodsCents]); } catch { throw new StudioValidationError("STUDIO_AMOUNT_INVALID", "A recorded row's profit exceeds exact supported units. Review it before analysing or exporting."); }
    }
  }
  const sum = (values: number[]) => {
    try { return exactSum(values); } catch { throw new StudioValidationError("STUDIO_AMOUNT_INVALID", "The combined values exceed exact supported units. Narrow the scope or review the records."); }
  };
  const netSalesCents = rows.length ? sum(rows.map(row => row.netSalesCents)) : null;
  const costOfGoodsCents = rows.length && rows.every(row => row.costOfGoodsCents !== undefined && row.costOfGoodsCents !== null) ? sum(rows.map(row => row.costOfGoodsCents!)) : null;
  const grossProfitCents = netSalesCents !== null && costOfGoodsCents !== null ? sum([netSalesCents, -costOfGoodsCents]) : null;
  return { netSalesCents, costOfGoodsCents, grossProfitCents, grossMargin: grossProfitCents !== null && netSalesCents !== null && netSalesCents > 0 ? grossProfitCents / netSalesCents : null,
    transactionCount: rows.length ? sum(rows.map(row => row.transactionCount)) : null,
    unitsSold: rows.length ? sum(rows.map(row => studioQuantityMilli(row.unitsSold))) / 1000 : null };
}

export function excelCountValue(value: number | null): number | string | null {
  if (value === null) return null;
  exact(value);
  return Math.abs(value) > 999_999_999_999_999 ? String(value) : value;
}

export function excelQuantityValue(value: number | null): number | string | null {
  if (value === null) return null;
  // Aggregate quantities can exceed the per-record bound, but remain exact in milli-units.
  const scaled = value * 1000, nearest = Math.round(scaled);
  if (!Number.isSafeInteger(nearest) || Math.abs(scaled - nearest) > Math.max(1, Math.abs(scaled)) * Number.EPSILON * 4) throw new StudioValidationError("STUDIO_QUANTITY_INVALID", "The combined quantity exceeds exact supported thousandths.");
  if (Math.abs(nearest) <= 999_999_999_999_999) return nearest / 1000;
  const n = BigInt(nearest), absolute = n < BigInt(0) ? -n : n;
  return `${n < BigInt(0) ? "-" : ""}${absolute / BigInt(1000)}.${String(absolute % BigInt(1000)).padStart(3, "0")}`.replace(/\.?0+$/, "");
}

/** Preserve canonical cents as text alongside display amounts. Large display
 * values stay decimal text rather than entering Excel's 15-digit numeric limit. */
export function excelMoneyValue(cents: number | null): number | string | null {
  if (cents === null) return null;
  exact(cents);
  if (Math.abs(cents) <= 99_999_999_999_999) return cents / 100;
  const zero = BigInt(0), scale = BigInt(100);
  const value = BigInt(cents), absolute = value < zero ? -value : value;
  return `${value < zero ? "-" : ""}${absolute / scale}.${String(absolute % scale).padStart(2, "0")}`;
}

export async function studioHash(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
