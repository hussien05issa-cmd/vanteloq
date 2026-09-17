import type { VanteloqRuntimeEnv } from "../db/index.ts";
import { ApiError } from "./api.ts";
import { DOCUMENT_PROCESSING_NOTICE_VERSION, type DocumentExtraction } from "../shared/document-processing.ts";
import { deleteExtractionResult, documentProviderConfiguration, DocumentProviderError, pollExtraction, startExtraction, validateDocumentForProcessing } from "./document-providers.ts";
import { beginAzureScan, deleteAzureScan, pollAzureScan, type AzureScanOperation } from "./azure-document-scanner.ts";

import { matchesCleanupRetryLease, type DocumentCleanupRetry } from "./document-cleanup-state.ts";

type Processing = {
  version: 1; noticeVersion: string; authorizedBy: string; authorizedAt: number;
  stage: "queued" | "scanning" | "scan_waiting" | "scanned" | "starting" | "reading" | "complete" | "failed" | "blocked";
  lock?: string; leaseUntil?: number; operation?: string; expectedPages?: number; errorCode?: string; cleanupPending?: boolean;
  azureScan?: AzureScanOperation; cleanupRetry?: DocumentCleanupRetry;
};
export type ProcessingEnvelope = { processing?: Processing; extraction?: DocumentExtraction };
type DocumentRow = { id: string; object_key: string; content_type: string; document_type: string; sha256_hex: string; security_state: string; scan_status: string; extraction_status: string; extracted_json: string; status: string };
const errorMessages: Record<string, string> = {
  PROVIDER_NOT_CONFIGURED: "Document processing is waiting for service setup.",
  PROVIDER_ACCESS_DENIED: "The document service needs its credentials or subscription checked.",
  PROVIDER_UNAVAILABLE: "The document service could not be reached. Your original is preserved. Try again shortly.",
  PROVIDER_RATE_LIMIT: "The document service is busy. Try again shortly.",
  PROVIDER_FILE_LIMIT: "This file exceeds the document service's current limit.",
  EXTRACTION_FORMAT_UNSUPPORTED: "Security scanning supports WEBP. To read its text, upload a PDF, JPEG or PNG.",
  DOCUMENT_CHANGED: "The stored file did not match its upload fingerprint. It remains quarantined.",
  PROCESSING_INTERRUPTED: "Processing was interrupted. Retry to resume. A new extraction may use another provider request.",
  SCAN_RESULT_UNKNOWN: "The scanner did not return a verified result. The file remains quarantined.",
  SCAN_TIMED_OUT: "Microsoft has not confirmed a scan within 10 minutes. Your file remains quarantined. Check scanning status and retry.",
  SCAN_NOT_COMPLETED: "Microsoft could not finish scanning this file. It remains quarantined. Check the format and scanning service before retrying.",
  SCAN_REFERENCE_INVALID: "The scan reference could not be verified. Your file remains quarantined.",
  DOCUMENT_ACTIVE_CONTENT: "This PDF contains scripts, embedded files or active actions. Export a plain PDF before uploading it again.",
  EXTRACTION_TOO_LARGE: "The document is too large for a complete extraction preview. Split it into smaller files.",
  EXTRACTION_PAGE_LIMIT: "Document extraction supports up to 50 pages per file. Split this PDF into smaller files to read every page.",
  EXTRACTION_INCOMPLETE: "The service did not return every page. Check the Azure plan and file before starting a new extraction.",
};
export function readProcessing(value: string): ProcessingEnvelope {
  try { const result = JSON.parse(value); return result && typeof result === "object" && !Array.isArray(result) ? result : {}; } catch { return {}; }
}
export function processingSummary(value: string) {
  const { processing, extraction } = readProcessing(value);
  return {
    processingStage: processing && ["scanning", "starting"].includes(processing.stage) && (processing.leaseUntil ?? 0) < Date.now() ? "failed" : processing?.stage ?? null,
    processingError: processing?.errorCode ? errorMessages[processing.errorCode] ?? "Document processing could not finish. Your original file is preserved. Try again." : null,
    extractionReady: Boolean(extraction),
    cleanupPending: processing?.stage === "complete" && processing.cleanupPending === true,
    cleanupMessage: processing?.stage === "complete" && processing.cleanupPending === true ? "Temporary processing-copy cleanup is pending. Your original and reviewed figures are preserved." : null,
    processingAuthorized: processing?.noticeVersion === DOCUMENT_PROCESSING_NOTICE_VERSION,
  };
}

/** Deletes existing provider copies only. It never reads, uploads or re-extracts the original. */
export async function cleanupCompletedDocument(input: {
  database: D1Database; env: VanteloqRuntimeEnv; organizationId: string; documentId: string;
  transport?: typeof fetch; backgroundRetryLease?: string;
}) {
  const { database: db, env, organizationId, documentId } = input;
  const row = await db.prepare("SELECT extracted_json, extraction_status, status FROM workspace_documents WHERE id=? AND organization_id=?")
    .bind(documentId, organizationId).first<{ extracted_json: string; extraction_status: string; status: string }>();
  if (!row) throw new ApiError(404, "NOT_FOUND", "Document not found.");
  if (row.status === "deletion_pending") throw new ApiError(409, "DOCUMENT_DELETION_PENDING", "Use Retry Deletion to finish removing this document and its processing copies.");
  const envelope = readProcessing(row.extracted_json);
  let job = envelope.processing;
  if (!job || job.stage !== "complete" || row.extraction_status !== "complete" || !envelope.extraction
    || job.version !== 1 || !job.authorizedBy || !job.noticeVersion || !(job.authorizedAt > 0)) {
    throw new ApiError(409, "DOCUMENT_CLEANUP_NOT_READY", "Cleanup is available only for an already authorized, completed extraction. No new processing was started.");
  }
  if (input.backgroundRetryLease && (!matchesCleanupRetryLease(job.cleanupRetry, input.backgroundRetryLease)
    || !Number.isSafeInteger(job.authorizedAt))) {
    throw new ApiError(409, "DOCUMENT_CLEANUP_STATE_CHANGED", "The saved processing cleanup changed. No new processing was started.");
  }
  if (!job.cleanupPending && !job.operation && !job.azureScan) return { state: "complete" as const, cleanupPending: false };
  if (!job.operation && !job.azureScan) throw new ApiError(409, "DOCUMENT_CLEANUP_REFERENCE_MISSING", "The saved cleanup reference needs review. Cleanup has not been confirmed.");
  if (job.leaseUntil && job.leaseUntil > Date.now()) return { state: "busy" as const, cleanupPending: true };
  const lock = crypto.randomUUID();
  job = { ...job, lock, leaseUntil: Date.now() + 90_000 };
  envelope.processing = job;
  const claimed = await db.prepare(`UPDATE workspace_documents SET extracted_json=?,updated_at=?
    WHERE id=? AND organization_id=? AND status<>'deletion_pending' AND extraction_status='complete' AND extracted_json=?`)
    .bind(JSON.stringify(envelope), Math.floor(Date.now() / 1000), documentId, organizationId, row.extracted_json).run();
  if (claimed.meta.changes !== 1) return { state: "busy" as const, cleanupPending: true };
  try {
    // Cleanup reuses the saved consent evidence and validated provider references.
    // Failures retain each reference. No processor POST/PUT or original-file access exists here.
    if (job.operation) {
      try { await deleteExtractionResult(env, job.operation, input.transport); delete job.operation; }
      catch { /* Preserve the reference for another explicit cleanup attempt. */ }
    }
    if (job.azureScan) {
      try { await deleteAzureScan(env, job.azureScan, input.transport); delete job.azureScan; }
      catch { /* Preserve the reference for another explicit cleanup attempt. */ }
    }
    job.cleanupPending = Boolean(job.operation || job.azureScan);
    if (!job.cleanupPending) delete job.errorCode;
    delete job.lock; delete job.leaseUntil;
    envelope.processing = job;
    const saved = await db.prepare(`UPDATE workspace_documents SET extracted_json=?,updated_at=?
      WHERE id=? AND organization_id=? AND status<>'deletion_pending' AND json_extract(extracted_json,'$.processing.lock')=?`)
      .bind(JSON.stringify(envelope), Math.floor(Date.now() / 1000), documentId, organizationId, lock).run();
    if (saved.meta.changes !== 1) return { state: "busy" as const, cleanupPending: true };
    return { state: job.cleanupPending ? "cleanup_pending" as const : "complete" as const, cleanupPending: job.cleanupPending };
  } finally {
    // Only our own claim is released. Retained extraction and approval states are untouched.
    await db.prepare(`UPDATE workspace_documents SET extracted_json=json_remove(extracted_json,'$.processing.lock','$.processing.leaseUntil')
      WHERE id=? AND organization_id=? AND json_extract(extracted_json,'$.processing.lock')=?`)
      .bind(documentId, organizationId, lock).run();
  }
}


/** A bounded step with a persistent claim. Reloading resumes the stored Azure job. */
export async function processDocument(input: {
  database: D1Database; bucket: R2Bucket; env: VanteloqRuntimeEnv;
  organizationId: string; documentId: string; actorUserId: string;
  noticeVersion: unknown; retry?: boolean; transport?: typeof fetch; beforeProviderCall?: () => Promise<void>;
}) {
  const { database: db, bucket, env, organizationId, documentId } = input;
  const row = await db.prepare("SELECT id, object_key, content_type, document_type, sha256_hex, security_state, scan_status, extraction_status, extracted_json, status FROM workspace_documents WHERE id = ? AND organization_id = ?").bind(documentId, organizationId).first<DocumentRow>();
  if (!row) throw new ApiError(404, "NOT_FOUND", "Document not found.");
  if (row.status === "approved" || row.status === "deletion_pending" || row.status === "rejected" || row.security_state === "rejected") throw new ApiError(409, "DOCUMENT_NOT_PROCESSABLE", "This document is protected or rejected and cannot be reprocessed.");
  let envelope = readProcessing(row.extracted_json);
  const now = Date.now(), configuration = documentProviderConfiguration(env);
  let job = envelope.processing;
  if (job?.leaseUntil && job.leaseUntil > now) return { state: "busy", newlyAuthorized: false };
  if (!job || job.noticeVersion !== DOCUMENT_PROCESSING_NOTICE_VERSION) {
    if (input.noticeVersion !== DOCUMENT_PROCESSING_NOTICE_VERSION) throw new ApiError(409, "DOCUMENT_PROCESSING_NOTICE_REQUIRED", "Review the document processing notice before sending this file for scanning and extraction.");
    if (!configuration.scanning) throw new ApiError(503, "DOCUMENT_SCANNER_NOT_CONFIGURED", "Document scanning is waiting for service setup.");
    job = { version: 1, noticeVersion: DOCUMENT_PROCESSING_NOTICE_VERSION, authorizedBy: input.actorUserId, authorizedAt: now, stage: "queued" };
    envelope = { processing: job };
  }
  const newlyAuthorized = readProcessing(row.extracted_json).processing?.noticeVersion !== DOCUMENT_PROCESSING_NOTICE_VERSION;
  if (job.stage === "complete" && !job.cleanupPending) return { state: "complete", newlyAuthorized: false };
  if (job.stage === "blocked") return { state: "blocked", newlyAuthorized: false };
  if ((job.stage === "failed" || job.stage === "starting" || job.stage === "scanning") && !input.retry) {
    if (job.stage !== "failed") {
      job = { ...job, stage: "failed", errorCode: "PROCESSING_INTERRUPTED", lock: undefined, leaseUntil: undefined };
      await db.prepare("UPDATE workspace_documents SET extracted_json = ?, updated_at = ? WHERE id = ? AND organization_id = ? AND extracted_json = ?").bind(JSON.stringify({ ...envelope, processing: job }), Math.floor(now / 1000), documentId, organizationId, row.extracted_json).run();
    }
    return { state: "failed", newlyAuthorized: false };
  }
  const restartExtraction = input.retry && job.errorCode === "EXTRACTION_INCOMPLETE";
  if (input.retry && ["failed", "scanning", "starting"].includes(job.stage)) job = { ...job, stage: row.scan_status === "clean" && row.security_state === "clean" ? job.operation && !restartExtraction ? "reading" : "scanned" : job.azureScan && !["SCAN_TIMED_OUT", "SCAN_NOT_COMPLETED", "DOCUMENT_CHANGED"].includes(job.errorCode || "") ? "scan_waiting" : "queued", errorCode: undefined };
  const lock = crypto.randomUUID();
  job = { ...job, lock, leaseUntil: now + 90_000 };
  envelope = { ...envelope, processing: job };
  const claim = await db.prepare("UPDATE workspace_documents SET extracted_json = ?, updated_at = ? WHERE id = ? AND organization_id = ? AND extracted_json = ? AND status NOT IN ('approved', 'rejected', 'deletion_pending')").bind(JSON.stringify(envelope), Math.floor(now / 1000), documentId, organizationId, row.extracted_json).run();
  if (claim.meta.changes !== 1) return { state: "busy", newlyAuthorized: false };
  let scan = row.scan_status, security = row.security_state, extractionStatus = row.extraction_status;
  const save = async (stage: Processing["stage"], release = true) => {
    job = { ...job!, stage, lock: release ? undefined : lock, leaseUntil: release ? undefined : Date.now() + 90_000 };
    envelope.processing = job;
    const result = await db.prepare("UPDATE workspace_documents SET extracted_json = ?, scan_status = ?, security_state = ?, extraction_status = ?, scan_provider = CASE WHEN ? = 'clean' OR ? = 'blocked' THEN 'azure-defender' ELSE scan_provider END, scanned_at = CASE WHEN ? = 'clean' OR ? = 'blocked' THEN COALESCE(scanned_at, ?) ELSE scanned_at END, status = 'review_required', updated_at = ? WHERE id = ? AND organization_id = ? AND json_extract(extracted_json, '$.processing.lock') = ? AND status NOT IN ('approved', 'rejected', 'deletion_pending')").bind(JSON.stringify(envelope), scan, security, extractionStatus, scan, scan, scan, scan, Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000), documentId, organizationId, lock).run();
    return result.meta.changes === 1;
  };
  try {
    if (job.azureScan && !["scanning", "scan_waiting"].includes(job.stage)) {
      await deleteAzureScan(env, job.azureScan, input.transport);
      job = { ...job, azureScan: undefined };
    }
    if (job.stage === "complete" && job.cleanupPending && job.operation) {
      await deleteExtractionResult(env, job.operation, input.transport);
      job = { ...job, cleanupPending: false, operation: undefined };
      await save("complete");
      return { state: "complete", newlyAuthorized };
    }
    if (job.stage === "reading" && job.operation) {
      const extracted = await pollExtraction(env, job.operation, input.transport);
      if (!extracted) { await save("reading"); return { state: "reading", newlyAuthorized }; }
      if (job.expectedPages && extracted.pages !== job.expectedPages) throw new DocumentProviderError("EXTRACTION_INCOMPLETE");
      envelope.extraction = extracted;
      extractionStatus = "complete";
      job = { ...job, cleanupPending: true, errorCode: undefined };
      // Persist before asking Azure to delete its temporary copy.
      if (!await save("complete", false)) return { state: "busy", newlyAuthorized };
      try { await deleteExtractionResult(env, job.operation!, input.transport); job = { ...job, cleanupPending: false, operation: undefined }; } catch { /* Azure deletes temporary results after its retention window; preserve a retry marker. */ }
      await save("complete");
      return { state: "complete", newlyAuthorized };
    }
    if (job.stage === "scanned" && !configuration.extraction) {
      extractionStatus = "not_configured";
      await save("scanned");
      return { state: "awaiting_extraction_setup", newlyAuthorized };
    }
    const stored = await bucket.get(row.object_key);
    if (!stored || stored.customMetadata?.organizationId !== organizationId) throw new DocumentProviderError("DOCUMENT_CHANGED");
    const bytes = new Uint8Array(await new Response(stored.body).arrayBuffer());
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
    if (hash !== row.sha256_hex) { scan = "failed"; security = "quarantined"; throw new DocumentProviderError("DOCUMENT_CHANGED"); }
    if (job.stage === "queued") {
      await validateDocumentForProcessing(bytes, row.content_type);
      if (!await save("scanning", false)) return { state: "busy", newlyAuthorized };
      await input.beforeProviderCall?.();
      job = { ...job, azureScan: await beginAzureScan(env, bytes, row.content_type, hash, input.transport) };
      scan = "pending"; security = "quarantined";
      if (!await save("scan_waiting")) await deleteAzureScan(env, job.azureScan!, input.transport).catch(() => {});
      return { state: "scan_waiting", newlyAuthorized };
    }
    if (job.stage === "scan_waiting" && job.azureScan) {
      if (job.azureScan.sha256 !== hash || job.azureScan.size !== bytes.length) throw new DocumentProviderError("DOCUMENT_CHANGED");
      const verdict = await pollAzureScan(env, job.azureScan, input.transport);
      if (!verdict) { await save("scan_waiting"); return { state: "scan_waiting", newlyAuthorized }; }
      const stillExists = await db.prepare("SELECT id FROM workspace_documents WHERE id = ? AND organization_id = ? AND json_extract(extracted_json, '$.processing.lock') = ?").bind(documentId, organizationId, lock).first();
      if (!stillExists) return { state: "busy", newlyAuthorized };
      // Remove the temporary scan copy before releasing the original from quarantine.
      await deleteAzureScan(env, job.azureScan, input.transport);
      job = { ...job, azureScan: undefined, errorCode: undefined };
      // Revalidate and renew ownership after the slow provider operations.
      // Never let a stale request mutate an original held by another attempt.
      const renewedAt = Date.now();
      const renewed = await db.prepare("UPDATE workspace_documents SET extracted_json=json_set(extracted_json,'$.processing.leaseUntil',?),updated_at=? WHERE id=? AND organization_id=? AND json_extract(extracted_json,'$.processing.lock')=? AND status NOT IN ('approved','rejected','deletion_pending')")
        .bind(renewedAt + 90_000, Math.floor(renewedAt / 1000), documentId, organizationId, lock).run();
      if (renewed.meta.changes !== 1) return { state: "busy", newlyAuthorized };
      scan = verdict;
      security = scan === "clean" ? "clean" : "rejected";
      if (!stored.etag) throw new DocumentProviderError("DOCUMENT_CHANGED");
      const promoted = await bucket.put(row.object_key, bytes.buffer, { onlyIf: { etagMatches: stored.etag }, httpMetadata: stored.httpMetadata, customMetadata: { ...stored.customMetadata, securityState: security, scanProvider: "azure-defender", sha256: hash } });
      if (!promoted) return { state: "busy", newlyAuthorized };
      extractionStatus = configuration.extraction && scan === "clean" ? "pending" : "not_configured";
      if (!await save(scan === "clean" ? "scanned" : "blocked")) return { state: "busy", newlyAuthorized };
      return { state: scan === "clean" ? "scanned" : "blocked", newlyAuthorized };
    }
    if (scan !== "clean" || security !== "clean" || stored.customMetadata?.securityState !== "clean") throw new DocumentProviderError("SCAN_RESULT_UNKNOWN");
    if (!await save("starting", false)) return { state: "busy", newlyAuthorized };
    await input.beforeProviderCall?.();
    const started = await startExtraction(env, bytes, row.content_type, row.document_type, input.transport);
    job = { ...job, ...started, errorCode: undefined };
    extractionStatus = "pending";
    if (!await save("reading")) await deleteExtractionResult(env, job.operation!, input.transport).catch(() => {});
    return { state: "reading", newlyAuthorized };
  } catch (error) {
    // Only stable error codes cross the API or enter logs. Provider response text is private.
    job = { ...job, errorCode: error instanceof DocumentProviderError ? error.code : "PROCESSING_INTERRUPTED" };
    if (scan !== "clean" && scan !== "blocked") { scan = "failed"; security = "quarantined"; }
    if (job.stage === "complete" && envelope.extraction) await save("complete");
    else { extractionStatus = scan === "clean" ? "failed" : "not_configured"; await save("failed"); }
    return { state: job.stage, newlyAuthorized };
  }
}
