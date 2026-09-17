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


test("a scan claim lost during provider cleanup preserves the original and newer claim", async t => {
  const { base, database, row, bucket } = await setup(t);
  const scanner = scannerFixture();
  await processDocument({ ...base, transport: scanner.transport });
  const original = await bucket.get("tenant-a/private.pdf");
  let originalWrites = 0, originalDeletes = 0;
  const watchedBucket = {
    get: bucket.get.bind(bucket),
    put: async (...args: Parameters<R2Bucket["put"]>) => { originalWrites++; return bucket.put(...args); },
    delete: async (...args: Parameters<R2Bucket["delete"]>) => { originalDeletes++; return bucket.delete(...args); },
  } as R2Bucket;
  const transport = (async (url, init) => {
    if (init?.method === "DELETE") {
      await database.prepare("UPDATE workspace_documents SET extracted_json=json_set(extracted_json,'$.processing.lock','newer-claim','$.processing.leaseUntil',?) WHERE id='doc-a'")
        .bind(Date.now() + 90_000).run();
    }
    return scanner.transport(url, init);
  }) as typeof fetch;
  assert.equal((await processDocument({ ...base, bucket: watchedBucket, transport })).state, "busy");
  assert.equal(originalWrites, 0); assert.equal(originalDeletes, 0);
  assert.equal((await bucket.get("tenant-a/private.pdf"))?.etag, original!.etag);
  assert.equal((await bucket.get("tenant-a/private.pdf"))?.customMetadata?.securityState, "quarantined");
  assert.equal(readProcessing(String((await row())?.extracted_json)).processing?.lock, "newer-claim");
});

test("a delayed scan cannot recreate an original deleted before its conditional write", async t => {
  const { base, database, row, bucket } = await setup(t);
  const scanner = scannerFixture();
  await processDocument({ ...base, transport: scanner.transport });
  const original = await bucket.get("tenant-a/private.pdf");
  const racedBucket = {
    get: bucket.get.bind(bucket), delete: bucket.delete.bind(bucket),
    put: async (key: string, value: Parameters<R2Bucket["put"]>[1], options?: R2PutOptions) => {
      assert.deepEqual(options?.onlyIf, { etagMatches: original!.etag });
      // Models a newer request finishing and an authorized deletion completing
      // while the older conditional R2 write is delayed.
      await database.prepare("DELETE FROM workspace_documents WHERE id='doc-a'").run();
      await bucket.delete(key);
      return bucket.put(key, value, options);
    },
  } as R2Bucket;
  assert.equal((await processDocument({ ...base, bucket: racedBucket, transport: scanner.transport })).state, "busy");
  assert.equal(await bucket.get("tenant-a/private.pdf"), null);
  assert.equal(await row(), null);
});

test("a delayed scan cannot overwrite a replaced original", async t => {
  const { base, bucket } = await setup(t);
  const scanner = scannerFixture();
  await processDocument({ ...base, transport: scanner.transport });
  const original = await bucket.get("tenant-a/private.pdf"), replacement = new Uint8Array([4, 5, 6]);
  const racedBucket = {
    get: bucket.get.bind(bucket), delete: bucket.delete.bind(bucket),
    put: async (key: string, value: Parameters<R2Bucket["put"]>[1], options?: R2PutOptions) => {
      assert.deepEqual(options?.onlyIf, { etagMatches: original!.etag });
      await bucket.put(key, replacement.buffer, { customMetadata: { organizationId: "tenant-a", securityState: "quarantined" } });
      return bucket.put(key, value, options);
    },
  } as R2Bucket;
  assert.equal((await processDocument({ ...base, bucket: racedBucket, transport: scanner.transport })).state, "busy");
  const remaining = await bucket.get("tenant-a/private.pdf");
  assert.deepEqual(new Uint8Array(await new Response(remaining!.body).arrayBuffer()), replacement);
  assert.equal(remaining!.customMetadata?.securityState, "quarantined");
});

test("a claim lost after the conditional original write never deletes retained data", async t => {
  const { base, database, row, bucket } = await setup(t);
  const scanner = scannerFixture();
  await processDocument({ ...base, transport: scanner.transport });
  const original = await bucket.get("tenant-a/private.pdf");
  let deletes = 0;
  const racedBucket = {
    get: bucket.get.bind(bucket),
    delete: async (key: string | string[]) => { deletes++; return bucket.delete(key); },
    put: async (key: string, value: Parameters<R2Bucket["put"]>[1], options?: R2PutOptions) => {
      const result = await bucket.put(key, value, options);
      await database.prepare("UPDATE workspace_documents SET extracted_json=json_set(extracted_json,'$.processing.lock','newer-claim','$.processing.leaseUntil',?) WHERE id='doc-a'")
        .bind(Date.now() + 90_000).run();
      return result;
    },
  } as R2Bucket;
  assert.equal((await processDocument({ ...base, bucket: racedBucket, transport: scanner.transport })).state, "busy");
  assert.equal(deletes, 0);
  assert.equal((await bucket.get("tenant-a/private.pdf"))?.etag, original!.etag);
  const current = await row();
  assert.equal(current?.security_state, "quarantined", "DB quarantine still blocks downloads despite the stale metadata write");
  assert.equal(readProcessing(String(current?.extracted_json)).processing?.lock, "newer-claim");
});

test("scan promotion renews its claim using the time after slow provider cleanup", async t => {
  const { base, row, bucket } = await setup(t);
  const scanner = scannerFixture();
  await processDocument({ ...base, transport: scanner.transport });
  const realNow = Date.now;
  let elapsed = 0, remainingLease = 0;
  Date.now = () => realNow() + elapsed;
  const watchedBucket = {
    get: bucket.get.bind(bucket), delete: bucket.delete.bind(bucket),
    put: async (key: string, value: Parameters<R2Bucket["put"]>[1], options?: R2PutOptions) => {
      remainingLease = (readProcessing(String((await row())?.extracted_json)).processing?.leaseUntil ?? 0) - Date.now();
      return bucket.put(key, value, options);
    },
  } as R2Bucket;
  const transport = (async (url, init) => {
    if (init?.method === "DELETE") elapsed = 91_000;
    return scanner.transport(url, init);
  }) as typeof fetch;
  try {
    assert.equal((await processDocument({ ...base, bucket: watchedBucket, transport })).state, "scanned");
    assert.ok(remainingLease > 85_000, `Expected a fresh claim; only ${remainingLease} ms remained`);
  } finally { Date.now = realNow; }
});

// Append these two tests to tests/document-processing.test.ts.
// They reuse that file's setup, env, operation, scannerFixture and imports.

test("a reading claim lost before persistence keeps the shared result for its successor", async t => {
  const { base, database, row, bucket } = await setup(t);
  const scanner = scannerFixture();
  let starts = 0, deletes = 0, resultExists = true, stealOnPoll = true;
  const transport = (async (url, init) => {
    if (String(url).includes("blob.core.windows.net")) return scanner.transport(url, init);
    if (init?.method === "POST") {
      starts++;
      return new Response(null, { status: 202, headers: { "operation-location": operation } });
    }
    assert.equal(String(url), operation);
    if (init?.method === "DELETE") {
      deletes++; resultExists = false;
      return new Response(null, { status: 204 });
    }
    if (stealOnPoll) {
      stealOnPoll = false;
      await database.prepare("UPDATE workspace_documents SET extracted_json=json_set(extracted_json,'$.processing.lock','newer-reader','$.processing.leaseUntil',?) WHERE id='doc-a'")
        .bind(Date.now() + 90_000).run();
    }
    return resultExists
      ? Response.json({ status: "succeeded", analyzeResult: { modelId: "prebuilt-layout", content: "Fictional retained result", pages: [{}, {}, {}], tables: [] } })
      : new Response(null, { status: 404 });
  }) as typeof fetch;

  assert.equal((await processDocument({ ...base, transport })).state, "scan_waiting");
  assert.equal((await processDocument({ ...base, transport })).state, "scanned");
  assert.equal((await processDocument({ ...base, transport })).state, "reading");
  const original = await bucket.get("tenant-a/private.pdf");
  const originalBytes = await new Response(original!.body).arrayBuffer();

  assert.equal((await processDocument({ ...base, transport })).state, "busy");
  const afterStale = readProcessing(String((await row())?.extracted_json));
  assert.equal(afterStale.processing?.lock, "newer-reader");
  assert.equal(afterStale.processing?.stage, "reading");
  assert.equal(afterStale.processing?.operation, operation);
  assert.equal(afterStale.extraction, undefined);
  assert.equal(deletes, 0, "a stale request must not delete an unpersisted shared extraction result");
  assert.equal(resultExists, true);

  // Model expiry of the successor's processing lease without waiting in real time.
  await database.prepare("UPDATE workspace_documents SET extracted_json=json_set(extracted_json,'$.processing.leaseUntil',0) WHERE id='doc-a'").run();
  assert.equal((await processDocument({ ...base, transport })).state, "complete");
  const saved = (await row())!, completed = readProcessing(String(saved.extracted_json));
  assert.equal(completed.extraction?.text, "Fictional retained result");
  assert.equal(completed.extraction?.pages, 3);
  assert.equal(completed.processing?.operation, undefined);
  assert.equal(completed.processing?.lock, undefined);
  assert.equal(saved.status, "review_required");
  assert.deepEqual([starts, deletes], [1, 1], "resume must use the existing analysis and delete it only after persistence");
  const remaining = await bucket.get("tenant-a/private.pdf");
  assert.equal(remaining?.etag, original!.etag);
  assert.deepEqual(await new Response(remaining!.body).arrayBuffer(), originalBytes);
});

test("a scan claim lost during polling keeps the shared scan reference for its successor", async t => {
  const { base, database, row, bucket } = await setup(t);
  const scanner = scannerFixture();
  assert.equal((await processDocument({ ...base, transport: scanner.transport })).state, "scan_waiting");
  const original = await bucket.get("tenant-a/private.pdf");
  const originalBytes = await new Response(original!.body).arrayBuffer();
  const savedScan = readProcessing(String((await row())?.extracted_json)).processing?.azureScan;
  let stealOnVerdict = true;
  const transport = (async (url, init) => {
    const response = await scanner.transport(url, init);
    if (stealOnVerdict && new URL(String(url)).searchParams.get("comp") === "tags") {
      stealOnVerdict = false;
      await database.prepare("UPDATE workspace_documents SET extracted_json=json_set(extracted_json,'$.processing.lock','newer-scanner','$.processing.leaseUntil',?) WHERE id='doc-a'")
        .bind(Date.now() + 90_000).run();
    }
    return response;
  }) as typeof fetch;

  assert.equal((await processDocument({ ...base, transport })).state, "busy");
  const staleRow = (await row())!, afterStale = readProcessing(String(staleRow.extracted_json));
  assert.equal(afterStale.processing?.lock, "newer-scanner");
  assert.equal(afterStale.processing?.stage, "scan_waiting");
  assert.deepEqual(afterStale.processing?.azureScan, savedScan);
  assert.equal(staleRow.security_state, "quarantined");
  assert.equal(scanner.blobs.size, 1);
  assert.equal(scanner.calls.filter(call => call === "DELETE").length, 0, "lost ownership does not mean the shared scan is orphaned");
  const unchanged = await bucket.get("tenant-a/private.pdf");
  assert.equal(unchanged?.etag, original!.etag);
  assert.equal(unchanged?.customMetadata?.securityState, "quarantined");
  assert.deepEqual(await new Response(unchanged!.body).arrayBuffer(), originalBytes);

  await database.prepare("UPDATE workspace_documents SET extracted_json=json_set(extracted_json,'$.processing.leaseUntil',0) WHERE id='doc-a'").run();
  assert.equal((await processDocument({ ...base, transport: scanner.transport })).state, "scanned");
  assert.equal(scanner.blobs.size, 0);
  assert.equal(scanner.calls.filter(call => call === "PUT").length, 1, "resume must not upload a second scan copy");
  assert.equal(scanner.calls.filter(call => call === "DELETE").length, 1);
  assert.equal((await row())?.security_state, "clean");
  assert.equal(readProcessing(String((await row())?.extracted_json)).processing?.lock, undefined);
  assert.deepEqual(await new Response((await bucket.get("tenant-a/private.pdf"))!.body).arrayBuffer(), originalBytes);
});
