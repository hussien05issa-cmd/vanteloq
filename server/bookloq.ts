import type { Role } from "./authorization";
import { ApiError } from "./api.ts";
import { isCalendarDate } from "../domain/calendar-date.ts";

export const bookloqPermissions = [
  "view_revenue", "view_profit", "view_banking", "view_payroll", "create_transactions",
  "edit_drafts", "post_journals", "approve_bills", "initiate_payments", "reconcile_accounts",
  "change_tax_settings", "lock_periods", "unlock_periods", "export_data", "manage_integrations",
  "view_audit_logs",
] as const;

export type BookLoQPermission = (typeof bookloqPermissions)[number];

const rolePermissions: Record<Role, readonly BookLoQPermission[]> = {
  owner: bookloqPermissions,
  admin: bookloqPermissions.filter((permission) => permission !== "unlock_periods"),
  manager: ["view_revenue", "view_profit", "create_transactions", "edit_drafts"],
  employee: [],
  read_only: ["view_revenue", "view_profit", "view_banking", "view_payroll", "export_data", "view_audit_logs"],
  integration: [],
};

export function effectiveBookLoQPermissions(role: Role): readonly BookLoQPermission[] {
  return rolePermissions[role];
}

export function requireBookLoQPermission(role: Role, permission: BookLoQPermission): void {
  if (!effectiveBookLoQPermissions(role).includes(permission)) {
    throw new ApiError(403, "BOOKLOQ_PERMISSION_REQUIRED", "Your finance role does not allow this action.");
  }
}

export function bookloqAccessForPermissions(permissions: readonly string[]) {
  const granted = new Set(permissions);
  return {
    statements: granted.has("finance.statements"),
    bankBalances: granted.has("finance.bank_balances"),
    bankTransactions: granted.has("finance.bank_transactions"),
    accountsPayableReceivable: granted.has("finance.ap_ar"),
    costs: granted.has("finance.costs"),
    payrollTotals: granted.has("payroll.totals"),
    payrollIndividuals: granted.has("payroll.individual"),
    contactIdentity: granted.has("customers.identity"),
    audit: granted.has("audit.view"),
    export: granted.has("finance.export"),
  };
}

type BookLoQBankBalanceRow = {
  accountType: string;
  liveBalanceCents: number | null;
  currency: string;
  connectionStatus: string;
  lastSyncAt: Date | number | null;
  demoRecord: boolean | number;
};

export function normalizeBookLoQTimestamp(value: Date | number | null) {
  if (value === null) return null;
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.abs(timestamp) < 1_000_000_000_000 ? timestamp * 1_000 : timestamp;
}

export function verifiedBookLoQBankBalance(
  banks: readonly BookLoQBankBalanceRow[],
  baseCurrency: string,
  nowMs = Date.now(),
  maximumAgeMs = 48 * 60 * 60 * 1_000,
) {
  const cashTypes = new Set(["chequing", "savings", "merchant"]);
  const relevant = banks.filter((bank) =>
    !Boolean(bank.demoRecord)
    && bank.currency.toUpperCase() === baseCurrency.toUpperCase()
    && cashTypes.has(bank.accountType),
  );
  if (!relevant.length) return null;
  const eligible = relevant.filter((bank) => {
    if (bank.connectionStatus !== "healthy") return false;
    if (!Number.isSafeInteger(bank.liveBalanceCents) || bank.lastSyncAt === null) return false;
    const synchronizedAt = normalizeBookLoQTimestamp(bank.lastSyncAt);
    if (synchronizedAt === null) return false;
    const ageMs = nowMs - synchronizedAt;
    return ageMs >= 0 && ageMs <= maximumAgeMs;
  });
  if (eligible.length !== relevant.length) return null;
  return eligible.reduce((sum, bank) => sum + Number(bank.liveBalanceCents), 0);
}

export type JournalInputLine = {
  accountId: string;
  description: string;
  debitCents: number;
  creditCents: number;
  taxCode: string | null;
  taxAmountCents: number;
  contactId: string | null;
  locationRef: string;
  departmentRef: string | null;
  projectRef: string | null;
};

export type JournalInput = {
  entryDate: string;
  memo: string;
  currency: string;
  lines: JournalInputLine[];
  totalDebitCents: number;
  totalCreditCents: number;
};

const CURRENCY = /^[A-Z]{3}$/;

function cleanString(value: unknown, label: string, maximum: number, required = true): string {
  if (value === undefined || value === null || value === "") {
    if (!required) return "";
    throw new ApiError(400, "INVALID_FIELD", `Enter a valid ${label}.`);
  }
  if (typeof value !== "string") throw new ApiError(400, "INVALID_FIELD", `Enter a valid ${label}.`);
  const normalized = value.trim().normalize("NFC");
  if ((required && !normalized) || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new ApiError(400, "INVALID_FIELD", `Enter a valid ${label}.`);
  }
  return normalized;
}

function safeMoney(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 100_000_000_000_000) {
    throw new ApiError(400, "INVALID_FIELD", `Enter a valid ${label} in minor currency units.`);
  }
  return Number(value);
}

function rejectUnknown(value: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw new ApiError(400, "UNKNOWN_FIELD", `Unexpected field: ${unknown}.`);
}

export function journalInput(value: Record<string, unknown>): JournalInput {
  rejectUnknown(value, ["entryDate", "memo", "currency", "lines"]);
  const entryDate = cleanString(value.entryDate, "entry date", 10);
  if (!isCalendarDate(entryDate)) {
    throw new ApiError(400, "INVALID_FIELD", "Enter a valid journal date.");
  }
  const currency = cleanString(value.currency ?? "CAD", "currency", 3).toUpperCase();
  if (!CURRENCY.test(currency)) throw new ApiError(400, "INVALID_FIELD", "Enter a valid ISO currency code.");
  if (!Array.isArray(value.lines) || value.lines.length < 2 || value.lines.length > 50) {
    throw new ApiError(400, "INVALID_JOURNAL", "A journal requires between 2 and 50 lines.");
  }

  const lines = value.lines.map((raw, index) => {
    if (!raw || Array.isArray(raw) || typeof raw !== "object") {
      throw new ApiError(400, "INVALID_JOURNAL", `Journal line ${index + 1} is invalid.`);
    }
    const line = raw as Record<string, unknown>;
    rejectUnknown(line, ["accountId", "description", "debitCents", "creditCents", "taxCode", "taxAmountCents", "contactId", "locationRef", "departmentRef", "projectRef"]);
    const debitCents = safeMoney(line.debitCents ?? 0, "debit");
    const creditCents = safeMoney(line.creditCents ?? 0, "credit");
    if ((debitCents === 0) === (creditCents === 0)) {
      throw new ApiError(400, "INVALID_JOURNAL_LINE", `Journal line ${index + 1} must contain either a debit or a credit.`);
    }
    return {
      accountId: cleanString(line.accountId, "account", 80),
      description: cleanString(line.description, "line description", 300, false),
      debitCents,
      creditCents,
      taxCode: cleanString(line.taxCode, "tax code", 24, false) || null,
      taxAmountCents: safeMoney(line.taxAmountCents ?? 0, "tax amount"),
      contactId: cleanString(line.contactId, "contact", 80, false) || null,
      locationRef: cleanString(line.locationRef, "location", 80, false) || "all",
      departmentRef: cleanString(line.departmentRef, "department", 80, false) || null,
      projectRef: cleanString(line.projectRef, "project", 80, false) || null,
    };
  });
  const totalDebitCents = lines.reduce((sum, line) => sum + line.debitCents, 0);
  const totalCreditCents = lines.reduce((sum, line) => sum + line.creditCents, 0);
  if (totalDebitCents <= 0 || totalDebitCents !== totalCreditCents) {
    throw new ApiError(400, "UNBALANCED_JOURNAL", "Total debits must equal total credits before posting.");
  }
  return {
    entryDate,
    memo: cleanString(value.memo, "journal explanation", 1_000),
    currency,
    lines,
    totalDebitCents,
    totalCreditCents,
  };
}

export function reverseJournalLines(lines: readonly JournalInputLine[]): JournalInputLine[] {
  return lines.map((line) => ({ ...line, debitCents: line.creditCents, creditCents: line.debitCents }));
}

export function reconciliationDifference(statementClosingCents: number, bookBalanceCents: number): number {
  if (!Number.isSafeInteger(statementClosingCents) || !Number.isSafeInteger(bookBalanceCents)) {
    throw new Error("Reconciliation values must use integer minor units.");
  }
  return exactMoney(BigInt(statementClosingCents) - BigInt(bookBalanceCents));
}

export function calculateCanadianTax(subtotalCents: number, rateBasisPoints: number): number {
  if (!Number.isSafeInteger(subtotalCents) || subtotalCents < 0 || !Number.isSafeInteger(rateBasisPoints) || rateBasisPoints < 0) {
    throw new Error("Tax inputs must be non-negative integers.");
  }
  return exactMoney((BigInt(subtotalCents) * BigInt(rateBasisPoints) + BigInt(5_000)) / BigInt(10_000));
}

function exactMoney(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error("Ledger totals exceed safe integer precision.");
  return Number(value);
}

function ledgerCents(value: number): bigint {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Ledger amounts must be non-negative safe integer minor units.");
  return BigInt(value);
}

export type LedgerAccountRow = {
  id: string;
  code: string;
  name: string;
  accountType: "asset" | "liability" | "equity" | "revenue" | "expense";
  accountSubtype: string;
  normalBalance: "debit" | "credit";
  systemKey: string | null;
  description: string;
  plainLanguage: string;
  debitCents: number;
  creditCents: number;
};

export function accountBalance(row: LedgerAccountRow): number {
  const net = ledgerCents(row.debitCents) - ledgerCents(row.creditCents);
  return exactMoney(row.normalBalance === "debit" ? net : -net);
}

export function buildFinancialStatements(rows: readonly LedgerAccountRow[]) {
  const accounts = rows.map((row) => ({ ...row, balanceCents: accountBalance(row) }));
  // Statement signs follow the account's class. A credit-normal contra asset,
  // for example accumulated depreciation, reduces assets despite its positive
  // account-level normal balance. Keep normal balances for account displays.
  const statementBalance = (row: LedgerAccountRow) => row.accountType === "asset" || row.accountType === "expense"
    ? ledgerCents(row.debitCents) - ledgerCents(row.creditCents) : ledgerCents(row.creditCents) - ledgerCents(row.debitCents);
  const total = (selected: readonly LedgerAccountRow[]) => exactMoney(selected.reduce((sum, row) => sum + statementBalance(row), BigInt(0)));
  const sumType = (type: LedgerAccountRow["accountType"]) => total(accounts.filter((row) => row.accountType === type));
  const revenueCents = sumType("revenue");
  const expenseCents = sumType("expense");
  const assetCents = sumType("asset");
  const liabilityCents = sumType("liability");
  const equityBeforeEarningsCents = sumType("equity");
  const operatingProfitCents = exactMoney(BigInt(revenueCents) - BigInt(expenseCents));
  const cogsCents = total(accounts.filter((row) => row.systemKey === "cost_of_goods_sold"));
  const grossProfitCents = exactMoney(BigInt(revenueCents) - BigInt(cogsCents));
  const cashCents = accounts.filter((row) => row.systemKey === "operating_cash").reduce((sum, row) => sum + row.balanceCents, 0);
  const accountsReceivableCents = accounts.filter((row) => row.systemKey === "accounts_receivable").reduce((sum, row) => sum + row.balanceCents, 0);
  const accountsPayableCents = accounts.filter((row) => row.systemKey === "accounts_payable").reduce((sum, row) => sum + row.balanceCents, 0);
  const gstCollectedCents = accounts.filter((row) => row.systemKey === "gst_collected").reduce((sum, row) => sum + row.balanceCents, 0);
  const gstRecoverableCents = accounts.filter((row) => row.systemKey === "gst_recoverable").reduce((sum, row) => sum + row.balanceCents, 0);
  return {
    accounts,
    trialBalance: {
      totalDebitCents: exactMoney(rows.reduce((sum, row) => sum + (row.debitCents > row.creditCents ? ledgerCents(row.debitCents) - ledgerCents(row.creditCents) : BigInt(0)), BigInt(0))),
      totalCreditCents: exactMoney(rows.reduce((sum, row) => sum + (row.creditCents > row.debitCents ? ledgerCents(row.creditCents) - ledgerCents(row.debitCents) : BigInt(0)), BigInt(0))),
    },
    profitAndLoss: { revenueCents, expenseCents, cogsCents, grossProfitCents, operatingProfitCents },
    balanceSheet: { assetCents, liabilityCents, equityCents: exactMoney(BigInt(equityBeforeEarningsCents) + BigInt(operatingProfitCents)) },
    cashCents,
    accountsReceivableCents,
    accountsPayableCents,
    netSalesTaxCents: exactMoney(BigInt(gstCollectedCents) - BigInt(gstRecoverableCents)),
  };
}

export function bookkeepingHealthScore(input: {
  unbalancedJournalCount: number;
  uncategorizedCount: number;
  unreconciledCount: number;
  openCriticalAlerts: number;
  missingReceiptCount: number;
  monthEndCompletionRate: number;
}): number {
  const score = 100
    - Math.min(30, input.unbalancedJournalCount * 30)
    - Math.min(20, input.uncategorizedCount * 2)
    - Math.min(20, input.unreconciledCount)
    - Math.min(20, input.openCriticalAlerts * 10)
    - Math.min(10, input.missingReceiptCount)
    - Math.round(Math.max(0, 1 - input.monthEndCompletionRate) * 10);
  return Math.max(0, Math.min(100, score));
}

export function forecastCash(openingCashCents: number, items: readonly { dueDate: string; amountCents: number; direction: "in" | "out"; certainty: "confirmed" | "probable" | "estimated" }[], asOf: string) {
  const horizons = [7, 30, 90, 365] as const;
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  return horizons.map((days) => {
    const end = new Date(asOfMs + days * 86_400_000).toISOString().slice(0, 10);
    // The caller supplies outstanding balances, including unpaid overdue items.
    const included = items.filter((item) => item.dueDate <= end);
    const confirmedNetCents = included.filter((item) => item.certainty === "confirmed").reduce((sum, item) => sum + (item.direction === "in" ? item.amountCents : -item.amountCents), 0);
    const probableNetCents = included.filter((item) => item.certainty === "probable").reduce((sum, item) => sum + (item.direction === "in" ? item.amountCents : -item.amountCents), 0);
    const estimatedNetCents = included.filter((item) => item.certainty === "estimated").reduce((sum, item) => sum + (item.direction === "in" ? item.amountCents : -item.amountCents), 0);
    return { days, endDate: end, confirmedNetCents, probableNetCents, estimatedNetCents, closingCashCents: openingCashCents + confirmedNetCents + probableNetCents + estimatedNetCents };
  });
}
