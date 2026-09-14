/** A missing location-day is unknown. It is never converted to a zero or a closure. */
export function periodEvidence(
  rows: readonly { businessDate: string; locationRef?: string }[],
  from: string,
  to: string,
  expectedLocations?: readonly string[],
) {
  const days = Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86_400_000) + 1;
  const selected = rows.filter(row => row.businessDate >= from && row.businessDate <= to);
  const locations = [...new Set(expectedLocations ?? selected.map(row => row.locationRef || "all"))];
  const observed = new Set(selected.filter(row => locations.includes(row.locationRef || "all")).map(row => `${row.businessDate}\u0000${row.locationRef || "all"}`));
  const expected = Number.isFinite(days) && days > 0 ? days * locations.length : 0;
  const missing = Math.max(0, expected - observed.size);
  return {
    complete: expected > 0 && missing === 0,
    days,
    observedDays: new Set(selected.map(row => row.businessDate)).size,
    locations: locations.length,
    missingLocationDays: missing,
    basis: "Daily records for every observed location in the comparison. Missing days require source or closure review; a record alone does not establish reconciliation.",
  };
}
