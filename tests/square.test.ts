import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  buildSquareCustomerSearchBody,
  buildSquareAuthorizationUrl,
  exchangeSquareCode,
  record,
  records,
  refreshSquareToken,
  squareReadiness,
  squareLineNetSalesCents,
  beginSquareSyncWindow,
  buildSquareOrderSearchBody,
  verifySquareWebhook,
} from "../server/integrations/square.ts";

const webhookUrl = "https://connectors.vanteloq.com/api/v1/integrations/square/webhook";
(globalThis as typeof globalThis & { __vanteloqEnv?: Record<string, string> }).__vanteloqEnv = {
  SQUARE_APPLICATION_ID: "square-test-app",
  SQUARE_APPLICATION_SECRET: "square-test-secret",
  SQUARE_REDIRECT_URI: "https://connectors.vanteloq.com/api/v1/integrations/square/callback",
  SQUARE_ENV: "sandbox",
  SQUARE_WEBHOOK_SIGNATURE_KEY: "square-webhook-secret",
  SQUARE_WEBHOOK_URL: webhookUrl,
  INTEGRATION_ENCRYPTION_KEY: Buffer.from(Uint8Array.from({ length: 32 }, (_, index) => index + 1)).toString("base64"),
};

test("Square authorization is read-only, state-bound, and does not expose secrets", () => {
  const state = "a".repeat(43);
  const url = new URL(buildSquareAuthorizationUrl(state));
  assert.equal(url.origin, "https://connect.squareupsandbox.com");
  assert.equal(url.pathname, "/oauth2/authorize");
  assert.equal(url.searchParams.get("client_id"), "square-test-app");
  assert.equal(url.searchParams.get("redirect_uri"), "https://connectors.vanteloq.com/api/v1/integrations/square/callback");
  assert.equal(url.searchParams.get("state"), state);
  assert.equal(url.searchParams.get("session"), "false");
  assert.deepEqual(new Set(url.searchParams.get("scope")?.split(" ")), new Set([
    "MERCHANT_PROFILE_READ", "ORDERS_READ", "PAYMENTS_READ", "CUSTOMERS_READ", "ITEMS_READ", "INVENTORY_READ",
  ]));
  assert.doesNotMatch(url.toString(), /square-test-secret/);
});

test("Square readiness exposes the real adapter boundary", () => {
  const readiness = squareReadiness();
  assert.equal(readiness.adapterBuilt, true);
  assert.equal(readiness.credentialsConfigured, true);
  assert.equal(readiness.environment, "sandbox");
  assert.equal(readiness.webhookConfigured, true);
  assert.equal(readiness.mode, "read_only_staged_sync");
  assert.equal(readiness.dataPromotionEnabled, false);
});

test("Square authorization codes and refresh tokens use the official token endpoint", async () => {
  const requests: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    return Response.json({
      access_token: requests.length === 1 ? "access-one" : "access-two",
      refresh_token: requests.length === 1 ? "refresh-one" : "refresh-two",
      merchant_id: "merchant-1",
      expires_at: "2026-09-01T00:00:00Z",
    });
  }) as typeof fetch;

  const exchanged = await exchangeSquareCode("seller-code", fetcher);
  const refreshed = await refreshSquareToken("refresh-one", fetcher);
  assert.equal(exchanged.accessToken, "access-one");
  assert.equal(refreshed.refreshToken, "refresh-two");
  assert.equal(requests[0].url, "https://connect.squareupsandbox.com/oauth2/token");
  assert.equal(requests[0].headers.get("Square-Version"), "2026-07-15");
  assert.deepEqual(requests[0].body, {
    client_id: "square-test-app",
    client_secret: "square-test-secret",
    grant_type: "authorization_code",
    code: "seller-code",
    redirect_uri: "https://connectors.vanteloq.com/api/v1/integrations/square/callback",
  });
  assert.deepEqual(requests[1].body, {
    client_id: "square-test-app",
    client_secret: "square-test-secret",
    grant_type: "refresh_token",
    refresh_token: "refresh-one",
  });
});

test("Square webhook validation binds the exact notification URL and body", async () => {
  const body = JSON.stringify({ merchant_id: "merchant-1", type: "payment.updated" });
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("square-webhook-secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${webhookUrl}${body}`)));
  const signature = Buffer.from(digest).toString("base64");
  assert.equal(await verifySquareWebhook(body, signature), true);
  assert.equal(await verifySquareWebhook(`${body} `, signature), false);
  assert.equal(await verifySquareWebhook(body, null), false);
});

test("Square response shaping rejects arrays as records and empty collection entries", () => {
  assert.deepEqual(record({ id: "one" }), { id: "one" });
  assert.deepEqual(record(["not-a-record"]), {});
  assert.deepEqual(records([{ id: "one" }, null, [], {}]), [{ id: "one" }]);
});

test("Square customer sync uses the supported creation-time sort field", () => {
  assert.deepEqual(buildSquareCustomerSearchBody("next-page"), {
    limit: 100,
    cursor: "next-page",
    query: { sort: { field: "CREATED_AT", order: "ASC" } },
  });
  assert.equal(buildSquareCustomerSearchBody().cursor, undefined);
});

test("Square line revenue excludes tax without deducting discounts twice", () => {
  assert.equal(squareLineNetSalesCents({
    total_money: { amount: 10_500 }, total_tax_money: { amount: 500 },
    gross_sales_money: { amount: 10_000 },
  }), 10_000);
  assert.equal(squareLineNetSalesCents({
    total_money: { amount: 9_450 }, total_tax_money: { amount: 450 },
    total_discount_money: { amount: 1_000 }, gross_sales_money: { amount: 10_000 },
  }), 9_000);
  // Inclusive tax is still removed exactly once from the amount collected.
  assert.equal(squareLineNetSalesCents({
    total_money: { amount: 10_500 }, total_tax_money: { amount: 500 },
    gross_sales_money: { amount: 10_500 },
  }), 10_000);
});

test("Square zero-value lines remain zero and malformed amounts fail closed", () => {
  assert.equal(squareLineNetSalesCents({
    total_money: { amount: 0 }, total_tax_money: { amount: 0 },
    gross_sales_money: { amount: 10_000 },
  }), 0);
  assert.equal(squareLineNetSalesCents({ total_money: { amount: 500 } }), 500);
  for (const value of [
    {}, { total_money: { amount: null } }, { total_money: { amount: 1.5 } },
    { total_money: { amount: Number.MAX_SAFE_INTEGER + 1 } },
    { total_money: { amount: 100 }, total_tax_money: { amount: 101 } },
    { total_money: { amount: 100 }, total_tax_money: { amount: -1 } },
  ]) assert.throws(() => squareLineNetSalesCents(value));
});

test("Square incremental windows use updates, overlap safely, and stay fixed during pagination", () => {
  const now = new Date("2026-09-08T12:00:00Z");
  const window = beginSquareSyncWindow(JSON.stringify({ version: 2, watermark: "2026-09-08T11:00:00Z" }), now);
  assert.equal(window.windowStart, "2026-09-08T10:55:00.000Z");
  assert.equal(window.windowEnd, now.toISOString());
  const resumed = beginSquareSyncWindow(JSON.stringify({ ...window, orders: "page-two", completed: ["customers"] }), new Date("2026-09-08T12:10:00Z"));
  assert.equal(resumed.windowEnd, now.toISOString());
  assert.equal(resumed.orders, "page-two");
  assert.deepEqual(resumed.completed, ["customers"]);
  const request = buildSquareOrderSearchBody(["store-one"], resumed);
  assert.deepEqual(request.query.filter.date_time_filter, {
    updated_at: { start_at: window.windowStart, end_at: window.windowEnd },
  });
  assert.equal(request.query.sort.sort_field, "UPDATED_AT");
  assert.equal(request.cursor, "page-two");
  // Old creation-time pagination cannot be reused with an update-time query.
  const legacy = beginSquareSyncWindow(JSON.stringify({ orders: "old-cursor", watermark: "2026-09-08T11:00:00Z" }), now);
  assert.equal(legacy.orders, undefined);
  assert.deepEqual(legacy.completed, []);
  assert.ok(legacy.windowStart < "2025-01-01");
  assert.throws(() => buildSquareOrderSearchBody([], window));
});

test("commerce approval accepts a clean no-op sync and validates durable staged sales separately", () => {
  const approvalRoute = readFileSync(`${process.cwd()}/app/api/v1/integrations/route.ts`, "utf8");
  const reviewedRunQuery = approvalRoute.slice(
    approvalRoute.indexOf("const [reviewedRun]"),
    approvalRoute.indexOf("if (!reviewedRun)"),
  );
  assert.doesNotMatch(reviewedRunQuery, /gt\(integrationSyncRuns\.recordsStaged,\s*0\)/);
  assert.match(approvalRoute, /Number\(review\?\.stagedSaleCount \?\? 0\) === 0/);
});
