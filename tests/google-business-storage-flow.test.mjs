import assert from "node:assert/strict";
import test from "node:test";
import { createEnvironment, createReportWorkspace, dispatch } from "./helpers/retail-worker-fixture.mjs";
import { encryptIntegrationSecret } from "../server/integrations/lightspeed.ts";
import { advisorMarketingEvidence } from "../server/marketing-evidence.ts";

// Disposable local D1 and synthetic provider responses only. Requires a current build.
test("Business Profile stays on demand while mixed-source samples and legacy-data exclusions hold", { timeout: 120000 }, async (t) => {
  const { worker, environment, database, dispose } = await createEnvironment();
  const originalFetch = globalThis.fetch;
  const previousRuntime = globalThis.__vanteloqEnv;
  const env = { ...environment, INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString("base64") };
  const calls = [];
  try {
    const { owner, userId, organizationId, locationId } = await createReportWorkspace(worker, env, database, "gbp-storage");
    const other = await createReportWorkspace(worker, env, database, "gbp-other");
    const now = Math.floor(Date.now() / 1000);
    const day = new Date(Date.now() - 4 * 86400000).toISOString().slice(0, 10);
    const [year, month, date] = day.split("-").map(Number);
    const connectionId = crypto.randomUUID(), profileId = crypto.randomUUID(), analyticsId = crypto.randomUUID();
    globalThis.__vanteloqEnv = env;
    const access = await encryptIntegrationSecret("fictional-google-access");
    const refresh = await encryptIntegrationSecret("fictional-google-refresh");
    await database.batch([
      database.prepare("INSERT INTO integration_connections(id,organization_id,provider,status,data_promotion_status,resource_selection_version,created_at,updated_at) VALUES (?,?,'google','connected','staging',1,?,?)").bind(connectionId, organizationId, now, now),
      database.prepare("INSERT INTO integration_secrets(id,organization_id,provider,connection_id,access_token_ciphertext,refresh_token_ciphertext,token_expires_at,created_at,updated_at) VALUES (?,?,'google',?,?,?,?,?,?)").bind(crypto.randomUUID(), organizationId, connectionId, access, refresh, now + 3600, now, now),
      ...[[profileId, "google_business_profile", "accounts/123/locations/456"], [analyticsId, "google_analytics", "properties/123"]].map(([id, dataset, resource]) => database.prepare("INSERT INTO marketing_resource_selections(id,organization_id,connection_id,provider,dataset,external_resource_ref,external_resource_name,scope_kind,local_location_id,selected_by_user_id,selected_at,created_at,updated_at) VALUES (?,?,?,'google',?,?,?,'location',?,?,?,?,?)").bind(id, organizationId, connectionId, dataset, resource, dataset, locationId, userId, now, now, now)),
      database.prepare("INSERT INTO marketing_daily_metrics(id,resource_selection_id,metric_date,metric_key,value_milli,source_event_id,created_at,updated_at) VALUES ('legacy-gbp',?,?,'gbp_call_clicks',99999000,'legacy-gbp-event',?,?)").bind(profileId, day, now - 60 * 86400, now - 60 * 86400),
    ]);
    const legacy = await database.prepare("SELECT * FROM marketing_daily_metrics WHERE id='legacy-gbp'").first();
    const get = (path, user = owner) => dispatch(worker, env, path, user);
    const post = (path, body) => dispatch(worker, env, path, { ...owner, method: "POST", body });
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init), url = new URL(request.url);
      if (url.origin === env.SUPABASE_URL) return originalFetch(input, init);
      calls.push(request.url);
      assert.equal(request.headers.get("authorization"), "Bearer fictional-google-access");
      if (url.origin === "https://analyticsdata.googleapis.com") return Response.json({ rows: [{ dimensionValues: [{ value: day.replaceAll("-", "") }], metricValues: ["10", "5", "2", "20"].map(value => ({ value })) }] });
      if (url.origin === "https://businessprofileperformance.googleapis.com") return Response.json({ multiDailyMetricTimeSeries: [{ dailyMetricTimeSeries: [
        { dailyMetric: "CALL_CLICKS", timeSeries: { datedValues: [{ date: { year, month, day: date }, value: "8" }] } },
        { dailyMetric: "WEBSITE_CLICKS", timeSeries: { datedValues: [{ date: { year, month, day: date }, value: "13" }] } },
      ] }] });
      throw new Error(`Unexpected provider request blocked: ${url.origin}`);
    };

    await t.test("selected on-demand report works without durable promotion and preserves Google values", async () => {
      const sources = await get("/api/v1/marketing/reports");
      assert.equal(sources.status, 200, await sources.clone().text());
      const listing = (await sources.json()).sources;
      assert.equal(listing.find(source => source.id === profileId).status, "ready");
      assert.equal(listing.find(source => source.id === profileId).lastSyncAt, null);
      assert.equal(listing.find(source => source.id === analyticsId).status, "approval_required");
      const response = await get(`/api/v1/marketing/reports?selectionId=${profileId}&view=daily&days=7`);
      assert.equal(response.status, 200, await response.clone().text());
      const body = await response.json();
      assert.equal(body.storage, "not_persisted");
      assert.match(response.headers.get("cache-control"), /no-store/);
      assert.deepEqual(body.report.rows, [{ label: day, values: { CALL_CLICKS: 8, WEBSITE_CLICKS: 13 } }]);
      assert.deepEqual(body.report.totals, {});
      assert.equal(body.report.previous, null);
      assert.deepEqual(await database.prepare("SELECT * FROM marketing_daily_metrics WHERE id='legacy-gbp'").first(), legacy);
      const denied = await get(`/api/v1/marketing/reports?selectionId=${profileId}&view=daily&days=7`, other.owner);
      assert.equal(denied.status, 404, await denied.clone().text());
      const wrongLocation = await get(`/api/v1/marketing/reports?selectionId=${profileId}&location=${other.locationId}&view=daily&days=7`);
      assert.ok([403, 404].includes(wrongLocation.status), await wrongLocation.clone().text());
    });

    let sample;
    await t.test("mixed sample stores only Analytics, preserves legacy GBP rows, and remains approvable", async () => {
      calls.length = 0;
      const response = await post("/api/v1/integrations/google/sync", { connectionId, mode: "sample", expectedSelectionVersion: 1 });
      assert.equal(response.status, 200, await response.clone().text());
      sample = await response.json();
      assert.equal(sample.run.recordsImported, 4);
      assert.equal(sample.run.warningCount, 0);
      assert.deepEqual(sample.resourceResults.map(resource => resource.resourceSelectionId), [analyticsId]);
      assert.ok(calls.every(url => !url.includes("businessprofileperformance.googleapis.com")));
      assert.deepEqual(await database.prepare("SELECT * FROM marketing_daily_metrics WHERE id='legacy-gbp'").first(), legacy);
      assert.equal((await database.prepare("SELECT COUNT(*) count FROM marketing_daily_metrics WHERE resource_selection_id=?").bind(profileId).first()).count, 1);
      const integrations = await get("/api/v1/integrations");
      assert.equal(integrations.status, 200, await integrations.clone().text());
      const connection = (await integrations.json()).integrations.find(provider => provider.id === "google").connections.find(connection => connection.id === connectionId);
      assert.equal(connection.sampleReady, true);
      assert.equal(connection.sampleRunId, sample.run.id);
      const approved = await post("/api/v1/integrations", { action: "approve_data", connectionId, confirmed: true, sampleRunId: sample.run.id, expectedSelectionVersion: 1 });
      assert.equal(approved.status, 200, await approved.clone().text());
    });

    await t.test("legacy GBP values cannot enter growth or AI evidence and incremental sync leaves them unchanged", async () => {
      const growth = await get(`/api/v1/growth?location=${locationId}`);
      assert.equal(growth.status, 200, await growth.clone().text());
      const body = await growth.json();
      assert.ok(body.measurementSeries.some(row => row.dataset === "google_analytics"));
      assert.ok(body.measurementSeries.every(row => row.dataset !== "google_business_profile"));
      assert.doesNotMatch(JSON.stringify(body), /gbp_call_clicks|99999000/);
      globalThis.__vanteloqEnv = env;
      const evidence = await advisorMarketingEvidence({ organizationId, userId, role: "owner", authSubject: `test-user:${owner.email}` }, locationId);
      assert.ok(evidence.sources.some(source => source.dataset === "google_analytics"));
      assert.doesNotMatch(JSON.stringify(evidence), /google_business_profile|gbp_call_clicks|99999000/);
      const response = await post("/api/v1/integrations/google/sync", { connectionId, mode: "incremental", expectedSelectionVersion: 1 });
      assert.equal(response.status, 200, await response.clone().text());
      assert.deepEqual(await database.prepare("SELECT * FROM marketing_daily_metrics WHERE id='legacy-gbp'").first(), legacy);
    });

    await t.test("a Business Profile-only selection cannot start durable sync, and revoked connections cannot report", async () => {
      await database.prepare("DELETE FROM marketing_resource_selections WHERE id=?").bind(analyticsId).run();
      const integrations = await get("/api/v1/integrations");
      assert.equal(integrations.status, 200, await integrations.clone().text());
      const provider = (await integrations.json()).integrations.find(provider => provider.id === "google");
      assert.equal(provider.connections.find(connection => connection.id === connectionId).syncEligible, false);
      assert.equal(provider.providerReadiness.syncEligible, false);
      calls.length = 0;
      const response = await post("/api/v1/integrations/google/sync", { connectionId, mode: "incremental", expectedSelectionVersion: 1 });
      assert.equal(response.status, 409, await response.clone().text());
      assert.equal((await response.json()).error.code, "MARKETING_RESOURCE_SELECTION_REQUIRED");
      assert.deepEqual(calls, []);
      await database.prepare("UPDATE integration_connections SET status='revoked' WHERE id=?").bind(connectionId).run();
      const denied = await get(`/api/v1/marketing/reports?selectionId=${profileId}&view=daily&days=7`);
      assert.equal(denied.status, 409, await denied.clone().text());
      assert.deepEqual(calls, []);
    });
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.__vanteloqEnv = previousRuntime;
    await dispose();
  }
});
