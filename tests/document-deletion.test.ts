import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Miniflare } from "miniflare";
import { unstable_splitSqlQuery } from "wrangler";
import { deleteDocument, documentDeletionSummary } from "../server/document-deletion.ts";
import { beginAzureScan } from "../server/azure-document-scanner.ts";
import { scannerEnv, scannerFixture } from "./azure-scanner-fixture.ts";

const env = { ...scannerEnv, AZURE_DOCUMENT_INTELLIGENCE_KEY: "fictional-read-key", AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT: "https://qa.cognitiveservices.azure.com" };
const operation = `${env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT}/documentintelligence/documentModels/prebuilt-layout/analyzeResults/00000000-0000-0000-0000-000000000001?api-version=2024-11-30`;
async function setup(t: { after(callback: () => Promise<void>): void }) {
  const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok'); } }", d1Databases: ["DB"], r2Buckets: ["BUCKET"] });
  t.after(() => mf.dispose());
  const database = await mf.getD1Database("DB") as unknown as D1Database;
  const bucket = await mf.getR2Bucket("BUCKET") as unknown as R2Bucket;
  for (const sql of [
    "CREATE TABLE workspaces(id TEXT PRIMARY KEY)",
    "CREATE TABLE workspace_documents(id TEXT PRIMARY KEY,organization_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,object_key TEXT,extracted_json TEXT DEFAULT '{}',status TEXT DEFAULT 'review_required',security_state TEXT DEFAULT 'clean',updated_at INTEGER)",
    ...["invoice_matches", "customer_invoices", "bank_statement_imports", "bookloq_transaction_matches"].map(table => `CREATE TABLE ${table}(id TEXT PRIMARY KEY,organization_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,document_id TEXT REFERENCES workspace_documents(id) ON DELETE CASCADE,status TEXT)`),
    "INSERT INTO workspaces(id) VALUES ('tenant-a'),('tenant-b')",
    "INSERT INTO workspace_documents(id,organization_id,object_key,extracted_json) VALUES ('doc-a','tenant-a','tenant-a/private.pdf','{\"extraction\":{\"text\":\"PRIVATE SYNTHETIC STATEMENT\"}}')",
  ]) await database.prepare(sql).run();
  const guards = await readFile(new URL("../drizzle/0052_document_deletion_guards.sql", import.meta.url), "utf8");
  assert.doesNotMatch(guards, /\r/, "trigger migrations use consistent LF line endings for hosted parsing");
  const statements = unstable_splitSqlQuery(guards);
  assert.equal(statements.length, 9, "the deployment splitter must retain every complete trigger");
  for (const sql of statements) await database.prepare(sql).run();
  // Deployment retries may encounter guards already created by an earlier attempt.
  for (const sql of statements) await database.prepare(sql).run();
  await bucket.put("tenant-a/private.pdf", new Uint8Array([1,2,3]).buffer, { customMetadata: { organizationId: "tenant-a", securityState: "clean" } });
  const row = () => database.prepare("SELECT * FROM workspace_documents WHERE id='doc-a'").first<{ status: string; security_state: string; extracted_json: string }>();
  const base = { database, bucket, env, organizationId: "tenant-a", documentId: "doc-a", actorUserId: "owner-a" };
  return { database, bucket, row, base };
}

test("original-delete failure preserves a private tombstone and retry removes the final record", async t => {
  const { base, bucket, row } = await setup(t);
  let fail = true, calls = 0;
  const deletionBucket = { delete: async (key: string) => { calls++; if (fail) throw new Error("private backend error must not be exposed"); await bucket.delete(key); } } as R2Bucket;
  const first = await deleteDocument({ ...base, bucket: deletionBucket });
  assert.equal(first.deleted, false); assert.deepEqual(first.pendingSteps, ["original"]);
  const pending = (await row())!;
  assert.equal(pending.status, "deletion_pending"); assert.equal(pending.security_state, "quarantined");
  assert.doesNotMatch(pending.extracted_json, /PRIVATE SYNTHETIC STATEMENT|private backend error/);
  assert.equal(documentDeletionSummary(pending.extracted_json, pending.status).deletionRetryRequired, true);
  assert.ok(await bucket.get("tenant-a/private.pdf"));
  fail = false;
  assert.equal((await deleteDocument({ ...base, bucket: deletionBucket })).deleted, true);
  assert.equal(await row(), null); assert.equal(await bucket.get("tenant-a/private.pdf"), null);
  assert.equal((await deleteDocument({ ...base, bucket: deletionBucket })).deleted, true);
  assert.equal(calls, 2, "completed retry does not recreate or delete another object");
});

test("provider failures retain exact references; absent analysis results are safe idempotent deletion", async t => {
  const { base, database, bucket, row } = await setup(t);
  const scanner = scannerFixture();
  const scan = await beginAzureScan(env, new Uint8Array([1,2,3]), "application/pdf", "a".repeat(64), scanner.transport);
  await database.prepare("UPDATE workspace_documents SET extracted_json=? WHERE id='doc-a'")
    .bind(JSON.stringify({ processing: { operation, azureScan: scan }, extraction: { text: "PRIVATE OCR" } })).run();
  let failing = true, analysisDeletes = 0;
  const transport = (async (input, init) => {
    assert.equal(init?.method, "DELETE", "cleanup never starts another scan/extraction");
    assert.equal(init?.redirect, "manual");
    if (String(input).includes("blob.core.windows.net")) return failing ? new Response(null, { status: 503 }) : scanner.transport(input, init);
    analysisDeletes++;
    return new Response(null, { status: failing ? 503 : 404 });
  }) as typeof fetch;
  const first = await deleteDocument({ ...base, transport });
  assert.equal(first.deleted, false); assert.deepEqual(first.pendingSteps.sort(), ["extraction", "scan"]);
  assert.equal(await bucket.get("tenant-a/private.pdf"), null, "original is removed even when provider cleanup is pending");
  const pending = JSON.parse((await row())!.extracted_json);
  assert.equal(pending.deletion.operation, operation); assert.deepEqual(pending.deletion.azureScan, scan);
  assert.equal(pending.extraction, undefined); assert.equal(pending.processing, undefined);
  failing = false;
  assert.equal((await deleteDocument({ ...base, transport })).deleted, true);
  assert.equal(await row(), null); assert.equal(scanner.blobs.size, 0); assert.equal(analysisDeletes, 2);
});

test("tenant mismatch, approved documents and attached processing claims never delete bytes", async t => {
  const { base, database, row } = await setup(t);
  let calls = 0;
  const bucket = { delete: async () => { calls++; } } as unknown as R2Bucket;
  assert.equal((await deleteDocument({ ...base, organizationId: "tenant-b", bucket })).deleted, true);
  assert.ok(await row()); assert.equal(calls, 0);
  await database.prepare("UPDATE workspace_documents SET status='approved' WHERE id='doc-a'").run();
  await assert.rejects(deleteDocument({ ...base, bucket }), { code: "RECORD_PROTECTED" });
  await database.prepare("UPDATE workspace_documents SET status='review_required',extracted_json=? WHERE id='doc-a'")
    .bind(JSON.stringify({ processing: { lock: "unfinished-claim", leaseUntil: 1, stage: "scanning" } })).run();
  await assert.rejects(deleteDocument({ ...base, bucket }), { code: "DOCUMENT_PROCESSING_ACTIVE" });
  assert.equal(calls, 0); assert.equal((await row())!.status, "review_required");
});

test("an active cleanup lease serializes concurrent deletion attempts", async t => {
  const { base, bucket, row } = await setup(t);
  let entered!: () => void, release!: () => void, calls = 0;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const heldBucket = { delete: async (key: string) => { calls++; entered(); await gate; await bucket.delete(key); } } as R2Bucket;
  const first = deleteDocument({ ...base, bucket: heldBucket });
  await started;
  try { assert.equal((await deleteDocument({ ...base, bucket: heldBucket })).deleted, false); assert.equal(calls, 1); }
  finally { release(); }
  assert.equal((await first).deleted, true); assert.equal(await row(), null);
});

test("retention guards protect linked receipts and block late approval or new accounting links", async t => {
  const { base, database, row } = await setup(t);
  await database.prepare("INSERT INTO bookloq_transaction_matches(id,organization_id,document_id,status) VALUES ('match','tenant-a','doc-a','confirmed')").run();
  await assert.rejects(deleteDocument(base), { code: "DOCUMENT_LINKED" });
  await assert.rejects(database.prepare("DELETE FROM workspace_documents WHERE id='doc-a'").run(), /DOCUMENT_LINKED/);
  await database.prepare("DELETE FROM bookloq_transaction_matches WHERE id='match'").run();
  const failedBucket = { delete: async () => { throw new Error("retry"); } } as unknown as R2Bucket;
  assert.equal((await deleteDocument({ ...base, bucket: failedBucket })).deleted, false);
  await assert.rejects(database.prepare("UPDATE workspace_documents SET status='approved',security_state='clean' WHERE id='doc-a'").run(), /DOCUMENT_DELETION_PENDING/);
  for (const table of ["invoice_matches", "customer_invoices", "bookloq_transaction_matches"]) {
    await assert.rejects(database.prepare(`INSERT INTO ${table}(id,organization_id,document_id,status) VALUES ('late','tenant-a','doc-a','confirmed')`).run(), /DOCUMENT_DELETION_PENDING/);
  }
  assert.equal((await row())!.status, "deletion_pending");
  assert.equal((await deleteDocument(base)).deleted, true);
});

test("workspace erasure still cascades after its own retention confirmation", async t => {
  const { database, row } = await setup(t);
  await database.prepare("UPDATE workspace_documents SET status='approved' WHERE id='doc-a'").run();
  await database.prepare("INSERT INTO bookloq_transaction_matches(id,organization_id,document_id,status) VALUES ('match','tenant-a','doc-a','confirmed')").run();
  await database.prepare("DELETE FROM workspaces WHERE id='tenant-a'").run();
  assert.equal(await row(), null);
});
