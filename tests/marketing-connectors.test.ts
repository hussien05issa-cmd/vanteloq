import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  GOOGLE_MARKETING_SCOPES,
  META_MARKETING_SCOPES,
  buildMarketingAuthorizationUrl,
  discoverGoogleMarketingResources,
  discoverMetaMarketingResources,
  marketingReadiness,
  syncGoogleMarketing,
  syncMetaMarketing,
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
  assert.deepEqual([...META_MARKETING_SCOPES], ["ads_read"]);
  assert.equal(google.searchParams.get("state"), state);
  assert.equal(google.searchParams.get("access_type"), "offline");
  for (const scope of GOOGLE_MARKETING_SCOPES) assert.ok(google.searchParams.get("scope")?.includes(scope));
  assert.equal(meta.pathname, "/v25.0/dialog/oauth");
  assert.equal(meta.searchParams.get("state"), state);
  assert.equal(meta.searchParams.get("scope"), "ads_read");
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

test("Google resource discovery fails closed when either required dataset is unavailable", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/webmasters/v3/sites")) return Response.json({ error: "unavailable" }, { status: 503 });
    if (url.includes("/accountSummaries")) return Response.json({
      accountSummaries: [{ propertySummaries: [{ property: "properties/123", displayName: "Main website" }] }],
    });
    throw new Error(`Unexpected provider request: ${url}`);
  };
  try {
    await assert.rejects(
      discoverGoogleMarketingResources("google-token"),
      (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "GOOGLE_SEARCH_CONSOLE_FAILED"),
    );
  } finally {
    globalThis.fetch = originalFetch;
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
    assert.deepEqual(google.map((resource) => resource.externalResourceRef), ["sc-domain:example.ca", "properties/111", "properties/222"]);
    assert.deepEqual(meta.map((resource) => resource.externalResourceRef), ["act_111", "act_222"]);
    assert.ok(calls.every((url) => !url.startsWith("https://untrusted.example/")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
});
