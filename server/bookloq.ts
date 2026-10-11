import { exactSum, ledgerIntelligence } from "../domain/executive-metrics.ts";
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

type JournalReplayRequest = { kind: "manual"; input: JournalInput }
  | { kind: "reversal"; entryId: string; reason: string; reversalDate: string };

export async function findJournalReplay(database: D1Database, organizationId: string, key: string, request: JournalReplayRequest) {
  const entry = await database.prepare(`SELECT id, entry_number entryNumber, status, source_type sourceType,
    entry_date entryDate, memo, currency, reversal_of_entry_id reversalOfEntryId,
    total_debit_cents totalDebitCents, total_credit_cents totalCreditCents
    FROM journal_entries WHERE organization_id = ? AND idempotency_key = ?`)
    .bind(organizationId, key).first<{ id: string; entryNumber: string; status: string; sourceType: string;
      entryDate: string; memo: string; currency: string; reversalOfEntryId: string | null;
      totalDebitCents: number; totalCreditCents: number }>();
  if (!entry) return null;
  let matches = false;
  if (request.kind === "reversal") {
    matches = entry.sourceType === "reversal" && entry.reversalOfEntryId === request.entryId
      && entry.entryDate === request.reversalDate && entry.memo === request.reason;
  } else {
    const input = request.input;
    const result = await database.prepare(`SELECT account_id accountId, description, debit_cents debitCents,
      credit_cents creditCents, tax_code taxCode, tax_amount_cents taxAmountCents, contact_id contactId,
      location_ref locationRef, department_ref departmentRef, project_ref projectRef
      FROM journal_lines WHERE organization_id = ? AND journal_entry_id = ? ORDER BY line_number`)
      .bind(organizationId, entry.id).all<JournalInputLine>();
    const lines = result.results ?? [];
    const fields = ["accountId", "description", "debitCents", "creditCents", "taxCode", "taxAmountCents",
      "contactId", "locationRef", "departmentRef", "projectRef"] as const;
    matches = entry.sourceType === "manual" && entry.reversalOfEntryId === null
      && entry.entryDate === input.entryDate && entry.memo === input.memo && entry.currency === input.currency
      && entry.totalDebitCents === input.totalDebitCents && entry.totalCreditCents === input.totalCreditCents
      && lines.length === input.lines.length
      && lines.every((line, index) => fields.every(field => line[field] === input.lines[index][field]));
  }
  if (!matches) throw new ApiError(409, "JOURNAL_REQUEST_CONFLICT", "This request key belongs to a different journal action. Use a new request key for a different posting or reversal.");
  return { id: entry.id, entryNumber: entry.entryNumber, status: entry.status };
}

export async function validateJournalContacts(database: D1Database, organizationId: string, lines: readonly JournalInputLine[]) {
  const ids = [...new Set(lines.map(line => line.contactId).filter((id): id is string => id !== null))];
  if (!ids.length) return;
  const result = await database.prepare(`SELECT id FROM bookloq_contacts
    WHERE organization_id = ? AND active = 1 AND id IN (${ids.map(() => "?").join(",")})`)
    .bind(organizationId, ...ids).all<{ id: string }>();
  const available = new Set((result.results ?? []).map(row => row.id));
  if (ids.some(id => !available.has(id))) throw new ApiError(400, "JOURNAL_CONTACT_UNAVAILABLE", "Every journal contact must be an active contact from this organization.");
}

type SupportingMatchInput = {
  organizationId: string; transactionId: string; targetType: "supplier_bill" | "customer_invoice" | "receipt";
  targetId: string; amountCents: number; currency: string; demoRecord: number; note: string;
  actorUserId: string; timestamp: number;
};

// All writers use the guarded statement, not a prior read, to decide which
// supporting record may become the one confirmed match for a transaction.
export async function confirmSupportingMatch(database: D1Database, input: SupportingMatchInput) {
  const { organizationId, transactionId, targetId, targetType, amountCents, currency, demoRecord, note, actorUserId, timestamp } = input;
  const targetColumn = targetType === "supplier_bill" ? "supplier_bill_id" : targetType === "customer_invoice" ? "customer_invoice_id" : "document_id";
  const targetGuard = targetType === "receipt"
    ? `EXISTS (SELECT 1 FROM workspace_documents d WHERE d.organization_id = ? AND d.id = ?
        AND d.document_type = 'receipt' AND d.security_state = 'clean' AND d.status NOT IN ('deleted', 'deleting'))`
    : `EXISTS (SELECT 1 FROM ${targetType === "supplier_bill" ? "supplier_bills" : "customer_invoices"} d
        WHERE d.organization_id = ? AND d.id = ? AND UPPER(d.currency) = UPPER(?) AND d.demo_record = ?
        AND ${targetType === "supplier_bill" ? "d.status <> 'void'" : "d.status NOT IN ('draft', 'void', 'written_off')"})`;
  const guard = `EXISTS (SELECT 1 FROM financial_transactions t
      WHERE t.organization_id = ? AND t.id = ? AND t.source_state IN ('posted', 'modified')
        AND t.reconciliation_status IN ('unreconciled', 'matched')
        AND t.amount_cents = ? AND t.currency = ? AND t.demo_record = ?)
    AND ${targetGuard}
    AND NOT EXISTS (SELECT 1 FROM bookloq_transaction_matches other
      WHERE other.organization_id = ? AND other.transaction_id = ? AND other.status = 'confirmed'
        AND (other.${targetColumn} IS NULL OR other.${targetColumn} <> ?))`;
  const guardValues = [organizationId, transactionId, amountCents, currency, demoRecord,
    organizationId, targetId, ...(targetType === "receipt" ? [] : [currency, demoRecord]),
    organizationId, transactionId, targetId];
  const matchId = crypto.randomUUID();
  const results = await database.batch([
    database.prepare(`INSERT INTO bookloq_transaction_matches
      (id, organization_id, transaction_id, supplier_bill_id, customer_invoice_id, document_id,
       status, method, confidence_basis_points, matched_amount_cents, reasons_json, note,
       matched_by_user_id, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, 'confirmed', 'manual', 10000, ?, '["Manual confirmation"]', ?, ?, ?, ?
      WHERE ${guard}
      ON CONFLICT(organization_id, transaction_id, ${targetColumn}) DO UPDATE SET
        status = 'confirmed', method = 'manual', confidence_basis_points = 10000,
        matched_amount_cents = excluded.matched_amount_cents, reasons_json = excluded.reasons_json,
        note = excluded.note, matched_by_user_id = excluded.matched_by_user_id, updated_at = excluded.updated_at
      RETURNING id`)
      .bind(matchId, organizationId, transactionId,
        targetType === "supplier_bill" ? targetId : null, targetType === "customer_invoice" ? targetId : null,
        targetType === "receipt" ? targetId : null, Math.abs(amountCents), note, actorUserId, timestamp, timestamp, ...guardValues),
    database.prepare(`UPDATE financial_transactions SET reconciliation_status = 'matched', updated_at = ?
      WHERE organization_id = ? AND id = ? AND ${guard}`)
      .bind(timestamp, organizationId, transactionId, ...guardValues),
  ]);
  const persisted = results[0]?.results?.[0] as { id: string } | undefined;
  if (!persisted) throw new ApiError(409, "MATCH_RECORD_CHANGED", "The transaction or supporting record changed, or another match was confirmed. Refresh before trying again.");
  return persisted.id;
}

export async function saveBookloqBudget(database: D1Database, input: {
  organizationId: string; accountId: string; periodStart: string; periodEnd: string; locationRef: string;
  departmentRef: string; budgetCents: number; committedCents: number; forecastCents: number; timestamp: number;
}) {
  const { organizationId, accountId, periodStart, periodEnd, locationRef, departmentRef, budgetCents, committedCents, forecastCents, timestamp } = input;
  const row = await database.prepare(`INSERT INTO bookloq_budgets
    (id, organization_id, account_id, period_start, period_end, location_ref, department_ref,
     budget_cents, committed_cents, forecast_cents, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(organization_id, account_id, period_start, period_end, location_ref, department_ref)
    DO UPDATE SET budget_cents = excluded.budget_cents, committed_cents = excluded.committed_cents,
      forecast_cents = excluded.forecast_cents, updated_at = excluded.updated_at
    RETURNING id`)
    .bind(crypto.randomUUID(), organizationId, accountId, periodStart, periodEnd, locationRef,
      departmentRef, budgetCents, committedCents, forecastCents, timestamp, timestamp).first<{ id: string }>();
  if (!row) throw new ApiError(409, "BUDGET_CHANGED", "The budget changed before saving. Refresh and try again.");
  return row.id;
}

export async function updateCloseItem(database: D1Database, input: {
  organizationId: string; itemId: string; beforeStatus: string; status: string; timestamp: number;
}) {
  const row = await database.prepare(`UPDATE month_end_items SET status = ?, completed_at = ?, updated_at = ?
    WHERE organization_id = ? AND id = ? AND status = ?
      AND EXISTS (SELECT 1 FROM accounting_periods p WHERE p.id = month_end_items.period_id
        AND p.organization_id = month_end_items.organization_id AND p.status IN ('open', 'review'))
    RETURNING id`)
    .bind(input.status, input.status === "complete" ? input.timestamp : null, input.timestamp,
      input.organizationId, input.itemId, input.beforeStatus).first<{ id: string }>();
  if (!row) throw new ApiError(409, "CLOSE_ITEM_LOCKED_OR_CHANGED", "The checklist item changed or its accounting period is locked. Refresh before editing; reopen a locked period with a recorded reason.");
}

export async function lockBookloqPeriod(database: D1Database, input: {
  organizationId: string; periodId: string; actorUserId: string; timestamp: number;
}) {
  const row = await database.prepare(`UPDATE accounting_periods SET status = 'locked', locked_at = ?, locked_by_user_id = ?, updated_at = ?
    WHERE organization_id = ? AND id = ? AND status IN ('open', 'review')
      AND EXISTS (SELECT 1 FROM month_end_items m WHERE m.organization_id = accounting_periods.organization_id AND m.period_id = accounting_periods.id)
      AND NOT EXISTS (SELECT 1 FROM month_end_items m WHERE m.organization_id = accounting_periods.organization_id
        AND m.period_id = accounting_periods.id AND m.status <> 'complete')
    RETURNING id`)
    .bind(input.timestamp, input.actorUserId, input.timestamp, input.organizationId, input.periodId).first<{ id: string }>();
  if (!row) throw new ApiError(409, "CLOSE_INCOMPLETE_OR_CHANGED", "Review and complete every checklist item before locking an open period. Refresh if another reviewer changed it. Checklist completion records your review; it is not automatic verification of the books.");
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
  const canonical=ledgerIntelligence(rows);
  const operatingProfitCents = canonical.operatingProfitCents;
  const netProfitCents=canonical.netProfitCents;
  const cogsCents = canonical.cogsCents;
  const grossProfitCents = canonical.grossProfitCents;
  const cashCents = canonical.cashCents;
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
    profitAndLoss: { revenueCents, expenseCents, cogsCents, grossProfitCents, operatingProfitCents, netProfitCents, operatingRevenueCents:canonical.operatingRevenueCents, operatingExpensesCents:canonical.operatingExpensesCents, otherIncomeCents:canonical.otherIncomeCents, financeAndTaxCents:canonical.financeAndTaxCents },
    balanceSheet: { assetCents, liabilityCents, equityCents: exactMoney(BigInt(equityBeforeEarningsCents) + BigInt(netProfitCents)) },
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
    const net = (certainty: "confirmed" | "probable" | "estimated") => exactSum(included.filter(item => item.certainty === certainty).map(item => item.direction === "in" ? item.amountCents : -item.amountCents));
    const confirmedNetCents = net("confirmed"), probableNetCents = net("probable"), estimatedNetCents = net("estimated");
    return { days, endDate: end, confirmedNetCents, probableNetCents, estimatedNetCents, closingCashCents: exactSum([openingCashCents, confirmedNetCents, probableNetCents, estimatedNetCents]) };
  });
}
