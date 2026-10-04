import { calculateVerifiedPurchasingCapacity, type PurchasingCapacityAccount } from "./purchasing-intelligence";

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
