import type { Role } from "./authorization";
import { ApiError } from "./api.ts";

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

const DATE = /^\d{4}-\d{2}-\d{2}$/;
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
  if (!DATE.test(entryDate) || Number.isNaN(Date.parse(`${entryDate}T00:00:00Z`))) {
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
  return statementClosingCents - bookBalanceCents;
}

export function calculateCanadianTax(subtotalCents: number, rateBasisPoints: number): number {
  if (!Number.isSafeInteger(subtotalCents) || subtotalCents < 0 || !Number.isInteger(rateBasisPoints) || rateBasisPoints < 0) {
    throw new Error("Tax inputs must be non-negative integers.");
  }
  return Math.round((subtotalCents * rateBasisPoints) / 10_000);
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
  return row.normalBalance === "debit" ? row.debitCents - row.creditCents : row.creditCents - row.debitCents;
}

export function buildFinancialStatements(rows: readonly LedgerAccountRow[]) {
  const accounts = rows.map((row) => ({ ...row, balanceCents: accountBalance(row) }));
  const sumType = (type: LedgerAccountRow["accountType"]) => accounts.filter((row) => row.accountType === type).reduce((sum, row) => sum + row.balanceCents, 0);
  const revenueCents = sumType("revenue");
  const expenseCents = sumType("expense");
  const assetCents = sumType("asset");
  const liabilityCents = sumType("liability");
  const equityBeforeEarningsCents = sumType("equity");
  const operatingProfitCents = revenueCents - expenseCents;
  const cogsCents = accounts.filter((row) => row.systemKey === "cost_of_goods_sold").reduce((sum, row) => sum + row.balanceCents, 0);
  const grossProfitCents = revenueCents - cogsCents;
  const cashCents = accounts.filter((row) => row.systemKey === "operating_cash").reduce((sum, row) => sum + row.balanceCents, 0);
  const accountsReceivableCents = accounts.filter((row) => row.systemKey === "accounts_receivable").reduce((sum, row) => sum + row.balanceCents, 0);
  const accountsPayableCents = accounts.filter((row) => row.systemKey === "accounts_payable").reduce((sum, row) => sum + row.balanceCents, 0);
  const gstCollectedCents = accounts.filter((row) => row.systemKey === "gst_collected").reduce((sum, row) => sum + row.balanceCents, 0);
  const gstRecoverableCents = accounts.filter((row) => row.systemKey === "gst_recoverable").reduce((sum, row) => sum + row.balanceCents, 0);
  return {
    accounts,
    trialBalance: {
      totalDebitCents: rows.reduce((sum, row) => sum + row.debitCents, 0),
      totalCreditCents: rows.reduce((sum, row) => sum + row.creditCents, 0),
    },
    profitAndLoss: { revenueCents, expenseCents, cogsCents, grossProfitCents, operatingProfitCents },
    balanceSheet: { assetCents, liabilityCents, equityCents: equityBeforeEarningsCents + operatingProfitCents },
    cashCents,
    accountsReceivableCents,
    accountsPayableCents,
    netSalesTaxCents: gstCollectedCents - gstRecoverableCents,
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
    const included = items.filter((item) => item.dueDate >= asOf && item.dueDate <= end);
    const confirmedNetCents = included.filter((item) => item.certainty === "confirmed").reduce((sum, item) => sum + (item.direction === "in" ? item.amountCents : -item.amountCents), 0);
    const probableNetCents = included.filter((item) => item.certainty === "probable").reduce((sum, item) => sum + (item.direction === "in" ? item.amountCents : -item.amountCents), 0);
    const estimatedNetCents = included.filter((item) => item.certainty === "estimated").reduce((sum, item) => sum + (item.direction === "in" ? item.amountCents : -item.amountCents), 0);
    return { days, endDate: end, confirmedNetCents, probableNetCents, estimatedNetCents, closingCashCents: openingCashCents + confirmedNetCents + probableNetCents + estimatedNetCents };
  });
}
