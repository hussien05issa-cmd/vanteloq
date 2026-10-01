import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { eq } from "drizzle-orm";
import { getDb, type VanteloqRuntimeEnv } from "../db";
import { workspaces } from "../db/schema";
import { runSync } from "../server/integrations/sync/stripe";

let runtime: Miniflare;
let db: D1Database;
const originalFetch = globalThis.fetch;
const globals = globalThis as typeof globalThis & { __vanteloqEnv?: VanteloqRuntimeEnv };
const originalEnv = globals.__vanteloqEnv;
before(async () => {
  runtime = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('isolated')}}", d1Databases: { DB: crypto.randomUUID() } });
  db = await runtime.getD1Database("DB") as unknown as D1Database;
  for (const file of (await readdir("drizzle")).filter(file => /^\d{4}.*\.sql$/.test(file)).sort()) {
    for (const sql of (await readFile(`drizzle/${file}`, "utf8")).split("--> statement-breakpoint").filter(text => text.trim())) await db.prepare(sql).run();
  }
  globals.__vanteloqEnv = {
    DB: db, STRIPE_CLIENT_ID: "ca_fixture_platform", STRIPE_SECRET_KEY: "sk_test_fixture_only",
    STRIPE_REDIRECT_URI: "https://fixture.invalid/api/v1/integrations/stripe/callback", STRIPE_WEBHOOK_SECRET: "whsec_fixture_only",
  };
}, { timeout: 120000 });
after(async () => { globalThis.fetch = originalFetch; globals.__vanteloqEnv = originalEnv; await runtime?.dispose(); });

async function workspace() {
  const organizationId = crypto.randomUUID(), userId = crypto.randomUUID(), connectionId = crypto.randomUUID();
  const accountId = `acct_${crypto.randomUUID().replaceAll("-", "")}`;
  await db.batch([
    db.prepare("INSERT INTO users(id,email,display_name,created_at,updated_at) VALUES (?,?,'Test',1,1)").bind(userId, `${userId}@example.invalid`),
    db.prepare("INSERT INTO workspaces(id,owner_name,business_name,legal_name,business_email,industry,city,address,postal_code,hours_json,created_at,updated_at) VALUES (?,'Test','Stripe test','Stripe test',?,'Retail','Edmonton','Test','T5A1A1','[]',1,1)").bind(organizationId, `${organizationId}@example.invalid`),
    db.prepare("INSERT INTO integration_connections(id,organization_id,provider,status,external_account_ref,source_namespace,data_promotion_status,created_at,updated_at) VALUES (?,?,'stripe','connected',?,?,'staging',1,1)").bind(connectionId, organizationId, accountId, accountId),
  ]);
  const [organization] = await getDb().select().from(workspaces).where(eq(workspaces.id, organizationId));
  return { organizationId, userId, organization, connectionId, accountId };
}
type Context = Awaited<ReturnType<typeof workspace>>;
const payout = (status = "pending", amount = 10000) => ({ id: "po_fixture", amount, currency: "cad", created: 1790294400, arrival_date: 1790380800, status, livemode: false, balance_transaction: "txn_payout" });
const transaction = (id = "txn_fixture", amount = 10000, fee = 300, net = 9700) => ({ id, amount, fee, net, currency: "cad", created: 1790294400, available_on: 1790380800, status: "pending", reporting_category: amount < 0 ? "refund" : "charge", source: amount < 0 ? "re_fixture" : "ch_fixture", livemode: false });
function provider(ctx: Context, payouts: Record<string, unknown>[], transactions: Record<string, unknown>[] = [], handler?: (url: URL) => Response | Promise<Response>) {
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.stripe.com");
    assert.equal(new Headers(init?.headers).get("Stripe-Account"), ctx.accountId);
    if (handler) return handler(url);
    return Response.json({ data: url.pathname.endsWith("/payouts") ? payouts : transactions, has_more: false });
  };
}
async function sync(ctx: Context) { return (await runSync(new Request("https://fixture.invalid/api/v1/integrations/stripe/sync"), crypto.randomUUID(), ctx, { connectionId: ctx.connectionId }, "scheduled")).json(); }
const saved = async (ctx: Context) => (await db.prepare("SELECT * FROM integration_staged_financial_records WHERE organization_id=? AND provider='stripe' AND connection_id=? ORDER BY staged_at,id").bind(ctx.organizationId, ctx.connectionId).all()).results ?? [];
const connection = (ctx: Context) => db.prepare("SELECT * FROM integration_connections WHERE id=?").bind(ctx.connectionId).first();

test("payout changes preserve versions, identical retries do not duplicate, and no version is promoted", async () => {
  const ctx = await workspace();
  for (const status of ["pending", "paid", "failed"]) {
    provider(ctx, [payout(status)]);
    const result = await sync(ctx);
    assert.equal(result.run.recordsStaged, 1);
    assert.equal(result.stagingOnly, true); assert.equal(result.dataPromotionEnabled, false);
    const retry = await sync(ctx);
    assert.equal(retry.run.recordsStaged, 0); assert.equal(retry.run.duplicatesSkipped, 1);
  }
  const rows = await saved(ctx);
  assert.equal(rows.length, 3);
  assert.deepEqual(new Set(rows.map(row => row.state)), new Set(["pending", "paid", "failed"]));
  assert.equal(new Set(rows.map(row => row.source_payload_hash)).size, 3);
  assert.equal((await connection(ctx))?.data_promotion_status, "staging");
});

test("negative refund amounts retain their signed minor units alongside separate payout evidence", async () => {
  const ctx = await workspace(); provider(ctx, [payout("paid")], [transaction("txn_refund", -2500, -75, -2425)]);
  await sync(ctx);
  const rows = await saved(ctx), refund = rows.find(row => row.record_type === "balance_transaction");
  assert.equal(rows.length, 2); assert.equal(refund?.gross_cents, -2500); assert.equal(refund?.fee_cents, -75); assert.equal(refund?.net_cents, -2425);
  assert.equal(refund?.category, "refund"); assert.equal(refund?.source_ref, "re_fixture");
});

test("same external record ids stay isolated across tenants and connections", async () => {
  const first = await workspace(), second = await workspace();
  provider(first, [payout("pending", 1000)]); await sync(first);
  provider(second, [payout("paid", 2000)]); await sync(second);
  provider(first, [payout("failed", 1000)]); await sync(first);
  assert.equal((await saved(first)).length, 2);
  const secondRows = await saved(second); assert.equal(secondRows.length, 1); assert.equal(secondRows[0].state, "paid"); assert.equal(secondRows[0].gross_cents, 2000);
  let requests = 0; globalThis.fetch = async () => { requests++; throw new Error("must not call"); };
  await assert.rejects(() => runSync(new Request("https://fixture.invalid/sync"), crypto.randomUUID(), second, { connectionId: first.connectionId }, "scheduled"), /unavailable/i);
  assert.equal(requests, 0);
});

test("invalid rows preserve cursor and successful-sync time until a complete retry succeeds", async () => {
  const ctx = await workspace();
  const cursor = JSON.stringify({ balanceTransactions: "txn_prior", payouts: "po_prior", transactionsComplete: false, payoutsComplete: false });
  await db.prepare("UPDATE integration_connections SET last_sync_cursor=?,last_successful_sync_at=1000 WHERE id=?").bind(cursor, ctx.connectionId).run();
  provider(ctx, [], [], url => Response.json({ data: url.pathname.endsWith("/payouts") ? [{ ...payout(), amount: "not-money" }] : [transaction()], has_more: false }));
  const result = await sync(ctx), current = await connection(ctx);
  assert.equal(result.retryRequired, true); assert.equal(result.run.warningCount, 1);
  assert.deepEqual(JSON.parse(String(current?.last_sync_cursor)), JSON.parse(cursor));
  assert.equal(current?.last_successful_sync_at, 1000, "A warning-containing retry must not advertise newly successful data");
  provider(ctx, [payout()], [transaction()]); const retry = await sync(ctx);
  assert.equal(retry.run.duplicatesSkipped, 1); assert.equal(retry.run.recordsStaged, 1); assert.equal(retry.retryRequired, false);
  assert.deepEqual(JSON.parse(String((await connection(ctx))?.last_sync_cursor)), { balanceTransactions: null, payouts: null });
  assert.equal((await saved(ctx)).length, 2);
});

test("provider failure preserves cursor and releases its lease", async () => {
  const ctx = await workspace(), cursor = JSON.stringify({ balanceTransactions: "txn_saved", payouts: "po_saved" });
  await db.prepare("UPDATE integration_connections SET last_sync_cursor=? WHERE id=?").bind(cursor, ctx.connectionId).run();
  provider(ctx, [], [], () => new Response(null, { status: 429 }));
  await assert.rejects(() => sync(ctx), /rate limit/i);
  const current = await connection(ctx);
  assert.equal(current?.last_sync_cursor, cursor); assert.equal(current?.sync_lease_owner, null); assert.equal(current?.last_error_code, "STRIPE_RATE_LIMITED");
  assert.equal((await saved(ctx)).length, 0);
});

