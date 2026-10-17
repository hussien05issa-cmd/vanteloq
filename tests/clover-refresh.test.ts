import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { VanteloqRuntimeEnv } from "../db";
import { decryptCloverSecret, encryptCloverSecret, fetchCloverCollection, fetchCloverConnectionCollection, saveCloverTokens } from "../server/integrations/clover";

let sqlite: DatabaseSync;
let db: D1Database;
const globals = globalThis as typeof globalThis & { __vanteloqEnv?: VanteloqRuntimeEnv };
const originalEnv = globals.__vanteloqEnv;
const seconds = () => Math.floor(Date.now() / 1_000);
before(async () => {
  sqlite = new DatabaseSync(":memory:");
  // D1-shaped transport backed by real SQLite, not a simulated SQL matcher.
  function prepare(sql: string, values: Array<string | number | null> = []): D1PreparedStatement {
    const statement = sqlite.prepare(sql);
    return {
      bind: (...bindings: Array<string | number | null>) => prepare(sql, bindings),
      run: async () => ({ success: true, results: [], meta: { changes: Number(statement.run(...values).changes) } }),
      first: async () => statement.get(...values) ?? null,
      all: async () => ({ success: true, results: statement.all(...values), meta: {} }),
      raw: async () => statement.all(...values).map(row => Object.values(row)),
    } as unknown as D1PreparedStatement;
  }
  db = { prepare, batch: async (statements: D1PreparedStatement[]) => {
    sqlite.exec("BEGIN");
    try { const result = []; for (const statement of statements) result.push(await statement.run()); sqlite.exec("COMMIT"); return result; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } } as unknown as D1Database;
  // Actual SQLite claims and conditional writes, restricted to the grant tables
  // needed by this test. No provider or hosted database is contacted.
  await db.prepare(`CREATE TABLE integration_connections (
    id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, provider TEXT NOT NULL,
    status TEXT NOT NULL, source_namespace TEXT, external_account_ref TEXT,
    sync_version INTEGER NOT NULL, sync_lease_owner TEXT, sync_lease_expires_at INTEGER,
    updated_at INTEGER NOT NULL
  )`).run();
  await db.prepare(`CREATE TABLE integration_secrets (
    id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, provider TEXT NOT NULL,
    connection_id TEXT NOT NULL UNIQUE, access_token_ciphertext TEXT NOT NULL,
    refresh_token_ciphertext TEXT NOT NULL, token_expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`).run();
  globals.__vanteloqEnv = { DB: db, CLOVER_CLIENT_ID: "fixture-app", CLOVER_CLIENT_SECRET: "fixture-secret",
    CLOVER_REDIRECT_URI: "https://fixture.invalid/callback", CLOVER_ENV: "sandbox",
    INTEGRATION_ENCRYPTION_KEY: Buffer.from(Uint8Array.from({ length: 32 }, (_, index) => index + 1)).toString("base64") };
});
after(() => { globals.__vanteloqEnv = originalEnv; sqlite?.close(); });

async function fixture(status = "connected", fresh = false) {
  const organizationId = crypto.randomUUID(), connectionId = crypto.randomUUID(), merchantId = `m-${crypto.randomUUID()}`;
  await db.prepare(`INSERT INTO integration_connections
    (id,organization_id,provider,status,source_namespace,external_account_ref,sync_version,sync_lease_owner,sync_lease_expires_at,updated_at)
    VALUES (?,?,'clover',?,?,?,7,?,?,?)`).bind(connectionId, organizationId, status,
    `grant:${connectionId}`, merchantId, `lease:${connectionId}`, seconds() + 300, seconds()).run();
  await saveCloverTokens(organizationId, connectionId, { accessToken: "old-access", refreshToken: "single-use-refresh",
    accessTokenExpiresAt: new Date(Date.now() + (fresh ? 1_800_000 : -1_000)), refreshTokenExpiresAt: null });
  return { organizationId, connectionId, merchantId };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function read(ctx: Fixture, fetcher: typeof fetch, resource: "orders" | "payments" | "items" | "customers" = "orders") {
  return fetchCloverConnectionCollection(ctx.organizationId, ctx.connectionId, ctx.merchantId, resource, {}, fetcher);
}
function replacement() {
  return Response.json({ access_token: "new-access", refresh_token: "new-refresh",
    access_token_expiration: seconds() + 1_800, refresh_token_expiration: seconds() + 86_400 });
}
const saved = (ctx: Fixture) => db.prepare("SELECT * FROM integration_secrets WHERE connection_id=?").bind(ctx.connectionId).first<Record<string, unknown>>();
function provider(onRefresh: () => Promise<Response> = async () => replacement()) {
  let exchanges = 0, reads = 0;
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://apisandbox.dev.clover.com");
    if (url.pathname === "/oauth/v2/refresh") {
      exchanges++;
      assert.equal(init?.redirect, "manual");
      assert.deepEqual(JSON.parse(String(init?.body)), { client_id: "fixture-app", refresh_token: "single-use-refresh" });
      return onRefresh();
    }
    reads++;
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer new-access");
    return Response.json({ elements: [] });
  }) as typeof fetch;
  return { fetcher, exchanges: () => exchanges, reads: () => reads };
}

test("parallel Clover collection reads exchange the single-use token once and persist its replacement pair", async () => {
  const ctx = await fixture(), mock = provider();
  await Promise.all((["orders", "items", "customers", "payments"] as const).map(resource => read(ctx, mock.fetcher, resource)));
  assert.equal(mock.exchanges(), 1); assert.equal(mock.reads(), 4);
  const row = await saved(ctx);
  assert.equal(await decryptCloverSecret(String(row?.access_token_ciphertext)), "new-access");
  assert.equal(await decryptCloverSecret(String(row?.refresh_token_ciphertext)), "new-refresh");
  await read(ctx, mock.fetcher);
  assert.equal(mock.exchanges(), 1, "the persisted fresh pair is reused after the single-flight ends");
});

test("a separate module isolate cannot exchange a durable claimed refresh grant", async () => {
  const ctx = await fixture();
  let entered!: () => void, finish!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const mock = provider(async () => { entered(); await gate; return replacement(); });
  const first = read(ctx, mock.fetcher);
  await started;
  // Separate module state models another worker isolate sharing the same D1.
  const other = await import(`../server/integrations/clover.ts?refresh-isolate=${crypto.randomUUID()}`);
  try {
    await assert.rejects(() => other.fetchCloverConnectionCollection(ctx.organizationId, ctx.connectionId, ctx.merchantId, "orders", {}, mock.fetcher),
      (error: unknown) => (error as { code?: string }).code === "CLOVER_REFRESH_RECOVERY_REQUIRED");
    assert.equal(mock.exchanges(), 1);
  } finally { finish(); await first; }
});

test("disconnect during provider refresh cannot recreate a deleted secret or expose the new token", async () => {
  const ctx = await fixture();
  const mock = provider(async () => {
    await db.batch([db.prepare("DELETE FROM integration_secrets WHERE connection_id=?").bind(ctx.connectionId),
      db.prepare("UPDATE integration_connections SET status='revoked' WHERE id=?").bind(ctx.connectionId)]);
    return replacement();
  });
  await assert.rejects(() => read(ctx, mock.fetcher), (error: unknown) => (error as { code?: string }).code === "CLOVER_GRANT_CHANGED");
  assert.equal(await saved(ctx), null); assert.equal(mock.reads(), 0);
});

test("a newer operation generation fences a late refresh response", async () => {
  const ctx = await fixture();
  const mock = provider(async () => {
    await db.prepare("UPDATE integration_connections SET sync_version=sync_version+1 WHERE id=?").bind(ctx.connectionId).run();
    return replacement();
  });
  await assert.rejects(() => read(ctx, mock.fetcher), (error: unknown) => (error as { code?: string }).code === "CLOVER_GRANT_CHANGED");
  const row = await saved(ctx);
  assert.equal(await decryptCloverSecret(String(row?.access_token_ciphertext)), "old-access");
  assert.match(String(row?.refresh_token_ciphertext), /^clover-refresh:/); assert.equal(mock.reads(), 0);
});

test("a replacement authorization is not overwritten by an older refresh response", async () => {
  const ctx = await fixture();
  const access = await encryptCloverSecret("reconnected-access"), refresh = await encryptCloverSecret("reconnected-refresh");
  const mock = provider(async () => {
    await db.prepare("UPDATE integration_secrets SET access_token_ciphertext=?,refresh_token_ciphertext=? WHERE connection_id=?")
      .bind(access, refresh, ctx.connectionId).run();
    return replacement();
  });
  await assert.rejects(() => read(ctx, mock.fetcher), (error: unknown) => (error as { code?: string }).code === "CLOVER_GRANT_CHANGED");
  const row = await saved(ctx);
  assert.equal(row?.access_token_ciphertext, access); assert.equal(row?.refresh_token_ciphertext, refresh); assert.equal(mock.reads(), 0);
});

test("a lost lease or changed connected status prevents refresh persistence", async () => {
  for (const mutation of ["sync_lease_expires_at=1", "status='revoked'"]) {
    const ctx = await fixture();
    const mock = provider(async () => { await db.prepare(`UPDATE integration_connections SET ${mutation} WHERE id=?`).bind(ctx.connectionId).run(); return replacement(); });
    await assert.rejects(() => read(ctx, mock.fetcher), (error: unknown) => (error as { code?: string }).code === "CLOVER_GRANT_CHANGED");
    assert.equal(await decryptCloverSecret(String((await saved(ctx))?.access_token_ciphertext)), "old-access");
    assert.equal(mock.reads(), 0);
  }
});

test("an ambiguous refresh failure never retries the possibly consumed token", async () => {
  const ctx = await fixture(), mock = provider(async () => { throw new Error("fixture interrupted exchange"); });
  await assert.rejects(() => read(ctx, mock.fetcher), /fixture interrupted exchange/);
  await assert.rejects(() => read(ctx, mock.fetcher), (error: unknown) => (error as { code?: string }).code === "CLOVER_REFRESH_RECOVERY_REQUIRED");
  assert.equal(mock.exchanges(), 1); assert.equal(mock.reads(), 0);
});

test("tenant mismatch and revoked grants cannot read or exchange stored tokens; fresh pending callback still works", async () => {
  const ctx = await fixture(), mock = provider();
  await assert.rejects(() => read({ ...ctx, organizationId: crypto.randomUUID() }, mock.fetcher), /Authorize a Clover merchant/);
  await db.prepare("UPDATE integration_connections SET status='revoked' WHERE id=?").bind(ctx.connectionId).run();
  await assert.rejects(() => read(ctx, mock.fetcher), /Authorize a Clover merchant/);
  assert.equal(mock.exchanges(), 0); assert.equal(mock.reads(), 0);
  const pending = await fixture("pending", true);
  await read(pending, (async (_input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer old-access");
    return Response.json({ elements: [] });
  }) as typeof fetch);
});

test("credential-bearing Clover collection reads reject redirects without following their destination", async () => {
  let requests = 0;
  await assert.rejects(() => fetchCloverCollection("merchant-1", "fixture-access", "/v3/merchants/merchant-1/orders", {},
    (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests++;
      assert.equal(new URL(String(input)).origin, "https://apisandbox.dev.clover.com");
      assert.equal(init?.redirect, "manual");
      return new Response(null, { status: 302, headers: { Location: "https://untrusted.invalid/collect" } });
    }) as typeof fetch), (error: unknown) => (error as { code?: string }).code === "CLOVER_PROVIDER_REDIRECT");
  assert.equal(requests, 1);
});
