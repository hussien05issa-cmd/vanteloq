import assert from "node:assert/strict";
import test from "node:test";
import { createEnvironment, createReportWorkspace, dispatch, identityHeaders, origin, context as executionContext } from "./helpers/retail-worker-fixture.mjs";
import { defaultFollowupNote, defaultFollowupPreferences } from "../domain/workflow-followup.ts";
import { processFollowupDelivery, runWorkflowFollowupTick, sendFollowupEmail } from "../server/workflow-followup.ts";

test("follow-through isolates records, preserves edits, requires opt-in and safely delivers once", async t => {
  const fixture = await createEnvironment(); t.after(fixture.dispose);
  const { worker, database: db, environment } = fixture;
  Object.assign(environment, { POS_SYNC_SECRET: "fixture-only-signing-value-for-followup-tests", RESEND_API_KEY: "fixture-only-no-network", INVOICE_EMAIL_FROM: "Test <sender@example.invalid>" });
  const a = await createReportWorkspace(worker, environment, db, "followup-a"), b = await createReportWorkspace(worker, environment, db, "followup-b");
  const now = new Date(new Date().toISOString().slice(0, 10) + "T08:35:00Z").getTime(), today = new Date(now).toISOString().slice(0, 10), yesterday = new Date(now - 86400000).toISOString().slice(0, 10);
  for (const tenant of [a, b]) {
    await db.prepare("INSERT INTO tenant_addons(id,organization_id,addon_key,status,created_at,updated_at) VALUES(?,?,'bookloq','active',?,?)").bind(crypto.randomUUID(), tenant.organizationId, now, now).run();
    await db.prepare("UPDATE workspaces SET timezone='UTC',hours_json=? WHERE id=?").bind(JSON.stringify(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(day => ({ day, open: "09:00", close: "17:00", closed: false }))), tenant.organizationId).run();
    await db.prepare("INSERT INTO bookloq_contacts(id,organization_id,contact_type,name,email,created_at,updated_at) VALUES(?,?,'customer','Fictional Customer','customer@example.invalid',?,?)").bind(`contact-${tenant.organizationId}`, tenant.organizationId, now, now).run();
    await db.prepare("INSERT INTO customer_invoices(id,organization_id,customer_id,invoice_number,invoice_date,due_date,status,subtotal_cents,tax_cents,total_cents,paid_cents,currency,created_at,updated_at) VALUES(?,?,?,'TEST-ONLY-001',?,?,'sent',10000,0,10000,0,'CAD',?,?)").bind(`invoice-${tenant.organizationId}`, tenant.organizationId, `contact-${tenant.organizationId}`, yesterday, yesterday, now, now).run();
  }
  const post = (body, tenant = a) => dispatch(worker, environment, "/api/v1/workflow-followup", { method: "POST", ...tenant.owner, body });
  const get = (mode = "collections", tenant = a) => dispatch(worker, environment, `/api/v1/workflow-followup?mode=${mode}`, tenant.owner);
  const row = async id => db.prepare("SELECT * FROM workflow_deliveries WHERE id=?").bind(id).first();
  const saveNote = (version, extra = {}, tenant = a) => ({ mode: "collections", action: "save_followup", invoiceId: `invoice-${tenant.organizationId}`, expectedVersion: version, mutationKey: crypto.randomUUID(), reviewed: true, record: { ...defaultFollowupNote, ...extra } });
  const savePrefs = async (version, overrides = {}) => {
    const response = await post({ mode: "briefings", action: "save_preferences", expectedVersion: version, mutationKey: crypto.randomUUID(), reviewed: true, preferences: { ...defaultFollowupPreferences, ...overrides } });
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  };
  await t.test("tenant reads and saves are isolated, role and CSRF are enforced", async () => {
    const response = await get(); assert.equal(response.status, 200); const data = await response.json(); assert.equal(data.records.length, 1); assert.equal(data.records[0].id, `invoice-${a.organizationId}`); assert.equal(data.preferences.invoiceReminders, false);
    assert.equal((await post(saveNote(0, {}, b))).status, 404);
    const headers = identityHeaders(a.owner.email, a.owner.name, true); headers.origin = "https://untrusted.example";
    assert.equal((await worker.fetch(new Request(origin + "/api/v1/workflow-followup", { method: "POST", headers, body: JSON.stringify(saveNote(0)) }), environment, executionContext)).status, 403);
    await db.prepare("UPDATE memberships SET role='read_only' WHERE user_id=?").bind(a.userId).run();
    assert.equal((await post(saveNote(0))).status, 403);
    await db.prepare("UPDATE memberships SET role='owner' WHERE user_id=?").bind(a.userId).run();
  });
  await t.test("competing revisions cannot overwrite, retry does not duplicate history", async () => {
    const first = saveNote(0, { nextAction: "Call about invoice" }), second = saveNote(0, { nextAction: "Review contact" });
    const results = await Promise.all([post(first), post(second)]); assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    const winner = results[0].status === 200 ? first : second;
    const replay = await post(winner); assert.equal(replay.status, 200); assert.equal((await replay.json()).replayed, true);
    assert.equal((await post({ ...winner, record: { ...winner.record, nextAction: "Different details with reused key" } })).status, 409);
    assert.equal((await db.prepare("SELECT COUNT(*) count FROM collection_followup_events WHERE organization_id=?").bind(a.organizationId).first()).count, 1);
    assert.equal((await post(saveNote(1, { promisedDate: today, promisedCents: 11000 }))).status, 400);
  });
  await t.test("a saved briefing is deduplicated and provider acceptance is distinct from reading", async () => {
    await savePrefs(0, { opening: true, emailBriefings: true });
    globalThis.__vanteloqEnv = environment;
    const messages = [];
    const send = async (id, payload) => { messages.push({ id, payload }); return "fictional-provider-id"; };
    await Promise.all([runWorkflowFollowupTick(now, send), runWorkflowFollowupTick(now, send)]);
    assert.equal(messages.length, 1); assert.equal(messages[0].payload.recipient, a.owner.email); assert.doesNotMatch(messages[0].payload.text, /100\.00|Fictional Customer/);
    const receipt = await row(messages[0].id); assert.equal(receipt.status, "accepted"); assert.equal(receipt.acknowledged_at, null);
    assert.equal((await post({ mode: "briefings", action: "acknowledge", id: receipt.id }, b)).status, 404);
    assert.equal((await post({ mode: "briefings", action: "acknowledge", id: receipt.id })).status, 200);
    await runWorkflowFollowupTick(now + 61_000, send); assert.equal(messages.length, 1);
  });
  await t.test("reminders recheck paid balance after queueing and do not send", async () => {
    assert.equal((await post(saveNote(1, { remindersEnabled: true }))).status, 200);
    await savePrefs(1, { invoiceReminders: true });
    const id = crypto.randomUUID();
    await db.prepare("INSERT INTO workflow_deliveries(id,organization_id,user_id,kind,scope_key,business_date,invoice_id,preference_version,followup_version,status,payload_json,attempts,next_attempt_at,created_at,updated_at) VALUES(?,?,?,'reminder',?,?,?,2,2,'pending','{}',0,?,?,?)").bind(id, a.organizationId, a.userId, `test-payment:${today}`, today, `invoice-${a.organizationId}`, now, now, now).run();
    await db.prepare("UPDATE customer_invoices SET paid_cents=10000,status='paid' WHERE id=?").bind(`invoice-${a.organizationId}`).run();
    let sent = 0; globalThis.__vanteloqEnv = environment;
    assert.equal(await processFollowupDelivery(await row(id), now, async () => { sent++; return "not-allowed"; }), "suppressed"); assert.equal(sent, 0);
    await db.prepare("UPDATE customer_invoices SET paid_cents=0,status='sent' WHERE id=?").bind(`invoice-${a.organizationId}`).run();
  });
  await t.test("retry preserves idempotent mail payload and owner revocation stops it", async () => {
    const id = crypto.randomUUID();
    await db.prepare("INSERT INTO workflow_deliveries(id,organization_id,user_id,kind,scope_key,business_date,invoice_id,preference_version,followup_version,status,payload_json,attempts,next_attempt_at,created_at,updated_at) VALUES(?,?,?,'reminder',?,?,?,2,2,'pending','{}',0,?,?,?)").bind(id, a.organizationId, a.userId, `test-retry:${today}`, today, `invoice-${a.organizationId}`, now, now, now).run();
    const calls = []; globalThis.__vanteloqEnv = environment;
    const send = async (key, payload) => { calls.push([key, JSON.stringify(payload)]); if (calls.length === 1) throw Error("Fictional transport interruption"); return "fictional-accepted"; };
    assert.equal(await processFollowupDelivery(await row(id), now, send), "pending");
    assert.equal(await processFollowupDelivery(await row(id), now + 61_000, send), "accepted"); assert.deepEqual(calls[0], calls[1]);
    const other = crypto.randomUUID();
    await db.prepare("INSERT INTO workflow_deliveries(id,organization_id,user_id,kind,scope_key,business_date,preference_version,status,payload_json,attempts,next_attempt_at,created_at,updated_at) VALUES(?,?,?,'opening',?,?,2,'pending','{}',0,?,?,?)").bind(other, a.organizationId, a.userId, "revoked", today, now, now, now).run();
    await db.prepare("UPDATE memberships SET status='suspended' WHERE user_id=?").bind(a.userId).run();
    assert.equal(await processFollowupDelivery(await row(other), now, async () => { throw Error("Must never send"); }), "suppressed");
    await db.prepare("UPDATE memberships SET status='active' WHERE user_id=?").bind(a.userId).run();
  });
  await t.test("overlapping invoice deliveries serialize and recheck cadence after acceptance", async () => {
    const future = now + 8 * 86400000, date = new Date(future).toISOString().slice(0,10), ids = [crypto.randomUUID(), crypto.randomUUID()];
    for (const [index,id] of ids.entries()) await db.prepare("INSERT INTO workflow_deliveries(id,organization_id,user_id,kind,scope_key,business_date,invoice_id,preference_version,followup_version,status,payload_json,attempts,next_attempt_at,created_at,updated_at) VALUES(?,?,?,'reminder',?,?,?,2,2,'pending','{}',0,?,?,?)").bind(id,a.organizationId,a.userId,`overlap-${index}`,date,`invoice-${a.organizationId}`,future,future,future).run();
    let sends = 0; globalThis.__vanteloqEnv = environment;
    const send = async () => { sends++; await new Promise(resolve=>setTimeout(resolve,20)); return "fictional-overlap-receipt"; };
    const results=await Promise.all(ids.map(async id=>processFollowupDelivery(await row(id),future,send)));
    assert.deepEqual(results.sort(),["accepted","coalesced"]);assert.equal(sends,1);
    const pending = (await Promise.all(ids.map(row))).find(x=>x.status==="pending");
    assert.equal(await processFollowupDelivery(pending,future+61000,send),"suppressed");assert.equal(sends,1);
  });
  await t.test("email transport sends a stable idempotency key and requires a provider receipt", async () => {
    globalThis.__vanteloqEnv = environment;
    const payload = { recipient: "fictional@example.invalid", subject: "Test only", text: "Invented test data" };
    let inspected;
    assert.equal(await sendFollowupEmail("fixed-test-id", payload, async (url, init) => { inspected = { url, init }; return Response.json({ id: "fictional-id" }); }), "fictional-id");
    assert.equal(inspected.init.headers["Idempotency-Key"], "workflow-fixed-test-id"); assert.equal(inspected.init.redirect, "error");
    await assert.rejects(sendFollowupEmail("fixed-test-id", payload, async () => Response.json({})), /acceptance could not be confirmed/);
  });
  await t.test("workspace deletion cascades follow-ups, events, preferences and delivery contents", async () => {
    for (const table of ["collection_followups", "collection_followup_events", "workflow_delivery_preferences", "workflow_deliveries"]) assert.ok((await db.prepare(`SELECT COUNT(*) count FROM ${table} WHERE organization_id=?`).bind(a.organizationId).first()).count > 0);
    await db.prepare("DELETE FROM workspaces WHERE id=?").bind(a.organizationId).run();
    for (const table of ["collection_followups", "collection_followup_events", "workflow_delivery_preferences", "workflow_deliveries"]) assert.equal((await db.prepare(`SELECT COUNT(*) count FROM ${table} WHERE organization_id=?`).bind(a.organizationId).first()).count, 0);
    assert.ok(await db.prepare("SELECT id FROM workspaces WHERE id=?").bind(b.organizationId).first());
  });

});
