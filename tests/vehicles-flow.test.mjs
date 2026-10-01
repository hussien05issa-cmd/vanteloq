import assert from "node:assert/strict";
import test from "node:test";
import { createEnvironment, createReportWorkspace, dispatch, origin, context as executionContext, identityHeaders } from "./helpers/retail-worker-fixture.mjs";

const vehicle = { identifierKind: "vin", identifier: "1HGCM82633A004352", year: 2003, make: "Honda", model: "Accord", stockNumber: "A-01", status: "available", acquiredDate: "2026-09-10", currency: "CAD", acquisitionCents: 1234567, reconditioningCents: null };
const headers = "identifier_kind,identifier,year,make,model,stock_number,status,acquired_date,currency,acquisition_amount,reconditioning_amount\n";
const csv = headers + "vin,1HGCM82633A004353,2003,Honda,Accord,CSV-01,reconditioning,2026-09-10,CAD,10000.01,0.00\n";
async function ok(response, status = 200) { assert.equal(response.status, status, await response.clone().text()); return response.json(); }

test("vehicle records enforce tenant boundaries, explicit imports, atomic duplicates, exact costs and optimistic writes", { timeout: 120_000 }, async () => {
  const { worker, environment, database, dispose } = await createEnvironment();
  try {
    const a = await createReportWorkspace(worker, environment, database, "vehicles-a");
    const b = await createReportWorkspace(worker, environment, database, "vehicles-b");
    const request = (path, options = {}) => dispatch(worker, environment, path, { ...a.owner, ...options });
    const created = await ok(await request("/api/v1/vehicles", { method: "POST", body: { action: "create", locationId: a.locationId, vehicle } }), 201);
    const id = created.ids[0];
    assert.equal((await request("/api/v1/vehicles", { method: "POST", body: { action: "create", locationId: b.locationId, vehicle: { ...vehicle, stockNumber: "FOREIGN", identifier: "1HGCM82633A004354" } } })).status, 403);
    assert.equal((await request(`/api/v1/vehicles?locationId=${encodeURIComponent(b.locationId)}`)).status, 403);
    assert.equal((await dispatch(worker, environment, "/api/v1/vehicles", { ...b.owner, method: "PATCH", body: { id, expectedVersion: 1, locationId: b.locationId, vehicle } })).status, 404);
    await ok(await dispatch(worker, environment, "/api/v1/vehicles", { ...b.owner, method: "POST", body: { action: "create", locationId: b.locationId, vehicle } }), 201);
    const preview = await ok(await request("/api/v1/vehicles", { method: "POST", body: { action: "preview", locationId: a.locationId, csv } }));
    assert.equal(preview.entries[0].acquisitionCents, 1000001); assert.equal(preview.entries[0].reconditioningCents, 0);
    assert.equal((await ok(await request("/api/v1/vehicles"))).vehicles.length, 1);
    assert.equal((await request("/api/v1/vehicles", { method: "POST", body: { action: "confirm", locationId: a.locationId, csv: csv.replace("10000.01", "10000.02"), fingerprint: preview.fingerprint } })).status, 409);
    await ok(await request("/api/v1/vehicles", { method: "POST", body: { action: "confirm", locationId: a.locationId, csv, fingerprint: preview.fingerprint } }), 201);
    assert.equal((await request("/api/v1/vehicles", { method: "POST", body: { action: "confirm", locationId: a.locationId, csv, fingerprint: preview.fingerprint } })).status, 409);
    assert.equal((await ok(await request("/api/v1/vehicles"))).vehicles.length, 2);
    const outcomes = await Promise.all(["reserved", "reconditioning"].map(status => request("/api/v1/vehicles", { method: "PATCH", body: { id, expectedVersion: 1, locationId: a.locationId, vehicle: { ...vehicle, status } } })));
    assert.deepEqual(outcomes.map(response => response.status).sort(), [200, 409]);
    const current = (await ok(await request("/api/v1/vehicles"))).vehicles.find(row => row.id === id);
    assert.equal(current.version, 2); assert.equal(current.acquisitionCents, 1234567);
    const exported = await request("/api/v1/vehicles?format=csv"); assert.equal(exported.status, 200); assert.match(exported.headers.get("cache-control"), /no-store/);
    assert.match(await exported.text(), /12345\.67/);
    const foreignOrigin = identityHeaders(a.owner.email, a.owner.name, true); foreignOrigin.origin = "https://other.invalid";
    assert.equal((await worker.fetch(new Request(`${origin}/api/v1/vehicles`, { method: "POST", headers: foreignOrigin, body: JSON.stringify({ action: "create", locationId: a.locationId, vehicle }) }), environment, executionContext)).status, 403);
    const bulkCsv = headers + Array.from({ length: 100 }, (_, index) => `vin,1HGCM82633A00${String(index).padStart(4, "0")},2003,Honda,Accord,BULK-${index},available,2026-09-10,CAD,,`).join("\n");
    const bulk = await ok(await request("/api/v1/vehicles", { method: "POST", body: { action: "preview", locationId: a.locationId, csv: bulkCsv } }));
    assert.equal(bulk.count, 100);
    await ok(await request("/api/v1/vehicles", { method: "POST", body: { action: "confirm", locationId: a.locationId, csv: bulkCsv, fingerprint: bulk.fingerprint } }), 201);
    const page1 = await ok(await request("/api/v1/vehicles")); assert.equal(page1.vehicles.length, 100); assert.ok(page1.nextCursor);
    const page2 = await ok(await request(`/api/v1/vehicles?after=${page1.nextCursor}`)); assert.equal(page2.vehicles.length, 2); assert.equal(page2.nextCursor, null);
    assert.equal(new Set([...page1.vehicles, ...page2.vehicles].map(row => row.id)).size, 102);
    await database.prepare("DELETE FROM workspaces WHERE id=?").bind(a.organizationId).run();
    assert.equal((await database.prepare("SELECT count(*) count FROM inventory_vehicles WHERE organization_id=?").bind(a.organizationId).first()).count, 0);
    assert.equal((await database.prepare("SELECT count(*) count FROM inventory_vehicles WHERE organization_id=?").bind(b.organizationId).first()).count, 1);
  } finally { await dispose(); }
});

test("vehicle reads redact costs and respect location, role, import, MFA and subscription revocation", { timeout: 120_000 }, async () => {
  const { worker, environment, database, dispose } = await createEnvironment();
  try {
    const a = await createReportWorkspace(worker, environment, database, "vehicle-permissions");
    const ownerRequest = (options = {}) => dispatch(worker, environment, "/api/v1/vehicles", { ...a.owner, ...options });
    const first = await ok(await ownerRequest({ method: "POST", body: { action: "create", locationId: a.locationId, vehicle } }), 201);
    const secondLocation = crypto.randomUUID();
    await database.prepare(`INSERT INTO organization_locations(id,organization_id,name,status,country_code,address_line_1,locality,administrative_area,timezone,currency,created_at,updated_at) VALUES(?,?,'Other outlet','active','CA','2 Test Ave','Edmonton','AB','America/Edmonton','CAD',1,1)`).bind(secondLocation, a.organizationId).run();
    const second = await ok(await ownerRequest({ method: "POST", body: { action: "create", locationId: secondLocation, vehicle: { ...vehicle, identifier: "1HGCM82633A004359", stockNumber: "SECOND" } } }), 201);
    const reader = { email: `vehicles-reader-${crypto.randomUUID()}@example.invalid`, name: "Vehicle reader" }, userId = crypto.randomUUID(), roleId = crypto.randomUUID();
    await database.batch([
      database.prepare("INSERT INTO users(id,email,display_name,status,created_at,updated_at) VALUES(?,?,?,'active',1,1)").bind(userId, reader.email, reader.name),
      database.prepare("INSERT INTO memberships(id,user_id,organization_id,role,status,created_at,updated_at) VALUES(?,?,?,'employee','active',1,1)").bind(crypto.randomUUID(), userId, a.organizationId),
      database.prepare("INSERT INTO access_roles(id,organization_id,name,permissions_json,created_by_user_id,created_at,updated_at) VALUES(?,?,'Vehicle reader','[\"inventory.view\"]',?,1,1)").bind(roleId, a.organizationId, a.userId),
      database.prepare("INSERT INTO team_members(id,organization_id,user_id,role_id,first_name,last_name,email,employee_code,primary_location_id,permitted_locations_json,status,remote_login,created_by_user_id,created_at,updated_at) VALUES(?,?,?,?,'Vehicle','Reader',?,'VEHICLE-READER',?,?,'active',1,?,1,1)").bind(crypto.randomUUID(), a.organizationId, userId, roleId, reader.email, a.locationId, JSON.stringify([a.locationId]), a.userId),
    ]);
    const request = (path = "/api/v1/vehicles", options = {}) => dispatch(worker, environment, path, { ...reader, ...options });
    let view = await ok(await request()); assert.equal(view.vehicles.length, 1); assert.equal(view.vehicles[0].acquisitionCents, null); assert.equal(view.permissions.edit, false);
    assert.equal((await request("/api/v1/vehicles?format=csv")).status, 403);
    assert.equal((await request("/api/v1/vehicles", { method: "PATCH", body: { id: first.ids[0], expectedVersion: 1, locationId: a.locationId, vehicle } })).status, 403);
    await database.prepare("UPDATE access_roles SET permissions_json=? WHERE id=?").bind(JSON.stringify(["inventory.view", "inventory.adjust", "data.import", "reports.export"]), roleId).run();
    assert.equal((await request(`/api/v1/vehicles?locationId=${secondLocation}`)).status, 403);
    assert.equal((await request("/api/v1/vehicles", { method: "PATCH", body: { id: second.ids[0], expectedVersion: 1, locationId: a.locationId, vehicle: { ...vehicle, acquisitionCents: null } } })).status, 403);
    assert.equal((await request("/api/v1/vehicles", { method: "POST", body: { action: "preview", locationId: a.locationId, csv } })).status, 403);
    await ok(await request("/api/v1/vehicles", { method: "PATCH", body: { id: first.ids[0], expectedVersion: 1, locationId: a.locationId, vehicle: { ...vehicle, acquisitionCents: null, status: "reserved" } } }));
    assert.equal((await database.prepare("SELECT acquisition_cents cost FROM inventory_vehicles WHERE id=?").bind(first.ids[0]).first()).cost, 1234567);
    const exportResponse = await request("/api/v1/vehicles?format=csv"); assert.equal(exportResponse.status, 200);
    const exportText = await exportResponse.text(); assert.doesNotMatch(exportText, /acquisition_amount|reconditioning_amount|SECOND|12345\.67/);
    const withoutCosts = csv.replace("10000.01,0.00", ",");
    const preview = await ok(await request("/api/v1/vehicles", { method: "POST", body: { action: "preview", locationId: a.locationId, csv: withoutCosts } }));
    await database.prepare("UPDATE access_roles SET permissions_json='[\"inventory.view\",\"inventory.adjust\"]' WHERE id=?").bind(roleId).run();
    assert.equal((await request("/api/v1/vehicles", { method: "POST", body: { action: "confirm", locationId: a.locationId, csv: withoutCosts, fingerprint: preview.fingerprint } })).status, 403);
    const aal1 = { ...identityHeaders(reader.email, reader.name), authorization: `Bearer test.${Buffer.from(JSON.stringify({ email: reader.email, aal: "aal1", session_id: "limited" })).toString("base64url")}.signature` };
    assert.equal((await worker.fetch(new Request(`${origin}/api/v1/vehicles`, { headers: aal1 }), environment, executionContext)).status, 403);
    await database.prepare("UPDATE tenant_subscriptions SET status='canceled' WHERE organization_id=?").bind(a.organizationId).run();
    const canceled = await request(); assert.equal(canceled.status, 402); assert.equal((await canceled.json()).error.code, "SUBSCRIPTION_REQUIRED");
    await database.prepare("UPDATE tenant_subscriptions SET status='active' WHERE organization_id=?").bind(a.organizationId).run();
    await database.prepare("UPDATE team_members SET permitted_locations_json='[]' WHERE user_id=?").bind(userId).run();
    view = await ok(await request()); assert.equal(view.vehicles.length, 0); assert.equal(view.locations.length, 0);
  } finally { await dispose(); }
});
