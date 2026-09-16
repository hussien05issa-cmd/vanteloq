import type { VanteloqRuntimeEnv } from "../db/index.ts";
import { ApiError } from "./api.ts";
import { deleteAzureScan, type AzureScanOperation } from "./azure-document-scanner.ts";
import { deleteExtractionResult } from "./document-providers.ts";

import { matchesCleanupRetryLease, type DocumentCleanupRetry } from "./document-cleanup-state.ts";

type Deletion = {
  version: 1; requestedAt: number; requestedBy: string; originalRemoved: boolean;
  operation?: string; azureScan?: AzureScanOperation; lock?: string; leaseUntil?: number;
  retryRequired?: boolean; cleanupRetry?: DocumentCleanupRetry;
};
type Row = { id: string; object_key: string; extracted_json: string; status: string };
type Envelope = { deletion?: Deletion; processing?: { lock?: string; operation?: string; azureScan?: AzureScanOperation } };
function envelope(value: string): Envelope {
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; }
  catch { return {}; }
}
function pendingSteps(job: Deletion) {
  return [!job.originalRemoved && "original", job.operation && "extraction", job.azureScan && "scan"].filter(Boolean) as string[];
}
export function documentDeletionSummary(value: string, status: string) {
  const job = envelope(value).deletion;
  return {
    deletionPending: status === "deletion_pending",
    deletionRetryRequired: status === "deletion_pending" && job?.retryRequired === true,
    deletionMessage: status === "deletion_pending"
      ? "Deletion is not complete. The file is unavailable while remaining copies are removed. Retry deletion to check cleanup."
      : null,
  };
}

/** Keep a quarantined tombstone until each immutable copy has been removed. */
export async function deleteDocument(input: {
  database: D1Database; bucket: R2Bucket; env: VanteloqRuntimeEnv;
  organizationId: string; documentId: string; actorUserId: string; transport?: typeof fetch; backgroundRetryLease?: string;
}) {
  const { database, bucket, env, organizationId, documentId } = input;
  const find = () => database.prepare("SELECT id, object_key, extracted_json, status FROM workspace_documents WHERE organization_id=? AND id=?")
    .bind(organizationId, documentId).first<Row>();
  let row = await find();
  // An authorized retry is idempotent and reveals nothing about another tenant.
  if (!row) return { deleted: true, status: "deleted" as const, pendingSteps: [] as string[] };
  if (input.backgroundRetryLease) {
    const existing = envelope(row.extracted_json).deletion;
    if (row.status !== "deletion_pending" || !existing || !matchesCleanupRetryLease(existing.cleanupRetry, input.backgroundRetryLease)
      || !Number.isSafeInteger(existing.requestedAt) || existing.requestedAt <= 0 || !existing.requestedBy) {
      throw new ApiError(409, "DOCUMENT_CLEANUP_STATE_CHANGED", "The saved deletion request changed. No new deletion was started.");
    }
  }
  if (row.status !== "deletion_pending") {
    if (row.status === "approved") throw new ApiError(409, "RECORD_PROTECTED", "Approved accounting documents cannot be deleted from Files. Review the linked record and retention requirements first.");
    const linked = await database.prepare(`SELECT 1 linked WHERE
      EXISTS(SELECT 1 FROM invoice_matches WHERE document_id=?) OR
      EXISTS(SELECT 1 FROM customer_invoices WHERE document_id=?) OR
      EXISTS(SELECT 1 FROM bank_statement_imports WHERE document_id=?) OR
      EXISTS(SELECT 1 FROM bookloq_transaction_matches WHERE document_id=? AND status='confirmed')`)
      .bind(documentId, documentId, documentId, documentId).first();
    if (linked) throw new ApiError(409, "DOCUMENT_LINKED", "This document supports an accounting record. Review or remove the linked record before deleting its supporting file.");
    const current = envelope(row.extracted_json);
    // Even an expired processing claim is not proof that its request has stopped.
    // A normal resume resolves that claim before deletion is allowed to proceed.
    if (current.processing?.lock) throw new ApiError(409, "DOCUMENT_PROCESSING_ACTIVE", "Processing has not released this file. Refresh Documents and resume the unfinished step, then retry deletion.");
    const deletion: Deletion = {
      version: 1, requestedAt: Date.now(), requestedBy: input.actorUserId, originalRemoved: false,
      ...(current.processing?.operation ? { operation: current.processing.operation } : {}),
      ...(current.processing?.azureScan ? { azureScan: current.processing.azureScan } : {}),
    };
    // Drop extracted personal/financial text immediately; retain only cleanup references.
    let changed: D1Result;
    try {
      changed = await database.prepare(`UPDATE workspace_documents SET status='deletion_pending', security_state='quarantined',
        extracted_json=?, updated_at=? WHERE organization_id=? AND id=? AND status<>'approved'
        AND status<>'deletion_pending' AND extracted_json=? AND json_extract(extracted_json,'$.processing.lock') IS NULL`)
        .bind(JSON.stringify({ deletion }), Math.floor(Date.now() / 1000), organizationId, documentId, row.extracted_json).run();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("DOCUMENT_LINKED")) throw new ApiError(409, "DOCUMENT_LINKED", "The document was linked to an accounting record. Refresh before making any retention change.");
      if (message.includes("DOCUMENT_PROCESSING_ACTIVE")) throw new ApiError(409, "DOCUMENT_PROCESSING_ACTIVE", "Processing still holds this file. Refresh Documents and resume it before deletion.");
      if (message.includes("RECORD_PROTECTED")) throw new ApiError(409, "RECORD_PROTECTED", "The document became protected. Refresh before making any retention change.");
      throw error;
    }
    if (changed.meta.changes !== 1) throw new ApiError(409, "DOCUMENT_CHANGED", "The document changed while deletion was requested. Refresh Documents and review its current state.");
    row = await find();
    if (!row) return { deleted: true, status: "deleted" as const, pendingSteps: [] as string[] };
  }
  let job = envelope(row.extracted_json).deletion;
  if (!job || job.version !== 1 || typeof job.originalRemoved !== "boolean") {
    throw new ApiError(503, "DOCUMENT_CLEANUP_REVIEW_REQUIRED", "The saved deletion state needs support review. Deletion has not been confirmed.");
  }
  const pending = () => ({ deleted: false, status: "deletion_pending" as const, pendingSteps: pendingSteps(job!) });
  if (job.leaseUntil && job.leaseUntil > Date.now()) return pending();
  const lock = crypto.randomUUID();
  job = { ...job, lock, leaseUntil: Date.now() + 120_000, retryRequired: false };
  const claim = await database.prepare(`UPDATE workspace_documents SET extracted_json=?, updated_at=?
    WHERE organization_id=? AND id=? AND status='deletion_pending' AND extracted_json=?`)
    .bind(JSON.stringify({ deletion: job }), Math.floor(Date.now() / 1000), organizationId, documentId, row.extracted_json).run();
  if (claim.meta.changes !== 1) return pending();
  const save = async () => {
    job = { ...job!, leaseUntil: Date.now() + 120_000 };
    const saved = await database.prepare(`UPDATE workspace_documents SET extracted_json=?, updated_at=?
      WHERE organization_id=? AND id=? AND status='deletion_pending' AND json_extract(extracted_json,'$.deletion.lock')=?`)
      .bind(JSON.stringify({ deletion: job }), Math.floor(Date.now() / 1000), organizationId, documentId, lock).run();
    return saved.meta.changes === 1;
  };
  try {
    if (!job.originalRemoved) {
      try { await bucket.delete(row.object_key); job.originalRemoved = true; }
      catch { job.retryRequired = true; }
      if (!await save()) return pending();
    }
    if (job.operation) {
      try { await deleteExtractionResult(env, job.operation, input.transport); delete job.operation; }
      catch { job.retryRequired = true; }
      if (!await save()) return pending();
    }
    if (job.azureScan) {
      try { await deleteAzureScan(env, job.azureScan, input.transport); delete job.azureScan; }
      catch { job.retryRequired = true; }
      if (!await save()) return pending();
    }
    if (pendingSteps(job).length) return pending();
    const removed = await database.prepare(`DELETE FROM workspace_documents WHERE organization_id=? AND id=?
      AND status='deletion_pending' AND json_extract(extracted_json,'$.deletion.lock')=?`)
      .bind(organizationId, documentId, lock).run();
    return removed.meta.changes === 1
      ? { deleted: true, status: "deleted" as const, pendingSteps: [] as string[] }
      : pending();
  } finally {
    // A delayed request must never release a newer request's lease.
    await database.prepare(`UPDATE workspace_documents SET extracted_json=json_remove(extracted_json,'$.deletion.lock','$.deletion.leaseUntil')
      WHERE organization_id=? AND id=? AND status='deletion_pending' AND json_extract(extracted_json,'$.deletion.lock')=?`)
      .bind(organizationId, documentId, lock).run();
  }
}
