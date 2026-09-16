import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Miniflare } from "miniflare";
import { PDFDocument } from "pdf-lib";
import { workspaceDocuments } from "../db/schema.ts";
import { readRequestBytes } from "../server/api.ts";
import { processDocument, cleanupCompletedDocument, readProcessing } from "../server/document-processing.ts";
import { deleteDocument } from "../server/document-deletion.ts";
import { DOCUMENT_PROCESSING_NOTICE_VERSION } from "../shared/document-processing.ts";
import { scannerEnv, scannerFixture } from "./azure-scanner-fixture.ts";

const env = { ...scannerEnv, AZURE_DOCUMENT_INTELLIGENCE_KEY: "fictional-read-key", AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT: "https://qa.cognitiveservices.azure.com" };
const operation = `${env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT}/documentintelligence/documentModels/prebuilt-layout/analyzeResults/00000000-0000-0000-0000-000000000001?api-version=2024-11-30`;
type Row = { id: string; created_at: number; updated_at: number; scanned_at: number | null; extracted_json: string };

function recentTimestamp(raw: number) {
  assert.ok(Number.isInteger(raw));
  const readback = workspaceDocuments.updatedAt.mapFromDriverValue(raw);
  assert.ok(readback instanceof Date, "schema readback must produce a Date");
  assert.ok(Math.abs(readback.getTime() - Date.now()) < 30_000, `schema readback must be current, got ${readback.toISOString()}`);
}

async function setup(t: { after(callback: () => Promise<void>): void }) {
  const mf = new Miniflare({ modules: true, script: "export default { fetch(){ return new Response('ok'); } }", d1Databases: ["DB"], r2Buckets: ["BUCKET"] });
  t.after(() => mf.dispose());
  const database = await mf.getD1Database("DB") as unknown as D1Database;
  const bucket = await mf.getR2Bucket("BUCKET") as unknown as R2Bucket;
  await database.prepare(`CREATE TABLE workspace_documents(id TEXT PRIMARY KEY, organization_id TEXT, object_key TEXT,
    content_type TEXT, document_type TEXT, sha256_hex TEXT, security_state TEXT DEFAULT 'quarantined',
    status TEXT DEFAULT 'review_required', scan_status TEXT DEFAULT 'pending', extraction_status TEXT DEFAULT 'not_configured',
    extracted_json TEXT DEFAULT '{}', scan_provider TEXT, scanned_at INTEGER, created_at INTEGER, updated_at INTEGER)`).run();
  for (const table of ["invoice_matches", "customer_invoices", "bank_statement_imports", "bookloq_transaction_matches"])
    await database.prepare(`CREATE TABLE ${table}(document_id TEXT,status TEXT)`).run();
  const pdf = await PDFDocument.create(); pdf.addPage();
  const bytes = new Uint8Array(await pdf.save());
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
  await database.prepare("INSERT INTO workspace_documents(id,organization_id,object_key,content_type,document_type,sha256_hex,created_at,updated_at) VALUES ('doc','tenant','tenant/doc.pdf','application/pdf','other',?,1,1)").bind(hash).run();
  await bucket.put("tenant/doc.pdf", bytes.buffer as ArrayBuffer, { customMetadata: { organizationId: "tenant", securityState: "quarantined" } });
  return { database, bucket, base: { database, bucket, env, organizationId: "tenant", documentId: "doc", actorUserId: "owner", noticeVersion: DOCUMENT_PROCESSING_NOTICE_VERSION },
    row: async () => (await database.prepare("SELECT * FROM workspace_documents WHERE id='doc'").first<Row>())! };
}

test("document processing and cleanup keep SQL dates in seconds and authorization times in milliseconds", async t => {
  const { base, row } = await setup(t);
  const scanner = scannerFixture();
  let failCleanup = true;
  const transport = (async (url, init) => {
    if (String(url).includes("blob.core.windows.net")) return scanner.transport(url, init);
    if (init?.method === "POST") return new Response(null, { status: 202, headers: { "operation-location": operation } });
    if (init?.method === "DELETE") return new Response(null, { status: failCleanup ? 503 : 204 });
    return Response.json({ status: "succeeded", analyzeResult: { modelId: "prebuilt-layout", content: "Fictional record", pages: [{}], tables: [] } });
  }) as typeof fetch;
  for (const expected of ["scan_waiting", "scanned", "reading", "complete"]) {
    assert.equal((await processDocument({ ...base, transport })).state, expected);
    recentTimestamp((await row()).updated_at);
  }
  const saved = await row(), before = readProcessing(saved.extracted_json).processing!;
  assert.equal(saved.scanned_at !== null, true); recentTimestamp(saved.scanned_at!);
  assert.ok(Math.abs(before.authorizedAt - Date.now()) < 30_000);
  assert.equal(before.cleanupPending, true);
  assert.equal((await cleanupCompletedDocument({ ...base, transport })).cleanupPending, true);
  recentTimestamp((await row()).updated_at);
  failCleanup = false;
  assert.equal((await cleanupCompletedDocument({ ...base, transport })).cleanupPending, false);
  const after = await row(); recentTimestamp(after.updated_at);
  assert.equal(readProcessing(after.extracted_json).processing?.authorizedAt, before.authorizedAt);
});

test("pending deletion preserves millisecond request evidence with a correct SQL date", async t => {
  const { base, row } = await setup(t);
  const bucket = { delete: async () => { throw new Error("fictional temporary failure"); } } as unknown as R2Bucket;
  assert.equal((await deleteDocument({ ...base, bucket })).deleted, false);
  const saved = await row(); recentTimestamp(saved.updated_at);
  const deletion = JSON.parse(saved.extracted_json).deletion;
  assert.ok(Math.abs(deletion.requestedAt - Date.now()) < 30_000);
  assert.equal(deletion.lock, undefined);
});

test("timestamp repair is narrow, idempotent, and leaves JSON, valid seconds and out-of-range values unchanged", async t => {
  const { database } = await setup(t);
  const now = Date.now(), seconds = Math.floor(now / 1000);
  const examples = [
    { id: "ms", created: now, updated: now, expectedCreated: seconds, expectedUpdated: seconds },
    { id: "mixed", created: seconds, updated: now, expectedCreated: seconds, expectedUpdated: seconds },
    { id: "seconds", created: seconds, updated: seconds, expectedCreated: seconds, expectedUpdated: seconds },
    { id: "pre2020", created: 1500000000000, updated: 1500000000000, expectedCreated: 1500000000000, expectedUpdated: 1500000000000 },
    { id: "future", created: now + 7 * 86400_000, updated: now + 7 * 86400_000, expectedCreated: now + 7 * 86400_000, expectedUpdated: now + 7 * 86400_000 },
  ];
  const evidence = JSON.stringify({ processing: { authorizedAt: now, leaseUntil: now + 90_000 }, deletion: { requestedAt: now } });
  for (const record of examples) await database.prepare("INSERT INTO workspace_documents(id,created_at,updated_at,extracted_json) VALUES (?,?,?,?)").bind(record.id, record.created, record.updated, evidence).run();
  const migration = await readFile(new URL("../drizzle/0054_document_timestamp_units.sql", import.meta.url), "utf8");
  assert.doesNotMatch(migration, /\r/);
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const statement of migration.split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean)) await database.prepare(statement).run();
    for (const record of examples) {
      const saved = (await database.prepare("SELECT * FROM workspace_documents WHERE id=?").bind(record.id).first<Row>())!;
      assert.equal(saved.created_at, record.expectedCreated, record.id);
      assert.equal(saved.updated_at, record.expectedUpdated, record.id);
      assert.equal(saved.extracted_json, evidence);
    }
  }
});


test("streaming request reader rejects and cancels at the first oversized chunk, independently of route wrappers", async () => {
  const limit = 100_000;
  for (const chunkSize of [16 * 1024, 64 * 1024]) {
    let consumed = 0, cancelled = false;
    const stream = new ReadableStream({
      pull(controller) {
        if (consumed >= 1_000_000) { controller.close(); return; }
        consumed += chunkSize; controller.enqueue(new Uint8Array(chunkSize));
      },
      cancel() { cancelled = true; },
    });
    const request = new Request("https://fixture.invalid/upload", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    await assert.rejects(readRequestBytes(request, limit), { status: 413, code: "REQUEST_TOO_LARGE" });
    assert.equal(cancelled, true);
    assert.equal(consumed, (Math.floor(limit / chunkSize) + 1) * chunkSize, "reader consumes only through the first chunk crossing its limit");
  }
});
