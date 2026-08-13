export type CommercePeriod = {
  from: string;
  to: string;
  toExclusive: string;
  days: number;
  comparisonFrom: string;
  comparisonTo: string;
  comparisonToExclusive: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function shiftCommerceDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function parseCommercePeriod(fromValue: string | null, toValue: string | null, today = new Date().toISOString().slice(0, 10)): CommercePeriod {
  const to = toValue ?? today;
  const from = fromValue ?? shiftCommerceDate(to, -29);
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || !Number.isFinite(Date.parse(`${from}T00:00:00Z`)) || !Number.isFinite(Date.parse(`${to}T00:00:00Z`))) {
    throw new Error("Use real calendar dates in YYYY-MM-DD format.");
  }
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  if (days < 1) throw new Error("The start date must be on or before the end date.");
  if (days > 3_660) throw new Error("Choose a date range of ten years or less.");
  return {
    from,
    to,
    toExclusive: shiftCommerceDate(to, 1),
    days,
    comparisonFrom: shiftCommerceDate(from, -days),
    comparisonTo: shiftCommerceDate(from, -1),
    comparisonToExclusive: from,
  };
}

export function commerceChangeRate(current: number, previous: number) {
  return previous === 0 ? null : (current - previous) / Math.abs(previous);
}

export function inventoryDecision(onHand: number, reorderPoint: number, unitsSold: number, periodDays: number) {
  const dailyVelocity = periodDays > 0 ? unitsSold / periodDays : 0;
  const daysOfCover = dailyVelocity > 0 ? onHand / dailyVelocity : null;
  const targetStock = Math.max(reorderPoint, Math.ceil(dailyVelocity * 21));
  const stockStatus = onHand <= 0 ? "stockout" : onHand <= reorderPoint ? "low" : daysOfCover !== null && daysOfCover < 14 ? "watch" : "healthy";
  return { dailyVelocity, daysOfCover, stockStatus, recommendedOrderUnits: Math.max(0, targetStock - onHand) } as const;
}
