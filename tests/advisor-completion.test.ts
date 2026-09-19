import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { captureAdvisorAuthority, assertAdvisorAuthority, completeAdvisorTurn, type AdvisorAuthorityActor } from "../server/advisor-completion";
import { SESSION_IDLE_MS } from "../shared/session-policy";

async function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  const database = {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      let args: Array<string | number | null> = [];
      return {
        bind(...values: Array<string | number | null>) { args = values; return this; },
        async run() { return { success: true, meta: statement.run(...args) }; },
        async first() { return statement.get(...args) ?? null; },
        async all() { const results = statement.all(...args); return { success: true, results, meta: { changes: Number((sqlite.prepare("SELECT changes() n").get() as { n: number }).n) } }; },
      };
    },
    async batch(statements: Array<{ all: () => Promise<unknown> }>) {
      sqlite.exec("BEGIN");
      try { const result = []; for (const statement of statements) result.push(await statement.all()); sqlite.exec("COMMIT"); return result; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  for (const file of (await readdir("drizzle")).filter(name => /^\d{4}.*\.sql$/.test(name)).sort()) {
    for (const sql of (await readFile(`drizzle/${file}`, "utf8")).split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean)) sqlite.exec(sql);
  }
  const db = database as unknown as D1Database;
  const actors: AdvisorAuthorityActor[] = [];
  for (const suffix of ["a", "b"]) {
    const now = Date.now(), actor = { organizationId: `org-${suffix}`, userId: `user-${suffix}`, sessionId: `session-${suffix}`, role: "owner", subject: `subject-${suffix}` };
    await db.prepare("INSERT INTO users (id,email,auth_subject,auth_provider,display_name,status,created_at,updated_at) VALUES (?,?,?,'supabase','Test Owner','active',?,?)").bind(actor.userId, `${suffix}@example.invalid`, actor.subject, now, now).run();
    await db.prepare("INSERT INTO workspaces (id,owner_name,business_name,legal_name,business_email,industry,city,address,postal_code,hours_json,created_at,updated_at) VALUES (?,'Owner','Fictional','Fictional',?,'Retail','Edmonton','Test','T1T1T1','[]',?,?)").bind(actor.organizationId, `${suffix}@example.invalid`, now, now).run();
    await db.prepare("INSERT INTO memberships (id,user_id,organization_id,role,status,created_at,updated_at) VALUES (?,?,?,'owner','active',?,?)").bind(`membership-${suffix}`, actor.userId, actor.organizationId, now, now).run();
    await db.prepare("INSERT INTO workspace_sessions (id,user_id,organization_id,started_at,last_seen_at,expires_at,revoked) VALUES (?,?,?,?,?,?,0)").bind(actor.sessionId, actor.userId, actor.organizationId, now, now, now + 3600000).run();
    await db.prepare("INSERT INTO integration_consents (id,organization_id,actor_user_id,provider,status,notice_version,privacy_policy_version,data_categories_json,purposes_json,consent_source,accepted_at,created_at,updated_at) VALUES (?,?,?,'openai','accepted','fixture-notice','fixture-policy','[]','[]','in_app',?,?,?)").bind(`consent-${suffix}`, actor.organizationId, actor.userId, now, now, now).run();
    await db.prepare("INSERT INTO tenant_subscriptions (organization_id,base_plan,status,created_at,updated_at) VALUES (?,'growth','active',?,?)").bind(actor.organizationId, now, now).run();
    actors.push(actor);
  }
  return { sqlite, db, a: actors[0], b: actors[1] };
}
const turn = (id: string, existing = false) => ({ conversationId: id, existing, question: "Fictional question", answer: "Fictional answer", model: "fixture", userEvidence: "{}", answerEvidence: "{}" });
const denied = (error: unknown) => (error as { code?: string }).code === "ADVISOR_CONTEXT_CHANGED";
const count = async (db: D1Database, table: string) => Number((await db.prepare(`SELECT COUNT(*) n FROM ${table}`).first<{ n: number }>())?.n);

test("authorized completions preserve exact paired history and memory-off writes nothing", async () => {
  const { sqlite, db, a } = await fixture();
  try {
    const stamp = await captureAdvisorAuthority(db, a);
    await completeAdvisorTurn(db, a, stamp, null);
    assert.equal(await count(db, "assistant_messages"), 0);
    await completeAdvisorTurn(db, a, stamp, turn("conversation-a"));
    await completeAdvisorTurn(db, a, stamp, turn("conversation-a", true));
    assert.equal(await count(db, "assistant_conversations"), 1);
    const rows = await db.prepare("SELECT role,content FROM assistant_messages ORDER BY created_at,rowid").all<{ role: string; content: string }>();
    assert.ok(rows.results);
    assert.deepEqual(rows.results.map(row => row.role), ["user", "assistant", "user", "assistant"]);
    assert.equal(rows.results[1].content, "Fictional answer");
  } finally { sqlite.close(); }
});

test("withdrawal after a successful read fence atomically blocks new history", async () => {
  const { sqlite, db, a } = await fixture();
  try {
    const stamp = await captureAdvisorAuthority(db, a);
    await assertAdvisorAuthority(db, a, stamp);
    await db.prepare("UPDATE integration_consents SET status='withdrawn' WHERE actor_user_id=?").bind(a.userId).run();
    await assert.rejects(completeAdvisorTurn(db, a, stamp, turn("withdrawn")), denied);
    await assert.rejects(completeAdvisorTurn(db, a, stamp, null), denied);
    assert.equal(await count(db, "assistant_messages"), 0);
    assert.equal(await count(db, "assistant_conversations"), 0);
    await db.prepare("UPDATE integration_consents SET id='new-consent',status='accepted' WHERE actor_user_id=?").bind(a.userId).run();
    await assert.rejects(completeAdvisorTurn(db, a, stamp, turn("reaccepted")), denied);
  } finally { sqlite.close(); }
});

test("suspension, role changes, plan removal and session revocation invalidate both response and memory", async () => {
  for (const change of [
    "UPDATE memberships SET status='suspended' WHERE user_id='user-a'",
    "UPDATE memberships SET role='read_only' WHERE user_id='user-a'",
    "UPDATE tenant_subscriptions SET status='paused' WHERE organization_id='org-a'",
    "UPDATE workspace_sessions SET revoked=1 WHERE user_id='user-a'",
    "UPDATE users SET auth_subject='different-subject' WHERE id='user-a'",
  ]) {
    const { sqlite, db, a } = await fixture();
    try {
      const stamp = await captureAdvisorAuthority(db, a);
      await db.prepare(change).run();
      await assert.rejects(completeAdvisorTurn(db, a, stamp, null), denied);
      await assert.rejects(completeAdvisorTurn(db, a, stamp, turn("blocked")), denied);
      assert.equal(await count(db, "assistant_messages"), 0);
      assert.equal(await count(db, "assistant_conversations"), 0);
    } finally { sqlite.close(); }
  }
});

test("live permission and location edits are fenced without invalidating unrelated tenants", async () => {
  const { sqlite, db, a, b } = await fixture();
  try {
    await db.prepare("INSERT INTO access_roles (id,organization_id,name,description,color,permissions_json,location_scope_json,archived,created_by_user_id,created_at,updated_at) VALUES ('role-a','org-a','Reader','','#245fce','[\"insights.view\",\"metrics.revenue\"]','[]',0,'user-a',1,1)").run();
    await db.prepare("INSERT INTO team_members (id,organization_id,user_id,role_id,first_name,last_name,email,employee_code,status,remote_login,created_by_user_id,created_at,updated_at) VALUES ('team-a','org-a','user-a','role-a','Test','Owner','a@example.invalid','A','active',1,'user-a',1,1)").run();
    const stampA = await captureAdvisorAuthority(db, a), stampB = await captureAdvisorAuthority(db, b);
    await db.prepare("UPDATE access_roles SET permissions_json='[]',location_scope_json='[\"restricted\"]' WHERE id='role-a'").run();
    await assert.rejects(completeAdvisorTurn(db, a, stampA, turn("role-changed")), denied);
    await completeAdvisorTurn(db, b, stampB, turn("tenant-b"));
    assert.equal(await count(db, "assistant_messages"), 2);
    await assert.rejects(captureAdvisorAuthority(db, { ...a, organizationId: b.organizationId }), denied);
  } finally { sqlite.close(); }
});

test("an expired idle session and a deleted conversation cannot be revived by a late answer", async () => {
  const { sqlite, db, a } = await fixture();
  try {
    const stamp = await captureAdvisorAuthority(db, a);
    await completeAdvisorTurn(db, a, stamp, turn("deleted"));
    await db.prepare("DELETE FROM assistant_conversations WHERE id='deleted'").run();
    await assert.rejects(completeAdvisorTurn(db, a, stamp, turn("deleted", true)), denied);
    assert.equal(await count(db, "assistant_messages"), 0);
    await db.prepare("UPDATE workspace_sessions SET last_seen_at=? WHERE id=?").bind(Date.now() - SESSION_IDLE_MS - 2000, a.sessionId).run();
    await assert.rejects(completeAdvisorTurn(db, a, stamp, null), denied);
  } finally { sqlite.close(); }
});

test("a changed business resource selection is fenced while ordinary source refresh is allowed", async () => {
  const { sqlite, db, a } = await fixture();
  try {
    await db.prepare("INSERT INTO integration_connections (id,organization_id,provider,status,data_promotion_status,created_at,updated_at) VALUES ('marketing-a','org-a','google-marketing','connected','approved',1,1)").run();
    const stamp = await captureAdvisorAuthority(db, a);
    await db.prepare("UPDATE integration_connections SET sync_version=sync_version+1,last_successful_sync_at=2 WHERE id='marketing-a'").run();
    await assertAdvisorAuthority(db, a, stamp);
    await db.prepare("UPDATE integration_connections SET resource_selection_version=resource_selection_version+1 WHERE id='marketing-a'").run();
    await assert.rejects(completeAdvisorTurn(db, a, stamp, null), denied);
    await assert.rejects(completeAdvisorTurn(db, a, stamp, turn("different-resource")), denied);
    assert.equal(await count(db, "assistant_messages"), 0);
  } finally { sqlite.close(); }
});

async function approvedRSource(db: D1Database, provider = "lightspeed-r") {
  await db.prepare("INSERT INTO integration_connections (id,organization_id,provider,status,data_promotion_status,source_namespace,created_at,updated_at) VALUES ('retail-a','org-a',?,'connected','approved','source-a',1,1)").bind(provider).run();
}

async function stageAuthorizedRRefresh(db: D1Database) {
  const now = Math.floor(Date.now() / 1000);
  await db.prepare("UPDATE integration_connections SET data_promotion_status='staging',promotion_authorized_at=?,sync_lease_owner='fixture-refresh',sync_lease_expires_at=?,sync_version=sync_version+1 WHERE id='retail-a'").bind(now, now + 300).run();
}

test("an authorized R-Series publication does not discard already-permitted replies or paired history", async () => {
  const { sqlite, db, a } = await fixture();
  try {
    await approvedRSource(db);
    const stamp = await captureAdvisorAuthority(db, a);
    await stageAuthorizedRRefresh(db);
    await assertAdvisorAuthority(db, a, stamp);
    await completeAdvisorTurn(db, a, stamp, null);
    await completeAdvisorTurn(db, a, stamp, turn("during-publication"));
    assert.equal(await count(db, "assistant_messages"), 2);
    await db.prepare("UPDATE integration_connections SET data_promotion_status='approved',promotion_authorized_at=NULL,sync_lease_owner=NULL,sync_lease_expires_at=NULL,last_successful_sync_at=? WHERE id='retail-a'").bind(Math.floor(Date.now() / 1000)).run();
    await completeAdvisorTurn(db, a, stamp, null);
  } finally { sqlite.close(); }
});

test("source exclusions, failed refreshes and unrelated provider staging remain fenced", async () => {
  for (const change of [
    "promotion_authorized_at=NULL",
    "sync_lease_owner=NULL",
    "sync_lease_expires_at=NULL",
    "sync_lease_expires_at=1",
    "last_error_code='LIGHTSPEED_R_SYNC_FAILED'",
    "data_promotion_status='blocked'",
    "status='revoked'",
    "source_namespace='another-source'",
    "resource_selection_version=resource_selection_version+1",
  ]) {
    const { sqlite, db, a } = await fixture();
    try {
      await approvedRSource(db);
      const stamp = await captureAdvisorAuthority(db, a);
      await stageAuthorizedRRefresh(db);
      await db.prepare(`UPDATE integration_connections SET ${change} WHERE id='retail-a'`).run();
      await assert.rejects(assertAdvisorAuthority(db, a, stamp), denied, change);
      await assert.rejects(completeAdvisorTurn(db, a, stamp, null), denied, change);
      await assert.rejects(completeAdvisorTurn(db, a, stamp, turn("blocked-source")), denied, change);
      assert.equal(await count(db, "assistant_messages"), 0);
      assert.equal(await count(db, "assistant_conversations"), 0);
    } finally { sqlite.close(); }
  }
  const { sqlite, db, a } = await fixture();
  try {
    await approvedRSource(db, "square");
    const stamp = await captureAdvisorAuthority(db, a);
    await stageAuthorizedRRefresh(db);
    await assert.rejects(completeAdvisorTurn(db, a, stamp, null), denied);
  } finally { sqlite.close(); }
});

test("a transient source refresh cannot mask access, privacy, location or source-authority changes", async () => {
  for (const change of [
    "UPDATE memberships SET status='suspended' WHERE user_id='user-a'",
    "UPDATE memberships SET role='read_only' WHERE user_id='user-a'",
    "UPDATE integration_consents SET status='withdrawn' WHERE actor_user_id='user-a'",
    "UPDATE tenant_subscriptions SET status='paused' WHERE organization_id='org-a'",
    "UPDATE workspace_sessions SET revoked=1 WHERE user_id='user-a'",
    "UPDATE organization_locations SET status='archived' WHERE id='location-a'",
    "UPDATE integration_location_mappings SET status='ignored' WHERE id='mapping-a'",
    "UPDATE integration_source_authorities SET version=version+1 WHERE id='authority-a'",
  ]) {
    const { sqlite, db, a } = await fixture();
    try {
      await approvedRSource(db);
      await db.prepare("INSERT INTO organization_locations (id,organization_id,name,country_code,address_line_1,locality,administrative_area,timezone,currency,created_at,updated_at) VALUES ('location-a','org-a','Fictional location','CA','Test','Edmonton','AB','America/Edmonton','CAD',1,1)").run();
      await db.prepare("INSERT INTO integration_location_mappings (id,organization_id,provider,connection_id,external_location_ref,external_name,local_location_id,status,last_seen_at,created_at,updated_at) VALUES ('mapping-a','org-a','lightspeed-r','retail-a','1','Test shop','location-a','mapped',1,1,1)").run();
      await db.prepare("INSERT INTO integration_source_authorities (id,organization_id,local_location_id,channel,fact_family,provider,connection_id,created_by_user_id,updated_by_user_id,created_at,updated_at) VALUES ('authority-a','org-a','location-a','retail','sales','lightspeed-r','retail-a','user-a','user-a',1,1)").run();
      const stamp = await captureAdvisorAuthority(db, a);
      await stageAuthorizedRRefresh(db);
      await db.prepare(change).run();
      await assert.rejects(completeAdvisorTurn(db, a, stamp, null), denied, change);
      await assert.rejects(completeAdvisorTurn(db, a, stamp, turn("blocked-authority")), denied, change);
      assert.equal(await count(db, "assistant_messages"), 0);
    } finally { sqlite.close(); }
  }
});

test("a failed message insert rolls back the conversation row", async () => {
  const { sqlite, db, a } = await fixture();
  try {
    const stamp = await captureAdvisorAuthority(db, a);
    sqlite.exec("CREATE TRIGGER fail_memory BEFORE INSERT ON assistant_messages BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
    await assert.rejects(completeAdvisorTurn(db, a, stamp, turn("failed-write")), /fixture failure/);
    assert.equal(await count(db, "assistant_conversations"), 0);
    assert.equal(await count(db, "assistant_messages"), 0);
  } finally { sqlite.close(); }
});
