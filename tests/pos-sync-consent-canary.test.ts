import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { createHmac, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { eq } from "drizzle-orm";
import { getDb, type VanteloqRuntimeEnv } from "../db";
import { integrationSyncSchedules } from "../db/schema";
import { POST as configure } from "../app/api/v1/integrations/schedule/route";
import { POST as tick } from "../app/api/internal/pos-sync/route";
import { requireCurrentBackgroundSyncConsent, scheduledSyncContext, SYNC_AUTHORIZATION_VERSION } from "../server/integrations/sync-scheduler";
import { POS_SYNC_CONSENT_VERSION, POS_SYNC_PURPOSES, posSyncDataCategories } from "../domain/pos-sync-consent";
import { PRIVACY_POLICY_VERSION } from "../shared/legal-versions";
import { activateTestSubscription } from "./helpers/subscription-fixture.mjs";

const secret = "fixture-only-background-secret-32-characters";
const globals = globalThis as typeof globalThis & { __vanteloqEnv?: VanteloqRuntimeEnv };
const originalEnv = globals.__vanteloqEnv, originalFetch = globalThis.fetch;
const identities = new Map<string, { subject: string; email: string }>();
let runtime: Miniflare, database: D1Database, providerCalls = 0, storageCalls = 0;
before(async () => {
  runtime = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('isolated')}}", d1Databases: { DB: randomUUID() } });
  database = await runtime.getD1Database("DB") as unknown as D1Database;
  for (const file of (await readdir("drizzle")).filter(file => /^\d{4}.*\.sql$/.test(file)).sort()) {
    for (const sql of (await readFile(`drizzle/${file}`, "utf8")).split("--> statement-breakpoint").filter(text => text.trim())) await database.prepare(sql).run();
  }
  globals.__vanteloqEnv = { DB: database, POS_SYNC_SECRET: secret, SUPABASE_URL: "https://fixture.supabase.co", SUPABASE_PUBLISHABLE_KEY: "fictional-key",
    BUCKET: { delete: async () => { storageCalls++; throw new Error("Canary must not use storage"); } } as unknown as R2Bucket };
  globalThis.fetch = (async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname !== "fixture.supabase.co") { providerCalls++; throw new Error("No provider calls are authorized in this fixture"); }
    const token = new Headers(init?.headers).get("authorization")!.split(".")[1]!;
    const { email } = JSON.parse(Buffer.from(token, "base64url").toString());
    const identity = identities.get(email)!;
    return Response.json({ id: identity.subject, email, email_confirmed_at: "2026-01-01", user_metadata: { full_name: "Fixture owner" } });
  }) as typeof fetch;
}, { timeout: 120_000 });
after(async () => { globals.__vanteloqEnv = originalEnv; globalThis.fetch = originalFetch; await runtime?.dispose(); });

async function fixture() {
  const userId = randomUUID(), organizationId = randomUUID(), connectionId = randomUUID(), subject = `fixture:${userId}`, email = `${userId}@example.invalid`;
  identities.set(email, { subject, email });
  await database.batch([
    database.prepare("INSERT INTO workspaces(id,owner_name,business_name,legal_name,business_email,industry,city,address,postal_code,hours_json,created_at,updated_at) VALUES (?,'Fixture','Fixture','Fixture',?,'Retail','Edmonton','Test','T5A1A1','[]',1,1)").bind(organizationId, email),
    database.prepare("INSERT INTO users(id,email,auth_subject,auth_provider,display_name,status,created_at,updated_at) VALUES (?,?,?,'supabase','Fixture owner','active',1,1)").bind(userId, email, subject),
    database.prepare("INSERT INTO memberships(id,organization_id,user_id,role,status,created_at,updated_at) VALUES (?,?,?,'owner','active',1,1)").bind(randomUUID(), organizationId, userId),
    database.prepare("INSERT INTO organization_locations(id,organization_id,name,status,country_code,address_line_1,address_line_2,address_line_3,locality,district,administrative_area,postal_code,timezone,currency,locale,tax_jurisdiction,validation_status,created_at,updated_at) VALUES (?,?,'Primary','active','CA','1 Test Avenue','','','Edmonton','','AB','T5A 1A1','America/Edmonton','CAD','en-CA','','validated',1,1)").bind(randomUUID(), organizationId),
    database.prepare("INSERT INTO integration_connections(id,organization_id,provider,status,source_namespace,external_account_ref,created_at,updated_at) VALUES (?,?,'stripe','connected','production:fixture',?,1,1)").bind(connectionId, organizationId, connectionId),
  ]);
  await activateTestSubscription(database, organizationId);
  return { userId, organizationId, connectionId, email };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function setting(ctx: Fixture, fields: Record<string, unknown> = {}) {
  const token = Buffer.from(JSON.stringify({ email: ctx.email, aal: "aal2", session_id: `fixture-session:${ctx.userId}` })).toString("base64url");
  return new Request("https://vanteloq.example/api/v1/integrations/schedule", { method: "POST", headers: { Authorization: `Bearer test.${token}.signature`, Origin: "https://vanteloq.example", "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "stripe", connectionId: ctx.connectionId, enabled: true, authorizationVersion: SYNC_AUTHORIZATION_VERSION, ...fields }) });
}
function signed(body = '{"mode":"inspect"}', nonce = randomUUID(), timestamp = String(Math.floor(Date.now() / 1000)), signedBody = body) {
  return new Request("https://vanteloq.example/api/internal/pos-sync", { method: "POST", headers: { "Content-Type": "application/json", "x-vanteloq-sync-timestamp": timestamp, "x-vanteloq-sync-nonce": nonce,
    "x-vanteloq-sync-signature": createHmac("sha256", secret).update(`${timestamp}.${nonce}.${signedBody}`).digest("hex") }, body });
}
async function expect(response: Response, status: number) { assert.equal(response.status, status, await response.clone().text()); return response.json(); }
async function saveConsent(ctx: Fixture, changes: Record<string, unknown> = {}) {
  const record = { actor: ctx.userId, notice: POS_SYNC_CONSENT_VERSION, policy: PRIVACY_POLICY_VERSION, categories: JSON.stringify(posSyncDataCategories("stripe")), purposes: JSON.stringify(POS_SYNC_PURPOSES), ...changes };
  const id = randomUUID(), now = Math.floor(Date.now() / 1000);
  await database.prepare("INSERT INTO integration_consents(id,organization_id,actor_user_id,provider,status,notice_version,privacy_policy_version,data_categories_json,purposes_json,accepted_at,created_at,updated_at) VALUES (?,?,?,'stripe','accepted',?,?,?,?,?,?,?)")
    .bind(id, ctx.organizationId, record.actor, record.notice, record.policy, record.categories, record.purposes, now, now, now).run();
  return id;
}

test("signed inspection writes only replay nonce and metadata receipt, with no worker selection or maintenance", async () => {
  const ctx = await fixture();
  await expect(await configure(setting(ctx, { consentAccepted: true, consentNoticeVersion: POS_SYNC_CONSENT_VERSION })), 200);
  const scheduleBefore = await database.prepare("SELECT * FROM integration_sync_schedules WHERE connection_id=?").bind(ctx.connectionId).first();
  await database.prepare("INSERT INTO integration_sync_ticks(id,created_at) VALUES ('old-replay-fixture',1)").run();
  const previous = globals.__vanteloqEnv!;
  const statements: string[] = [];
  const guarded = new Proxy(database, { get(target, property) {
    if (property === "prepare") return (sql: string) => {
      statements.push(sql);
      assert.match(sql, /^insert\s+(?:or\s+ignore\s+)?into\s+["`]?\s*(integration_sync_ticks|audit_events)/i, "Inspection must not query jobs, cleanup, messages, or maintenance tables");
      return target.prepare(sql);
    };
    const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
  } });
  globals.__vanteloqEnv = { ...previous, DB: guarded };
  const request = signed(), nonce = request.headers.get("x-vanteloq-sync-nonce");
  try {
    const result = await expect(await tick(request.clone()), 200);
    assert.deepEqual(result, { accepted: true, mode: "inspect", actionsStarted: false, tickId: nonce, checkedAt: result.checkedAt, processed: 0, counts: {} });
    assert.equal(new Date(result.checkedAt).toISOString(), result.checkedAt);
    assert.equal((await expect(await tick(request.clone()), 409)).error.code, "SYNC_REPLAY_REJECTED");
  } finally { globals.__vanteloqEnv = previous; }
  assert.equal(statements.length, 3, "One nonce and receipt insert, then one duplicate nonce insert");
  assert.deepEqual(await database.prepare("SELECT * FROM integration_sync_schedules WHERE connection_id=?").bind(ctx.connectionId).first(), scheduleBefore);
  assert.ok(await database.prepare("SELECT id FROM integration_sync_ticks WHERE id='old-replay-fixture'").first(), "Inspection must not even prune old nonces");
  const receipt = await database.prepare("SELECT organization_id,actor_user_id,resource_id,details_json FROM audit_events WHERE action='integration.scheduler_inspected' AND resource_id=?").bind(nonce).first<{organization_id:string|null;actor_user_id:string|null;resource_id:string;details_json:string}>();
  assert.ok(receipt); assert.equal(receipt.organization_id, null); assert.equal(receipt.actor_user_id, null); assert.equal(receipt.resource_id, nonce);
  const details = JSON.parse(receipt.details_json); assert.deepEqual(Object.keys(details).sort(), ["actionsStarted", "checkedAt", "mode"]);
  assert.equal(providerCalls, 0); assert.equal(storageCalls, 0);
  await expect(await configure(setting(ctx, { enabled: false })), 200);
});

test("inspection retains exact-body signatures, clock bounds and rejects unknown modes before consuming nonces", async () => {
  const before = await database.prepare("SELECT COUNT(*) count FROM integration_sync_ticks").first<{count:number}>();
  await expect(await tick(new Request("https://vanteloq.example/api/internal/pos-sync", { method: "POST", body: '{"mode":"inspect"}' })), 401);
  await expect(await tick(signed('{"mode":"inspect"}', randomUUID(), String(Math.floor(Date.now() / 1000) - 91))), 401);
  await expect(await tick(signed("{}", randomUUID(), undefined, '{"mode":"inspect"}')), 401);
  for (const body of ['{"mode":"execute"}', '{"mode":"inspect","connectionId":"foreign"}', '{"mode":"inspect","provider":"stripe"}', '{ "mode": "inspect" }']) {
    assert.equal((await expect(await tick(signed(body)), 400)).error.code, "SYNC_BODY_INVALID");
  }
  await expect(await tick(signed("x".repeat(129))), 413);
  assert.deepEqual(await database.prepare("SELECT COUNT(*) count FROM integration_sync_ticks").first(), before);
  assert.equal(providerCalls, 0); assert.equal(storageCalls, 0);
});

test("enabling and executing reuse only current background consent from the authorizing owner", async () => {
  const ctx = await fixture(), other = await fixture();
  for (const changes of [{ notice: "stripe-connect-v1" }, { notice: "pos-background-obsolete" }, { policy: "obsolete" }, { purposes: "[]" }, { categories: "[]" }, { actor: other.userId }]) {
    await database.prepare("DELETE FROM integration_consents WHERE organization_id=?").bind(ctx.organizationId).run();
    await saveConsent(ctx, changes);
    const denied = await expect(await configure(setting(ctx)), 403); assert.equal(denied.error.code, "INTEGRATION_CONSENT_REQUIRED");
    assert.equal((await database.prepare("SELECT COUNT(*) count FROM integration_sync_schedules WHERE organization_id=?").bind(ctx.organizationId).first<{count:number}>())!.count, 0);
  }
  await expect(await configure(setting(ctx, { consentAccepted: true, consentNoticeVersion: POS_SYNC_CONSENT_VERSION })), 200);
  await expect(await configure(setting(ctx)), 200);
  await expect(await configure(setting(ctx, { consentAccepted: true, consentNoticeVersion: "obsolete" })), 403);
  const scope = { organizationId: ctx.organizationId, actorUserId: ctx.userId, provider: "stripe" };
  await requireCurrentBackgroundSyncConsent(scope);
  // A generic connector receipt does not supersede a valid, separate background approval.
  await saveConsent(ctx, { notice: "stripe-connect-v1" }); await requireCurrentBackgroundSyncConsent(scope);
  const [schedule] = await getDb().select().from(integrationSyncSchedules).where(eq(integrationSyncSchedules.connectionId, ctx.connectionId));
  assert.equal((await scheduledSyncContext(schedule)).organizationId, ctx.organizationId);
  await database.prepare("UPDATE integration_consents SET privacy_policy_version='obsolete' WHERE organization_id=? AND notice_version=?").bind(ctx.organizationId, POS_SYNC_CONSENT_VERSION).run();
  await assert.rejects(() => scheduledSyncContext(schedule), { code: "INTEGRATION_CONSENT_REQUIRED" });
  const calls = providerCalls;
  const executed = await expect(await tick(signed("{}")), 200);
  assert.equal(executed.counts.attention, 1);
  assert.equal((await database.prepare("SELECT enabled,last_error_code FROM integration_sync_schedules WHERE connection_id=?").bind(ctx.connectionId).first<{enabled:number;last_error_code:string}>())!.enabled, 0);
  assert.equal(providerCalls, calls, "Obsolete consent stops before any provider request");
  await expect(await configure(setting(ctx, { consentAccepted: true, consentNoticeVersion: POS_SYNC_CONSENT_VERSION })), 200);
  await database.prepare("UPDATE integration_consents SET withdrawn_at=1 WHERE organization_id=? AND notice_version=?").bind(ctx.organizationId, POS_SYNC_CONSENT_VERSION).run();
  await assert.rejects(() => scheduledSyncContext(schedule), { code: "INTEGRATION_CONSENT_REQUIRED" });
  await expect(await configure(setting(ctx, { enabled: false })), 200);
});
