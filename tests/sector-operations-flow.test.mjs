import assert from "node:assert/strict";
import test from "node:test";
import { createEnvironment, createReportWorkspace, dispatch, dateOffset, origin, context, identityHeaders } from "./helpers/retail-worker-fixture.mjs";
import { defaultIndustryConfiguration } from "../domain/industry-templates.ts";

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Edmonton", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const route = "/api/v1/sector-operations";
async function ok(response, status = 200) { assert.equal(response.status, status, await response.clone().text()); return response.json(); }
function record(kind, values, extra = {}) { return { kind, title: `${kind}-${crypto.randomUUID()}`, source: "Fictional reviewed source sheet", sourceDate: today, dueDate: "", currency: "CAD", notes: "", values, batch: null, ...extra }; }
async function industry(db, workspace, value) { await db.prepare("UPDATE workspaces SET industry=? WHERE id=?").bind(value, workspace.organizationId).run(); await db.prepare("DELETE FROM workspace_industry_config WHERE organization_id=?").bind(workspace.organizationId).run(); }
function api(env, workspace) {
  const send = (body, owner = workspace.owner) => dispatch(env.worker, env.environment, route, { ...owner, method: "POST", body: { locationId: workspace.locationId, requestKey: crypto.randomUUID(), ...body } });
  const save = (content, extra = {}, owner) => send({ action: "save", expectedVersion: null, record: content, ...extra }, owner);
  const action = (row, action, extra = {}) => send({ id: row.id, expectedVersion: row.version, action, confirmed: true, ...extra });
  const get = (query = "", owner = workspace.owner) => dispatch(env.worker, env.environment, route + query, owner);
  return { send, save, action, get };
}
async function recipe(env, workspace) {
  return (await ok(await dispatch(env.worker, env.environment, "/api/v1/foodservice", { ...workspace.owner, method: "POST", body: { action: "save", locationId: workspace.locationId, expectedVersion: null, reviewed: true, record: { kind: "recipe", name: "Fictional soup", source: "Test recipe sheet", asOfDate: today, payload: { currency: "CAD", portions: "10", ingredients: [{ id: "Flour", purchaseQuantity: { amount: "1", unit: "kg" }, purchaseCost: { currency: "CAD", minor: 100 }, recipeQuantity: { amount: "1", unit: "kg" }, preparationYield: "1" }] } } } }), 201)).record;
}
async function position(db, workspace, sku, unit, quantity) {
  const id = crypto.randomUUID();
  await db.prepare("INSERT INTO workflow_inventory_positions(id,organization_id,location_id,sku,product_name,unit,currency,quantity_milli,version,created_at,updated_at) VALUES(?,?,?,?,?,?,'CAD',?,1,1,1)").bind(id, workspace.organizationId, workspace.locationId, sku, `Fictional ${sku}`, unit, quantity).run();
  return id;
}
async function stock(db, workspace) { return (await db.prepare("SELECT sku,quantity_milli quantity,version FROM workflow_inventory_positions WHERE organization_id=? ORDER BY sku").bind(workspace.organizationId).all()).results; }

test("preparation approval is atomic, idempotent, source-scoped and reversible without negative stock", { timeout: 120000 }, async () => {
  const env = await createEnvironment();
  try {
    const a = await createReportWorkspace(env.worker, env.environment, env.database, "sector-food-a"), b = await createReportWorkspace(env.worker, env.environment, env.database, "sector-food-b");
    await industry(env.database, a, "Café & coffee shop"); await industry(env.database, b, "Café & coffee shop");
    const localRecipe = await recipe(env, a), foreignRecipe = await recipe(env, b), app = api(env, a), other = api(env, b);
    const flour = await position(env.database, a, "FLOUR", "g", 2000000), soup = await position(env.database, a, "SOUP", "each", 0);
    const values = { recipeId: localRecipe.id, batchRef: "BATCH-1", portions: 10000, wastePortions: 0, preparedDate: today, useByDate: dateOffset(today, 1), ingredientSource: "TEST sheet 1", actualCost: 500 };
    const content = record("prep_batch", values, { batch: { output: { sku: "SOUP", unit: "each", quantityMilli: 10000 }, inputs: [{ sku: "FLOUR", unit: "g", quantityMilli: 1000000 }] } });
    assert.equal((await app.save({ ...content, values: { ...values, recipeId: foreignRecipe.id } })).status, 400);
    assert.equal((await app.save(content, { locationId: b.locationId })).status, 403);
    let row = (await ok(await app.save(content), 201)).record;
    const reloaded = await ok(await app.get()); assert.equal(reloaded.records[0].version, 1); assert.equal(reloaded.references.recipe[0].id, localRecipe.id); assert.equal(reloaded.references.recipe.some(r => r.id === foreignRecipe.id), false);
    assert.equal((await other.action(row, "review", { locationId: b.locationId })).status, 404);
    await env.database.prepare("UPDATE foodservice_records SET version=version+1 WHERE id=?").bind(localRecipe.id).run();
    assert.equal((await app.action(row, "review")).status, 409, "A changed recipe requires review and resaving the draft before production");
    row = (await ok(await app.save(content, { id: row.id, expectedVersion: row.version }))).record;
    assert.equal(row.links[0].version, 2);
    const key = crypto.randomUUID(), body = { action: "review", id: row.id, expectedVersion: row.version, confirmed: true, requestKey: key };
    row = (await ok(await app.send(body))).record;
    assert.equal((await ok(await app.send(body))).replayed, true);
    assert.equal((await app.send({ ...body, confirmed: false })).status, 409);
    assert.deepEqual((await stock(env.database, a)).map(r => [r.sku, r.quantity]), [["FLOUR",1000000],["SOUP",10000]]);
    assert.equal((await env.database.prepare("SELECT count(*) n FROM workflow_inventory_movements WHERE organization_id=?").bind(a.organizationId).first()).n, 2);
    assert.equal((await app.save({ ...content, source: "Illegal edit" }, { id: row.id, expectedVersion: row.version })).status, 409);
    row = (await ok(await app.action(row, "complete"))).record;
    row = (await ok(await app.action(row, "reopen", { reason: "Correct the documented quantity" }))).record;
    assert.equal(row.state, "draft"); assert.deepEqual((await stock(env.database, a)).map(r => r.quantity), [2000000,0]);
    const contenders = await Promise.all([app.action(row, "review"), app.action(row, "review")]);
    assert.deepEqual(contenders.map(r => r.status).sort(), [200,409]);
    row = (await ok(await app.get())).records.find(r => r.id === row.id);
    assert.deepEqual((await stock(env.database, a)).map(r => r.quantity), [1000000,10000]);
    const before = await stock(env.database, a), historyBefore = await ok(await app.get(`?history=${row.id}`));
    // Simulate a later independently confirmed consumption to exercise safe reversal.
    await env.database.prepare("UPDATE workflow_inventory_positions SET quantity_milli=0,version=version+1 WHERE id=?").bind(soup).run();
    assert.equal((await app.action(row, "reopen", { reason: "Output has already been used" })).status, 400);
    assert.equal((await stock(env.database, a)).find(r => r.sku === "FLOUR").quantity, before.find(r => r.sku === "FLOUR").quantity);
    assert.deepEqual((await ok(await app.get(`?history=${row.id}`))).revisions, historyBefore.revisions);
    // Insufficient ingredients leave both record approval and all outputs untouched.
    await env.database.prepare("UPDATE workflow_inventory_positions SET quantity_milli=0,version=version+1 WHERE id=?").bind(flour).run();
    const next = (await ok(await app.save({ ...content, title: "Second batch", values: { ...values, batchRef: "BATCH-2" } }), 201)).record;
    assert.equal((await app.action(next, "review")).status, 400); assert.equal((await ok(await app.get())).records.find(r => r.id === next.id).state, "draft");
    assert.equal((await other.get(`?history=${row.id}`)).status, 404);
    const history = await ok(await app.get(`?history=${row.id}`)); assert.equal(history.revisions.find(r => r.action === "reopen").reason, "Correct the documented quantity");
    assert.equal((await other.get()).status, 200); assert.equal((await ok(await other.get())).records.length, 0);
    const headers = { ...identityHeaders(a.owner.email, a.owner.name, true), origin: "https://foreign.invalid" };
    assert.equal((await env.worker.fetch(new Request(origin + route, { method: "POST", headers, body: JSON.stringify(body) }), env.environment, context)).status, 403);
    await env.database.prepare("DELETE FROM workspaces WHERE id=?").bind(a.organizationId).run();
    for (const table of ["sector_operation_records","sector_operation_revisions","sector_operation_requests","sector_room_nights"]) assert.equal((await env.database.prepare(`SELECT count(*) n FROM ${table} WHERE organization_id=?`).bind(a.organizationId).first()).n, 0);
  } finally { await env.dispose(); }
});

test("hotel review prevents room-night collisions and follows check-in, folio update, departure and housekeeping", { timeout: 120000 }, async () => {
  const env = await createEnvironment();
  try {
    const a = await createReportWorkspace(env.worker, env.environment, env.database, "sector-hotel"), b = await createReportWorkspace(env.worker, env.environment, env.database, "sector-other-hotel");
    await industry(env.database, a, "Hospitality"); await industry(env.database, b, "Hospitality");
    const app = api(env, a), other = api(env, b);
    const roomContent = record("room", { roomRef: "101", roomType: "Standard", condition: "inspected", occupied: false, blocked: false, assignee: "Morning team", blockReason: null });
    let room = (await ok(await app.save(roomContent), 201)).record;
    room = (await ok(await app.action(room, "review"))).record;
    const values = { roomId: room.id, reservationRef: "PMS-1", arrival: dateOffset(today, -1), departure: dateOffset(today, 1), roomRevenue: 20000, folioTotal: 22000, payments: 10000, arTransferred: 0, arRef: null };
    let stay = (await ok(await app.save(record("reservation", values)), 201)).record;
    assert.equal((await other.save(record("reservation", values), { locationId: b.locationId })).status, 400);
    stay = (await ok(await app.action(stay, "review"))).record;
    assert.equal((await env.database.prepare("SELECT count(*) n FROM sector_room_nights WHERE record_id=?").bind(stay.id).first()).n, 2);
    const overlap = (await ok(await app.save(record("reservation", { ...values, reservationRef: "PMS-2" })), 201)).record;
    assert.equal((await app.action(overlap, "review")).status, 409);
    assert.equal((await ok(await app.get())).records.find(r => r.id === overlap.id).state, "draft");
    assert.equal((await env.database.prepare("SELECT count(*) n FROM sector_room_nights WHERE record_id=?").bind(overlap.id).first()).n, 0);
    stay = (await ok(await app.action(stay, "start"))).record;
    room = (await ok(await app.get())).records.find(r => r.id === room.id);
    assert.equal(room.values.occupied, true); assert.equal(room.state, "draft");
    assert.equal((await app.action(stay, "complete")).status, 400);
    const amended = { ...stay, values: { ...stay.values, departure: today, roomRevenue: 10000, folioTotal: 11000, payments: 11000 } };
    assert.equal((await app.action(stay, "amend", { record: { ...amended, values: { ...amended.values, roomId: overlap.id } } })).status, 400);
    stay = (await ok(await app.action(stay, "amend", { record: amended }))).record;
    assert.equal(stay.state, "active"); assert.equal(stay.report.metrics.find(m => m.label === "Departure balance").value, 0);
    stay = (await ok(await app.action(stay, "complete"))).record;
    room = (await ok(await app.get())).records.find(r => r.id === room.id);
    assert.equal(room.values.occupied, false); assert.equal(room.values.condition, "dirty"); assert.equal(room.state, "draft");
    const h = await ok(await app.get(`?history=${stay.id}`)); assert.deepEqual(h.revisions.map(r => r.action), ["complete","amend","start","review","save"]);
    const rh = await ok(await app.get(`?history=${room.id}`)); assert.deepEqual(rh.revisions.map(r => r.action), ["stay_departure","stay_checkin","review","save"]);
    stay = (await ok(await app.action(stay, "reopen", { reason: "Correct source folio" }))).record;
    assert.equal(stay.state, "draft"); assert.equal((await env.database.prepare("SELECT count(*) n FROM sector_room_nights WHERE record_id=?").bind(stay.id).first()).n, 0);
    // Room readiness source must be current even if the prior inspection was approved.
    let cleanRoom = (await ok(await app.save({ ...room, sourceDate: dateOffset(today, -1), values: { ...room.values, condition: "inspected" } }, { id: room.id, expectedVersion: room.version }))).record;
    cleanRoom = (await ok(await app.action(cleanRoom, "review"))).record;
    assert.equal(cleanRoom.state, "reviewed");
    const newStay = (await ok(await app.save(record("reservation", { ...values, reservationRef: "PMS-3", arrival: today })), 201)).record;
    const approved = (await ok(await app.action(newStay, "review"))).record;
    assert.equal((await app.action(approved, "start")).status, 409);
    await env.database.prepare("DELETE FROM workspaces WHERE id=?").bind(a.organizationId).run();
    for (const table of ["sector_operation_records","sector_operation_revisions","sector_operation_requests","sector_room_nights"]) assert.equal((await env.database.prepare(`SELECT count(*) n FROM ${table} WHERE organization_id=?`).bind(a.organizationId).first()).n, 0);
  } finally { await env.dispose(); }
});

test("service-period records keep missing evidence visible and enforce role, subscription and business boundaries", { timeout: 120000 }, async () => {
  const env = await createEnvironment();
  try {
    const a = await createReportWorkspace(env.worker, env.environment, env.database, "sector-service"); await industry(env.database, a, "Restaurant");
    const app = api(env, a), values = { serviceDate: today, daypart: "Lunch", projectedSales: 100000, netSales: 90000, plannedMinutes: 600, paidMinutes: 540, labourCost: 18000, orders: 60, lateOrders: 6, coverageComplete: true };
    let row = (await ok(await app.save(record("service_period", values)), 201)).record;
    row = (await ok(await app.action(row, "review"))).record; row = (await ok(await app.action(row, "complete"))).record;
    assert.equal(row.report.metrics.find(m => m.label === "Sales per paid hour").value, 10000);
    row = (await ok(await app.action(row, "reopen", { reason: "Revise the paid-time source" }))).record;
    row = (await ok(await app.save({ ...row, values: { ...values, paidMinutes: null } }, { id: row.id, expectedVersion: row.version }))).record;
    assert.equal((await app.action(row, "review")).status, 400);
    const reader = { email: `sector-reader-${crypto.randomUUID()}@example.invalid`, name: "Operations reader" }, userId = crypto.randomUUID(), roleId = crypto.randomUUID();
    await env.database.batch([
      env.database.prepare("INSERT INTO users(id,email,display_name,status,created_at,updated_at) VALUES(?,?,?,'active',1,1)").bind(userId,reader.email,reader.name),
      env.database.prepare("INSERT INTO memberships(id,user_id,organization_id,role,status,created_at,updated_at) VALUES(?,?,?,'employee','active',1,1)").bind(crypto.randomUUID(),userId,a.organizationId),
      env.database.prepare("INSERT INTO access_roles(id,organization_id,name,permissions_json,created_by_user_id,created_at,updated_at) VALUES(?,?,'Operations only',?,?,1,1)").bind(roleId,a.organizationId,JSON.stringify(["operations.tasks"]),a.userId),
      env.database.prepare("INSERT INTO team_members(id,organization_id,user_id,role_id,first_name,last_name,email,employee_code,primary_location_id,permitted_locations_json,status,remote_login,created_by_user_id,created_at,updated_at) VALUES(?,?,?,?,'Ops','Reader',?,'SECTOR-READER',?,?,'active',1,?,1,1)").bind(crypto.randomUUID(),a.organizationId,userId,roleId,reader.email,a.locationId,JSON.stringify([a.locationId]),a.userId),
    ]);
    const view = await ok(await app.get("", reader)); assert.deepEqual(view.records, []); assert.deepEqual(view.kinds, []);
    assert.equal((await app.get(`?history=${row.id}`, reader)).status, 403);
    assert.equal((await app.save(record("service_period", values), {}, reader)).status, 403);
    await industry(env.database, a, "Retail"); assert.deepEqual((await ok(await app.get())).kinds, []); assert.equal((await app.get(`?history=${row.id}`)).status, 403);
    await industry(env.database, a, "Restaurant"); await env.database.prepare("UPDATE tenant_subscriptions SET status='canceled' WHERE organization_id=?").bind(a.organizationId).run();
    assert.equal((await app.get()).status, 402);
  } finally { await env.dispose(); }
});

test("prep, supplier, delivery, furniture and vehicle funding workflows persist and retain their linked evidence", { timeout: 120000 }, async () => {
  const env = await createEnvironment();
  try {
    const cafe = await createReportWorkspace(env.worker, env.environment, env.database, "sector-linked-cafe"), furniture = await createReportWorkspace(env.worker, env.environment, env.database, "sector-furniture"), dealer = await createReportWorkspace(env.worker, env.environment, env.database, "sector-dealer");
    await industry(env.database, cafe, "Café & coffee shop"); await industry(env.database, furniture, "Furniture & appliances");
    async function purchase(workspace) { const id=crypto.randomUUID();await env.database.prepare("INSERT INTO purchase_orders(id,organization_id,order_number,supplier_name,delivery_location_id,order_date,currency,created_by_user_id,created_at,updated_at) VALUES(?,?,'TEST-PO','Fictional supplier',?,?,'CAD',?,1,1)").bind(id,workspace.organizationId,workspace.locationId,today,workspace.userId).run();return id; }
    const cafePO = await purchase(cafe), furniturePO = await purchase(furniture), savedRecipe = await recipe(env,cafe);
    async function cycle(workspace, content) { const app=api(env,workspace);let row=(await ok(await app.save(content),201)).record;assert.equal((await ok(await app.get())).records.some(r=>r.id===row.id),true);row=(await ok(await app.action(row,"review"))).record;row=(await ok(await app.action(row,"complete"))).record;assert.equal(row.state,"completed");row=(await ok(await app.action(row,"reopen",{reason:"Reviewed correction"}))).record;assert.equal(row.state,"draft");assert.deepEqual((await ok(await app.get(`?history=${row.id}`))).revisions.map(r=>r.action),["reopen","complete","review","save"]);return row; }
    const plan=await cycle(cafe,record("prep_plan",{recipeId:savedRecipe.id,station:"Cold prep",demand:20000,buffer:2000,usable:4000,planned:6000,batch:5000,shelfLifeDays:1}));
    assert.equal(plan.report.metrics.find(m=>m.label==="Suggested portions").value,15000);
    const supplier=await cycle(cafe,record("supplier_check",{purchaseId:cafePO,item:"Cases converted to individual base units",ordered:10000,received:9000,invoiced:10000,invoiceAmount:10000,creditExpected:1000,creditReceived:1000,disposition:"resolved"},{notes:"Supplier credit note TEST-CN settled the short receipt."}));assert.equal(supplier.links[0].id,cafePO);
    await cycle(cafe,record("delivery_order",{provider:"Fictional delivery platform",orderRef:"TEST-DELIVERY",settlementRef:"TEST-SETTLEMENT",netSales:10000,taxTips:1000,fees:2500,adjustments:0,payout:8500,foodCost:2000,packaging:500,incrementalLabour:0,resolved:false}));
    const furnitureApp=api(env,furniture),special=record("furniture_order",{orderRef:"CUSTOMER-INVOICE-1",purchaseId:furniturePO,item:"Fictional sofa, blue fabric",orderTotal:120000,deposit:20000,otherPayments:100000,supplierCost:50000,deliveryDate:today,deliveryStatus:"delivered",accepted:true,creditTerms:false});
    assert.equal((await furnitureApp.save({...special,values:{...special.values,purchaseId:cafePO}})).status,400);
    const order=await cycle(furniture,special);assert.equal(order.report.metrics.find(m=>m.label==="Customer balance").value,0);
    const request=(path,options={})=>dispatch(env.worker,env.environment,path,{...dealer.owner,...options});
    const current=await ok(await request("/api/v1/industry-configuration")),configuration=defaultIndustryConfiguration("dealership");
    const preview=await ok(await request("/api/v1/industry-configuration",{method:"POST",body:{action:"preview",expectedRevision:current.revision,configuration}}));
    await ok(await request("/api/v1/industry-configuration",{method:"POST",body:{action:"save",expectedRevision:current.revision,configuration,fingerprint:preview.fingerprint}}));
    const vehicle=await ok(await request("/api/v1/dealership",{method:"POST",body:{mutationKey:crypto.randomUUID(),action:"acquire",locationId:dealer.locationId,vehicle:{identifierKind:"vin",identifier:"1HGCM82633A004352",year:2003,make:"Honda",model:"Accord",stockNumber:"TEST-FUNDING",acquiredDate:dateOffset(today,-10)},ownership:"owned",physicalStatus:"on_lot",prepStatus:"ready",askingCents:1500000}}));
    const funding=await cycle(dealer,record("dealer_funding",{stockId:vehicle.id,dealRef:"LENDER-TEST-1",fundingExpected:1500000,fundingReceived:1500000,payoffDue:300000,payoffPaid:300000,customerDue:500000,customerReceived:500000,documentsReady:true,releaseReady:true,holdingDailyCost:1234,holdingFrom:dateOffset(today,-5),holdingTo:today}));
    assert.equal(funding.links[0].id,vehicle.id);assert.equal(funding.report.metrics.find(m=>m.label==="Lender funding outstanding").value,0);assert.equal(funding.report.metrics.find(m=>m.label==="Holding-cost estimate").value,6170);assert.equal(funding.report.metrics.find(m=>m.label==="Holding days").value,5);
    const fundingHistory=await ok(await api(env,dealer).get(`?history=${funding.id}`));assert.equal(fundingHistory.revisions[0].content.values.holdingDailyCost,1234);assert.equal(fundingHistory.revisions[0].content.values.holdingFrom,dateOffset(today,-5));
    const dealerApp=api(env,dealer),partial=(await ok(await dealerApp.save({...funding,values:{...funding.values,holdingDailyCost:null}},{id:funding.id,expectedVersion:funding.version}))).record;
    assert.equal(partial.report.metrics.find(m=>m.label==="Holding-cost estimate").value,null);
    assert.equal((await dealerApp.action(partial,"review")).status,400);
    assert.equal((await ok(await dealerApp.get())).records.find(r=>r.id===partial.id).state,"draft");
  } finally { await env.dispose(); }
});
