import assert from "node:assert/strict";
import test from "node:test";
import { defaultIndustryConfiguration } from "../domain/industry-templates.ts";
import { createEnvironment, createReportWorkspace, dispatch, origin, context as executionContext, identityHeaders } from "./helpers/retail-worker-fixture.mjs";

async function ok(response, status = 200) { assert.equal(response.status, status, await response.clone().text()); return response.json(); }

test("built dealership routes enforce reviewed industry, scoped roles, paid access, MFA, origin and complete permitted exports", { timeout: 120_000 }, async () => {
  const { worker, environment, database, dispose } = await createEnvironment();
  try {
    const a = await createReportWorkspace(worker, environment, database, "dealership-route");
    const request = (path = "/api/v1/dealership", options = {}) => dispatch(worker, environment, path, { ...a.owner, ...options });
    const write = body => request("/api/v1/dealership", { method: "POST", body: { mutationKey: crypto.randomUUID(), ...body } });
    assert.equal((await request()).status, 403);
    async function setIndustry(template) {
      const current = await ok(await request("/api/v1/industry-configuration"));
      const configuration = defaultIndustryConfiguration(template);
      const preview = await ok(await request("/api/v1/industry-configuration", { method: "POST", body: { action: "preview", expectedRevision: current.revision, configuration } }));
      await ok(await request("/api/v1/industry-configuration", { method: "POST", body: { action: "save", expectedRevision: current.revision, configuration, fingerprint: preview.fingerprint } }));
    }
    await setIndustry("dealership");
    const vehicle = { identifierKind: "vin", identifier: "1HGCM82633A004352", year: 2003, make: "Honda", model: "Accord", stockNumber: "VISIBLE", acquiredDate: "2026-09-01" };
    const acquired = await ok(await write({ action: "acquire", locationId: a.locationId, vehicle, ownership: "owned", physicalStatus: "on_lot", prepStatus: "ready", askingCents: 1500000 }));
    await ok(await write({ action: "add_cost", episodeId: acquired.id, category: "acquisition", status: "posted", amountCents: 1000000, description: "Invoice", sourceReference: "invoice-1" }));
    let state = await ok(await request()); const stock = state.stock[0];
    assert.equal(stock.postedCostCents, 1000000); assert.equal(state.permissions.profit, true);
    await ok(await write({ action: "update_stock", episodeId: stock.id, expectedVersion: stock.version, physicalStatus: "on_lot", prepStatus: "ready", availability: "available", askingCents: stock.askingCents, costComplete: true }));
    const secondLocation = crypto.randomUUID();
    await database.prepare("INSERT INTO organization_locations(id,organization_id,name,country_code,address_line_1,locality,administrative_area,timezone,currency,created_at,updated_at) VALUES(?,?,'Other dealership','CA','2 Test','Edmonton','AB','America/Edmonton','CAD',1,1)").bind(secondLocation, a.organizationId).run();
    await ok(await write({ action: "acquire", locationId: secondLocation, vehicle: { ...vehicle, identifier: "1HGCM82633A004353", stockNumber: "HIDDEN" }, ownership: "owned", physicalStatus: "on_lot", prepStatus: "ready" }));
    const reader = { email: `dealership-reader-${crypto.randomUUID()}@example.invalid`, name: "Stock reader" }, userId = crypto.randomUUID(), roleId = crypto.randomUUID();
    await database.batch([
      database.prepare("INSERT INTO users(id,email,display_name,created_at,updated_at) VALUES(?,?,?,1,1)").bind(userId, reader.email, reader.name),
      database.prepare("INSERT INTO memberships(id,user_id,organization_id,role,created_at,updated_at) VALUES(?,?,?,'employee',1,1)").bind(crypto.randomUUID(), userId, a.organizationId),
      database.prepare("INSERT INTO access_roles(id,organization_id,name,permissions_json,created_by_user_id,created_at,updated_at) VALUES(?,?,'Stock reader',?, ?,1,1)").bind(roleId, a.organizationId, JSON.stringify(["inventory.view", "reports.export"]), a.userId),
      database.prepare("INSERT INTO team_members(id,organization_id,user_id,role_id,first_name,last_name,email,employee_code,primary_location_id,permitted_locations_json,status,remote_login,created_by_user_id,created_at,updated_at) VALUES(?,?,?,?,'Stock','Reader',?,'DEALERSHIP-READER',?,?,'active',1,?,1,1)").bind(crypto.randomUUID(), a.organizationId, userId, roleId, reader.email, a.locationId, JSON.stringify([a.locationId]), a.userId),
    ]);
    const restricted = (path = "/api/v1/dealership", options = {}) => dispatch(worker, environment, path, { ...reader, ...options });
    state = await ok(await restricted()); assert.equal(state.stock.length, 1); assert.equal(state.summary.activeStock, 1); assert.equal(state.stock[0].postedCostCents, null); assert.deepEqual(state.costs, []); assert.deepEqual(state.sales, []); assert.deepEqual(state.leads, []);
    const csv = await restricted("/api/v1/dealership?format=csv&export=stock"); assert.equal(csv.status, 200); assert.match(csv.headers.get("cache-control"), /no-store/); const content = await csv.text(); assert.match(content, /VISIBLE/); assert.doesNotMatch(content, /HIDDEN|postedCostCents|costComplete|1000000/);
    assert.equal((await restricted("/api/v1/dealership?format=csv&export=sales")).status, 403);
    assert.equal((await restricted(`/api/v1/dealership?locationId=${secondLocation}`)).status, 403);
    assert.equal((await restricted("/api/v1/dealership", { method: "POST", body: { action: "adopt_legacy", locationId: a.locationId, mutationKey: "denied" } })).status, 403);
    await database.prepare("UPDATE access_roles SET permissions_json='[]' WHERE id=?").bind(roleId).run();
    assert.equal((await restricted()).status, 403);
    const aal1 = { ...identityHeaders(a.owner.email, a.owner.name), authorization: `Bearer test.${Buffer.from(JSON.stringify({ email: a.owner.email, aal: "aal1", session_id: "unverified" })).toString("base64url")}.signature` };
    assert.equal((await worker.fetch(new Request(`${origin}/api/v1/dealership`, { headers: aal1 }), environment, executionContext)).status, 403);
    const foreign = identityHeaders(a.owner.email, a.owner.name, true); foreign.origin = "https://other.invalid";
    assert.equal((await worker.fetch(new Request(`${origin}/api/v1/dealership`, { method: "POST", headers: foreign, body: JSON.stringify({ action: "adopt_legacy", mutationKey: "foreign", locationId: a.locationId }) }), environment, executionContext)).status, 403);
    state = await ok(await request()); const ready = state.stock.find(row => row.id === acquired.id);
    await ok(await write({ action: "deliver", episodeId: ready.id, expectedVersion: ready.version, deliveredDate: "2026-10-01", channel: "retail", amountCents: 1200000, credits: [] }));
    for (const kind of ["sales", "summary"]) {
      const response = await request(`/api/v1/dealership?format=csv&export=${kind}&from=2026-10-01&to=2026-10-02`); assert.equal(response.status, 200); assert.match(await response.text(), /1200000/);
    }
    await database.prepare("UPDATE tenant_subscriptions SET status='canceled' WHERE organization_id=?").bind(a.organizationId).run();
    assert.equal((await request()).status, 402);
    await database.prepare("UPDATE tenant_subscriptions SET status='active' WHERE organization_id=?").bind(a.organizationId).run();
    await setIndustry("retail"); assert.equal((await request()).status, 403);
    assert.equal((await database.prepare("SELECT count(*) n FROM dealership_sales WHERE organization_id=?").bind(a.organizationId).first()).n, 1);
  } finally { await dispose(); }
});
