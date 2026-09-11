import { businessClock, businessDateOffset, businessDateForTimestamp } from "./intraday-sales";

const boundaries = new Map<string, string>();
/** First instant of a calendar date in the business zone, including DST changes. */
export function businessDayStart(date: string, timeZone: string): string {
  const key = `${date}:${timeZone}`;
  const cached = boundaries.get(key);
  if (cached) return cached;
  const midnight = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== date) throw new Error("Invalid business date");
  let lo = midnight / 1000 - 36 * 3600, hi = midnight / 1000 + 36 * 3600;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (businessClock(new Date(mid * 1000), timeZone)!.date < date) lo = mid + 1;
    else hi = mid;
  }
  if (businessClock(new Date(lo * 1000), timeZone)!.date !== date) throw new Error("Business date does not exist in this time zone");
  const result = new Date(lo * 1000).toISOString();
  if (boundaries.size >= 512) boundaries.clear();
  boundaries.set(key, result);
  return result;
}

/** Trusted SQL column only. Offset timestamps use instants; naive provider times are local. */
function offsetTimestamp(column: string) {
  if (!/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/i.test(column)) throw new Error("Invalid timestamp column");
  return `(substr(${column}, -1) IN ('Z', 'z') OR substr(${column}, -6, 1) IN ('+', '-') OR substr(${column}, -5, 1) IN ('+', '-'))`;
}

export function businessTimestampRange(column: string, start: string | null, end: string | null, timeZone: string) {
  const offset = offsetTimestamp(column);
  const instant: string[] = [], local: string[] = [], instantBindings: string[] = [], localBindings: string[] = [];
  if (start) {
    instant.push(`julianday(${column}) >= julianday(?)`); local.push(`substr(${column}, 1, 10) >= ?`);
    instantBindings.push(businessDayStart(start, timeZone)); localBindings.push(start);
  }
  if (end) {
    instant.push(`julianday(${column}) < julianday(?)`); local.push(`substr(${column}, 1, 10) <= ?`);
    instantBindings.push(businessDayStart(businessDateOffset(end, 1), timeZone)); localBindings.push(end);
  }
  return {
    sql: instant.length ? `(CASE WHEN ${offset} THEN ${instant.join(" AND ")} ELSE ${local.join(" AND ")} END)` : "1",
    bindings: [...instantBindings, ...localBindings],
  };
}

export type TimestampExtrema = { firstInstant?: string | null; lastInstant?: string | null; firstLocal?: string | null; lastLocal?: string | null };
/** Keep offset instants separate from naive local times until each is converted to a business date. */
export function businessTimestampExtrema(column: string) {
  const offset = offsetTimestamp(column);
  return `MIN(CASE WHEN ${offset} THEN strftime('%Y-%m-%dT%H:%M:%fZ', ${column}) END) firstInstant,
    MAX(CASE WHEN ${offset} THEN strftime('%Y-%m-%dT%H:%M:%fZ', ${column}) END) lastInstant,
    MIN(CASE WHEN NOT ${offset} THEN ${column} END) firstLocal,
    MAX(CASE WHEN NOT ${offset} THEN ${column} END) lastLocal`;
}
export function businessDatesFromExtrema(row: TimestampExtrema | null, timeZone: string) {
  const dates = (values: (string | null | undefined)[]) => values.map(value => value ? businessDateForTimestamp(value, timeZone) : null).filter((value): value is string => value !== null).sort();
  return { earliestDate: dates([row?.firstInstant, row?.firstLocal]).at(0) ?? null, latestDate: dates([row?.lastInstant, row?.lastLocal]).at(-1) ?? null };
}
