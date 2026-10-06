import assert from "node:assert/strict";
import test from "node:test";
import { context, createEnvironment, createReportWorkspace, dispatch, identityHeaders, origin, seedReportConnection, seedReportLocation, seedReportMetric } from "./helpers/retail-worker-fixture.mjs";

async function expectResponse(response, status, code) {
  const text = await response.text();
  assert.equal(response.status, status, text);
  const body = JSON.parse(text);
  if (code) assert.equal(body.error.code, code, text);
  return body;
}

function roleBody(locationScope, overrides = {}) {
  return {
    action: "save_role",
    // Unique names keep this acceptance test focused on security delegation.
    // Reusing a name tests the existing database uniqueness constraint.
    name: "Scoped review " + crypto.randomUUID(),
    description: "Fictional security acceptance fixture",
    color: "#53657a", permissions: ["dashboard.view", "metrics.revenue"],
    locationScope, ...overrides,
  };
}

function employeeBody(roleId, locationId) {
  const suffix = crypto.randomUUID();
  return {
    action: "create_employee", firstName: "Fictional", lastName: "Reviewer",
    email: "review-" + suffix + "@example.invalid", employeeCode: "TEST-" + suffix.slice(0, 8),
    roleId, primaryLocationId: locationId, permittedLocations: [locationId],
    remoteLogin: false, requireMfa: true,
  };
}

async function seedScopedAdministrator(database, workspace) {
  const now = Date.now();
  const userId = crypto.randomUUID(), roleId = crypto.randomUUID(), memberId = crypto.randomUUID();
  const email = "scoped-" + crypto.randomUUID() + "@example.invalid";
  const name = "Fictional Scoped Administrator";
  const permissions = ["dashboard.view", "metrics.revenue", "team.roles", "team.create", "team.edit", "integrations.manage"];
  await database.batch([
    database.prepare("INSERT INTO users (id, email, display_name, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)").bind(userId, email, name, now, now),
    database.prepare("INSERT INTO memberships (id, user_id, organization_id, role, status, created_at, updated_at) VALUES (?, ?, ?, 'admin', 'active', ?, ?)").bind(crypto.randomUUID(), userId, workspace.organizationId, now, now),
    database.prepare("INSERT INTO access_roles (id, organization_id, name, description, color, system_key, permissions_json, location_scope_json, archived, created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, '', '#53657a', NULL, ?, ?, 0, ?, ?, ?)")
      .bind(roleId, workspace.organizationId, "Administrator " + roleId, JSON.stringify(permissions), JSON.stringify([workspace.locationId]), workspace.userId, now, now),
    database.prepare("INSERT INTO team_members (id, organization_id, user_id, role_id, first_name, last_name, email, employee_code, primary_location_id, permitted_locations_json, status, remote_login, require_mfa, pin_enabled, notes, created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, 'Fictional', 'Administrator', ?, ?, ?, ?, 'active', 1, 1, 0, '', ?, ?, ?)")
      .bind(memberId, workspace.organizationId, userId, roleId, email, "ADMIN-" + userId.slice(0, 8), workspace.locationId, JSON.stringify([workspace.locationId]), workspace.userId, now, now),
  ]);
  return { email, name, userId, roleId, memberId };
}

test("role delegation, employee locations and report-source choices stay within the administrator's permitted locations", { timeout: 120000 }, async () => {
  const { worker, environment, database, dispose } = await createEnvironment();
  try {
    const a = await createReportWorkspace(worker, environment, database, "scoped-security");
    const b = await createReportWorkspace(worker, environment, database, "foreign-security");
    const hiddenLocation = await seedReportLocation(database, a.organizationId, "Other local outlet");
    await expectResponse(await dispatch(worker, environment, "/api/v1/governance", a.owner), 200);
    const admin = await seedScopedAdministrator(database, a);
    const post = body => dispatch(worker, environment, "/api/v1/governance", { ...admin, method: "POST", body });
    const rolesBefore = await database.prepare("SELECT COUNT(*) AS count FROM access_roles WHERE organization_id=?").bind(a.organizationId).first();
    for (const scope of [[], [hiddenLocation], [a.locationId, hiddenLocation], [b.locationId]]) {
      await expectResponse(await post(roleBody(scope)), 403, "ROLE_LOCATION_DELEGATION_EXCEEDED");
    }
    assert.equal((await database.prepare("SELECT COUNT(*) AS count FROM access_roles WHERE organization_id=?").bind(a.organizationId).first()).count, rolesBefore.count);
    const validRole = roleBody([a.locationId]);
    await expectResponse(await post(validRole), 200);
    const savedRole = await database.prepare("SELECT id, location_scope_json FROM access_roles WHERE organization_id=? AND name=?").bind(a.organizationId, validRole.name).first();
    assert.ok(savedRole?.id);
    assert.deepEqual(JSON.parse(savedRole.location_scope_json), [a.locationId]);
    await expectResponse(await post(roleBody([a.locationId], { roleId: admin.roleId })), 409, "SELF_ROLE_CHANGE_FORBIDDEN");
    await expectResponse(await post(roleBody([a.locationId], { permissions: ["organization.settings"] })), 403, "ROLE_DELEGATION_EXCEEDED");

    const employeesBefore = await database.prepare("SELECT COUNT(*) AS count FROM team_members WHERE organization_id=?").bind(a.organizationId).first();
    await expectResponse(await post(employeeBody(savedRole.id, hiddenLocation)), 403, "ROLE_LOCATION_DELEGATION_EXCEEDED");
    await expectResponse(await post(employeeBody(savedRole.id, b.locationId)), 403, "ROLE_LOCATION_DELEGATION_EXCEEDED");
    assert.equal((await database.prepare("SELECT COUNT(*) AS count FROM team_members WHERE organization_id=?").bind(a.organizationId).first()).count, employeesBefore.count);
    const employee = employeeBody(savedRole.id, a.locationId);
    await expectResponse(await post(employee), 201);
    assert.deepEqual(JSON.parse((await database.prepare("SELECT permitted_locations_json FROM team_members WHERE organization_id=? AND email=?").bind(a.organizationId, employee.email).first()).permitted_locations_json), [a.locationId]);

    const connectionId = crypto.randomUUID();
    const locationRef = await seedReportConnection(database, { ...a, connectionId, namespace: "production:" + connectionId, externalLocationRef: "authorized-outlet" });
    await seedReportMetric(database, { ...a, businessDate: "2026-10-04", locationRef, netSalesCents: 1000, sourceConnectionId: connectionId });
    const sourcePost = locationId => dispatch(worker, environment, "/api/v1/reports", {
      ...admin, method: "POST", body: { action: "set_source_authority", locationId, connectionId, factFamily: "sales", expectedVersion: 0 },
    });
    await expectResponse(await sourcePost(hiddenLocation), 403, "LOCATION_ACCESS_DENIED");
    await expectResponse(await sourcePost(b.locationId), 403, "LOCATION_ACCESS_DENIED");
    assert.equal((await database.prepare("SELECT COUNT(*) AS count FROM integration_source_authorities").first()).count, 0);
    await expectResponse(await sourcePost(a.locationId), 200);
    const authorities = await database.prepare("SELECT organization_id, local_location_id, connection_id FROM integration_source_authorities").all();
    assert.deepEqual(authorities.results, [{ organization_id: a.organizationId, local_location_id: a.locationId, connection_id: connectionId }]);
  } finally { await dispose(); }
});

test("the workspace list exposes only active authorized membership metadata and rejects forged or suspended context", { timeout: 120000 }, async () => {
  const { worker, environment, database, dispose } = await createEnvironment();
  try {
    const a = await createReportWorkspace(worker, environment, database, "authorized-workspace");
    const b = await createReportWorkspace(worker, environment, database, "private-workspace");
    const read = path => dispatch(worker, environment, path, a.owner);
    const response = await expectResponse(await read("/api/v1/workspaces"), 200);
    assert.equal(response.currentWorkspaceId, a.organizationId);
    assert.equal(response.workspaces.length, 1);
    assert.equal(response.workspaces[0].id, a.organizationId);
    assert.deepEqual(Object.keys(response.workspaces[0]).sort(), ["id", "industry", "name", "role", "setupComplete"].sort());
    assert.equal(JSON.stringify(response).includes(b.organizationId), false);
    assert.equal(JSON.stringify(response).includes(b.owner.email), false);
    await expectResponse(await read("/api/v1/workspaces?workspace=" + a.organizationId), 200);
    await expectResponse(await read("/api/v1/workspaces?workspace=" + b.organizationId), 403, "WORKSPACE_NOT_AVAILABLE");
    await expectResponse(await read("/api/v1/workspaces?workspace=%3Cscript%3E"), 400, "WORKSPACE_CONTEXT_INVALID");
    await expectResponse(await worker.fetch(new Request(origin + "/api/v1/workspaces", { headers: { accept: "application/json" } }), environment, context), 401, "AUTHENTICATION_REQUIRED");
    const weakHeaders = identityHeaders(a.owner.email, a.owner.name);
    const weakPayload = Buffer.from(JSON.stringify({ email: a.owner.email, aal: "aal1", session_id: "session:" + a.owner.email })).toString("base64url");
    weakHeaders.authorization = "Bearer test." + weakPayload + ".signature";
    await expectResponse(await worker.fetch(new Request(origin + "/api/v1/workspaces", { headers: weakHeaders }), environment, context), 403, "MFA_REQUIRED");
    await database.prepare("UPDATE memberships SET status='suspended' WHERE user_id=? AND organization_id=?").bind(a.userId, a.organizationId).run();
    const suspended = await expectResponse(await read("/api/v1/workspaces"), 200);
    assert.deepEqual(suspended, { workspaces: [], currentWorkspaceId: null });
    await expectResponse(await read("/api/v1/workspaces?workspace=" + a.organizationId), 403, "WORKSPACE_NOT_AVAILABLE");
  } finally { await dispose(); }
});
