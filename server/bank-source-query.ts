export type BankSourceKind = "csv" | "statement";

/** Values are bound; only the two server-owned source definitions form SQL. */
export function bankSourceQuery(organizationId: string, selection?: { type: BankSourceKind; id: string }) {
  const kinds: BankSourceKind[] = selection ? [selection.type] : ["csv", "statement"];
  const bindings: string[] = [];
  const selects = kinds.map(type => {
    bindings.push(organizationId, ...(selection ? [selection.id] : []));
    const csv = type === "csv";
    return `SELECT s.id AS id, '${type}' sourceType, s.bank_account_id bankAccountId,
      s.financial_account_id accountId, b.name accountName, s.start_date startDate,
      s.end_date endDate, s.currency, s.opening_balance_cents openingBalanceCents,
      s.closing_balance_cents closingBalanceCents, s.row_count rowCount,
      ${csv ? "s.file_name" : "d.file_name"} fileName, r.id runId, r.status
      FROM ${csv ? "bank_csv_imports" : "bank_statement_imports"} s
      JOIN bank_accounts b ON b.id=s.bank_account_id AND b.organization_id=s.organization_id
      ${csv ? "" : "JOIN workspace_documents d ON d.id=s.document_id AND d.organization_id=s.organization_id"}
      LEFT JOIN bank_reconciliation_runs r ON r.organization_id=s.organization_id
        AND r.source_type='${type}' AND r.source_id=s.id AND r.status='completed'
      WHERE s.organization_id=? ${selection ? "AND s.id=?" : ""} AND s.status='approved'
      ${csv ? "AND NOT EXISTS(SELECT 1 FROM bank_csv_void_events v WHERE v.organization_id=s.organization_id AND v.import_id=s.id)" : "AND s.demo_record=0"}`;
  });
  return {
    sql: `SELECT * FROM (${selects.join(" UNION ALL ")}) ORDER BY endDate DESC, id DESC LIMIT ${selection ? 2 : 200}`,
    bindings,
  };
}
