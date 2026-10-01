import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { persistStripeSubscription } from "../server/billing/synchronize.ts";
import type { NormalizedBillingSubscription } from "../server/billing/stripe.ts";
import { resolveSubscriptionEntitlements } from "../server/entitlements/engine.ts";
import { SUBSCRIPTION_TRIAL_POLICY, SUBSCRIPTION_TRIAL_SECONDS } from "../shared/subscription-trial.ts";

test("D1 trial lifecycle binds checkout, caps expiry, waits for paid conversion, revokes and prevents another trial", async () => {
  const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('ok')}}", d1Databases: ["DB"] });
  try {
    const db = await mf.getD1Database("DB") as unknown as D1Database;
    for (const file of (await readdir(new URL("../drizzle/", import.meta.url))).filter(file => /^\d{4}.*\.sql$/.test(file)).sort()) {
      const sql = await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8");
      for (const statement of sql.split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean)) await db.prepare(statement).run();
    }
    const start = Math.floor(Date.now() / 1000) - 5, end = start + SUBSCRIPTION_TRIAL_SECONDS;
    const attemptId = crypto.randomUUID();
    for (const org of ["trial", "standalone", "other"]) {
      await db.prepare(`INSERT INTO workspaces (id,owner_name,business_name,legal_name,business_email,industry,city,address,postal_code,hours_json,created_at,updated_at)
        VALUES (?,'Owner','Test','Test',?,'Retail','Edmonton','Test','T5A1A1','[]',?,?)`).bind(org, `${org}@example.invalid`, start, start).run();
      const fields = new URLSearchParams({ "subscription_data[trial_period_days]": "7", "subscription_data[metadata][vanteloq_trial_policy]": SUBSCRIPTION_TRIAL_POLICY,
        "subscription_data[metadata][vanteloq_organization_id]": org, payment_method_collection: "always", expires_at: String(start + 3600) });
      if (org !== "other") await db.prepare("INSERT INTO billing_checkout_attempts VALUES (?,?,?,?,?,?)")
        .bind(org, org === "trial" ? attemptId : "standalone-attempt", "test", fields.toString(), "cs_test_trial123456", start).run();
    }
    let event = 0;
    const trial: NormalizedBillingSubscription = { organizationId: "trial", customerId: "cus_trial123456", subscriptionId: "sub_trial123456", basePlan: "growth", billingInterval: "month", status: "trialing", basePriceId: "price_trial123456",
      trialStartsAt: new Date(start * 1000), trialEndsAt: new Date(end * 1000), trialPolicy: SUBSCRIPTION_TRIAL_POLICY, checkoutAttemptId: attemptId, currentPeriodEndsAt: new Date(end * 1000), cancelAtPeriodEnd: false,
      addon: { key: "bookloq", itemId: "si_bookloq123456", priceId: "price_addon123456", currentPeriodEndsAt: new Date(end * 1000) } };
    async function sync(subscription: NormalizedBillingSubscription, expectedVersion: number) {
      const number = ++event, eventId = `evt_trial${String(number).padStart(8, "0")}`;
      await db.prepare("INSERT INTO stripe_billing_events(event_id,event_type,stripe_created_at,payload_hash,status,received_at) VALUES (?,'customer.subscription.updated',?,'test','processing',?)").bind(eventId, start + number, start).run();
      return persistStripeSubscription(db, { subscription, eventId, eventCreated: start + number, expectedVersion });
    }
    async function read(org = "trial", now = start * 1000) {
      const row = await db.prepare("SELECT * FROM tenant_subscriptions WHERE organization_id=?").bind(org).first<Record<string, unknown>>();
      assert.ok(row);
      const addons = await db.prepare("SELECT status FROM tenant_addons WHERE organization_id=?").bind(org).all<{ status: string }>();
      const addonRows = addons.results ?? [];
      const toDate = (value: unknown) => typeof value === "number" ? new Date(value * 1000) : null;
      return { row, addons: addonRows, access: resolveSubscriptionEntitlements({ basePlan: row.base_plan as "growth" | "bookloq", status: row.status as "trialing", addons: addonRows.some(row => ["active", "trialing"].includes(row.status)) ? ["bookloq"] : [],
        trialEndsAt: toDate(row.trial_ends_at), trialAccessEndsAt: toDate(row.trial_access_ends_at), trialConvertedAt: toDate(row.trial_converted_at), currentPeriodEndsAt: toDate(row.current_period_ends_at), cancelAtPeriodEnd: Boolean(row.cancel_at_period_end), scheduledBasePlan: null, scheduledEffectiveAt: null, version: Number(row.version) }, now) };
    }
    await sync(trial, 0);
    const first = await read();
    assert.equal(first.row.trial_access_ends_at, end);
    assert.equal(first.access.accessType, "subscription");
    assert.equal(first.access.features.includes("bookloq"), true);
    assert.equal(first.addons[0].status, "trialing");
    assert.equal((await read("trial", end * 1000)).access.accessType, "none", "expiry does not depend on a webhook");
    await sync({ ...trial, trialEndsAt: new Date((end + 86400 * 30) * 1000) }, 1);
    assert.equal((await read()).row.trial_access_ends_at, end);
    assert.equal((await read("trial", end * 1000)).access.accessType, "none", "provider extension is bounded");
    await sync({ ...trial, status: "active", paidInvoicePeriodEndsAt: new Date(end * 1000) }, 2);
    assert.equal((await read()).access.accessType, "none", "zero-dollar opening invoice is not a paid conversion");
    await sync({ ...trial, status: "past_due" }, 3);
    assert.equal((await read()).access.accessType, "none");
    await sync({ ...trial, status: "active", paidInvoicePeriodEndsAt: new Date((end + 30 * 86400) * 1000) }, 4);
    assert.equal((await read()).access.accessType, "subscription");
    assert.ok((await read()).row.trial_converted_at);
    await sync({ ...trial, status: "canceled" }, 5);
    assert.equal((await read()).access.accessType, "none");
    await assert.rejects(sync({ ...trial, subscriptionId: "sub_secondtrial123" }, 6), /verified first checkout/);
    assert.equal((await read()).row.stripe_subscription_id, trial.subscriptionId);
    await sync({ ...trial, subscriptionId: "sub_paidreturn123", status: "active", trialPolicy: "", trialStartsAt: null, trialEndsAt: null, addon: null }, 6);
    const returning = await read();
    assert.equal(returning.access.accessType, "subscription");
    assert.equal(returning.row.trial_access_ends_at, null);
    assert.equal(returning.access.features.includes("bookloq"), false);
    await assert.rejects(sync({ ...trial, organizationId: "other", customerId: "cus_other123456" }, 0), /verified first checkout/);
    assert.equal(await db.prepare("SELECT organization_id FROM tenant_subscriptions WHERE organization_id='other'").first(), null);
    await sync({ ...trial, organizationId: "standalone", customerId: "cus_standalone123", subscriptionId: "sub_standalone123", basePlan: "bookloq", checkoutAttemptId: "standalone-attempt", addon: null }, 0);
    const standalone = await read("standalone");
    assert.equal(standalone.access.features.includes("bookloq"), true);
    assert.equal(standalone.access.features.includes("inventory.basic"), false);
    assert.equal(standalone.addons.length, 0);
  } finally { await mf.dispose(); }
});
