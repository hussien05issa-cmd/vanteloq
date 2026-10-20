import { reconciledCashSnapshot, type ReconciledCashAccount } from "../domain/bank-cash-snapshot";
import { exactSum } from "../domain/executive-metrics";
import { isCalendarDate } from "../domain/calendar-date";

type StatementRow = Omit<ReconciledCashAccount, "outstandingWithdrawalsCents" | "outstandingReceiptsCents" | "sourceValid">
  & { sourceValid: number; snapshotJson: string | null; reversalPairsJson: string };

/** Organization-scoped, one SQL statement: coverage cannot be assembled from
 * independently changing reads, and a reopened latest run cannot fall back to
 * a previous completed one. All sources must remain retained and approved. */
export async function loadReconciledCashScenario(database: D1Database, input: {
  organizationId: string; currency: string; asOf: string; nowMs: number;
  allowed: boolean; dataMode: string; bookloqActive: boolean;
}) {
  if (!input.allowed || !input.bookloqActive || input.dataMode !== "live") return reconciledCashSnapshot({ ...input, accounts: [] });
  const result = await database.prepare(`
    WITH cash AS (
      SELECT b.id bankId,b.financial_account_id accountId,b.provider,b.currency
      FROM bank_accounts b INNER JOIN financial_accounts a
        ON a.organization_id=b.organization_id AND a.id=b.financial_account_id
      WHERE b.organization_id=? AND b.demo_record=0 AND a.active=1
        AND b.account_type IN ('chequing','savings','merchant') AND UPPER(b.currency)=?
    ), ranked AS (
      SELECT r.*,q.end_date endDate,q.closing_balance_cents closingBalanceCents,
        q.difference_cents differenceCents,
        ROW_NUMBER() OVER(PARTITION BY r.account_id ORDER BY q.end_date DESC,r.created_at DESC,r.rowid DESC) position
      FROM bank_reconciliation_runs r INNER JOIN reconciliations q
        ON q.id=r.reconciliation_id AND q.organization_id=r.organization_id AND q.account_id=r.account_id
      WHERE r.organization_id=? AND EXISTS(SELECT 1 FROM cash WHERE cash.accountId=r.account_id)
    )
    SELECT c.accountId,c.provider,c.currency,r.id runId,r.source_id sourceId,r.status runStatus,
      r.endDate,r.closingBalanceCents,r.closing_book_cents closingBookCents,r.uncleared_cents unclearedCents,
      r.snapshot_json snapshotJson,
      (SELECT COALESCE(json_group_array(json_object('reversal',j.id,'original',j.reversal_of_entry_id)),'[]')
        FROM journal_entries j WHERE j.organization_id=? AND j.reversal_of_entry_id IS NOT NULL
          AND j.status IN ('posted','reversed') AND j.entry_date<=r.endDate) reversalPairsJson,
      (SELECT COALESCE(SUM(l.debit_cents-l.credit_cents),0) FROM journal_lines l
        JOIN journal_entries j ON j.id=l.journal_entry_id AND j.organization_id=l.organization_id
        WHERE l.organization_id=? AND l.account_id=c.accountId AND j.status IN ('posted','reversed')
          AND j.entry_date<=r.endDate) currentClosingBookCents,
      (EXISTS(SELECT 1 FROM financial_transactions t WHERE t.organization_id=? AND t.account_id=c.accountId
          AND t.demo_record=0 AND t.source_state IN ('posted','modified') AND t.posting_date>r.endDate)
        +EXISTS(SELECT 1 FROM journal_lines l JOIN journal_entries j
          ON j.id=l.journal_entry_id AND j.organization_id=l.organization_id
          WHERE l.organization_id=? AND l.account_id=c.accountId AND j.status IN ('posted','reversed') AND j.entry_date>r.endDate)
        +EXISTS(SELECT 1 FROM bank_csv_imports s WHERE s.organization_id=? AND s.bank_account_id=c.bankId
          AND s.status='approved' AND s.end_date>r.endDate
          AND NOT EXISTS(SELECT 1 FROM bank_csv_void_events v WHERE v.organization_id=s.organization_id AND v.import_id=s.id))
        +EXISTS(SELECT 1 FROM bank_statement_imports s WHERE s.organization_id=? AND s.bank_account_id=c.bankId
          AND s.demo_record=0 AND s.status='approved' AND s.end_date>r.endDate)) postCutoffMovementCount,
      (r.differenceCents=0 AND r.currency=c.currency AND (
        (r.source_type='csv' AND EXISTS(SELECT 1 FROM bank_csv_imports s WHERE s.id=r.source_id
          AND s.organization_id=? AND s.bank_account_id=c.bankId AND s.financial_account_id=c.accountId
          AND s.status='approved' AND s.currency=c.currency AND s.end_date=r.endDate AND s.closing_balance_cents=r.closingBalanceCents
          AND NOT EXISTS(SELECT 1 FROM bank_csv_void_events v WHERE v.organization_id=s.organization_id AND v.import_id=s.id)))
        OR (r.source_type='statement' AND EXISTS(SELECT 1 FROM bank_statement_imports s WHERE s.id=r.source_id
          AND s.organization_id=? AND s.bank_account_id=c.bankId AND s.financial_account_id=c.accountId
          AND s.demo_record=0 AND s.status='approved' AND s.currency=c.currency
          AND s.end_date=r.endDate AND s.closing_balance_cents=r.closingBalanceCents)))) sourceValid
    FROM cash c LEFT JOIN ranked r ON r.account_id=c.accountId AND r.position=1
    ORDER BY c.accountId
  `).bind(input.organizationId, input.currency.toUpperCase(), input.organizationId,
    input.organizationId, input.organizationId, input.organizationId, input.organizationId,
    input.organizationId, input.organizationId, input.organizationId, input.organizationId).all<StatementRow>();
  const accounts = (result.results ?? []).map(row => {
    let outstandingWithdrawalsCents: number | null = null, outstandingReceiptsCents: number | null = null;
    try {
      const snapshot = JSON.parse(row.snapshotJson ?? "null") as { baselineDate: string; ledger: { id: string; entryDate: string; amountCents: number; previouslyCleared: boolean | number }[]; rows: { journalEntryId: string | null; amountCents: number }[] } | null;
      if (snapshot && isCalendarDate(snapshot.baselineDate) && Array.isArray(snapshot.ledger) && Array.isArray(snapshot.rows)
        && snapshot.ledger.length <= 10000 && snapshot.rows.length <= 500
        && new Set(snapshot.ledger.map(line => line.id)).size === snapshot.ledger.length
        && snapshot.ledger.every(line => typeof line.id === "string" && "journalEntryId" in line && typeof line.journalEntryId === "string"
          && isCalendarDate(line.entryDate) && Number.isSafeInteger(line.amountCents))
        && snapshot.rows.every(source => typeof source.journalEntryId === "string" && Number.isSafeInteger(source.amountCents))) {
        const ledger = snapshot.ledger as (typeof snapshot.ledger[number] & { journalEntryId: string })[];
        const cleared = new Set(ledger.filter(line => snapshot.rows.some(source => source.journalEntryId === line.journalEntryId && source.amountCents === line.amountCents)).map(line => line.id));
        const unmatched = ledger.filter(line => line.entryDate >= snapshot.baselineDate && !line.previouslyCleared && !cleared.has(line.id));
        const cancelled = new Set<string>();
        for (const pair of JSON.parse(row.reversalPairsJson) as { reversal: string; original: string }[]) {
          const original = unmatched.filter(line => line.journalEntryId === pair.original);
          const reversal = unmatched.filter(line => line.journalEntryId === pair.reversal);
          if (original.length === 1 && reversal.length === 1 && !cancelled.has(original[0].id) && !cancelled.has(reversal[0].id)
            && exactSum([original[0].amountCents, reversal[0].amountCents]) === 0) {
            cancelled.add(original[0].id); cancelled.add(reversal[0].id);
          }
        }
        const outstanding = unmatched.filter(line => !cancelled.has(line.id));
        outstandingWithdrawalsCents = exactSum(outstanding.filter(line => line.amountCents < 0).map(line => -line.amountCents));
        outstandingReceiptsCents = exactSum(outstanding.filter(line => line.amountCents > 0).map(line => line.amountCents));
      }
    } catch { /* A damaged retained snapshot withholds authority, never zero-fills. */ }
    return { ...row, sourceValid: Boolean(row.sourceValid), outstandingWithdrawalsCents, outstandingReceiptsCents };
  });
  return reconciledCashSnapshot({ ...input, accounts });
}
