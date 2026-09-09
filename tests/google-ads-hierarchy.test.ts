import assert from "node:assert/strict";
import test from "node:test";
import { discoverGoogleMarketingResourceStatus, syncGoogleMarketing } from "../server/integrations/marketing";
import { fetchMarketingReport } from "../server/integrations/marketing-reporting";
import { discoverGoogleAdsAccounts, resolveGoogleAdsAccount } from "../server/integrations/google-ads-access";

const runtime = globalThis as typeof globalThis & { __vanteloqEnv?: Record<string, string> };
const manager = "customers/1111111111";
const child = "customers/2222222222";

test("manager-only access discovers the child and routes its reports without a global manager", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = runtime.__vanteloqEnv;
  runtime.__vanteloqEnv = { GOOGLE_ADS_DEVELOPER_TOKEN: "fixture", GOOGLE_ADS_LOGIN_CUSTOMER_ID: "9999999999" };
  const reportHeaders: Array<string | null> = [];
  let isTest = true;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.ok(["www.googleapis.com", "analyticsadmin.googleapis.com", "mybusinessaccountmanagement.googleapis.com", "googleads.googleapis.com"].includes(url.hostname));
    if (url.pathname.endsWith("customers:listAccessibleCustomers")) return Response.json({ resourceNames: [manager] });
    if (url.pathname.endsWith(`${manager}/googleAds:search`)) {
      if (JSON.parse(String(init?.body)).query.includes("FROM customer LIMIT")) return Response.json({ results: [{ customer: { resourceName: manager, manager: true } }] });
      assert.match(JSON.parse(String(init?.body)).query, /FROM customer_client/);
      assert.equal(new Headers(init?.headers).get("login-customer-id"), "1111111111");
      return Response.json({ results: [
        { customerClient: { clientCustomer: manager, manager: true, descriptiveName: "Fixture manager" } },
        { customerClient: { clientCustomer: child, manager: false, testAccount: isTest, descriptiveName: "Fixture client" } },
      ] });
    }
    if (url.pathname.includes(`${child}/googleAds:`)) {
      reportHeaders.push(new Headers(init?.headers).get("login-customer-id"));
      const rows = { results: [{ customer: { currencyCode: "CAD" }, segments: { date: "2026-09-01" }, metrics: { impressions: "10", clicks: "2", costMicros: "3000000" } }] };
      return Response.json(url.pathname.endsWith("searchStream") ? [rows] : rows);
    }
    if (url.hostname !== "googleads.googleapis.com") return Response.json({});
    throw new Error("Unexpected fixture request");
  };
  try {
    const discovery = await discoverGoogleMarketingResourceStatus("fixture-oauth");
    const ads = discovery.resources.filter((item) => item.dataset === "google_ads");
    assert.deepEqual(ads.map((item) => item.externalResourceRef), [child]);
    assert.match(ads[0].name, /Fixture client.*Test account/);
    const selection = { id: "selected", provider: "google" as const, dataset: "google_ads" as const, externalResourceRef: child, scopeKind: "organization" as const, localLocationId: null };
    const report = await fetchMarketingReport("fixture-oauth", selection, "daily", 7);
    assert.equal(report.totals.spend, 3);
    assert.ok(report.limitations.some((message) => message.includes("test account")));
    await assert.rejects(syncGoogleMarketing("fixture-oauth", [selection]), { code: "GOOGLE_MARKETING_SYNC_FAILED" });
    assert.equal(reportHeaders.length, 3, "Test accounts must not import production metrics");
    isTest = false;
    const snapshot = await syncGoogleMarketing("fixture-oauth", [selection]);
    assert.equal(snapshot.warnings.length, 0);
    assert.ok(reportHeaders.length >= 4);
    assert.ok(reportHeaders.every((value) => value === "1111111111"));
  } finally {
    globalThis.fetch = originalFetch;
    runtime.__vanteloqEnv = originalEnv;
  }
});

test("Ads access handles nested clients, pagination, duplicate roots and direct access without cross-user state", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = runtime.__vanteloqEnv;
  runtime.__vanteloqEnv = { GOOGLE_ADS_DEVELOPER_TOKEN: "fixture", GOOGLE_ADS_LOGIN_CUSTOMER_ID: "9999999999" };
  let secondUser = false;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("listAccessibleCustomers")) {
      assert.equal(new Headers(init?.headers).get("login-customer-id"), null);
      return Response.json({ resourceNames: secondUser ? [] : [manager, manager, child] });
    }
    const body = JSON.parse(String(init?.body));
    if (url.includes(manager) && body.query.includes("FROM customer LIMIT")) return Response.json({ results: [{ customer: { resourceName: manager, manager: true } }] });
    if (url.includes(manager)) return Response.json(body.pageToken ? {
      results: [{ customerClient: { clientCustomer: child } }],
    } : {
      results: [{ customerClient: { clientCustomer: "customers/3333333333", manager: true } }], nextPageToken: "page-2",
    });
    assert.ok(!body.query.includes("FROM customer_client"), "CustomerClient only exists for managers");
    return Response.json({ results: [{ customer: { resourceName: child, descriptiveName: "Direct client" } }] });
  };
  try {
    const directory = await discoverGoogleAdsAccounts("first-user");
    assert.equal(directory.length, 1);
    assert.equal(directory[0].loginCustomerId, null);
    secondUser = true;
    await assert.rejects(resolveGoogleAdsAccount("second-user", child), { code: "GOOGLE_ADS_ACCOUNT_UNAVAILABLE" });
  } finally { globalThis.fetch = originalFetch; runtime.__vanteloqEnv = originalEnv; }
});

test("Ads discovery fails closed on denied branches, malformed references, oversized results and repeated pages", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = runtime.__vanteloqEnv;
  runtime.__vanteloqEnv = { GOOGLE_ADS_DEVELOPER_TOKEN: "fixture" };
  try {
    for (const scenario of ["denied", "reference", "oversized", "pagination", "removed"]) {
      let calls = 0;
      globalThis.fetch = async (input, init) => {
        calls += 1;
        assert.equal(new URL(String(input)).hostname, "googleads.googleapis.com");
        if (String(input).endsWith("listAccessibleCustomers")) return Response.json({ resourceNames: [manager] });
        if (JSON.parse(String(init?.body)).query.includes("FROM customer LIMIT")) return Response.json({ results: [{ customer: { resourceName: manager, manager: true } }] });
        if (scenario === "denied") return new Response("private-provider-details", { status: 403 });
        if (scenario === "reference") return Response.json({ results: [{ customerClient: { clientCustomer: "https://untrusted.invalid" } }] });
        if (scenario === "oversized") return Response.json({ results: Array.from({ length: 501 }, () => ({ customerClient: { clientCustomer: child } })) });
        if (scenario === "removed") return Response.json({ results: [{ customerClient: { clientCustomer: manager, manager: true } }] });
        return Response.json({ results: [], nextPageToken: "same-page" });
      };
      await assert.rejects(resolveGoogleAdsAccount("fixture", child), (error: Error) => !error.message.includes("private-provider-details"));
      assert.ok(calls <= 4);
    }
  } finally { globalThis.fetch = originalFetch; runtime.__vanteloqEnv = originalEnv; }
});

test("Google approval failures provide a safe actionable reason, never the provider's raw message", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = runtime.__vanteloqEnv;
  runtime.__vanteloqEnv = { GOOGLE_ADS_DEVELOPER_TOKEN: "fixture" };
  globalThis.fetch = async (input) => String(input).endsWith("listAccessibleCustomers")
    ? Response.json({ resourceNames: [manager] })
    : Response.json({ error: { message: "private-provider-message", details: [{ errors: [{ errorCode: { authorizationError: "DEVELOPER_TOKEN_PROHIBITED" }, message: "private-provider-message" }] }] } }, { status: 403 });
  try {
    await assert.rejects(discoverGoogleAdsAccounts("fixture"), (error: Error & { code?: string }) => error.code === "GOOGLE_ADS_TOKEN_PROJECT_REQUIRED" && !error.message.includes("private-provider"));
  } finally { globalThis.fetch = originalFetch; runtime.__vanteloqEnv = originalEnv; }
});

test("Ads failure diagnostics identify the stage without logging provider or customer data", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = runtime.__vanteloqEnv;
  const originalWarn = console.warn;
  const logs: unknown[][] = [];
  const privateValue = "private-token-email-account-message";
  runtime.__vanteloqEnv = { GOOGLE_ADS_DEVELOPER_TOKEN: privateValue };
  console.warn = (...args: unknown[]) => { logs.push(args); };
  try {
    const cases = [
      { phase: "list", reason: "transport", status: null, respond: () => { throw new Error(privateValue); } },
      { phase: "list", reason: "json_invalid", status: 200, respond: () => new Response(privateValue) },
      { phase: "list", reason: "provider_rejected", status: 429, respond: () => Response.json({ error: { status: "RESOURCE_EXHAUSTED", message: privateValue } }, { status: 429 }) },
      { phase: "list", reason: "roots_invalid", status: null, respond: () => Response.json({ resourceNames: [privateValue] }) },
      { phase: "identity", reason: "identity_invalid", status: null, respond: (url: string) => url.endsWith("listAccessibleCustomers") ? Response.json({ resourceNames: [manager] }) : Response.json({ results: [{ customer: { resourceName: privateValue } }] }) },
      { phase: "identity", reason: "provider_rejected", status: 403, respond: (url: string) => url.endsWith("listAccessibleCustomers") ? Response.json({ resourceNames: [manager] }) : Response.json({ error: { status: privateValue, message: privateValue, details: [{ errors: [{ errorCode: { authorizationError: privateValue } }] }] } }, { status: 403 }) },
    ];
    for (const scenario of cases) {
      logs.length = 0;
      globalThis.fetch = async (input) => scenario.respond(String(input));
      await assert.rejects(discoverGoogleAdsAccounts(privateValue), { code: "GOOGLE_ADS_DIRECTORY_UNAVAILABLE" });
      assert.equal(logs.length, 1, "One bounded server diagnostic per failure");
      assert.equal(logs[0][0], "[ads-directory-diagnostic]");
      const detail = JSON.parse(String(logs[0][1]));
      assert.deepEqual(Object.keys(detail).sort(), ["httpStatus", "phase", "providerStatus", "reason", "setupCode"]);
      assert.equal(detail.phase, scenario.phase);
      assert.equal(detail.reason, scenario.reason);
      assert.equal(detail.httpStatus, scenario.status);
      assert.equal(detail.providerStatus, scenario.status === 429 ? "RESOURCE_EXHAUSTED" : null);
      assert.equal(detail.setupCode, null);
      assert.ok(!JSON.stringify(logs).includes(privateValue));
      assert.ok(!JSON.stringify(logs).includes(manager));
    }
  } finally { globalThis.fetch = originalFetch; runtime.__vanteloqEnv = originalEnv; console.warn = originalWarn; }
});

test("Ads diagnostics never change a successful result or replace the original safe error", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = runtime.__vanteloqEnv;
  const originalWarn = console.warn;
  let calls = 0;
  runtime.__vanteloqEnv = { GOOGLE_ADS_DEVELOPER_TOKEN: "fixture" };
  console.warn = () => { calls += 1; throw new Error("logger failure"); };
  try {
    globalThis.fetch = async () => Response.json({ resourceNames: [] });
    assert.deepEqual(await discoverGoogleAdsAccounts("fixture"), []);
    assert.equal(calls, 0);
    globalThis.fetch = async () => Response.json({ error: { details: [{ errors: [{ errorCode: { authorizationError: "DEVELOPER_TOKEN_PROHIBITED" } }] }] } }, { status: 403 });
    await assert.rejects(discoverGoogleAdsAccounts("fixture"), { code: "GOOGLE_ADS_TOKEN_PROJECT_REQUIRED" });
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; runtime.__vanteloqEnv = originalEnv; console.warn = originalWarn; }
});
