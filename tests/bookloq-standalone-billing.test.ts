import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { Miniflare } from "miniflare";
import type { NormalizedBillingSubscription } from "../server/billing/stripe.ts";
import { persistStripeSubscription } from "../server/billing/synchronize.ts";

async function applyMigration(database: D1Database, file: string) {
  const sql = await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8");
  for (const statement of sql.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
    await database.prepare(statement).run();
  }
}

function standalone(organizationId: string, subscriptionId: string): NormalizedBillingSubscription {
  return {
    organizationId,
    customerId: `cus_${organizationId.replaceAll("-", "")}12345678`,
    subscriptionId,
    basePlan: "bookloq",
    billingInterval: "month",
    status: "active",
    basePriceId: "price_bookloqstandalone12345678",
    trialEndsAt: null,
    currentPeriodEndsAt: new Date("2026-10-19T00:00:00.000Z"),
    cancelAtPeriodEnd: false,
    addon: null,
  };
}

test("the standalone migration preserves subscribers and synchronization stores no fake add-on row", async () => {
  const runtime = new Miniflare({
    modules: true,
    script: "export default {fetch(){return new Response('ok')}}",
    d1Databases: { DB: `bookloq-standalone-${crypto.randomUUID()}` },
  });
  try {
    const database = await runtime.getD1Database("DB");
    const migrations = (await readdir(new URL("../drizzle/", import.meta.url)))
      .filter((file) => /^\d{4}.*\.sql$/.test(file))
      .sort();
    for (const migration of migrations.filter((file) => file < "0059_")) await applyMigration(database, migration);

    const now = 1_789_790_400;
    await database.batch([
      database.prepare(`INSERT INTO workspaces
        (id,owner_name,business_name,legal_name,business_email,industry,city,address,postal_code,hours_json,created_at,updated_at)
        VALUES ('existing','Owner','Existing','Existing','existing@example.invalid','Retail','Edmonton','Test','T5A1A1','[]',?,?)`).bind(now, now),
      database.prepare(`INSERT INTO tenant_subscriptions
        (organization_id,base_plan,billing_interval,status,stripe_customer_id,stripe_subscription_id,stripe_base_price_id,version,created_at,updated_at)
        VALUES ('existing','starter','month','active','cus_existing12345678','sub_existing12345678','price_starter12345678',1,?,?)`).bind(now, now),
      database.prepare(`INSERT INTO tenant_addons
        (id,organization_id,addon_key,status,stripe_subscription_item_id,stripe_price_id,created_at,updated_at)
        VALUES ('addon-existing','existing','bookloq','active','si_existing12345678','price_addon12345678',?,?)`).bind(now, now),
    ]);

    await applyMigration(database, "0059_bookloq_standalone_plan.sql");
    assert.deepEqual(
      await database.prepare("SELECT base_plan plan,status,version FROM tenant_subscriptions WHERE organization_id='existing'").first(),
      { plan: "starter", status: "active", version: 1 },
    );
    assert.equal((await database.prepare("SELECT COUNT(*) count FROM tenant_addons WHERE organization_id='existing'").first<{count:number}>())?.count, 1);
    await database.prepare("UPDATE tenant_subscriptions SET scheduled_base_plan='bookloq' WHERE organization_id='existing'").run();
    assert.equal((await database.prepare("SELECT scheduled_base_plan plan FROM tenant_subscriptions WHERE organization_id='existing'").first<{plan:string}>())?.plan, "bookloq");

    await database.prepare(`INSERT INTO stripe_billing_events
      (event_id,event_type,stripe_created_at,payload_hash,status,received_at)
      VALUES ('evt_existing12345678','customer.subscription.updated',?,'hash','processing',?)`).bind(now + 1, now + 1).run();
    const result = await persistStripeSubscription(database, {
      subscription: standalone("existing", "sub_existing12345678"),
      eventId: "evt_existing12345678",
      eventCreated: now + 1,
      expectedVersion: 1,
    });
    assert.equal(result, "synchronized");
    assert.deepEqual(
      await database.prepare("SELECT base_plan plan,scheduled_base_plan scheduled,version FROM tenant_subscriptions WHERE organization_id='existing'").first(),
      { plan: "bookloq", scheduled: null, version: 2 },
    );
    assert.equal((await database.prepare("SELECT COUNT(*) count FROM tenant_addons WHERE organization_id='existing'").first<{count:number}>())?.count, 0);

    await database.batch([
      database.prepare(`INSERT INTO workspaces
        (id,owner_name,business_name,legal_name,business_email,industry,city,address,postal_code,hours_json,created_at,updated_at)
        VALUES ('new-bookloq','Owner','New BookLoQ','New BookLoQ','new@example.invalid','Retail','Edmonton','Test','T5A1A1','[]',?,?)`).bind(now, now),
      database.prepare(`INSERT INTO stripe_billing_events
        (event_id,event_type,stripe_created_at,payload_hash,status,received_at)
        VALUES ('evt_newbookloq123','customer.subscription.created',?,'hash','processing',?)`).bind(now + 2, now + 2),
    ]);
    assert.equal(await persistStripeSubscription(database, {
      subscription: standalone("new-bookloq", "sub_newbookloq1234"),
      eventId: "evt_newbookloq123",
      eventCreated: now + 2,
      expectedVersion: 0,
    }), "synchronized");
    assert.equal((await database.prepare("SELECT base_plan plan FROM tenant_subscriptions WHERE organization_id='new-bookloq'").first<{plan:string}>())?.plan, "bookloq");
    assert.equal((await database.prepare("SELECT COUNT(*) count FROM tenant_addons WHERE organization_id='new-bookloq'").first<{count:number}>())?.count, 0);
  } finally {
    await runtime.dispose();
  }
});
