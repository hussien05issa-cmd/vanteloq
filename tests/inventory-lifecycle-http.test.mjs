import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../app/api/v1/inventory-lifecycle/route.ts";
import { posSqliteFixture } from "./helpers/pos-sqlite-fixture.ts";

// Real migrated SQLite and the actual source route, with fictional identity.
// The fetch replacement rejects every origin except the isolated auth fixture.
async function fixture() {
  const store = await posSqliteFixture(), database = store.database;
  const previousEnv = globalThis.__vanteloqEnv, previousFetch = globalThis.fetch;
  const email = "inventory-reader@example.invalid", origin = "https://vanteloq.example";
  globalThis.__vanteloqEnv = { DB: database, SUPABASE_URL: "https://inventory-auth.example.invalid", SUPABASE_PUBLISHABLE_KEY: "fictional" };
  globalThis.fetch = async (input, init) => {
    const url = new URL(new Request(input, init).url);
    assert.equal(url.origin, "https://inventory-auth.example.invalid", "This fixture cannot access external services");
    if (url.pathname === "/rest/v1/team_access_invitations") return Response.json([]);
    assert.equal(url.pathname, "/auth/v1/user");
    return Response.json({ id: "inventory-reader-subject", email, email_confirmed_at: "2026-01-01T00:00:00Z", user_metadata: {} });
  };
  await database.prepare("INSERT INTO users(id,email,display_name,created_at,updated_at) VALUES('actor',?,'Fictional reader',1,1)").bind(email).run();
  for (const org of ["inventory-org", "foreign-org"]) {
    await database.prepare("INSERT INTO workspaces(id,owner_name,business_name,legal_name,business_email,industry,city,address,postal_code,hours_json,timezone,currency,created_at,updated_at) VALUES(?,'QA','QA','QA',?,'Retail','Edmonton','Test','T5A1A1','[]','America/Edmonton','CAD',1,1)").bind(org, email).run();
    await database.prepare("INSERT INTO tenant_subscriptions(organization_id,base_plan,billing_interval,status,created_at,updated_at) VALUES(?,'pro','month','active',1,1)").bind(org).run();
  }
  await database.batch([
    database.prepare("INSERT INTO memberships(id,user_id,organization_id,role,status,created_at,updated_at) VALUES('member','actor','inventory-org','admin','active',1,1)"),
    database.prepare("INSERT INTO organization_locations(id,organization_id,name,country_code,address_line_1,locality,administrative_area,timezone,currency,created_at,updated_at) VALUES('main','inventory-org','Main','CA','Test','Edmonton','AB','America/Edmonton','CAD',1,1)"),
    database.prepare("INSERT INTO access_roles(id,organization_id,name,description,color,permissions_json,location_scope_json,archived,created_by_user_id,created_at,updated_at) VALUES('role','inventory-org','Review','','#2255cc','[\"inventory.view\",\"inventory.value\"]','[]',0,'actor',1,1)"),
    database.prepare("INSERT INTO team_members(id,organization_id,user_id,role_id,first_name,last_name,email,employee_code,permitted_locations_json,status,remote_login,created_by_user_id,created_at,updated_at) VALUES('team','inventory-org','actor','role','Read','Only',?,'REVIEW','[\"main\"]','active',1,'actor',1,1)").bind(email),
  ]);
  const date = days => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  const addLots = async (count, { org = "inventory-org", location = "main", prefix = "lot", expiration = date(10), updatedAt = 1 } = {}) => {
    const statements = Array.from({ length: count }, (_, index) => {
      const id = `${prefix}-${String(index).padStart(4, "0")}`;
      return database.prepare("INSERT INTO inventory_lots(id,organization_id,location_ref,sku,product_name,lot_number,received_date,expiration_date,unit_cost_cents,unit_retail_cents,quantity_received,quantity_remaining,status,source_system,created_by_user_id,updated_by_user_id,created_at,updated_at) VALUES(?,?,?,'SKU',?,?, ?,?,123,200,10,10,'active','manual','actor','actor',1,?)").bind(id, org, location, `Recorded ${prefix}`, id, date(-20), expiration, updatedAt);
    });
    await database.batch(statements);
  };
  const addBalances = async (count, { org = "inventory-org", location = "main", prefix = "balance" } = {}) => {
    await database.batch(Array.from({ length: count }, (_, index) => database.prepare("INSERT INTO inventory_balances(id,organization_id,location_ref,sku,name,on_hand_quantity,reorder_point,updated_at) VALUES(?,?,?,?,?,5,5,1)").bind(`${prefix}-${index}`, org, location, `${prefix}-${index}`, `Recorded ${prefix}`)));
  };
  const demand = async () => {
    await database.batch([
      database.prepare("INSERT INTO operational_events(id,organization_id,event_type,aggregate_type,aggregate_id,source_system,source_event_id,payload_json,occurred_at,recorded_at) VALUES('event','inventory-org','inventory.depleted','inventory','SKU','fixture','event','{}',?,?)").bind(Date.now() - 20 * 86_400_000, Date.now()),
      database.prepare("INSERT INTO inventory_movements(id,organization_id,operational_event_id,location_ref,sku,item_name,quantity_delta,reason,occurred_at) VALUES('movement','inventory-org','event','main','SKU','Recorded SKU',-2,'sale',?)").bind(Date.now() - 20 * 86_400_000),
    ]);
  };
  const permissions = values => database.prepare("UPDATE access_roles SET permissions_json=? WHERE id='role'").bind(JSON.stringify(values)).run();
  const token = Buffer.from(JSON.stringify({ email, aal: "aal2", session_id: "inventory-session" })).toString("base64url");
  const read = (query = "", authenticated = true) => GET(new Request(`${origin}/api/v1/inventory-lifecycle${query}`, { headers: authenticated ? { authorization: `Bearer test.${token}.signature` } : {} }));
  const expect = async (response, status = 200) => { const body = await response.json(); assert.equal(response.status, status, JSON.stringify(body)); return body; };
  const dispose = () => { globalThis.__vanteloqEnv = previousEnv; globalThis.fetch = previousFetch; store.close(); };
  return { database, addLots, addBalances, demand, permissions, read, expect, dispose, date };
}

test("exactly 1000 scoped lots are complete, and another tenant cannot cause truncation or enter totals", async () => {
  const f = await fixture();
  try {
    await f.addLots(1_000);
    await f.addLots(1_001, { org: "foreign-org", prefix: "foreign" });
    await f.addBalances(1);
    await f.demand();
    const body = await f.expect(await f.read());
    assert.equal(body.source.coverage.status, "complete");
    assert.deepEqual(body.source.coverage.lots, { status: "complete", loadedCount: 1_000, matchingCountAtLeast: 1_000 });
    assert.equal(body.summary.totalLots, 1_000);
    assert.equal(body.summary.totalUnits, 10_000);
    assert.equal(body.summary.posSkus, 1);
    assert.equal(body.fefo.length, 1_000);
    assert.equal(body.fefo[0].fefoRank, 1);
    assert.notEqual(body.lots[0].assessment.projectedUnitsAtDate, null);
    assert.doesNotMatch(JSON.stringify(body), /foreign-/);
  } finally { f.dispose(); }
});

test("the 1001st lot marks partial coverage and withholds totals, depletion and FEFO without hiding recorded facts", async () => {
  const f = await fixture();
  try {
    await f.addLots(1_000);
    await f.addLots(1, { prefix: "expired", expiration: f.date(-1), updatedAt: 2 });
    await f.addBalances(1);
    await f.demand();
    const body = await f.expect(await f.read());
    assert.equal(body.source.coverage.status, "partial");
    assert.deepEqual(body.source.coverage.lots, { status: "partial", loadedCount: 1_000, matchingCountAtLeast: 1_001 });
    assert.equal(body.lots.length, 1_000);
    assert.deepEqual(body.fefo, []);
    for (const key of ["totalLots", "trackedLots", "totalUnits", "costAtRiskCents", "costRiskKnownLots", "riskCounts"]) assert.equal(body.summary[key], null, key);
    assert.equal(body.summary.posSkus, 1, "Complete POS evidence keeps its own aggregate");
    for (const lot of body.lots) {
      assert.equal(lot.quantityRemaining, 10);
      assert.equal(lot.unitCostCents, 123);
      assert.equal(lot.assessment.projectedUnitsAtDate, null);
      assert.equal(lot.assessment.inventoryCostAtRiskCents, null);
      assert.equal(lot.assessment.grossMarginOpportunityAtRiskCents, null);
      assert.match(lot.assessment.evidence.join(" "), /read is incomplete/);
    }
    const expired = body.lots.find(lot => lot.id.startsWith("expired"));
    assert.equal(expired.assessment.risk, "expired");
    assert.match(expired.assessment.recommendation, /Quarantine/);
    assert.match(body.source.calculation, /totals, depletion forecasts and FEFO guidance are withheld/);
    await f.permissions(["inventory.view"]);
    const redacted = await f.expect(await f.read());
    assert.ok(redacted.lots.every(lot => lot.unitCostCents === null && lot.unitRetailCents === null));
  } finally { f.dispose(); }
});

test("location authorization is applied before the cap, so restricted lots do not displace the selected location", async () => {
  const f = await fixture();
  try {
    await f.database.prepare("INSERT INTO organization_locations(id,organization_id,name,country_code,address_line_1,locality,administrative_area,timezone,currency,created_at,updated_at) VALUES('restricted','inventory-org','Restricted','CA','Test','Edmonton','AB','America/Edmonton','CAD',1,1)").run();
    await f.addLots(1_001, { location: "restricted", prefix: "restricted", updatedAt: 2 });
    await f.addLots(1);
    const allPermitted = await f.expect(await f.read()), selected = await f.expect(await f.read("?location=main"));
    for (const body of [allPermitted, selected]) {
      assert.equal(body.source.coverage.status, "complete");
      assert.equal(body.summary.totalLots, 1);
      assert.equal(body.lots[0].locationRef, "main");
      assert.doesNotMatch(JSON.stringify(body), /restricted-/);
    }
    await f.expect(await f.read("?location=restricted"), 403);
    await f.expect(await f.read("", false), 401);
    await f.permissions([]);
    await f.expect(await f.read(), 403);
  } finally { f.dispose(); }
});

test("POS sentinel withholding is independent of a complete lot dataset, and verified empty scope stays zero", async () => {
  const f = await fixture();
  try {
    const empty = await f.expect(await f.read());
    assert.equal(empty.source.coverage.status, "complete");
    assert.equal(empty.summary.totalLots, 0);
    assert.equal(empty.summary.posUnits, 0);
    await f.addBalances(1_001);
    await f.addLots(1);
    const body = await f.expect(await f.read());
    assert.equal(body.posBalances.length, 1_000);
    assert.deepEqual(body.source.coverage.posBalances, { status: "partial", loadedCount: 1_000, matchingCountAtLeast: 1_001 });
    assert.equal(body.summary.posSkus, null);
    assert.equal(body.summary.posUnits, null);
    assert.equal(body.summary.lowStockSkus, null);
    assert.equal(body.summary.totalLots, 1);
    assert.equal(body.fefo.length, 1);
    assert.match(body.source.coverage.reason, /POS stock balances/);
  } finally { f.dispose(); }
});
