import assert from "node:assert/strict";
import test from "node:test";
import { createEnvironment, createReportWorkspace, dispatch, identityHeaders, origin, context } from "./helpers/retail-worker-fixture.mjs";

test("built document uploads bound actual multipart bytes before parsing or writing and return valid timestamp dates", { timeout: 120000 }, async () => {
  const { worker, environment, database, dispose } = await createEnvironment();
  try {
    const { organizationId, owner } = await createReportWorkspace(worker, environment, database, "upload-limits");
    let puts = 0;
    environment.BUCKET = { put: async () => { puts++; }, delete: async () => {} };
    const headers = identityHeaders(owner.email, owner.name, true);
    delete headers["content-type"];
    const maximumBodyBytes = 10 * 1024 * 1024 + 100_000;
    for (const chunkSize of [16 * 1024, 64 * 1024]) {
      let consumed = 0, cancelled = false;
      const stream = new ReadableStream({
        pull(controller) {
          if (consumed >= 20 * 1024 * 1024) { controller.close(); return; }
          consumed += chunkSize; controller.enqueue(new Uint8Array(chunkSize));
        },
        cancel() { cancelled = true; },
      });
      const oversized = await worker.fetch(new Request(`${origin}/api/v1/documents`, {
        method: "POST", headers: { ...headers, "content-type": "multipart/form-data; boundary=fictional" }, body: stream, duplex: "half",
      }), environment, context);
      assert.equal(oversized.status, 413, await oversized.clone().text());
      assert.equal((await oversized.json()).error.code, "FILE_TOO_LARGE");
      assert.equal(cancelled, true);
      // The bounded reader stops at its first oversized chunk. The built Node/vinext
      // request wrappers may already have 3 further chunks queued upstream.
      // Direct-reader coverage independently enforces the strict cap; this small,
      // chunk-scaled allowance checks endpoint cancellation without assuming no prefetch.
      assert.ok(consumed <= maximumBodyBytes + 4 * chunkSize,
        `bounded endpoint prefetch: ${consumed} bytes produced for ${chunkSize}-byte chunks`);
    }
    assert.equal(puts, 0);
    assert.equal((await database.prepare("SELECT count(*) count FROM workspace_documents WHERE organization_id=?").bind(organizationId).first()).count, 0);

    const malformed = await worker.fetch(new Request(`${origin}/api/v1/documents`, {
      method: "POST", headers: { ...headers, "content-type": "multipart/form-data; boundary=fictional" }, body: "not a multipart document",
    }), environment, context);
    assert.equal(malformed.status, 400, await malformed.clone().text());
    assert.equal((await malformed.json()).error.code, "INVALID_MULTIPART");
    assert.equal(puts, 0);

    const form = new FormData();
    form.set("file", new Blob(["%PDF-1.4\nFictional upload boundary test\n%%EOF"], { type: "application/pdf" }), "Fictional.pdf");
    form.set("documentType", "bank_statement");
    const uploaded = await worker.fetch(new Request(`${origin}/api/v1/documents`, { method: "POST", headers, body: form }), environment, context);
    assert.equal(uploaded.status, 201, await uploaded.clone().text());
    const body = await uploaded.json();
    assert.equal(body.documents.length, 1); assert.equal(puts, 1);
    for (const key of ["createdAt", "updatedAt"]) assert.ok(Math.abs(Date.parse(body.documents[0][key]) - Date.now()) < 30_000, `${key} has a current schema readback`);
    const stored = await database.prepare("SELECT created_at,updated_at FROM workspace_documents WHERE organization_id=?").bind(organizationId).first();
    for (const raw of Object.values(stored)) assert.ok(Math.abs(raw * 1000 - Date.now()) < 30_000);
    const listed = await dispatch(worker, environment, "/api/v1/documents", owner);
    assert.equal(listed.status, 200);
    assert.equal((await listed.json()).documents[0].createdAt, body.documents[0].createdAt);
  } finally { await dispose(); }
});
