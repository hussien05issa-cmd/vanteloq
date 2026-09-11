/** Read-only sales mathematics. All money stays in integer minor currency units. */
export type TimestampedSale = {
  externalSaleId: string; connectionId?: string; outletRef: string | null;
  soldAt: string | null; state: string; totalCents: number; taxCents: number;
  costCents: number; costVerified?: boolean; discountCents: number; lineCount: number;
};
export type SalesHour = {
  hour: number; label: string; netSalesCents: number;
  grossProfitCents: number | null; transactionCount: number;
};
export type SalesDay = {
  businessDate: string; netSalesCents: number; grossProfitCents: number | null;
  averageTransactionCents: number | null; transactionCount: number; unitsSold: number;
  refundsCents: number; discountsCents: number; lastSaleAt: string | null;
  hourly: SalesHour[]; missingCostRecords: number;
};

const clockFormatters = new Map<string, Intl.DateTimeFormat>();
const hourFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", hour: "numeric", hour12: true });

export function businessClock(value: Date, timeZone: string) {
  if (!Number.isFinite(value.getTime())) return null;
  let formatter = clockFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    if (clockFormatters.size >= 16) clockFormatters.clear();
    clockFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)!.value;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, second: Number(get("hour")) * 3600 + Number(get("minute")) * 60 + Number(get("second")) };
}
export function businessDateOffset(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function saleClock(value: string, timeZone: string) {
  // The R-Series API can provide a local wall-clock timestamp without an offset.
  const local = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(value);
  if (local) {
    const [, date, h, m, s = "0"] = local;
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || +h > 23 || +m > 59 || +s > 59) return null;
    return { date, second: +h * 3600 + +m * 60 + +s };
  }
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return null;
  return businessClock(new Date(value), timeZone);
}

/** Use the workspace business day, preserving provider wall-clock timestamps. */
export function businessDateForTimestamp(value: string, timeZone: string): string | null {
  return saleClock(value, timeZone)?.date ?? null;
}

/** Input must contain the latest approved version of each source sale. */
export function salesDay(sales: TimestampedSale[], timeZone: string, asOf: Date, date = businessClock(asOf, timeZone)!.date): SalesDay {
  const clock = businessClock(asOf, timeZone)!;
  const lastHour = Math.floor(clock.second / 3600);
  const hourly: SalesHour[] = Array.from({ length: lastHour + 1 }, (_, hour) => ({ hour,
    label: hourFormatter.format(new Date(Date.UTC(2020, 0, 1, hour))),
    netSalesCents: 0, grossProfitCents: 0, transactionCount: 0,
  }));
  const result: SalesDay = { businessDate: date, netSalesCents: 0, grossProfitCents: 0, averageTransactionCents: null, transactionCount: 0, unitsSold: 0, refundsCents: 0, discountsCents: 0, lastSaleAt: null, hourly, missingCostRecords: 0 };
  let lastSaleSecond = -1;
  let lastSaleInstant: number | null = null;
  for (const sale of sales) {
    if (sale.state !== "completed" || !sale.soldAt) continue;
    const local = saleClock(sale.soldAt, timeZone);
    if (!local || local.date !== date) continue;
    const absoluteCurrentSale = date === clock.date && /(?:Z|[+-]\d{2}:?\d{2})$/i.test(sale.soldAt);
    // Use the actual instant for today, including both occurrences of a repeated
    // DST hour. Historical comparisons use the same local wall-clock cutoff.
    if (absoluteCurrentSale ? Date.parse(sale.soldAt) > asOf.getTime() : local.second > clock.second) continue;
    if (![sale.totalCents, sale.taxCents, sale.discountCents, sale.lineCount].every(Number.isSafeInteger)) continue;
    const bucket = hourly[Math.floor(local.second / 3600)];
    if (!bucket) continue;
    const net = sale.totalCents - sale.taxCents;
    const costKnown = sale.costVerified !== false && Number.isSafeInteger(sale.costCents);
    // Returns reverse both revenue and the returned item's cost. Losses are never clamped.
    const cost = net < 0 ? -Math.abs(sale.costCents) : sale.costCents;
    result.netSalesCents += net;
    bucket.netSalesCents += net;
    if (costKnown) {
      if (result.grossProfitCents !== null) result.grossProfitCents += net - cost;
      if (bucket.grossProfitCents !== null) bucket.grossProfitCents += net - cost;
    } else {
      result.grossProfitCents = null;
      bucket.grossProfitCents = null;
      result.missingCostRecords += 1;
    }
    if (net < 0) result.refundsCents += -net;
    else {
      result.transactionCount += 1;
      bucket.transactionCount += 1;
      result.unitsSold += Math.max(0, sale.lineCount);
      result.discountsCents += Math.abs(sale.discountCents);
    }
    const saleInstant = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(sale.soldAt) ? Date.parse(sale.soldAt) : null;
    const isLatest = saleInstant !== null && lastSaleInstant !== null
      ? saleInstant >= lastSaleInstant
      : local.second >= lastSaleSecond;
    if (isLatest) {
      result.lastSaleAt = sale.soldAt;
      lastSaleSecond = local.second;
      lastSaleInstant = saleInstant;
    }
  }
  result.averageTransactionCents = result.transactionCount ? Math.round(result.netSalesCents / result.transactionCount) : null;
  return result;
}
export function salesChange(current: number | null, baseline: number | null) {
  return current === null || baseline === null || !Number.isFinite(current) || !Number.isFinite(baseline) || baseline === 0 ? null : (current - baseline) / Math.abs(baseline);
}

/** Unknown cost remains unknown for every subsequent running-total point. */
export function cumulativeSalesHours(hours: SalesHour[]): SalesHour[] {
  let netSalesCents = 0, transactionCount = 0;
  let grossProfitCents: number | null = 0;
  return hours.map((point) => {
    netSalesCents += point.netSalesCents;
    transactionCount += point.transactionCount;
    grossProfitCents = grossProfitCents === null || point.grossProfitCents === null ? null : grossProfitCents + point.grossProfitCents;
    return { ...point, netSalesCents, transactionCount, grossProfitCents };
  });
}

function nearClockChange(asOf: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en", { timeZone, timeZoneName: "shortOffset" });
  const offset = (ms: number) => formatter.formatToParts(new Date(ms)).find((part) => part.type === "timeZoneName")?.value;
  return offset(asOf.getTime() - 86400000) !== offset(asOf.getTime() + 86400000);
}
export function sameWeekdayComparison(sales: TimestampedSale[], timeZone: string, asOf: Date, connectionIds: string[]) {
  // A repeated or missing hour is not an equal-duration comparison. Keep the
  // actual chart, but withhold comparative claims around a clock change.
  if (nearClockChange(asOf, timeZone) || nearClockChange(new Date(asOf.getTime() - 7 * 86400000), timeZone)) return null;
  const current = salesDay(sales, timeZone, asOf);
  const baselineDate = businessDateOffset(current.businessDate, -7);
  // Absence of records is not proof of a zero-sales day. Require observed history
  // from every contributing account before presenting a combined comparison.
  const covered = new Set(sales.filter((sale) => sale.soldAt && saleClock(sale.soldAt, timeZone)?.date === baselineDate && sale.state === "completed").map((sale) => sale.connectionId));
  if (!connectionIds.length || !connectionIds.every((id) => covered.has(id))) return null;
  const baseline = salesDay(sales, timeZone, asOf, baselineDate);
  return {
    baselineDate, currentDate: current.businessDate, basis: "same_weekday_same_time" as const,
    asOf: asOf.toISOString(), timeZone, baseline,
    changes: { netSalesRate: salesChange(current.netSalesCents, baseline.netSalesCents), grossProfitRate: salesChange(current.grossProfitCents, baseline.grossProfitCents), transactionRate: salesChange(current.transactionCount, baseline.transactionCount) },
  };
}
