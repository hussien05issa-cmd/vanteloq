import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import test, { describe } from "node:test";
import { Miniflare } from "miniflare";
import { registerSupabaseTestServer } from "./helpers/supabase-loopback-transport.mjs";
import { activateTestSubscription } from "./helpers/subscription-fixture.mjs";

const origin = "https://vanteloq.example";
const context = { waitUntil() {}, passThroughOnException() {} };

function dateOffset(iso, days) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function identityHeaders(email, fullName, write = false) {
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

function onboardingBody(ownerName, businessName) {
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
  const address = authServer.address();
  assert.ok(address && typeof address !== "string");
  const supabaseUrl = registerSupabaseTestServer(address.port);
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: `vanteloq-flow-${crypto.randomUUID()}` },
  });
  const database = await miniflare.getD1Database("DB");
  const migrations = (await readdir(new URL("../drizzle/", import.meta.url)))
    .filter(file => /^\d{4}.*\.sql$/.test(file))
    .sort();
  for (const migration of migrations) {
    const sql = await readFile(new URL(`../drizzle/${migration}`, import.meta.url), "utf8");
    for (const statement of sql.split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean)) {
      await database.prepare(statement).run();
    }
  }
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
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

async function dispatch(worker, environment, path, { method = "GET", email, name, body, idempotencyKey } = {}) {
  const write = method !== "GET";
  const headers = identityHeaders(email, name, write);
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  return worker.fetch(new Request(`${origin}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), environment, context);
}

async function grantBookLoqForFlow(database, businessName) {
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

async function createReportWorkspace(worker, environment, database, label) {
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

async function seedReportConnection(database, {
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

async function seedReportMetric(database, {
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

async function seedSalesAuthority(database, { organizationId, locationId, connectionId, userId }) {
  const timestamp = Math.floor(Date.now() / 1_000);
  await database.prepare(`INSERT INTO integration_source_authorities
    (id, organization_id, local_location_id, channel, fact_family, provider, connection_id,
     created_by_user_id, updated_by_user_id, version, created_at, updated_at)
    VALUES (?, ?, ?, 'retail', 'sales', 'lightspeed-r', ?, ?, ?, 1, ?, ?)`)
    .bind(`authority-${connectionId}`, organizationId, locationId, connectionId,
      userId, userId, timestamp, timestamp).run();
}

async function seedReportLocation(database, organizationId, name) {
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

test("intraday API compares matched hours and redacts all profit paths for revenue-only staff", async () => {
  const { worker, environment, database, dispose } = await createEnvironment();
  try {
    const identity = await createReportWorkspace(worker, environment, database, "intraday");
    await database.prepare("UPDATE workspaces SET timezone = 'UTC' WHERE id = ?").bind(identity.organizationId).run();
    const now = Math.floor(Date.now() / 1000), currentDate = new Date(now * 1000).toISOString().slice(0, 10);
    const baselineDate = dateOffset(currentDate, -7);
    const connectionId = `intraday-${crypto.randomUUID()}`;
    await seedReportConnection(database, { ...identity, connectionId, namespace: "legacy", externalLocationRef: "shop" });
    const runId = crypto.randomUUID();
    await database.prepare(`INSERT INTO integration_sync_runs
      (id, organization_id, provider, connection_id, mode, status, started_at, completed_at)
      VALUES (?, ?, 'lightspeed-r', ?, 'incremental', 'completed', ?, ?)`)
      .bind(runId, identity.organizationId, connectionId, now, now).run();
    const insert = database.prepare(`INSERT INTO integration_staged_sales
      (id, organization_id, provider, connection_id, external_sale_id, external_version,
       outlet_ref, sold_at, state, total_cents, tax_cents, cost_cents, discount_cents,
       line_count, source_payload_hash, sync_run_id, staged_at)
      VALUES (?, ?, 'lightspeed-r', ?, ?, ?, 'shop', ?, 'completed', ?, 0, ?, 0, 1, 'test-only', ?, ?)`);
    await database.batch([
      insert.bind("current-old", identity.organizationId, connectionId, "current", "1", `${currentDate}T00:00:00Z`, 999999, 100, runId, now - 2),
      insert.bind("current-latest", identity.organizationId, connectionId, "current", "2", `${currentDate}T00:00:00Z`, 10000, 6000, runId, now - 1),
      insert.bind("baseline", identity.organizationId, connectionId, "previous", "1", `${baselineDate}T00:00:00Z`, 5000, 2000, runId, now - 1),
    ]);
    const load = async (user = identity.owner, suffix = "") => {
      const response = await dispatch(worker, environment, `/api/v1/command-centre${suffix}`, user);
      assert.equal(response.status, 200);
      return (await response.json()).commandCentre;
    };
    const ownerView = await load(identity.owner, `?location=${identity.locationId}`);
    assert.equal(ownerView.today.sourceGranularity, "intraday");
    assert.equal(ownerView.today.netSalesCents, 10000);
    assert.equal(ownerView.today.grossProfitCents, 4000);
    assert.equal(ownerView.todayComparison.baseline.netSalesCents, 5000);
    assert.equal(ownerView.todayComparison.changes.netSalesRate, 1);
    assert.equal(ownerView.todayComparison.basis, "same_weekday_same_time");
    assert.equal(ownerView.today.hourly.length, new Date(now * 1000).getUTCHours() + 1);
    const reader = { email: `intraday-reader-${crypto.randomUUID()}@example.invalid`, name: "Sales reader" };
    const userId = crypto.randomUUID(), roleId = crypto.randomUUID();
    await database.batch([
      database.prepare("INSERT INTO users (id,email,display_name,status,created_at,updated_at) VALUES (?,?,?,'active',?,?)").bind(userId, reader.email, reader.name, now, now),
      database.prepare("INSERT INTO memberships (id,user_id,organization_id,role,status,created_at,updated_at) VALUES (?,?,?,'employee','active',?,?)").bind(crypto.randomUUID(), userId, identity.organizationId, now, now),
      database.prepare(`INSERT INTO access_roles (id,organization_id,name,description,color,permissions_json,location_scope_json,archived,created_by_user_id,created_at,updated_at)
        VALUES (?,?,'Sales only','','#245fce','["dashboard.view","metrics.revenue"]','[]',0,?,?,?)`).bind(roleId, identity.organizationId, identity.userId, now, now),
      database.prepare(`INSERT INTO team_members (id,organization_id,user_id,role_id,first_name,last_name,email,employee_code,primary_location_id,permitted_locations_json,status,remote_login,created_by_user_id,created_at,updated_at)
        VALUES (?,?,?,?,'Sales','Reader',?,'INTRA-READ',?,?,'active',1,?,?,?)`).bind(crypto.randomUUID(), identity.organizationId, userId, roleId, reader.email, identity.locationId, JSON.stringify([identity.locationId]), identity.userId, now, now),
    ]);
    const staffView = await load(reader, `?location=${identity.locationId}`);
    assert.equal(staffView.today.netSalesCents, 10000);
    assert.equal(staffView.today.grossProfitCents, null);
    assert.equal(staffView.todayComparison.baseline.grossProfitCents, null);
    assert.equal(staffView.todayComparison.changes.grossProfitRate, null);
    assert.ok(staffView.today.hourly.every((hour) => hour.grossProfitCents === null));
    assert.ok(staffView.todayComparison.baseline.hourly.every((hour) => hour.grossProfitCents === null));
    // Assert the actual outbound AI evidence, not just the displayed dashboard.
    await database.prepare("UPDATE access_roles SET permissions_json = ? WHERE id = ?").bind(JSON.stringify(["dashboard.view", "metrics.revenue", "insights.view"]), roleId).run();
    await seedReportMetric(database, { ...identity, businessDate: currentDate, locationRef: identity.locationId, netSalesCents: 432100 });
    const otherLocation = await seedReportLocation(database, identity.organizationId, "Private location");
    await seedReportMetric(database, { ...identity, businessDate: currentDate, locationRef: otherLocation, netSalesCents: 987654321 });
    await database.prepare("UPDATE daily_business_metrics SET cost_of_goods_cents = 123400, labour_cost_cents = 45600, inventory_value_cents = 78900, accounts_payable_cents = 99900 WHERE organization_id = ?").bind(identity.organizationId).run();
    environment.GOOGLE_GEMINI_API_KEY = "fixture-only";
    environment.GOOGLE_GEMINI_PAID_SERVICE_CONFIRMED = "true";
    const originalFetch = globalThis.fetch, outbound = [];
    globalThis.fetch = async (input, init) => {
      if (String(input).startsWith("https://generativelanguage.googleapis.com/")) {
        outbound.push(JSON.parse(init.body).contents[0].parts[0].text);
        return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "Fixture analysis" }] } }] });
      }
      return originalFetch(input, init);
    };
    try {
      const ask = (user, body = {}) => dispatch(worker, environment, "/api/v1/advisor/chat", { method: "POST", ...user, body: { question: "Analyze available KPIs", dataUseAccepted: true, noticeVersion: "vanteloq-ai-v3-providers-kpis", privacyPolicyVersion: "2026-09-10", ...body } });
      const answer = await ask(reader);
      assert.equal(answer.status, 200, await answer.clone().text());
      const { conversationId } = await answer.json();
      const evidence = JSON.parse(outbound[0].split("Evidence JSON: ")[1].split("\n\nConversation memory:")[0]);
      assert.equal(evidence.kpis.current.netSalesCents, 432100);
      assert.equal(evidence.kpis.current.grossProfitCents, null);
      assert.equal(evidence.kpis.current.labourCostCents, null);
      assert.equal(evidence.kpis.inventorySnapshotCents, null);
      assert.equal(evidence.kpis.accountsPayableSnapshotCents, null);
      assert.equal(evidence.cashAvailableCents, null);
      assert.doesNotMatch(outbound[0], /987654321|123400|45600|78900|99900|Private location/);
      const foreignRead = await ask(identity.owner, { conversationId });
      assert.equal(foreignRead.status, 404);
      const foreignDelete = await dispatch(worker, environment, "/api/v1/advisor/chat", { method: "DELETE", ...identity.owner, body: { conversationId } });
      assert.equal(foreignDelete.status, 404);
      await database.prepare("UPDATE access_roles SET permissions_json = ? WHERE id = ?").bind(JSON.stringify(["dashboard.view", "insights.view"]), roleId).run();
      const narrowed = await ask(reader, { conversationId });
      assert.equal(narrowed.status, 200, await narrowed.clone().text());
      assert.equal(outbound.length, 2);
      assert.match(outbound[1], /Conversation memory: \[\]/);
      assert.doesNotMatch(outbound[1], /432100|Fixture analysis/);
      const deleted = await dispatch(worker, environment, "/api/v1/advisor/chat", { method: "DELETE", ...reader, body: { conversationId } });
      assert.equal(deleted.status, 200);
      const remaining = await database.prepare("SELECT count(*) count FROM assistant_messages WHERE conversation_id = ?").bind(conversationId).first();
      assert.equal(remaining.count, 0);
    } finally { globalThis.fetch = originalFetch; }
    await database.prepare("UPDATE integration_connections SET last_successful_sync_at = ? WHERE id = ?").bind(now - 86400, connectionId).run();
    const stale = await load();
    assert.equal(stale.today.sourceGranularity, "daily");
    assert.match(stale.today.hourlyUnavailableReason, /current business day/);
  } finally { await dispose(); }
});

describe("intelligence flow contracts", { concurrency: false }, () => {
test("migrations, tenant isolation and the complete intelligence-to-action flow work", async () => {
  const { worker, environment, database, dispose } = await createEnvironment();
  try {
    const owner = { email: "owner-one@example.invalid", name: "Owner One" };
    const secondOwner = { email: "owner-two@example.invalid", name: "Owner Two" };

    const onboarding = await dispatch(worker, environment, "/api/v1/onboarding", { method: "POST", ...owner, body: onboardingBody(owner.name, "North Store") });
    assert.equal(onboarding.status, 201);
    await activateTestSubscription(database, (await onboarding.json()).organization.id);

    const gatedBookLoq = await dispatch(worker, environment, "/api/v1/bookloq", owner);
    assert.equal(gatedBookLoq.status, 403);
    assert.equal((await gatedBookLoq.json()).error.code, "ADDON_NOT_INCLUDED");
    const gatedDemo = await dispatch(worker, environment, "/api/v1/bookloq/demo", { method: "POST", ...owner, body: {} });
    assert.equal(gatedDemo.status, 403);
    assert.equal((await gatedDemo.json()).error.code, "ADDON_NOT_INCLUDED");

    await grantBookLoqForFlow(environment.DB, "North Store");

    const unavailableBookLoqResponse = await dispatch(worker, environment, "/api/v1/bookloq", owner);
    assert.equal(unavailableBookLoqResponse.status, 200);
    const unavailableBookLoq = (await unavailableBookLoqResponse.json()).bookloq;
    assert.equal(unavailableBookLoq.configured, false);
    assert.equal(unavailableBookLoq.summary.revenueCents, null);
    assert.equal(unavailableBookLoq.summary.bookBalanceCents, null);
    assert.equal(unavailableBookLoq.summary.healthScore, null);
    assert.equal(unavailableBookLoq.cashIntelligence.status, "unavailable");

    const integrationResponse = await dispatch(worker, environment, "/api/v1/integrations", owner);
    assert.equal(integrationResponse.status, 200);
    const integrationBody = await integrationResponse.json();
    assert.equal(integrationBody.syncEnabled, false);
    assert.equal(integrationBody.preSyncControls.filter(control => control.status === "verified").length, 7);
    assert.ok(integrationBody.preSyncControls.some(control => control.id === "reconciliation" && control.status === "gated"));
    assert.ok(integrationBody.integrations.every(provider => provider.status === "not_connected"));
    assert.equal(integrationBody.integrations.find(provider => provider.id === "lightspeed").availability, "credentials_required");
    assert.equal(integrationBody.integrations.find(provider => provider.id === "lightspeed").providerReadiness.dataPromotionEnabled, false);
    assert.equal(integrationBody.integrations.some(provider => ["mx", "flinks"].includes(provider.id)), false);
    assert.ok(integrationBody.integrations.some(provider => provider.id === "plaid"));

    for (const provider of ["lightspeed", "stripe"]) {
      const unavailableAuthorization = await dispatch(worker, environment, `/api/v1/integrations/${provider}/authorize`, {
        method: "POST", ...owner, body: {},
      });
      assert.equal(unavailableAuthorization.status, 503, provider);
    }
    assert.equal((await database.prepare(`SELECT COUNT(*) count FROM integration_connections
      WHERE provider IN ('lightspeed', 'stripe')`).first()).count, 0);
    assert.equal((await database.prepare(`SELECT COUNT(*) count FROM integration_oauth_states
      WHERE provider IN ('lightspeed', 'stripe')`).first()).count, 0);

    const empty = await dispatch(worker, environment, "/api/v1/command-centre", owner);
    assert.equal(empty.status, 200);
    assert.equal((await empty.json()).commandCentre.ready, false);

    // Keep the operating fixture current so rolling comparisons remain valid.
    const latest = new Date().toISOString().slice(0, 10);
    const rows = [];
    for (let offset = -59; offset <= 0; offset++) {
      const current = offset >= -29;
      rows.push({
        businessDate: dateOffset(latest, offset), locationRef: "Main",
        grossSalesCents: current ? 90_000 : 105_000,
        netSalesCents: current ? 80_000 : 100_000,
        costOfGoodsCents: 50_000,
        transactionCount: current ? 80 : 100,
        unitsSold: current ? 110 : 140,
        refundsCents: current ? 2_000 : 1_000,
        discountsCents: current ? 10_000 : 5_000,
        labourCostCents: current ? 20_000 : 15_000,
        inventoryValueCents: 2_000_000,
        cashBalanceCents: 1_200_000,
        accountsPayableCents: 700_000,
      });
    }
    const importKey = crypto.randomUUID();
    const imported = await dispatch(worker, environment, "/api/v1/daily-metrics", { method: "POST", ...owner, idempotencyKey: importKey, body: { importType: "daily_summary_csv", fileName: "verified.csv", rows } });
    assert.equal(imported.status, 201);
    assert.equal((await imported.json()).import.rowCount, 60);

    const replay = await dispatch(worker, environment, "/api/v1/daily-metrics", { method: "POST", ...owner, idempotencyKey: importKey, body: { importType: "daily_summary_csv", fileName: "verified.csv", rows } });
    assert.equal(replay.status, 200);
    const replayBody = await replay.json();
    assert.equal(replayBody.replayed, true);
    assert.deepEqual(Object.keys(replayBody.import).sort(), ["id", "rowCount", "status"]);

    const commandResponse = await dispatch(worker, environment, "/api/v1/command-centre", owner);
    assert.equal(commandResponse.status, 200);
    const command = (await commandResponse.json()).commandCentre;
    assert.equal(command.ready, true);
    assert.equal(command.source.rowCount, 60);
    assert.ok(command.insights.some(insight => insight.id === "sales-trend"));
    assert.ok(command.insights.every(insight => insight.evidence.length > 0));

    const seeded = await dispatch(worker, environment, "/api/v1/bookloq/demo", { method: "POST", ...owner, body: {} });
    assert.equal(seeded.status, 201);
    assert.equal((await seeded.json()).seeded, true);
    const seededReplay = await dispatch(worker, environment, "/api/v1/bookloq/demo", { method: "POST", ...owner, body: {} });
    assert.equal(seededReplay.status, 200);
    assert.equal((await seededReplay.json()).replayed, true);
    const bookloqResponse = await dispatch(worker, environment, "/api/v1/bookloq", owner);
    assert.equal(bookloqResponse.status, 200);
    const bookloq = (await bookloqResponse.json()).bookloq;
    assert.equal(bookloq.configured, true);
    assert.equal(bookloq.settings.dataMode, "demonstration");
    assert.equal(bookloq.statements.trialBalance.totalDebitCents, bookloq.statements.trialBalance.totalCreditCents);
    assert.equal(bookloq.summary.revenueCents, 1_460_000);
    assert.equal(bookloq.summary.salesTaxPayableCents, 1_750);
    assert.equal(bookloq.summary.missingReceiptsCount, 1);
    assert.ok(bookloq.summary.healthScore < 100);
    assert.ok(bookloq.alerts.every(alert => alert.demoRecord === 1));
    assert.equal(bookloq.thirteenWeekCashFlow.status, "unavailable");
    assert.equal(bookloq.thirteenWeekCashFlow.purchasingCapacityCents, null);
    assert.deepEqual(bookloq.thirteenWeekCashFlow.decisionBlocks, ["demonstration_data"]);
    assert.equal(bookloq.cashIntelligence.status, "unavailable");
    assert.equal(bookloq.cashIntelligence.purchasingCapacityCents, null);
    assert.equal(bookloq.summary.availableCashCents, null);
    assert.deepEqual(bookloq.forecasts, []);
    const openAccountingPeriod = bookloq.periods.find(period => period.status === "open");
    assert.ok(openAccountingPeriod?.startDate);
    const journalDate = openAccountingPeriod.startDate;

    const ownerRecord = await database.prepare(`SELECT u.id userId, m.organization_id organizationId
      FROM users u JOIN memberships m ON m.user_id = u.id WHERE u.email = ?`).bind(owner.email).first();
    const primaryLocation = await database.prepare(`SELECT id FROM organization_locations
      WHERE organization_id = ? AND status = 'active' ORDER BY created_at LIMIT 1`).bind(ownerRecord.organizationId).first();
    assert.ok(ownerRecord?.userId && ownerRecord?.organizationId && primaryLocation?.id);
    const alertTimestamp = Math.floor(Date.now() / 1_000);
    await database.batch(Array.from({ length: 100 }, (_, index) => database.prepare(`INSERT INTO bookloq_alerts
      (id, organization_id, severity, alert_type, title, explanation, dollar_impact_cents,
       confidence, supporting_records_json, recommended_action, assigned_user_id, due_date,
       status, resolution_history_json, demo_record, created_at, updated_at)
      VALUES (?, ?, 'critical', 'test_non_receipt', ?, 'Aggregate health coverage fixture.', NULL,
        'high', '[]', 'Review the fixture.', NULL, NULL, 'open', '[]', 1, ?, ?)`)
      .bind(`health-alert-${index}`, ownerRecord.organizationId, `Critical fixture ${index}`, alertTimestamp + index, alertTimestamp + index)));
    const crowdedBookLoqResponse = await dispatch(worker, environment, "/api/v1/bookloq", owner);
    assert.equal(crowdedBookLoqResponse.status, 200);
    const crowdedSummary = (await crowdedBookLoqResponse.json()).bookloq.summary;
    assert.equal(crowdedSummary.missingReceiptsCount, 1);
    assert.notEqual(crowdedSummary.healthScore, null);
    const freshBankNow = Date.now();
    await database.batch([
      database.prepare("UPDATE bookloq_settings SET data_mode = 'live', updated_at = ? WHERE organization_id = ?")
        .bind(freshBankNow, ownerRecord.organizationId),
      database.prepare(`UPDATE bank_accounts SET provider = 'plaid', demo_record = 0, connection_status = 'healthy',
        external_item_ref = 'plaid-item-fixture',
        currency = 'CAD', live_balance_cents = 2397800, available_balance_cents = 2397800,
        last_sync_at = ?, updated_at = ? WHERE organization_id = ?`)
        .bind(Math.floor((freshBankNow - 60_000) / 1_000), freshBankNow, ownerRecord.organizationId),
      database.prepare(`INSERT INTO integration_connections
        (id, organization_id, provider, status, external_account_ref, scopes_json, data_promotion_status, connected_at,
         last_successful_sync_at, created_at, updated_at)
        VALUES ('plaid-live-fixture', ?, 'plaid', 'connected', 'plaid-item-fixture', '["transactions","balance"]',
          'approved', ?, ?, ?, ?)`)
        .bind(ownerRecord.organizationId, freshBankNow, freshBankNow, freshBankNow, freshBankNow),
    ]);
    const liveBankResponse = await dispatch(worker, environment, "/api/v1/bookloq", owner);
    assert.equal(liveBankResponse.status, 200);
    const liveBankBookLoq = (await liveBankResponse.json()).bookloq;
    assert.equal(liveBankBookLoq.banks[0].balanceState, "current");
    assert.equal(liveBankBookLoq.summary.bankBalanceCents, 2397800);
    assert.equal(liveBankBookLoq.integrations.banking, "connected_and_synced");
    assert.equal(liveBankBookLoq.thirteenWeekCashFlow.status, "available");
    const baselinePurchasingCapacity = liveBankBookLoq.thirteenWeekCashFlow.purchasingCapacityCents;
    assert.equal(typeof baselinePurchasingCapacity, "number");

    const cashFlowDate = new Date().toISOString().slice(0, 10);
    await database.prepare(`INSERT INTO purchase_orders
      (id, organization_id, order_number, supplier_name, delivery_location_id, order_date,
       expected_delivery_date, currency, status, subtotal_cents, tax_cents, discount_cents,
       total_cents, committed_cash_date, created_by_user_id, created_at, updated_at)
      VALUES ('cash-flow-po', ?, 'PO-CASH-FLOW', 'Cash Flow Supplier', ?, ?, ?, 'CAD',
        'approved', 100000, 0, 0, 100000, ?, ?, ?, ?)`)
      .bind(ownerRecord.organizationId, primaryLocation.id, cashFlowDate, cashFlowDate,
        cashFlowDate, ownerRecord.userId, freshBankNow, freshBankNow).run();
    const purchaseFlowResponse = await dispatch(worker, environment, "/api/v1/bookloq", owner);
    assert.equal(purchaseFlowResponse.status, 200);
    const approvedFlow = (await purchaseFlowResponse.json()).bookloq.thirteenWeekCashFlow;
    assert.equal(approvedFlow.status, "available");
    assert.equal(approvedFlow.purchasingCapacityCents, baselinePurchasingCapacity);
    assert.equal(approvedFlow.weeks.reduce((sum, week) => sum + week.confirmedNetCents, 0), 0);
    await database.prepare("UPDATE purchase_orders SET status = 'sent', updated_at = ? WHERE id = 'cash-flow-po' AND organization_id = ?")
      .bind(freshBankNow + 1, ownerRecord.organizationId).run();
    const sentPurchaseFlowResponse = await dispatch(worker, environment, "/api/v1/bookloq", owner);
    assert.equal(sentPurchaseFlowResponse.status, 200);
    const purchaseFlow = (await sentPurchaseFlowResponse.json()).bookloq.thirteenWeekCashFlow;
    assert.equal(purchaseFlow.status, "available");
    assert.equal(purchaseFlow.purchasingCapacityCents, baselinePurchasingCapacity - 100000);
    const confirmedWithPurchase = purchaseFlow.weeks.reduce((sum, week) => sum + week.confirmedNetCents, 0);
    assert.equal(confirmedWithPurchase, -100000);

    const supplier = await database.prepare(`SELECT id FROM bookloq_contacts
      WHERE organization_id = ? AND contact_type = 'supplier' ORDER BY created_at LIMIT 1`)
      .bind(ownerRecord.organizationId).first();
    assert.ok(supplier?.id);
    await database.prepare(`INSERT INTO supplier_bills
      (id, organization_id, supplier_id, bill_number, invoice_date, due_date, status,
       subtotal_cents, tax_cents, total_cents, paid_cents, currency, purchase_order_ref,
       location_ref, approval_status, demo_record, created_at, updated_at)
      VALUES ('cash-flow-linked-bill', ?, ?, 'BILL-CASH-FLOW', ?, ?, 'under_review',
        100000, 0, 100000, 0, 'CAD', 'cash-flow-po', 'all', 'pending', 0, ?, ?)`)
      .bind(ownerRecord.organizationId, supplier.id, cashFlowDate, cashFlowDate, freshBankNow, freshBankNow).run();
    const provisionalFlowResponse = await dispatch(worker, environment, "/api/v1/bookloq", owner);
    assert.equal(provisionalFlowResponse.status, 200);
    const provisionalFlow = (await provisionalFlowResponse.json()).bookloq.thirteenWeekCashFlow;
    assert.equal(provisionalFlow.purchasingCapacityCents, baselinePurchasingCapacity - 100000);
    assert.equal(provisionalFlow.weeks.reduce((sum, week) => sum + week.confirmedNetCents, 0), -100000);
    assert.equal(provisionalFlow.weeks.reduce((sum, week) => sum + week.expectedNetCents, 0), 0);
    await database.prepare(`UPDATE supplier_bills SET status = 'approved', approval_status = 'approved', updated_at = ?
      WHERE id = 'cash-flow-linked-bill' AND organization_id = ?`)
      .bind(freshBankNow + 1, ownerRecord.organizationId).run();
    const linkedFlowResponse = await dispatch(worker, environment, "/api/v1/bookloq", owner);
    assert.equal(linkedFlowResponse.status, 200);
    const linkedFlow = (await linkedFlowResponse.json()).bookloq.thirteenWeekCashFlow;
    assert.equal(linkedFlow.purchasingCapacityCents, baselinePurchasingCapacity - 100000);
    assert.equal(linkedFlow.weeks.reduce((sum, week) => sum + week.confirmedNetCents, 0), -100000);

    await database.prepare(`INSERT INTO supplier_bills
      (id, organization_id, supplier_id, bill_number, invoice_date, due_date, status,
       subtotal_cents, tax_cents, total_cents, paid_cents, currency, purchase_order_ref,
       location_ref, approval_status, demo_record, created_at, updated_at)
      VALUES ('foreign-currency-bill', ?, ?, 'BILL-USD', ?, ?, 'approved',
        50000, 0, 50000, 0, 'USD', NULL, 'all', 'approved', 0, ?, ?)`)
      .bind(ownerRecord.organizationId, supplier.id, cashFlowDate, cashFlowDate, freshBankNow, freshBankNow).run();
    const foreignFlowResponse = await dispatch(worker, environment, "/api/v1/bookloq", owner);
    assert.equal(foreignFlowResponse.status, 200);
    const foreignBookLoq = (await foreignFlowResponse.json()).bookloq;
    const foreignFlow = foreignBookLoq.thirteenWeekCashFlow;
    assert.equal(foreignFlow.status, "needs_review");
    assert.equal(foreignFlow.purchasingCapacityCents, null);
    assert.ok(foreignFlow.decisionBlocks.includes("foreign_currency_obligations"));
    assert.equal(foreignBookLoq.cashIntelligence.status, "available");
    assert.equal(foreignBookLoq.cashIntelligence.purchasingCapacityCents, null);
    assert.equal(typeof foreignBookLoq.summary.currentCashCents, "number");
    assert.equal(foreignBookLoq.summary.availableCashCents, null);
    assert.ok(foreignBookLoq.forecasts.length > 0);
    await database.batch([
      database.prepare("UPDATE bookloq_settings SET data_mode = 'demonstration', updated_at = ? WHERE organization_id = ?")
        .bind(freshBankNow, ownerRecord.organizationId),
      database.prepare("UPDATE bank_accounts SET demo_record = 1, updated_at = ? WHERE organization_id = ?")
        .bind(freshBankNow, ownerRecord.organizationId),
      database.prepare("DELETE FROM integration_connections WHERE id = 'plaid-live-fixture' AND organization_id = ?")
        .bind(ownerRecord.organizationId),
    ]);
    const financeReader = { email: "finance-reader@example.invalid", name: "Finance Reader" };
    const readerUserId = crypto.randomUUID();
    const readerRoleId = crypto.randomUUID();
    const readerNow = Date.now();
    await database.batch([
      database.prepare(`INSERT INTO users (id, email, display_name, status, created_at, updated_at)
        VALUES (?, ?, ?, 'active', ?, ?)`).bind(readerUserId, financeReader.email, financeReader.name, readerNow, readerNow),
      database.prepare(`INSERT INTO memberships (id, user_id, organization_id, role, status, created_at, updated_at)
        VALUES (?, ?, ?, 'employee', 'active', ?, ?)`).bind(crypto.randomUUID(), readerUserId, ownerRecord.organizationId, readerNow, readerNow),
      database.prepare(`INSERT INTO access_roles
        (id, organization_id, name, description, color, permissions_json, location_scope_json, archived, created_by_user_id, created_at, updated_at)
        VALUES (?, ?, 'Financial statements only', '', '#53657a', '["finance.statements","reports.operational","reports.export","metrics.revenue"]', '[]', 0, ?, ?, ?)`)
        .bind(readerRoleId, ownerRecord.organizationId, ownerRecord.userId, readerNow, readerNow),
      database.prepare(`INSERT INTO team_members
        (id, organization_id, user_id, role_id, first_name, last_name, email, employee_code,
         primary_location_id, permitted_locations_json, status, remote_login, created_by_user_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'Finance', 'Reader', ?, 'FIN-READ', ?, ?, 'active', 1, ?, ?, ?)`)
        .bind(crypto.randomUUID(), ownerRecord.organizationId, readerUserId, readerRoleId, financeReader.email,
          primaryLocation.id, JSON.stringify([primaryLocation.id]), ownerRecord.userId, readerNow, readerNow),
    ]);
    const limitedBookLoqResponse = await dispatch(worker, environment, "/api/v1/bookloq", financeReader);
    assert.equal(limitedBookLoqResponse.status, 200);
    const limitedBookLoq = (await limitedBookLoqResponse.json()).bookloq;
    assert.deepEqual(limitedBookLoq.statements.accounts, []);
    assert.ok(limitedBookLoq.accountCatalog.length > 0);
    assert.deepEqual(limitedBookLoq.journals, []);
    assert.deepEqual(limitedBookLoq.budgets, []);
    for (const key of ["banks", "transactions", "reconciliations", "bills", "invoices", "contacts", "audit", "forecasts"]) {
      assert.deepEqual(limitedBookLoq[key], [], key);
    }
    for (const key of ["bankBalanceCents", "accountsReceivableCents", "accountsPayableCents", "payrollObligationsCents", "upcomingBillsCount", "overdueInvoicesCount", "unreconciledCount", "uncategorizedCount"]) {
      assert.equal(limitedBookLoq.summary[key], null, key);
    }
    assert.equal(limitedBookLoq.cashIntelligence.status, "unavailable");
    assert.doesNotMatch(JSON.stringify(limitedBookLoq), /•••• 4821|accounts@peak-demo\.invalid/);

    const limitedReportResponse = await dispatch(worker, environment, "/api/v1/reports?report=sales_totals", financeReader);
    assert.equal(limitedReportResponse.status, 200);
    const limitedReport = await limitedReportResponse.json();
    assert.equal(limitedReport.totals.costOfGoodsCents, null);
    assert.equal(limitedReport.totals.grossProfitCents, null);
    assert.equal(limitedReport.totals.labourCostCents, null);
    assert.equal(limitedReport.totals.discountsCents, null);
    assert.equal(limitedReport.totals.refundsCents, null);
    assert.ok(limitedReport.rows.every((row) => row.costOfGoodsCents === null));

    const limitedCsvResponse = await dispatch(worker, environment, "/api/v1/reports?report=sales_totals&format=csv", financeReader);
    assert.equal(limitedCsvResponse.status, 200);
    const [csvHeader, csvRow] = (await limitedCsvResponse.text()).split("\n");
    const csvColumns = csvHeader.split(",");
    const csvValues = csvRow.split(",");
    for (const restrictedColumn of [
      "Discounts (minor units)",
      "Refunds (minor units)",
      "Cost of goods (minor units)",
      "Gross profit (minor units)",
      "Labour cost (minor units)",
    ]) {
      assert.equal(csvValues[csvColumns.indexOf(restrictedColumn)], "", restrictedColumn);
    }

    await database.batch([
      database.prepare(`INSERT INTO integration_connections
        (id, organization_id, provider, status, scopes_json, data_promotion_status, connected_at, last_successful_sync_at, created_at, updated_at)
        VALUES (?, ?, 'plaid', 'connected', '["transactions","balance"]', 'approved', ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), ownerRecord.organizationId, readerNow, readerNow, readerNow, readerNow),
      database.prepare(`UPDATE bank_accounts SET provider = 'plaid', external_account_ref = 'sandbox-fixture',
        connection_status = 'healthy', available_balance_cents = 900000000, live_balance_cents = 900000000,
        last_sync_at = ?, demo_record = 1, updated_at = ?
        WHERE id = (SELECT id FROM bank_accounts WHERE organization_id = ? LIMIT 1)`)
        .bind(readerNow, readerNow, ownerRecord.organizationId),
    ]);
    const sandboxPurchasingResponse = await dispatch(worker, environment, "/api/v1/purchasing", owner);
    assert.equal(sandboxPurchasingResponse.status, 200);
    const sandboxCash = (await sandboxPurchasingResponse.json()).catalog.cashContext;
    assert.equal(sandboxCash.status, "needs_bank_connection");
    assert.equal(sandboxCash.verifiedCashCents, null);
    assert.equal(sandboxCash.verifiedPurchasingCapacityCents, null);
    assert.equal(sandboxCash.accountsUsed, 0);

    const debitAccount = bookloq.statements.accounts.find(account => account.systemKey === "supplies_expense");
    const creditAccount = bookloq.statements.accounts.find(account => account.systemKey === "accounts_payable");
    const journalKey = crypto.randomUUID();
    const manualJournal = await dispatch(worker, environment, "/api/v1/bookloq/journals", { method: "POST", ...owner, idempotencyKey: journalKey, body: {
      entryDate: journalDate, memo: "Verified manual journal", currency: "CAD",
      lines: [
        { accountId: debitAccount.id, description: "Supplies", debitCents: 10_000, creditCents: 0, locationRef: "Main" },
        { accountId: creditAccount.id, description: "Supplier payable", debitCents: 0, creditCents: 10_000, locationRef: "Main" },
      ],
    } });
    assert.equal(manualJournal.status, 201);
    const manualJournalBody = await manualJournal.json();
    assert.equal(manualJournalBody.journal.totalDebitCents, 10_000);
    const journalReplay = await dispatch(worker, environment, "/api/v1/bookloq/journals", { method: "POST", ...owner, idempotencyKey: journalKey, body: {
      entryDate: journalDate, memo: "Verified manual journal", currency: "CAD",
      lines: [
        { accountId: debitAccount.id, debitCents: 10_000, creditCents: 0 },
        { accountId: creditAccount.id, debitCents: 0, creditCents: 10_000 },
      ],
    } });
    assert.equal(journalReplay.status, 200);
    assert.equal((await journalReplay.json()).replayed, true);

    const reversal = await dispatch(worker, environment, "/api/v1/bookloq/journals", { method: "PATCH", ...owner, idempotencyKey: crypto.randomUUID(), body: { entryId: manualJournalBody.journal.id, reason: "Correct the verified test entry", reversalDate: journalDate } });
    assert.equal(reversal.status, 201);
    assert.equal((await reversal.json()).journal.reversalOfEntryId, manualJournalBody.journal.id);

    const salesInsight = command.insights.find(insight => insight.id === "sales-trend");
    const task = await dispatch(worker, environment, "/api/v1/tasks", { method: "POST", ...owner, idempotencyKey: crypto.randomUUID(), body: { ...salesInsight.suggestedTask, sourceType: "insight", sourceRef: salesInsight.id, assignee: "Owner", dueDate: null } });
    assert.equal(task.status, 201);
    assert.equal((await task.json()).task.sourceRef, "sales-trend");

    // Keep both measurement windows inside the rolling sales fixture.
    const event = await dispatch(worker, environment, "/api/v1/events", { method: "POST", ...owner, body: { eventType: "promotion", title: "Changed weekend offer", detail: "Test event", eventDate: dateOffset(latest, -15), expectedOutcome: "Improve contribution", reviewDate: dateOffset(latest, -1) } });
    assert.equal(event.status, 201);
    const eventList = await dispatch(worker, environment, "/api/v1/events", owner);
    assert.equal(eventList.status, 200);
    assert.equal((await eventList.json()).events[0].measuredImpact.measurable, true);

    const secondOnboarding = await dispatch(worker, environment, "/api/v1/onboarding", { method: "POST", ...secondOwner, body: onboardingBody(secondOwner.name, "South Store") });
    assert.equal(secondOnboarding.status, 201);
    await activateTestSubscription(database, (await secondOnboarding.json()).organization.id);
    const ownerGovernance = await dispatch(worker, environment, "/api/v1/governance", owner);
    const secondGovernance = await dispatch(worker, environment, "/api/v1/governance", secondOwner);
    assert.equal(ownerGovernance.status, 200);
    assert.equal(secondGovernance.status, 200);
    const ownerGovernanceBody = (await ownerGovernance.json()).governance;
    const secondGovernanceBody = (await secondGovernance.json()).governance;
    const foreignRole = secondGovernanceBody.roles.find((role) => role.systemKey === "general_manager");
    const ownerMember = ownerGovernanceBody.members.find((member) => member.userId === ownerRecord.userId);
    assert.ok(foreignRole?.id && ownerMember?.id);
    const crossTenantRoleWrite = await dispatch(worker, environment, "/api/v1/governance", {
      method: "POST",
      ...owner,
      body: { action: "save_role", roleId: foreignRole.id, name: "Tampered role", description: "", color: "#53657a", permissions: ["dashboard.view"], locationScope: [] },
    });
    assert.equal(crossTenantRoleWrite.status, 404);
    assert.equal((await crossTenantRoleWrite.json()).error.code, "ROLE_NOT_FOUND");
    const crossTenantRoleAssignment = await dispatch(worker, environment, "/api/v1/governance", {
      method: "POST",
      ...owner,
      body: { action: "update_employee", memberId: ownerMember.id, roleId: foreignRole.id, status: "active" },
    });
    assert.equal(crossTenantRoleAssignment.status, 409);
    assert.equal((await crossTenantRoleAssignment.json()).error.code, "OWNER_ROLE_PROTECTED");
    const secondCommand = await dispatch(worker, environment, "/api/v1/command-centre", secondOwner);
    assert.equal(secondCommand.status, 200);
    const secondBody = await secondCommand.json();
    assert.equal(secondBody.commandCentre.ready, false);
    assert.equal(secondBody.commandCentre.source.rowCount, 0);
    const secondBookLoq = await dispatch(worker, environment, "/api/v1/bookloq", secondOwner);
    assert.equal(secondBookLoq.status, 403);
    assert.equal((await secondBookLoq.json()).error.code, "ADDON_NOT_INCLUDED");
  } finally {
    await dispose();
  }
});

test("report authority never silently fails over while the selected source is staging or syncing", async () => {
  const { worker, environment, database, dispose } = await createEnvironment();
  try {
    const fixture = await createReportWorkspace(worker, environment, database, "authority-lease");
    const selectedConnectionId = `selected-${crypto.randomUUID()}`;
    const alternateConnectionId = `alternate-${crypto.randomUUID()}`;
    const selectedMetricRef = await seedReportConnection(database, {
      organizationId: fixture.organizationId,
      locationId: fixture.locationId,
      connectionId: selectedConnectionId,
      namespace: "selected-account",
      externalLocationRef: "main",
      promotionStatus: "staging",
    });
    const alternateMetricRef = await seedReportConnection(database, {
      organizationId: fixture.organizationId,
      locationId: fixture.locationId,
      connectionId: alternateConnectionId,
      namespace: "alternate-account",
      externalLocationRef: "main",
    });
    await seedReportMetric(database, {
      organizationId: fixture.organizationId,
      userId: fixture.userId,
      businessDate: "2026-08-10",
      locationRef: selectedMetricRef,
      netSalesCents: 11_000,
      sourceConnectionId: selectedConnectionId,
    });
    await seedReportMetric(database, {
      organizationId: fixture.organizationId,
      userId: fixture.userId,
      businessDate: "2026-08-10",
      locationRef: alternateMetricRef,
      netSalesCents: 99_000,
      sourceConnectionId: alternateConnectionId,
    });
    await seedSalesAuthority(database, {
      organizationId: fixture.organizationId,
      locationId: fixture.locationId,
      connectionId: selectedConnectionId,
      userId: fixture.userId,
    });

    const stagingResponse = await dispatch(
      worker,
      environment,
      "/api/v1/reports?report=sales_totals&start=2026-08-10&end=2026-08-10",
      fixture.owner,
    );
    assert.equal(stagingResponse.status, 200);
    const stagingReport = await stagingResponse.json();
    assert.equal(stagingReport.reportStatus, "source_conflict");
    assert.equal(stagingReport.totals, null);
    assert.deepEqual(stagingReport.sourceAuthority.sales.selections, []);
    const stagingConflict = stagingReport.sourceAuthority.sales.conflicts.find(
      (conflict) => conflict.localLocationId === fixture.locationId,
    );
    assert.equal(
      stagingConflict?.candidates.find((candidate) => candidate.connectionId === selectedConnectionId)?.availability,
      "staging",
    );
    assert.ok(stagingConflict?.candidates.some((candidate) => candidate.connectionId === alternateConnectionId));

    const activeLeaseExpiry = Math.floor(Date.now() / 1_000) + 3_600;
    await database.prepare(`UPDATE integration_connections
      SET data_promotion_status = 'approved', sync_lease_owner = 'sync-worker', sync_lease_expires_at = ?
      WHERE id = ? AND organization_id = ?`)
      .bind(activeLeaseExpiry, selectedConnectionId, fixture.organizationId).run();
    const syncingResponse = await dispatch(
      worker,
      environment,
      "/api/v1/reports?report=sales_totals&start=2026-08-10&end=2026-08-10",
      fixture.owner,
    );
    assert.equal(syncingResponse.status, 200);
    const syncingReport = await syncingResponse.json();
    assert.equal(syncingReport.reportStatus, "source_conflict");
    assert.equal(syncingReport.totals, null);
    assert.deepEqual(syncingReport.sourceAuthority.sales.selections, []);
    const syncingConflict = syncingReport.sourceAuthority.sales.conflicts.find(
      (conflict) => conflict.localLocationId === fixture.locationId,
    );
    assert.equal(
      syncingConflict?.candidates.find((candidate) => candidate.connectionId === selectedConnectionId)?.availability,
      "syncing",
    );
  } finally {
    await dispose();
  }
});

test("report authority requires scoped fact evidence before a mapped source can affect consolidation", async () => {
  const { worker, environment, database, dispose } = await createEnvironment();
  try {
    const fixture = await createReportWorkspace(worker, environment, database, "fact-evidence");
    const factualConnectionId = `factual-${crypto.randomUUID()}`;
    const emptyConnectionId = `empty-${crypto.randomUUID()}`;
    const factualMetricRef = await seedReportConnection(database, {
      organizationId: fixture.organizationId,
      locationId: fixture.locationId,
      connectionId: factualConnectionId,
      namespace: "factual-account",
      externalLocationRef: "main",
    });
    await seedReportConnection(database, {
      organizationId: fixture.organizationId,
      locationId: fixture.locationId,
      connectionId: emptyConnectionId,
      namespace: "empty-account",
      externalLocationRef: "main",
    });
    await seedReportMetric(database, {
      organizationId: fixture.organizationId,
      userId: fixture.userId,
      businessDate: "2026-08-09",
      locationRef: factualMetricRef,
      netSalesCents: 12_345,
      sourceConnectionId: factualConnectionId,
    });

    const response = await dispatch(
      worker,
      environment,
      "/api/v1/reports?report=sales_totals&start=2026-08-09&end=2026-08-09",
      fixture.owner,
    );
    assert.equal(response.status, 200);
    const report = await response.json();
    assert.equal(report.reportStatus, "ready");
    assert.equal(report.totals.netSalesCents, 12_345);
    assert.deepEqual(
      report.sourceAuthority.sales.selections.map((selection) => selection.connectionId),
      [factualConnectionId],
    );
    const emptyCandidate = report.sourceAuthority.sales.candidates.find(
      (candidate) => candidate.connectionId === emptyConnectionId,
    );
    assert.equal(emptyCandidate?.hasFacts, false);
    assert.equal(emptyCandidate?.availability, "needs_data");
    assert.equal(report.sourceAuthority.sales.conflicts.length, 0);
    assert.deepEqual(report.rows.map((row) => row.sourceConnectionId), [factualConnectionId]);
  } finally {
    await dispose();
  }
});

test("report authority selection uses optimistic concurrency and stale disconnected choices do not block manual summaries", async () => {
  const { worker, environment, database, dispose } = await createEnvironment();
  try {
    const fixture = await createReportWorkspace(worker, environment, database, "authority-cas");
    const firstConnectionId = `first-${crypto.randomUUID()}`;
    const secondConnectionId = `second-${crypto.randomUUID()}`;
    const firstMetricRef = await seedReportConnection(database, {
      organizationId: fixture.organizationId,
      locationId: fixture.locationId,
      connectionId: firstConnectionId,
      namespace: "first-account",
      externalLocationRef: "main",
    });
    const secondMetricRef = await seedReportConnection(database, {
      organizationId: fixture.organizationId,
      locationId: fixture.locationId,
      connectionId: secondConnectionId,
      namespace: "second-account",
      externalLocationRef: "main",
    });
    for (const [connectionId, locationRef, amount] of [
      [firstConnectionId, firstMetricRef, 10_000],
      [secondConnectionId, secondMetricRef, 20_000],
    ]) {
      await seedReportMetric(database, {
        organizationId: fixture.organizationId,
        userId: fixture.userId,
        businessDate: "2026-08-07",
        locationRef,
        netSalesCents: amount,
        sourceConnectionId: connectionId,
      });
    }
    const conflictResponse = await dispatch(worker, environment,
      "/api/v1/reports?report=sales_totals&start=2026-08-07&end=2026-08-07", fixture.owner);
    assert.equal(conflictResponse.status, 200);
    const conflict = (await conflictResponse.json()).sourceAuthority.sales.conflicts[0];
    assert.equal(conflict.expectedVersion, 0);

    const selectionRequest = (connectionId) => dispatch(worker, environment, "/api/v1/reports", {
      method: "POST",
      ...fixture.owner,
      body: {
        action: "set_source_authority",
        locationId: fixture.locationId,
        connectionId,
        factFamily: "sales",
        expectedVersion: conflict.expectedVersion,
      },
    });
    const attempts = await Promise.all([selectionRequest(firstConnectionId), selectionRequest(secondConnectionId)]);
    assert.deepEqual(attempts.map((response) => response.status).sort(), [200, 409]);
    const saved = await database.prepare(`SELECT connection_id connectionId, version
      FROM integration_source_authorities WHERE organization_id = ? AND local_location_id = ?
        AND channel = 'retail' AND fact_family = 'sales'`)
      .bind(fixture.organizationId, fixture.locationId).first();
    assert.equal(saved.version, 1);

    const manualImportId = `manual-${crypto.randomUUID()}`;
    const timestamp = Math.floor(Date.now() / 1_000);
    await database.prepare(`INSERT INTO data_imports
      (id, organization_id, import_type, status, file_name, row_count, idempotency_key,
       imported_by_user_id, created_at)
      VALUES (?, ?, 'manual_entry', 'completed', '', 1, ?, ?, ?)`)
      .bind(manualImportId, fixture.organizationId, `key-${manualImportId}`, fixture.userId, timestamp).run();
    await seedReportMetric(database, {
      organizationId: fixture.organizationId,
      userId: fixture.userId,
      businessDate: "2026-08-08",
      locationRef: fixture.locationId,
      netSalesCents: 7_500,
      sourceImportId: manualImportId,
    });
    await database.prepare(`UPDATE integration_connections SET status = 'revoked', data_promotion_status = 'blocked'
      WHERE organization_id = ? AND id IN (?, ?)`)
      .bind(fixture.organizationId, firstConnectionId, secondConnectionId).run();
    const fallbackResponse = await dispatch(worker, environment,
      "/api/v1/reports?report=sales_totals&start=2026-08-08&end=2026-08-08", fixture.owner);
    assert.equal(fallbackResponse.status, 200);
    const fallback = await fallbackResponse.json();
    assert.equal(fallback.reportStatus, "ready");
    assert.equal(fallback.totals.netSalesCents, 7_500);
    assert.equal(fallback.rows[0].sourceKind, "manual_entry");
  } finally {
    await dispose();
  }
});

test("mixed provider and manual report rows preserve import lineage in JSON and CSV", async () => {
  const { worker, environment, database, dispose } = await createEnvironment();
  try {
    const fixture = await createReportWorkspace(worker, environment, database, "mixed-lineage");
    const manualLocationId = await seedReportLocation(database, fixture.organizationId, "Manual South");
    const providerConnectionId = `provider-${crypto.randomUUID()}`;
    const providerMetricRef = await seedReportConnection(database, {
      organizationId: fixture.organizationId,
      locationId: fixture.locationId,
      connectionId: providerConnectionId,
      namespace: "provider-account",
      externalLocationRef: "north",
    });
    const importId = `manual-import-${crypto.randomUUID()}`;
    const timestamp = Math.floor(Date.now() / 1_000);
    await database.prepare(`INSERT INTO data_imports
      (id, organization_id, import_type, status, file_name, row_count, idempotency_key,
       imported_by_user_id, created_at)
      VALUES (?, ?, 'daily_summary_csv', 'completed', 'manual-south.csv', 1, ?, ?, ?)`)
      .bind(importId, fixture.organizationId, `key-${importId}`, fixture.userId, timestamp).run();
    await seedReportMetric(database, {
      organizationId: fixture.organizationId,
      userId: fixture.userId,
      businessDate: "2026-08-08",
      locationRef: providerMetricRef,
      netSalesCents: 20_000,
      sourceConnectionId: providerConnectionId,
    });
    await seedReportMetric(database, {
      organizationId: fixture.organizationId,
      userId: fixture.userId,
      businessDate: "2026-08-08",
      locationRef: manualLocationId,
      netSalesCents: 5_000,
      sourceImportId: importId,
    });

    const query = "/api/v1/reports?report=sales_totals&start=2026-08-08&end=2026-08-08";
    const response = await dispatch(worker, environment, query, fixture.owner);
    assert.equal(response.status, 200);
    const report = await response.json();
    assert.equal(report.totals.netSalesCents, 25_000);
    assert.match(report.source.type, /authoritative records plus owner-reviewed summaries/);
    const manualRow = report.rows.find((row) => row.sourceConnectionId === null);
    assert.equal(manualRow?.sourceImportId, importId);
    assert.deepEqual(report.source.lineage.manual.imports, [{ id: importId, importType: "daily_summary_csv" }]);
    assert.equal(report.source.lineage.manual.rowCount, 1);

    const csvResponse = await dispatch(worker, environment, `${query}&format=csv`, fixture.owner);
    assert.equal(csvResponse.status, 200);
    const [header, ...csvRows] = (await csvResponse.text()).trim().split("\n");
    const columns = header.split(",");
    const connectionColumn = columns.indexOf("Source connection");
    const importColumn = columns.indexOf("Source import");
    assert.notEqual(connectionColumn, -1);
    assert.notEqual(importColumn, -1);
    const manualCsvRow = csvRows.map((row) => row.split(",")).find((row) => row[connectionColumn] === "manual");
    assert.equal(manualCsvRow?.[importColumn], importId);
  } finally {
    await dispose();
  }
});
});

test("location-limited purchasing cannot list or approve another location's orders", async () => {
  const { worker, environment, database, dispose } = await createEnvironment();
  try {
    const owner = { email: "purchasing-owner@example.invalid", name: "Purchasing Owner" };
    const onboarding = await dispatch(worker, environment, "/api/v1/onboarding", {
      method: "POST",
      ...owner,
      body: onboardingBody(owner.name, "Scoped Purchasing"),
    });
    assert.equal(onboarding.status, 201);

    const ownerRecord = await database.prepare(`SELECT u.id userId, m.organization_id organizationId
      FROM users u JOIN memberships m ON m.user_id = u.id WHERE u.email = ?`).bind(owner.email).first();
    const north = await database.prepare(`SELECT id FROM organization_locations
      WHERE organization_id = ? AND status = 'active' ORDER BY created_at LIMIT 1`).bind(ownerRecord.organizationId).first();
    assert.ok(ownerRecord?.userId && ownerRecord?.organizationId && north?.id);
    await activateTestSubscription(database, ownerRecord.organizationId);
    assert.equal((await dispatch(worker, environment, "/api/v1/command-centre", owner)).status, 200);
    const southId = crypto.randomUUID();
    const managerUserId = crypto.randomUUID();
    const managerRoleId = crypto.randomUUID();
    const manager = { email: "north-manager@example.invalid", name: "North Manager" };
    const qualityViewerUserId = crypto.randomUUID();
    const qualityViewerRoleId = crypto.randomUUID();
    const qualityViewer = { email: "quality-viewer@example.invalid", name: "Quality Viewer" };
    const now = Date.now();
    await database.batch([
      database.prepare(`INSERT INTO organization_locations
        (id, organization_id, name, status, country_code, address_line_1, locality, administrative_area,
         postal_code, timezone, currency, validation_status, created_at, updated_at)
        VALUES (?, ?, 'South', 'active', 'CA', '2 South Road', 'Edmonton', 'AB', 'T5A 1A2',
          'America/Edmonton', 'CAD', 'validated', ?, ?)`)
        .bind(southId, ownerRecord.organizationId, now, now),
      database.prepare(`INSERT INTO users (id, email, display_name, status, created_at, updated_at)
        VALUES (?, ?, ?, 'active', ?, ?)`).bind(managerUserId, manager.email, manager.name, now, now),
      database.prepare(`INSERT INTO users (id, email, display_name, status, created_at, updated_at)
        VALUES (?, ?, ?, 'active', ?, ?)`).bind(qualityViewerUserId, qualityViewer.email, qualityViewer.name, now, now),
      database.prepare(`INSERT INTO memberships (id, user_id, organization_id, role, status, created_at, updated_at)
        VALUES (?, ?, ?, 'manager', 'active', ?, ?)`).bind(crypto.randomUUID(), managerUserId, ownerRecord.organizationId, now, now),
      database.prepare(`INSERT INTO memberships (id, user_id, organization_id, role, status, created_at, updated_at)
        VALUES (?, ?, ?, 'employee', 'active', ?, ?)`).bind(crypto.randomUUID(), qualityViewerUserId, ownerRecord.organizationId, now, now),
      database.prepare(`INSERT INTO access_roles
        (id, organization_id, name, description, color, permissions_json, location_scope_json, archived, created_by_user_id, created_at, updated_at)
        VALUES (?, ?, 'North purchasing manager', '', '#53657a', '["purchasing.view","purchasing.approve","operations.tasks","operations.manage","insights.create_task","documents.view","documents.upload","documents.download","documents.retention","integrations.view","integrations.manage","finance.connections","finance.bank_balances","finance.ap_ar","data_imports.view"]', '[]', 0, ?, ?, ?)`)
        .bind(managerRoleId, ownerRecord.organizationId, ownerRecord.userId, now, now),
      database.prepare(`INSERT INTO access_roles
        (id, organization_id, name, description, color, permissions_json, location_scope_json, archived, created_by_user_id, created_at, updated_at)
        VALUES (?, ?, 'Data quality viewer', '', '#53657a', '["integrations.view"]', '[]', 0, ?, ?, ?)`)
        .bind(qualityViewerRoleId, ownerRecord.organizationId, ownerRecord.userId, now, now),
      database.prepare(`INSERT INTO team_members
        (id, organization_id, user_id, role_id, first_name, last_name, email, employee_code,
         primary_location_id, permitted_locations_json, status, remote_login, created_by_user_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'North', 'Manager', ?, 'NORTH-MGR', ?, ?, 'active', 1, ?, ?, ?)`)
        .bind(crypto.randomUUID(), ownerRecord.organizationId, managerUserId, managerRoleId, manager.email,
          north.id, JSON.stringify([north.id]), ownerRecord.userId, now, now),
      database.prepare(`INSERT INTO team_members
        (id, organization_id, user_id, role_id, first_name, last_name, email, employee_code,
         primary_location_id, permitted_locations_json, status, remote_login, created_by_user_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'Quality', 'Viewer', ?, 'QUALITY-VIEW', ?, ?, 'active', 1, ?, ?, ?)`)
        .bind(crypto.randomUUID(), ownerRecord.organizationId, qualityViewerUserId, qualityViewerRoleId, qualityViewer.email,
          north.id, JSON.stringify([north.id, southId]), ownerRecord.userId, now, now),
      database.prepare(`INSERT INTO purchase_orders
        (id, organization_id, order_number, supplier_name, delivery_location_id, order_date, currency,
         status, subtotal_cents, tax_cents, discount_cents, total_cents, created_by_user_id, created_at, updated_at)
        VALUES ('po-north', ?, 'PO-NORTH', 'North Supplier', ?, '2026-08-11', 'CAD',
          'awaiting_approval', 10000, 0, 0, 10000, ?, ?, ?)`)
        .bind(ownerRecord.organizationId, north.id, ownerRecord.userId, now, now),
      database.prepare(`INSERT INTO purchase_orders
        (id, organization_id, order_number, supplier_name, delivery_location_id, order_date, currency,
         status, subtotal_cents, tax_cents, discount_cents, total_cents, created_by_user_id, created_at, updated_at)
        VALUES ('po-south', ?, 'PO-SOUTH', 'South Supplier', ?, '2026-08-11', 'CAD',
          'awaiting_approval', 20000, 0, 0, 20000, ?, ?, ?)`)
        .bind(ownerRecord.organizationId, southId, ownerRecord.userId, now, now),
      database.prepare(`INSERT INTO workspace_documents
        (id, organization_id, document_type, file_name, object_key, content_type, size_bytes, sha256_hex,
         status, scan_status, extraction_status, extracted_json, uploaded_by_user_id, created_at, updated_at)
        VALUES ('pending-invoice', ?, 'invoice', 'pending-invoice.pdf', 'quarantine/pending-invoice.pdf',
          'application/pdf', 128, 'pending-invoice-hash', 'review_required', 'pending', 'not_configured', '{}', ?, ?, ?)`)
        .bind(ownerRecord.organizationId, ownerRecord.userId, now, now),
      database.prepare(`INSERT INTO goods_receipts
        (id, organization_id, purchase_order_id, received_date, received_by_user_id, lines_json,
         discrepancy_status, created_at)
        VALUES ('receipt-private', ?, 'po-north', '2026-08-11', ?, '[]', 'review_required', ?)`)
        .bind(ownerRecord.organizationId, ownerRecord.userId, now),
      database.prepare(`INSERT INTO invoice_matches
        (id, organization_id, purchase_order_id, document_id, status, difference_cents, details_json,
         reviewed_by_user_id, created_at, updated_at)
        VALUES ('match-private', ?, 'po-north', 'pending-invoice', 'review_required', 10000, '{}', ?, ?, ?)`)
        .bind(ownerRecord.organizationId, ownerRecord.userId, now, now),
    ]);
    await grantBookLoqForFlow(database, "Scoped Purchasing");

    const qualityResponse = await dispatch(worker, environment, "/api/v1/data-quality", qualityViewer);
    assert.equal(qualityResponse.status, 200);
    const qualityPayload = await qualityResponse.json();
    assert.equal(qualityPayload.sources.documents, 0);
    assert.equal(
      qualityPayload.issues.some((issue) => ["document_review", "receiving_discrepancy", "invoice_match"].includes(issue.type)),
      false,
      "integrations.view must not expose document or purchasing evidence",
    );

    for (const path of [
      "/api/v1/tasks",
      "/api/v1/documents",
      "/api/v1/integrations",
      "/api/v1/integrations/lightspeed/outlets",
      "/api/v1/integrations/lightspeed-r/shops",
      "/api/v1/daily-metrics",
    ]) {
      const response = await dispatch(worker, environment, path, manager);
      assert.equal(response.status, 403, path);
      assert.equal((await response.json()).error.code, "ORGANIZATION_SCOPE_REQUIRED", path);
    }
    for (const request of [
      { path: "/api/v1/tasks", method: "POST", idempotencyKey: crypto.randomUUID(), body: { title: "Cross-location task", detail: "", priority: "medium", assignee: "Manager", dueDate: null, sourceType: "manual", sourceRef: null, expectedImpact: "" } },
      { path: "/api/v1/tasks", method: "PATCH", body: { id: "task-from-another-location", status: "done" } },
      { path: "/api/v1/documents", method: "POST", body: {} },
      { path: "/api/v1/documents?id=document-from-another-location", method: "DELETE", body: {} },
      { path: "/api/v1/integrations/plaid/link-token", method: "POST", body: {} },
      { path: "/api/v1/integrations/plaid/exchange", method: "POST", body: { publicToken: "public-sandbox-token", consentAcknowledged: true } },
      { path: "/api/v1/integrations/plaid/sync", method: "POST", body: {} },
      { path: "/api/v1/integrations/plaid/disconnect", method: "POST", body: {} },
    ]) {
      const response = await dispatch(worker, environment, request.path, { ...request, ...manager });
      assert.equal(response.status, 403, request.path);
      assert.equal((await response.json()).error.code, "ORGANIZATION_SCOPE_REQUIRED", request.path);
    }

    const managerResponse = await dispatch(worker, environment, "/api/v1/purchasing", manager);
    assert.equal(managerResponse.status, 200);
    const managerPayload = await managerResponse.json();
    assert.deepEqual(managerPayload.orders.map((order) => order.id), ["po-north"]);
    assert.equal(managerPayload.catalog.cashContext, null, "location-limited finance roles must not receive or use organization-wide cash data");
    assert.equal(managerPayload.calendar.some((entry) => entry.kind === "supplier_bill" || entry.kind === "customer_invoice"), false);
    assert.doesNotMatch(JSON.stringify(managerPayload), /"(?:unitCostCents|previousCostCents|landedCostCents|remainingCostCents|remainingMerchandiseCents|totalRemainingMerchandiseCents|differenceCents|priceChangeRate)"/);

    await database.prepare("UPDATE tenant_addons SET status = 'inactive', updated_at = ? WHERE organization_id = ? AND addon_key = 'bookloq'")
      .bind(Date.now(), ownerRecord.organizationId).run();
    const inactiveAddonResponse = await dispatch(worker, environment, "/api/v1/purchasing", owner);
    assert.equal(inactiveAddonResponse.status, 200, "ordinary purchasing remains available without BookLoQ");
    const inactiveAddonPayload = await inactiveAddonResponse.json();
    assert.deepEqual(inactiveAddonPayload.orders.map((order) => order.id).sort(), ["po-north", "po-south"]);
    assert.equal(inactiveAddonPayload.catalog.cashContext, null, "inactive BookLoQ must not enrich purchasing with cash capacity");
    await database.prepare("UPDATE tenant_addons SET status = 'active', updated_at = ? WHERE organization_id = ? AND addon_key = 'bookloq'")
      .bind(Date.now(), ownerRecord.organizationId).run();

    const ownerResponse = await dispatch(worker, environment, "/api/v1/purchasing", owner);
    assert.equal(ownerResponse.status, 200);
    assert.deepEqual((await ownerResponse.json()).orders.map((order) => order.id).sort(), ["po-north", "po-south"]);

    const explicitDenied = await dispatch(worker, environment, `/api/v1/purchasing?location=${encodeURIComponent(southId)}`, manager);
    assert.equal(explicitDenied.status, 403);
    assert.equal((await explicitDenied.json()).error.code, "LOCATION_ACCESS_DENIED");
    const approveDenied = await dispatch(worker, environment, "/api/v1/purchasing", {
      method: "POST",
      ...manager,
      body: { action: "approve", purchaseOrderId: "po-south" },
    });
    assert.equal(approveDenied.status, 403);
    assert.equal((await approveDenied.json()).error.code, "LOCATION_ACCESS_DENIED");
    assert.equal((await database.prepare("SELECT status FROM purchase_orders WHERE id = 'po-south'").first()).status, "awaiting_approval");

    const quarantinedMatch = await dispatch(worker, environment, "/api/v1/purchasing", {
      method: "POST",
      ...owner,
      body: { action: "match_invoice", purchaseOrderId: "po-north", documentId: "pending-invoice", invoiceTotalCents: 10000 },
    });
    assert.equal(quarantinedMatch.status, 423);
    assert.equal((await quarantinedMatch.json()).error.code, "DOCUMENT_SCAN_REQUIRED");
    assert.equal((await database.prepare("SELECT status FROM purchase_orders WHERE id = 'po-north'").first()).status, "awaiting_approval");
  } finally {
    await dispose();
  }
});

test("manual and CSV imports replace stale connector ownership and remain distinguishable in reports", async () => {
  const { worker, environment, database, dispose } = await createEnvironment();
  try {
    const workspace = await createReportWorkspace(worker, environment, database, "import-lineage");
    const staleTimestamp = Math.floor(Date.now() / 1_000);
    await database.prepare(`INSERT INTO daily_business_metrics
      (organization_id, business_date, location_ref, gross_sales_cents, net_sales_cents,
       cost_of_goods_cents, transaction_count, units_sold, refunds_cents, discounts_cents,
       labour_cost_cents, source_provider, source_connection_id, created_by_user_id,
       created_at, updated_at)
      VALUES (?, '2026-08-10', ?, 1, 1, 0, 1, 1, 0, 0, 0,
        'lightspeed-r', 'stale-connection', ?, ?, ?)`)
      .bind(workspace.organizationId, workspace.locationId, workspace.userId, staleTimestamp, staleTimestamp).run();

    const baseRow = {
      locationRef: workspace.locationId,
      grossSalesCents: 20_000,
      netSalesCents: 18_000,
      costOfGoodsCents: 9_000,
      transactionCount: 12,
      unitsSold: 15,
      refundsCents: 0,
      discountsCents: 2_000,
      labourCostCents: 3_000,
      inventoryValueCents: null,
      cashBalanceCents: null,
      accountsPayableCents: null,
    };
    const manualResponse = await dispatch(worker, environment, "/api/v1/daily-metrics", {
      method: "POST",
      ...workspace.owner,
      idempotencyKey: crypto.randomUUID(),
      body: { importType: "manual_entry", fileName: "", rows: [{ ...baseRow, businessDate: "2026-08-10" }] },
    });
    assert.equal(manualResponse.status, 201);
    const manualImportId = (await manualResponse.json()).import.id;
    const csvResponse = await dispatch(worker, environment, "/api/v1/daily-metrics", {
      method: "POST",
      ...workspace.owner,
      idempotencyKey: crypto.randomUUID(),
      body: { importType: "daily_summary_csv", fileName: "august.csv", rows: [{ ...baseRow, businessDate: "2026-08-11" }] },
    });
    assert.equal(csvResponse.status, 201);
    const csvImportId = (await csvResponse.json()).import.id;

    const replaced = await database.prepare(`SELECT source_provider sourceProvider,
      source_connection_id sourceConnectionId, source_import_id sourceImportId
      FROM daily_business_metrics WHERE organization_id = ? AND business_date = '2026-08-10' AND location_ref = ?`)
      .bind(workspace.organizationId, workspace.locationId).first();
    assert.deepEqual(replaced, { sourceProvider: null, sourceConnectionId: null, sourceImportId: manualImportId });

    const reportResponse = await dispatch(worker, environment,
      "/api/v1/reports?report=sales_totals&start=2026-08-10&end=2026-08-11", workspace.owner);
    assert.equal(reportResponse.status, 200);
    const report = await reportResponse.json();
    assert.deepEqual(report.rows.map((row) => ({ date: row.businessDate, sourceKind: row.sourceKind, sourceImportId: row.sourceImportId })), [
      { date: "2026-08-10", sourceKind: "manual_entry", sourceImportId: manualImportId },
      { date: "2026-08-11", sourceKind: "daily_summary_csv", sourceImportId: csvImportId },
    ]);

    const csvReport = await dispatch(worker, environment,
      "/api/v1/reports?report=sales_totals&start=2026-08-10&end=2026-08-11&format=csv", workspace.owner);
    assert.equal(csvReport.status, 200);
    const csvText = await csvReport.text();
    assert.match(csvText, /Source kind/);
    assert.match(csvText, /manual_entry/);
    assert.match(csvText, /daily_summary_csv/);
  } finally {
    await dispose();
  }
});
