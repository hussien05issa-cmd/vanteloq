/** Never substitute a default period for a supplied report boundary. */
export function commerceDrilldownPeriod(
  resolved: { from: string | null; to: string | null } | null | undefined,
  requested: { from: string; to: string },
): { from: string; to: string } | null {
  const from = requested.from || resolved?.from;
  const to = requested.to || resolved?.to;
  const valid = (value: string | null | undefined): value is string => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  return valid(from) && valid(to) && from <= to ? { from, to } : null;
}
