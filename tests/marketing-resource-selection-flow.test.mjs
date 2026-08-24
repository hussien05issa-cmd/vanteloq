import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";
import { Miniflare } from "miniflare";
import { activateTestSubscription } from "./helpers/subscription-fixture.mjs";

const origin = "https://vanteloq.example";
const owner = { email: "marketing-flow-owner@example.invalid", name: "Marketing Flow Owner" };
const executionContext = { waitUntil() {}, passThroughOnException() {} };

function identityHeaders(write = false) {
  const payload = Buffer.from(JSON.stringify({ email: owner.email, aal: "aal2", session_id: `session:${owner.email}` })).toString("base64url");
  const headers = { accept: "application/json", authorization: `Bearer test.${payload}.signature` };
  if (write) {
    headers["content-type"] = "application/json";
    headers.origin = origin;
    headers["sec-fetch-site"] = "same-origin";
  }
  return headers;
}

function onboardingBody() {
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  return {
    ownerName: owner.name,
    businessName: "Marketing Resource Flow",
    legalName: "Marketing Resource Flow Ltd.",
    businessEmail: owner.email,
    phone: "",
    website: "",
    industry: "Retail",
    country: "CA",
    province: "AB",
    city: "Edmonton",
    address: "1 Marketing Avenue",
    postalCode: "T5A 1A1",
    emailNotifications: true,
    timezone: "America/Edmonton",
    currency: "CAD",
    fiscalYearStart: "January",
    taxNumber: "",
    hours: days.map((day) => ({ day, open: "10:00", close: "18:00", closed: false })),
    sourceMode: "connect_later",
    selectedPos: "",
    legalAccepted: true,
    termsVersion: "2026-08-24",
    privacyPolicyVersion: "2026-08-24",
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
      user_metadata: { full_name: owner.name },
    }));
  });
  await new Promise((resolve) => authServer.listen(0, "127.0.0.1", resolve));
  const authAddress = authServer.address();
  assert.ok(authAddress && typeof authAddress !== "string");
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: `vanteloq-marketing-selection-${crypto.randomUUID()}` },
  });
  const database = await miniflare.getD1Database("DB");
  const migrations = (await readdir(new URL("../drizzle/", import.meta.url))).filter((file) => /^\d{4}.*\.sql$/.test(file)).sort();
  for (const migration of migrations) {
    const sql = await readFile(new URL(`../drizzle/${migration}`, import.meta.url), "utf8");
    for (const statement of sql.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) await database.prepare(statement).run();
  }
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("marketing-selection-flow", crypto.randomUUID());
  const worker = (await import(workerUrl.href)).default;
  const environment = {
    DB: database,
    SUPABASE_URL: `http://127.0.0.1:${authAddress.port}`,
    SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
    GOOGLE_MARKETING_CLIENT_ID: "google-client",
    GOOGLE_MARKETING_CLIENT_SECRET: "google-secret",
    GOOGLE_MARKETING_REDIRECT_URI: `${origin}/api/v1/integrations/google/callback`,
    INTEGRATION_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  };
  return { authServer, miniflare, database, worker, environment };
}

async function dispatch(worker, environment, path, { method = "GET", body } = {}) {
  return worker.fetch(new Request(`${origin}${path}`, {
    method,
    headers: identityHeaders(method !== "GET"),
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  }), environment, executionContext);
}

test("exact marketing resources remain versioned, approval-bound, separated, and locally deletable", async () => {
  const { authServer, miniflare, database, worker, environment } = await createEnvironment();
  let restoreFetch = globalThis.fetch;
  const providerCalls = [];
  try {
    const onboarding = await dispatch(worker, environment, "/api/v1/onboarding", { method: "POST", body: onboardingBody() });
    assert.equal(onboarding.status, 201, await onboarding.clone().text());
    const legalAcceptance = await database.prepare(`
      SELECT terms_version, privacy_policy_version, notice_version, acceptance_source,
             source_hash, user_agent_hash, request_id
      FROM legal_acceptances
      LIMIT 1
    `).first();
    assert.ok(legalAcceptance);
    assert.deepEqual(legalAcceptance, {
      terms_version: "2026-08-24",
      privacy_policy_version: "2026-08-24",
      notice_version: "account-creation-v2",
      acceptance_source: "onboarding_review",
      source_hash: null,
      user_agent_hash: null,
      request_id: legalAcceptance.request_id,
    });
    assert.equal(typeof legalAcceptance.request_id, "string");
    restoreFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (!url.includes("googleapis.com")) return restoreFetch(input, init);
      providerCalls.push(url);
      if (url === "https://oauth2.googleapis.com/token") return Response.json({
        access_token: "google-access-token",
        refresh_token: "google-refresh-token",
        expires_in: 3600,
        scope: "openid email https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/business.manage",
      });
      if (url === "https://openidconnect.googleapis.com/v1/userinfo") return Response.json({ sub: "google-account-123", name: "Main Google account" });
      if (url === "https://www.googleapis.com/webmasters/v3/sites") return Response.json({ siteEntry: [{ siteUrl: "sc-domain:example.ca" }, { siteUrl: "sc-domain:unselected.ca" }] });
      if (url.startsWith("https://analyticsadmin.googleapis.com/v1beta/accountSummaries")) return Response.json({ accountSummaries: [{ propertySummaries: [{ property: "properties/123", displayName: "Main website" }, { property: "properties/999", displayName: "Unselected website" }] }] });
      if (url.startsWith("https://mybusinessaccountmanagement.googleapis.com/v1/accounts")) return Response.json({ accounts: [{ name: "accounts/123", accountName: "Main business" }] });
      if (url.startsWith("https://mybusinessbusinessinformation.googleapis.com/v1/accounts/123/locations")) return Response.json({ locations: [{ name: "locations/456", title: "Main store", storeCode: "EDM" }] });
      if (url.includes("sites/sc-domain%3Aexample.ca/searchAnalytics/query")) return Response.json({ rows: [{ keys: ["2026-08-01"], clicks: 4, impressions: 40, ctr: 0.1, position: 3.5 }] });
      if (url.includes("properties/123:runReport")) return Response.json({ rows: [{ dimensionValues: [{ value: "20260801" }], metricValues: [{ value: "10" }, { value: "8" }, { value: "2" }, { value: "20" }] }] });
      if (url.startsWith("https://oauth2.googleapis.com/revoke")) return new Response("revocation unavailable", { status: 503 });
      throw new Error(`Unexpected Google request: ${url}`);
    };
    const identity = await database.prepare(`SELECT m.organization_id organizationId FROM users u JOIN memberships m ON m.user_id = u.id WHERE u.email = ?`).bind(owner.email).first();
    const location = await database.prepare(`SELECT id FROM organization_locations WHERE organization_id = ? AND status = 'active' LIMIT 1`).bind(identity.organizationId).first();
    assert.ok(identity?.organizationId && location?.id);
    await activateTestSubscription(database, identity.organizationId);

    const authorize = await dispatch(worker, environment, "/api/v1/integrations/google/authorize", { method: "POST", body: {} });
    assert.equal(authorize.status, 200, await authorize.clone().text());
    const authorization = await authorize.json();
    const state = new URL(authorization.authorizationUrl).searchParams.get("state");
    assert.ok(state && authorization.connectionId);
    const callback = await dispatch(worker, environment, `/api/v1/integrations/google/callback?state=${encodeURIComponent(state)}&code=test-code`);
    assert.equal(callback.status, 303, await callback.clone().text());
    const callbackConnection = await database.prepare(`SELECT status, last_error_code lastErrorCode FROM integration_connections WHERE id = ?`).bind(authorization.connectionId).first();
    assert.equal(new URL(callback.headers.get("location")).searchParams.get("connection"), "connected", JSON.stringify({ callbackConnection, providerCalls }));

    const discovered = await dispatch(worker, environment, "/api/v1/integrations/google/resources", { method: "POST", body: { action: "discover", connectionId: authorization.connectionId } });
    assert.equal(discovered.status, 200, await discovered.clone().text());
    const resourceList = await discovered.json();
    assert.equal(resourceList.selectionVersion, 0);
    assert.equal(resourceList.datasets.flatMap((entry) => entry.resources).length, 5);

    const replaced = await dispatch(worker, environment, "/api/v1/integrations/google/resources", {
      method: "POST",
      body: {
        action: "replace",
        connectionId: authorization.connectionId,
        expectedSelectionVersion: 0,
        selections: [
          { dataset: "google_search_console", externalResourceRef: "sc-domain:example.ca", scopeKind: "location", localLocationId: location.id },
          { dataset: "google_analytics", externalResourceRef: "properties/123", scopeKind: "location", localLocationId: location.id },
        ],
      },
    });
    assert.equal(replaced.status, 200, await replaced.clone().text());
    const replacement = await replaced.json();
    assert.equal(replacement.selectionVersion, 1);

    const staleReplace = await dispatch(worker, environment, "/api/v1/integrations/google/resources", { method: "POST", body: { action: "replace", connectionId: authorization.connectionId, expectedSelectionVersion: 0, selections: [] } });
    assert.equal(staleReplace.status, 409);

    const sample = await dispatch(worker, environment, "/api/v1/integrations/google/sync", { method: "POST", body: { connectionId: authorization.connectionId, mode: "sample", expectedSelectionVersion: 1 } });
    assert.equal(sample.status, 200, await sample.clone().text());
    const sampleBody = await sample.json();
    assert.equal(sampleBody.run.warningCount, 0);
    assert.ok(sampleBody.run.recordsImported > 0);
    assert.ok(providerCalls.some((url) => url.includes("sc-domain%3Aexample.ca/searchAnalytics/query")));
    assert.ok(providerCalls.some((url) => url.includes("properties/123:runReport")));
    assert.ok(providerCalls.every((url) => !url.includes("unselected.ca") && !url.includes("properties/999:runReport")));

    const integrations = await dispatch(worker, environment, "/api/v1/integrations");
    assert.equal(integrations.status, 200, await integrations.clone().text());
    const integrationBody = await integrations.json();
    const googleConnection = integrationBody.integrations.find((entry) => entry.id === "google").connections.find((entry) => entry.id === authorization.connectionId);
    assert.equal(googleConnection.syncEligible, true);
    assert.equal(googleConnection.sampleReady, true);
    assert.equal(googleConnection.sampleRunId, sampleBody.run.id);

    const approved = await dispatch(worker, environment, "/api/v1/integrations", { method: "POST", body: { action: "approve_data", connectionId: authorization.connectionId, confirmed: true, sampleRunId: sampleBody.run.id, expectedSelectionVersion: 1 } });
    assert.equal(approved.status, 200, await approved.clone().text());

    const growth = await dispatch(worker, environment, `/api/v1/growth?location=${encodeURIComponent(location.id)}`);
    assert.equal(growth.status, 200, await growth.clone().text());
    const growthBody = await growth.json();
    assert.equal(new Set(growthBody.measurementSeries.map((row) => row.selectionId)).size, 2);
    assert.ok(growthBody.measurementSeries.every((row) => row.resourceName && row.localLocationId === location.id));

    const originalDatabaseBinding = environment.DB;
    let raceInjected = false;
    environment.DB = new Proxy(originalDatabaseBinding, {
      get(target, property) {
        if (property === "batch") {
          return async (statements) => {
            if (!raceInjected) {
              raceInjected = true;
              await database.prepare(`UPDATE integration_connections
                SET resource_selection_version = resource_selection_version + 1,
                    sync_lease_owner = NULL, sync_lease_expires_at = NULL
                WHERE id = ?`).bind(authorization.connectionId).run();
            }
            return database.batch(statements);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const racedReplacement = await dispatch(worker, environment, "/api/v1/integrations/google/resources", {
      method: "POST",
      body: {
        action: "replace",
        connectionId: authorization.connectionId,
        expectedSelectionVersion: 1,
        selections: [{ dataset: "google_analytics", externalResourceRef: "properties/999", scopeKind: "location", localLocationId: location.id }],
      },
    });
    environment.DB = originalDatabaseBinding;
    assert.equal(racedReplacement.status, 409, await racedReplacement.clone().text());
    const retainedSelections = await database.prepare(`SELECT external_resource_ref resourceRef
      FROM marketing_resource_selections WHERE connection_id = ? ORDER BY external_resource_ref`).bind(authorization.connectionId).all();
    assert.deepEqual(retainedSelections.results.map((row) => row.resourceRef), ["properties/123", "sc-domain:example.ca"]);

    const disconnected = await dispatch(worker, environment, "/api/v1/integrations/google/disconnect", { method: "POST", body: { connectionId: authorization.connectionId } });
    assert.equal(disconnected.status, 200, await disconnected.clone().text());
    assert.equal((await disconnected.json()).providerRevoked, false);
    const retained = await database.prepare(`SELECT external_account_ref externalRef, external_account_name externalName, scopes_json scopes, status FROM integration_connections WHERE id = ?`).bind(authorization.connectionId).first();
    assert.deepEqual(retained, { externalRef: null, externalName: null, scopes: "[]", status: "revoked" });
    assert.equal((await database.prepare("SELECT COUNT(*) count FROM marketing_resource_selections WHERE connection_id = ?").bind(authorization.connectionId).first()).count, 0);
    assert.equal((await database.prepare("SELECT COUNT(*) count FROM integration_secrets WHERE connection_id = ?").bind(authorization.connectionId).first()).count, 0);
    const selectionAudit = await database.prepare("SELECT details_json details FROM audit_events WHERE action = 'integration.marketing_resources_selected' AND resource_id = ?").bind(authorization.connectionId).first();
    assert.doesNotMatch(selectionAudit.details, /sc-domain:|properties\//);
  } finally {
    globalThis.fetch = restoreFetch;
    authServer.closeAllConnections();
    await new Promise((resolve) => authServer.close(resolve));
    await miniflare.dispose();
  }
});
