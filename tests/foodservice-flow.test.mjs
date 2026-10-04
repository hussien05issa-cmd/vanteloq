import assert from "node:assert/strict";
import test from "node:test";
import { createEnvironment, createReportWorkspace, dispatch, origin, context as executionContext, identityHeaders } from "./helpers/retail-worker-fixture.mjs";
const money = minor => ({ currency: "CAD", minor });
const recipe = { kind: "recipe", name: "Reviewed soup", source: "Supplier invoice and yield sheet", asOfDate: "2026-09-01", payload: { currency: "CAD", portions: "3", ingredients: [{ id: "Soup ingredient", purchaseQuantity: { amount: "1", unit: "kg" }, purchaseCost: money(100), recipeQuantity: { amount: "1", unit: "kg" }, preparationYield: "1" }] } };
const period = { kind: "period", name: "September review", source: "Count sheets, POS and payroll summary", asOfDate: "2026-09-30", from: "2026-09-01", to: "2026-09-30", payload: { currency: "CAD", opening: money(10000), purchases: money(40000), supplierCredits: money(0), transfersIn: money(0), transfersOut: money(0), closing: money(20000), foodNetSales: money(100000), totalNetSales: money(120000), theoreticalCost: money(28000), recordedWasteCost: money(1000), labourCost: money(40000), otherVariableCosts: null, closedChecks: 60 } };
async function ok(response, status = 200) { assert.equal(response.status, status, await response.clone().text()); return response.json(); }

test("foodservice saves reconcile, isolate tenant/location data and reject stale versions", { timeout: 120000 }, async () => {
  const { worker, environment, database, dispose } = await createEnvironment();
  try {
    const a = await createReportWorkspace(worker, environment, database, "foodservice-a"), b = await createReportWorkspace(worker, environment, database, "foodservice-b");
    await database.prepare("UPDATE workspaces SET industry='Café & coffee shop' WHERE id IN (?,?)").bind(a.organizationId,b.organizationId).run();
    await database.prepare("DELETE FROM workspace_industry_config WHERE organization_id IN (?,?)").bind(a.organizationId,b.organizationId).run();
    const get = (owner = a.owner, query = "") => dispatch(worker, environment, `/api/v1/foodservice${query}`, owner);
    const save = (record, extra = {}, owner = a.owner) => dispatch(worker, environment, "/api/v1/foodservice", { ...owner, method: "POST", body: { action: "save", locationId: a.locationId, expectedVersion: null, reviewed: true, record, ...extra } });
    assert.equal((await ok(await get())).records.length, 0);
    const created = (await ok(await save(recipe), 201)).record;
    assert.equal(created.report.recipe.value.totalMinor, 100); assert.equal(created.report.recipe.value.perPortionMinor, 33);
    const savedPeriod = (await ok(await save(period), 201)).record;
    assert.equal(savedPeriod.report.inventory.value.actualMinor, 30000); assert.equal(savedPeriod.report.metrics.foodContribution.value.minor, 70000); assert.equal(savedPeriod.report.metrics.labourCostBasisPoints.value, 3333);
    const reread = await ok(await get()); assert.equal(reread.records.length, 2); assert.equal(reread.records.find(r => r.id === created.id).payload.ingredients[0].purchaseCost.minor, 100);
    assert.equal((await save(recipe)).status, 409);
    assert.equal((await save(recipe, { reviewed: false })).status, 400);
    assert.equal((await save(recipe, { locationId: b.locationId })).status, 403);
    assert.equal((await get(a.owner, `?locationId=${encodeURIComponent(b.locationId)}`)).status, 403);
    assert.equal((await get(b.owner)).status, 200); assert.equal((await ok(await get(b.owner))).records.length, 0);
    assert.equal((await save(recipe, { id: created.id, expectedVersion: 1, locationId: b.locationId }, b.owner)).status, 404);
    const changes = await Promise.all(["Supplier sheet A", "Supplier sheet B"].map(source => save({ ...recipe, source }, { id: created.id, expectedVersion: 1 })));
    assert.deepEqual(changes.map(r => r.status).sort(), [200,409]);
    assert.equal((await ok(await get())).records.find(r => r.id === created.id).version, 2);
    const usd = { ...recipe, name: "Wrong currency", payload: { ...recipe.payload, currency: "USD", ingredients: [{ ...recipe.payload.ingredients[0], purchaseCost: { currency: "USD", minor: 100 } }] } };
    assert.equal((await save(usd)).status, 400);
    assert.equal((await save({ ...recipe, asOfDate: "2200-01-01" })).status, 400);
    const crossOrigin = { ...identityHeaders(a.owner.email,a.owner.name,true), origin: "https://foreign.invalid" };
    assert.equal((await worker.fetch(new Request(`${origin}/api/v1/foodservice`, { method: "POST", headers: crossOrigin, body: JSON.stringify({ action: "save" }) }), environment, executionContext)).status, 403);
    await assert.rejects(database.prepare("UPDATE foodservice_records SET location_id=? WHERE id=?").bind(b.locationId, created.id).run(), /location or currency mismatch/);
    await assert.rejects(database.prepare("UPDATE foodservice_records SET currency='USD' WHERE id=?").bind(created.id).run(), /location or currency mismatch/);
    await database.prepare("UPDATE workspaces SET industry='Food & beverage' WHERE id=?").bind(b.organizationId).run();
    assert.equal((await get(b.owner)).status, 403, "legacy generic food selection does not silently enable café costing");
    await database.prepare("DELETE FROM workspaces WHERE id=?").bind(a.organizationId).run();
    assert.equal((await database.prepare("SELECT count(*) n FROM foodservice_records WHERE organization_id=?").bind(a.organizationId).first()).n, 0);
  } finally { await dispose(); }
});

test("foodservice permissions protect period/payroll inputs, locations and revoked entitlements", { timeout: 120000 }, async () => {
  const { worker, environment, database, dispose } = await createEnvironment();
  try {
    const a = await createReportWorkspace(worker, environment, database, "foodservice-permissions");
    await database.prepare("UPDATE workspaces SET industry='Restaurant' WHERE id=?").bind(a.organizationId).run();
    await database.prepare("DELETE FROM workspace_industry_config WHERE organization_id=?").bind(a.organizationId).run();
    const save = record => dispatch(worker, environment, "/api/v1/foodservice", { ...a.owner, method: "POST", body: { action: "save", reviewed: true, expectedVersion: null, locationId: a.locationId, record } });
    await ok(await save(recipe), 201); await ok(await save(period), 201);
    const reader = { email: `food-reader-${crypto.randomUUID()}@example.invalid`, name: "Food reader" }, userId = crypto.randomUUID(), roleId = crypto.randomUUID();
    await database.batch([
      database.prepare("INSERT INTO users(id,email,display_name,status,created_at,updated_at) VALUES(?,?,?,'active',1,1)").bind(userId,reader.email,reader.name),
      database.prepare("INSERT INTO memberships(id,user_id,organization_id,role,status,created_at,updated_at) VALUES(?,?,?,'employee','active',1,1)").bind(crypto.randomUUID(),userId,a.organizationId),
      database.prepare("INSERT INTO access_roles(id,organization_id,name,permissions_json,created_by_user_id,created_at,updated_at) VALUES(?,?,'Recipe reader',?, ?,1,1)").bind(roleId,a.organizationId,JSON.stringify(["inventory.view","inventory.value"]),a.userId),
      database.prepare("INSERT INTO team_members(id,organization_id,user_id,role_id,first_name,last_name,email,employee_code,primary_location_id,permitted_locations_json,status,remote_login,created_by_user_id,created_at,updated_at) VALUES(?,?,?,?,'Food','Reader',?,'FOOD-READER',?,?,'active',1,?,1,1)").bind(crypto.randomUUID(),a.organizationId,userId,roleId,reader.email,a.locationId,JSON.stringify([a.locationId]),a.userId),
    ]);
    const get = () => dispatch(worker,environment,"/api/v1/foodservice",reader);
    let view = await ok(await get()); assert.equal(view.records.length, 1); assert.equal(view.records[0].kind,"recipe"); assert.equal(view.permissions.periodRead,false); assert.equal(view.permissions.recipeWrite,false);
    assert.equal((await dispatch(worker,environment,"/api/v1/foodservice",{ ...reader, method:"POST", body:{action:"save",reviewed:true,expectedVersion:null,locationId:a.locationId,record:period} })).status,403);
    await database.prepare("UPDATE access_roles SET permissions_json='[\"inventory.view\"]' WHERE id=?").bind(roleId).run(); assert.equal((await get()).status,403);
    await database.prepare("UPDATE access_roles SET permissions_json='[\"inventory.view\",\"inventory.value\"]' WHERE id=?").bind(roleId).run();
    await database.prepare("UPDATE team_members SET permitted_locations_json='[]' WHERE user_id=?").bind(userId).run(); view=await ok(await get()); assert.equal(view.locations.length,0); assert.equal(view.records.length,0);
    await database.prepare("UPDATE tenant_subscriptions SET status='canceled' WHERE organization_id=?").bind(a.organizationId).run(); assert.equal((await get()).status,402);
  } finally { await dispose(); }
});
