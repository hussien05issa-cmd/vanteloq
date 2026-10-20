// The caller supplies a tenant-scoped financial_transactions row aliased `t`.
// An approved replacement Item must not promote retained rows from a different
// or disconnected bank account. Retained accounting/source rows stay stored.
export const BOOKLOQ_TRANSACTION_SOURCE_SQL = `(t.source_system <> 'plaid' OR EXISTS (
  SELECT 1 FROM bank_accounts source_bank
  INNER JOIN integration_connections source_connection
    ON source_connection.organization_id = source_bank.organization_id
      AND source_connection.provider = 'plaid'
      AND source_connection.external_account_ref = source_bank.external_item_ref
  WHERE source_bank.organization_id = t.organization_id
    AND source_bank.financial_account_id = t.account_id
    AND source_bank.provider = 'plaid'
    AND source_bank.external_item_ref IS NOT NULL
    AND source_connection.status = 'connected'
    AND source_connection.data_promotion_status = 'approved'
    AND (source_connection.sync_lease_owner IS NULL OR source_connection.sync_lease_expires_at IS NULL
      OR source_connection.sync_lease_expires_at <= CAST(strftime('%s', 'now') AS INTEGER))
))`;
