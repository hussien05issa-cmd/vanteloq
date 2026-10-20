import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { posSqliteFixture } from "./helpers/pos-sqlite-fixture.ts";
import { activateTestSubscription } from "./helpers/subscription-fixture.mjs";
import { GET, POST, DELETE } from "../app/api/v1/data-studio/analyses/route.ts";
import { GET as executiveReview } from "../app/api/v1/data-studio/executive/route.ts";
import { validateStudioDefinitionWrite, validateStudioDefinitionDelete } from "../domain/studio-definitions.ts";
import { runStudioQuery } from "../domain/studio-query.ts";
import type { VanteloqRuntimeEnv } from "../db/index.ts";

const scope = { from: "2026-10-01", to: "2026-10-02", location: null, connection: null };
const draft = { title: "Private sales view", app: "dashboards", scope, content: { metric: "net_sales_cents", group: "business_date", chart: "line", pinned: true } };
const globals = globalThis as typeof globalThis & { __vanteloqEnv?: VanteloqRuntimeEnv };
const originalEnv = globals.__vanteloqEnv, originalFetch = globalThis.fetch, identities = new Map<string, string>();
let fixture: Awaited<ReturnType<typeof posSqliteFixture>>;
before(async () => {
  fixture = await posSqliteFixture();
  globals.__vanteloqEnv = { DB: fixture.database, SUPABASE_URL: "https://studio-definitions-fixture.supabase.co", SUPABASE_PUBLISHABLE_KEY: "fictional-key" };
  globalThis.fetch = (async (input, init) => {
    assert.equal(new URL(String(input)).hostname, "studio-definitions-fixture.supabase.co", "No real provider calls in definition fixtures.");
    const token = new Headers(init?.headers).get("authorization")?.split(".")[1];
    const email = token ? JSON.parse(Buffer.from(token, "base64url").toString()).email : null, id = identities.get(email);
    return id ? Response.json({ id, email, email_confirmed_at: "2026-01-01", user_metadata: {} }) : Response.json({}, { status: 401 });
  }) as typeof fetch;
});
after(() => { globalThis.fetch = originalFetch; globals.__vanteloqEnv = originalEnv; fixture?.close(); });
type Actor = { user: string; organization: string; email: string; location: string };
async function actor(role = "owner", organization?: string): Promise<Actor> {
  const user = crypto.randomUUID(), org = organization ?? crypto.randomUUID(), email = `${user}@example.invalid`, location = `${org}:shop`;
  identities.set(email, `fixture:${user}`);
  const statements = [
    fixture.database.prepare("INSERT INTO users(id,email,auth_subject,auth_provider,display_name,status,created_at,updated_at) VALUES (?,?,?,'supabase','Fictional','active',1,1)").bind(user, email, `fixture:${user}`),
  ];
  if (!organization) statements.push(fixture.database.prepare("INSERT INTO workspaces(id,owner_name,business_name,legal_name,business_email,industry,city,address,postal_code,hours_json,setup_complete,created_at,updated_at) VALUES (?,'Fictional','Fictional','Fictional',?,'Retail','Edmonton','Test','T5A1A1','[]',1,1,1)").bind(org, email));
  statements.push(fixture.database.prepare("INSERT INTO memberships(id,organization_id,user_id,role,status,created_at,updated_at) VALUES (?,?,?,?,'active',1,1)").bind(crypto.randomUUID(), org, user, role));
  if (!organization) statements.push(fixture.database.prepare("INSERT INTO organization_locations(id,organization_id,name,status,timezone,currency,country_code,address_line_1,locality,administrative_area,created_at,updated_at) VALUES (?,?,'Shop','active','America/Edmonton','CAD','CA','Fictional','Edmonton','AB',1,1)").bind(location, org));
  await fixture.database.batch(statements);
  if (!organization) await activateTestSubscription(fixture.database, org, "pro");
  return { user, organization: org, email, location };
}
async function grant(a: Actor) {
  const role = crypto.randomUUID();
  await fixture.database.batch([
    fixture.database.prepare("INSERT INTO access_roles(id,organization_id,name,permissions_json,created_by_user_id,created_at,updated_at) VALUES (?,?,'Reporting fixture',?,?,1,1)").bind(role, a.organization, JSON.stringify(["reports.operational", "metrics.revenue"]), a.user),
    fixture.database.prepare("INSERT INTO team_members(id,organization_id,user_id,role_id,first_name,last_name,email,employee_code,permitted_locations_json,status,remote_login,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,'Fictional','Reviewer',?,'TEST',?,'active',1,?,1,1)").bind(crypto.randomUUID(), a.organization, a.user, role, a.email, JSON.stringify([a.location]), a.user),
  ]);
  return role;
}
function request(a: Actor, method = "GET", body?: unknown, origin = "https://vanteloq.example", query = "") {
  const token = Buffer.from(JSON.stringify({ email: a.email, aal: "aal2", session_id: `fixture-session:${a.user}` })).toString("base64url");
  return new Request(`https://vanteloq.example/api/v1/data-studio/analyses${query}`, { method, headers: { Authorization: `Bearer test.${token}.signature`, Origin: origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
async function expect(response: Response, status: number) { assert.equal(response.status, status, await response.clone().text()); return response.json(); }

test("definitions strictly validate bounds and allow only definition and assumption fields", () => {
  assert.deepEqual(validateStudioDefinitionWrite(draft, "2026-10-12"), draft);
  const sheet = { version: "studio-sheet-v1", title: "Assumptions", cells: [{ address: "Z99", name: "Scenario", input: "=A1*1.1", format: "money" }] };
  assert.deepEqual(validateStudioDefinitionWrite({ ...draft, app: "sheets", content: { sheet } }, "2026-10-12").content.sheet, sheet);
  const invalid = [
    { ...draft, organizationId: "other" }, { ...draft, title: "x".repeat(101) }, { ...draft, content: { sql: "x".repeat(8001) } },
    { ...draft, content: { rows: [{ netSalesCents: 100 }] } }, { ...draft, content: { pinned: "true" } }, { ...draft, content: { providerToken: "secret" } },
    { ...draft, scope: { ...scope, organizationId: "other" } }, { ...draft, scope: { ...scope, to: "2026-10-13" } },
    { ...draft, scope: { ...scope, from: "2025-01-01" } }, { ...draft, id: crypto.randomUUID() }, { ...draft, expectedVersion: 1 },
    { ...draft, id: crypto.randomUUID(), expectedVersion: 0 }, { ...draft, app: "results" },
    { ...draft, content: { sheet: { ...sheet, cells: [...sheet.cells, ...sheet.cells] } } },
    { ...draft, content: { sheet: { ...sheet, cells: [{ ...sheet.cells[0], result: 500 }] } } },
    { ...draft, content: { sheet: { ...sheet, cells: [{ ...sheet.cells[0], input: "x".repeat(257) }] } } },
    { ...draft, content: { sheet: { ...sheet, cells: Array.from({ length: 33 }, (_, index) => ({ ...sheet.cells[0], address: `A${index + 1}` })) } } },
  ];
  for (const value of invalid) assert.throws(() => validateStudioDefinitionWrite(value, "2026-10-12"));
  assert.throws(() => validateStudioDefinitionDelete({ id: crypto.randomUUID(), expectedVersion: 1, organization: "other" }));
});
test("real definition API keeps tenant and same-tenant user ownership private", async () => {
  const a = await actor(), b = await actor(), colleague = await actor("admin", a.organization);
  const { analysis } = await expect(await POST(request(a, "POST", draft)), 201);
  assert.equal(analysis.version, 1); assert.equal(analysis.content.pinned, true); assert.match(analysis.updatedAt, /Z$/);
  assert.deepEqual((await expect(await GET(request(a)), 200)).analyses, [analysis]);
  assert.deepEqual((await expect(await GET(request(b)), 200)).analyses, []);
  assert.deepEqual((await expect(await GET(request(colleague)), 200)).analyses, []);
  for (const stranger of [b, colleague]) {
    await expect(await POST(request(stranger, "POST", { ...draft, id: analysis.id, expectedVersion: 1 })), 409);
    await expect(await DELETE(request(stranger, "DELETE", { id: analysis.id, expectedVersion: 1 })), 409);
  }
  const rows = await fixture.database.prepare("SELECT * FROM studio_definitions WHERE id=?").bind(analysis.id).first();
  assert.equal(rows?.organization_id, a.organization); assert.equal(rows?.user_id, a.user);
  assert.equal(Object.keys(rows!).length, 10);
});
test("CAS updates and deletion protect a draft when another tab changes the record", async () => {
  const a = await actor(), { analysis } = await expect(await POST(request(a, "POST", { ...draft, app: "sql", content: { sql: "SELECT business_date FROM studio_sales" } })), 201);
  const responses = await Promise.all(["Tab one", "Tab two"].map(title => POST(request(a, "POST", { ...draft, title, id: analysis.id, expectedVersion: 1 }))));
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  const conflict = await responses.find(response => response.status === 409)!.json();
  assert.equal(conflict.error.code, "STUDIO_DEFINITION_CONFLICT"); assert.match(conflict.error.message, /Keep your draft/);
  const current = (await expect(await GET(request(a)), 200)).analyses[0]; assert.equal(current.version, 2);
  await expect(await DELETE(request(a, "DELETE", { id: current.id, expectedVersion: 1 })), 409);
  await expect(await DELETE(request(a, "DELETE", { id: current.id, expectedVersion: 2 })), 200);
  assert.deepEqual((await expect(await GET(request(a)), 200)).analyses, []);
});
test("report authority, read-only roles, same-origin and request-size limits are enforced", async () => {
  const readOnly = await actor("read_only"), employee = await actor("employee"), a = await actor();
  await expect(await POST(request(readOnly, "POST", draft)), 403);
  await expect(await POST(request(employee, "POST", draft)), 403);
  await grant(employee); await expect(await POST(request(employee, "POST", draft)), 201);
  await expect(await POST(request(a, "POST", draft, "https://other.example")), 403);
  await expect(await POST(request(a, "POST", { ...draft, content: { sql: "x".repeat(17_000) } })), 413);
  await expect(await GET(request(a, "GET", undefined, "https://vanteloq.example", "?organizationId=other")), 400);
  await expect(await POST(request(a, "POST", { ...draft, scope: { ...scope, location: readOnly.location } })), 403);
});
test("fresh permissions hide revoked scopes and prevent a write revoked during commit", async () => {
  const a = await actor("employee"), role = await grant(a);
  const { analysis } = await expect(await POST(request(a, "POST", { ...draft, scope: { ...scope, location: a.location } })), 201);
  await fixture.database.prepare("UPDATE team_members SET permitted_locations_json='[]' WHERE user_id=?").bind(a.user).run();
  assert.deepEqual((await expect(await GET(request(a)), 200)).analyses, []);
  await fixture.database.prepare("UPDATE team_members SET permitted_locations_json=? WHERE user_id=?").bind(JSON.stringify([a.location]), a.user).run();
  fixture.beforeBatch(items => {
    if (items.some(item => /UPDATE studio_definitions/.test(item.sql))) {
      fixture.beforeBatch(undefined);
      fixture.sqlite.prepare("UPDATE access_roles SET permissions_json='[]' WHERE id=?").run(role);
    }
  });
  try {
    await expect(await POST(request(a, "POST", { ...draft, id: analysis.id, expectedVersion: 1 })), 409);
    assert.equal((await fixture.database.prepare("SELECT version FROM studio_definitions WHERE id=?").bind(analysis.id).first())?.version, 1);
  } finally { fixture.beforeBatch(undefined); }
  await expect(await GET(request(a)), 403);
});
test("membership revocation during a list prevents disclosure and definition audits omit content", async () => {
  const a = await actor(), secret = "SELECT 'private SQL draft 984321' FROM studio_sales";
  await expect(await POST(request(a, "POST", { ...draft, app: "sql", content: { sql: secret } })), 201);
  const audits = await fixture.database.prepare("SELECT details_json FROM audit_events WHERE organization_id=? AND resource_type='studio_definition'").bind(a.organization).all();
  assert.doesNotMatch(JSON.stringify(audits.results), /984321|SELECT|Private sales view/);
  fixture.beforeBatch(items => {
    if (items.some(item => /SELECT[\s\S]*FROM studio_definitions/.test(item.sql))) {
      fixture.beforeBatch(undefined);
      fixture.sqlite.prepare("UPDATE memberships SET status='suspended' WHERE user_id=?").run(a.user);
    }
  });
  try { await expect(await GET(request(a)), 403); }
  finally { fixture.beforeBatch(undefined); }
});
test("a saved SQL draft cannot replay fields after profit permission is revoked", async () => {
  const a = await actor(), sql = "SELECT gross_profit_cents FROM sales";
  await fixture.database.prepare("INSERT INTO daily_business_metrics(organization_id,business_date,location_ref,gross_sales_cents,net_sales_cents,cost_of_goods_cents,transaction_count,units_sold,created_by_user_id,created_at,updated_at) VALUES (?,'2026-10-01',?,100,100,25,1,1,?,1,1)").bind(a.organization, a.location, a.user).run();
  await expect(await POST(request(a, "POST", { ...draft, app: "sql", content: { sql } })), 201);
  const reviewRequest = () => { const req = request(a); return new Request("https://vanteloq.example/api/v1/data-studio/executive?from=2026-10-01&to=2026-10-02", { headers: req.headers }); };
  const before = await expect(await executiveReview(reviewRequest()), 200);
  assert.deepEqual(runStudioQuery(before, sql).rows, [{ gross_profit_cents: 75 }]);
  await fixture.database.prepare("UPDATE memberships SET role='employee' WHERE user_id=?").bind(a.user).run();
  await grant(a);
  const stored = (await expect(await GET(request(a)), 200)).analyses[0]; assert.equal(stored.content.sql, sql);
  const after = await expect(await executiveReview(reviewRequest()), 200);
  assert.equal(after.margin.state, "restricted"); assert.equal("costOfGoodsCents" in after.sales.rows[0], false);
  assert.throws(() => runStudioQuery(after, stored.content.sql), { code: "STUDIO_SQL_FIELD" });
});
test("definition capacity is bounded and user and workspace deletion cascade", async () => {
  const a = await actor(), b = await actor();
  await expect(await POST(request(a, "POST", draft)), 201);
  for (let n = 1; n < 50; n++) await fixture.database.prepare("INSERT INTO studio_definitions(id,organization_id,user_id,title,app,scope_json,content_json,version,created_at,updated_at) VALUES (?,?,?,'Fixture','dashboards',?,'{}',1,1,1)").bind(crypto.randomUUID(), a.organization, a.user, JSON.stringify(scope)).run();
  assert.equal((await expect(await GET(request(a)), 200)).analyses.length, 50);
  const limit = await expect(await POST(request(a, "POST", draft)), 409); assert.equal(limit.error.code, "STUDIO_DEFINITION_LIMIT");
  await expect(await POST(request(b, "POST", draft)), 201);
  await fixture.database.prepare("DELETE FROM users WHERE id=?").bind(b.user).run();
  assert.equal((await fixture.database.prepare("SELECT COUNT(*) count FROM studio_definitions WHERE user_id=?").bind(b.user).first())?.count, 0);
  await fixture.database.prepare("DELETE FROM workspaces WHERE id=?").bind(a.organization).run();
  assert.equal((await fixture.database.prepare("SELECT COUNT(*) count FROM studio_definitions WHERE organization_id=?").bind(a.organization).first())?.count, 0);
  assert.equal((await fixture.database.prepare("PRAGMA foreign_key_check").all()).results?.length, 0);
});
