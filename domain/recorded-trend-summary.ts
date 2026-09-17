export type RecordedTrendPoint = {
  date: string;
  netSalesCents: number;
  grossProfitCents: number | null;
};

export type RecordedTrendSummary = {
  recordedDayCount: number;
  netSalesCents: number | null;
  averageSalesPerRecordedDayCents: number | null;
  grossProfitCents: number | null;
  peakDay: { date: string; netSalesCents: number } | null;
};

const maximumSafeCents = BigInt(Number.MAX_SAFE_INTEGER);
function safeCents(value: bigint): number | null {
  return value >= -maximumSafeCents && value <= maximumSafeCents ? Number(value) : null;
}
function validDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const time = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date;
}
/** Round the exact mean once to cents, using Math.round's half-toward-positive
 * convention. BigInt accumulation avoids losing cents before the safety check. */
function roundedMean(total: bigint, count: number) {
  const divisor = BigInt(count);
  const quotient = total / divisor;
  const remainder = total % divisor;
  const adjustment = remainder > BigInt(0) && remainder * BigInt(2) >= divisor ? BigInt(1)
    : remainder < BigInt(0) && -remainder * BigInt(2) > divisor ? -BigInt(1) : BigInt(0);
  return safeCents(quotient + adjustment);
}

/** Summarizes exactly the supplied, unique daily observations. Missing calendar
 * days are never filled or used as a denominator. No growth/coverage is inferred. */
export function summarizeRecordedTrend(points: readonly RecordedTrendPoint[]): RecordedTrendSummary {
  const empty: RecordedTrendSummary = {
    recordedDayCount: points.length,
    netSalesCents: null,
    averageSalesPerRecordedDayCents: null,
    grossProfitCents: null,
    peakDay: null,
  };
  if (!points.length) return empty;
  const dates = new Set<string>();
  // Reject malformed or duplicate daily observations instead of silently dropping,
  // double-counting or normalizing them into a different business date.
  for (const point of points) {
    if (!validDate(point.date) || dates.has(point.date) || !Number.isSafeInteger(point.netSalesCents)) return empty;
    dates.add(point.date);
  }
  const exactSales = points.reduce((total, point) => total + BigInt(point.netSalesCents), BigInt(0));
  const netSalesCents = safeCents(exactSales);
  if (netSalesCents === null) return empty;
  const peak = points.reduce((best, point) => point.netSalesCents > best.netSalesCents
    || (point.netSalesCents === best.netSalesCents && point.date < best.date) ? point : best);
  const profitKnown = points.every(point => point.grossProfitCents !== null && Number.isSafeInteger(point.grossProfitCents));
  const grossProfitCents = profitKnown
    ? safeCents(points.reduce((total, point) => total + BigInt(point.grossProfitCents!), BigInt(0)))
    : null;
  return {
    recordedDayCount: points.length,
    netSalesCents,
    averageSalesPerRecordedDayCents: roundedMean(exactSales, points.length),
    grossProfitCents,
    // Peak means the highest observed net-sales amount, including all-negative periods.
    // Equal peaks choose the earliest ISO date, regardless of input order.
    peakDay: { date: peak.date, netSalesCents: peak.netSalesCents },
  };
}

