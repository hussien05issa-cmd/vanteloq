import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { Miniflare } from "miniflare";
import { authorizeEmailDelivery } from "../server/document-email.ts";
import { DOCUMENT_EMAIL_NOTICE_VERSION } from "../shared/document-email.ts";

async function migrate(database) {
  const migrations = (await readdir(new URL("../drizzle/", import.meta.url)))
    .filter((file) => /^\d{4}.*\.sql$/.test(file))
    .sort();
  for (const migration of migrations) {
    const sql = await readFile(new URL(`../drizzle/${migration}`, import.meta.url), "utf8");
    for (const statement of sql.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
      await database.prepare(statement).run();
    }
  }
}

async function seedWorkspace(database, organizationId, basePlan) {
  const now = Math.floor(Date.now() / 1000);
  const alias = `inbox-${organizationId[0].repeat(48)}@documents.vanteloq.com`;
  await database.batch([
    database.prepare(`INSERT INTO users
      (id,email,display_name,status,auth_subject,auth_provider,created_at,updated_at)
      VALUES(?,?,?,'active',?,'supabase',?,?)`)
      .bind(organizationId, `${organizationId}@example.invalid`, organizationId, `subject-${organizationId}`, now, now),
    database.prepare(`INSERT INTO workspaces
      (id,owner_name,business_name,legal_name,business_email,industry,city,address,postal_code,hours_json,created_at,updated_at)
      VALUES(?,?,?,?,?,'Retail','Edmonton','Fictional','T5A1A1','[]',?,?)`)
      .bind(organizationId, organizationId, organizationId, organizationId, `${organizationId}@example.invalid`, now, now),
    database.prepare(`INSERT INTO memberships
      (id,user_id,organization_id,role,status,created_at,updated_at)
      VALUES(?,?,?,'owner','active',?,?)`)
      .bind(organizationId, organizationId, organizationId, now, now),
    database.prepare(`INSERT INTO tenant_subscriptions
      (organization_id,base_plan,billing_interval,status,version,created_at,updated_at)
      VALUES(?,?,'month','active',1,?,?)`)
      .bind(organizationId, basePlan, now, now),
    database.prepare(`INSERT INTO document_email_aliases
      (organization_id,alias,enabled,authorized_by_user_id,auth_subject,consent_version,consented_at,generation,created_at,updated_at)
      VALUES(?,?,1,?,?,?,?,?,?,?)`)
      .bind(organizationId, alias, organizationId, `subject-${organizationId}`, DOCUMENT_EMAIL_NOTICE_VERSION, now, `generation-${organizationId}`, now, now),
  ]);
  return database.prepare("SELECT * FROM document_email_aliases WHERE organization_id=?")
    .bind(organizationId).first();
}

async function durableGuardAllows(database, authorization) {
  const row = await database.prepare(`SELECT 1 allowed WHERE ${authorization.guard.sql}`)
    .bind(...authorization.guard.values).first();
  return row?.allowed === 1;
}

test("document forwarding durable guard recognizes an active standalone BookLoQ plan without an add-on row", async () => {
  const runtime = new Miniflare({
    modules: true,
    script: "export default {fetch(){return new Response('ok')}}",
    d1Databases: { DB: `document-email-standalone-${crypto.randomUUID()}` },
  });
  const old = globalThis.__vanteloqEnv;
  try {
    const database = await runtime.getD1Database("DB");
    globalThis.__vanteloqEnv = { DB: database };
    await migrate(database);
    const alias = await seedWorkspace(database, "standalone", "bookloq");

    assert.equal(
      (await database.prepare("SELECT count(*) count FROM tenant_addons WHERE organization_id=?")
        .bind("standalone").first())?.count,
      0,
    );
    const authorization = await authorizeEmailDelivery(database, alias);
    assert.equal(await durableGuardAllows(database, authorization), true);

    await database.prepare("UPDATE tenant_subscriptions SET status='canceled' WHERE organization_id=?")
      .bind("standalone").run();
    assert.equal(await durableGuardAllows(database, authorization), false, "revoked subscriptions fail closed");
  } finally {
    globalThis.__vanteloqEnv = old;
    await runtime.dispose();
  }
});

test("document forwarding durable guard keeps add-on access tenant scoped", async () => {
  const runtime = new Miniflare({
    modules: true,
    script: "export default {fetch(){return new Response('ok')}}",
    d1Databases: { DB: `document-email-addon-${crypto.randomUUID()}` },
  });
  const old = globalThis.__vanteloqEnv;
  try {
    const database = await runtime.getD1Database("DB");
    globalThis.__vanteloqEnv = { DB: database };
    await migrate(database);
    const alias = await seedWorkspace(database, "addon", "pro");
    await seedWorkspace(database, "foreign", "pro");
    const now = Math.floor(Date.now() / 1000);
    await database.batch([
      database.prepare(`INSERT INTO tenant_addons
        (id,organization_id,addon_key,status,created_at,updated_at)
        VALUES('addon-own','addon','bookloq','active',?,?)`).bind(now, now),
      database.prepare(`INSERT INTO tenant_addons
        (id,organization_id,addon_key,status,created_at,updated_at)
        VALUES('addon-foreign','foreign','bookloq','active',?,?)`).bind(now, now),
    ]);

    const authorization = await authorizeEmailDelivery(database, alias);
    assert.equal(await durableGuardAllows(database, authorization), true);

    await database.prepare("DELETE FROM tenant_addons WHERE organization_id='addon'").run();
    assert.equal(
      await durableGuardAllows(database, authorization),
      false,
      "another tenant's active BookLoQ add-on cannot authorize this workspace",
    );
  } finally {
    globalThis.__vanteloqEnv = old;
    await runtime.dispose();
  }
});
