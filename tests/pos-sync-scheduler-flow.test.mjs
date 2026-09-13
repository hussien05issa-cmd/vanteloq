import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import test from "node:test";
import { createEnvironment, createReportWorkspace, dispatch, origin, context } from "./helpers/retail-worker-fixture.mjs";
const secret = "fixture-only-background-secret-32-characters";
const schedulePath = "/api/v1/integrations/schedule";
test("durable POS jobs enforce owner grants, tenant boundaries, signed ticks, replay protection, retries, consent and pause", async () => {
  const { worker, environment, database, dispose } = await createEnvironment();
  environment.POS_SYNC_SECRET = secret;
  environment.STRIPE_SECRET_KEY = "sk_test_scheduler_fixture";
  environment.STRIPE_CLIENT_ID = "ca_scheduler_fixture";
  environment.STRIPE_REDIRECT_URI = origin + "/api/v1/integrations/stripe/callback";
  environment.STRIPE_WEBHOOK_SECRET = "whsec_scheduler_fixture";
  const fetchBefore = globalThis.fetch;
  let providerCalls = 0, failProvider = false;
  const providerFetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname === "api.stripe.com") {
      providerCalls++;
      return failProvider ? Response.json({ error: "test failure" }, { status: 400 })
        : Response.json({ data: [], has_more: false });
    }
    return fetchBefore(input, init);
  };
  try {
    const a = await createReportWorkspace(worker, environment, database, "scheduler-a");
    const b = await createReportWorkspace(worker, environment, database, "scheduler-b");
    globalThis.fetch = providerFetch;
    const id = "connection-scheduler-a", now = Math.floor(Date.now()/1000);
    await database.prepare(`INSERT INTO integration_connections
      (id,organization_id,provider,source_namespace,status,external_account_ref,external_account_name,created_at,updated_at,data_promotion_status)
      VALUES (?,?,'stripe','production:fixture','connected','acct_SchedulerA','Fixture merchant',?,?,'staging')`)
      .bind(id,a.organizationId,now,now).run();
    await database.prepare(`INSERT INTO integration_consents(id,organization_id,actor_user_id,provider,status,notice_version,privacy_policy_version,data_categories_json,purposes_json,accepted_at,created_at,updated_at)
      VALUES ('consent-fixture',?,?,'stripe','accepted','test','test','[]','[]',?,?,?)`).bind(a.organizationId,a.userId,now,now,now).run();
    const setting = { provider: "stripe", connectionId: id, enabled: true, authorizationVersion: "owner-background-sync-v1" };
    const configure = (body, owner = a.owner) => dispatch(worker,environment,schedulePath,{method:"POST",...owner,body});
    const foreign = await configure(setting,b.owner);
    assert.equal(foreign.status,404);
    const badGrant = await configure({...setting,authorizationVersion:"unknown"});
    assert.equal(badGrant.status,400);
    const enabled = await configure(setting);
    assert.equal(enabled.status,200,await enabled.clone().text());
    const row = await database.prepare("SELECT * FROM integration_sync_schedules WHERE connection_id=?").bind(id).first();
    assert.equal(row.organization_id,a.organizationId);
    assert.equal(row.authorized_by_user_id,a.userId);
    assert.equal(row.enabled,1);
    const tickRequest = (body = "{}", nonce = randomUUID(), timestamp = String(Math.floor(Date.now()/1000))) => new Request(origin+"/api/internal/pos-sync", {
      method:"POST", headers:{"content-type":"application/json","x-vanteloq-sync-timestamp":timestamp,"x-vanteloq-sync-nonce":nonce,
        "x-vanteloq-sync-signature":createHmac("sha256",secret).update(timestamp+"."+nonce+"."+body).digest("hex")},body,
    });
    const tick = request => worker.fetch(request,environment,context);
    const unsigned = await tick(new Request(origin+"/api/internal/pos-sync",{method:"POST",body:"{}"}));
    assert.equal(unsigned.status,401);
    assert.equal(providerCalls,0);
    const forbiddenBody = await tick(tickRequest('{"connectionId":"other"}'));
    assert.equal(forbiddenBody.status,400);
    assert.equal(providerCalls,0);
    // An event arriving during an earlier page of this cycle remains queued.
    await database.prepare("UPDATE integration_sync_schedules SET cycle_started_at=? WHERE connection_id=?").bind(now-300,id).run();
    for (const [eventId,received] of [["before-cycle",now-360],["during-cycle",now-100]]) {
      await database.prepare(`INSERT INTO integration_webhook_events(id,organization_id,provider,connection_id,payload_hash,signature_hash,event_type,status,received_at)
        VALUES (?,?,'stripe',?,?,'signed','charge.succeeded','queued',?)`).bind(eventId,a.organizationId,id,eventId,received).run();
    }
    const signed = tickRequest();
    const result = await tick(signed.clone());
    assert.equal(result.status,200,await result.clone().text());
    assert.deepEqual((await result.json()).counts,{completed:1}, JSON.stringify(await database.prepare("SELECT last_error_code FROM integration_sync_schedules WHERE connection_id=?").bind(id).first()));
    assert.equal(providerCalls,2);
    const duplicate = await tick(signed.clone());
    assert.equal(duplicate.status,409);
    assert.equal(providerCalls,2);
    const events = await database.prepare("SELECT id,status FROM integration_webhook_events ORDER BY id").all();
    assert.deepEqual(events.results,[{id:"before-cycle",status:"processed"},{id:"during-cycle",status:"queued"}]);
    const safeConnection = await database.prepare("SELECT data_promotion_status status FROM integration_connections WHERE id=?").bind(id).first();
    assert.equal(safeConnection.status,"staging","Automatic sync must not approve a test or unreviewed source");
    await database.prepare("UPDATE integration_sync_schedules SET next_run_at=0 WHERE connection_id=?").bind(id).run();
    failProvider = true;
    const failed = await tick(tickRequest());
    assert.deepEqual((await failed.json()).counts,{retrying:1});
    const retry = await database.prepare("SELECT consecutive_failures failures,next_run_at next,last_status status,enabled FROM integration_sync_schedules WHERE connection_id=?").bind(id).first();
    assert.equal(retry.failures,1); assert.equal(retry.status,"retrying"); assert.equal(retry.enabled,1); assert.ok(retry.next>=now+60);
    failProvider = false;
    const paused = await configure({...setting,enabled:false});
    assert.equal(paused.status,200);
    const callsAtPause = providerCalls;
    await database.prepare("UPDATE integration_sync_schedules SET next_run_at=0 WHERE connection_id=?").bind(id).run();
    assert.equal((await (await tick(tickRequest())).json()).processed,0);
    assert.equal(providerCalls,callsAtPause);
    assert.equal((await configure(setting)).status,200);
    await database.prepare("UPDATE integration_consents SET status='withdrawn' WHERE id='consent-fixture'").run();
    const withdrawn = await tick(tickRequest());
    assert.deepEqual((await withdrawn.json()).counts,{attention:1});
    assert.equal(providerCalls,callsAtPause);
    assert.equal((await database.prepare("SELECT enabled FROM integration_sync_schedules WHERE connection_id=?").bind(id).first()).enabled,0);
    await database.prepare("UPDATE integration_consents SET status='accepted' WHERE id='consent-fixture'").run();
    assert.equal((await configure(setting)).status,200);
    await database.prepare("UPDATE memberships SET role='admin' WHERE user_id=? AND organization_id=?").bind(a.userId,a.organizationId).run();
    const demoted = await tick(tickRequest());
    assert.deepEqual((await demoted.json()).counts,{attention:1});
    assert.equal(providerCalls,callsAtPause);
    const otherWorkspace = await database.prepare("SELECT COUNT(*) count FROM integration_sync_schedules WHERE organization_id=?").bind(b.organizationId).first();
    assert.equal(otherWorkspace.count,0);
    await database.prepare(`INSERT INTO integration_connections(id,organization_id,provider,source_namespace,status,external_account_ref,created_at,updated_at,data_promotion_status)
      VALUES ('connection-consent-b',?,'stripe','production:b','connected','acct_ConsentB',?,?,'staging')`).bind(b.organizationId,now,now).run();
    const newSetting = {...setting,connectionId:'connection-consent-b'};
    assert.equal((await configure(newSetting,b.owner)).status,403);
    assert.equal((await configure({...newSetting,consentAccepted:true,consentNoticeVersion:'obsolete'},b.owner)).status,403);
    const consentEnabled = await configure({...newSetting,consentAccepted:true,consentNoticeVersion:'pos-background-data-v1'},b.owner);
    assert.equal(consentEnabled.status,200,await consentEnabled.clone().text());
    const savedConsent = await database.prepare("SELECT actor_user_id actor,notice_version notice,status FROM integration_consents WHERE organization_id=? AND provider='stripe'").bind(b.organizationId).first();
    assert.deepEqual(savedConsent,{actor:b.userId,notice:'pos-background-data-v1',status:'accepted'});
  } finally { globalThis.fetch=fetchBefore; await dispose(); }
});
