import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { Miniflare } from "miniflare";

function statements(sql) {
  return sql.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean);
}

async function applyMigration(database, file) {
  const sql = await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8");
  await database.batch(statements(sql).map((statement) => database.prepare(statement)));
}

test("the founder migration preserves populated foreign-key relationships", async () => {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: `vanteloq-incremental-${crypto.randomUUID()}` },
  });
  try {
    const database = await miniflare.getD1Database("DB");
    const migrations = (await readdir(new URL("../drizzle/", import.meta.url)))
      .filter((file) => /^\d{4}.*\.sql$/.test(file))
      .sort();
    for (const migration of migrations.filter((file) => file < "0014")) await applyMigration(database, migration);

    const now = Date.now();
    await database.batch([
      database.prepare(`INSERT INTO users (id, email, display_name, status, created_at, updated_at)
        VALUES ('existing-user', 'existing@example.invalid', 'Existing Owner', 'active', ?, ?)`).bind(now, now),
      database.prepare(`INSERT INTO workspaces
        (id, owner_name, business_name, legal_name, business_email, phone, website, industry, country,
         province, city, address, postal_code, timezone, currency, fiscal_year_start, tax_number,
         hours_json, source_mode, selected_pos, setup_complete, created_at, updated_at)
        VALUES ('existing-workspace', 'Existing Owner', 'Existing Store', 'Existing Store Ltd.',
         'store@example.invalid', '', '', 'Retail', 'CA', 'AB', 'Edmonton', '1 Existing Avenue',
         'T5A 1A1', 'America/Edmonton', 'CAD', 'January', '', '[]', 'connect_later', '', 1, ?, ?)`).bind(now, now),
      database.prepare(`INSERT INTO memberships
        (id, user_id, organization_id, role, status, created_at, updated_at)
        VALUES ('existing-membership', 'existing-user', 'existing-workspace', 'owner', 'active', ?, ?)`).bind(now, now),
    ]);

    await applyMigration(database, migrations.find((file) => file.startsWith("0014_")));

    const membership = await database.prepare("SELECT user_id, organization_id FROM memberships WHERE id = 'existing-membership'").first();
    const user = await database.prepare("SELECT id, auth_subject, auth_provider FROM users WHERE id = 'existing-user'").first();
    assert.deepEqual(membership, { user_id: "existing-user", organization_id: "existing-workspace" });
    assert.deepEqual(user, { id: "existing-user", auth_subject: null, auth_provider: null });
    assert.equal((await database.prepare("PRAGMA foreign_key_check").all()).results.length, 0);
  } finally {
    await miniflare.dispose();
  }
});
