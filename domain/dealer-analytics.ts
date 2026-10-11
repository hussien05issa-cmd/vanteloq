import { isCalendarDate } from "./calendar-date";
import type { DealershipDashboard } from "./dealership";

function locationDate(instant: string, timezone: string): string | null {
  if (!Number.isFinite(Date.parse(instant))) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(instant));
    const part = (type: string) => parts.find(row => row.type === type)?.value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  } catch { return null; }
}

export function dealershipCalendarAge(acquiredDate: string, generatedAt: string, timezone: string): number | null {
  if (!isCalendarDate(acquiredDate)) return null;
  const asOf = locationDate(generatedAt, timezone);
  if (!asOf) return null;
  const days = (Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${acquiredDate}T00:00:00Z`)) / 86_400_000;
  return Number.isInteger(days) && days >= 0 ? days : null;
}

const ageBands = ["0–30 days", "31–60 days", "61–90 days", "91+ days", "Age unavailable"] as const;
type AgingBucket = { label: typeof ageBands[number]; units: number; ownedUnits: number; consignmentUnits: number; unknownOwnershipUnits: number; knownCostUnits: number; reviewedCostUnits: number; postedOwnedCostCents: number | null };

/** Derives only from the authenticated, permission-filtered stock page. Never a whole-dealership estimate. */
export function dealerStockAging(data: DealershipDashboard, requestedThreshold = 60) {
  const threshold = Number.isInteger(requestedThreshold) && requestedThreshold > 0 && requestedThreshold <= 3650 ? requestedThreshold : 60;
  const active = data.stock.filter(row => ["available", "held", "reserved"].includes(row.availability));
  const locations = new Map(data.locations.map(location => [location.id, location]));
  const groups = new Map<string, AgingBucket[]>();
  let agedUnits = 0, ageKnownUnits = 0;
  for (const row of active) {
    const timezone = locations.get(row.locationId)?.timezone;
    const age = timezone ? dealershipCalendarAge(row.acquiredDate, data.generatedAt, timezone) : null;
    if (age !== null) { ageKnownUnits++; if (age >= threshold) agedUnits++; }
    const buckets = groups.get(row.currency) ?? ageBands.map(label => ({ label, units: 0, ownedUnits: 0, consignmentUnits: 0, unknownOwnershipUnits: 0, knownCostUnits: 0, reviewedCostUnits: 0, postedOwnedCostCents: null }));
    groups.set(row.currency, buckets);
    const bucket = buckets[age === null ? 4 : age <= 30 ? 0 : age <= 60 ? 1 : age <= 90 ? 2 : 3];
    bucket.units++;
    if (row.ownership === "consignment") bucket.consignmentUnits++;
    else if (row.ownership !== "owned") bucket.unknownOwnershipUnits++;
    else {
      bucket.ownedUnits++;
      if (data.permissions.costs && row.postedCostCents !== null && Number.isSafeInteger(row.postedCostCents) && row.postedCostCents >= 0) {
        bucket.knownCostUnits++;
        if (row.costComplete) bucket.reviewedCostUnits++;
        bucket.postedOwnedCostCents = (bucket.postedOwnedCostCents ?? 0) + row.postedCostCents;
      }
    }
  }
  return { threshold, partial: Boolean(data.nextCursor), activeUnits: active.length, agedUnits, ageKnownUnits, unknownAgeUnits: active.length - ageKnownUnits,
    currencies: [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([currency, buckets]) => ({ currency, buckets })) };
}

/** Summary gross and its eligible denominator cover the full server-selected period, including recorded delivery activity later reversed. */
export function dealerAverageGross(data: DealershipDashboard) {
  if (!data.permissions.sales || !data.permissions.profit) return [];
  return data.summary.currencies.map(row => {
    const eligible = Number.isSafeInteger(row.grossEligibleUnits) && row.grossEligibleUnits > 0 && row.grossEligibleUnits <= row.deliveredUnits;
    return { currency: row.currency, eligibleUnits: row.grossEligibleUnits, missingCostUnits: row.missingCostUnits,
      averageCents: eligible && row.grossCents !== null && Number.isSafeInteger(row.grossCents) ? row.grossCents / row.grossEligibleUnits : null };
  });
}

/** Attendance is an appointment outcome ratio, never a lead-to-sale conversion estimate. */
export function dealerAppointmentOutcomes(data: DealershipDashboard) {
  if (!data.permissions.customers) return null;
  const locations = new Map(data.locations.map(location => [location.id, location]));
  const leads = new Map(data.leads.map(lead => [lead.id, lead]));
  let attended = 0, noShow = 0, scheduled = 0, cancelled = 0, unresolved = 0;
  const validPeriod = isCalendarDate(data.summary.from) && isCalendarDate(data.summary.to) && data.summary.from <= data.summary.to;
  for (const appointment of data.appointments) {
    const lead = leads.get(appointment.leadId), timezone = lead && locations.get(lead.locationId)?.timezone;
    const date = timezone ? locationDate(appointment.scheduledAt, timezone) : null;
    if (!date) { unresolved++; continue; }
    if (date < data.summary.from || date > data.summary.to) continue;
    if (appointment.status === "cancelled") cancelled++;
    else if (appointment.status === "scheduled") scheduled++;
    else if (!Number.isFinite(Date.parse(data.generatedAt)) || Date.parse(appointment.scheduledAt) > Date.parse(data.generatedAt)) unresolved++;
    else if (appointment.status === "attended") attended++;
    else if (appointment.status === "no_show") noShow++;
  }
  const decided = attended + noShow;
  const complete = validPeriod && !data.limits.truncated && unresolved === 0;
  const reason = !validPeriod ? "Choose a valid reporting period." : data.limits.truncated ? "The related-record limit was reached. Narrow the location to verify the denominator." : unresolved ? "Some appointment locations or dates could not be verified." : !decided ? "No attended or no-show outcomes are recorded in this period." : null;
  return { attended, noShow, scheduled, cancelled, decided, unresolved, complete, reason, showRate: complete && decided > 0 ? attended / decided : null };
}
