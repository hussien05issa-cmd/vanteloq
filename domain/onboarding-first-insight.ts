import { csvCells, parseDailyCsv } from "./daily-summary-csv";
import { validReportingTimezone } from "./onboarding-reporting";

export const ONBOARDING_CSV_MAX_BYTES = 256 * 1024;
export const ONBOARDING_CSV_HEADERS = "business_date,gross_sales,net_sales,cogs,transactions,units,location,discounts,refunds,currency";

export type OnboardingPreviewRecord = ReturnType<typeof parseDailyCsv>[number] & {
  sourceLine: number;
  discountsReported: boolean;
  refundsReported: boolean;
};
export type OnboardingSourcePreview = {
  fileName: string;
  currency: string;
  timeZone: string;
  records: OnboardingPreviewRecord[];
};
/** Session state stays in the onboarding component, never in a server draft. */
export type OnboardingInsightSession = {
  source: OnboardingSourcePreview;
  locationRef: string;
  reportingConfirmed: boolean;
};

/** NumberFormat accepts unknown alphabetic codes and defaults them to two digits.
 * Check recognized codes before reading the currency's actual precision. */
export function onboardingPreviewCurrencyIssue(currency: string): string | null {
  if (!/^[A-Z]{3}$/.test(currency)) return "This CSV preview requires a recognized reporting currency. Review the currency in Location & Hours. You can continue setup without a preview.";
  try {
    if (!Intl.supportedValuesOf("currency").includes(currency)) return `${currency} is not a recognized currency for this CSV preview. Review the currency in Location & Hours. You can continue setup without a preview.`;
    const digits = new Intl.NumberFormat("en-CA", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
    if (digits !== 2) return `${currency} uses ${digits} decimal places. This CSV preview supports currencies with 2 decimal places, such as CAD or USD. You can continue setup without a preview.`;
    return null;
  } catch {
    return "Currency verification is unavailable in this browser. You can continue setup without a CSV preview.";
  }
}

export function parseOnboardingSourceCsv(text: string, options: {
  fileName: string; currency: string; timeZone: string; maxRows?: number;
}): OnboardingSourcePreview {
  if (new TextEncoder().encode(text).byteLength > ONBOARDING_CSV_MAX_BYTES) throw new Error("Choose a CSV no larger than 256 KiB.");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufffd]/.test(text)) throw new Error("Choose a readable UTF-8 CSV without binary characters.");
  if (!/\.csv$/i.test(options.fileName) || options.fileName.length > 255 || /[\u0000-\u001f\u007f]/.test(options.fileName)) throw new Error("Choose a file with a .csv extension and a readable file name.");
  const currencyIssue = onboardingPreviewCurrencyIssue(options.currency);
  if (currencyIssue) throw new Error(currencyIssue);
  if (!validReportingTimezone(options.timeZone)) throw new Error("Confirm a valid reporting currency and timezone in Location & Hours first.");
  const maxRows = options.maxRows ?? 366;
  if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > 366) throw new Error("Choose a daily record limit between 1 and 366.");
  // Use the same calendar, exact-money and duplicate validations as the reviewed import.
  const parsed = parseDailyCsv(text);
  if (parsed.length > maxRows) throw new Error(`Choose a CSV with no more than ${maxRows} supported daily records. No rows were imported.`);
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).map((line, index) => ({ line, sourceLine: index + 1 })).filter(({ line }) => line.trim());
  const headers = csvCells(lines[0].line, lines[0].sourceLine).map(value => value.toLowerCase().replace(/\s+/g, "_"));
  const records = parsed.map((record, index): OnboardingPreviewRecord => {
    const { line, sourceLine } = lines[index + 1];
    const cells = csvCells(line, sourceLine);
    const get = (header: string) => cells[headers.indexOf(header)] ?? "";
    if (headers.includes("currency") && get("currency").toUpperCase() !== options.currency) throw new Error(`Row ${sourceLine}: currency must match ${options.currency}. Review separate currencies in separate files.`);
    for (const header of ["timezone", "reporting_timezone"]) {
      if (headers.includes(header) && get(header) !== options.timeZone) throw new Error(`Row ${sourceLine}: ${header} must match ${options.timeZone}. Business dates are used as supplied, without conversion.`);
    }
    return { ...record, sourceLine, discountsReported: get("discounts") !== "", refundsReported: get("refunds") !== "" };
  });
  return { fileName: options.fileName, currency: options.currency, timeZone: options.timeZone, records };
}

function exactSum(records: OnboardingPreviewRecord[], key: "netSalesCents" | "grossSalesCents" | "discountsCents") {
  return records.reduce((sum, record) => {
    const next = sum + record[key];
    if (!Number.isSafeInteger(next)) throw new Error("The combined amount is too large to calculate exactly. Choose a smaller file.");
    return next;
  }, 0);
}
function calendarOffset(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
export function onboardingBusinessDate(now: Date, timeZone: string) {
  if (!Number.isFinite(now.getTime()) || !validReportingTimezone(timeZone)) throw new Error("A valid time and reporting timezone are required.");
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (part: Intl.DateTimeFormatPartTypes) => parts.find(value => value.type === part)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

type InsightBase = {
  records: OnboardingPreviewRecord[];
  from: string;
  to: string;
  completeDays: number;
  missingComparisonDates: string[];
  excludedCurrentOrFutureRows: number;
};
export type OnboardingFirstInsight = InsightBase & (
  | { kind: "comparison"; currentCents: number; previousCents: number; changeCents: number; changePercent: number | null; previousFrom: string; previousTo: string; largestDay: { currentDate: string; previousDate: string; currentCents: number; previousCents: number; changeCents: number } }
  | { kind: "discounts"; discountsCents: number; grossSalesCents: number; discountRate: number | null }
  | { kind: "recorded_sales"; netSalesCents: number; discountsCovered: number }
  | { kind: "incomplete_day"; netSalesCents: number }
);

/** Dates already identify source business days. Never shift them using UTC or infer missing days as zero. */
export function buildOnboardingFirstInsight(source: OnboardingSourcePreview, locationRef: string, now = new Date()): OnboardingFirstInsight {
  const currencyIssue = onboardingPreviewCurrencyIssue(source.currency);
  if (currencyIssue) throw new Error(currencyIssue);
  const selected = source.records.filter(row => row.locationRef === locationRef).sort((left, right) => left.businessDate.localeCompare(right.businessDate));
  if (!selected.length) throw new Error("Choose a location present in this file.");
  const today = onboardingBusinessDate(now, source.timeZone);
  const completed = selected.filter(row => row.businessDate < today);
  const excludedCurrentOrFutureRows = selected.length - completed.length;
  if (!completed.length) return { kind: "incomplete_day", records: selected, from: selected[0].businessDate, to: selected.at(-1)!.businessDate, completeDays: 0, missingComparisonDates: [], excludedCurrentOrFutureRows, netSalesCents: exactSum(selected, "netSalesCents") };
  const end = completed.at(-1)!.businessDate;
  const byDate = new Map(completed.map(row => [row.businessDate, row]));
  const comparisonDates = Array.from({ length: 14 }, (_, index) => calendarOffset(end, index - 13));
  const missingComparisonDates = comparisonDates.filter(date => !byDate.has(date));
  const base: InsightBase = { records: completed, from: completed[0].businessDate, to: end, completeDays: completed.length, missingComparisonDates, excludedCurrentOrFutureRows };
  if (!missingComparisonDates.length) {
    const previous = comparisonDates.slice(0, 7).map(date => byDate.get(date)!);
    const current = comparisonDates.slice(7).map(date => byDate.get(date)!);
    const previousCents = exactSum(previous, "netSalesCents"), currentCents = exactSum(current, "netSalesCents"), changeCents = currentCents - previousCents;
    if (!Number.isSafeInteger(changeCents)) throw new Error("The comparison is too large to calculate exactly. Choose a smaller file.");
    const days = current.map((row, index) => ({ currentDate: row.businessDate, previousDate: previous[index].businessDate, currentCents: row.netSalesCents, previousCents: previous[index].netSalesCents, changeCents: row.netSalesCents - previous[index].netSalesCents }));
    if (days.some(day => !Number.isSafeInteger(day.changeCents))) throw new Error("A daily comparison is too large to calculate exactly. Choose a smaller file.");
    const largestDay = [...days].sort((left, right) => changeCents < 0 ? left.changeCents - right.changeCents : changeCents > 0 ? right.changeCents - left.changeCents : Math.abs(right.changeCents) - Math.abs(left.changeCents))[0];
    return { ...base, kind: "comparison", records: [...previous, ...current], from: current[0].businessDate, to: end, previousFrom: previous[0].businessDate, previousTo: previous.at(-1)!.businessDate, currentCents, previousCents, changeCents, changePercent: previousCents > 0 ? changeCents / previousCents * 100 : null, largestDay };
  }
  if (completed.every(row => row.discountsReported)) {
    const discountsCents = exactSum(completed, "discountsCents"), grossSalesCents = exactSum(completed, "grossSalesCents");
    return { ...base, kind: "discounts", discountsCents, grossSalesCents, discountRate: grossSalesCents > 0 ? discountsCents / grossSalesCents * 100 : null };
  }
  return { ...base, kind: "recorded_sales", netSalesCents: exactSum(completed, "netSalesCents"), discountsCovered: completed.filter(row => row.discountsReported).length };
}
