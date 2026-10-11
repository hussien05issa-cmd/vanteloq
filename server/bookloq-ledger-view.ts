import type { LedgerAccountRow } from "./bookloq.ts";

// Archived accounts retain their posted history. Hiding them would remove one
// side of a retained entry, especially after disconnecting a banking provider.
export const BOOKLOQ_LEDGER_ACCOUNTS_SQL = `SELECT a.id, a.code, a.name, a.account_type accountType, a.account_subtype accountSubtype,
  a.normal_balance normalBalance, a.system_key systemKey, a.description, a.plain_language plainLanguage, a.active,
  COALESCE(SUM(CASE WHEN e.status IN ('posted', 'reversed') THEN l.debit_cents ELSE 0 END), 0) debitCents,
  COALESCE(SUM(CASE WHEN e.status IN ('posted', 'reversed') THEN l.credit_cents ELSE 0 END), 0) creditCents
  FROM financial_accounts a
  LEFT JOIN journal_lines l ON l.account_id = a.id AND l.organization_id = a.organization_id
  LEFT JOIN journal_entries e ON e.id = l.journal_entry_id AND e.organization_id = a.organization_id
  WHERE a.organization_id = ? GROUP BY a.id ORDER BY a.code`;

export function loadBookLoQLedgerAccounts(database: D1Database, organizationId: string) {
  return database.prepare(BOOKLOQ_LEDGER_ACCOUNTS_SQL).bind(organizationId).all<LedgerAccountRow & { active: number }>();
}
export function canReadCompleteBookLoQLedger(permissions: readonly string[]) {
  return ["finance.statements", "finance.costs", "metrics.profit", "metrics.revenue", "payroll.totals", "finance.bank_balances", "finance.ap_ar"].every(permission => permissions.includes(permission));
}
