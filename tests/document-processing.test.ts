import assert from "node:assert/strict";
import test from "node:test";
import { Miniflare } from "miniflare";
import { PDFDocument } from "pdf-lib";
import { cleanupCompletedDocument, processDocument, processingSummary, readProcessing } from "../server/document-processing.ts";
import { DOCUMENT_PROCESSING_NOTICE_VERSION } from "../shared/document-processing.ts";
import { scannerEnv, scannerFixture } from "./azure-scanner-fixture.ts";

const env = { ...scannerEnv, AZURE_DOCUMENT_INTELLIGENCE_KEY: "test-read-key", AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT: "https://qa.cognitiveservices.azure.com" };
const operation = `${env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT}/documentintelligence/documentModels/prebuilt-layout/analyzeResults/00000000-0000-0000-0000-000000000001?api-version=2024-11-30`;
async function setup(t: { after: (callback: () => Promise<void>) => void }) {
  const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok'); } }", d1Databases: ["DB"], r2Buckets: ["BUCKET"] });
  t.after(() => mf.dispose());
  const database = await mf.getD1Database("DB") as unknown as D1Database, bucket = await mf.getR2Bucket("BUCKET") as unknown as R2Bucket;
  await database.prepare("CREATE TABLE workspace_documents (id TEXT PRIMARY KEY, organization_id TEXT, object_key TEXT, content_type TEXT, document_type TEXT, sha256_hex TEXT, security_state TEXT DEFAULT 'quarantined', scan_status TEXT DEFAULT 'pending', extraction_status TEXT DEFAULT 'not_configured', extracted_json TEXT DEFAULT '{}', status TEXT DEFAULT 'review_required', scan_provider TEXT, scanned_at INTEGER, updated_at INTEGER)").run();
  const pdf = await PDFDocument.create(); pdf.addPage(); pdf.addPage(); pdf.addPage();
  const bytes = await pdf.save();
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))), byte => byte.toString(16).padStart(2, "0")).join("");
  await database.prepare("INSERT INTO workspace_documents (id, organization_id, object_key, content_type, document_type, sha256_hex) VALUES ('doc-a','tenant-a','tenant-a/private.pdf','application/pdf','other',?)").bind(hash).run();
  await bucket.put("tenant-a/private.pdf", bytes.buffer as ArrayBuffer, { customMetadata: { organizationId: "tenant-a", securityState: "quarantined" } });
  const row = () => database.prepare("SELECT * FROM workspace_documents WHERE id = 'doc-a'").first<Record<string, unknown>>();
  const base = { database, bucket, env, documentId: "doc-a", organizationId: "tenant-a", actorUserId: "owner-a", noticeVersion: DOCUMENT_PROCESSING_NOTICE_VERSION };
  return { database, bucket, row, base };
}
test("scan, async extraction, restart, review and provider deletion preserve the accounting boundary", async t => {
  const { base, row, bucket } = await setup(t);
  let starts = 0, polls = 0, deletes = 0;
  const scanner = scannerFixture();
  const transport = (async (url, init) => {
    if (String(url).includes("blob.core.windows.net")) return scanner.transport(url, init);
    if (init?.method === "POST") { starts++; return new Response(null, { status: 202, headers: { "operation-location": operation } }); }
    if (init?.method === "DELETE") { deletes++; return new Response(null, { status: 204 }); }
    polls++; return Response.json(polls === 1 ? { status: "running" } : { status: "succeeded", analyzeResult: { modelId: "prebuilt-layout", content: "Synthetic statement", pages: [{}, {}, {}], tables: [] } });
  }) as typeof fetch;
  assert.equal((await processDocument({ ...base, transport })).state, "scan_waiting");
  assert.equal((await bucket.get("tenant-a/private.pdf"))?.customMetadata?.securityState, "quarantined");
  assert.equal((await processDocument({ ...base, transport })).state, "scanned");
  assert.equal((await bucket.get("tenant-a/private.pdf"))?.customMetadata?.securityState, "clean");
  assert.equal((await processDocument({ ...base, transport })).state, "reading");
  assert.equal((await processDocument({ ...base, transport })).state, "reading");
  assert.equal((await processDocument({ ...base, transport })).state, "complete");
  assert.equal((await processDocument({ ...base, transport })).state, "complete");
  assert.deepEqual([scanner.calls.filter(call => call === "PUT").length, starts, polls, deletes], [1, 1, 2, 1]);
  assert.equal(scanner.blobs.size, 0);
  const saved = await row();
  assert.equal(saved?.status, "review_required");
  const envelope = readProcessing(String(saved?.extracted_json));
  assert.equal(envelope.processing?.authorizedBy, "owner-a");
  assert.equal(envelope.extraction?.pages, 3);
  assert.equal(envelope.processing?.operation, undefined);
});
test("different tenants, missing notice and modified files cannot reach the providers", async t => {
  const { base, row, bucket } = await setup(t);
  let calls = 0;
  const transport = (async () => { calls++; return Response.json({ CleanResult: true }); }) as typeof fetch;
  await assert.rejects(processDocument({ ...base, organizationId: "tenant-b", transport }), { status: 404 });
  await assert.rejects(processDocument({ ...base, noticeVersion: "stale", transport }), { status: 409 });
  await bucket.put("tenant-a/private.pdf", new Uint8Array([1,2]).buffer, { customMetadata: { organizationId: "tenant-a" } });
  await processDocument({ ...base, transport });
  assert.equal(calls, 0);
  assert.equal((await row())?.security_state, "quarantined");
});
test("rejected and unknown scans stay unavailable and never start extraction", async t => {
  const { base, row } = await setup(t);
  const scanner = scannerFixture("");
  await processDocument({ ...base, transport: scanner.transport });
  await processDocument({ ...base, transport: scanner.transport });
  assert.equal((await row())?.security_state, "quarantined");
  assert.equal((await row())?.scan_status, "pending");
  scanner.setResult("Malicious");
  await processDocument({ ...base, transport: scanner.transport });
  assert.equal((await row())?.security_state, "rejected");
  assert.equal((await row())?.scan_status, "blocked");
});
test("simultaneous requests acquire one scan claim", async t => {
  const { base } = await setup(t);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  let calls = 0;
  const scanner = scannerFixture();
  const transport = (async (url, init) => { calls++; entered(); await gate; return scanner.transport(url, init); }) as typeof fetch;
  const first = processDocument({ ...base, transport });
  await started;
  try { assert.equal((await processDocument({ ...base, transport })).state, "busy"); } finally { release(); }
  await first;
  assert.equal(calls, 1);
});

test("failed scan-copy deletion keeps the original quarantined and can resume safely", async t => {
  const { base, row, bucket } = await setup(t);
  const scanner = scannerFixture();
  let deletionFails = true;
  const transport = (async (url, init) => init?.method === "DELETE" && deletionFails
    ? new Response(null, { status: 503 }) : scanner.transport(url, init)) as typeof fetch;
  await processDocument({ ...base, transport });
  assert.equal((await processDocument({ ...base, transport })).state, "failed");
  assert.equal((await row())?.security_state, "quarantined");
  assert.equal((await bucket.get("tenant-a/private.pdf"))?.customMetadata?.securityState, "quarantined");
  assert.equal(scanner.blobs.size, 1);
  deletionFails = false;
  assert.equal((await processDocument({ ...base, transport, retry: true })).state, "scanned");
  assert.equal(scanner.blobs.size, 0);
  assert.equal((await row())?.security_state, "clean");
  assert.equal(scanner.calls.filter(call => call === "PUT").length, 1);
});
test("Azure free-tier or partial page results are not reported as complete", async t => {
  const { base, row } = await setup(t);
  const scanner = scannerFixture();
  const transport = (async (url, init) => String(url).includes("blob.core.windows.net") ? scanner.transport(url, init) : init?.method === "POST" ? new Response(null, { status: 202, headers: { "operation-location": operation } }) : Response.json({ status: "succeeded", analyzeResult: { modelId: "prebuilt-layout", pages: [{}, {}] } })) as typeof fetch;
  await processDocument({ ...base, transport }); await processDocument({ ...base, transport }); await processDocument({ ...base, transport }); await processDocument({ ...base, transport });
  const saved = await row();
  assert.equal(saved?.extraction_status, "failed");
  assert.equal(readProcessing(String(saved?.extracted_json)).processing?.errorCode, "EXTRACTION_INCOMPLETE");
});

test("explicit cleanup retry preserves approved originals, extraction and old consent without another analysis", async t => {
  const { base, row, bucket, database } = await setup(t);
  const scanner = scannerFixture();
  let analysisStarts = 0, reads = 0, deletes = 0, deletionFails = true;
  const transport = (async (url, init) => {
    if (String(url).includes("blob.core.windows.net")) return scanner.transport(url, init);
    if (init?.method === "POST") { analysisStarts++; return new Response(null, { status: 202, headers: { "operation-location": operation } }); }
    if (init?.method === "DELETE") { deletes++; return new Response(null, { status: deletionFails ? 503 : 404 }); }
    reads++; return Response.json({ status: "succeeded", analyzeResult: { modelId: "prebuilt-layout", content: "Synthetic statement", pages: [{}, {}, {}], tables: [] } });
  }) as typeof fetch;
  await processDocument({ ...base, transport }); await processDocument({ ...base, transport });
  await processDocument({ ...base, transport }); await processDocument({ ...base, transport });
  const completed = readProcessing(String((await row())?.extracted_json));
  assert.equal(completed.processing?.cleanupPending, true);
  assert.equal(processingSummary(JSON.stringify(completed)).cleanupPending, true);
  completed.processing!.noticeVersion = "previously-accepted-notice";
  await database.prepare("UPDATE workspace_documents SET status='approved',extracted_json=? WHERE id='doc-a'").bind(JSON.stringify(completed)).run();
  const original = await new Response((await bucket.get("tenant-a/private.pdf"))!.body).arrayBuffer();
  const failed = await cleanupCompletedDocument({ ...base, transport });
  assert.equal(failed.state, "cleanup_pending"); assert.equal(failed.cleanupPending, true);
  assert.equal(readProcessing(String((await row())?.extracted_json)).processing?.operation, operation);
  deletionFails = false;
  const success = await cleanupCompletedDocument({ ...base, transport });
  assert.equal(success.state, "complete"); assert.equal(success.cleanupPending, false);
  const after = (await row())!, saved = readProcessing(String(after.extracted_json));
  assert.equal(after.status, "approved"); assert.equal(after.security_state, "clean"); assert.equal(after.extraction_status, "complete");
  assert.deepEqual(saved.extraction, completed.extraction);
  assert.equal(saved.processing?.authorizedAt, completed.processing?.authorizedAt);
  assert.equal(saved.processing?.authorizedBy, completed.processing?.authorizedBy);
  assert.equal(saved.processing?.noticeVersion, "previously-accepted-notice");
  assert.equal(saved.processing?.operation, undefined); assert.equal(saved.processing?.lock, undefined);
  assert.equal(processingSummary(String(after.extracted_json)).cleanupPending, false);
  assert.deepEqual(await new Response((await bucket.get("tenant-a/private.pdf"))!.body).arrayBuffer(), original);
  assert.deepEqual([analysisStarts, reads, deletes], [1, 1, 3], "cleanup only deletes the existing analysis result");
  assert.equal((await cleanupCompletedDocument({ ...base, transport })).state, "complete");
  assert.deepEqual([analysisStarts, reads, deletes], [1, 1, 3], "completed cleanup replays without another provider request");
});

test("cleanup rejects another tenant, incomplete or unconsented extraction, and pending deletion before provider access", async t => {
  const { base, database } = await setup(t);
  let calls = 0;
  const transport = (async () => { calls++; throw new Error("No provider access expected"); }) as typeof fetch;
  await assert.rejects(cleanupCompletedDocument({ ...base, organizationId: "tenant-b", transport }), { code: "NOT_FOUND" });
  await assert.rejects(cleanupCompletedDocument({ ...base, transport }), { code: "DOCUMENT_CLEANUP_NOT_READY" });
  await database.prepare("UPDATE workspace_documents SET extraction_status='complete',extracted_json=? WHERE id='doc-a'")
    .bind(JSON.stringify({ processing: { version: 1, stage: "complete", cleanupPending: true, operation }, extraction: { text: "Synthetic" } })).run();
  await assert.rejects(cleanupCompletedDocument({ ...base, transport }), { code: "DOCUMENT_CLEANUP_NOT_READY" });
  await database.prepare("UPDATE workspace_documents SET status='deletion_pending' WHERE id='doc-a'").run();
  await assert.rejects(cleanupCompletedDocument({ ...base, transport }), { code: "DOCUMENT_DELETION_PENDING" });
  assert.equal(calls, 0);
});

test("cleanup claim serializes double clicks and cannot fall through into extraction", async t => {
  const { base, database, row } = await setup(t);
  await database.prepare("UPDATE workspace_documents SET extraction_status='complete',extracted_json=? WHERE id='doc-a'")
    .bind(JSON.stringify({ processing: { version: 1, noticeVersion: DOCUMENT_PROCESSING_NOTICE_VERSION, authorizedBy: "owner-a", authorizedAt: Date.now(), stage: "complete", cleanupPending: true, operation }, extraction: { text: "Synthetic" } })).run();
  let entered!: () => void, release!: () => void, calls = 0;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const transport = (async (url, init) => {
    calls++; assert.equal(String(url), operation); assert.equal(init?.method, "DELETE");
    entered(); await gate; return new Response(null, { status: 204 });
  }) as typeof fetch;
  const first = cleanupCompletedDocument({ ...base, transport });
  await started;
  try {
    assert.equal((await cleanupCompletedDocument({ ...base, transport })).state, "busy");
    assert.equal((await processDocument({ ...base, transport })).state, "busy");
    assert.equal(calls, 1);
  } finally { release(); }
  assert.equal((await first).cleanupPending, false);
  assert.equal(readProcessing(String((await row())?.extracted_json)).processing?.lock, undefined);
  assert.equal(calls, 1);
});
