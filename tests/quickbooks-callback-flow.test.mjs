import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";
import { Miniflare } from "miniflare";
import { registerSupabaseTestServer } from "./helpers/supabase-loopback-transport.mjs";

const origin = "https://vanteloq.example";
const email = "quickbooks-owner@example.invalid";
const context = { waitUntil() {}, passThroughOnException() {} };
function headers(aal = "aal2") {
  const token = Buffer.from(JSON.stringify({ email, aal, session_id: "quickbooks-session" })).toString("base64url");
  return { authorization: `Bearer test.${token}.signature`, origin, "sec-fetch-site": "same-origin", "content-type": "application/json" };
}

test("QuickBooks callback retains verified initiation MFA and rechecks the actor before one-time exchange", async () => {
  const authServer = createServer((request, response) => {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ id: `test-user:${payload.email}`, email: payload.email,
      email_confirmed_at: "2026-08-01T00:00:00Z", user_metadata: { full_name: "Test owner" } }));
  });
  await new Promise(resolve => authServer.listen(0, "127.0.0.1", resolve));
  const authOrigin = registerSupabaseTestServer(authServer.address().port);
  const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: `quickbooks-mfa-${crypto.randomUUID()}` } });
  const originalFetch = globalThis.fetch;
  const originalEnv = globalThis.__vanteloqEnv;
  try {
    const db = await mf.getD1Database("DB");
    for (const filename of (await readdir(new URL("../drizzle/", import.meta.url))).filter(f => /^\d{4}.*\.sql$/.test(f)).sort()) {
      const sql = await readFile(new URL(`../drizzle/${filename}`, import.meta.url), "utf8");
      for (const statement of sql.split("--> statement-breakpoint").map(s => s.trim()).filter(Boolean)) await db.prepare(statement).run();
    }
    // Exercise actual route modules against real D1 without depending on a stale build.
    const routes = new Map([
      ["/api/v1/onboarding", (await import("../app/api/v1/onboarding/route.ts")).POST],
      ["/api/v1/integrations/quickbooks/authorize", (await import("../app/api/v1/integrations/quickbooks/authorize/route.ts")).POST],
      ["/api/v1/integrations/quickbooks/callback", (await import("../app/api/v1/integrations/quickbooks/callback/route.ts")).GET],
    ]);
    const worker = { fetch(request, env) { globalThis.__vanteloqEnv = env; return routes.get(new URL(request.url).pathname)(request); } };
    const env = { DB: db, ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
      SUPABASE_URL: authOrigin, SUPABASE_PUBLISHABLE_KEY: "test-publishable-key", VANTELOQ_INTERNAL_ACCESS_ENABLED: "true",
      QUICKBOOKS_CLIENT_ID: "test_quickbooks_client_12345", QUICKBOOKS_CLIENT_SECRET: "test_quickbooks_secret_12345",
      QUICKBOOKS_REDIRECT_URI: `${origin}/api/v1/integrations/quickbooks/callback`, QUICKBOOKS_ENV: "sandbox",
      INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") };
    const onboarding = await worker.fetch(new Request(`${origin}/api/v1/onboarding`, { method: "POST", headers: headers(), body: JSON.stringify({
      ownerName: "Test owner", businessName: "Test store", legalName: "Test store Ltd.", businessEmail: email,
      phone: "", website: "", industry: "Retail", country: "CA", province: "AB", city: "Edmonton", address: "1 Test Avenue",
      postalCode: "T5A 1A1", emailNotifications: true, timezone: "America/Edmonton", currency: "CAD", fiscalYearStart: "January",
      taxNumber: "", sourceMode: "connect_later", selectedPos: "", legalAccepted: true, termsVersion: "2026-09-05",
      privacyPolicyVersion: "2026-09-10", legalNoticeVersion: "account-creation-v2",
      hours: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(day => ({ day, open: "09:00", close: "17:00", closed: false })),
    }) }), env, context);
    assert.equal(onboarding.status, 201, await onboarding.clone().text());
    const organizationId = (await onboarding.json()).organization.id;
    const actor = await db.prepare("SELECT id, auth_subject FROM users WHERE email = ?").bind(email).first();
    await db.prepare(`INSERT INTO internal_access (id,user_id,organization_id,access_level,reason,active,mfa_required,created_by_user_id,created_at,updated_at)
      VALUES ('test-founder',?,?,'founder','MFA callback regression',1,1,?,?,?)`).bind(actor.id, organizationId, actor.id, Date.now(), Date.now()).run();
    const authorize = async (aal = "aal2") => worker.fetch(new Request(`${origin}/api/v1/integrations/quickbooks/authorize`, {
      method: "POST", headers: headers(aal), body: JSON.stringify({ consentAcknowledged: true,
        noticeVersion: "quickbooks-accounting-read-v1", privacyPolicyVersion: "2026-09-10", initiatorAssuranceLevel: "aal2" }),
    }), env, context);
    const weak = await authorize("aal1");
    assert.equal(weak.status, 403);
    assert.equal((await weak.json()).error.code, "MFA_REQUIRED");
    let tokenExchanges = 0;
    let revocations = 0;
    let onTokenExchange = async () => {};
    globalThis.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      if (url.origin === authOrigin) return originalFetch(input, init);
      if (url.origin === "https://oauth.platform.intuit.com" && url.pathname.endsWith("/tokens/bearer")) {
        tokenExchanges++;
        assert.equal(init?.redirect, "error");
        await onTokenExchange();
        return Response.json({ access_token: "test-access-token", refresh_token: "test-refresh-token", expires_in: 3600,
          x_refresh_token_expires_in: 86400, token_type: "bearer" });
      }
      if (url.origin === "https://sandbox-quickbooks.api.intuit.com") {
        assert.equal(url.pathname, "/v3/company/123456789/companyinfo/123456789");
        assert.equal(init?.redirect, "error");
        return Response.json({ CompanyInfo: { Id: "1", CompanyName: "Test company", Country: "CA" } });
      }
      if (url.origin === "https://developer.api.intuit.com" && url.pathname === "/v2/oauth2/tokens/revoke") {
        revocations++; assert.equal(init?.redirect, "error");
        return new Response(null, { status: 200 });
      }
      throw Error(`Unexpected external destination: ${url.origin}${url.pathname}`);
    };
    const start = async () => {
      const result = await authorize();
      assert.equal(result.status, 200, await result.clone().text());
      const body = await result.json();
      const state = new URL(body.authorizationUrl).searchParams.get("state");
      const cookie = result.headers.get("set-cookie").split(";")[0];
      const url = `${origin}/api/v1/integrations/quickbooks/callback?code=test-code&realmId=123456789&state=${state}&aal=aal2`;
      return { ...body, url, cookie, finish: () => worker.fetch(new Request(url, { headers: { cookie, accept: "text/html" } }), env, context) };
    };
    const valid = await start();
    const proof = await db.prepare("SELECT initiator_auth_subject,initiator_auth_provider,initiator_assurance_level FROM integration_oauth_states WHERE connection_id=?").bind(valid.connectionId).first();
    assert.deepEqual(proof, { initiator_auth_subject: actor.auth_subject, initiator_auth_provider: "supabase", initiator_assurance_level: "aal2" });
    const wrongBrowser = await worker.fetch(new Request(valid.url), env, context);
    assert.equal(wrongBrowser.status, 400);
    assert.equal(tokenExchanges, 0);
    await db.prepare("UPDATE integration_oauth_states SET initiator_assurance_level='aal1' WHERE connection_id=?").bind(valid.connectionId).run();
    const forged = await valid.finish();
    assert.equal(forged.status, 403);
    assert.equal((await forged.json()).error.code, "MFA_REQUIRED_FOR_INTERNAL_ACCESS");
    assert.equal(tokenExchanges, 0, "callback parameters cannot upgrade the stored assurance");
    await db.prepare("UPDATE integration_oauth_states SET initiator_assurance_level='aal2' WHERE connection_id=?").bind(valid.connectionId).run();
    const raced = await Promise.all([valid.finish(), valid.finish()]);
    assert.deepEqual(raced.map(r => r.status).sort(), [303, 400]);
    assert.equal(tokenExchanges, 1);
    assert.equal(raced.find(r => r.status === 303).headers.get("location"), `${origin}/?integration=quickbooks&connection=connected`);
    const connection = await db.prepare("SELECT status,data_promotion_status,organization_id FROM integration_connections WHERE id=?").bind(valid.connectionId).first();
    assert.deepEqual(connection, { status: "connected", data_promotion_status: "staging", organization_id: organizationId });
    const secret = await db.prepare("SELECT access_token_ciphertext,refresh_token_ciphertext FROM integration_secrets WHERE connection_id=? LIMIT 1").bind(valid.connectionId).first();
    assert.ok(secret);
    assert.doesNotMatch(JSON.stringify(secret), /test-access-token|test-refresh-token/);
    assert.equal((await valid.finish()).status, 400);

    const changedIdentity = await start();
    await db.prepare("UPDATE integration_oauth_states SET initiator_auth_subject='different-subject' WHERE connection_id=?").bind(changedIdentity.connectionId).run();
    assert.equal((await changedIdentity.finish()).status, 403);
    const missingProof = await start();
    await db.prepare("UPDATE integration_oauth_states SET initiator_auth_subject=NULL WHERE connection_id=?").bind(missingProof.connectionId).run();
    assert.equal((await missingProof.finish()).status, 403);
    const expired = await start();
    await db.prepare("UPDATE integration_oauth_states SET expires_at=1 WHERE connection_id=?").bind(expired.connectionId).run();
    assert.equal((await expired.finish()).status, 400);
    const membershipRevoked = await start();
    await db.prepare("UPDATE memberships SET status='suspended' WHERE user_id=? AND organization_id=?").bind(actor.id, organizationId).run();
    assert.equal((await membershipRevoked.finish()).status, 403);
    await db.prepare("UPDATE memberships SET status='active' WHERE user_id=? AND organization_id=?").bind(actor.id, organizationId).run();
    const grantRevoked = await start();
    await db.prepare("UPDATE internal_access SET active=0 WHERE id='test-founder'").run();
    assert.equal((await grantRevoked.finish()).status, 403);
    assert.equal(tokenExchanges, 1, "revoked identity, membership, grant or state cannot exchange tokens");
    await db.prepare("UPDATE internal_access SET active=1 WHERE id='test-founder'").run();
    await db.prepare("DELETE FROM rate_limit_buckets").run();

    const changedConfig = await start();
    env.QUICKBOOKS_ENV = "production";
    assert.equal((await changedConfig.finish()).status, 303);
    assert.equal(tokenExchanges, 1, "a pending sandbox grant cannot be exchanged under production configuration");
    assert.equal((await db.prepare("SELECT last_error_code FROM integration_connections WHERE id=?").bind(changedConfig.connectionId).first()).last_error_code, "QUICKBOOKS_GRANT_RECONNECT_REQUIRED");
    env.QUICKBOOKS_ENV = "sandbox";

    // Inject a real SQLite persistence failure after reconnect metadata changes.
    const retry = await start();
    const beforeRetrySecret = await db.prepare("SELECT * FROM integration_secrets WHERE connection_id=?").bind(valid.connectionId).first();
    await db.prepare(`CREATE TRIGGER test_qb_save_failure BEFORE INSERT ON integration_secrets WHEN NEW.connection_id='${valid.connectionId}' BEGIN SELECT RAISE(ABORT, 'injected save failure'); END`).run();
    assert.equal((await retry.finish()).status, 303);
    await db.prepare("DROP TRIGGER test_qb_save_failure").run();
    const failedGrant = await db.prepare("SELECT status,data_promotion_status,source_namespace FROM integration_connections WHERE id=?").bind(valid.connectionId).first();
    assert.equal(failedGrant.status, "error"); assert.equal(failedGrant.data_promotion_status, "blocked");
    assert.deepEqual(await db.prepare("SELECT * FROM integration_secrets WHERE connection_id=?").bind(valid.connectionId).first(), beforeRetrySecret);
    const recovered = await start();
    assert.equal((await recovered.finish()).headers.get("location"), `${origin}/?integration=quickbooks&connection=connected`);
    assert.equal((await db.prepare("SELECT status FROM integration_connections WHERE id=?").bind(valid.connectionId).first()).status, "connected", "the failed realm can deliberately reconnect without a uniqueness dead end");

    // A later audit error must not invalidate a successfully persisted grant.
    const auditFailure = await start();
    await db.prepare("CREATE TRIGGER test_qb_audit_failure BEFORE INSERT ON audit_events WHEN NEW.action='integration.connected' BEGIN SELECT RAISE(ABORT, 'injected audit failure'); END").run();
    assert.equal((await auditFailure.finish()).status, 303);
    await db.prepare("DROP TRIGGER test_qb_audit_failure").run();
    const savedDespiteAudit = await db.prepare("SELECT status,source_namespace FROM integration_connections WHERE id=?").bind(valid.connectionId).first();
    assert.equal(savedDespiteAudit.status, "connected");
    assert.match(savedDespiteAudit.source_namespace, /^quickbooks:v1:sandbox:/);

    // Withdrawal of attempt B must not reconnect the already connected A.
    const removedRetry = await start();
    const existingBeforeRemoval = await db.prepare("SELECT source_namespace,status FROM integration_connections WHERE id=?").bind(valid.connectionId).first();
    const secretBeforeRemoval = await db.prepare("SELECT * FROM integration_secrets WHERE connection_id=?").bind(valid.connectionId).first();
    const revocationsBeforeRemoval = revocations;
    const { removeQuickBooksGrant } = await import("../server/integrations/quickbooks.ts");
    onTokenExchange = async () => { await removeQuickBooksGrant(organizationId, removedRetry.connectionId); };
    assert.equal((await removedRetry.finish()).headers.get("location"), `${origin}/?integration=quickbooks&connection=failed`);
    onTokenExchange = async () => {};
    assert.equal(revocations, revocationsBeforeRemoval, "a cancelled reconnect must not revoke the still-connected company authorization");
    assert.deepEqual(await db.prepare("SELECT source_namespace,status FROM integration_connections WHERE id=?").bind(valid.connectionId).first(), existingBeforeRemoval);
    assert.deepEqual(await db.prepare("SELECT * FROM integration_secrets WHERE connection_id=?").bind(valid.connectionId).first(), secretBeforeRemoval);
    assert.equal((await db.prepare("SELECT status FROM integration_connections WHERE id=?").bind(removedRetry.connectionId).first()).status, "revoked");

    // Remove the old realm so this exercises a first-time callback, not reconnect.
    await db.prepare("UPDATE integration_connections SET status='revoked',external_account_ref=NULL WHERE id=?").bind(valid.connectionId).run();
    const removedPending = await start();
    onTokenExchange = async () => { await db.prepare("UPDATE integration_connections SET status='revoked' WHERE id=?").bind(removedPending.connectionId).run(); };
    assert.equal((await removedPending.finish()).status, 303);
    onTokenExchange = async () => {};
    assert.equal((await db.prepare("SELECT status FROM integration_connections WHERE id=?").bind(removedPending.connectionId).first()).status, "revoked", "failure handling must not overwrite a concurrent withdrawal");
    assert.equal(await db.prepare("SELECT id FROM integration_secrets WHERE connection_id=?").bind(removedPending.connectionId).first(), null);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.__vanteloqEnv = originalEnv;
    await mf.dispose();
    await new Promise(resolve => authServer.close(resolve));
  }
});
