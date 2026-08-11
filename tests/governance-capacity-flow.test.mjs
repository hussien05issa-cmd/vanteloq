import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { Miniflare } from "miniflare";

const origin = "https://vanteloq.example";
const context = { waitUntil() {}, passThroughOnException() {} };

function ownerHeaders(email, name, write = false) {
  const headers = {
    accept: "application/json",
    "oai-authenticated-user-email": email,
    "oai-authenticated-user-full-name": encodeURIComponent(name),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  };
  if (write) {
    headers["content-type"] = "application/json";
    headers.origin = origin;
    headers["sec-fetch-site"] = "same-origin";
  }
  return headers;
}

function onboardingPayload(ownerName, businessName, businessEmail) {
  return {
    ownerName,
    businessName,
    legalName: `${businessName} Ltd.`,
    businessEmail,
    phone: "",
    website: "",
    industry: "Retail",
    country: "CA",
    province: "AB",
    city: "Edmonton",
    address: "1 Test Avenue",
    postalCode: "T5A 1A1",
    emailNotifications: true,
    timezone: "America/Edmonton",
    currency: "CAD",
    fiscalYearStart: "January",
    taxNumber: "",
    sourceMode: "connect_later",
    selectedPos: "",
    hours: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
      .map((day) => ({ day, open: "09:00", close: "17:00", closed: false })),
  };
}

async function applyMigrations(database) {
  const migrations = (await readdir(new URL("../drizzle/", import.meta.url)))
    .filter((file) => /^\d{4}.*\.sql$/.test(file))
    .sort();
  for (const migration of migrations) {
    const sql = await readFile(new URL(`../drizzle/${migration}`, import.meta.url), "utf8");
    for (const statement of sql.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
      await database.prepare(statement).run();
    }
  }
}

async function createEnvironment() {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: `vanteloq-governance-capacity-${crypto.randomUUID()}` },
  });
  const database = await miniflare.getD1Database("DB");
  await applyMigrations(database);
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("governance-capacity-test", crypto.randomUUID());
  const worker = (await import(workerUrl.href)).default;
  const environment = {
    DB: database,
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  };
  return { miniflare, database, worker, environment };
}

async function dispatch(worker, environment, path, { method = "GET", email, name, body } = {}) {
  return worker.fetch(new Request(`${origin}${path}`, {
    method,
    headers: ownerHeaders(email, name, method !== "GET"),
    body: body ? JSON.stringify(body) : undefined,
  }), environment, context);
}

async function createWorkspace(worker, environment, database, {
  email,
  ownerName,
  businessName,
  plan,
}) {
  const onboarding = await dispatch(worker, environment, "/api/v1/onboarding", {
    method: "POST",
    email,
    name: ownerName,
    body: onboardingPayload(ownerName, businessName, `${businessName.toLowerCase().replace(/[^a-z]/g, "")}@example.invalid`),
  });
  assert.equal(onboarding.status, 201, await onboarding.clone().text());
  const organizationId = (await onboarding.json()).organization.id;
  const now = Date.now();
  if (plan) {
    await database.prepare(`INSERT INTO tenant_subscriptions
      (organization_id, base_plan, billing_interval, status, cancel_at_period_end, version, created_at, updated_at)
      VALUES (?, ?, 'month', 'active', 0, 1, ?, ?)`)
      .bind(organizationId, plan, now, now).run();
  }
  const governance = await dispatch(worker, environment, "/api/v1/governance", {
    email,
    name: ownerName,
  });
  assert.equal(governance.status, 200, await governance.clone().text());
  return { organizationId, email, name: ownerName };
}

async function createGovernanceUser(database, organizationId, {
  email,
  name,
  membershipRole,
  permissions,
  existingRoleId = null,
}) {
  const owner = await database.prepare(`SELECT user_id userId FROM memberships
    WHERE organization_id = ? AND role = 'owner' LIMIT 1`).bind(organizationId).first();
  assert.ok(owner?.userId);
  const now = Date.now();
  const userId = crypto.randomUUID();
  const roleId = existingRoleId ?? crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const [firstName, ...lastNameParts] = name.split(" ");
  const statements = [
    database.prepare(`INSERT INTO users
      (id, email, display_name, status, created_at, updated_at)
      VALUES (?, ?, ?, 'active', ?, ?)`).bind(userId, email, name, now, now),
    database.prepare(`INSERT INTO memberships
      (id, user_id, organization_id, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?)`).bind(crypto.randomUUID(), userId, organizationId, membershipRole, now, now),
  ];
  if (!existingRoleId) {
    statements.push(database.prepare(`INSERT INTO access_roles
      (id, organization_id, name, description, color, system_key, permissions_json,
       location_scope_json, archived, created_by_user_id, created_at, updated_at)
      VALUES (?, ?, ?, '', '#53657a', NULL, ?, '[]', 0, ?, ?, ?)`)
      .bind(roleId, organizationId, `${name} access`, JSON.stringify(permissions), owner.userId, now, now));
  }
  statements.push(database.prepare(`INSERT INTO team_members
      (id, organization_id, user_id, role_id, first_name, last_name, email, employee_code,
       permitted_locations_json, status, remote_login, require_mfa, pin_enabled, notes,
       created_by_user_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', 'active', 1, 1, 0, '', ?, ?, ?)`)
      .bind(memberId, organizationId, userId, roleId, firstName, lastNameParts.join(" ") || "User",
        email, `GOV-${userId.slice(0, 8)}`, owner.userId, now, now));
  await database.batch(statements);
  return { email, name, roleId, memberId };
}

function locationBody(name) {
  return {
    action: "create_location",
    name,
    countryCode: "CA",
    addressLine1: "100 Capacity Road",
    addressLine2: "",
    addressLine3: "",
    locality: "Edmonton",
    district: "",
    administrativeArea: "AB",
    postalCode: "T5A 1A1",
    timezone: "America/Edmonton",
    currency: "CAD",
    locale: "en-CA",
    taxJurisdiction: "CA-AB",
  };
}

function employeeBody(roleId, suffix) {
  return {
    action: "create_employee",
    firstName: "Remote",
    lastName: `Employee ${suffix}`,
    preferredName: "",
    email: `remote-${suffix}@example.invalid`,
    mobile: "",
    employeeCode: `REMOTE-${suffix}`,
    jobTitle: "Associate",
    department: "Operations",
    employmentType: "employee",
    startDate: "2026-08-11",
    managerMemberId: "",
    primaryLocationId: "",
    permittedLocations: [],
    roleId,
    remoteLogin: true,
    requireMfa: true,
    temporaryPin: "",
    notes: "",
  };
}

test("simultaneous location creates cannot exceed the owner plan", async () => {
  const { miniflare, database, worker, environment } = await createEnvironment();
  try {
    const owner = await createWorkspace(worker, environment, database, {
      email: "location-owner@example.invalid",
      ownerName: "Location Owner",
      businessName: "Location Capacity",
      plan: "growth",
    });
    const now = Date.now();
    await database.prepare(`INSERT INTO organization_locations
      (id, organization_id, name, status, country_code, address_line_1, locality, administrative_area,
       postal_code, timezone, currency, locale, tax_jurisdiction, validation_status, created_at, updated_at)
      VALUES (?, ?, 'Second location', 'active', 'CA', '2 Test Avenue', 'Edmonton', 'AB', 'T5A 1A1',
       'America/Edmonton', 'CAD', 'en-CA', 'CA-AB', 'entered', ?, ?)`)
      .bind(crypto.randomUUID(), owner.organizationId, now, now).run();

    const responses = await Promise.all([
      dispatch(worker, environment, "/api/v1/governance", {
        method: "POST", ...owner, body: locationBody("Concurrent location A"),
      }),
      dispatch(worker, environment, "/api/v1/governance", {
        method: "POST", ...owner, body: locationBody("Concurrent location B"),
      }),
    ]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
    const rejected = responses.find((response) => response.status === 409);
    assert.equal((await rejected.json()).error.code, "LOCATION_LIMIT_REACHED");
    assert.equal((await database.prepare(`SELECT COUNT(*) count FROM organization_locations
      WHERE organization_id = ? AND status = 'active'`).bind(owner.organizationId).first()).count, 3);
  } finally {
    await miniflare.dispose();
  }
});

test("simultaneous remote employee creates cannot exceed the owner plan", async () => {
  const { miniflare, database, worker, environment } = await createEnvironment();
  try {
    const owner = await createWorkspace(worker, environment, database, {
      email: "employee-owner@example.invalid",
      ownerName: "Employee Owner",
      businessName: "Employee Capacity",
      plan: "starter",
    });
    const role = await database.prepare(`SELECT id FROM access_roles
      WHERE organization_id = ? AND system_key = 'employee' LIMIT 1`).bind(owner.organizationId).first();
    assert.ok(role?.id);
    const ownerUser = await database.prepare(`SELECT user_id userId FROM memberships
      WHERE organization_id = ? AND role = 'owner' LIMIT 1`).bind(owner.organizationId).first();
    assert.ok(ownerUser?.userId);
    const now = Date.now();
    await database.prepare(`INSERT INTO team_members
      (id, organization_id, role_id, first_name, last_name, email, employee_code, permitted_locations_json,
       status, remote_login, require_mfa, pin_enabled, notes, created_by_user_id, created_at, updated_at)
      VALUES (?, ?, ?, 'Existing', 'Remote', 'existing-remote@example.invalid', 'REMOTE-EXISTING', '[]',
       'active', 1, 1, 0, '', ?, ?, ?)`)
      .bind(crypto.randomUUID(), owner.organizationId, role.id, ownerUser.userId, now, now).run();

    const responses = await Promise.all([
      dispatch(worker, environment, "/api/v1/governance", {
        method: "POST", ...owner, body: employeeBody(role.id, "A"),
      }),
      dispatch(worker, environment, "/api/v1/governance", {
        method: "POST", ...owner, body: employeeBody(role.id, "B"),
      }),
    ]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
    const rejected = responses.find((response) => response.status === 409);
    assert.equal((await rejected.json()).error.code, "TEAM_SEAT_LIMIT_REACHED");
    assert.equal((await database.prepare(`SELECT COUNT(*) count FROM team_members
      WHERE organization_id = ? AND remote_login = 1
        AND status IN ('draft', 'invited', 'pending_verification', 'active')`)
      .bind(owner.organizationId).first()).count, 3);
  } finally {
    await miniflare.dispose();
  }
});

test("owner subscription messaging remains distinct from an exhausted quota", async () => {
  const { miniflare, database, worker, environment } = await createEnvironment();
  try {
    const owner = await createWorkspace(worker, environment, database, {
      email: "unsubscribed-owner@example.invalid",
      ownerName: "Unsubscribed Owner",
      businessName: "Unsubscribed Capacity",
      plan: null,
    });
    const role = await database.prepare(`SELECT id FROM access_roles
      WHERE organization_id = ? AND system_key = 'employee' LIMIT 1`).bind(owner.organizationId).first();
    assert.ok(role?.id);

    const locationResponse = await dispatch(worker, environment, "/api/v1/governance", {
      method: "POST", ...owner, body: locationBody("Unsubscribed location"),
    });
    assert.equal(locationResponse.status, 409);
    const locationError = (await locationResponse.json()).error;
    assert.equal(locationError.code, "LOCATION_LIMIT_REACHED");
    assert.match(locationError.message, /active owner subscription is required/i);

    const employeeResponse = await dispatch(worker, environment, "/api/v1/governance", {
      method: "POST", ...owner, body: employeeBody(role.id, "UNSUBSCRIBED"),
    });
    assert.equal(employeeResponse.status, 409);
    const employeeError = (await employeeResponse.json()).error;
    assert.equal(employeeError.code, "TEAM_SEAT_LIMIT_REACHED");
    assert.match(employeeError.message, /active owner subscription is required/i);
  } finally {
    await miniflare.dispose();
  }
});

test("governance authorization follows assigned permissions instead of coarse membership roles", async () => {
  const { miniflare, database, worker, environment } = await createEnvironment();
  try {
    const owner = await createWorkspace(worker, environment, database, {
      email: "permission-owner@example.invalid",
      ownerName: "Permission Owner",
      businessName: "Permission Governance",
      plan: "growth",
    });
    const manager = await createGovernanceUser(database, owner.organizationId, {
      email: "permission-manager@example.invalid",
      name: "Permission Manager",
      membershipRole: "manager",
      permissions: ["organization.settings"],
    });
    const admin = await createGovernanceUser(database, owner.organizationId, {
      email: "permission-admin@example.invalid",
      name: "Permission Admin",
      membershipRole: "admin",
      permissions: [],
    });

    const managerRead = await dispatch(worker, environment, "/api/v1/governance", manager);
    assert.equal(managerRead.status, 200, await managerRead.clone().text());
    const managerGovernance = (await managerRead.json()).governance;
    assert.ok(managerGovernance.organization);
    assert.equal(managerGovernance.members.length, 0);
    assert.equal(managerGovernance.roles.length, 0);
    assert.ok(managerGovernance.locations.length > 0);
    const adminRead = await dispatch(worker, environment, "/api/v1/governance", admin);
    assert.equal(adminRead.status, 403, await adminRead.clone().text());
    assert.equal((await adminRead.json()).error.code, "INSUFFICIENT_PERMISSION");

    await database.prepare("UPDATE access_roles SET permissions_json = ?, updated_at = ? WHERE id = ?")
      .bind(JSON.stringify(["team.directory"]), Date.now(), admin.roleId).run();
    const directoryRead = await dispatch(worker, environment, "/api/v1/governance", admin);
    assert.equal(directoryRead.status, 200, await directoryRead.clone().text());
    const directoryGovernance = (await directoryRead.json()).governance;
    assert.equal(directoryGovernance.organization, null);
    assert.ok(directoryGovernance.members.length > 0);
    assert.ok(directoryGovernance.members.every((member) => member.email === "" && member.mobile === ""));
    assert.ok(directoryGovernance.roles.every((role) => role.permissions.length === 0));
    assert.equal(directoryGovernance.permissionCatalog.length, 0);
    assert.equal("permittedLocationsJson" in directoryGovernance.members[0], false);
    assert.equal("permissionsJson" in directoryGovernance.roles[0], false);

    await database.prepare("UPDATE access_roles SET permissions_json = ?, updated_at = ? WHERE id = ?")
      .bind(JSON.stringify(["team.directory", "team.contacts", "team.roles"]), Date.now(), admin.roleId).run();
    const privilegedDirectoryRead = await dispatch(worker, environment, "/api/v1/governance", admin);
    assert.equal(privilegedDirectoryRead.status, 200, await privilegedDirectoryRead.clone().text());
    const privilegedDirectory = (await privilegedDirectoryRead.json()).governance;
    assert.ok(privilegedDirectory.members.some((member) => member.email === owner.email));
    assert.ok(privilegedDirectory.roles.some((role) => role.permissions.length > 0));
    assert.ok(privilegedDirectory.permissionCatalog.length > 0);

    await database.prepare("UPDATE access_roles SET permissions_json = '[]', updated_at = ? WHERE id = ?")
      .bind(Date.now(), admin.roleId).run();

    const actionPermissions = [
      ["update_profile", "organization.settings", {}],
      ["update_organization", "organization.settings", {}],
      ["create_location", "locations.manage", {}],
      ["create_employee", "team.create", {}],
      ["update_employee", "team.edit", {}],
      ["save_role", "team.roles", {}],
      ["reset_pin", "team.pin_reset", {}],
    ];
    for (const [action, permission, extra] of actionPermissions) {
      await database.prepare("UPDATE access_roles SET permissions_json = ?, updated_at = ? WHERE id = ?")
        .bind(JSON.stringify([permission]), Date.now(), manager.roleId).run();
      const allowed = await dispatch(worker, environment, "/api/v1/governance", {
        method: "POST", ...manager, body: { action, ...extra },
      });
      assert.notEqual(allowed.status, 403, `${action} should accept ${permission}: ${await allowed.clone().text()}`);

      const denied = await dispatch(worker, environment, "/api/v1/governance", {
        method: "POST", ...admin, body: { action, ...extra },
      });
      assert.equal(denied.status, 403, `${action} must not inherit access from the admin membership role`);
      assert.equal((await denied.json()).error.code, "INSUFFICIENT_PERMISSION");
    }

    const employeeRole = await database.prepare(`SELECT id FROM access_roles
      WHERE organization_id = ? AND system_key = 'employee' LIMIT 1`).bind(owner.organizationId).first();
    const accountOwnerRole = await database.prepare(`SELECT id FROM access_roles
      WHERE organization_id = ? AND system_key = 'account_owner' LIMIT 1`).bind(owner.organizationId).first();
    assert.ok(employeeRole?.id && accountOwnerRole?.id);
    await database.prepare("UPDATE access_roles SET permissions_json = ?, updated_at = ? WHERE id = ?")
      .bind(JSON.stringify(["team.create"]), Date.now(), manager.roleId).run();
    const safeEmployee = await dispatch(worker, environment, "/api/v1/governance", {
      method: "POST", ...manager, body: employeeBody(employeeRole.id, "SAFE-ROLE"),
    });
    assert.equal(safeEmployee.status, 201, await safeEmployee.clone().text());
    const privilegedEmployee = await dispatch(worker, environment, "/api/v1/governance", {
      method: "POST", ...manager, body: employeeBody(manager.roleId, "PRIVILEGED-ROLE"),
    });
    assert.equal(privilegedEmployee.status, 403, await privilegedEmployee.clone().text());
    assert.equal((await privilegedEmployee.json()).error.code, "INSUFFICIENT_PERMISSION");

    await database.prepare("UPDATE access_roles SET permissions_json = ?, updated_at = ? WHERE id = ?")
      .bind(JSON.stringify(["team.create", "team.roles"]), Date.now(), manager.roleId).run();
    const ownerEmployee = await dispatch(worker, environment, "/api/v1/governance", {
      method: "POST", ...manager, body: employeeBody(accountOwnerRole.id, "OWNER-ROLE"),
    });
    assert.equal(ownerEmployee.status, 409, await ownerEmployee.clone().text());
    assert.equal((await ownerEmployee.json()).error.code, "OWNER_ROLE_PROTECTED");

    await database.prepare("UPDATE access_roles SET permissions_json = ?, updated_at = ? WHERE id = ?")
      .bind(JSON.stringify(["team.edit"]), Date.now(), manager.roleId).run();
    const roleAssignment = await dispatch(worker, environment, "/api/v1/governance", {
      method: "POST",
      ...manager,
      body: { action: "update_employee", memberId: manager.memberId, roleId: manager.roleId, status: "active" },
    });
    assert.equal(roleAssignment.status, 403, await roleAssignment.clone().text());
    assert.equal((await roleAssignment.json()).error.code, "INSUFFICIENT_PERMISSION");

    await database.prepare("UPDATE access_roles SET permissions_json = ?, updated_at = ? WHERE id = ?")
      .bind(JSON.stringify(["team.edit", "team.roles"]), Date.now(), manager.roleId).run();
    const ownerRoleAssignment = await dispatch(worker, environment, "/api/v1/governance", {
      method: "POST",
      ...manager,
      body: { action: "update_employee", memberId: manager.memberId, roleId: accountOwnerRole.id, status: "active" },
    });
    assert.equal(ownerRoleAssignment.status, 409, await ownerRoleAssignment.clone().text());
    assert.equal((await ownerRoleAssignment.json()).error.code, "OWNER_ROLE_PROTECTED");

    const ownerMembership = await database.prepare(`SELECT user_id userId FROM memberships
      WHERE organization_id = ? AND role = 'owner' LIMIT 1`).bind(owner.organizationId).first();
    assert.ok(ownerMembership?.userId);
    await database.prepare(`DELETE FROM team_members WHERE id IN (
      SELECT tm.id FROM team_members tm
      JOIN access_roles ar ON ar.id = tm.role_id AND ar.organization_id = tm.organization_id
      WHERE tm.organization_id = ? AND ar.system_key = 'account_owner'
    )`).bind(owner.organizationId).run();
    await database.prepare("UPDATE access_roles SET permissions_json = ?, updated_at = ? WHERE id = ?")
      .bind(JSON.stringify(["organization.settings"]), Date.now(), manager.roleId).run();
    const managerBootstrap = await dispatch(worker, environment, "/api/v1/governance", manager);
    assert.equal(managerBootstrap.status, 200, await managerBootstrap.clone().text());

    const ownerMember = await database.prepare(`SELECT tm.id, tm.user_id userId FROM team_members tm
      JOIN access_roles ar ON ar.id = tm.role_id AND ar.organization_id = tm.organization_id
      WHERE tm.organization_id = ? AND ar.system_key = 'account_owner' LIMIT 1`).bind(owner.organizationId).first();
    assert.ok(ownerMember?.id);
    assert.equal(ownerMember.userId, ownerMembership.userId);
    await database.prepare("UPDATE access_roles SET permissions_json = ?, updated_at = ? WHERE id = ?")
      .bind(JSON.stringify(["team.edit", "team.roles"]), Date.now(), admin.roleId).run();
    const ownerDowngrade = await dispatch(worker, environment, "/api/v1/governance", {
      method: "POST",
      ...admin,
      body: { action: "update_employee", memberId: ownerMember.id, roleId: admin.roleId, status: "active" },
    });
    assert.equal(ownerDowngrade.status, 409, await ownerDowngrade.clone().text());
    assert.equal((await ownerDowngrade.json()).error.code, "OWNER_ROLE_PROTECTED");

    const generalManagerRole = await database.prepare(`SELECT id FROM access_roles
      WHERE organization_id = ? AND system_key = 'general_manager' LIMIT 1`).bind(owner.organizationId).first();
    const financeRole = await database.prepare(`SELECT id FROM access_roles
      WHERE organization_id = ? AND system_key = 'finance_administrator' LIMIT 1`).bind(owner.organizationId).first();
    assert.ok(generalManagerRole?.id && financeRole?.id);
    const generalManager = await createGovernanceUser(database, owner.organizationId, {
      email: "general-manager@example.invalid",
      name: "General Manager",
      membershipRole: "manager",
      permissions: [],
      existingRoleId: generalManagerRole.id,
    });

    const escalatedRole = await dispatch(worker, environment, "/api/v1/governance", {
      method: "POST",
      ...generalManager,
      body: {
        action: "save_role",
        roleId: "",
        name: "Escalated finance role",
        description: "Must not be created",
        color: "#53657a",
        permissions: ["team.directory", "finance.bank_balances"],
        locationScope: [],
      },
    });
    assert.equal(escalatedRole.status, 403, await escalatedRole.clone().text());
    assert.equal((await escalatedRole.json()).error.code, "INSUFFICIENT_PERMISSION");

    const boundedRole = await dispatch(worker, environment, "/api/v1/governance", {
      method: "POST",
      ...generalManager,
      body: {
        action: "save_role",
        roleId: "",
        name: "Bounded directory role",
        description: "Delegable by a general manager",
        color: "#53657a",
        permissions: ["team.directory"],
        locationScope: [],
      },
    });
    assert.equal(boundedRole.status, 200, await boundedRole.clone().text());
    const boundedRoleId = (await boundedRole.json()).governance.roles
      .find((role) => role.name === "Bounded directory role")?.id;
    assert.ok(boundedRoleId);

    const selfAssignment = await dispatch(worker, environment, "/api/v1/governance", {
      method: "POST",
      ...generalManager,
      body: { action: "update_employee", memberId: generalManager.memberId, roleId: boundedRoleId, status: "active" },
    });
    assert.equal(selfAssignment.status, 409, await selfAssignment.clone().text());
    assert.equal((await selfAssignment.json()).error.code, "SELF_ROLE_CHANGE_FORBIDDEN");

    const safeEmployeeMember = await database.prepare("SELECT id FROM team_members WHERE organization_id = ? AND email = ? LIMIT 1")
      .bind(owner.organizationId, "remote-safe-role@example.invalid").first();
    assert.ok(safeEmployeeMember?.id);
    const privilegedAssignment = await dispatch(worker, environment, "/api/v1/governance", {
      method: "POST",
      ...generalManager,
      body: { action: "update_employee", memberId: safeEmployeeMember.id, roleId: financeRole.id, status: "active" },
    });
    assert.equal(privilegedAssignment.status, 403, await privilegedAssignment.clone().text());
    assert.equal((await privilegedAssignment.json()).error.code, "INSUFFICIENT_PERMISSION");

    const boundedAssignment = await dispatch(worker, environment, "/api/v1/governance", {
      method: "POST",
      ...generalManager,
      body: { action: "update_employee", memberId: safeEmployeeMember.id, roleId: boundedRoleId, status: "active" },
    });
    assert.equal(boundedAssignment.status, 200, await boundedAssignment.clone().text());

    const locationManagerRole = await database.prepare(`SELECT id FROM access_roles
      WHERE organization_id = ? AND system_key = 'location_manager' LIMIT 1`).bind(owner.organizationId).first();
    assert.ok(locationManagerRole?.id);
    await database.prepare("UPDATE access_roles SET permissions_json = ?, updated_at = ? WHERE id = ?")
      .bind(JSON.stringify([
        "sales.view",
        "organization.settings",
        "locations.manage",
        "team.directory",
        "team.contacts",
        "team.create",
        "team.edit",
        "team.roles",
        "team.pin_reset",
      ]), Date.now(), locationManagerRole.id).run();
    const locationManager = await createGovernanceUser(database, owner.organizationId, {
      email: "location-manager@example.invalid",
      name: "Location Manager",
      membershipRole: "manager",
      permissions: [],
      existingRoleId: locationManagerRole.id,
    });
    const locationManagerGovernance = await dispatch(worker, environment, "/api/v1/governance", locationManager);
    assert.equal(locationManagerGovernance.status, 403, await locationManagerGovernance.clone().text());
    assert.equal((await locationManagerGovernance.json()).error.code, "INSUFFICIENT_PERMISSION");
  } finally {
    await miniflare.dispose();
  }
});
