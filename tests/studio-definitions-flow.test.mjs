import assert from "node:assert/strict";
import test from "node:test";
import { createEnvironment, createReportWorkspace, dispatch, seedReportConnection, seedReportMetric } from "./helpers/retail-worker-fixture.mjs";

const path = "/api/v1/data-studio/analyses";
const draft = { title: "Private saved analysis", app: "dashboards", scope: { from: "2026-10-01", to: "2026-10-02", location: null, connection: null }, content: { metric: "net_sales_cents", group: "business_date", chart: "line", pinned: true } };
async function expect(response, status) { assert.equal(response.status, status, await response.clone().text()); return response.json(); }

test("built Worker persists private definitions with scoped listing, CAS, and read-only protection", async () => {
  const f = await createEnvironment();
  try {
    const a = await createReportWorkspace(f.worker, f.environment, f.database, "studio-definition-a");
    const b = await createReportWorkspace(f.worker, f.environment, f.database, "studio-definition-b");
    const colleague = { email: `studio-definition-colleague-${crypto.randomUUID()}@example.invalid`, name: "Fictional administrator" }, colleagueId = crypto.randomUUID();
    await f.database.batch([
      f.database.prepare("INSERT INTO users(id,email,auth_subject,auth_provider,display_name,status,created_at,updated_at) VALUES (?,?,?,'supabase','Fixture','active',1,1)").bind(colleagueId, colleague.email, `test-user:${colleague.email}`),
      f.database.prepare("INSERT INTO memberships(id,organization_id,user_id,role,status,created_at,updated_at) VALUES (?,?,?,'admin','active',1,1)").bind(crypto.randomUUID(), a.organizationId, colleagueId),
    ]);
    const { analysis } = await expect(await dispatch(f.worker, f.environment, path, { ...a.owner, method: "POST", body: draft }), 201);
    assert.equal(analysis.version, 1); assert.equal(analysis.content.pinned, true);
    assert.deepEqual((await expect(await dispatch(f.worker, f.environment, `${path}?app=dashboards`, a.owner), 200)).analyses, [analysis]);
    for (const stranger of [b.owner, colleague]) {
      assert.deepEqual((await expect(await dispatch(f.worker, f.environment, path, stranger), 200)).analyses, []);
      await expect(await dispatch(f.worker, f.environment, path, { ...stranger, method: "POST", body: { ...draft, id: analysis.id, expectedVersion: 1 } }), 409);
      await expect(await dispatch(f.worker, f.environment, path, { ...stranger, method: "DELETE", body: { id: analysis.id, expectedVersion: 1 } }), 409);
    }
    const responses = await Promise.all(["First tab", "Second tab"].map(title => dispatch(f.worker, f.environment, path, { ...a.owner, method: "POST", body: { ...draft, title, id: analysis.id, expectedVersion: 1 } })));
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
    const stale = await expect(await dispatch(f.worker, f.environment, path, { ...a.owner, method: "DELETE", body: { id: analysis.id, expectedVersion: 1 } }), 409);
    assert.equal(stale.error.code, "STUDIO_DEFINITION_CONFLICT");
    await f.database.prepare("UPDATE memberships SET role='read_only' WHERE user_id=? AND organization_id=?").bind(a.userId, a.organizationId).run();
    assert.equal((await expect(await dispatch(f.worker, f.environment, path, a.owner), 200)).analyses[0].version, 2);
    await expect(await dispatch(f.worker, f.environment, path, { ...a.owner, method: "POST", body: draft }), 403);
    await expect(await dispatch(f.worker, f.environment, path, { ...a.owner, method: "DELETE", body: { id: analysis.id, expectedVersion: 2 } }), 403);
    await f.database.prepare("UPDATE memberships SET role='owner' WHERE user_id=? AND organization_id=?").bind(a.userId, a.organizationId).run();
    await expect(await dispatch(f.worker, f.environment, path, { ...a.owner, method: "DELETE", body: { id: analysis.id, expectedVersion: 2 } }), 200);
    assert.deepEqual((await expect(await dispatch(f.worker, f.environment, path, a.owner), 200)).analyses, []);
    assert.equal((await f.database.prepare("PRAGMA foreign_key_check").all()).results.length, 0);
  } finally { await f.dispose(); }
});

test("built Worker saves bounded sheet and SQL drafts without result persistence and hides a revoked source", async () => {
  const f = await createEnvironment();
  try {
    const a = await createReportWorkspace(f.worker, f.environment, f.database, "studio-definition-source");
    const connectionId = crypto.randomUUID(), namespace = crypto.randomUUID();
    const ref = await seedReportConnection(f.database, { ...a, connectionId, namespace, externalLocationRef: "fixture-outlet" });
    await seedReportMetric(f.database, { ...a, businessDate: "2026-10-01", locationRef: ref, sourceConnectionId: connectionId, netSalesCents: 12345 });
    const scope = { ...draft.scope, connection: connectionId };
    const sheet = { version: "studio-sheet-v1", title: "Assumptions", cells: [{ address: "A1", name: "Scenario factor", input: "1.1", format: "number" }] };
    const sql = "SELECT business_date, SUM(net_sales_cents) FROM sales GROUP BY business_date";
    const one = await expect(await dispatch(f.worker, f.environment, path, { ...a.owner, method: "POST", body: { ...draft, app: "sheets", scope, content: { sheet } } }), 201);
    await expect(await dispatch(f.worker, f.environment, path, { ...a.owner, method: "POST", body: { ...draft, app: "sql", scope, content: { sql } } }), 201);
    const stored = await f.database.prepare("SELECT content_json FROM studio_definitions WHERE organization_id=?").bind(a.organizationId).all();
    assert.doesNotMatch(JSON.stringify(stored.results), /12345|sourceConnectionId|netSalesCents|results|ledger/);
    const audit = await f.database.prepare("SELECT details_json FROM audit_events WHERE resource_type='studio_definition' AND organization_id=?").bind(a.organizationId).all();
    assert.doesNotMatch(JSON.stringify(audit.results), /SUM|Scenario factor|1\.1/);
    await expect(await dispatch(f.worker, f.environment, path, { ...a.owner, method: "POST", body: { ...draft, content: { sheet: { ...sheet, results: [12345] } } } }), 400);
    await f.database.prepare("UPDATE integration_connections SET status='revoked' WHERE id=? AND organization_id=?").bind(connectionId, a.organizationId).run();
    assert.deepEqual((await expect(await dispatch(f.worker, f.environment, path, a.owner), 200)).analyses, []);
    await expect(await dispatch(f.worker, f.environment, path, { ...a.owner, method: "POST", body: { ...draft, app: "sheets", scope, content: { sheet }, id: one.analysis.id, expectedVersion: 1 } }), 403);
    await f.database.prepare("UPDATE memberships SET status='suspended' WHERE user_id=? AND organization_id=?").bind(a.userId, a.organizationId).run();
    await expect(await dispatch(f.worker, f.environment, path, a.owner), 403);
  } finally { await f.dispose(); }
});
