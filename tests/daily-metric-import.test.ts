import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { dataImports, dailyBusinessMetrics, auditEvents } from "../db/schema";
import { ApiError } from "../server/api";
import { dailyMetricImportInput } from "../server/validation";
import { dailyImportIdentity, saveDailyMetricImport } from "../server/daily-metric-import";

let runtime: Miniflare;
let db: D1Database;
before(async () => {
  runtime = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('isolated')}}", d1Databases: { DB: crypto.randomUUID() } });
  db = await runtime.getD1Database("DB") as unknown as D1Database;
  for (const file of (await readdir("drizzle")).filter(file => /^\d{4}.*\.sql$/.test(file)).sort()) {
    const migration = await readFile(`drizzle/${file}`, "utf8");
    for (const sql of migration.split("--> statement-breakpoint").filter(text => text.trim())) await db.prepare(sql).run();
  }
}, { timeout: 120000 });
after(async () => { await runtime?.dispose(); });

async function workspace() {
  const organizationId = crypto.randomUUID(), actorUserId = crypto.randomUUID();
  await db.batch([
    db.prepare("INSERT INTO users(id,email,display_name,created_at,updated_at) VALUES (?,?,'Test',1,1)").bind(actorUserId, `${actorUserId}@example.invalid`),
    db.prepare("INSERT INTO workspaces(id,owner_name,business_name,legal_name,business_email,industry,city,address,postal_code,hours_json,created_at,updated_at) VALUES (?,'Test','Import test','Import test',?,'Retail','Edmonton','Test','T5A1A1','[]',1,1)").bind(organizationId, `${organizationId}@example.invalid`),
  ]);
  return { organizationId, actorUserId, requestId: crypto.randomUUID(), sourceHash: "isolated-test" };
}
type Context = Awaited<ReturnType<typeof workspace>>;
const row = (overrides: Record<string, unknown> = {}) => ({ businessDate: "2026-09-01", locationRef: "Main", grossSalesCents: 10000, netSalesCents: 9000, costOfGoodsCents: 5000, transactionCount: 10, unitsSold: 12, ...overrides });
const input = (rows: Record<string, unknown>[] = [row()], extra: Record<string, unknown> = {}) => dailyMetricImportInput({ importType: "daily_summary_csv", fileName: "daily.csv", rows, ...extra });
const save = (ctx: Context, request = input(), key = crypto.randomUUID(), database = db) => saveDailyMetricImport(database, ctx, key, request);
const records = async (ctx: Context) => (await db.prepare("SELECT * FROM daily_business_metrics WHERE organization_id=? ORDER BY business_date,location_ref").bind(ctx.organizationId).all()).results ?? [];
const imports = async (ctx: Context) => (await db.prepare("SELECT * FROM data_imports WHERE organization_id=? ORDER BY id").bind(ctx.organizationId).all()).results ?? [];
const audits = async (ctx: Context) => (await db.prepare("SELECT * FROM audit_events WHERE organization_id=? ORDER BY action,id").bind(ctx.organizationId).all()).results ?? [];
const code = (expected: string) => (error: unknown) => error instanceof ApiError && error.status === 409 && error.code === expected;

test("new imports persist exact cents and distinguish missing labour from a reported zero", async () => {
  const ctx = await workspace();
  const result = await save(ctx, input([row({ netSalesCents: 9999 }), row({ businessDate: "2026-09-02", labourCostCents: 0, cashBalanceCents: -321 })]));
  assert.equal(result.kind, "saved");
  assert.equal(result.kind === "saved" && result.import.rowCount, 2);
  const saved = await records(ctx);
  assert.equal(saved[0].net_sales_cents, 9999);
  assert.deepEqual(saved.map(row => row.labour_cost_reported), [0, 1]);
  assert.equal(saved[1].cash_balance_cents, -321);
  assert.ok(saved.every(row => row.source_provider === null && row.source_connection_id === null && row.source_import_id));
  assert.equal((await imports(ctx))[0].status, "completed");
  assert.equal((await audits(ctx)).length, 1);
});

test("same key replays only the same normalized payload, including filename and actor", async () => {
  const ctx = await workspace(), key = crypto.randomUUID();
  const request = input([row(), row({ businessDate: "2026-09-02" })]);
  const first = await save(ctx, request, key);
  const replay = await save(ctx, input([row({ businessDate: "2026-09-02" }), row()]), key);
  assert.equal(first.kind, "saved"); assert.equal(replay.kind, "saved");
  assert.equal(replay.kind === "saved" && replay.replayed, true);
  await assert.rejects(save(ctx, input([row({ netSalesCents: 1 })]), key), code("IDEMPOTENCY_KEY_CONFLICT"));
  await assert.rejects(save(ctx, input(request.rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "labourCostReported"))), { fileName: "other.csv" }), key), code("IDEMPOTENCY_KEY_CONFLICT"));
  const otherActor = await workspace();
  await assert.rejects(save({ ...ctx, actorUserId: otherActor.actorUserId }, request, key), code("IDEMPOTENCY_KEY_CONFLICT"));
  assert.equal((await records(ctx)).length, 2); assert.equal((await imports(ctx)).length, 1); assert.equal((await audits(ctx)).length, 1);
  const separate = await save(otherActor, request, key);
  assert.equal(separate.kind === "saved" && separate.replayed, false);
});

test("legacy completed requests and unfinished requests cannot be reset by a repeated key", async () => {
  const ctx = await workspace(); const key = crypto.randomUUID();
  await db.prepare("INSERT INTO data_imports(id,organization_id,import_type,status,file_name,row_count,idempotency_key,imported_by_user_id,created_at) VALUES ('legacy-import',?,'daily_summary_csv','completed','daily.csv',1,?,?,1)")
    .bind(ctx.organizationId, key, ctx.actorUserId).run();
  await assert.rejects(save(ctx, input(), key), code("IDEMPOTENCY_KEY_CONFLICT"));
  const key2 = crypto.randomUUID(), identity = await dailyImportIdentity(ctx.organizationId, key2, input());
  await db.prepare("INSERT INTO data_imports(id,organization_id,import_type,status,file_name,row_count,idempotency_key,imported_by_user_id,created_at) VALUES (?,?,'daily_summary_csv','processing','daily.csv',0,?,?,1)")
    .bind(identity.id, ctx.organizationId, key2, ctx.actorUserId).run();
  await assert.rejects(save(ctx, input(), key2), code("IMPORT_IN_PROGRESS"));
  assert.equal((await records(ctx)).length, 0); assert.equal((await audits(ctx)).length, 0);
});

test("provider ownership remains protected even when one provenance field is absent or the connection is stale", async () => {
  for (const provenance of [["lightspeed-r", "stale"], ["moneris", null], [null, "stale"]]) {
    const ctx = await workspace(); await save(ctx);
    await db.prepare("UPDATE daily_business_metrics SET source_provider=?,source_connection_id=? WHERE organization_id=?")
      .bind(...provenance, ctx.organizationId).run();
    const before = await records(ctx), beforeImports = await imports(ctx), beforeAudits = await audits(ctx);
    await assert.rejects(save(ctx, input([row({ netSalesCents: 5000 })])), code("IMPORT_PROVIDER_SOURCE_PROTECTED"));
    assert.deepEqual(await records(ctx), before); assert.deepEqual(await imports(ctx), beforeImports); assert.deepEqual(await audits(ctx), beforeAudits);
  }
  const ctx = await workspace();
  await assert.rejects(save(ctx, input([row({ locationRef: "clover:merchant" })])), code("IMPORT_PROVIDER_SOURCE_PROTECTED"));
});

async function mappedProvider(ctx: Context, namespace: string) {
  const locationId = crypto.randomUUID(), connectionId = crypto.randomUUID();
  await db.batch([
    db.prepare("INSERT INTO organization_locations(id,organization_id,name,country_code,address_line_1,locality,administrative_area,timezone,currency,created_at,updated_at) VALUES (?,?,'Main','CA','Test','Edmonton','AB','America/Edmonton','CAD',1,1)").bind(locationId, ctx.organizationId),
    db.prepare("INSERT INTO integration_connections(id,organization_id,provider,status,source_namespace,created_at,updated_at) VALUES (?,?,'moneris','connected',?,1,1)").bind(connectionId, ctx.organizationId, namespace),
    db.prepare("INSERT INTO integration_location_mappings(id,organization_id,provider,connection_id,external_location_ref,external_name,local_location_id,status,last_seen_at,created_at,updated_at) VALUES (?,?,'moneris',?,'outlet','Main',?,'mapped',1,1,1)").bind(crypto.randomUUID(), ctx.organizationId, connectionId, locationId),
  ]);
  const reference = namespace === "legacy" ? "moneris:outlet" : `moneris:${namespace}:outlet`;
  const addRecord = () => db.prepare(`INSERT INTO daily_business_metrics(organization_id,business_date,location_ref,gross_sales_cents,net_sales_cents,cost_of_goods_cents,transaction_count,units_sold,source_provider,source_connection_id,created_by_user_id,created_at,updated_at)
    VALUES (?,'2026-09-01',?,10000,9000,5000,10,12,'moneris',?,?,1,1)`).bind(ctx.organizationId, reference, connectionId, ctx.actorUserId).run();
  return { locationId, reference, addRecord };
}

test("a mapped POS outlet is protected through its local ID and name, including namespaced connections", async () => {
  for (const namespace of ["legacy", "production:merchant"]) {
    const ctx = await workspace(), mapping = await mappedProvider(ctx, namespace); await mapping.addRecord();
    for (const locationRef of [mapping.locationId, "Main"]) {
      await assert.rejects(save(ctx, input([row({ locationRef })])), code("IMPORT_PROVIDER_SOURCE_PROTECTED"));
    }
    assert.equal((await records(ctx)).length, 1); assert.equal((await imports(ctx)).length, 0);
  }
});

test("a mapped POS record arriving after review prevents a duplicate local total atomically", async () => {
  const ctx = await workspace(), mapping = await mappedProvider(ctx, "production:merchant");
  const database = intervene(mapping.addRecord);
  await assert.rejects(save(ctx, input([row({ locationRef: mapping.locationId })]), crypto.randomUUID(), database), code("IMPORT_REVIEW_STALE"));
  const saved = await records(ctx);
  assert.equal(saved.length, 1); assert.equal(saved[0].location_ref, mapping.reference);
  assert.equal((await imports(ctx)).length, 0); assert.equal((await audits(ctx)).length, 0);
});

test("manual corrections require a current review snapshot and preserve before/after evidence", async () => {
  const ctx = await workspace(); const original = await save(ctx);
  const request = input([row({ netSalesCents: 8500, labourCostCents: 0 })]); const key = crypto.randomUUID();
  const review = await save(ctx, request, key);
  assert.equal(review.kind, "review"); if (review.kind !== "review") throw new Error("Review not returned");
  assert.equal(review.review.rows[0].before.netSalesCents, 9000);
  assert.equal(review.review.rows[0].after.netSalesCents, 8500);
  assert.equal((await imports(ctx)).length, 1);
  const replacement = { snapshot: review.review.snapshot, reason: "Matched the corrected daily source report." };
  const reviewed = input([row({ netSalesCents: 8500, labourCostCents: 0 })], { replacement });
  const saved = await save(ctx, reviewed, key); assert.equal(saved.kind, "saved");
  assert.equal((await records(ctx))[0].net_sales_cents, 8500);
  const replaced = (await audits(ctx)).find(row => row.action === "daily_metrics.replaced");
  assert.ok(replaced);
  const details = JSON.parse(String(replaced.details_json));
  assert.equal(details.reason, replacement.reason);
  assert.equal(details.previousImportId, original.kind === "saved" && original.import.id);
  assert.equal(JSON.parse(details.previousValues)[1], 9000);
  assert.equal(JSON.parse(details.replacementValues)[1], 8500);
  const replay = await save(ctx, reviewed, key); assert.equal(replay.kind === "saved" && replay.replayed, true);
  await assert.rejects(save(ctx, input([row({ netSalesCents: 8500, labourCostCents: 0 })], { replacement: { ...replacement, reason: "Changed reason" } }), key), code("IDEMPOTENCY_KEY_CONFLICT"));
  await assert.rejects(save(ctx, input([row({ netSalesCents: 8500, labourCostCents: 0 })], { replacement: { ...replacement, snapshot: "a".repeat(64) } }), key), code("IDEMPOTENCY_KEY_CONFLICT"));
  assert.equal((await audits(ctx)).length, 3);
});

test("a changed saved value invalidates the review without overwriting it", async () => {
  const ctx = await workspace(); await save(ctx);
  const request = input([row({ netSalesCents: 8000 })]);
  const review = await save(ctx, request);
  if (review.kind !== "review") throw new Error("Review not returned");
  await db.prepare("UPDATE daily_business_metrics SET net_sales_cents=7777 WHERE organization_id=?").bind(ctx.organizationId).run();
  const stale = await save(ctx, input([row({ netSalesCents: 8000 })], { replacement: { snapshot: review.review.snapshot, reason: "Correction" } }));
  assert.equal(stale.kind, "review");
  assert.equal(stale.kind === "review" && stale.code, "IMPORT_REVIEW_STALE");
  assert.equal(stale.kind === "review" && stale.review.rows[0].before.netSalesCents, 7777);
  assert.equal((await records(ctx))[0].net_sales_cents, 7777); assert.equal((await imports(ctx)).length, 1);
});

// Run a competing commit after the service read but immediately before its atomic batch.
function intervene(hook: () => Promise<unknown>) {
  let used = false;
  return new Proxy(db, { get(target, property) {
    if (property === "batch") return async (statements: D1PreparedStatement[]) => { if (!used) { used = true; await hook(); } return target.batch(statements); };
    const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
  } });
}

test("a late concurrent correction rolls back every row, import claim and audit event", async () => {
  for (const becomesProvider of [false, true]) {
    const ctx = await workspace(); await save(ctx, input([row({ businessDate: "2026-09-02" })]));
    const rows = [row(), row({ businessDate: "2026-09-02", netSalesCents: 8000 })];
    const review = await save(ctx, input(rows)); if (review.kind !== "review") throw new Error("Review not returned");
    const request = input(rows, { replacement: { snapshot: review.review.snapshot, reason: "Correct day 2" } });
    const database = intervene(() => db.prepare("UPDATE daily_business_metrics SET net_sales_cents=7777,source_provider=?,source_connection_id=? WHERE organization_id=?")
      .bind(becomesProvider ? "moneris" : null, becomesProvider ? "new-connection" : null, ctx.organizationId).run());
    await assert.rejects(save(ctx, request, crypto.randomUUID(), database), code("IMPORT_REVIEW_STALE"));
    const saved = await records(ctx);
    assert.equal(saved.length, 1); assert.equal(saved[0].business_date, "2026-09-02"); assert.equal(saved[0].net_sales_cents, 7777);
    assert.equal(saved[0].source_provider, becomesProvider ? "moneris" : null);
    assert.equal((await imports(ctx)).length, 1); assert.equal((await audits(ctx)).length, 1);
  }
});

test("all-location and specific-location totals cannot silently overlap", async () => {
  for (const [existing, incoming] of [["all", "Main"], ["Main", "all"]]) {
    const ctx = await workspace(); await save(ctx, input([row({ locationRef: existing })]));
    await assert.rejects(save(ctx, input([row({ locationRef: incoming })])), code("IMPORT_LOCATION_SCOPE_CONFLICT"));
    assert.equal((await records(ctx)).length, 1);
  }
  assert.throws(() => input([row({ locationRef: "all" }), row()]), (error: unknown) => error instanceof ApiError && error.code === "IMPORT_OVERLAPPING_LOCATIONS");
  const ctx = await workspace();
  const database = intervene(() => save(ctx, input([row({ locationRef: "all" })])));
  await assert.rejects(save(ctx, input(), crypto.randomUUID(), database), code("IMPORT_REVIEW_STALE"));
  assert.equal((await records(ctx)).length, 1); assert.equal((await records(ctx))[0].location_ref, "all");
});

test("a concurrently committed identical request replays, but a changed payload with that key conflicts", async () => {
  for (const changed of [false, true]) {
    const ctx = await workspace(), key = crypto.randomUUID();
    const database = intervene(() => save(ctx, input([row({ netSalesCents: changed ? 7777 : 9000 })]), key));
    if (changed) await assert.rejects(save(ctx, input(), key, database), code("IDEMPOTENCY_KEY_CONFLICT"));
    else { const replay = await save(ctx, input(), key, database); assert.equal(replay.kind === "saved" && replay.replayed, true); }
    assert.equal((await imports(ctx)).length, 1); assert.equal((await audits(ctx)).length, 1); assert.equal((await records(ctx)).length, 1);
  }
});

test("replacement validation rejects missing reasons, forged shapes and out-of-date formats", () => {
  for (const replacement of [[], "yes", { snapshot: "a".repeat(64), reason: " " }, { snapshot: "bad", reason: "Correction" }, { snapshot: "a".repeat(64), reason: "Correction", override: true }]) {
    assert.throws(() => input([row()], { replacement }));
  }
});

test("Drizzle reads import, metric and correction audit timestamps in the current time window", async () => {
  const ctx = await workspace();
  const earliest = Math.floor(Date.now() / 1000) * 1000;
  await save(ctx);
  const orm = drizzle(db);
  const [original] = await orm.select({ createdAt: dailyBusinessMetrics.createdAt }).from(dailyBusinessMetrics)
    .where(eq(dailyBusinessMetrics.organizationId, ctx.organizationId));
  const review = await save(ctx, input([row({ netSalesCents: 8000 })]));
  if (review.kind !== "review") throw new Error("Review not returned");
  await save(ctx, input([row({ netSalesCents: 8000 })], { replacement: { snapshot: review.review.snapshot, reason: "Corrected source report" } }));
  const importRows = await orm.select({ createdAt: dataImports.createdAt }).from(dataImports).where(eq(dataImports.organizationId, ctx.organizationId));
  const [metric] = await orm.select({ createdAt: dailyBusinessMetrics.createdAt, updatedAt: dailyBusinessMetrics.updatedAt }).from(dailyBusinessMetrics)
    .where(eq(dailyBusinessMetrics.organizationId, ctx.organizationId));
  const auditRows = await orm.select({ createdAt: auditEvents.createdAt }).from(auditEvents).where(eq(auditEvents.organizationId, ctx.organizationId));
  assert.equal(importRows.length, 2); assert.equal(auditRows.length, 3);
  assert.equal(metric.createdAt.getTime(), original.createdAt.getTime());
  const latest = Date.now();
  for (const value of [...importRows.map(row => row.createdAt), metric.createdAt, metric.updatedAt, ...auditRows.map(row => row.createdAt)]) {
    assert.ok(value instanceof Date);
    assert.ok(value.getTime() >= earliest && value.getTime() <= latest, "Unexpected timestamp: " + value.toISOString());
  }
});
