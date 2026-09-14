import { buildBusinessCashSummary, type BusinessCashTransaction } from "../domain/bookloq-cash-management";

/** Call only after the organization, bank-transaction and payroll permissions
 * have been verified. Summaries cover all eligible bank activity, not a UI page. */
export async function loadBookloqCashActivity(database: D1Database, input: {
  organizationId: string; currency: string; asOf: string;
  dataMode: "live" | "demonstration"; allowed: boolean;
}) {
  const start = new Date(Date.parse(`${input.asOf}T00:00:00Z`) - 364 * 86_400_000).toISOString().slice(0, 10);
  const result = input.allowed ? await database.prepare(`
    SELECT t.posting_date postingDate, SUM(t.amount_cents) amountCents,
      COUNT(*) recordCount, COALESCE(a.name, 'Uncategorized') category,
      (t.categorization_status = 'confirmed') categorized,
      (t.reconciliation_status IN ('matched', 'reconciled') OR EXISTS (
        SELECT 1 FROM bookloq_transaction_matches m
        WHERE m.organization_id = t.organization_id AND m.transaction_id = t.id AND m.status = 'confirmed'
      )) matched
    FROM financial_transactions t
    LEFT JOIN financial_accounts a ON a.id = t.category_account_id AND a.organization_id = t.organization_id
    WHERE t.organization_id = ? AND UPPER(t.currency) = ? AND t.demo_record = ?
      AND t.source_state IN ('posted', 'modified') AND t.posting_date BETWEEN ? AND ?
      AND EXISTS (
        SELECT 1 FROM bank_accounts b
        WHERE b.organization_id = t.organization_id AND b.financial_account_id = t.account_id
          AND UPPER(b.currency) = UPPER(t.currency) AND b.demo_record = t.demo_record
          AND b.account_type IN ('chequing', 'savings', 'merchant')
          AND ((? = 'demonstration' AND b.demo_record = 1) OR (
            ? = 'live' AND t.source_system = 'plaid' AND b.provider = 'plaid'
            AND EXISTS (SELECT 1 FROM integration_connections c
              WHERE c.organization_id = t.organization_id AND c.provider = 'plaid'
                AND c.external_account_ref = b.external_item_ref
                AND c.status = 'connected' AND c.data_promotion_status = 'approved'
                AND (c.sync_lease_owner IS NULL OR c.sync_lease_expires_at IS NULL
                  OR c.sync_lease_expires_at <= CAST(strftime('%s', 'now') AS INTEGER))
            )
          ))
      )
    GROUP BY t.posting_date, COALESCE(a.name, 'Uncategorized'), (t.amount_cents < 0), categorized, matched
    ORDER BY t.posting_date
  `).bind(input.organizationId, input.currency.toUpperCase(), input.dataMode === "demonstration" ? 1 : 0,
    start, input.asOf, input.dataMode, input.dataMode).all<BusinessCashTransaction>() : null;
  const activity = (result?.results ?? []).map(row => ({ ...row, categorized: Boolean(row.categorized), matched: Boolean(row.matched) }));
  return {
    days30: buildBusinessCashSummary(activity, input.asOf, 30),
    days90: buildBusinessCashSummary(activity, input.asOf, 90),
    months12: buildBusinessCashSummary(activity, input.asOf, 365),
  };
}
