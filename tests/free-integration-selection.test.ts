import assert from "node:assert/strict";
import test from "node:test";
import { Miniflare } from "miniflare";
import { readFile } from "node:fs/promises";
import { cleanupFreeSelections, releaseIntegrationSelectionIfUnused, requireFreeIntegrationSelection, reserveFreeIntegration, requireIntegrationCallbackAccess, requireIntegrationProviderAccess, subscriptionAllowsFreeFallback, integrationRequestConnectionId } from "../server/integrations/free-selection.ts";
import type { AccessContext } from "../server/authorization.ts";
import type { VanteloqRuntimeEnv } from "../db/index.ts";

async function fixture(run: (database: D1Database) => Promise<void>) {
  const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('ok')}}", d1Databases: { DB: crypto.randomUUID() } });
  try {
    const database = await mf.getD1Database("DB") as unknown as D1Database;
    for (const sql of [
      "CREATE TABLE workspaces(id TEXT PRIMARY KEY)",
      "CREATE TABLE integration_connections(id TEXT PRIMARY KEY, organization_id TEXT, provider TEXT, status TEXT, updated_at INTEGER, data_promotion_status TEXT, promotion_authorized_at INTEGER, last_error_code TEXT)",
      "CREATE TABLE integration_secrets(connection_id TEXT, organization_id TEXT, provider TEXT)",
      "CREATE TABLE integration_oauth_states(connection_id TEXT, organization_id TEXT, provider TEXT, expires_at INTEGER, consumed_at INTEGER)",
    ]) await database.prepare(sql).run();
    for (const sql of (await readFile(new URL("../drizzle/0074_blue_lucky_pierre.sql", import.meta.url), "utf8")).split("--> statement-breakpoint")) {
      if (sql.trim()) await database.prepare(sql.trim()).run();
    }
    await database.prepare("INSERT INTO workspaces(id) VALUES ('one'),('two')").run();
    await run(database);
  } finally { await mf.dispose(); }
}

test("provider reservations cap concurrent distinct selections, renew at capacity, and isolate tenants", async () => fixture(async database => {
  const now = 10_000;
  const attempts = await Promise.allSettled(["square", "slack", "lightspeed-r", "plaid"].map(provider => reserveFreeIntegration(database, "one", provider, now)));
  assert.equal(attempts.filter(result => result.status === "fulfilled").length, 2);
  for (const result of attempts.filter(result => result.status === "rejected")) assert.equal((result as PromiseRejectedResult).reason.code, "FREE_INTEGRATION_LIMIT");
  const selected = (await database.prepare("SELECT provider,grant_id FROM free_integration_selections WHERE organization_id='one'").all<{provider:string;grant_id:string}>()).results!;
  const renewed = await reserveFreeIntegration(database, "one", selected[0].provider, now + 500);
  assert.equal(renewed, selected[0].grant_id);
  assert.equal((await database.prepare("SELECT expires_at FROM free_integration_selections WHERE organization_id='one' AND provider=?").bind(selected[0].provider).first<{expires_at:number}>())?.expires_at, now + 1100);
  await reserveFreeIntegration(database, "two", "square", now);
  for (const provider of ["unknown", "xero", "doordash", "uber-eats"]) {
    await assert.rejects(reserveFreeIntegration(database, "two", provider, now), { code: "INTEGRATION_PROVIDER_UNAVAILABLE" });
  }
  assert.equal((await database.prepare("SELECT COUNT(*) total FROM free_integration_selections WHERE organization_id='two'").first<{total:number}>())?.total, 1);
}));

test("cleanup revokes abandoned Free attempts before releasing, while retaining live attempts and tokens", async () => fixture(async database => {
  const now = 20_000;
  async function seed(provider: string, status: string, updated: number, options: {expires?:number; consumed?:number; token?:boolean} = {}) {
    const id = provider;
    await database.prepare("INSERT INTO free_integration_selections VALUES ('one',?,?,?,?)").bind(provider, id, now - 2000, now - 100).run();
    await database.prepare("INSERT INTO integration_connections(id,organization_id,provider,status,updated_at,free_grant_id) VALUES (?,'one',?,?,?,?)").bind(id, provider, status, updated, id).run();
    if (options.expires !== undefined) await database.prepare("INSERT INTO integration_oauth_states VALUES (?,'one',?,?,?)").bind(id, provider, options.expires, options.consumed ?? null).run();
    if (options.token) await database.prepare("INSERT INTO integration_secrets VALUES (?,'one',?)").bind(id, provider).run();
  }
  await seed("abandoned", "pending", now - 2000, { expires: now - 1000 });
  await seed("failed", "error", now - 100);
  await seed("valid", "pending", now - 2000, { expires: now + 10 });
  await seed("exchanging", "pending", now - 2000, { expires: now - 1, consumed: now - 10 });
  await seed("creating", "pending", now - 10);
  await seed("repairable", "error", now - 2000, { token: true });
  await seed("connected", "connected", now - 2000);
  await cleanupFreeSelections(database, "one", now);
  const rows = (await database.prepare("SELECT provider FROM free_integration_selections ORDER BY provider").all<{provider:string}>()).results!;
  assert.deepEqual(rows.map(row => row.provider), ["connected", "creating", "exchanging", "repairable", "valid"]);
  for (const provider of ["abandoned", "failed"]) {
    assert.equal((await database.prepare("SELECT status FROM integration_connections WHERE id=?").bind(provider).first<{status:string}>())?.status, "revoked");
  }
  await cleanupFreeSelections(database, "one", now + 601);
  assert.deepEqual((await database.prepare("SELECT provider FROM free_integration_selections ORDER BY provider").all<{provider:string}>()).results?.map(row => row.provider), ["connected", "repairable"]);
}));

test("disconnect releases only the final provider account and rejects an old generation after reselection", async () => fixture(async database => {
  const now = 30_000;
  const oldGrant = await reserveFreeIntegration(database, "one", "square", now);
  for (const id of ["first", "second"]) await database.prepare("INSERT INTO integration_connections(id,organization_id,provider,status,updated_at,free_grant_id) VALUES (?,'one','square','connected',?,?)").bind(id, now, oldGrant).run();
  await database.prepare("UPDATE integration_connections SET status='revoked' WHERE id='first'").run();
  await releaseIntegrationSelectionIfUnused("one", "square", database, now);
  assert.equal(await requireFreeIntegrationSelection("one", "square", "second", database), oldGrant);
  await assert.rejects(requireFreeIntegrationSelection("one", "square", "foreign", database), { code: "FREE_INTEGRATION_SELECTION_CHANGED" });
  await database.prepare("UPDATE integration_connections SET status='revoked' WHERE id='second'").run();
  await releaseIntegrationSelectionIfUnused("one", "square", database, now);
  await assert.rejects(requireFreeIntegrationSelection("one", "square", undefined, database), { code: "FREE_INTEGRATION_SELECTION_REQUIRED" });
  const nextGrant = await reserveFreeIntegration(database, "one", "square", now + 1);
  assert.notEqual(nextGrant, oldGrant);
  await assert.rejects(requireFreeIntegrationSelection("one", "square", "first", database), { code: "FREE_INTEGRATION_SELECTION_CHANGED" });
  await assert.rejects(requireFreeIntegrationSelection("two", "square", "second", database), { code: "FREE_INTEGRATION_SELECTION_REQUIRED" });
}));

test("callback continuation preserves verified internal authorization without weakening fresh HTTP MFA", async () => fixture(async database => {
  await database.prepare("CREATE TABLE internal_access(user_id TEXT,organization_id TEXT,access_level TEXT,active INTEGER,mfa_required INTEGER)").run();
  await database.prepare("INSERT INTO internal_access VALUES ('owner','one','founder',1,1)").run();
  const runtime = globalThis as typeof globalThis & {__vanteloqEnv?:VanteloqRuntimeEnv};
  const before = runtime.__vanteloqEnv;
  runtime.__vanteloqEnv = { DB: database, VANTELOQ_INTERNAL_ACCESS_ENABLED: "true" };
  const context = { userId: "owner", organizationId: "one", role: "owner", authSubject: "subject", authProvider: "supabase",
    identity: { provider: "supabase", subject: "subject", email: "owner@example.test", emailVerified: true, assuranceLevel: null, sessionId: null, displayName: "Owner" }, organization: {} } as AccessContext;
  try {
    await requireIntegrationCallbackAccess(context, "square", "recorded-pending-connection");
    await assert.rejects(requireIntegrationProviderAccess(context, "square"), { code: "MFA_REQUIRED_FOR_INTERNAL_ACCESS" });
  } finally { runtime.__vanteloqEnv = before; }
}));

test("Free fallback excludes billing recovery states and expired paid trials", () => {
  for (const status of [null, undefined, "canceled", "incomplete_expired"]) assert.equal(subscriptionAllowsFreeFallback(status), true);
  for (const status of ["active", "trialing", "past_due", "unpaid", "paused", "incomplete"]) assert.equal(subscriptionAllowsFreeFallback(status), false);
});

test("connection IDs are checked from bounded request copies without consuming route input", async () => {
  const request = new Request("https://vanteloq.test/api/v1/integrations/square/sync", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ connectionId: "selected-account", sample: true }),
  });
  assert.equal(await integrationRequestConnectionId(request), "selected-account");
  assert.deepEqual(await request.json(), { connectionId: "selected-account", sample: true });
  assert.equal(await integrationRequestConnectionId(new Request("https://vanteloq.test/?connection=owned-account")), "owned-account");
  assert.equal(await integrationRequestConnectionId(new Request("https://vanteloq.test/?connectionId=other-owned-account")), "other-owned-account");
  assert.equal(await integrationRequestConnectionId(new Request("https://vanteloq.test/", { method: "POST" })), undefined);
  await assert.rejects(integrationRequestConnectionId(new Request("https://vanteloq.test/", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ connectionId: "a".repeat(33_000) }),
  })), { status: 413 });
});
