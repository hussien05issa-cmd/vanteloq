import assert from "node:assert/strict";
import test from "node:test";
import { Miniflare } from "miniflare";
import { readFile } from "node:fs/promises";
import { FREE_PLAN, PLANS, isPlanKey } from "../server/entitlements/catalog.ts";
import { resolveFreeEntitlements, requireFeatureEntitlement } from "../server/entitlements/engine.ts";
import { reserveFreeUsage, freeUsagePeriod } from "../server/entitlements/free.ts";
import { billingGateState } from "../shared/signup-funnel.ts";
import { parsePlanSelection, planSelectionUrl } from "../shared/plan-selection.ts";

test("Free opens without Stripe while premium features and paid prices stay separate", () => {
  const access = resolveFreeEntitlements();
  assert.equal(billingGateState({accessType: access.accessType, configured:false}), "ready");
  assert.equal(isPlanKey("free"), false);
  assert.equal(Object.hasOwn(PLANS, "free"), false);
  assert.equal(access.plan, "free");
  assert.equal(access.limits?.users, 1);
  assert.equal(access.limits?.activeLocations, 1);
  for (const feature of ["analytics.sales.basic", "dashboard.core", "business.settings", "ai.basic"] as const) requireFeatureEntitlement(access,feature);
  for (const feature of ["bookloq", "forecasting.revenue", "pos.reporting.core", "inventory.lots", "reporting.exports", "permissions.standard"] as const)
    assert.throws(() => requireFeatureEntitlement(access,feature));
  assert.deepEqual(parsePlanSelection("free","1"), {plan:"free",bookloq:false});
  assert.equal(planSelectionUrl({plan:"free",bookloq:true}), "/?start=signup&plan=free");
});

test("monthly reservations reject concurrent excess, refund failures and isolate workspaces", async () => {
  const mf = new Miniflare({modules:true, script:"export default {fetch(){return new Response('ok')}}", d1Databases:{DB:crypto.randomUUID()}});
  try {
    const db = await mf.getD1Database("DB") as unknown as D1Database;
    await db.prepare("CREATE TABLE workspaces(id TEXT PRIMARY KEY)").run();
    for (const statement of (await readFile(new URL("../drizzle/0068_old_sentinel.sql",import.meta.url),"utf8")).split("--> statement-breakpoint"))
      if(statement.trim()) await db.prepare(statement.trim()).run();
    await db.prepare("INSERT INTO workspaces(id) VALUES ('one'),('two')").run();
    const now = new Date("2026-10-15T12:00:00Z");
    const results = await Promise.allSettled(Array.from({length:20},() => reserveFreeUsage(db,"one","ai_replies",1,now)));
    assert.equal(results.filter(result => result.status === "fulfilled").length,10);
    const rejected = results.filter(result => result.status === "rejected");
    assert.equal(rejected.length,10);
    assert.equal((rejected[0] as PromiseRejectedResult).reason.code,"FREE_PLAN_LIMIT_REACHED");
    const first = results.find(result => result.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof reserveFreeUsage>>>;
    await first.value.release(); await first.value.release();
    await reserveFreeUsage(db,"one","ai_replies",1,now);
    await assert.rejects(reserveFreeUsage(db,"one","ai_replies",1,now));
    await reserveFreeUsage(db,"two","ai_replies",1,now);
    await reserveFreeUsage(db,"one","ai_replies",1,new Date("2026-11-01T00:00:00Z"));
    const importReservation = await reserveFreeUsage(db,"one","import_rows",FREE_PLAN.importRowsPerMonth,now);
    await assert.rejects(reserveFreeUsage(db,"one","import_rows",1,now));
    await importReservation.release();
    await assert.rejects(reserveFreeUsage(db,"one","import_rows",101,now));
    await reserveFreeUsage(db,"one","import_rows",100,now);
    await db.prepare("DELETE FROM workspaces WHERE id='one'").run();
    assert.equal((await db.prepare("SELECT COUNT(*) total FROM free_plan_usage WHERE organization_id='one'").first<{total:number}>())?.total,0);
    assert.equal(freeUsagePeriod(new Date("2026-12-31T23:59:59Z")).resetsAt,"2027-01-01T00:00:00.000Z");
  } finally { await mf.dispose(); }
});
