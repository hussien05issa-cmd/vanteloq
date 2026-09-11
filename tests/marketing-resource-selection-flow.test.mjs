import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";
import { Miniflare } from "miniflare";
import { registerSupabaseTestServer } from "./helpers/supabase-loopback-transport.mjs";
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
      SUPABASE_URL: registerSupabaseTestServer(authAddress.port),
    SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
    GOOGLE_MARKETING_CLIENT_ID: "google-client",
    GOOGLE_MARKETING_CLIENT_SECRET: "google-secret",
    GOOGLE_MARKETING_REDIRECT_URI: `${origin}/api/v1/integrations/google/callback`,
    INTEGRATION_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  };
  return { authServer, miniflare, database, worker, environment };
}

async function dispatch(worker, environment, path, { method = "GET", body, cookie = "" } = {}) {
  return worker.fetch(new Request(`${origin}${path}`, {
    method,
    headers: { ...identityHeaders(method !== "GET"), cookie },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  }), environment, executionContext);
}

test("exact marketing resources remain versioned, approval-bound, separated, and locally deletable", async () => {
  const { authServer, miniflare, database, worker, environment } = await createEnvironment();
  let restoreFetch = globalThis.fetch;
  const providerCalls = [];
  const openaiPayloads = [];
  let unavailableGoogleService = null;
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
      terms_version: "2026-09-05",
      privacy_policy_version: "2026-09-10",
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
      if (url === "https://api.openai.com/v1/responses") {
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture-openai-key");
        const payload = JSON.parse(String(init?.body));
        assert.equal(payload.store, false);
        openaiPayloads.push(payload);
        return Response.json({status: "completed", output: [{type: "message", content: [{type: "output_text", text: "Independent fixture financial analysis."}]}]});
      }
      if (!url.includes("googleapis.com")) return restoreFetch(input, init);
      providerCalls.push(url);
      if (url.startsWith("https://generativelanguage.googleapis.com/")) throw new Error("Removed AI provider must never receive evidence");
      if (url === "https://oauth2.googleapis.com/token") return Response.json({
        access_token: "google-access-token",
        refresh_token: "google-refresh-token",
        expires_in: 3600,
        scope: "openid email https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/business.manage",
      });
      if (url === "https://openidconnect.googleapis.com/v1/userinfo") return Response.json({ sub: "google-account-123", name: "Main Google account" });
      if (url === "https://www.googleapis.com/webmasters/v3/sites") return unavailableGoogleService === "search" ? new Response("Unavailable", { status: 503 }) : Response.json({ siteEntry: [{ siteUrl: "sc-domain:example.ca" }, { siteUrl: "sc-domain:unselected.ca" }] });
      if (url.startsWith("https://analyticsadmin.googleapis.com/v1beta/accountSummaries")) return Response.json({ accountSummaries: [{ propertySummaries: [{ property: "properties/123", displayName: "Main website" }, { property: "properties/999", displayName: "Unselected website" }] }] });
      if (url.startsWith("https://mybusinessaccountmanagement.googleapis.com/v1/accounts")) return unavailableGoogleService === "business" ? new Response("Unavailable", { status: 403 }) : Response.json({ accounts: [{ name: "accounts/123", accountName: "Main business" }] });
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
    const callback = await dispatch(worker, environment, `/api/v1/integrations/google/callback?state=${encodeURIComponent(state)}&code=test-code`, { cookie: authorize.headers.get("set-cookie").split(";")[0] });
    assert.equal(callback.status, 303, await callback.clone().text());
    const callbackConnection = await database.prepare(`SELECT status, last_error_code lastErrorCode FROM integration_connections WHERE id = ?`).bind(authorization.connectionId).first();
    assert.equal(new URL(callback.headers.get("location")).searchParams.get("connection"), "connected", JSON.stringify({ callbackConnection, providerCalls }));

    const discovered = await dispatch(worker, environment, "/api/v1/integrations/google/resources", { method: "POST", body: { action: "discover", connectionId: authorization.connectionId } });
    assert.equal(discovered.status, 200, await discovered.clone().text());
    const resourceList = await discovered.json();
    assert.equal(resourceList.selectionVersion, 0);
    assert.equal(resourceList.datasets.flatMap((entry) => entry.resources).length, 5);
    unavailableGoogleService = "business";
    const partialDiscovery = await dispatch(worker, environment, "/api/v1/integrations/google/resources", { method: "POST", body: { action: "discover", connectionId: authorization.connectionId } });
    assert.equal(partialDiscovery.status, 200, await partialDiscovery.clone().text());
    const partialResources = await partialDiscovery.json();
    assert.equal(partialResources.selectionBlocked, false);
    assert.equal(partialResources.datasets.find((entry) => entry.dataset === "google_business_profile").status, "unavailable");
    assert.equal(partialResources.datasets.find((entry) => entry.dataset === "google_analytics").resources.length, 2);

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
    unavailableGoogleService = null;
    const pendingSourcesResponse = await dispatch(worker, environment, "/api/v1/marketing/reports");
    assert.equal(pendingSourcesResponse.status, 200, await pendingSourcesResponse.clone().text());
    const pendingSources = (await pendingSourcesResponse.json()).sources;
    assert.equal(pendingSources.length, 2);
    assert.ok(pendingSources.every((source) => source.status === "approval_required"));
    const prematureReport = await dispatch(worker, environment, `/api/v1/marketing/reports?selectionId=${pendingSources[0].id}`);
    assert.equal(prematureReport.status, 409);

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
    const selectionsBeforeFailure = await database.prepare("SELECT * FROM marketing_resource_selections WHERE connection_id = ? ORDER BY id").bind(authorization.connectionId).all();
    const metricsBeforeFailure = await database.prepare("SELECT * FROM marketing_daily_metrics WHERE resource_selection_id IN (SELECT id FROM marketing_resource_selections WHERE connection_id = ?) ORDER BY id").bind(authorization.connectionId).all();
    unavailableGoogleService = "search";
    const interruptedDiscovery = await dispatch(worker, environment, "/api/v1/integrations/google/resources", { method: "POST", body: { action: "discover", connectionId: authorization.connectionId } });
    assert.equal(interruptedDiscovery.status, 200, await interruptedDiscovery.clone().text());
    assert.equal((await interruptedDiscovery.json()).selectionBlocked, true);
    const unsafeReplacement = await dispatch(worker, environment, "/api/v1/integrations/google/resources", {
      method: "POST",
      body: { action: "replace", connectionId: authorization.connectionId, expectedSelectionVersion: 1, selections: [
        { dataset: "google_analytics", externalResourceRef: "properties/123", scopeKind: "location", localLocationId: location.id },
      ] },
    });
    assert.equal(unsafeReplacement.status, 409, await unsafeReplacement.clone().text());
    assert.equal((await unsafeReplacement.json()).error.code, "MARKETING_DISCOVERY_INCOMPLETE");
    assert.deepEqual((await database.prepare("SELECT * FROM marketing_resource_selections WHERE connection_id = ? ORDER BY id").bind(authorization.connectionId).all()).results, selectionsBeforeFailure.results);
    assert.deepEqual((await database.prepare("SELECT * FROM marketing_daily_metrics WHERE resource_selection_id IN (SELECT id FROM marketing_resource_selections WHERE connection_id = ?) ORDER BY id").bind(authorization.connectionId).all()).results, metricsBeforeFailure.results);
    unavailableGoogleService = null;

    const growth = await dispatch(worker, environment, `/api/v1/growth?location=${encodeURIComponent(location.id)}`);
    assert.equal(growth.status, 200, await growth.clone().text());
    const growthBody = await growth.json();
    assert.equal(growthBody.journeyCoverage.journeys, 0);
    assert.equal(growthBody.journeyCoverage.revenueAvailable, true);
    assert.equal(growthBody.canManage, true);
    const calendarDraft = { type: "marketing_calendar", title: "Review search landing page", channel: "website", eventType: "audit", startDate: "2026-09-08", dueDate: "2026-09-15", objective: "Review qualified enquiries", notes: "Owner: Test owner. Compare the same source and period." };
    const invalidDate = await dispatch(worker, environment, "/api/v1/growth", { method: "POST", body: { ...calendarDraft, startDate: "2026-02-30" } });
    assert.equal(invalidDate.status, 400);
    const savedPlan = await dispatch(worker, environment, "/api/v1/growth", { method: "POST", body: calendarDraft });
    assert.equal(savedPlan.status, 201, await savedPlan.clone().text());
    const planId = (await savedPlan.json()).id;
    const invalidStatus = await dispatch(worker, environment, "/api/v1/growth", { method: "POST", body: { type: "marketing_calendar_status", id: planId, status: "published" } });
    assert.equal(invalidStatus.status, 400);
    for (const status of ["in_progress", "completed", "planned", "cancelled"]) {
      const changed = await dispatch(worker, environment, "/api/v1/growth", { method: "POST", body: { type: "marketing_calendar_status", id: planId, status } });
      assert.equal(changed.status, 200, await changed.clone().text());
    }
    const missingPlan = await dispatch(worker, environment, "/api/v1/growth", { method: "POST", body: { type: "marketing_calendar_status", id: "other-tenant-plan", status: "completed" } });
    assert.equal(missingPlan.status, 404);
    const savedCalendar = await dispatch(worker, environment, "/api/v1/growth");
    const savedEntry = (await savedCalendar.json()).calendar.find((entry) => entry.id === planId);
    assert.equal(savedEntry.notes, calendarDraft.notes);
    assert.equal(savedEntry.status, "cancelled");
    const anonymousGrowth = await worker.fetch(new Request(`${origin}/api/v1/growth`), environment, executionContext);
    assert.equal(anonymousGrowth.status, 401);
    const crossOriginSave = await worker.fetch(new Request(`${origin}/api/v1/growth`, { method: "POST", headers: { ...identityHeaders(true), origin: "https://untrusted.example" }, body: JSON.stringify(calendarDraft) }), environment, executionContext);
    assert.equal(crossOriginSave.status, 403);
    assert.equal(new Set(growthBody.measurementSeries.map((row) => row.selectionId)).size, 2);
    assert.ok(growthBody.measurementSeries.every((row) => row.resourceName && row.localLocationId === location.id));
    const readySourcesResponse = await dispatch(worker, environment, `/api/v1/marketing/reports?location=${location.id}`);
    assert.equal(readySourcesResponse.status, 200, await readySourcesResponse.clone().text());
    const readySources = (await readySourcesResponse.json()).sources;
    assert.equal(readySources.length, 2);
    assert.ok(readySources.every((source) => source.status === "ready"));
    const searchSource = readySources.find((source) => source.dataset === "google_search_console");
    assert.ok(searchSource);
    const reportResponse = await dispatch(worker, environment, `/api/v1/marketing/reports?selectionId=${searchSource.id}&location=${location.id}&view=queries&days=28`);
    assert.equal(reportResponse.status, 200, await reportResponse.clone().text());
    assert.match(reportResponse.headers.get("cache-control"), /no-store/);
    const reportBody = await reportResponse.json();
    assert.equal(reportBody.report.dataset, "google_search_console");
    assert.equal(reportBody.report.totals.ctr, 10);
    assert.equal(reportBody.storage, "not_persisted");
    assert.doesNotMatch(JSON.stringify(reportBody), /google-access-token|google-refresh-token|encrypted/);
    const missingSource = await dispatch(worker, environment, "/api/v1/marketing/reports?selectionId=other-tenant-resource");
    assert.equal(missingSource.status, 404);
    const invalidView = await dispatch(worker, environment, `/api/v1/marketing/reports?selectionId=${searchSource.id}&view=campaigns`);
    assert.equal(invalidView.status, 400);
    const unauthorizedReport = await worker.fetch(new Request(`${origin}/api/v1/marketing/reports`), environment, executionContext);
    assert.equal(unauthorizedReport.status, 401);
    environment.OPENAI_API_KEY = "fixture-openai-key";
    const advisor = await dispatch(worker, environment, "/api/v1/advisor/chat", { method: "POST", body: { question: "What does our marketing evidence show?", dataUseAccepted: true, noticeVersion: "vanteloq-ai-v6-openai", privacyPolicyVersion: "2026-09-10" } });
    assert.equal(advisor.status, 200, await advisor.clone().text());
    const advisorBody = await advisor.json();
    assert.equal(advisorBody.status, "answered");
    assert.equal(openaiPayloads.length, 1);
    const advisorText = openaiPayloads[0].input;
    assert.match(advisorText, /analytics_sessions/);
    assert.match(advisorText, /search_clicks/);
    assert.match(advisorText, /comparisonComplete/);
    assert.doesNotMatch(advisorText, /sc-domain:example.ca|properties\/123|google-access-token/);

    const aiQuestion = { question: "Which KPIs need attention?", conversationId: advisorBody.conversationId, dataUseAccepted: true, noticeVersion: "vanteloq-ai-v6-openai", privacyPolicyVersion: "2026-09-10" };
    const noConsent = await dispatch(worker, environment, "/api/v1/advisor/chat", {method: "POST", body: {...aiQuestion, dataUseAccepted: false}});
    assert.equal(noConsent.status, 409);
    const staleConsent = await dispatch(worker, environment, "/api/v1/advisor/chat", {method: "POST", body: {...aiQuestion, noticeVersion: "gemini-evidence-advisor-v2-marketing"}});
    assert.equal(staleConsent.status, 409);
    const sensitive = await dispatch(worker, environment, "/api/v1/advisor/chat", {method: "POST", body: {...aiQuestion, question: "Analyze jane@example.com"}});
    assert.equal(sensitive.status, 400);
    assert.equal(openaiPayloads.length, 1);
    environment.OPENAI_API_KEY = undefined;
    const protectedData = await dispatch(worker, environment, "/api/v1/advisor/chat", {method: "POST", body: aiQuestion});
    assert.equal((await protectedData.json()).status, "configuration_required");
    assert.equal(openaiPayloads.length, 1);
    environment.OPENAI_API_KEY = "fixture-openai-key";
    for (const provider of ["gemini", "both"]) {
      const removed = await dispatch(worker, environment, "/api/v1/advisor/chat", {method: "POST", body: {...aiQuestion, provider}});
      assert.equal(removed.status, 400);
      assert.equal((await removed.json()).error.code, "ADVISOR_PROVIDER_INVALID");
    }
    assert.equal(openaiPayloads.length, 1, "Rejected modes must not collect or forward evidence");
    assert.match(openaiPayloads[0].input, /Conversation memory: \[\]/);
    assert.doesNotMatch(openaiPayloads[0].input, /sc-domain:example.ca|properties\/123|fixture-openai-key|google-access-token/);
    const aiConsents = await database.prepare("SELECT DISTINCT provider FROM integration_consents WHERE notice_version = ? ORDER BY provider").bind("vanteloq-ai-v6-openai").all();
    assert.deepEqual(aiConsents.results.map(row => row.provider), ["openai"]);

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
