import { ApiError, clientSource, hashIdentifier } from "./api.ts";

/** Unlinks evidence only. Accounting allocations and original journals survive. */
export async function removeSupportingMatch(database: D1Database, input: {
  organizationId: string; transactionId: string; matchId: string; reason: string;
  actorUserId: string; timestamp: number; request: Request; requestId: string;
}) {
  const reason = input.reason.trim().normalize("NFC");
  if (reason.length < 3 || reason.length > 500 || /[\u0000-\u001f\u007f]/.test(reason)) {
    throw new ApiError(400, "MATCH_CORRECTION_REASON", "Explain why this supporting match is incorrect.");
  }
  const row = await database.prepare(`SELECT m.status, t.reconciliation_status reconciliationStatus
    FROM bookloq_transaction_matches m JOIN financial_transactions t
      ON t.id=m.transaction_id AND t.organization_id=m.organization_id
    WHERE m.organization_id=? AND m.transaction_id=? AND m.id=?`)
    .bind(input.organizationId, input.transactionId, input.matchId)
    .first<{ status: string; reconciliationStatus: string }>();
  if (!row) throw new ApiError(404, "MATCH_UNAVAILABLE", "The supporting match is unavailable. Refresh this transaction.");
  if (row.status === "rejected") return { replayed: true };
  if (row.status !== "confirmed") throw new ApiError(409, "MATCH_CHANGED", "Select the currently confirmed supporting match.");
  const auditId = crypto.randomUUID();
  const sourceHash = await hashIdentifier(clientSource(input.request));
  const results = await database.batch([
    database.prepare(`UPDATE bookloq_transaction_matches SET status='rejected',updated_at=?
      WHERE organization_id=? AND transaction_id=? AND id=? AND status='confirmed'
      AND EXISTS(SELECT 1 FROM financial_transactions t WHERE t.organization_id=bookloq_transaction_matches.organization_id
        AND t.id=bookloq_transaction_matches.transaction_id AND t.reconciliation_status<>'reconciled')
      AND NOT EXISTS(SELECT 1 FROM bank_reconciliation_lines cleared WHERE cleared.organization_id=bookloq_transaction_matches.organization_id
        AND cleared.transaction_id=bookloq_transaction_matches.transaction_id AND cleared.active=1)
      `).bind(input.timestamp, input.organizationId, input.transactionId, input.matchId),
    database.prepare(`INSERT INTO audit_events(id,organization_id,actor_user_id,action,resource_type,resource_id,
      outcome,request_id,source_hash,details_json,created_at)
      SELECT ?,?,?,'financial_transaction.supporting_record_unmatched','financial_transaction',?,
        'success',?,?,?,? WHERE changes()=1`)
      .bind(auditId, input.organizationId, input.actorUserId, input.transactionId,
        input.requestId, sourceHash, JSON.stringify({ matchId: input.matchId, reason, previousStatus: row.status, ledgerUnchanged: true }), input.timestamp),
    database.prepare(`UPDATE financial_transactions SET reconciliation_status='unreconciled',updated_at=?
      WHERE organization_id=? AND id=? AND reconciliation_status='matched'
      AND EXISTS(SELECT 1 FROM audit_events a WHERE a.id=? AND a.organization_id=financial_transactions.organization_id)
      AND NOT EXISTS(SELECT 1 FROM bookloq_transaction_matches m WHERE m.organization_id=financial_transactions.organization_id
        AND m.transaction_id=financial_transactions.id AND m.status='confirmed')`)
      .bind(input.timestamp, input.organizationId, input.transactionId, auditId),
  ]);
  if (results[0]?.meta?.changes !== 1) throw new ApiError(409, "MATCH_CORRECTION_BLOCKED", "The match changed or belongs to a completed reconciliation. Reopen the latest reconciliation before correcting its evidence.");
  return { replayed: false };
}
