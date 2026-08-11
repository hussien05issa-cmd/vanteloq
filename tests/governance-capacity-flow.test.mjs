import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";
import { Miniflare } from "miniflare";

const origin = "https://vanteloq.example";
const context = { waitUntil() {}, passThroughOnException() {} };

function ownerHeaders(email, name, write = false) {
  const payload = Buffer.from(JSON.stringify({ email, aal: "aal2", session_id: `session:${email}` })).toString("base64url");
  const headers = {
    accept: "application/json",
    authorization: `Bearer test.${payload}.signature`,
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
  const authServer = createServer((request, response) => {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      id: `test-user:${payload.email}`,
      email: payload.email,
      email_confirmed_at: "2026-08-01T00:00:00.000Z",
      user_metadata: { full_name: payload.email },
    }));
  });
  await new Promise((resolve) => authServer.listen(0, "127.0.0.1", resolve));
  const authAddress = authServer.address();
  assert.ok(authAddress && typeof authAddress !== "string");
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
    SUPABASE_URL: `http://127.0.0.1:${authAddress.port}`,
    SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  };
  return { miniflare, database, worker, environment, authServer };
}

async function disposeEnvironment(authServer, miniflare) {
  authServer.closeAllConnections();
  await new Promise((resolve) => authServer.close(resolve));
  await miniflare.dispose();
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
  const { miniflare, database, worker, environment, authServer } = await createEnvironment();
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
    await disposeEnvironment(authServer, miniflare);
  }
});

test("simultaneous remote employee creates cannot exceed the owner plan", async () => {
  const { miniflare, database, worker, environment, authServer } = await createEnvironment();
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
    await disposeEnvironment(authServer, miniflare);
  }
});

test("owner subscription messaging remains distinct from an exhausted quota", async () => {
  const { miniflare, database, worker, environment, authServer } = await createEnvironment();
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
    await disposeEnvironment(authServer, miniflare);
  }
});
