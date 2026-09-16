import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import test from "node:test";
import { createEnvironment, createReportWorkspace, origin, context } from "./helpers/retail-worker-fixture.mjs";

test("signed scheduler alone resumes requested document deletion; rejected and replayed ticks cannot delete", { timeout: 120000 }, async () => {
  const { worker, environment, database, dispose } = await createEnvironment();
  const secret = "fixture-only-document-cleanup-key-32chars";
  environment.POS_SYNC_SECRET = secret;
  let deletes = 0;
  environment.BUCKET = { delete: async () => { deletes++; } };
  try {
    const { organizationId, userId } = await createReportWorkspace(worker, environment, database, "cleanup-scheduler");
    const id = randomUUID(), now = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({ deletion: { version: 1, requestedAt: Date.now(), requestedBy: userId, originalRemoved: false } });
    await database.prepare(`INSERT INTO workspace_documents(id,organization_id,document_type,file_name,object_key,content_type,size_bytes,sha256_hex,security_state,status,scan_status,extraction_status,extracted_json,uploaded_by_user_id,created_at,updated_at)
      VALUES (?,?,'bank_statement','PRIVATE statement.pdf',?,'application/pdf',100,?,'quarantined','deletion_pending','pending','not_configured',?,?,?,?)`)
      .bind(id, organizationId, `${organizationId}/PRIVATE.pdf`, id, payload, userId, now, now).run();
    const request = (body = "{}", nonce = randomUUID()) => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      return new Request(`${origin}/api/internal/pos-sync`, { method: "POST", body, headers: {
        "content-type": "application/json", "x-vanteloq-sync-timestamp": timestamp, "x-vanteloq-sync-nonce": nonce,
        "x-vanteloq-sync-signature": createHmac("sha256", secret).update(`${timestamp}.${nonce}.${body}`).digest("hex"),
      } });
    };
    const tick = request => worker.fetch(request, environment, context);
    assert.equal((await tick(new Request(`${origin}/api/internal/pos-sync`, { method: "POST", body: "{}" }))).status, 401);
    assert.equal((await tick(request('{"documentId":"other"}'))).status, 400);
    assert.equal(deletes, 0);
    const signed = request();
    const result = await tick(signed.clone());
    assert.equal(result.status, 200, await result.clone().text());
    const body = await result.json();
    assert.equal(body.accepted, true); assert.equal(body.processed, 0); assert.deepEqual(body.counts, {});
    assert.deepEqual(body.documentCleanup, { processed: 1, counts: { complete: 1 } });
    assert.equal(deletes, 1);
    assert.equal(await database.prepare("SELECT id FROM workspace_documents WHERE id=?").bind(id).first(), null);
    assert.equal((await tick(signed.clone())).status, 409); assert.equal(deletes, 1);
    const audits = await database.prepare("SELECT action,actor_user_id,details_json FROM audit_events WHERE resource_id=? AND action LIKE 'document.cleanup_retry.%' ORDER BY action").bind(id).all();
    assert.equal(audits.results.length, 2);
    assert.ok(audits.results.every(event => event.actor_user_id === null));
    assert.doesNotMatch(JSON.stringify(audits.results), /PRIVATE|statement\.pdf|https:/);

    // Failure to select POS work must not return early and orphan the already-started cleanup.
    const independentId = randomUUID();
    await database.prepare(`INSERT INTO workspace_documents(id,organization_id,document_type,file_name,object_key,content_type,size_bytes,sha256_hex,security_state,status,scan_status,extraction_status,extracted_json,uploaded_by_user_id,created_at,updated_at)
      VALUES (?,?,'bank_statement','PRIVATE statement.pdf',?,'application/pdf',100,?,'quarantined','deletion_pending','pending','not_configured',?,?,?,?)`)
      .bind(independentId, organizationId, `${organizationId}/second-PRIVATE.pdf`, independentId, payload, userId, now, now).run();
    environment.DB = new Proxy(database, { get(target, property) {
      if (property === "prepare") return sql => {
        if (sql.includes("SELECT connection_id FROM integration_sync_schedules")) throw new Error("fixture POS selection unavailable");
        return target.prepare(sql);
      };
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const independent = await tick(request());
    assert.equal(independent.status, 200, await independent.clone().text());
    const independentBody = await independent.json();
    assert.deepEqual(independentBody.counts, { scheduler_error: 1 });
    assert.deepEqual(independentBody.documentCleanup, { processed: 1, counts: { complete: 1 } });
    assert.equal(deletes, 2);
    assert.equal(await database.prepare("SELECT id FROM workspace_documents WHERE id=?").bind(independentId).first(), null);
  } finally { await dispose(); }
});
