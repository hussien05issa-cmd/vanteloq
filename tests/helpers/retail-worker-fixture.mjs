import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { Miniflare } from "miniflare";
import { registerSupabaseTestServer } from "./supabase-loopback-transport.mjs";
import { activateTestSubscription } from "./subscription-fixture.mjs";

export const origin = "https://vanteloq.example";
export const context = { waitUntil() {}, passThroughOnException() {} };

export function dateOffset(iso, days) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function identityHeaders(email, fullName, write = false) {
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

export function onboardingBody(ownerName, businessName) {
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  return {
    ownerName,
    businessName,
    legalName: `${businessName} Ltd.`,
    businessEmail: `${businessName.toLowerCase().replace(/[^a-z]/g, "")}@example.invalid`,
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
    hours: days.map(day => ({ day, open: "10:00", close: "21:00", closed: false })),
    sourceMode: "csv",
    selectedPos: "",
    legalAccepted: true,
    termsVersion: "2026-09-05",
    privacyPolicyVersion: "2026-09-10",
    legalNoticeVersion: "account-creation-v2",
  };
}

export async function createEnvironment() {
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
  const address = authServer.address();
  assert.ok(address && typeof address !== "string");
  const supabaseUrl = registerSupabaseTestServer(address.port);
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: `vanteloq-flow-${crypto.randomUUID()}` },
  });
  const database = await miniflare.getD1Database("DB");
  const migrations = (await readdir(new URL("../../drizzle/", import.meta.url)))
    .filter(file => /^\d{4}.*\.sql$/.test(file))
    .sort();
  for (const migration of migrations) {
    const sql = await readFile(new URL(`../../drizzle/${migration}`, import.meta.url), "utf8");
    for (const statement of sql.split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean)) {
      await database.prepare(statement).run();
    }
  }
  const workerUrl = new URL("../../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("flow-test", crypto.randomUUID());
  const worker = (await import(workerUrl.href)).default;
  const environment = {
    DB: database,
    BOOKLOQ_DEMO_ENABLED: "true",
    SUPABASE_URL: supabaseUrl,
    SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  };
  const dispose = async () => {
    try {
      await miniflare.dispose();
    } finally {
      authServer.closeAllConnections();
      await new Promise((resolve, reject) => authServer.close((error) => error ? reject(error) : resolve()));
    }
  };
  return { worker, environment, database, dispose };
}

export async function dispatch(worker, environment, path, { method = "GET", email, name, body, idempotencyKey } = {}) {
  const write = method !== "GET";
  const headers = identityHeaders(email, name, write);
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  return worker.fetch(new Request(`${origin}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), environment, context);
}

export async function grantBookLoqForFlow(database, businessName) {
  const workspace = await database.prepare("SELECT id FROM workspaces WHERE business_name = ? LIMIT 1").bind(businessName).first();
  assert.ok(workspace?.id, `Expected ${businessName} workspace before granting the test entitlement.`);
  const now = Date.now();
  await activateTestSubscription(database, workspace.id);
  await database.prepare(`INSERT INTO tenant_addons
    (id, organization_id, addon_key, status, created_at, updated_at)
    VALUES (?, ?, 'bookloq', 'active', ?, ?)`)
    .bind(crypto.randomUUID(), workspace.id, now, now)
    .run();
}

export async function createReportWorkspace(worker, environment, database, label) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const owner = {
    email: `report-${label}-${suffix}@example.invalid`,
    name: `Report ${label}`,
  };
  const businessName = `Report ${label} ${suffix}`;
  const onboarding = await dispatch(worker, environment, "/api/v1/onboarding", {
    method: "POST",
    ...owner,
    body: onboardingBody(owner.name, businessName),
  });
  assert.equal(onboarding.status, 201);
  const identity = await database.prepare(`SELECT u.id AS userId, m.organization_id AS organizationId
    FROM users u JOIN memberships m ON m.user_id = u.id WHERE u.email = ?`).bind(owner.email).first();
  const location = await database.prepare(`SELECT id FROM organization_locations
    WHERE organization_id = ? AND status = 'active' ORDER BY created_at LIMIT 1`).bind(identity.organizationId).first();
  assert.ok(identity?.userId && identity?.organizationId && location?.id);
  await activateTestSubscription(database, identity.organizationId);
  return { owner, userId: identity.userId, organizationId: identity.organizationId, locationId: location.id };
}

export async function seedReportConnection(database, {
  organizationId,
  locationId,
  connectionId,
  namespace,
  externalLocationRef,
  promotionStatus = "approved",
  syncLeaseOwner = null,
  syncLeaseExpiresAt = null,
}) {
  const timestamp = Math.floor(Date.now() / 1_000);
  await database.batch([
    database.prepare(`INSERT INTO integration_connections
      (id, organization_id, provider, source_namespace, status, external_account_ref,
       external_account_name, scopes_json, data_promotion_status, connected_at,
       last_successful_sync_at, sync_lease_owner, sync_lease_expires_at, created_at, updated_at)
      VALUES (?, ?, 'lightspeed-r', ?, 'connected', ?, ?, '[]', ?, ?, ?, ?, ?, ?, ?)`)
      .bind(connectionId, organizationId, namespace, connectionId, `Account ${connectionId}`,
        promotionStatus, timestamp, timestamp, syncLeaseOwner, syncLeaseExpiresAt, timestamp, timestamp),
    database.prepare(`INSERT INTO integration_location_mappings
      (id, organization_id, provider, connection_id, external_location_ref, external_name,
       local_location_id, status, last_seen_at, created_at, updated_at)
      VALUES (?, ?, 'lightspeed-r', ?, ?, ?, ?, 'mapped', ?, ?, ?)`)
      .bind(`mapping-${connectionId}`, organizationId, connectionId, externalLocationRef,
        `Outlet ${externalLocationRef}`, locationId, timestamp, timestamp, timestamp),
  ]);
  return `lightspeed-r:${namespace}:${externalLocationRef}`;
}

export async function seedReportMetric(database, {
  organizationId,
  userId,
  businessDate,
  locationRef,
  netSalesCents,
  sourceConnectionId = null,
  sourceImportId = null,
}) {
  const timestamp = Math.floor(Date.now() / 1_000);
  await database.prepare(`INSERT INTO daily_business_metrics
    (organization_id, business_date, location_ref, gross_sales_cents, net_sales_cents,
     cost_of_goods_cents, transaction_count, units_sold, refunds_cents, discounts_cents,
     labour_cost_cents, source_provider, source_connection_id, source_import_id,
     created_by_user_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 0, 1, 1, 0, 0, 0, ?, ?, ?, ?, ?, ?)`)
    .bind(organizationId, businessDate, locationRef, netSalesCents, netSalesCents,
      sourceConnectionId ? "lightspeed-r" : null, sourceConnectionId, sourceImportId,
      userId, timestamp, timestamp).run();
}

export async function seedSalesAuthority(database, { organizationId, locationId, connectionId, userId }) {
  const timestamp = Math.floor(Date.now() / 1_000);
  await database.prepare(`INSERT INTO integration_source_authorities
    (id, organization_id, local_location_id, channel, fact_family, provider, connection_id,
     created_by_user_id, updated_by_user_id, version, created_at, updated_at)
    VALUES (?, ?, ?, 'retail', 'sales', 'lightspeed-r', ?, ?, ?, 1, ?, ?)`)
    .bind(`authority-${connectionId}`, organizationId, locationId, connectionId,
      userId, userId, timestamp, timestamp).run();
}

export async function seedReportLocation(database, organizationId, name) {
  const locationId = `location-${crypto.randomUUID()}`;
  const timestamp = Math.floor(Date.now() / 1_000);
  await database.prepare(`INSERT INTO organization_locations
    (id, organization_id, name, status, country_code, address_line_1, address_line_2,
     address_line_3, locality, district, administrative_area, postal_code, timezone,
     currency, locale, tax_jurisdiction, validation_status, created_at, updated_at)
    VALUES (?, ?, ?, 'active', 'CA', '2 Test Avenue', '', '', 'Edmonton', '', 'AB',
      'T5A 1A2', 'America/Edmonton', 'CAD', 'en-CA', '', 'validated', ?, ?)`)
    .bind(locationId, organizationId, name, timestamp, timestamp).run();
  return locationId;
}
