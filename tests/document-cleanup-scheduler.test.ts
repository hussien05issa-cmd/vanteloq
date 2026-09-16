import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Miniflare } from "miniflare";
import { DOCUMENT_CLEANUP_CANDIDATE_SQL, runDocumentCleanupTick, type DocumentCleanupAudit } from "../server/document-cleanup-scheduler.ts";
import { cleanupRetryDelay, documentCleanupRetrySummary } from "../server/document-cleanup-state.ts";
import { deleteDocument } from "../server/document-deletion.ts";
import { cleanupCompletedDocument } from "../server/document-processing.ts";

const env = { AZURE_DOCUMENT_INTELLIGENCE_KEY: "fixture-only-key", AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT: "https://fixture.cognitiveservices.azure.com" };
const operation = `${env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT}/documentintelligence/documentModels/prebuilt-layout/analyzeResults/00000000-0000-0000-0000-000000000001?api-version=2024-11-30`;
const deletion = () => ({ version: 1, requestedAt: Date.now(), requestedBy: "owner", originalRemoved: false });
const processing = () => ({ version: 1, authorizedAt: Date.now(), authorizedBy: "owner", noticeVersion: "previously-accepted", stage: "complete", cleanupPending: true, operation });

async function fixture(t: { after(callback: () => Promise<void>): void }) {
  const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('ok')}}", d1Databases: ["DB"], r2Buckets: ["BUCKET"] });
  t.after(() => mf.dispose());
  const database = await mf.getD1Database("DB") as unknown as D1Database;
  const bucket = await mf.getR2Bucket("BUCKET") as unknown as R2Bucket;
  for (const sql of [
    "CREATE TABLE workspaces(id TEXT PRIMARY KEY)",
    "CREATE TABLE workspace_documents(id TEXT PRIMARY KEY,organization_id TEXT REFERENCES workspaces(id),object_key TEXT,extracted_json TEXT,status TEXT,security_state TEXT DEFAULT 'clean',extraction_status TEXT DEFAULT 'complete',updated_at INTEGER)",
    "CREATE TABLE audit_events(id TEXT PRIMARY KEY,organization_id TEXT,action TEXT,created_at INTEGER,details_json TEXT)",
    "CREATE TABLE document_ingest_intents(id TEXT PRIMARY KEY,organization_id TEXT,object_key TEXT,sha256_hex TEXT,state TEXT,created_at INTEGER,lease_token TEXT,lease_until INTEGER DEFAULT 0)",
    ...["invoice_matches", "customer_invoices", "bank_statement_imports", "bookloq_transaction_matches"].map(table => `CREATE TABLE ${table}(id TEXT,document_id TEXT,status TEXT)`),
  ]) await database.prepare(sql).run();
  const guard = await readFile(new URL("../drizzle/0052_document_deletion_guards.sql", import.meta.url), "utf8");
  for (const sql of guard.split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean)) await database.prepare(sql).run();
  const indexes = await readFile(new URL("../drizzle/0055_document_cleanup_retry_indexes.sql", import.meta.url), "utf8");
  for (const sql of indexes.split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean)) await database.prepare(sql).run();
  const events: DocumentCleanupAudit[] = [];
  const audit = async (event: DocumentCleanupAudit) => {
    events.push(event);
    await database.prepare("INSERT INTO audit_events VALUES (?,?,?,?,?)").bind(crypto.randomUUID(), event.organizationId,
      `document.cleanup_retry.${event.status === "started" ? "started" : "finished"}`, Math.floor(Date.now() / 1000), JSON.stringify(event)).run();
  };
  const add = async (id: string, organization = "a", status = "deletion_pending", payload: Record<string, unknown> = { deletion: deletion() }) => {
    await database.prepare("INSERT OR IGNORE INTO workspaces(id) VALUES (?)").bind(organization).run();
    await database.prepare("INSERT INTO workspace_documents(id,organization_id,object_key,extracted_json,status,security_state,updated_at) VALUES (?,?,?,?,?,?,?)")
      .bind(id, organization, `${organization}/${id}.pdf`, JSON.stringify(payload), status, status === "deletion_pending" ? "quarantined" : "clean", Math.floor(Date.now() / 1000)).run();
    await bucket.put(`${organization}/${id}.pdf`, new Uint8Array([1, 2, 3]).buffer);
  };
  const row = (id: string) => database.prepare("SELECT * FROM workspace_documents WHERE id=?").bind(id).first<{id: string; status: string; extracted_json: string; updated_at: number}>();
  return { database, bucket, events, audit, add, row, base: { database, bucket, env, audit } };
}

test("requested deletion retries persist exponential backoff across ticks and preserve stable evidence", async t => {
  const { base, database, add, row, events } = await fixture(t);
  await add("pending");
  let calls = 0;
  const bucket = { delete: async () => { calls++; throw new Error("PRIVATE bucket credentials must not persist"); } } as unknown as R2Bucket;
  assert.deepEqual((await runDocumentCleanupTick({ ...base, bucket })).counts, { retrying: 1 });
  let saved = (await row("pending"))!, job = JSON.parse(saved.extracted_json).deletion;
  assert.equal(job.cleanupRetry.attempts, 1);
  assert.equal(job.cleanupRetry.nextAttemptAt - job.cleanupRetry.lastAttemptAt, 300_000);
  assert.equal(job.cleanupRetry.leaseOwner, undefined); assert.equal(job.cleanupRetry.leaseUntil, undefined);
  assert.ok(Math.abs(saved.updated_at * 1000 - Date.now()) < 10_000);
  assert.equal((await runDocumentCleanupTick({ ...base, bucket })).processed, 0);
  assert.equal(calls, 1);
  await database.prepare("UPDATE workspace_documents SET extracted_json=json_set(extracted_json,'$.deletion.cleanupRetry.nextAttemptAt',0) WHERE id='pending'").run();
  assert.deepEqual((await runDocumentCleanupTick({ ...base, bucket })).counts, { retrying: 1 });
  saved = (await row("pending"))!; job = JSON.parse(saved.extracted_json).deletion;
  assert.equal(job.cleanupRetry.attempts, 2);
  assert.equal(job.cleanupRetry.nextAttemptAt - job.cleanupRetry.lastAttemptAt, 600_000);
  assert.doesNotMatch(saved.extracted_json + JSON.stringify(events), /PRIVATE|credentials|\.pdf|cognitiveservices/);
  assert.equal(documentCleanupRetrySummary(saved.extracted_json, saved.status).cleanupRetryStatus, "retrying");
  assert.equal(cleanupRetryDelay(99), 86_400_000);
});

test("successful batches are bounded and give another tenant a turn even after prior rows disappear", async t => {
  const { base, database, add, row, events } = await fixture(t);
  for (const tenant of ["a", "b", "c", "d"]) for (const suffix of ["1", "2"]) await add(`${tenant}-${suffix}`, tenant);
  const first = await runDocumentCleanupTick(base);
  assert.equal(first.processed, 3); assert.deepEqual(first.counts, { complete: 3 });
  const firstOrgs = events.filter(event => event.status === "started").map(event => event.organizationId);
  assert.equal(new Set(firstOrgs).size, 3);
  assert.equal(await row("a-1"), null);
  const selected = await database.prepare(DOCUMENT_CLEANUP_CANDIDATE_SQL).bind(Date.now(), Date.now(), 3).all<{organization_id: string}>();
  assert.equal(selected.results?.[0].organization_id, "d", "the tenant without a recent attempt is selected first");
  const next = await runDocumentCleanupTick(base);
  assert.equal(next.processed, 3);
  assert.ok(events.filter(event => event.status === "started").slice(3).some(event => event.organizationId === "d"), "concurrent jobs may reach audit storage in a different order");
});

test("approved originals and extraction evidence survive provider-only cleanup without new processing", async t => {
  const { base, add, row, bucket, events } = await fixture(t);
  const evidence = { processing: processing(), extraction: { text: "PRIVATE financial text", pages: 1 } };
  await add("approved", "a", "approved", evidence);
  let calls = 0;
  const transport = (async (url, init) => { calls++; assert.equal(String(url), operation); assert.equal(init?.method, "DELETE"); return new Response(null, { status: 204 }); }) as typeof fetch;
  const noOriginalAccess = new Proxy({}, { get() { throw new Error("Original access is forbidden in this test"); } }) as R2Bucket;
  assert.deepEqual((await runDocumentCleanupTick({ ...base, bucket: noOriginalAccess, transport })).counts, { complete: 1 });
  assert.equal(calls, 1); assert.ok(await bucket.get("a/approved.pdf"));
  const saved = (await row("approved"))!, payload = JSON.parse(saved.extracted_json);
  assert.equal(saved.status, "approved"); assert.deepEqual(payload.extraction, evidence.extraction);
  assert.equal(payload.processing.authorizedAt, evidence.processing.authorizedAt);
  assert.equal(payload.processing.noticeVersion, "previously-accepted");
  assert.equal(payload.processing.operation, undefined); assert.equal(payload.processing.cleanupRetry.lastStatus, "complete");
  assert.doesNotMatch(JSON.stringify(events), /PRIVATE|financial text|cognitiveservices/);
});

test("unrequested, incomplete, unconsented, active and not-yet-due records cannot reach storage", async t => {
  const { base, add, database } = await fixture(t);
  await add("old-original", "a", "review_required", {});
  await add("incomplete", "a", "review_required", { processing: { ...processing(), stage: "reading" }, extraction: {} });
  await add("no-consent", "a", "approved", { processing: { stage: "complete", operation }, extraction: {} });
  await add("active", "a", "deletion_pending", { deletion: { ...deletion(), lock: "active", leaseUntil: Date.now() + 60_000 } });
  await add("scheduled", "a", "deletion_pending", { deletion: { ...deletion(), cleanupRetry: { nextAttemptAt: Date.now() + 60_000 } } });
  await add("claimed", "a", "deletion_pending", { deletion: { ...deletion(), cleanupRetry: { leaseOwner: "other", leaseUntil: Date.now() + 60_000 } } });
  const bucket = { delete: async () => { throw new Error("must not execute"); } } as unknown as R2Bucket;
  assert.equal((await runDocumentCleanupTick({ ...base, bucket })).processed, 0);
  assert.equal((await database.prepare("SELECT COUNT(*) count FROM audit_events").first<{count: number}>())?.count, 0);
  await assert.rejects(deleteDocument({ ...base, bucket, organizationId: "a", documentId: "old-original", actorUserId: "service", backgroundRetryLease: "not-a-grant" }), { code: "DOCUMENT_CLEANUP_STATE_CHANGED" });
});

test("concurrent ticks coalesce and expired claims resume with the existing disposal authority", async t => {
  const { base, add, bucket, row } = await fixture(t);
  await add("expired", "a", "deletion_pending", { deletion: { ...deletion(), lock: "expired-worker", leaseUntil: 1,
    cleanupRetry: { version: 1, attempts: 2, lastStatus: "running", lastAttemptAt: 1, nextAttemptAt: 1, leaseOwner: "expired-scheduler", leaseUntil: 1 } } });
  let entered!: () => void, release!: () => void, calls = 0;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const slowBucket = { delete: async (key: string) => { calls++; entered(); await gate; await bucket.delete(key); } } as R2Bucket;
  const first = runDocumentCleanupTick({ ...base, bucket: slowBucket });
  await started;
  try { assert.equal((await runDocumentCleanupTick({ ...base, bucket: slowBucket })).processed, 0); assert.equal(calls, 1); }
  finally { release(); }
  assert.deepEqual((await first).counts, { complete: 1 }); assert.equal(await row("expired"), null);
});

test("state changes after selection cannot start stale cleanup or overwrite a new deletion request", async t => {
  const { base, add, database, row, audit } = await fixture(t);
  await add("changed", "a", "review_required", { processing: processing(), extraction: {} });
  const replacement = { deletion: deletion() };
  const changedAudit = async (event: DocumentCleanupAudit) => {
    await audit(event);
    if (event.status === "started") await database.prepare("UPDATE workspace_documents SET status='deletion_pending',extracted_json=? WHERE id='changed'").bind(JSON.stringify(replacement)).run();
  };
  let calls = 0;
  const transport = (async () => { calls++; throw new Error("no provider call permitted"); }) as typeof fetch;
  assert.deepEqual((await runDocumentCleanupTick({ ...base, audit: changedAudit, transport })).counts, { coalesced: 1 });
  assert.equal(calls, 0); assert.deepEqual(JSON.parse((await row("changed"))!.extracted_json), replacement);
  await assert.rejects(cleanupCompletedDocument({ ...base, documentId: "changed", organizationId: "a", backgroundRetryLease: "stale" }), { code: "DOCUMENT_DELETION_PENDING" });
});

test("unapproved provider destinations remain pending without leaking references or sending requests", async t => {
  const { base, add, row, events } = await fixture(t);
  await add("untrusted-reference", "a", "approved", { processing: { ...processing(), operation: "https://credential-sink.invalid/private" }, extraction: {} });
  let calls = 0;
  const transport = (async () => { calls++; throw new Error("no provider call permitted"); }) as typeof fetch;
  assert.deepEqual((await runDocumentCleanupTick({ ...base, transport })).counts, { retrying: 1 });
  assert.equal(calls, 0);
  assert.equal(JSON.parse((await row("untrusted-reference"))!.extracted_json).processing.operation, "https://credential-sink.invalid/private");
  assert.doesNotMatch(JSON.stringify(events), /credential-sink/);
});

test("indexed discovery bounds candidate payloads and audit lookups; malformed and leased rows do not starve due work", async t => {
  const { base, database, add, row } = await fixture(t);
  await add("due", "due-tenant");
  // A much larger unrelated document/audit population must not change the discovery plan.
  await database.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<2000)
    INSERT INTO workspace_documents(id,organization_id,object_key,extracted_json,status,updated_at)
    SELECT 'irrelevant-'||x,'due-tenant','irrelevant','not valid JSON','uploaded',1 FROM n`).run();
  await database.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<5000)
    INSERT INTO audit_events SELECT 'unrelated-'||x,'due-tenant','unrelated.event',x,'{}' FROM n`).run();
  await database.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<60)
    INSERT INTO workspace_documents(id,organization_id,object_key,extracted_json,status,updated_at)
    SELECT 'leased-'||x,'due-tenant','unused',?,'deletion_pending',1 FROM n`)
    .bind(JSON.stringify({ deletion: { ...deletion(), requestedAt: 1, leaseUntil: Date.now() + 60_000 } })).run();
  const plan = await database.prepare(`EXPLAIN QUERY PLAN ${DOCUMENT_CLEANUP_CANDIDATE_SQL}`).bind(Date.now(), Date.now(), 3).all<{detail: string}>();
  const detail = (plan.results ?? []).map(value => value.detail).join("\n");
  assert.match(detail, /SEARCH workspace_documents USING INDEX workspace_documents_deletion_cleanup_due_idx/);
  assert.match(detail, /SEARCH workspace_documents USING INDEX workspace_documents_processing_cleanup_due_idx/);
  assert.match(detail, /SEARCH audit_events USING COVERING INDEX audit_events_document_cleanup_started_idx/);
  assert.doesNotMatch(detail, /SCAN (workspace_documents|audit_events)/);
  assert.equal((await runDocumentCleanupTick(base)).processed, 1);
  assert.equal(await row("due"), null);
});

test("audit failure postpones cleanup durably without initiating a provider or storage action", async t => {
  const { base, add, row } = await fixture(t);
  await add("audit-down");
  let deletes = 0;
  const bucket = { delete: async () => { deletes++; } } as unknown as R2Bucket;
  assert.deepEqual((await runDocumentCleanupTick({ ...base, bucket, audit: async () => { throw new Error("offline"); } })).counts, { audit_failed: 1 });
  const saved = JSON.parse((await row("audit-down"))!.extracted_json).deletion.cleanupRetry;
  assert.equal(deletes, 0); assert.equal(saved.errorCode, "CLEANUP_AUDIT_UNAVAILABLE");
  assert.equal(saved.nextAttemptAt - saved.lastAttemptAt, 300_000);
  assert.equal((await runDocumentCleanupTick(base)).processed, 0);
});
