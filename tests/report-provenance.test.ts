import assert from "node:assert/strict";
import test from "node:test";
import { posSqliteFixture } from "./helpers/pos-sqlite-fixture.ts";
import { GET } from "../app/api/v1/reports/route.ts";
import type { VanteloqRuntimeEnv } from "../db/index.ts";

/** The actual authenticated route against migrated SQLite; no Worker build or provider traffic. */
async function fixture() {
  const f = await posSqliteFixture();
  const db = f.database, priorFetch = globalThis.fetch;
  const runtime = globalThis as typeof globalThis & { __vanteloqEnv?: VanteloqRuntimeEnv };
  const priorEnv = runtime.__vanteloqEnv;
  runtime.__vanteloqEnv = { DB: db, SUPABASE_URL: "https://report-identity.example.invalid", SUPABASE_PUBLISHABLE_KEY: "fictional" };
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    assert.equal(url.origin, "https://report-identity.example.invalid", "Fixture must never contact a real provider");
    if (url.pathname === "/rest/v1/team_access_invitations") return Response.json([]);
    assert.equal(url.pathname, "/auth/v1/user");
    const payload = JSON.parse(Buffer.from(request.headers.get("authorization")!.split(".")[1], "base64url").toString());
    return Response.json({ id: payload.sub, email: `${payload.sub}@example.invalid`, email_confirmed_at: "2026-01-01", user_metadata: {} });
  };
  for (const user of ["owner", "limited", "foreign-owner"]) await db.prepare("INSERT INTO users(id,email,auth_subject,auth_provider,display_name,created_at,updated_at) VALUES(?,?,?,'supabase',?,1,1)").bind(user, `${user}@example.invalid`, user, user).run();
  for (const org of ["org", "other"]) {
    await db.prepare("INSERT INTO workspaces(id,owner_name,business_name,legal_name,business_email,industry,city,address,postal_code,hours_json,timezone,currency,created_at,updated_at) VALUES(?,'QA','QA','QA','qa@example.invalid','Retail','Edmonton','Test','T5A1A1','[]','America/Edmonton','CAD',1,1)").bind(org).run();
    await db.prepare("INSERT INTO tenant_subscriptions(organization_id,base_plan,billing_interval,status,created_at,updated_at) VALUES(?,'pro','month','active',1,1)").bind(org).run();
  }
  for (const [user, org, role] of [["owner", "org", "owner"], ["limited", "org", "admin"], ["foreign-owner", "other", "owner"]]) await db.prepare("INSERT INTO memberships(id,user_id,organization_id,role,status,created_at,updated_at) VALUES(?,?,?,?,'active',1,1)").bind(user, user, org, role).run();
  for (const [location, org] of [["main", "org"], ["private", "org"], ["foreign", "other"]]) await db.prepare("INSERT INTO organization_locations(id,organization_id,name,country_code,address_line_1,locality,administrative_area,timezone,currency,created_at,updated_at) VALUES(?,?,?,'CA','Test','Edmonton','AB','America/Edmonton','CAD',1,1)").bind(location, org, location).run();
  await db.prepare("INSERT INTO access_roles(id,organization_id,name,permissions_json,location_scope_json,created_by_user_id,created_at,updated_at) VALUES('reader','org','Reader','[\"reports.operational\",\"reports.export\",\"metrics.revenue\"]','[\"main\"]','owner',1,1)").run();
  await db.prepare("INSERT INTO team_members(id,organization_id,user_id,role_id,first_name,last_name,email,employee_code,permitted_locations_json,status,remote_login,created_by_user_id,created_at,updated_at) VALUES('limited-member','org','limited','reader','Read','Only','limited@example.invalid','L','[\"main\"]','active',1,'owner',1,1)").run();
  const now = Math.floor(Date.now() / 1000);
  const facts = async (dates: readonly string[], location = "main", amount = 1000, connection: string | null = null, organization = "org") => {
    for (const date of dates) await db.prepare("INSERT INTO daily_business_metrics(organization_id,business_date,location_ref,gross_sales_cents,net_sales_cents,cost_of_goods_cents,transaction_count,units_sold,source_provider,source_connection_id,created_by_user_id,created_at,updated_at) VALUES(?,?,?,?,?,400,1,1,?,?,'owner',?,?)").bind(organization, date, location, Math.max(0, amount), amount, connection ? "square" : null, connection, now, now).run();
  };
  const connect = async () => {
    await db.prepare("INSERT INTO integration_connections(id,organization_id,provider,source_namespace,status,external_account_name,data_promotion_status,last_successful_sync_at,created_at,updated_at) VALUES('source-a','org','square','source-a','connected','=Private source','approved',?,?,?)").bind(now, now, now).run();
    await db.prepare("INSERT INTO integration_location_mappings(id,organization_id,provider,connection_id,external_location_ref,external_name,local_location_id,status,last_seen_at,created_at,updated_at) VALUES('mapping','org','square','source-a','outlet','Source outlet','main','mapped',?,?,?)").bind(now, now, now).run();
    return "square:source-a:outlet";
  };
  const request = (query: string, user = "owner") => {
    const payload = Buffer.from(JSON.stringify({ sub: user, aal: "aal2", session_id: `report-session-${user}` })).toString("base64url");
    return GET(new Request(`https://vanteloq.example/api/v1/reports?report=sales_totals&${query}`, { headers: { authorization: `Bearer test.${payload}.signature` } }));
  };
  const json = async (query: string, user = "owner") => { const response = await request(query, user); assert.equal(response.status, 200, await response.clone().text()); return response.json(); };
  return { ...f, db, facts, connect, request, json, dispose() { globalThis.fetch = priorFetch; runtime.__vanteloqEnv = priorEnv; f.close(); } };
}

function csvRows(text: string) {
  const rows: string[][] = [[]]; let cell = "", quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') { if (quoted && text[index + 1] === '"') { cell += '"'; index++; } else quoted = !quoted; }
    else if (!quoted && (char === "," || char === "\n")) { rows.at(-1)!.push(cell); cell = ""; if (char === "\n") rows.push([]); }
    else cell += char;
  }
  rows.at(-1)!.push(cell); return rows;
}

test("actual report preserves exact recorded CSV amounts and scope provenance without certifying row presence", async () => {
  const f = await fixture();
  try {
    await f.facts(["2026-09-01", "2026-09-02"], "main", 12345);
    await f.facts(["2026-09-03"], "main", -50);
    await f.facts(["2026-09-01"], "foreign", 999999, null, "other");
    const result = await f.json("location=main&start=2026-09-01&end=2026-09-03");
    assert.equal(result.totals.netSalesCents, 24640); assert.equal(result.totals.grossProfitCents, 23440);
    assert.equal(result.source.readiness.ready, false); assert.equal(result.source.readiness.coverage.dateScopes.complete, true);
    assert.equal(result.source.profitAvailability, "owner_reviewed"); assert.equal(result.explainAndAct.confidence, "not_certified");
    assert.equal(result.canonicalReportCatalog.some((item: { status: string }) => item.status === "ready"), false);
    assert.equal(result.canonicalReportCatalog.find((item: { id: string }) => item.id === "sales_performance").recordedDataAvailable, true);
    const response = await f.request("location=main&start=2026-09-01&end=2026-09-03&format=csv");
    assert.equal(response.status, 200); const rows = csvRows(await response.text());
    assert.equal(rows.length, 4); const field = (row: number, name: string) => rows[row][rows[0].indexOf(name)];
    assert.equal(field(1, "Net sales (minor units)"), "12345"); assert.equal(field(3, "Net sales (minor units)"), "-50");
    for (let row = 1; row < rows.length; row++) {
      assert.equal(rows[row].length, rows[0].length); assert.equal(field(row, "Currency"), "CAD"); assert.equal(field(row, "Business time zone"), "America/Edmonton");
      assert.equal(field(row, "Organization ID"), "org"); assert.equal(field(row, "Period start"), "2026-09-01"); assert.equal(field(row, "Period end"), "2026-09-03");
      assert.equal(field(row, "Metric certification"), "not_certified"); assert.equal(field(row, "Reconciliation"), "not_verified"); assert.equal(field(row, "Provider coverage verified"), "not verified");
      assert.match(field(row, "Generated UTC"), /^\d{4}-\d{2}-\d{2}T/); assert.match(field(row, "Limitations"), /not certified/);
    }
    assert.doesNotMatch(JSON.stringify(result), /999999|foreign/);
  } finally { f.dispose(); }
});

test("actual report withholds partial or currency-mismatched comparisons and unknown provider costs", async () => {
  const f = await fixture();
  try {
    const location = await f.connect();
    await f.facts(["2026-09-03", "2026-09-04", "2026-09-02"], location, 1000, "source-a");
    let result = await f.json("location=main&start=2026-09-03&end=2026-09-04");
    assert.equal(result.source.readiness.certification, "not_certified"); assert.equal(result.totals.netSalesCents, 2000);
    assert.equal(result.totals.costOfGoodsCents, null); assert.equal(result.totals.grossProfitCents, null); assert.equal(result.rows.every((row: { costOfGoodsCents: unknown }) => row.costOfGoodsCents === null), true);
    assert.equal(result.source.profitAvailability, "needs_cost_evidence"); assert.equal(result.comparison.comparable, false);
    assert.equal(Object.values(result.comparison.changes).every(value => value === null), true);
    assert.equal(result.providerReportCatalogs.every((catalog: { providerReports: { status: string }[] }) => catalog.providerReports.every(item => item.status === "needs_data")), true);
    await f.facts(["2026-09-01"], location, 500, "source-a");
    result = await f.json("location=main&start=2026-09-03&end=2026-09-04");
    assert.equal(result.comparison.comparable, true); assert.equal(result.comparison.changes.netSalesRate, 1 / 3);
    await f.db.prepare("UPDATE organization_locations SET currency='USD' WHERE id='main'").run();
    result = await f.json("location=main&start=2026-09-03&end=2026-09-04");
    assert.equal(result.comparison.comparable, false); assert.equal(result.comparison.changes.netSalesRate, null);
    assert.match(result.source.readiness.limitations.join(" "), /currency.*review/);
    const csv = await f.request("location=main&start=2026-09-03&end=2026-09-04&format=csv");
    const cells = csvRows(await csv.text());
    assert.equal(cells[1][cells[0].indexOf("Cost of goods (minor units)")], "");
    assert.equal(cells[1][cells[0].indexOf("Source account")], "'=Private source", "untrusted source names remain spreadsheet text");
  } finally { f.dispose(); }
});

test("report provenance respects restricted locations and metadata/profit/export permissions", async () => {
  const f = await fixture();
  try {
    const location = await f.connect(); await f.facts(["2026-09-01"], location, 1000, "source-a");
    await f.facts(["2026-09-01"], "private", 777777);
    await f.facts(["2026-09-01"], "foreign", 999999, null, "other");
    const result = await f.json("start=2026-09-01&end=2026-09-01", "limited");
    assert.deepEqual(result.source.readiness.scope.locationIds, ["main"]); assert.deepEqual(result.source.readiness.scope.connectionIds, []);
    assert.equal(result.source.profitAvailability, "permission_required"); assert.equal(result.totals.grossProfitCents, null);
    assert.equal(result.totals.netSalesCents, 1000); assert.deepEqual(result.providerReportCatalogs, []);
    assert.doesNotMatch(JSON.stringify(result.source.readiness), /source-a|Private source|777777|999999|foreign/);
    const csv = await f.request("start=2026-09-01&end=2026-09-01&format=csv", "limited");
    assert.equal(csv.status, 200); const cells = csvRows(await csv.text());
    assert.equal(cells[1][cells[0].indexOf("Source connection")], ""); assert.equal(cells[1][cells[0].indexOf("Gross profit (minor units)")], "");
    assert.doesNotMatch(cells[1][cells[0].indexOf("Source lineage")], /source-a|Private source|private|foreign/);
    assert.equal((await f.request("location=private", "limited")).status, 403);
    await f.db.prepare("UPDATE access_roles SET permissions_json='[\"reports.operational\",\"metrics.revenue\"]' WHERE id='reader'").run();
    assert.equal((await f.request("format=csv", "limited")).status, 403);
  } finally { f.dispose(); }
});

test("payment CSV uses payment business dates, never unrelated sales bounds or invented daily coverage", async () => {
  const f = await fixture();
  try {
    const location = await f.connect(); await f.facts(["2026-09-01"], location, 1000, "source-a");
    await f.db.prepare("INSERT INTO integration_sync_runs(id,organization_id,provider,connection_id,mode,status,started_at,created_by_user_id) VALUES('sync','org','square','source-a','incremental','completed',1,'owner')").run();
    for (const [id, date, amount] of [["a", "2026-09-10T05:30:00Z", 2500], ["b", "2026-09-11T08:00:00Z", 500]]) await f.db.prepare("INSERT INTO commerce_payments(id,organization_id,provider,connection_id,external_payment_id,external_sale_id,payment_type_name,category,amount_cents,paid_at,outlet_ref,source_payload_hash,sync_run_id,updated_at) VALUES(?,'org','square','source-a',?,?,'Card','card',?,?,'source-a:outlet','fictional','sync',?)").bind(id, id, id, amount, date, Math.floor(Date.now() / 1000)).run();
    const result = await f.json("location=main&view=payment_mix");
    assert.equal(result.source.readiness.scope.from, "2026-09-09"); assert.equal(result.source.readiness.scope.to, "2026-09-11");
    assert.equal(result.source.earliestBusinessDate, "2026-09-09"); assert.equal(result.source.latestBusinessDate, "2026-09-11");
    assert.match(result.explainAndAct.executiveSummary, /Recorded collections/);
    assert.equal(result.source.readiness.coverage.dateScopes, null); assert.equal(result.paymentMix[0].amountCents, 3000);
    const response = await f.request("location=main&view=payment_mix&format=csv");
    assert.equal(response.status, 200); const cells = csvRows(await response.text());
    assert.equal(cells.length, 2); assert.equal(cells[1][cells[0].indexOf("Amount (minor units)")], "3000");
    assert.equal(cells[1][cells[0].indexOf("Period start")], "2026-09-09"); assert.equal(cells[1][cells[0].indexOf("Period end")], "2026-09-11");
    assert.equal(cells[1][cells[0].indexOf("Expected date-source records")], "");
    assert.match(cells[1][cells[0].indexOf("Limitations")], /Payment activity does not establish/);
  } finally { f.dispose(); }
});

test("conflicting sources cannot be exported or opened as a consolidated recorded view", async () => {
  const f = await fixture();
  try {
    const location = await f.connect(); await f.facts(["2026-09-01"], location, 1000, "source-a");
    await f.db.prepare("INSERT INTO integration_connections(id,organization_id,provider,source_namespace,status,external_account_name,data_promotion_status,last_successful_sync_at,created_at,updated_at) SELECT 'source-b',organization_id,provider,'source-b',status,'Second source',data_promotion_status,last_successful_sync_at,created_at,updated_at FROM integration_connections WHERE id='source-a'").run();
    await f.db.prepare("INSERT INTO integration_location_mappings(id,organization_id,provider,connection_id,external_location_ref,external_name,local_location_id,status,last_seen_at,created_at,updated_at) SELECT 'mapping-b',organization_id,provider,'source-b',external_location_ref,external_name,local_location_id,status,last_seen_at,created_at,updated_at FROM integration_location_mappings WHERE id='mapping'").run();
    await f.facts(["2026-09-01"], "square:source-b:outlet", 9000, "source-b");
    const result = await f.json("location=main&start=2026-09-01&end=2026-09-01");
    assert.equal(result.reportStatus, "source_conflict"); assert.equal(result.source.readiness.state, "source_conflict"); assert.equal(result.totals, null);
    assert.equal(result.canonicalReportCatalog.some((item: { recordedDataAvailable: boolean }) => item.recordedDataAvailable), false);
    assert.equal((await f.request("location=main&start=2026-09-01&end=2026-09-01&format=csv")).status, 409);
    const selected = await f.json("location=main&start=2026-09-01&end=2026-09-01&connection=source-a");
    assert.equal(selected.totals.netSalesCents, 1000); assert.equal(selected.source.readiness.authority, "provider_specific");
    assert.equal(selected.source.readiness.ready, false); assert.deepEqual(selected.source.readiness.scope.connectionIds, ["source-a"]);
  } finally { f.dispose(); }
});
