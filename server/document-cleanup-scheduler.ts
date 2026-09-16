import type { VanteloqRuntimeEnv } from "../db/index.ts";
import { ApiError } from "./api.ts";
import { deleteDocument } from "./document-deletion.ts";
import { cleanupCompletedDocument } from "./document-processing.ts";
import { cleanupRetryDelay, type DocumentCleanupRetry } from "./document-cleanup-state.ts";
import { cleanupDocumentIngests } from "./document-ingest.ts";

type Kind = "deletion" | "processing";
type Candidate = { id: string; organization_id: string; status: string; extracted_json: string; kind: Kind };
export type DocumentCleanupAudit = {
  organizationId: string; documentId: string; kind: Kind;
  status: "started" | "complete" | "retrying" | "attention" | "coalesced";
  attempts: number; errorCode: string | null; nextAttemptAt: number | null;
};
type Input = {
  database: D1Database; bucket?: R2Bucket; env: VanteloqRuntimeEnv;
  audit: (event: DocumentCleanupAudit) => Promise<void>; transport?: typeof fetch;
};
const MAX_JOBS = 3;
const LEASE_MS = 180_000;

// Two indexed FIFO pools bound payload reads/ranking to 48 rows. The effective due
// time includes provider/manual and scheduler leases, so active rows cannot hide due
// work behind a fixed LIMIT. Tenant fairness applies within this bounded horizon;
// newly authorized jobs do not continually jump ahead of an older backlog.
export const DOCUMENT_CLEANUP_CANDIDATE_SQL = `WITH deletion_pool AS MATERIALIZED (
    SELECT id,organization_id,status,extracted_json,'deletion' kind,max(COALESCE(json_extract(CASE WHEN json_valid(extracted_json) THEN extracted_json ELSE '{}' END,'$.deletion.cleanupRetry.nextAttemptAt'),json_extract(CASE WHEN json_valid(extracted_json) THEN extracted_json ELSE '{}' END,'$.deletion.requestedAt')),COALESCE(json_extract(CASE WHEN json_valid(extracted_json) THEN extracted_json ELSE '{}' END,'$.deletion.cleanupRetry.leaseUntil'),0),COALESCE(json_extract(CASE WHEN json_valid(extracted_json) THEN extracted_json ELSE '{}' END,'$.deletion.leaseUntil'),0)) next_at
    FROM workspace_documents INDEXED BY workspace_documents_deletion_cleanup_due_idx
    WHERE status='deletion_pending' AND json_extract(CASE WHEN json_valid(extracted_json) THEN extracted_json ELSE '{}' END,'$.deletion.version')=1 AND json_type(CASE WHEN json_valid(extracted_json) THEN extracted_json ELSE '{}' END,'$.deletion.requestedAt')='integer' AND json_extract(CASE WHEN json_valid(extracted_json) THEN extracted_json ELSE '{}' END,'$.deletion.requestedAt')>0 AND json_type(CASE WHEN json_valid(extracted_json) THEN extracted_json ELSE '{}' END,'$.deletion.requestedBy')='text' AND length(json_extract(CASE WHEN json_valid(extracted_json) THEN extracted_json ELSE '{}' END,'$.deletion.requestedBy'))>0 AND json_type(CASE WHEN json_valid(extracted_json) THEN extracted_json ELSE '{}' END,'$.deletion.originalRemoved') IN ('true','false') AND max(COALESCE(json_extract(CASE WHEN json_valid(extracted_json) THEN extracted_json ELSE '{}' END,'$.deletion.cleanupRetry.nextAttemptAt'),json_extract(CASE WHEN json_valid(extracted_json) THEN extracted_json ELSE '{}' END,'$.deletion.requestedAt')),COALESCE(json_extract(CASE WHEN json_valid(extracted_json) THEN extracted_json ELSE '{}' END,'$.deletion.cleanupRetry.leaseUntil'),0),COALESCE(json_extract(CASE WHEN json_valid(extracted_json) THEN extracted_json ELSE '{}' END,'$.deletion.leaseUntil'),0))<=?
    ORDER BY max(COALESCE(json_extract(CASE WHEN json_valid(extracted_json) THEN extracted_json ELSE '{}' END,'$.deletion.cleanupRetry.nextAttemptAt'),json_extract(CASE WHEN json_valid(extracted_json) THEN extracted_json ELSE '{}' END,'$.deletion.requestedAt')),COALESCE(json_extract(CASE WHEN json_valid(extracted_json) THEN extracted_json ELSE '{}' END,'$.deletion.cleanupRetry.leaseUntil'),0),COALESCE(json_extract(CASE WHEN json_valid(extracted_json) THEN extracted_json ELSE '{}' END,'$.deletion.leaseUntil'),0)),id LIMIT 24
  ),
  processing_pool AS MATERIALIZED (
    SELECT id,organization_id,status,extracted_json,'processing' kind,max(COALESCE(json_extract(CASE WHEN json_valid(extracted_json) THEN extracted_json ELSE '{}' END,'$.processing.cleanupRetry.nextAttemptAt'),json_extract(CASE WHEN json_valid(extracted_json) THEN extracted_json ELSE '{}' END,'$.processing.authorizedAt')),COALESCE(json_extract(CASE WHEN json_valid(extracted_json) THEN extracted_json ELSE '{}' END,'$.processing.cleanupRetry.leaseUntil'),0),COALESCE(json_extract(CASE WHEN json_valid(extracted_json) THEN extracted_json ELSE '{}' END,'$.processing.leaseUntil'),0)) next_at
    FROM workspace_documents INDEXED BY workspace_documents_processing_cleanup_due_idx
    WHERE status<>'deletion_pending' AND extraction_status='complete' AND json_extract(CASE WHEN json_valid(extracted_json) THEN extracted_json ELSE '{}' END,'$.processing.version')=1 AND json_extract(CASE WHEN json_valid(extracted_json) THEN extracted_json ELSE '{}' END,'$.processing.stage')='complete' AND json_type(CASE WHEN json_valid(extracted_json) THEN extracted_json ELSE '{}' END,'$.extraction')='object' AND json_type(CASE WHEN json_valid(extracted_json) THEN extracted_json ELSE '{}' END,'$.processing.authorizedAt')='integer' AND json_extract(CASE WHEN json_valid(extracted_json) THEN extracted_json ELSE '{}' END,'$.processing.authorizedAt')>0 AND json_type(CASE WHEN json_valid(extracted_json) THEN extracted_json ELSE '{}' END,'$.processing.authorizedBy')='text' AND length(json_extract(CASE WHEN json_valid(extracted_json) THEN extracted_json ELSE '{}' END,'$.processing.authorizedBy'))>0 AND json_type(CASE WHEN json_valid(extracted_json) THEN extracted_json ELSE '{}' END,'$.processing.noticeVersion')='text' AND length(json_extract(CASE WHEN json_valid(extracted_json) THEN extracted_json ELSE '{}' END,'$.processing.noticeVersion'))>0 AND (json_type(CASE WHEN json_valid(extracted_json) THEN extracted_json ELSE '{}' END,'$.processing.operation')='text' OR json_type(CASE WHEN json_valid(extracted_json) THEN extracted_json ELSE '{}' END,'$.processing.azureScan')='object') AND max(COALESCE(json_extract(CASE WHEN json_valid(extracted_json) THEN extracted_json ELSE '{}' END,'$.processing.cleanupRetry.nextAttemptAt'),json_extract(CASE WHEN json_valid(extracted_json) THEN extracted_json ELSE '{}' END,'$.processing.authorizedAt')),COALESCE(json_extract(CASE WHEN json_valid(extracted_json) THEN extracted_json ELSE '{}' END,'$.processing.cleanupRetry.leaseUntil'),0),COALESCE(json_extract(CASE WHEN json_valid(extracted_json) THEN extracted_json ELSE '{}' END,'$.processing.leaseUntil'),0))<=?
    ORDER BY max(COALESCE(json_extract(CASE WHEN json_valid(extracted_json) THEN extracted_json ELSE '{}' END,'$.processing.cleanupRetry.nextAttemptAt'),json_extract(CASE WHEN json_valid(extracted_json) THEN extracted_json ELSE '{}' END,'$.processing.authorizedAt')),COALESCE(json_extract(CASE WHEN json_valid(extracted_json) THEN extracted_json ELSE '{}' END,'$.processing.cleanupRetry.leaseUntil'),0),COALESCE(json_extract(CASE WHEN json_valid(extracted_json) THEN extracted_json ELSE '{}' END,'$.processing.leaseUntil'),0)),id LIMIT 24
  ), pool AS MATERIALIZED (
    SELECT * FROM deletion_pool UNION ALL SELECT * FROM processing_pool
  ), tenants AS MATERIALIZED (
    SELECT organization_id,COALESCE((SELECT created_at FROM audit_events INDEXED BY audit_events_document_cleanup_started_idx
      WHERE organization_id=members.organization_id AND action='document.cleanup_retry.started'
      ORDER BY created_at DESC LIMIT 1),0) tenant_last_attempt
    FROM (SELECT DISTINCT organization_id FROM pool) members
  ), ranked AS (
    SELECT pool.*,tenants.tenant_last_attempt,
      ROW_NUMBER() OVER(PARTITION BY pool.organization_id ORDER BY next_at,id) tenant_rank
    FROM pool JOIN tenants USING(organization_id)
  ) SELECT id,organization_id,status,extracted_json,kind FROM ranked
    ORDER BY tenant_rank,tenant_last_attempt,next_at,id LIMIT ?`;

/** Only resumes existing disposal authority. It never classifies or purges old uploads. */
export async function runDocumentCleanupTick(input: Input) {
  const now = Date.now();
  const selected = await input.database.prepare(DOCUMENT_CLEANUP_CANDIDATE_SQL)
    .bind(now, now, MAX_JOBS).all<Candidate>();
  const jobs = selected.results ?? [];
  const results = await Promise.allSettled(jobs.map(candidate => runOne(input, candidate)));
  const counts: Record<string, number> = {};
  for (const result of results) {
    const status = result.status === "fulfilled" ? result.value : "retrying";
    counts[status] = (counts[status] ?? 0) + 1;
  }
  // Share the same 3-job ceiling. Only known completed failed writes are disposable.
  const ingests=input.bucket&&jobs.length<MAX_JOBS?await cleanupDocumentIngests(input.database,input.bucket,undefined,MAX_JOBS-jobs.length):null;
  if(ingests)for(const [status,count] of Object.entries(ingests.counts))if(count)counts[`ingest_${status}`]=count;
  return { processed: jobs.length+(ingests?.processed??0), counts };
}

async function runOne(input: Input, candidate: Candidate) {
  const envelope = JSON.parse(candidate.extracted_json);
  const job = envelope[candidate.kind];
  const previous = job.cleanupRetry as DocumentCleanupRetry | undefined;
  const now = Date.now(), lease = crypto.randomUUID();
  const attempts = Math.min(1_000_000, (Number.isSafeInteger(previous?.attempts) && previous!.attempts >= 0 ? previous!.attempts : 0) + 1);
  const retry: DocumentCleanupRetry = {
    version: 1, attempts, lastAttemptAt: now, nextAttemptAt: now + LEASE_MS,
    lastStatus: "running", leaseOwner: lease, leaseUntil: now + LEASE_MS,
  };
  // kind is selected from the fixed CASE expression above, never from request input.
  const path = `$.${candidate.kind}.cleanupRetry`;
  const claimed = await input.database.prepare(`UPDATE workspace_documents SET extracted_json=json_set(extracted_json,?,json(?)),updated_at=?
    WHERE id=? AND organization_id=? AND status=? AND extracted_json=?`)
    .bind(path, JSON.stringify(retry), Math.floor(now / 1000), candidate.id, candidate.organization_id, candidate.status, candidate.extracted_json).run();
  if (claimed.meta.changes !== 1) return "coalesced";
  const audit = (status: DocumentCleanupAudit["status"], errorCode: string | null, nextAttemptAt: number | null) => input.audit({
    organizationId: candidate.organization_id, documentId: candidate.id, kind: candidate.kind,
    status, attempts, errorCode, nextAttemptAt,
  });
  let state: DocumentCleanupAudit["status"] = "retrying";
  let errorCode: string | null = null;
  let nextAttemptAt: number | null = now + cleanupRetryDelay(attempts);
  try {
    // If audit storage is unavailable, do not initiate a background provider action.
    try { await audit("started", null, nextAttemptAt); }
    catch { throw new ApiError(503, "CLEANUP_AUDIT_UNAVAILABLE", "Cleanup audit storage is unavailable."); }
    if (candidate.kind === "deletion") {
      if (!input.bucket) throw new ApiError(503, "CLEANUP_STORAGE_UNAVAILABLE", "Document storage is unavailable.");
      const result = await deleteDocument({ database: input.database, bucket: input.bucket, env: input.env,
        organizationId: candidate.organization_id, documentId: candidate.id, actorUserId: job.requestedBy,
        backgroundRetryLease: lease, transport: input.transport });
      state = result.deleted ? "complete" : "retrying";
    } else {
      const result = await cleanupCompletedDocument({ database: input.database, env: input.env,
        organizationId: candidate.organization_id, documentId: candidate.id,
        backgroundRetryLease: lease, transport: input.transport });
      state = result.cleanupPending ? "retrying" : "complete";
      if (result.state === "busy") { errorCode = "CLEANUP_BUSY"; nextAttemptAt = now + 60_000; }
    }
    if (state === "retrying" && !errorCode) errorCode = "CLEANUP_COPIES_PENDING";
  } catch (error) {
    const code = error instanceof ApiError ? error.code : "CLEANUP_RETRY_REQUIRED";
    if (["NOT_FOUND", "DOCUMENT_CLEANUP_STATE_CHANGED", "DOCUMENT_DELETION_PENDING", "DOCUMENT_CHANGED"].includes(code)) {
      state = "coalesced"; errorCode = "CLEANUP_STATE_CHANGED"; nextAttemptAt = now + 60_000;
    } else if (["DOCUMENT_CLEANUP_NOT_READY", "DOCUMENT_CLEANUP_REFERENCE_MISSING", "DOCUMENT_CLEANUP_REVIEW_REQUIRED", "DOCUMENT_LINKED", "RECORD_PROTECTED"].includes(code)) {
      state = "attention"; errorCode = "CLEANUP_REVIEW_REQUIRED"; nextAttemptAt = now + 24 * 60 * 60_000;
    } else {
      state = "retrying"; errorCode = ["CLEANUP_AUDIT_UNAVAILABLE", "CLEANUP_STORAGE_UNAVAILABLE"].includes(code) ? code : "CLEANUP_RETRY_REQUIRED";
    }
  }
  if (state === "complete") nextAttemptAt = null;
  const finished: DocumentCleanupRetry = {
    version: 1, attempts, lastAttemptAt: now,
    lastStatus: state === "coalesced" ? "retrying" : state,
    ...(nextAttemptAt === null ? {} : { nextAttemptAt }), ...(errorCode ? { errorCode } : {}),
  };
  // Update only our metadata. Manual cleanup may have changed references or removed the row.
  // A new deletion/processing job without our token cannot inherit this attempt's result.
  await input.database.prepare(`UPDATE workspace_documents SET extracted_json=json_set(extracted_json,?,json(?)),updated_at=?
    WHERE id=? AND organization_id=? AND json_extract(extracted_json,?)=?`)
    .bind(path, JSON.stringify(finished), Math.floor(Date.now() / 1000), candidate.id, candidate.organization_id, `${path}.leaseOwner`, lease).run();
  try { await audit(state, errorCode, nextAttemptAt); }
  catch { return "audit_failed"; }
  return state;
}
