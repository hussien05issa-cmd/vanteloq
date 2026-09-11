const numericFields = ["currentCashCents", "availableCashCents", "bookBalanceCents", "revenueCents", "grossProfitCents", "operatingProfitCents", "totalExpensesCents", "accountsReceivableCents", "accountsPayableCents", "payrollObligationsCents", "debtObligationsCents", "upcomingBillsCount", "overdueInvoicesCount", "unreconciledCount", "uncategorizedCount"] as const;

function safeTimestamp(value: unknown) {
  const milliseconds = typeof value === "number" && Number.isFinite(value) ? (value < 1e11 ? value * 1000 : value) : typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) ? Date.parse(value) : NaN;
  return Number.isFinite(milliseconds) && milliseconds > 0 && milliseconds < 8.64e15 ? new Date(milliseconds).toISOString() : null;
}

/** Allowlist only. Never forward the underlying BookLoQ response to an AI. */
export function projectAdvisorBookloq(payload: unknown) {
  const data = (payload as { bookloq?: { settings?: { status?: string; dataMode?: string; baseCurrency?: string }; ledgerAccess?: { available?: boolean }; summary?: Record<string, unknown> } } | null)?.bookloq;
  if (!data || data.settings?.status !== "active" || data.settings?.dataMode !== "live") return { status: "unavailable", reason: "A configured live BookLoQ ledger is required. Demonstration data is excluded." };
  const values = Object.fromEntries(numericFields.map(key => [key, typeof data.summary?.[key] === "number" && Number.isSafeInteger(data.summary[key]) ? data.summary[key] : null]));
  return { status: "available", source: "BookLoQ permission-filtered summaries", scope: "organization", currency: /^[A-Z]{3}$/.test(data.settings.baseCurrency ?? "") ? data.settings.baseCurrency : null, ledgerAvailable: data.ledgerAccess?.available === true, period: "Cumulative posted ledger balances as recorded; not the retail KPI date range", cashLastSyncAt: safeTimestamp(data.summary?.cashLastSyncAt), values, limitations: "Null means unavailable or withheld. No raw transactions, identities or account identifiers are included. Ledger results do not prove that every real-world expense or obligation has been recorded. Do not add these balances to POS totals." };
}
