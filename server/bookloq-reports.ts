import { isCalendarDate } from "../domain/calendar-date.ts";
import { csvCell } from "../domain/csv.ts";
import { exactSum, ledgerIntelligence, type ExecutiveLedgerRow } from "../domain/executive-metrics.ts";
import { ApiError } from "./api.ts";
import { canReadCompleteBookLoQLedger } from "./bookloq-ledger-view.ts";

export type BookloqReportKind = "pnl" | "balance" | "trial";
export type BookloqReportQuery = { from: string; to: string; report: BookloqReportKind; accountId: string | null; after: [string, string, number] | null; format: "json" | "csv" };
export type BookloqReportAccount = ExecutiveLedgerRow & { code: string; normalBalance: string; active: number; closingDebitCents: number; closingCreditCents: number; periodBalanceCents: number; closingBalanceCents: number; lineCount: number; closingLineCount: number };
export type BookloqReportLine = { entryId: string; entryNumber: string; entryDate: string; postingDate: string; memo: string; sourceType: string; sourceRef: string | null; reversalOfEntryId: string | null; lineNumber: number; description: string; debitCents: number; creditCents: number; locationRef: string };
export type BookloqDatedReport = {
  metadata: { organizationId: string; currency: string; timeZone: string; from: string; to: string; asOf: string; accountingBasis: "accrual"; source: "posted_ledger"; scope: "all_locations"; dataMode: "live" | "demonstration"; generatedAt: string; lastPostedAt: string | null; calculationVersion: string; foreignEntryCount: number; detailAvailable: boolean; boundary: string };
  accounts: BookloqReportAccount[];
  profitAndLoss: ReturnType<typeof ledgerIntelligence>;
  balanceSheet: { assetCents: number; liabilityCents: number; equityCents: number; recordedEarningsCents: number; differenceCents: number };
  trialBalance: { debitCents: number; creditCents: number; differenceCents: number };
  coverage: { periodLineCount: number; closingLineCount: number };
  detail: { accountId: string; from: string | null; to: string; lines: BookloqReportLine[]; nextCursor: string | null } | null;
};
const LIMIT = 2000;
const DETAIL_LIMIT = 200;
const EXPORT_LIMIT = 10000;
export const BOOKLOQ_REPORT_BOUNDARY = "Posted ledger entries only, using their recorded entry dates. Original entries and reversals remain on their own dates. Imported bank movements, invoices, bills and provider reports are excluded until separately posted. Opening balances, completeness and tax adjustments require review. These reports do not convert currencies or cash-basis records, reconstruct historical payment allocations, or certify the books.";

export function requireBookloqReportScope(permissions: readonly string[], organizationWide: boolean, selectedLocation: string | null, exporting: boolean) {
  if (!canReadCompleteBookLoQLedger(permissions)) throw new ApiError(403, "BOOKLOQ_LEDGER_ACCESS_REQUIRED", "Complete financial reports require all ledger disclosure permissions, including banking, payroll totals, revenue, costs and receivables/payables.");
  if (!organizationWide || selectedLocation) throw new ApiError(403, "BOOKLOQ_REPORT_ORGANIZATION_SCOPE_REQUIRED", "Select All locations with organization-wide access to read a complete financial report. A subset of journal lines may not balance.");
  if (exporting && !permissions.includes("finance.export")) throw new ApiError(403, "BOOKLOQ_REPORT_EXPORT_REQUIRED", "Your role cannot export financial reports.");
}

export function bookloqReportQuery(params: URLSearchParams, today: string): BookloqReportQuery {
  for (const key of params.keys()) if (!["from", "to", "report", "accountId", "after", "format", "location", "workspace"].includes(key) || params.getAll(key).length !== 1) throw new ApiError(400, "BOOKLOQ_REPORT_FILTER_INVALID", "Use the supported report filters once each.");
  const report = params.get("report") ?? "pnl", format = params.get("format") ?? "json", accountId = params.get("accountId");
  const to = params.get("to") ?? today, from = params.get("from") ?? (report === "pnl" ? `${to.slice(0, 7)}-01` : to);
  if (!isCalendarDate(from) || !isCalendarDate(to) || from < "1900-01-01" || to < from || to > today || (Date.parse(to) - Date.parse(from)) / 86400000 > 3660) throw new ApiError(400, "BOOKLOQ_REPORT_DATES_INVALID", "Choose valid dates from 1900 onward, ending no later than today, with a period of at most ten years.");
  if (!["pnl", "balance", "trial"].includes(report) || !["json", "csv"].includes(format) || (accountId !== null && (!accountId || accountId.length > 180 || /[\u0000-\u001f\u007f]/.test(accountId)))) throw new ApiError(400, "BOOKLOQ_REPORT_FILTER_INVALID", "Choose a supported report and account.");
  let after: BookloqReportQuery["after"] = null;
  const cursor = params.get("after");
  if (cursor !== null) {
    try {
      if (!accountId || cursor.length > 1024 || format === "csv") throw Error();
      const value: unknown = JSON.parse(atob(cursor));
      if (!Array.isArray(value) || value.length !== 3 || !isCalendarDate(value[0]) || typeof value[1] !== "string" || !value[1] || value[1].length > 180 || !Number.isSafeInteger(value[2]) || value[2] < 1 || value[2] > 50) throw Error();
      after = value as [string, string, number];
    } catch { throw new ApiError(400, "BOOKLOQ_REPORT_CURSOR_INVALID", "Refresh this account's entries before loading more."); }
  }
  return { from, to, report: report as BookloqReportKind, accountId, after, format: format as "json" | "csv" };
}

/** Same entry-date and posted/reversed semantics as executive-finance. Archived accounts retain history. */
export const BOOKLOQ_DATED_ACCOUNTS_SQL = `SELECT a.id,a.code,a.name,a.account_type accountType,a.account_subtype accountSubtype,a.system_key systemKey,a.normal_balance normalBalance,a.active,
  COALESCE(SUM(CASE WHEN e.entry_date BETWEEN ? AND ? THEN l.debit_cents ELSE 0 END),0) debitCents,
  COALESCE(SUM(CASE WHEN e.entry_date BETWEEN ? AND ? THEN l.credit_cents ELSE 0 END),0) creditCents,
  COALESCE(SUM(CASE WHEN e.id IS NOT NULL THEN l.debit_cents ELSE 0 END),0) closingDebitCents,
  COALESCE(SUM(CASE WHEN e.id IS NOT NULL THEN l.credit_cents ELSE 0 END),0) closingCreditCents,
  COUNT(CASE WHEN e.entry_date BETWEEN ? AND ? THEN l.id END) lineCount,
  COUNT(CASE WHEN e.id IS NOT NULL THEN l.id END) closingLineCount, MAX(e.posted_at) lastPostedAt
  FROM financial_accounts a
  LEFT JOIN journal_lines l ON l.account_id=a.id AND l.organization_id=a.organization_id
  LEFT JOIN journal_entries e ON e.id=l.journal_entry_id AND e.organization_id=a.organization_id
    AND e.status IN ('posted','reversed') AND e.currency=? AND e.entry_date<=?
  WHERE a.organization_id=? GROUP BY a.id ORDER BY a.code,a.id LIMIT ${LIMIT + 1}`;

export function canReadBookloqReportDetails(permissions: readonly string[]) {
  return permissions.includes("finance.bank_transactions") && permissions.includes("payroll.individual");
}

export async function loadBookloqDatedReport(database: D1Database, input: { organizationId: string; currency: string; timeZone: string; contactIdentity: boolean; individualDetails: boolean; query: BookloqReportQuery }, now = new Date()): Promise<BookloqDatedReport> {
  const { organizationId, query } = input;
  // Counterpart accounts can reveal individual payroll/banking amounts too.
  if (query.accountId && !input.individualDetails) throw new ApiError(403, "BOOKLOQ_REPORT_DETAIL_ACCESS_REQUIRED", "Journal line details require individual payroll and banking transaction permissions. Aggregate reports remain available.");
  const settings = await database.prepare("SELECT base_currency currency,accounting_basis basis,status,data_mode dataMode FROM bookloq_settings WHERE organization_id=?").bind(organizationId).first<{ currency: string; basis: string; status: string; dataMode: "live" | "demonstration" }>();
  if (!settings || settings.status !== "active") throw new ApiError(409, "BOOKLOQ_REPORT_SETUP_REQUIRED", "Set up an active chart of accounts and accounting profile before reading dated reports.");
  if (settings.basis !== "accrual") throw new ApiError(409, "BOOKLOQ_REPORT_BASIS_UNSUPPORTED", "This profile uses cash-basis accounting. Cash-basis conversion is not implemented, so dated financial reports are unavailable. No accounting setting has been changed.");
  if (!/^[A-Z]{3}$/.test(settings.currency) || settings.currency !== input.currency) throw new ApiError(409, "BOOKLOQ_REPORT_CURRENCY_REVIEW", "The accounting and workspace currencies must agree before reporting. No currency conversion is performed.");
  if (!["live", "demonstration"].includes(settings.dataMode)) throw new ApiError(409, "BOOKLOQ_REPORT_MODE_INVALID", "Review the accounting data mode before reporting.");
  const statements = [database.prepare(BOOKLOQ_DATED_ACCOUNTS_SQL).bind(query.from, query.to, query.from, query.to, query.from, query.to, settings.currency, query.to, organizationId),
    database.prepare("SELECT COUNT(*) count FROM journal_entries WHERE organization_id=? AND status IN ('posted','reversed') AND entry_date<=? AND currency<>?").bind(organizationId, query.to, settings.currency)];
  if (query.accountId) {
    const cursor = query.after;
    statements.push(database.prepare(`SELECT e.id entryId,e.entry_number entryNumber,e.entry_date entryDate,e.posting_date postingDate,e.memo,e.source_type sourceType,e.source_ref sourceRef,e.reversal_of_entry_id reversalOfEntryId,l.line_number lineNumber,l.description,l.debit_cents debitCents,l.credit_cents creditCents,l.location_ref locationRef
      FROM journal_lines l JOIN journal_entries e ON e.id=l.journal_entry_id AND e.organization_id=l.organization_id
      JOIN financial_accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id
      WHERE l.organization_id=? AND l.account_id=? AND e.currency=? AND e.status IN ('posted','reversed') AND e.entry_date<=?
      ${query.report === "pnl" ? "AND e.entry_date>=?" : ""}
      ${cursor ? "AND (e.entry_date<? OR (e.entry_date=? AND e.id<?) OR (e.entry_date=? AND e.id=? AND l.line_number<?))" : ""}
      ORDER BY e.entry_date DESC,e.id DESC,l.line_number DESC LIMIT ?`).bind(organizationId, query.accountId, settings.currency, query.to,
      ...(query.report === "pnl" ? [query.from] : []), ...(cursor ? [cursor[0], cursor[0], cursor[1], cursor[0], cursor[1], cursor[2]] : []), (query.format === "csv" ? EXPORT_LIMIT : DETAIL_LIMIT) + 1));
  }
  // D1's read batch keeps balances, coverage and drilldown on the same read transaction.
  const results = await database.batch(statements);
  const raw = results[0].results as Array<Omit<BookloqReportAccount, "periodBalanceCents" | "closingBalanceCents"> & { lastPostedAt: number | null }>;
  if (raw.length > LIMIT) throw new ApiError(409, "BOOKLOQ_REPORT_LIMIT", "This report exceeds 2,000 accounts. No partial financial totals are shown.");
  if (query.accountId && !raw.some(row => row.id === query.accountId)) throw new ApiError(404, "BOOKLOQ_REPORT_ACCOUNT_NOT_FOUND", "This account is unavailable in the current business.");
  try {
    const accounts: BookloqReportAccount[] = raw.map(row => {
      for (const amount of [row.debitCents, row.creditCents, row.closingDebitCents, row.closingCreditCents, row.lineCount, row.closingLineCount]) if (!Number.isSafeInteger(amount) || amount < 0) throw Error("Invalid ledger amount");
      const sign = ["asset", "expense"].includes(row.accountType) ? 1 : -1;
      return { id: row.id, code: row.code, name: row.name, accountType: row.accountType, accountSubtype: row.accountSubtype, systemKey: row.systemKey, normalBalance: row.normalBalance, active: row.active, debitCents: row.debitCents, creditCents: row.creditCents, closingDebitCents: row.closingDebitCents, closingCreditCents: row.closingCreditCents, lineCount: row.lineCount, closingLineCount: row.closingLineCount, periodBalanceCents: sign * exactSum([row.debitCents, -row.creditCents]), closingBalanceCents: sign * exactSum([row.closingDebitCents, -row.closingCreditCents]) };
    });
    const profitAndLoss = ledgerIntelligence(accounts), closing = ledgerIntelligence(accounts.map(row => ({ ...row, debitCents: row.closingDebitCents, creditCents: row.closingCreditCents })));
    const debitCents = exactSum(accounts.map(row => Math.max(0, exactSum([row.closingDebitCents, -row.closingCreditCents]))));
    const creditCents = exactSum(accounts.map(row => Math.max(0, exactSum([row.closingCreditCents, -row.closingDebitCents]))));
    let detail: BookloqDatedReport["detail"] = null;
    if (query.accountId) {
      const lines = results[2].results as BookloqReportLine[];
      if (query.format === "csv" && lines.length > EXPORT_LIMIT) throw new ApiError(409, "BOOKLOQ_REPORT_EXPORT_LIMIT", "This account exceeds 10,000 entries for this report. Narrow the period or review the paginated entries. No partial CSV was exported.");
      const selected = lines.slice(0, query.format === "csv" ? EXPORT_LIMIT : DETAIL_LIMIT).map(row => {
        for (const amount of [row.debitCents, row.creditCents]) if (!Number.isSafeInteger(amount) || amount < 0) throw Error("Invalid ledger amount");
        return input.contactIdentity ? row : { ...row, memo: "Journal explanation restricted", description: "Line description restricted", sourceRef: null };
      });
      const last = selected.at(-1);
      detail = { accountId: query.accountId, from: query.report === "pnl" ? query.from : null, to: query.to, lines: selected, nextCursor: lines.length > selected.length && last ? btoa(JSON.stringify([last.entryDate, last.entryId, last.lineNumber])) : null };
    }
    const foreignEntryCount = Number((results[1].results?.[0] as { count: number } | undefined)?.count);
    if (!Number.isSafeInteger(foreignEntryCount) || foreignEntryCount < 0) throw Error("Invalid currency coverage");
    const lastPosted = Math.max(0, ...raw.map(row => row.lastPostedAt ?? 0));
    return { metadata: { organizationId, currency: settings.currency, timeZone: input.timeZone, from: query.from, to: query.to, asOf: query.to, accountingBasis: "accrual", source: "posted_ledger", scope: "all_locations", dataMode: settings.dataMode, generatedAt: now.toISOString(), lastPostedAt: lastPosted ? new Date(lastPosted * 1000).toISOString() : null, calculationVersion: "bookloq-dated-ledger-v1", foreignEntryCount, detailAvailable: input.individualDetails, boundary: BOOKLOQ_REPORT_BOUNDARY }, accounts, profitAndLoss,
      balanceSheet: { assetCents: closing.assetsCents, liabilityCents: closing.liabilitiesCents, equityCents: closing.equityCents, recordedEarningsCents: closing.netProfitCents, differenceCents: closing.balanceDifferenceCents },
      trialBalance: { debitCents, creditCents, differenceCents: exactSum([debitCents, -creditCents]) }, coverage: { periodLineCount: exactSum(accounts.map(row => row.lineCount)), closingLineCount: exactSum(accounts.map(row => row.closingLineCount)) }, detail };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(409, "BOOKLOQ_REPORT_AMOUNT_INVALID", "The ledger contains an amount or total outside exact supported minor units. No financial totals are shown; review the source entries.");
  }
}

export function bookloqReportCsv(data: BookloqDatedReport, kind: BookloqReportKind): string {
  const m = data.metadata;
  const metadata: (string | number | null)[][] = [["BookLoQ report", kind], ["Organization ID", m.organizationId], ["Source", m.source], ["Scope", "All locations"], ["Accounting profile basis", m.accountingBasis], ["Data mode", m.dataMode], ["Currency", m.currency], ["Period start", kind === "pnl" ? m.from : "All recorded history"], ["Period end / as of", m.to], ["Business time zone", m.timeZone], ["Generated UTC", m.generatedAt], ["Last posted UTC", m.lastPostedAt], ["Calculation version", m.calculationVersion], ["Foreign-currency entries excluded", m.foreignEntryCount], ["Amount unit", "Integer minor units (cents)"], ["Boundary", m.boundary], []];
  let rows: (string | number | null)[][];
  if (data.detail) rows = [["Account ID", "Entry ID", "Entry", "Entry date", "Posting date", "Line", "Debit cents", "Credit cents", "Currency", "Source", "Source reference", "Reversal of", "Location", "Explanation", "Line description"], ...data.detail.lines.map(row => [data.detail!.accountId, row.entryId, row.entryNumber, row.entryDate, row.postingDate, row.lineNumber, row.debitCents, row.creditCents, m.currency, row.sourceType, row.sourceRef, row.reversalOfEntryId, row.locationRef, row.memo, row.description])];
  else {
    const accounts = data.accounts.filter(row => kind === "pnl" ? ["revenue", "expense"].includes(row.accountType) : kind === "balance" ? ["asset", "liability", "equity"].includes(row.accountType) : true);
    rows = [["Account ID", "Code", "Account", "Type", "Currency", kind === "trial" ? "Debit balance cents" : "Debit cents", kind === "trial" ? "Credit balance cents" : "Credit cents", "Statement balance cents", "Active"], ...accounts.map(row => [row.id, row.code, row.name, row.accountType, m.currency,
      kind === "trial" ? Math.max(0, exactSum([row.closingDebitCents, -row.closingCreditCents])) : kind === "pnl" ? row.debitCents : row.closingDebitCents,
      kind === "trial" ? Math.max(0, exactSum([row.closingCreditCents, -row.closingDebitCents])) : kind === "pnl" ? row.creditCents : row.closingCreditCents,
      kind === "pnl" ? row.periodBalanceCents : row.closingBalanceCents, row.active])];
    if (kind === "balance") rows.push(["", "", "Recorded earnings through as-of date (included in equity)", "equity", m.currency, "", "", data.balanceSheet.recordedEarningsCents, ""]);
    const totals = kind === "pnl" ? [["Revenue", data.profitAndLoss.revenueCents], ["Gross profit", data.profitAndLoss.grossProfitCents], ["Operating profit", data.profitAndLoss.operatingProfitCents], ["Net earnings", data.profitAndLoss.netProfitCents]] : kind === "balance" ? [["Assets", data.balanceSheet.assetCents], ["Liabilities", data.balanceSheet.liabilityCents], ["Equity including earnings", data.balanceSheet.equityCents], ["Balance difference", data.balanceSheet.differenceCents]] : [["Net debits", data.trialBalance.debitCents], ["Net credits", data.trialBalance.creditCents], ["Trial balance difference", data.trialBalance.differenceCents]];
    rows.push([], ["Summary", "Amount cents", "Currency"], ...totals.map(row => [...row, m.currency] as (string | number)[]));
  }
  return [...metadata, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n");
}
