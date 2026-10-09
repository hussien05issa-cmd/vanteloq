export const ADVERTISING_SPEND_BOUNDARY = "Meta reported advertising spend covers the imported dates shown and is source evidence for budget and cash planning review. Missing days are not assumed to be zero. It is not a posted expense, invoice, tax amount, amount payable or bank payment. It is not added to budget actuals, commitments, forecasts, cash balances or financial statements. Review billing documents, currency, taxes and payment timing before recording accounting entries or cash obligations.";

export function advertisingCurrencyExponent(currency: unknown): number | null {
  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) return null;
  if (!Intl.supportedValuesOf("currency").includes(currency)) return null;
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? null;
}

/** Provider decimals are parsed without binary floating point or rounding. */
export function advertisingAmountMinor(value: unknown, currency: unknown): number | null {
  const exponent = advertisingCurrencyExponent(currency);
  if (exponent === null || typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value) || value.length > 40) return null;
  const [whole, fraction = ""] = value.split(".");
  if (/[^0]/.test(fraction.slice(exponent))) return null;
  const minor = BigInt(whole) * BigInt(10) ** BigInt(exponent) + BigInt(fraction.slice(0, exponent).padEnd(exponent, "0") || "0");
  return minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null;
}

export type AdvertisingSpendRow = {
  selectionId: string; accountRef: string; accountName: string;
  scopeKind: "organization" | "location"; locationId: string | null;
  metricDate: string | null; amountMinor: number | null; currency: string | null;
  reportingTimezone: string | null; updatedAt: number | null; lastSyncedAt: number | null;
  scopeConflict?: number;
};
export type AdvertisingBudget = {
  id: string; accountId: string; accountSystemKey: string | null; accountType: string;
  periodStart: string; periodEnd: string; locationRef: string; departmentRef: string;
};
export type AdvertisingSpendAccount = {
  accountRef: string; accountName: string; scopeKind: "organization" | "location";
  locationId: string | null; currency: string | null; currencyExponent: number | null;
  reportingTimezone: string | null; amountMinor: number | null; reportedSpendCents: number | null;
  status: "ready" | "needs_review"; reviewReasons: string[];
  periodStart: string | null; periodEnd: string | null; dayCount: number; lastSyncedAt: number | null;
};
export type AdvertisingSpendBudget = {
  budgetId: string; accountId: string; periodStart: string; periodEnd: string; locationRef: string;
  reportedSpendCents: number | null; status: "ready" | "needs_review" | "no_data";
  accountRefs: string[]; reviewReasons: string[];
};
export type BookloqAdvertisingSpend = {
  status: "available" | "needs_review" | "unavailable" | "restricted";
  baseCurrency: string; period: { start: string; end: string };
  accounts: AdvertisingSpendAccount[]; budgets: AdvertisingSpendBudget[]; boundary: string;
};

const validDate = (date: string | null): date is string => {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
};
const validTimezone = (zone: string | null) => {
  if (!zone) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: zone }).format(0); return true; } catch { return false; }
};
const safeSum = (values: number[]) => {
  const sum = values.reduce((total, value) => total + BigInt(value), BigInt(0));
  return sum <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(sum) : null;
};
function cents(amount: number, exponent: number) {
  const numerator = BigInt(amount) * BigInt(100);
  const divisor = BigInt(10) ** BigInt(exponent);
  if (numerator % divisor) return null;
  const value = numerator / divisor;
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
}

export function buildBookloqAdvertisingSpend(input: {
  rows: readonly AdvertisingSpendRow[]; budgets: readonly AdvertisingBudget[];
  baseCurrency: string; period: { start: string; end: string };
  unavailableReason?: string; restricted?: boolean; nowSeconds?: number;
}): BookloqAdvertisingSpend {
  const result: BookloqAdvertisingSpend = {
    status: input.restricted ? "restricted" : "unavailable", baseCurrency: input.baseCurrency,
    period: input.period, accounts: [], budgets: [], boundary: ADVERTISING_SPEND_BOUNDARY,
  };
  if (input.restricted || input.unavailableReason) {
    if (input.unavailableReason) result.boundary = `${input.unavailableReason} ${result.boundary}`;
    return result;
  }
  const groups = new Map<string, AdvertisingSpendRow[]>();
  for (const row of input.rows) {
    const group = groups.get(row.accountRef) ?? [];
    group.push(row); groups.set(row.accountRef, group);
  }
  const dailyByAccount = new Map<string, AdvertisingSpendRow[]>();
  for (const [accountRef, rows] of groups) {
    const reasons = new Set<string>();
    const first = rows[0];
    const scopeKeys = new Set(rows.map(row => `${row.scopeKind}:${row.locationId ?? ""}`));
    if (scopeKeys.size !== 1 || rows.some(row => row.scopeConflict)) reasons.add("Account has conflicting location assignments.");
    const currencies = new Set(rows.map(row => row.currency));
    const currency = currencies.size === 1 ? first.currency : null;
    const exponent = advertisingCurrencyExponent(currency);
    if (exponent === null) reasons.add("Currency is missing or inconsistent. Synchronize the source again.");
    const zones = new Set(rows.map(row => row.reportingTimezone));
    const timezone = zones.size === 1 ? first.reportingTimezone : null;
    if (!validTimezone(timezone)) reasons.add("Reporting timezone is missing or inconsistent. Synchronize the source again.");
    const daily = new Map<string, AdvertisingSpendRow>();
    for (const row of rows) {
      if (!validDate(row.metricDate) || row.metricDate < input.period.start || row.metricDate > input.period.end) {
        reasons.add("No complete dated spend evidence is available for this period."); continue;
      }
      if (!Number.isSafeInteger(row.amountMinor) || row.amountMinor! < 0) reasons.add("Typed spend amount is unavailable. Synchronize the source again.");
      const previous = daily.get(row.metricDate);
      if (previous && (previous.amountMinor !== row.amountMinor || previous.currency !== row.currency || previous.reportingTimezone !== row.reportingTimezone)) {
        reasons.add("Duplicate account and day records disagree. Review the selected sources.");
      }
      // The same external account/day can enter through multiple selections.
      // Never sum duplicate copies, including copies with newer import dates.
      if (!previous) daily.set(row.metricDate, row);
    }
    const timestamps = rows.flatMap(row => [row.lastSyncedAt, row.updatedAt]).filter((value): value is number => Number.isSafeInteger(value) && value! > 0);
    const lastSyncedAt = timestamps.length ? Math.min(...timestamps) : null;
    if (input.nowSeconds !== undefined && (lastSyncedAt === null || rows.some(row => [row.lastSyncedAt, row.updatedAt].some(timestamp => !Number.isSafeInteger(timestamp) || timestamp! <= 0 || timestamp! > input.nowSeconds! + 300)) || input.nowSeconds - lastSyncedAt > 7 * 86_400)) {
      reasons.add("Source synchronization is stale or undated. Review freshness before planning.");
    }
    const sortedDays = [...daily.keys()].sort();
    let amountMinor = reasons.size || !daily.size ? null : safeSum([...daily.values()].map(row => row.amountMinor!));
    if (!reasons.size && amountMinor === null) reasons.add("Spend exceeds the supported exact amount range.");
    if (currency && currency !== input.baseCurrency) reasons.add("Foreign currency requires a reviewed conversion before budget comparison.");
    const reportedSpendCents = amountMinor !== null && currency === input.baseCurrency && exponent !== null ? cents(amountMinor, exponent) : null;
    if (amountMinor !== null && currency === input.baseCurrency && reportedSpendCents === null) reasons.add("Spend cannot be represented exactly in BookLoQ cents.");
    if (scopeKeys.size !== 1) amountMinor = null;
    dailyByAccount.set(accountRef, [...daily.values()]);
    result.accounts.push({ accountRef, accountName: first.accountName, scopeKind: first.scopeKind,
      locationId: scopeKeys.size === 1 ? first.locationId : null, currency, currencyExponent: exponent,
      reportingTimezone: timezone, amountMinor, reportedSpendCents,
      status: reasons.size ? "needs_review" : "ready", reviewReasons: [...reasons],
      periodStart: sortedDays[0] ?? null, periodEnd: sortedDays.at(-1) ?? null,
      dayCount: daily.size, lastSyncedAt });
  }
  for (const budget of input.budgets.filter(row => row.accountSystemKey === "marketing_expense" && row.accountType === "expense")) {
    const reasons: string[] = [];
    const accounts = result.accounts.filter(account => budget.locationRef === "all" || (account.scopeKind === "location" && account.locationId === budget.locationRef));
    if (budget.departmentRef !== "all") reasons.push("Advertising sources have no reviewed department allocation.");
    if (budget.periodStart < input.period.start) reasons.push("Budget period starts before the loaded source window.");
    if (!validDate(budget.periodStart) || !validDate(budget.periodEnd) || budget.periodStart > budget.periodEnd) reasons.push("Budget period needs review.");
    const records = accounts.flatMap(account => (dailyByAccount.get(account.accountRef) ?? []).filter(row => row.metricDate! >= budget.periodStart && row.metricDate! <= budget.periodEnd));
    const includedAccounts = accounts.filter(account => records.some(row => row.accountRef === account.accountRef));
    if (accounts.some(account => account.status !== "ready")) reasons.push("One or more advertising sources need currency, freshness or data review.");
    const minor = !reasons.length && records.length ? safeSum(records.map(row => row.amountMinor!)) : null;
    let total = minor !== null ? cents(minor, advertisingCurrencyExponent(input.baseCurrency)!) : null;
    if (!reasons.length && records.length && total === null) reasons.push("Spend exceeds the supported exact amount range.");
    if (reasons.length) total = null;
    result.budgets.push({ budgetId: budget.id, accountId: budget.accountId, periodStart: budget.periodStart,
      periodEnd: budget.periodEnd, locationRef: budget.locationRef, reportedSpendCents: total,
      status: reasons.length ? "needs_review" : records.length ? "ready" : "no_data",
      accountRefs: includedAccounts.map(account => account.accountRef), reviewReasons: reasons });
  }
  result.accounts.sort((a, b) => a.accountName.localeCompare(b.accountName) || a.accountRef.localeCompare(b.accountRef));
  result.status = !result.accounts.length ? "unavailable" : result.accounts.some(account => account.status === "needs_review") || result.budgets.some(budget => budget.status === "needs_review") ? "needs_review" : "available";
  return result;
}
