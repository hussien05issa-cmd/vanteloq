import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import type { VanteloqRuntimeEnv } from "../db";
import { GET as status, POST as refresh } from "../app/api/v1/integrations/slack/messages/route";
import { GET as connectionStatus } from "../app/api/v1/integrations/slack/status/route";
import { POST as authorize } from "../app/api/v1/integrations/slack/authorize/route";
import { GET as callback } from "../app/api/v1/integrations/slack/callback/route";
import { encryptSlackCredentials, encryptedSlackNoRefreshToken, SLACK_CONVERSATION_SCOPES } from "../server/integrations/slack";
import { SLACK_CONVERSATION_READ_NOTICE_VERSION } from "../domain/slack-conversations";
import { providerPrivacyAcceptance } from "../domain/provider-privacy";
import { activateTestSubscription } from "./helpers/subscription-fixture.mjs";

let runtime: Miniflare, database: D1Database;
const globals = globalThis as typeof globalThis & { __vanteloqEnv?: VanteloqRuntimeEnv };
const originalEnv = globals.__vanteloqEnv, originalFetch = globalThis.fetch;
const identities = new Map<string, { subject: string; email: string }>();
let provider: typeof fetch = async () => { throw Error("Unexpected provider call"); };
before(async () => {
  runtime = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('isolated')}}", d1Databases: { DB: crypto.randomUUID() } });
  database = await runtime.getD1Database("DB") as unknown as D1Database;
  for (const file of (await readdir("drizzle")).filter(file => /^\d{4}.*\.sql$/.test(file)).sort()) {
    for (const sql of (await readFile(`drizzle/${file}`, "utf8")).split("--> statement-breakpoint").filter(text => text.trim())) await database.prepare(sql).run();
  }
  globals.__vanteloqEnv = { DB: database, SUPABASE_URL: "https://fixture.supabase.co", SUPABASE_PUBLISHABLE_KEY: "fictional-key",
    SLACK_CLIENT_ID: "fixture-client", SLACK_CLIENT_SECRET: "fixture-secret", SLACK_REDIRECT_URI: "https://vanteloq.example/api/v1/integrations/slack/callback",
    INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString("base64") };
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "fixture.supabase.co") {
      const token = new Headers(init?.headers).get("authorization")!.split(".")[1]!;
      const email = JSON.parse(Buffer.from(token, "base64url").toString()).email;
      const identity = identities.get(email)!;
      return Response.json({ id: identity.subject, email, email_confirmed_at: "2026-01-01", user_metadata: { full_name: "Fixture owner" } });
    }
    return provider(input, init);
  }) as typeof fetch;
}, { timeout: 120_000 });
after(async () => { globalThis.fetch = originalFetch; globals.__vanteloqEnv = originalEnv; await runtime?.dispose(); });

async function fixture(connected = true, reads = true) {
  const userId = crypto.randomUUID(), organizationId = crypto.randomUUID(), connectionId = crypto.randomUUID();
  const subject = `fixture:${userId}`, email = `${userId}@example.invalid`, teamId = "T" + organizationId.replaceAll("-", ""), channelId = "C" + connectionId.replaceAll("-", "");
  identities.set(email, { subject, email });
  await database.batch([
    database.prepare("INSERT INTO workspaces(id,owner_name,business_name,legal_name,business_email,industry,city,address,postal_code,hours_json,created_at,updated_at) VALUES (?,'Fixture','Fixture','Fixture',?,'Retail','Edmonton','Test','T5A1A1','[]',1,1)").bind(organizationId, email),
    database.prepare("INSERT INTO users(id,email,auth_subject,auth_provider,display_name,status,created_at,updated_at) VALUES (?,?,?,'supabase','Fixture owner','active',1,1)").bind(userId, email, subject),
    database.prepare("INSERT INTO memberships(id,organization_id,user_id,role,status,created_at,updated_at) VALUES (?,?,?,'owner','active',1,1)").bind(crypto.randomUUID(), organizationId, userId),
  ]);
  await activateTestSubscription(database, organizationId);
  const webhookUrl = "https://hooks.slack.com/services/fixtureteam/fixturechannel/fictionalcredential";
  if (connected) {
    await database.prepare("INSERT INTO integration_connections(id,organization_id,provider,status,source_namespace,external_account_ref,external_account_name,domain_prefix,scopes_json,data_promotion_status,created_at,updated_at) VALUES (?,?,'slack','connected',?,?,'Fixture · #selected-public',?,?,'blocked',1,1)")
      .bind(connectionId, organizationId, connectionId, teamId, channelId, JSON.stringify(reads ? SLACK_CONVERSATION_SCOPES : ["incoming-webhook"])).run();
    const access = await encryptSlackCredentials({ version: 1, accessToken: "xoxb-fictional-token", teamId, channelId, webhookUrl,
      ...(reads ? { conversationRead: { version: 1 as const, enabled: true as const, noticeVersion: SLACK_CONVERSATION_READ_NOTICE_VERSION, authorizedByUserId: userId, nextReadAt: 0 } } : {}) });
    await database.prepare("INSERT INTO integration_secrets(id,organization_id,provider,connection_id,access_token_ciphertext,refresh_token_ciphertext,token_expires_at,created_at,updated_at) VALUES (?,?,'slack',?,?,?,4070908800,1,1)")
      .bind(crypto.randomUUID(), organizationId, connectionId, access, await encryptedSlackNoRefreshToken()).run();
  }
  return { userId, organizationId, connectionId, email, teamId, channelId, webhookUrl };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function request(ctx: Fixture, method = "GET", body?: Record<string, unknown>, path = "/api/v1/integrations/slack/messages") {
  const token = Buffer.from(JSON.stringify({ email: ctx.email, aal: "aal2", session_id: `fixture-session:${ctx.userId}` })).toString("base64url");
  return new Request(`https://vanteloq.example${path}`, { method, headers: { Authorization: `Bearer test.${token}.signature`,
    ...(method === "GET" ? {} : { Origin: "https://vanteloq.example", "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" }) }, body: body ? JSON.stringify(body) : undefined });
}
const publicChannel = (ctx: Fixture) => ({ id: ctx.channelId, context_team_id: ctx.teamId, name: "selected-public", is_channel: true,
  is_private: false, is_member: true, is_archived: false, is_shared: false });
const consent = { ...providerPrivacyAcceptance(true), mode: "single_channel_conversations", slackConversationReadAccepted: true,
  slackConversationReadNoticeVersion: SLACK_CONVERSATION_READ_NOTICE_VERSION };

test("owner API exposes metadata without Slack calls and refreshes only ephemeral selected-channel parents", async () => {
  const ctx = await fixture(), calls: URL[] = [];
  provider = (async input => {
    const url = new URL(String(input)); calls.push(url);
    assert.equal(url.searchParams.get("channel"), ctx.channelId);
    return Response.json(url.pathname.endsWith("info") ? { ok: true, channel: publicChannel(ctx) }
      : { ok: true, messages: [{ type: "message", user: "UFIXTURE", ts: "1760000000.000001", text: "Fictional imported message", files: [{ secret: "excluded-file" }] }], has_more: true });
  }) as typeof fetch;
  const metadata = await status(request(ctx)); assert.equal(metadata.status, 200, await metadata.clone().text());
  assert.equal((await metadata.json()).readsMessages, true); assert.equal(calls.length, 0);
  const capabilities = await connectionStatus(request(ctx, "GET", undefined, "/api/v1/integrations/slack/status"));
  assert.equal(capabilities.status, 200); const capability = await capabilities.json();
  assert.equal(capability.mode, "single_channel_conversations"); assert.equal(capability.leastPrivilege.readsMessages, true);
  assert.equal(capability.leastPrivilege.ownerOnlyConversationReads, true); assert.deepEqual(capability.leastPrivilege.requestedScopes, SLACK_CONVERSATION_SCOPES);
  assert.doesNotMatch(JSON.stringify(capability), /fictional-token|"conversationRead":|"messages":|webhookUrl/);
  const result = await refresh(request(ctx, "POST", { connectionId: ctx.connectionId, channel: "CFOREIGN", cursor: "ignored" }));
  assert.equal(result.status, 200, await result.clone().text()); const page = await result.json();
  assert.equal(page.messages[0].text, "Fictional imported message"); assert.equal(page.messages[0].authorId, "UFIXTURE");
  assert.equal(page.hasMore, true); assert.equal(calls.length, 2); assert.equal(calls[1]!.searchParams.get("limit"), "15");
  assert.equal(calls[1]!.searchParams.has("cursor"), false); assert.match(result.headers.get("cache-control")!, /no-store/);
  assert.doesNotMatch(JSON.stringify(page), /excluded-file|xoxb-|webhookUrl|accessToken/);
  assert.equal((await database.prepare("SELECT COUNT(*) AS count FROM collaboration_messages WHERE organization_id=?").bind(ctx.organizationId).first<{ count: number }>())?.count, 0);
  const audits = await database.prepare("SELECT details_json FROM audit_events WHERE organization_id=?").bind(ctx.organizationId).all();
  assert.doesNotMatch(JSON.stringify(audits.results), /Fictional imported message|excluded-file|xoxb-/);
  const again = await refresh(request(ctx, "POST", { connectionId: ctx.connectionId })); assert.equal(again.status, 429); assert.equal(calls.length, 2);
  assert.ok((await again.json()).nextReadAt); assert.ok(Number(again.headers.get("retry-after")) > 0);
});

test("nonowners, another tenant, missing opt-in and cross-origin requests cannot read Slack", async () => {
  const ctx = await fixture(), foreign = await fixture(), legacy = await fixture(true, false); let calls = 0;
  provider = (async () => { calls++; throw Error("Provider must not be contacted"); }) as typeof fetch;
  assert.equal((await refresh(request(foreign, "POST", { connectionId: ctx.connectionId }))).status, 404);
  assert.equal((await refresh(request(legacy, "POST", { connectionId: legacy.connectionId }))).status, 409);
  assert.equal((await (await status(request(legacy))).json()).requiresReconnect, true);
  const legacyCapabilities = await (await connectionStatus(request(legacy, "GET", undefined, "/api/v1/integrations/slack/status"))).json();
  assert.equal(legacyCapabilities.mode, "single_channel_notifications"); assert.equal(legacyCapabilities.leastPrivilege.readsMessages, false);
  for (const role of ["admin", "manager", "employee", "read_only"]) {
    await database.prepare("UPDATE memberships SET role=? WHERE user_id=? AND organization_id=?").bind(role, ctx.userId, ctx.organizationId).run();
    assert.equal((await status(request(ctx))).status, 403, role);
    assert.equal((await refresh(request(ctx, "POST", { connectionId: ctx.connectionId }))).status, 403, role);
  }
  const crossOrigin = request(foreign, "POST", { connectionId: foreign.connectionId }); crossOrigin.headers.set("origin", "https://evil.invalid");
  assert.equal((await refresh(crossOrigin)).status, 403); assert.equal(calls, 0);
});

test("read authorization binds explicit current owner consent to pending scopes and never disconnects a current grant", async () => {
  const ctx = await fixture(false), existing = await fixture();
  const withoutConsent = await authorize(request(ctx, "POST", { ...consent, slackConversationReadAccepted: false }, "/api/v1/integrations/slack/authorize"));
  assert.equal(withoutConsent.status, 400); assert.equal((await withoutConsent.json()).error.code, "SLACK_CONVERSATION_CONSENT_REQUIRED");
  const accepted = await authorize(request(ctx, "POST", consent, "/api/v1/integrations/slack/authorize")); assert.equal(accepted.status, 200, await accepted.clone().text());
  const body = await accepted.json(); assert.equal(body.mode, "single_channel_conversations"); assert.deepEqual(body.scopes, SLACK_CONVERSATION_SCOPES);
  const pending = await database.prepare("SELECT scopes_json,status FROM integration_connections WHERE id=? AND organization_id=?").bind(body.connectionId, ctx.organizationId).first();
  assert.equal(pending?.status, "pending"); assert.equal(pending?.scopes_json, JSON.stringify(SLACK_CONVERSATION_SCOPES));
  assert.equal((await authorize(request(existing, "POST", consent, "/api/v1/integrations/slack/authorize"))).status, 409);
  assert.equal((await database.prepare("SELECT status FROM integration_connections WHERE id=?").bind(existing.connectionId).first())?.status, "connected");
  const admin = await fixture(false); await database.prepare("UPDATE memberships SET role='admin' WHERE user_id=? AND organization_id=?").bind(admin.userId, admin.organizationId).run();
  assert.equal((await authorize(request(admin, "POST", consent, "/api/v1/integrations/slack/authorize"))).status, 403);
});

test("optional permission decline and owner demotion during callback cannot activate read credentials", async () => {
  for (const mutation of ["decline", "demote"] as const) {
    const ctx = await fixture(false);
    const authorization = await authorize(request(ctx, "POST", consent, "/api/v1/integrations/slack/authorize")); assert.equal(authorization.status, 200, await authorization.clone().text());
    const issued = await authorization.json(), state = new URL(issued.authorizationUrl).searchParams.get("state")!;
    provider = (async input => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("oauth.v2.access")) {
        if (mutation === "demote") await database.prepare("UPDATE memberships SET role='admin' WHERE user_id=? AND organization_id=?").bind(ctx.userId, ctx.organizationId).run();
        return Response.json({ ok: true, app_id: "AFIXTURE", access_token: "xoxb-fictional-token", token_type: "bot", scope: mutation === "decline" ? "incoming-webhook,channels:read" : SLACK_CONVERSATION_SCOPES.join(","),
          team: { id: ctx.teamId, name: "Fixture" }, incoming_webhook: { channel_id: ctx.channelId, channel: "selected-public", url: ctx.webhookUrl } });
      }
      return Response.json({ ok: true, channel: publicChannel(ctx) });
    }) as typeof fetch;
    const response = await callback(new Request(`https://vanteloq.example/api/v1/integrations/slack/callback?state=${state}&code=fictional-code`, { headers: { Cookie: authorization.headers.get("set-cookie")!.split(";")[0]! } }));
    assert.equal(response.status, mutation === "decline" ? 409 : 403, await response.clone().text());
    if (mutation === "decline") assert.equal((await response.json()).error.code, "SLACK_CONVERSATION_SCOPES_REQUIRED");
    assert.equal(await database.prepare("SELECT 1 FROM integration_secrets WHERE connection_id=? AND organization_id=?").bind(issued.connectionId, ctx.organizationId).first(), null);
  }
});

test("owner demotion during a successful history response prevents content in the API result", async () => {
  const ctx = await fixture();
  provider = (async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("info")) return Response.json({ ok: true, channel: publicChannel(ctx) });
    await database.prepare("UPDATE memberships SET role='admin' WHERE user_id=? AND organization_id=?").bind(ctx.userId, ctx.organizationId).run();
    return Response.json({ ok: true, messages: [{ type: "message", ts: "1760000000.000001", text: "Must not return after demotion" }] });
  }) as typeof fetch;
  const response = await refresh(request(ctx, "POST", { connectionId: ctx.connectionId })); assert.equal(response.status, 403, await response.clone().text());
  assert.doesNotMatch(await response.text(), /Must not return/);
});
