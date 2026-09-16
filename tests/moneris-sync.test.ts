import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { eq } from "drizzle-orm";
import { getDb, type VanteloqRuntimeEnv } from "../db";
import { workspaces } from "../db/schema";
import { saveMonerisCredentials } from "../server/integrations/moneris";
import { runSync } from "../server/integrations/sync/moneris";

let runtime: Miniflare;
let db: D1Database;
const originalFetch = globalThis.fetch;
const globals = globalThis as typeof globalThis & { __vanteloqEnv?: VanteloqRuntimeEnv };
const originalEnv = globals.__vanteloqEnv;
const today = () => new Date().toISOString().slice(0, 10);
before(async () => {
  runtime = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('isolated')}}", d1Databases: { DB: crypto.randomUUID() } });
  db = await runtime.getD1Database("DB") as unknown as D1Database;
  for (const file of (await readdir("drizzle")).filter(file => /^\d{4}.*\.sql$/.test(file)).sort()) {
    for (const sql of (await readFile(`drizzle/${file}`, "utf8")).split("--> statement-breakpoint").filter(text => text.trim())) await db.prepare(sql).run();
  }
  globals.__vanteloqEnv = { DB: db, INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") };
}, { timeout: 120000 });
after(async () => { globalThis.fetch = originalFetch; globals.__vanteloqEnv = originalEnv; await runtime?.dispose(); });

async function workspace(nextDay = today()) {
  const organizationId = crypto.randomUUID(), userId = crypto.randomUUID(), connectionId = crypto.randomUUID();
  const merchantId = crypto.randomUUID().replaceAll("-", "").slice(0, 13);
  await db.batch([
    db.prepare("INSERT INTO users(id,email,display_name,created_at,updated_at) VALUES (?,?,'Test',1,1)").bind(userId, `${userId}@example.invalid`),
    db.prepare("INSERT INTO workspaces(id,owner_name,business_name,legal_name,business_email,industry,city,address,postal_code,hours_json,created_at,updated_at) VALUES (?,'Test','Moneris test','Moneris test',?,'Retail','Edmonton','Test','T5A1A1','[]',1,1)").bind(organizationId, `${organizationId}@example.invalid`),
    db.prepare("INSERT INTO integration_connections(id,organization_id,provider,status,external_account_ref,source_namespace,last_sync_cursor,data_promotion_status,created_at,updated_at) VALUES (?,?,'moneris','connected',?,?,?,'approved',1,1)").bind(connectionId, organizationId, merchantId, `sandbox:${merchantId}`, JSON.stringify({ nextDay, providerCursor: null })),
  ]);
  await saveMonerisCredentials(organizationId, connectionId, { environment: "sandbox", merchantId, clientId: "fixture-application", clientSecret: "fixture-long-client-secret", scope: "payment.read" });
  const [organization] = await getDb().select().from(workspaces).where(eq(workspaces.id, organizationId));
  return { organizationId, userId, organization, connectionId };
}
type Context = Awaited<ReturnType<typeof workspace>>;
const payment = (id = "p-1", amount = 1000, currency = "CAD") => ({ paymentId: id, paymentStatus: "SUCCEEDED", amount: { amount, currency }, transactionDateTime: `${today()}T00:00:00Z` });
function provider(data: unknown[], pages?: (url: URL) => Record<string, unknown>) {
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.sb.moneris.io");
    if (url.pathname === "/oauth2/token") return Response.json({ access_token: "fixture-token", expires_in: 900 });
    assert.equal(url.pathname, "/payments");
    return Response.json(pages ? pages(url) : { data, next: null });
  };
}
async function sync(ctx: Context) { return (await runSync(new Request("https://vanteloq.example/api/v1/integrations/moneris/sync"), crypto.randomUUID(), ctx, { connectionId: ctx.connectionId }, "scheduled")).json(); }
const saved = async (ctx: Context) => (await db.prepare("SELECT * FROM commerce_payments WHERE organization_id=? AND connection_id=?").bind(ctx.organizationId, ctx.connectionId).all()).results ?? [];
const connection = (ctx: Context) => db.prepare("SELECT * FROM integration_connections WHERE id=?").bind(ctx.connectionId).first();

test("mixed currency rows stop the checkpoint and never advertise verified money", async () => {
  const ctx = await workspace(); const before = await connection(ctx);
  provider([payment("cad", 1000), payment("usd", 1000, "USD")]);
  const result = await sync(ctx);
  assert.equal(result.run.recordsStaged, 1); assert.equal(result.run.warningCount, 1);
  assert.equal(result.sourceIssues.MONERIS_CURRENCY_MISMATCH, 1);
  assert.equal(result.readyForReview, false); assert.equal(result.dataPromotionEnabled, false);
  assert.equal(result.reconciliation.grossCents, undefined); assert.equal(result.reconciliation.refundsReconciled, false);
  assert.equal((await saved(ctx)).length, 1);
  const after = await connection(ctx);
  assert.equal(after?.last_sync_cursor, before?.last_sync_cursor); assert.equal(after?.last_successful_sync_at, null);
  assert.equal(after?.data_promotion_status, "staging"); assert.equal(after?.sync_lease_owner, null);
});

test("unchanged records are duplicates, changed amount or status requires reconciliation", async () => {
  const ctx = await workspace(); provider([payment()]); await sync(ctx);
  provider([payment()]); const same = await sync(ctx);
  assert.equal(same.run.duplicatesSkipped, 1); assert.equal(same.run.warningCount, 0);
  provider([payment("p-1", 2000)]); const changed = await sync(ctx);
  assert.equal(changed.sourceIssues.MONERIS_PAYMENT_CHANGED, 1); assert.equal(changed.run.duplicatesSkipped, 0);
  assert.equal((await saved(ctx))[0].amount_cents, 1000);
  provider([{ ...payment(), paymentStatus: "CANCELLED" }]); const cancelled = await sync(ctx);
  assert.equal(cancelled.sourceIssues.MONERIS_PAYMENT_CHANGED, 1);
  assert.equal(cancelled.run.ignoredPayments, 0); assert.equal(cancelled.readyForReview, false);
});

test("foreign workspaces cannot import another account or collide on payment ids", async () => {
  const first = await workspace(), second = await workspace();
  provider([payment()]); await sync(first);
  provider([payment("p-1", 2000)]); await sync(second);
  assert.equal((await saved(first))[0].amount_cents, 1000); assert.equal((await saved(second))[0].amount_cents, 2000);
  await assert.rejects(() => sync({ ...second, connectionId: first.connectionId }), /selected provider account/i);
});

test("fresh matching currency re-attests only identical legacy facts with a hash-only update", async () => {
  const ctx = await workspace(); const raw = payment();
  provider([raw]); await sync(ctx);
  const current = (await saved(ctx))[0];
  // Reproduce the pre-currency migration payload independently of the helper.
  const legacyPayload = { externalPaymentId: "p-1", externalSaleId: "p-1", status: "SUCCEEDED", amountCents: 1000, paidAt: `${today()}T00:00:00.000Z`, methodName: "Unknown" };
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(legacyPayload)));
  const legacyHash = Buffer.from(digest).toString("hex");
  assert.notEqual(legacyHash, current.source_payload_hash);
  await db.prepare("UPDATE commerce_payments SET source_payload_hash=? WHERE id=?").bind(legacyHash, current.id).run();
  provider([raw]); const result = await sync(ctx);
  assert.equal(result.run.revalidatedPayments, 1); assert.equal(result.run.duplicatesSkipped, 0); assert.equal(result.run.warningCount, 0);
  assert.deepEqual((await saved(ctx))[0], current);
  assert.equal(result.dataPromotionEnabled, false);

  // An old fingerprint alone does not authorize rewriting inconsistent facts.
  await db.prepare("UPDATE commerce_payments SET source_payload_hash=?,amount_cents=999 WHERE id=?").bind(legacyHash, current.id).run();
  const inconsistent = (await saved(ctx))[0];
  provider([raw]); const blocked = await sync(ctx);
  assert.equal(blocked.run.revalidatedPayments, 0); assert.equal(blocked.sourceIssues.MONERIS_PAYMENT_CHANGED, 1);
  assert.deepEqual((await saved(ctx))[0], inconsistent);

  await db.prepare("UPDATE commerce_payments SET amount_cents=1000 WHERE id=?").bind(current.id).run();
  provider([{ ...raw, amount: { amount: 1000, currency: "USD" } }]); const currencyMismatch = await sync(ctx);
  assert.equal(currencyMismatch.run.revalidatedPayments, 0); assert.equal(currencyMismatch.sourceIssues.MONERIS_CURRENCY_MISMATCH, 1);
  assert.equal((await saved(ctx))[0].source_payload_hash, legacyHash);
});

test("pagination freezes the current-day window and unfinished backfill stays unapproved", async () => {
  const ctx = await workspace(); const windows: string[] = [];
  let page = 0;
  provider([], url => { windows.push(url.searchParams.get("created_to")!); return { data: [], next: `/payments?cursor=page-${++page}` }; });
  const first = await sync(ctx); assert.equal(first.hasMore, true); assert.equal(first.backfillComplete, false); assert.equal(first.readyForReview, false);
  const checkpoint = JSON.parse(String((await connection(ctx))?.last_sync_cursor));
  assert.equal(checkpoint.windowEnd, windows[0]);
  provider([], url => { windows.push(url.searchParams.get("created_to")!); return { data: [], next: null }; });
  const second = await sync(ctx);
  assert.equal(new Set(windows).size, 1); assert.equal(second.backfillComplete, true);
  assert.equal(second.readyForReview, false); assert.equal(second.reconciliation.settlementReconciled, false);
});

test("non-success payments are ignored separately and malformed rows fail the run", async () => {
  const ctx = await workspace(); provider([{ ...payment(), paymentStatus: "DECLINED" }]);
  const ignored = await sync(ctx); assert.equal(ignored.run.ignoredPayments, 1); assert.equal(ignored.run.duplicatesSkipped, 0);
  provider([null]); await assert.rejects(() => sync(ctx), /invalid payment row/i);
  assert.equal((await connection(ctx))?.sync_lease_owner, null);
});

test("a frozen page chain completed overnight re-reads its entire day before advancing", async () => {
  const yesterday = new Date(Date.parse(`${today()}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const ctx = await workspace(yesterday);
  const frozenEnd = `${yesterday}T10:00:00.000Z`;
  await db.prepare("UPDATE integration_connections SET last_sync_cursor=? WHERE id=?").bind(JSON.stringify({ nextDay: yesterday, providerCursor: "last-morning-page", windowEnd: frozenEnd }), ctx.connectionId).run();
  const early = { ...payment("early", 1000), transactionDateTime: `${yesterday}T06:00:00Z` };
  const late = { ...payment("late", 2000), transactionDateTime: `${yesterday}T15:00:00Z` };
  const resumed: URL[] = [];
  provider([], url => { resumed.push(url); return { data: [early], next: null }; });
  const first = await sync(ctx);
  assert.equal(resumed.length, 1);
  assert.equal(resumed[0].searchParams.get("created_to"), frozenEnd);
  assert.equal(resumed[0].searchParams.get("cursor"), "last-morning-page");
  assert.equal(first.hasMore, true); assert.equal(first.backfillComplete, false);
  assert.deepEqual(JSON.parse(String((await connection(ctx))?.last_sync_cursor)), { nextDay: yesterday, providerCursor: null });

  const reread: URL[] = [];
  provider([], url => {
    reread.push(url);
    return { data: url.searchParams.get("created_from")?.startsWith(yesterday) ? [early, late] : [], next: null };
  });
  const second = await sync(ctx);
  assert.equal(reread[0].searchParams.get("created_from"), `${yesterday}T00:00:00.000Z`);
  assert.equal(reread[0].searchParams.get("created_to"), `${yesterday}T23:59:59.999Z`);
  assert.equal(reread[0].searchParams.has("cursor"), false);
  assert.equal(second.run.duplicatesSkipped, 1); assert.equal(second.run.recordsStaged, 1);
  assert.equal(second.backfillComplete, true);
  const records = await saved(ctx);
  assert.equal(records.length, 2);
  assert.equal(records.reduce((sum, row) => sum + Number(row.amount_cents), 0), 3000);
});

test("storage failures fail the sync and release its lease instead of becoming skipped rows", async () => {
  const ctx = await workspace();
  await db.prepare("CREATE TRIGGER moneris_fixture_write_failure BEFORE INSERT ON commerce_payments BEGIN SELECT RAISE(ABORT, 'fixture disk failure'); END;").run();
  provider([payment()]);
  try { await assert.rejects(() => sync(ctx), error => error instanceof Error && error.cause instanceof Error && /fixture disk failure/.test(error.cause.message)); }
  finally { await db.prepare("DROP TRIGGER moneris_fixture_write_failure").run(); }
  assert.equal((await connection(ctx))?.sync_lease_owner, null);
  const run = await db.prepare("SELECT status,error_code FROM integration_sync_runs WHERE connection_id=?").bind(ctx.connectionId).first();
  assert.equal(run?.status, "failed"); assert.equal(run?.error_code, "MONERIS_SYNC_FAILED");
});
