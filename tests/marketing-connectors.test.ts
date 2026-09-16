import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  GOOGLE_MARKETING_SCOPES,
  META_MARKETING_SCOPES,
  buildMarketingAuthorizationUrl,
  discoverGoogleMarketingResources,
  discoverGoogleMarketingResourceStatus,
  exchangeMarketingAuthorizationCode,
  discoverMetaMarketingResources,
  fetchMetaCampaignDirectory,
  fetchGoogleBusinessReviews,
  marketingReadiness,
  publishGoogleBusinessReviewReply,
  syncGoogleMarketing,
  syncMetaMarketing,
  updateMetaCampaign,
} from "../server/integrations/marketing.ts";

const runtime = globalThis as typeof globalThis & { __vanteloqEnv?: Record<string, string> };

describe("marketing connector contracts", { concurrency: false }, () => {

test("Google and Meta readiness identifies hosted configuration requirements", () => {
  runtime.__vanteloqEnv = {};
  assert.deepEqual(marketingReadiness("google").missingConfiguration, [
    "GOOGLE_MARKETING_CLIENT_ID",
    "GOOGLE_MARKETING_CLIENT_SECRET",
    "GOOGLE_MARKETING_REDIRECT_URI",
    "INTEGRATION_ENCRYPTION_KEY",
  ]);
  assert.deepEqual(marketingReadiness("meta").missingConfiguration, [
    "META_MARKETING_APP_ID",
    "META_MARKETING_APP_SECRET",
    "META_MARKETING_REDIRECT_URI",
    "INTEGRATION_ENCRYPTION_KEY",
  ]);
});

test("marketing authorization uses state-bound provider URLs and least-purpose scopes", () => {
  runtime.__vanteloqEnv = {
    GOOGLE_MARKETING_CLIENT_ID: "google-client",
    GOOGLE_MARKETING_CLIENT_SECRET: "google-secret",
    GOOGLE_MARKETING_REDIRECT_URI: "https://vanteloq.com/api/v1/integrations/google/callback",
    META_MARKETING_APP_ID: "meta-app",
    META_MARKETING_APP_SECRET: "meta-secret",
    META_MARKETING_REDIRECT_URI: "https://vanteloq.com/api/v1/integrations/meta/callback",
    META_GRAPH_API_VERSION: "v25.0",
    INTEGRATION_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  };
  const state = "A".repeat(43);
  const google = new URL(buildMarketingAuthorizationUrl("google", state));
  const meta = new URL(buildMarketingAuthorizationUrl("meta", state));
  assert.deepEqual([...META_MARKETING_SCOPES], ["ads_read", "ads_management"]);
  assert.equal(google.searchParams.get("state"), state);
  assert.equal(google.searchParams.get("access_type"), "offline");
  for (const scope of GOOGLE_MARKETING_SCOPES) assert.ok(google.searchParams.get("scope")?.includes(scope));
  assert.equal(meta.pathname, "/v25.0/dialog/oauth");
  assert.equal(meta.searchParams.get("state"), state);
  assert.equal(meta.searchParams.get("scope"), "ads_read,ads_management");
});

test("Meta campaign review and owner-confirmed changes remain bound to the selected ad account", async () => {
  runtime.__vanteloqEnv = {
    META_MARKETING_APP_ID: "meta-app",
    META_MARKETING_APP_SECRET: "meta-secret",
    META_MARKETING_REDIRECT_URI: "https://vanteloq.com/api/v1/integrations/meta/callback",
    META_GRAPH_API_VERSION: "v25.0",
    INTEGRATION_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  };
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes("act_456/campaigns")) return Response.json({ data: [{ id: "789", name: "Local awareness", status: "ACTIVE", effective_status: "ACTIVE", objective: "OUTCOME_AWARENESS", daily_budget: "2500", budget_remaining: "1800", updated_time: "2026-08-15T12:00:00Z" }] });
    if (url.includes("/act_456?")) return Response.json({ id: "act_456", name: "Main account", currency: "CAD", timezone_name: "America/Edmonton" });
    if (url.includes("/789?") && init?.method !== "POST") return Response.json({ id: "789", name: "Local awareness", account_id: "456", status: "ACTIVE", daily_budget: "2500" });
    if (url.includes("/789?") && init?.method === "POST") return Response.json({ success: true });
    throw new Error(`Unexpected provider request: ${url}`);
  };
  try {
    const directory = await fetchMetaCampaignDirectory("meta-token", "act_456");
    assert.equal(directory.accountName, "Main account");
    assert.equal(directory.currencyExponent, 2);
    assert.equal(directory.campaigns[0]?.dailyBudgetMinor, 2500);
    const result = await updateMetaCampaign({ accessToken: "meta-token", adAccountRef: "act_456", campaignId: "789", expectedCampaignName: "Local awareness", status: "PAUSED" });
    assert.equal(result.previousStatus, "ACTIVE");
    assert.equal(result.status, "PAUSED");
    const update = calls.find((call) => call.init?.method === "POST");
    assert.ok(update);
    assert.equal(String(update.init?.body), "status=PAUSED");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("marketing sync calls only exact selected resources and preserves selection lineage", async () => {
  runtime.__vanteloqEnv = {
    META_MARKETING_APP_ID: "meta-app",
    META_MARKETING_APP_SECRET: "meta-secret",
    META_MARKETING_REDIRECT_URI: "https://vanteloq.com/api/v1/integrations/meta/callback",
    META_GRAPH_API_VERSION: "v25.0",
    INTEGRATION_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  };
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("searchAnalytics/query")) return Response.json({ rows: [{ keys: ["2026-08-01"], clicks: 4, impressions: 40, ctr: 0.1, position: 3.5 }] });
    if (url.includes("properties/123:runReport")) return Response.json({ rows: [{ dimensionValues: [{ value: "20260801" }], metricValues: [{ value: "10" }, { value: "8" }, { value: "2" }, { value: "20" }] }] });
    if (url.includes("act_456/insights")) return Response.json({ data: [{ date_start: "2026-08-01", impressions: "100", reach: "80", clicks: "9", inline_link_clicks: "7", spend: "12.50", ctr: "7", cpc: "1.39" }] });
    throw new Error(`Unexpected provider request: ${url}`);
  };
  try {
    const google = await syncGoogleMarketing("google-token", [
      { id: "search-selection", provider: "google", dataset: "google_search_console", externalResourceRef: "sc-domain:example.ca", scopeKind: "organization", localLocationId: null },
      { id: "analytics-selection", provider: "google", dataset: "google_analytics", externalResourceRef: "properties/123", scopeKind: "location", localLocationId: "north" },
    ]);
    const meta = await syncMetaMarketing("meta-token", [
      { id: "meta-selection", provider: "meta", dataset: "meta_ads", externalResourceRef: "act_456", scopeKind: "location", localLocationId: "north" },
    ]);
    assert.ok(calls.some((url) => url.includes("sites/sc-domain%3Aexample.ca/searchAnalytics/query")));
    assert.ok(calls.some((url) => url.includes("properties/123:runReport")));
    assert.ok(calls.some((url) => url.includes("act_456/insights")));
    assert.ok(calls.every((url) => !url.endsWith("/sites") && !url.includes("accountSummaries") && !url.includes("/me/adaccounts")));
    assert.deepEqual(new Set(google.metrics.map((row) => row.resourceSelectionId)), new Set(["search-selection", "analytics-selection"]));
    assert.deepEqual(new Set(meta.metrics.map((row) => row.resourceSelectionId)), new Set(["meta-selection"]));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Business Profile performance, review access, reply confirmation target, and Google Ads reporting preserve provider lineage", async () => {
  runtime.__vanteloqEnv = {
    GOOGLE_ADS_DEVELOPER_TOKEN: "developer-token",
    GOOGLE_ADS_LOGIN_CUSTOMER_ID: "123-456-7890",
    GOOGLE_ADS_API_VERSION: "v25",
  };
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; method: string; headers: Headers; body: string }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    requests.push({ url, method, headers: new Headers(init?.headers), body: typeof init?.body === "string" ? init.body : "" });
    if (url.endsWith("customers:listAccessibleCustomers")) return Response.json({ resourceNames: ["customers/9876543210"] });
    if (url.endsWith("customers/9876543210/googleAds:search")) return Response.json({ results: [{ customer: { resourceName: "customers/9876543210" } }] });
    if (url.includes("businessprofileperformance.googleapis.com")) return Response.json({
      multiDailyMetricTimeSeries: [{
        dailyMetricTimeSeries: [{
          dailyMetric: "CALL_CLICKS",
          timeSeries: { datedValues: [{ date: { year: 2026, month: 8, day: 1 }, value: "12" }] },
        }],
      }],
    });
    if (url.includes("googleAds:searchStream")) return Response.json([{ results: [{
      segments: { date: "2026-08-01" },
      metrics: { impressions: "100", clicks: "10", costMicros: "12500000", conversions: "2", conversionsValue: "30" },
    }] }]);
    if (url.endsWith("/reviews?pageSize=50&orderBy=updateTime+desc")) return Response.json({
      reviews: [{
        name: "accounts/123/locations/456/reviews/789",
        reviewer: { displayName: "Customer" },
        starRating: "FIVE",
        comment: "Great service",
        createTime: "2026-08-01T12:00:00Z",
        updateTime: "2026-08-01T12:00:00Z",
      }],
    });
    if (url.endsWith("/reviews/789/reply")) return Response.json({ comment: "Thank you for visiting.", updateTime: "2026-08-02T12:00:00Z" });
    throw new Error(`Unexpected provider request: ${url}`);
  };
  try {
    const snapshot = await syncGoogleMarketing("google-token", [
      { id: "profile-selection", provider: "google", dataset: "google_business_profile", externalResourceRef: "accounts/123/locations/456", scopeKind: "location", localLocationId: "north" },
      { id: "ads-selection", provider: "google", dataset: "google_ads", externalResourceRef: "customers/9876543210", scopeKind: "organization", localLocationId: null },
    ]);
    const reviews = await fetchGoogleBusinessReviews("google-token", "accounts/123/locations/456");
    const reply = await publishGoogleBusinessReviewReply("google-token", reviews.reviews[0]!.name, "Thank you for visiting.");

    assert.ok(snapshot.metrics.some((metric) => metric.resourceSelectionId === "profile-selection" && metric.metricKey === "gbp_call_clicks" && metric.valueMilli === 12_000));
    assert.ok(snapshot.metrics.some((metric) => metric.resourceSelectionId === "ads-selection" && metric.metricKey === "google_ads_spend" && metric.valueMilli === 12_500));
    assert.equal(reviews.reviews[0]?.reviewerName, "Customer");
    assert.equal(reply.comment, "Thank you for visiting.");
    const adsRequest = requests.find((request) => request.url.includes("googleAds:searchStream"));
    assert.equal(adsRequest?.headers.get("developer-token"), null);
    assert.equal(adsRequest?.headers.get("login-customer-id"), null, "Direct access must not inherit a platform-wide manager");
    const replyRequest = requests.find((request) => request.url.endsWith("/reviews/789/reply"));
    assert.equal(replyRequest?.method, "PUT");
    assert.deepEqual(JSON.parse(replyRequest?.body ?? "{}"), { comment: "Thank you for visiting." });
  } finally {
    globalThis.fetch = originalFetch;
    runtime.__vanteloqEnv = {};
  }
});

test("Google resource discovery isolates unavailable datasets without losing healthy services", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/webmasters/v3/sites")) return Response.json({ error: "unavailable" }, { status: 503 });
    if (url.includes("/accountSummaries")) return Response.json({
      accountSummaries: [{ propertySummaries: [{ property: "properties/123", displayName: "Main website" }] }],
    });
    if (url.includes("mybusinessaccountmanagement.googleapis.com")) return Response.json({ accounts: [] });
    throw new Error(`Unexpected provider request: ${url}`);
  };
  try {
    const result = await discoverGoogleMarketingResourceStatus("google-token");
    assert.deepEqual(result.resources.map((row) => row.externalResourceRef), ["properties/123"]);
    assert.equal(result.datasets.find((row) => row.dataset === "google_search_console")?.status, "unavailable");
    assert.equal(result.datasets.find((row) => row.dataset === "google_analytics")?.status, "available");
    assert.equal(result.datasets.find((row) => row.dataset === "google_business_profile")?.status, "available");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Google discovery never represents a total provider failure as an empty successful account", async () => {
  const originalFetch = globalThis.fetch;
  runtime.__vanteloqEnv = { GOOGLE_ADS_DEVELOPER_TOKEN: "test-token" };
  globalThis.fetch = async () => Response.json({ error: "provider detail must not leak" }, { status: 403 });
  try {
    await assert.rejects(discoverGoogleMarketingResourceStatus("google-token"), { code: "GOOGLE_DISCOVERY_UNAVAILABLE" });
  } finally {
    globalThis.fetch = originalFetch;
    runtime.__vanteloqEnv = {};
  }
});

test("Google accepts granular measurement consent and the canonical email scope", async () => {
  runtime.__vanteloqEnv = {
    GOOGLE_MARKETING_CLIENT_ID: "google-client",
    GOOGLE_MARKETING_CLIENT_SECRET: "google-secret",
    GOOGLE_MARKETING_REDIRECT_URI: "https://vanteloq.com/api/v1/integrations/google/callback",
    INTEGRATION_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  };
  const originalFetch = globalThis.fetch;
  let scope = "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/analytics.readonly";
  globalThis.fetch = async () => Response.json({ access_token: "access", refresh_token: "refresh", expires_in: 3600, scope });
  try {
    const token = await exchangeMarketingAuthorizationCode("google", "authorization-code");
    assert.ok(token.scopes.includes("https://www.googleapis.com/auth/analytics.readonly"));
    assert.ok(!token.scopes.includes("https://www.googleapis.com/auth/business.manage"));
    scope = "openid email";
    await assert.rejects(exchangeMarketingAuthorizationCode("google", "authorization-code"), { code: "GOOGLE_SCOPES_INCOMPLETE" });
    scope = "https://www.googleapis.com/auth/analytics.readonly";
    await assert.rejects(exchangeMarketingAuthorizationCode("google", "authorization-code"), { code: "GOOGLE_SCOPES_INCOMPLETE" });
  } finally {
    globalThis.fetch = originalFetch;
    runtime.__vanteloqEnv = {};
  }
});

test("resource discovery paginates fixed Google Analytics and Meta account endpoints", async () => {
  runtime.__vanteloqEnv = {
    META_MARKETING_APP_ID: "meta-app",
    META_MARKETING_APP_SECRET: "meta-secret",
    META_MARKETING_REDIRECT_URI: "https://vanteloq.com/api/v1/integrations/meta/callback",
    META_GRAPH_API_VERSION: "v25.0",
    INTEGRATION_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  };
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url.toString());
    if (url.pathname === "/webmasters/v3/sites") return Response.json({ siteEntry: [{ siteUrl: "sc-domain:example.ca" }] });
    if (url.pathname === "/v1beta/accountSummaries") {
      if (url.searchParams.get("pageToken") === "ga-page-2") return Response.json({
        accountSummaries: [{ propertySummaries: [{ property: "properties/222", displayName: "Second property" }] }],
      });
      return Response.json({
        accountSummaries: [{ propertySummaries: [{ property: "properties/111", displayName: "First property" }] }],
        nextPageToken: "ga-page-2",
      });
    }
    if (url.hostname === "mybusinessaccountmanagement.googleapis.com" && url.pathname === "/v1/accounts") {
      return Response.json({ accounts: [{ name: "accounts/123", accountName: "Main business" }] });
    }
    if (url.hostname === "mybusinessbusinessinformation.googleapis.com" && url.pathname === "/v1/accounts/123/locations") {
      return Response.json({ locations: [{ name: "locations/456", title: "Main store", storeCode: "EDM" }] });
    }
    if (url.pathname === "/v25.0/me/adaccounts") {
      if (url.searchParams.get("after") === "meta-page-2") return Response.json({
        data: [{ id: "act_222", name: "Second account" }],
      });
      return Response.json({
        data: [{ id: "act_111", name: "First account" }],
        paging: { cursors: { after: "meta-page-2" }, next: "https://untrusted.example/should-not-be-followed" },
      });
    }
    throw new Error(`Unexpected provider request: ${url}`);
  };
  try {
    const google = await discoverGoogleMarketingResources("google-token");
    const meta = await discoverMetaMarketingResources("meta-token");
    assert.deepEqual(google.map((resource) => resource.externalResourceRef), ["sc-domain:example.ca", "properties/111", "properties/222", "accounts/123/locations/456"]);
    assert.deepEqual(meta.map((resource) => resource.externalResourceRef), ["act_111", "act_222"]);
    assert.ok(calls.every((url) => !url.startsWith("https://untrusted.example/")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
});
