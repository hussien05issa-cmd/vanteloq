import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import type { VanteloqRuntimeEnv } from "../db";
import {
  acquireQuickBooksGrantLease, newQuickBooksGrantNamespace, quickBooksAccessToken,
  removeQuickBooksGrant, saveQuickBooksTokens, type QuickBooksToken,
} from "../server/integrations/quickbooks";
import { releaseIntegrationSyncLease } from "../server/integrations/connection";

let runtime: Miniflare;
let db: D1Database;
const globals = globalThis as typeof globalThis & { __vanteloqEnv?: VanteloqRuntimeEnv };
const originalEnv = globals.__vanteloqEnv;
const env: VanteloqRuntimeEnv = {
  QUICKBOOKS_CLIENT_ID: "quickbooks_fixture_client_123456", QUICKBOOKS_CLIENT_SECRET: "quickbooks_fixture_secret_123456",
  QUICKBOOKS_REDIRECT_URI: "https://vanteloq.example/api/v1/integrations/quickbooks/callback", QUICKBOOKS_ENV: "sandbox",
  INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
};
before(async () => {
  runtime = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('isolated')}}", d1Databases: { DB: crypto.randomUUID() } });
  db = await runtime.getD1Database("DB") as unknown as D1Database;
  for (const file of (await readdir("drizzle")).filter(file => /^\d{4}.*\.sql$/.test(file)).sort()) {
    for (const sql of (await readFile(`drizzle/${file}`, "utf8")).split("--> statement-breakpoint").filter(text => text.trim())) await db.prepare(sql).run();
  }
  globals.__vanteloqEnv = { ...env, DB: db };
}, { timeout: 120000 });
after(async () => { globals.__vanteloqEnv = originalEnv; await runtime?.dispose(); });

const token = (expired = false): QuickBooksToken => ({ accessToken: "fixture-access", refreshToken: "fixture-refresh",
  accessTokenExpiresAt: new Date(Date.now() + (expired ? -60_000 : 3_600_000)), refreshTokenExpiresAt: null,
  scopes: ["com.intuit.quickbooks.accounting"] });
async function fixture(expired = false, seedSecret = true) {
  const organizationId = crypto.randomUUID(), connectionId = crypto.randomUUID();
  const namespace = await newQuickBooksGrantNamespace(connectionId);
  await db.batch([
    db.prepare("INSERT INTO workspaces(id,owner_name,business_name,legal_name,business_email,industry,city,address,postal_code,hours_json,created_at,updated_at) VALUES (?,'Test','QuickBooks test','QuickBooks test',?,'Retail','Edmonton','Test','T5A1A1','[]',1,1)").bind(organizationId, `${organizationId}@example.invalid`),
    db.prepare("INSERT INTO integration_connections(id,organization_id,provider,status,external_account_ref,source_namespace,data_promotion_status,created_at,updated_at) VALUES (?,?,'quickbooks','connected',?,?,'staging',1,1)").bind(connectionId, organizationId, String(Math.floor(Math.random()*1e14)), namespace),
  ]);
  if (seedSecret) {
    const lease = await acquireQuickBooksGrantLease(organizationId, connectionId);
    try { await saveQuickBooksTokens(organizationId, connectionId, token(expired), namespace, lease); }
    finally { await releaseIntegrationSyncLease(lease); }
  }
  return { organizationId, connectionId, namespace };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const secret = (ctx: Fixture) => db.prepare("SELECT * FROM integration_secrets WHERE organization_id=? AND connection_id=?").bind(ctx.organizationId, ctx.connectionId).first();
const connection = (ctx: Fixture) => db.prepare("SELECT * FROM integration_connections WHERE organization_id=? AND id=?").bind(ctx.organizationId, ctx.connectionId).first();
const isCode = (code: string) => (error: unknown) => error instanceof Error && "code" in error && error.code === code;
const neverFetch = (async () => { throw Error("Provider must not be contacted"); }) as typeof fetch;
function pausedRefresh() {
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { entered = resolve; });
  let calls = 0;
  const fetcher = (async (input, init) => {
    calls++;
    assert.equal(String(input), "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer");
    assert.equal(init?.redirect, "error");
    assert.equal(new URLSearchParams(String(init?.body)).get("refresh_token"), "fixture-refresh");
    entered(); await gate;
    return Response.json({ access_token: "refreshed-access", refresh_token: "refreshed-refresh", expires_in: 3600 });
  }) as typeof fetch;
  return { fetcher, ready, release, calls: () => calls };
}

test("QuickBooks valid grants use second-based expiry and retain staging without tenant leakage", async () => {
  const first = await fixture(), second = await fixture();
  const stored = await secret(first);
  assert.ok(Number(stored?.token_expires_at) < 1e11, "D1 timestamp columns store seconds, not milliseconds");
  assert.doesNotMatch(JSON.stringify(stored), /fixture-access|fixture-refresh/);
  assert.equal(await quickBooksAccessToken(first.organizationId, first.connectionId, neverFetch), "fixture-access");
  await assert.rejects(() => quickBooksAccessToken(second.organizationId, first.connectionId, neverFetch), isCode("QUICKBOOKS_NOT_CONNECTED"));
  assert.equal((await connection(first))?.data_promotion_status, "staging");
  assert.equal((await connection(first))?.last_successful_sync_at, null);
});

test("QuickBooks legacy grants fail closed for reads but can remove local access without guessing credentials", async () => {
  const ctx = await fixture();
  await db.prepare("UPDATE integration_connections SET source_namespace=? WHERE id=?").bind(ctx.connectionId, ctx.connectionId).run();
  await assert.rejects(() => quickBooksAccessToken(ctx.organizationId, ctx.connectionId, neverFetch), isCode("QUICKBOOKS_GRANT_RECONNECT_REQUIRED"));
  const result = await removeQuickBooksGrant(ctx.organizationId, ctx.connectionId, neverFetch);
  assert.deepEqual(result, { providerAuthorizationRevoked: false, localCredentialsDeleted: true, providerRevocationRequired: true });
  assert.equal(await secret(ctx), null); assert.equal((await connection(ctx))?.status, "revoked");
});

test("QuickBooks changed environment or client never reuses a stored authorization", async () => {
  for (const change of [{ QUICKBOOKS_ENV: "production" }, { QUICKBOOKS_CLIENT_ID: "different_fixture_client_123456" }]) {
    const ctx = await fixture(); const original = globals.__vanteloqEnv;
    globals.__vanteloqEnv = { ...original, ...change };
    try {
      await assert.rejects(() => quickBooksAccessToken(ctx.organizationId, ctx.connectionId, neverFetch), isCode("QUICKBOOKS_GRANT_RECONNECT_REQUIRED"));
      const removed = await removeQuickBooksGrant(ctx.organizationId, ctx.connectionId, neverFetch);
      assert.equal(removed.providerRevocationRequired, true); assert.equal(await secret(ctx), null);
    } finally { globals.__vanteloqEnv = original; }
  }
});

test("QuickBooks concurrent refresh is serialized and competing disconnect waits for the new token", async () => {
  const ctx = await fixture(true), refresh = pausedRefresh();
  const first = quickBooksAccessToken(ctx.organizationId, ctx.connectionId, refresh.fetcher);
  await refresh.ready;
  await assert.rejects(() => quickBooksAccessToken(ctx.organizationId, ctx.connectionId, neverFetch), isCode("QUICKBOOKS_CONNECTION_BUSY"));
  await assert.rejects(() => removeQuickBooksGrant(ctx.organizationId, ctx.connectionId, neverFetch), isCode("QUICKBOOKS_CONNECTION_BUSY"));
  refresh.release(); assert.equal(await first, "refreshed-access"); assert.equal(refresh.calls(), 1);
  assert.equal(await quickBooksAccessToken(ctx.organizationId, ctx.connectionId, neverFetch), "refreshed-access");
  const result = await removeQuickBooksGrant(ctx.organizationId, ctx.connectionId, (async (_input, init) => {
    assert.equal(init?.redirect, "error"); assert.equal(JSON.parse(String(init?.body)).token, "refreshed-refresh");
    return new Response(null, { status: 200 });
  }) as typeof fetch);
  assert.equal(result.providerAuthorizationRevoked, true); assert.equal(result.providerRevocationRequired, false);
  assert.equal(await secret(ctx), null); assert.equal((await connection(ctx))?.sync_lease_owner, null);
});

test("QuickBooks late refresh cannot resurrect a concurrently removed grant", async () => {
  const ctx = await fixture(true), refresh = pausedRefresh();
  const result = quickBooksAccessToken(ctx.organizationId, ctx.connectionId, refresh.fetcher);
  const rejected = assert.rejects(result, isCode("QUICKBOOKS_GRANT_CHANGED"));
  await refresh.ready;
  await db.batch([
    db.prepare("DELETE FROM integration_secrets WHERE connection_id=?").bind(ctx.connectionId),
    db.prepare("UPDATE integration_connections SET status='revoked' WHERE id=?").bind(ctx.connectionId),
  ]);
  refresh.release(); await rejected;
  assert.equal(await secret(ctx), null); assert.equal((await connection(ctx))?.status, "revoked");
});

test("QuickBooks refresh rejects stale generations, replaced secrets and expired leases", async () => {
  for (const mutation of ["namespace", "secret", "lease"]) {
    const ctx = await fixture(true), refresh = pausedRefresh();
    const result = quickBooksAccessToken(ctx.organizationId, ctx.connectionId, refresh.fetcher);
    const rejected = assert.rejects(result, isCode("QUICKBOOKS_GRANT_CHANGED"));
    await refresh.ready;
    if (mutation === "namespace") await db.prepare("UPDATE integration_connections SET source_namespace=? WHERE id=?").bind(await newQuickBooksGrantNamespace(), ctx.connectionId).run();
    if (mutation === "secret") await db.prepare("UPDATE integration_secrets SET refresh_token_ciphertext='replacement' WHERE connection_id=?").bind(ctx.connectionId).run();
    if (mutation === "lease") await db.prepare("UPDATE integration_connections SET sync_lease_expires_at=1 WHERE id=?").bind(ctx.connectionId).run();
    const before = await secret(ctx);
    refresh.release(); await rejected;
    assert.deepEqual(await secret(ctx), before, mutation);
  }
});

test("QuickBooks callback save cannot create or overwrite secrets for a revoked or superseded grant", async () => {
  for (const seed of [false, true]) for (const mutation of ["revoked", "namespace"]) {
    const ctx = await fixture(false, seed);
    const lease = await acquireQuickBooksGrantLease(ctx.organizationId, ctx.connectionId);
    if (mutation === "revoked") await db.prepare("UPDATE integration_connections SET status='revoked' WHERE id=?").bind(ctx.connectionId).run();
    else await db.prepare("UPDATE integration_connections SET source_namespace=? WHERE id=?").bind(await newQuickBooksGrantNamespace(), ctx.connectionId).run();
    const before = await secret(ctx);
    try {
      await assert.rejects(() => saveQuickBooksTokens(ctx.organizationId, ctx.connectionId, token(), ctx.namespace, lease), isCode("QUICKBOOKS_GRANT_CHANGED"));
      assert.deepEqual(await secret(ctx), before);
    } finally { await releaseIntegrationSyncLease(lease); }
  }
});

test("QuickBooks network revocation failure still removes local authorization and reports remote action", async () => {
  const ctx = await fixture(); let calls = 0;
  const removed = await removeQuickBooksGrant(ctx.organizationId, ctx.connectionId, (async (_input, init) => {
    calls++; assert.equal(init?.redirect, "error"); throw Error("provider unavailable");
  }) as typeof fetch);
  assert.equal(calls, 1); assert.equal(removed.providerRevocationRequired, true);
  assert.equal(await secret(ctx), null); assert.equal((await connection(ctx))?.data_promotion_status, "blocked");
  await assert.rejects(() => quickBooksAccessToken(ctx.organizationId, ctx.connectionId, neverFetch), isCode("QUICKBOOKS_NOT_CONNECTED"));
});

test("QuickBooks callback activation is atomic and pending reconnect never exposes the previous secret", async () => {
  const ctx = await fixture(false, false);
  const lease = await acquireQuickBooksGrantLease(ctx.organizationId, ctx.connectionId);
  try {
    await db.prepare("UPDATE integration_connections SET status='pending' WHERE id=?").bind(ctx.connectionId).run();
    await db.prepare(`CREATE TRIGGER test_qb_activation_failure BEFORE UPDATE ON integration_connections WHEN NEW.id='${ctx.connectionId}' AND NEW.status='connected' BEGIN SELECT RAISE(ABORT, 'activation failure'); END`).run();
    try { await assert.rejects(() => saveQuickBooksTokens(ctx.organizationId, ctx.connectionId, token(), ctx.namespace, lease)); }
    finally { await db.prepare("DROP TRIGGER test_qb_activation_failure").run(); }
    assert.equal(await secret(ctx), null, "D1 must roll back the insert when activation fails");
    assert.equal((await connection(ctx))?.status, "pending");
    await saveQuickBooksTokens(ctx.organizationId, ctx.connectionId, token(), ctx.namespace, lease);
    assert.equal((await connection(ctx))?.status, "connected");
    const nextNamespace = await newQuickBooksGrantNamespace();
    await db.prepare("UPDATE integration_connections SET status='pending',source_namespace=? WHERE id=?").bind(nextNamespace, ctx.connectionId).run();
    await assert.rejects(() => quickBooksAccessToken(ctx.organizationId, ctx.connectionId, neverFetch), isCode("QUICKBOOKS_NOT_CONNECTED"));
    await saveQuickBooksTokens(ctx.organizationId, ctx.connectionId, { ...token(), accessToken: "new-generation" }, nextNamespace, lease);
    assert.equal(await quickBooksAccessToken(ctx.organizationId, ctx.connectionId, neverFetch), "new-generation");
  } finally { await releaseIntegrationSyncLease(lease); }
});

test("QuickBooks reconnect cannot save through a withdrawn or expired pending-attempt lease", async () => {
  for (const mutation of ["revoked", "expired"]) {
    const ctx = await fixture();
    const attemptId = crypto.randomUUID(), attemptNamespace = await newQuickBooksGrantNamespace(attemptId);
    await db.prepare("INSERT INTO integration_connections(id,organization_id,provider,status,source_namespace,data_promotion_status,created_at,updated_at) VALUES (?,?,'quickbooks','pending',?,'blocked',1,1)").bind(attemptId, ctx.organizationId, attemptNamespace).run();
    const attemptLease = await acquireQuickBooksGrantLease(ctx.organizationId, attemptId);
    const targetLease = await acquireQuickBooksGrantLease(ctx.organizationId, ctx.connectionId);
    try {
      const before = await secret(ctx);
      if (mutation === "revoked") await db.prepare("UPDATE integration_connections SET status='revoked' WHERE id=?").bind(attemptId).run();
      else await db.prepare("UPDATE integration_connections SET sync_lease_expires_at=1 WHERE id=?").bind(attemptId).run();
      await assert.rejects(() => saveQuickBooksTokens(ctx.organizationId, ctx.connectionId, token(), ctx.namespace, targetLease,
        { lease: attemptLease, sourceNamespace: attemptNamespace }), isCode("QUICKBOOKS_GRANT_CHANGED"));
      assert.deepEqual(await secret(ctx), before); assert.equal((await connection(ctx))?.status, "connected");
    } finally { await releaseIntegrationSyncLease(targetLease); await releaseIntegrationSyncLease(attemptLease); }
  }
});
