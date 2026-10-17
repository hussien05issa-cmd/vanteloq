import { calculateVerifiedPurchasingCapacity, type PurchasingCapacityAccount } from "./purchasing-intelligence";
import { isCalendarDate } from "./calendar-date";
import { exactSum } from "./executive-metrics";

export type ReconciledCashAccount = {
  accountId: string; provider: string; currency: string; runId: string | null;
  sourceId: string | null; runStatus: string | null; endDate: string | null;
  closingBalanceCents: number | null; closingBookCents: number | null;
  currentClosingBookCents: number | null; unclearedCents: number | null;
  outstandingWithdrawalsCents: number | null; outstandingReceiptsCents: number | null;
  sourceValid: boolean; postCutoffMovementCount: number;
};

/** Statement cash is a dated scenario input, never a replacement live balance. */
export function reconciledCashSnapshot(input: {
  allowed: boolean; bookloqActive: boolean; dataMode: string; currency: string;
  asOf: string; nowMs: number; accounts: readonly ReconciledCashAccount[];
}) {
  const empty = { scenarioOpeningCashCents: null as number | null, purchasingOpeningCashCents: null as number | null,
    sourceAsOf: null as string | null, ageDays: null as number | null, outstandingWithdrawalsCents: null as number | null,
    outstandingReceiptsCents: null as number | null, accountsUsed: 0, sourceIds: [] as string[],
    label: "Reconciled statement cash scenario", boundary: "A retained statement closing balance, less outstanding withdrawals. Outstanding receipts are not spendable. This dated scenario is not a live bank balance, accounting profit or a statutory cash-flow statement. Subsequent unobserved bank activity is not estimated." };
  const unavailable = (reason: string) => ({ ...empty, status: "unavailable" as const, reason });
  if (!input.allowed || !input.bookloqActive || input.dataMode !== "live") return unavailable("A live BookLoQ workspace and complete bank permissions are required.");
  if (!isCalendarDate(input.asOf) || !Number.isFinite(input.nowMs)) return unavailable("Review the cash scenario date.");
  const currency = input.currency.trim().toUpperCase();
  const accounts = input.accounts.filter(account => account.currency.toUpperCase() === currency);
  if (!accounts.length) return unavailable("Reconcile every cash account before using statement-based cash planning.");
  if (new Set(accounts.map(account => account.accountId)).size !== accounts.length) return unavailable("Duplicate cash account coverage requires review.");
  if (accounts.some(account => account.provider !== "manual" || account.runStatus !== "completed" || !account.sourceValid
    || !account.runId || !account.sourceId || !isCalendarDate(account.endDate) || account.endDate > input.asOf
    || [account.closingBalanceCents, account.closingBookCents, account.currentClosingBookCents, account.unclearedCents,
      account.outstandingWithdrawalsCents, account.outstandingReceiptsCents].some(value => !Number.isSafeInteger(value))
    || account.outstandingWithdrawalsCents! < 0 || account.outstandingReceiptsCents! < 0
    || account.currentClosingBookCents !== account.closingBookCents
    || account.closingBookCents !== exactSum([account.closingBalanceCents!, account.unclearedCents!])
    || account.unclearedCents !== exactSum([account.outstandingReceiptsCents!, -account.outstandingWithdrawalsCents!]))) {
    return unavailable("The latest retained statement, its reconciliation or its opening-book coverage needs review for one or more cash accounts.");
  }
  const dates = new Set(accounts.map(account => account.endDate!));
  if (dates.size !== 1) return unavailable("Cash accounts need the same reconciled closing date. Balances from different dates are not added together.");
  const sourceAsOf = accounts[0].endDate!;
  const ageMs = input.nowMs - Date.parse(`${sourceAsOf}T00:00:00Z`);
  if (ageMs < 0) return unavailable("The reconciled statement date is in the future.");
  const outstandingWithdrawalsCents = exactSum(accounts.map(account => account.outstandingWithdrawalsCents!));
  const outstandingReceiptsCents = exactSum(accounts.map(account => account.outstandingReceiptsCents!));
  const scenarioOpeningCashCents = exactSum([...accounts.map(account => account.closingBalanceCents!), -outstandingWithdrawalsCents]);
  const fresh = ageMs <= 48 * 60 * 60 * 1000;
  const unchanged = accounts.every(account => account.postCutoffMovementCount === 0);
  return { ...empty, status: fresh && unchanged ? "available" as const : "dated_only" as const,
    scenarioOpeningCashCents, purchasingOpeningCashCents: fresh && unchanged ? scenarioOpeningCashCents : null,
    sourceAsOf, ageDays: Math.floor(ageMs / 86_400_000), outstandingWithdrawalsCents, outstandingReceiptsCents,
    accountsUsed: accounts.length, sourceIds: accounts.map(account => account.sourceId!),
    reason: !fresh ? "This statement is older than 48 hours. It supports a dated scenario, but current purchasing capacity is withheld."
      : !unchanged ? "New bank or ledger movements exist after the statement cutoff. Reconcile them before using current purchasing capacity." : null };
}

export function bankCashSnapshot(input: {
  allowed: boolean;
  connected: boolean;
  currency: string;
  nowMs: number;
  accounts: readonly PurchasingCapacityAccount[];
}) {
  const liveAccounts = input.allowed ? input.accounts.filter(account => !account.demoRecord).map(account => ({
    ...account,
    lastSyncAtMs: account.lastSyncAtMs !== null && Number.isFinite(account.lastSyncAtMs) ? account.lastSyncAtMs : null,
  })) : [];
  const capacity = calculateVerifiedPurchasingCapacity({
    connectionVerified: input.allowed && input.connected,
    nowMs: input.nowMs,
    maximumAgeMs: 48 * 60 * 60 * 1000,
    baseCurrency: input.currency,
    cashSafetyReserveCents: 0,
    outstandingBillsCents: 0,
    openPurchaseCommitmentsCents: 0,
    accounts: liveAccounts,
  });
  const included = liveAccounts.filter(account => ["chequing", "savings", "merchant"].includes(account.accountType)
    && account.currency.toUpperCase() === capacity.baseCurrency);
  const dates = included.map(account => account.lastSyncAtMs).filter((value): value is number => value !== null);
  const available = input.allowed && capacity.status === "available" && capacity.verifiedCashCents !== null;
  const balanceCents = available ? capacity.verifiedCashCents : null;

  // Reuse balance eligibility without publishing purchasing capacity: this
  // snapshot has not reviewed reserves, bills or purchase commitments.
  return {
    status: capacity.status,
    verifiedCashCents: balanceCents,
    balanceCents,
    accountsUsed: available ? capacity.accountsUsed : 0,
    baseCurrency: capacity.baseCurrency,
    maximumAgeHours: capacity.maximumAgeHours,
    oldestSyncAt: available && dates.length ? new Date(Math.min(...dates)).toISOString() : null,
    newestSyncAt: available && dates.length ? new Date(Math.max(...dates)).toISOString() : null,
    label: "Latest connected bank cash",
    boundary: "Latest available depository balances, falling back to current balances. This is not period-end ledger cash or profit.",
    reason: !input.allowed ? "Bank cash is not available in this role or scope."
      : !input.connected ? "Connect, synchronize and approve a live bank source."
      : capacity.status === "stale_bank_data" ? "Synchronize and review your bank source to refresh these balances."
      : !available ? "Review the bank accounts and their balance coverage." : null,
  };
}
