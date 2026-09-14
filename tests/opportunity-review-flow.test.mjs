import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";
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


test("opportunity reviews preserve evidence, scope, history and action identity with authorization and concurrency guards", async () => {
  const { worker, environment, database, dispose } = await createEnvironment();
  try {
    const identity = await createReportWorkspace(worker, environment, database, "reviews");
    const other = await createReportWorkspace(worker, environment, database, "review-other");
    const today = new Date().toISOString().slice(0, 10);
    const locationRef = await seedReportConnection(database, { ...identity, connectionId: "review-pos", namespace: "legacy", externalLocationRef: "shop" });
    for (let i = 0; i < 60; i++) await seedReportMetric(database, { ...identity, businessDate: dateOffset(today, -i), locationRef, netSalesCents: i < 30 ? 10000 : 20000, sourceConnectionId: "review-pos" });
    const get = async (owner = identity.owner, suffix = "") => {
      const response = await dispatch(worker, environment, "/api/v1/opportunities" + suffix, owner);
      assert.equal(response.status, 200, await response.clone().text()); return response.json();
    };
    const dashboard = await dispatch(worker, environment, "/api/v1/command-centre", identity.owner);
    assert.equal(dashboard.status, 200, await dashboard.clone().text());
    const facts = await dashboard.json(), decision = facts.operatingSystem.decisions.find(row => row.sourceRef === "sales-trend") ?? facts.operatingSystem.decisions[0];
    assert.ok(decision);
    const period = facts.commandCentre.periodComparisons.thirtyDays;
    const selection = { decisionId: decision.id, from: period.periodStart, to: period.periodEnd };
    const capture = (body = selection, owner = identity.owner, suffix = "") => dispatch(worker, environment, "/api/v1/opportunities" + suffix, { ...owner, method: "POST", body, idempotencyKey: crypto.randomUUID() });
    assert.equal((await capture({ ...selection, snapshot: { evidence: ["Fabricated"] } })).status, 400);
    assert.equal((await capture({ ...selection, from: "2020-01-01" })).status, 409);
    assert.equal((await capture(selection, other.owner)).status, 409);
    const response = await capture();
    assert.equal(response.status, 200, await response.clone().text());
    let review = (await response.json()).review;
    assert.deepEqual(review.snapshot, decision);
    assert.equal(review.events.length, 1);
    assert.equal((await capture().then(r => r.json())).review.id, review.id);
    assert.equal((await get()).reviews.length, 1);
    assert.equal((await get(other.owner)).reviews.length, 0);
    assert.equal((await get(identity.owner, "?location=" + identity.locationId)).reviews.length, 0, "all-location evidence must not become a selected-location review");
    assert.equal((await capture(selection, identity.owner, "?location=" + other.locationId)).status, 403);
    const originalEvidence = JSON.stringify(review.snapshot);
    await database.prepare("UPDATE daily_business_metrics SET net_sales_cents=net_sales_cents+100 WHERE organization_id=?").bind(identity.organizationId).run();
    assert.equal(JSON.stringify((await get()).reviews[0].snapshot), originalEvidence, "a source refresh cannot rewrite the saved snapshot");
    const patch = (body, key = crypto.randomUUID(), owner = identity.owner) => dispatch(worker, environment, "/api/v1/opportunities", { ...owner, method: "PATCH", body, idempotencyKey: key });
    assert.equal((await patch({ id: review.id, version: 1, status: "resolved", note: "" })).status, 400);
    assert.equal((await patch({ id: review.id, version: 1, status: "monitoring", note: "Foreign" }, crypto.randomUUID(), other.owner)).status, 404);
    const snoozeKey = crypto.randomUUID();
    const snooze = { id: review.id, version: 1, status: "snoozed", note: "Waiting for the next comparable period.", snoozedUntil: new Date(Date.now() + 86400000).toISOString() };
    const snoozed = await patch(snooze, snoozeKey);
    assert.equal(snoozed.status, 200, await snoozed.clone().text());
    review = (await snoozed.json()).review;
    assert.equal(review.version, 2); assert.equal(review.events.length, 2);
    assert.equal((await patch({ id: review.id, version: 1, status: "dismissed", note: "Stale editor" })).status, 409);
    const replay = await patch(snooze, snoozeKey); assert.equal(replay.status, 200);
    assert.equal((await replay.json()).review.events.length, 2);
    const race = await Promise.all(["First editor", "Second editor"].map(note => patch({ id: review.id, version: 2, status: "monitoring", note })));
    assert.deepEqual(race.map(r => r.status).sort(), [200, 409]);
    review = (await get()).reviews[0]; assert.equal(review.version, 3); assert.equal(review.events.length, 3);
    const createAction = () => dispatch(worker, environment, "/api/v1/tasks", { ...identity.owner, method: "POST", idempotencyKey: crypto.randomUUID(), body: { title: "Review receipts", detail: "Saved opportunity evidence", priority: "high", assignee: "Store owner", sourceType: "decision", sourceRef: "opportunity:" + review.id } });
    const actionRace = await Promise.all([createAction(), createAction()]);
    for (const result of actionRace) assert.ok([200, 201].includes(result.status), await result.clone().text());
    const actions = await Promise.all(actionRace.map(r => r.json()));
    assert.equal(actions[0].task.id, actions[1].task.id);
    const taskId = actions[0].task.id;
    review = (await get()).reviews[0]; assert.equal(review.task.id, taskId); assert.equal(review.task.assignee, "Store owner");
    assert.equal((await patch({ id: review.id, version: 3, status: "resolved", note: "Reviewed receipts. No improvement claim; record coverage remains limited." })).status, 200);
    review = (await get()).reviews[0]; assert.equal(review.status, "resolved"); assert.equal(review.events.length, 4);
    assert.equal((await patch({ id: review.id, version: 4, status: "reviewed", note: "Reopened for the next check." })).status, 200);
    const repeatKey = crypto.randomUUID(), repeated = { id: review.id, version: 5, status: "monitoring", note: "Repeated request, one activity record." };
    const repeatedResults = await Promise.all([patch(repeated, repeatKey), patch(repeated, repeatKey)]);
    for (const result of repeatedResults) assert.equal(result.status, 200, await result.clone().text());
    assert.equal((await get()).reviews[0].events.length, 6);

    // The user can keep general task permission while losing financial evidence access.
    const now = Math.floor(Date.now() / 1000), staff = { email: "review-reader@example.invalid", name: "Review reader" }, userId = crypto.randomUUID(), roleId = crypto.randomUUID();
    const permissions = ["dashboard.view", "insights.view", "insights.create_task", "operations.tasks", "metrics.revenue", "metrics.profit", "metrics.cash", "payroll.totals", "inventory.value"];
    await database.batch([
      database.prepare("INSERT INTO users (id,email,display_name,status,created_at,updated_at) VALUES (?,?,?,'active',?,?)").bind(userId, staff.email, staff.name, now, now),
      database.prepare("INSERT INTO memberships (id,user_id,organization_id,role,status,created_at,updated_at) VALUES (?,?,?,'employee','active',?,?)").bind(crypto.randomUUID(), userId, identity.organizationId, now, now),
      database.prepare("INSERT INTO access_roles (id,organization_id,name,description,color,permissions_json,location_scope_json,archived,created_by_user_id,created_at,updated_at) VALUES (?,?,'Reviewer','','#245fce',?,'[]',0,?,?,?)").bind(roleId, identity.organizationId, JSON.stringify(permissions), identity.userId, now, now),
      database.prepare("INSERT INTO team_members (id,organization_id,user_id,role_id,first_name,last_name,email,employee_code,primary_location_id,permitted_locations_json,status,remote_login,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,'Review','Reader',?,'REV-READ',?,?,'active',1,?,?,?)").bind(crypto.randomUUID(), identity.organizationId, userId, roleId, staff.email, identity.locationId, JSON.stringify([identity.locationId]), identity.userId, now, now),
    ]);
    assert.equal((await get(staff)).reviews.length, 1);
    await database.prepare("UPDATE access_roles SET permissions_json=? WHERE id=?").bind(JSON.stringify(permissions.filter(p => p !== "metrics.profit")), roleId).run();
    assert.equal((await get(staff)).reviews.length, 0);
    assert.equal((await patch({ id: review.id, version: 6, status: "monitoring", note: "No longer authorized" }, crypto.randomUUID(), staff)).status, 404);
    const staffTasks = await dispatch(worker, environment, "/api/v1/tasks", staff);
    assert.equal(staffTasks.status, 200);
    assert.equal((await staffTasks.json()).tasks.length, 0);
    assert.equal((await dispatch(worker, environment, "/api/v1/tasks", { ...staff, method: "PATCH", body: { id: taskId, status: "done" } })).status, 404);
    // A second location makes this account location-limited. Saved organization-wide notes are withheld.
    await seedReportLocation(database, identity.organizationId, "Another location");
    const scoped = await get(staff);
    assert.equal(scoped.historyAvailable, false); assert.equal(scoped.canReview, false);
    assert.equal((await capture(selection, staff)).status, 403);
    // Missing identity and cross-origin writes cannot reach the review model.
    assert.equal((await worker.fetch(new Request(origin + "/api/v1/opportunities"), environment, context)).status, 401);
    assert.equal((await worker.fetch(new Request(origin + "/api/v1/opportunities", { method: "POST", headers: { ...identityHeaders(identity.owner.email, "", true), origin: "https://foreign.example" }, body: JSON.stringify(selection) }), environment, context)).status, 403);
    // A full review page and a larger task list stay below D1's per-query
    // parameter budget. A replay still returns its record outside that page.
    for (let start = 0; start < 120; start += 20) {
      const statements = [];
      for (let offset = 0; offset < 20; offset++) {
        const id = crypto.randomUUID(), rule = `history-${start + offset}`;
        statements.push(database.prepare(`INSERT INTO opportunity_reviews (id,organization_id,scope_key,scope_label,rule_id,period_start,period_end,snapshot_json,required_permissions_json,status,version,mutation_key,created_by_user_id,created_at,updated_at)
          SELECT ?,organization_id,scope_key,scope_label,?,period_start,period_end,snapshot_json,required_permissions_json,'reviewed',1,?,created_by_user_id,created_at,updated_at+100 FROM opportunity_reviews WHERE id=?`).bind(id, rule, id, review.id));
        statements.push(database.prepare(`INSERT INTO opportunity_review_events (id,review_id,organization_id,version,status,note,actor_user_id,created_at)
          SELECT id,id,organization_id,1,'reviewed','Historical review',created_by_user_id,updated_at FROM opportunity_reviews WHERE id=?`).bind(id));
        statements.push(database.prepare(`INSERT INTO workspace_tasks (organization_id,title,detail,status,priority,assignee,source_type,source_ref,idempotency_key,created_by_user_id,created_at,updated_at)
          SELECT organization_id,title,detail,status,priority,assignee,'decision',?,?,created_by_user_id,created_at,updated_at FROM workspace_tasks WHERE id=?`).bind(`opportunity:${id}`, id, taskId));
      }
      await database.batch(statements);
    }
    const fullPage = await get();
    assert.equal(fullPage.reviews.length, 100);
    assert.ok(fullPage.reviews.every(row => row.events.length === 1 && row.task));
    const fullTasks = await dispatch(worker, environment, "/api/v1/tasks", identity.owner);
    assert.equal(fullTasks.status, 200, await fullTasks.clone().text());
    assert.equal((await fullTasks.json()).tasks.length, 121);
    const oldReplay = await patch(snooze, snoozeKey);
    assert.equal(oldReplay.status, 200, await oldReplay.clone().text());
    assert.equal((await oldReplay.json()).review.id, review.id);
    assert.equal((await database.prepare("PRAGMA foreign_key_check").all()).results.length, 0);
    await database.prepare("DELETE FROM workspaces WHERE id=?").bind(identity.organizationId).run();
    assert.equal((await database.prepare("SELECT count(*) count FROM opportunity_reviews WHERE organization_id=?").bind(identity.organizationId).first()).count, 0);
    assert.equal((await database.prepare("SELECT count(*) count FROM opportunity_review_events WHERE organization_id=?").bind(identity.organizationId).first()).count, 0);
  } finally { await dispose(); }
});
