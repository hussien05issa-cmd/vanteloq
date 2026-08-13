import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCloverDailyMetrics,
  buildCloverAuthorizationUrl,
  cloverReadiness,
  decryptCloverSecret,
  encryptCloverSecret,
  exchangeCloverCode,
  fetchCloverCollection,
  normalizeCloverCustomer,
  normalizeCloverInventoryItem,
  normalizeCloverOrder,
  normalizeCloverPayments,
  refreshCloverToken,
  verifyCloverWebhookAuth,
  verifyCloverWebhookAppId,
} from "../server/integrations/clover.ts";

(globalThis as typeof globalThis & { __vanteloqEnv?: Record<string, string> }).__vanteloqEnv = {
  CLOVER_CLIENT_ID: "test-clover-app-id",
  CLOVER_CLIENT_SECRET: "test-clover-app-secret",
  CLOVER_REDIRECT_URI: "https://vanteloq.example/api/v1/integrations/clover/callback",
  CLOVER_ENV: "sandbox",
  CLOVER_WEBHOOK_AUTH: "test-clover-webhook-auth",
  INTEGRATION_ENCRYPTION_KEY: Buffer.from(
    Uint8Array.from({ length: 32 }, (_, index) => index + 1),
  ).toString("base64"),
};

test("Clover authorization uses the official sandbox endpoint without exposing secrets", () => {
  const url = new URL(buildCloverAuthorizationUrl("clover-state-with-entropy"));
  assert.equal(url.origin, "https://sandbox.dev.clover.com");
  assert.equal(url.pathname, "/oauth/v2/authorize");
  assert.equal(url.searchParams.get("client_id"), "test-clover-app-id");
  assert.equal(url.searchParams.get("redirect_uri"), "https://vanteloq.example/api/v1/integrations/clover/callback");
  assert.equal(url.searchParams.get("state"), "clover-state-with-entropy");
  assert.doesNotMatch(url.toString(), /test-clover-app-secret/);
});

test("Clover readiness advertises only merchant-approved read access", () => {
  const readiness = cloverReadiness();
  assert.equal(readiness.adapterBuilt, true);
  assert.equal(readiness.credentialsConfigured, true);
  assert.equal(readiness.environment, "sandbox");
  assert.equal(readiness.mode, "read_only_staged_sync");
  assert.deepEqual(readiness.permissions, ["merchant", "orders", "payments", "inventory", "customers"]);
  assert.equal(readiness.webhookConfigured, true);
});

test("Clover tokens use provider-bound authenticated encryption", async () => {
  const encrypted = await encryptCloverSecret("clover-private-token");
  assert.match(encrypted, /^v1\./);
  assert.doesNotMatch(encrypted, /clover-private-token/);
  assert.equal(await decryptCloverSecret(encrypted), "clover-private-token");
});

test("Clover exchanges and rotates v2 OAuth tokens using JSON requests", async () => {
  const requests: Array<{ url: string; body: unknown }> = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return Response.json({
      access_token: requests.length === 1 ? "access-one" : "access-two",
      access_token_expiration: 1_800_000_000,
      refresh_token: requests.length === 1 ? "refresh-one" : "refresh-two",
      refresh_token_expiration: 1_900_000_000,
    });
  }) as typeof fetch;

  const exchanged = await exchangeCloverCode("merchant-code", fetcher);
  const refreshed = await refreshCloverToken("refresh-one", fetcher);
  assert.equal(exchanged.accessToken, "access-one");
  assert.equal(refreshed.refreshToken, "refresh-two");
  assert.deepEqual(requests, [
    {
      url: "https://apisandbox.dev.clover.com/oauth/v2/token",
      body: { client_id: "test-clover-app-id", client_secret: "test-clover-app-secret", code: "merchant-code" },
    },
    {
      url: "https://apisandbox.dev.clover.com/oauth/v2/refresh",
      body: { client_id: "test-clover-app-id", refresh_token: "refresh-one" },
    },
  ]);
});

test("Clover collection paging stays on the configured API origin", async () => {
  const seen: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    seen.push(String(input));
    return Response.json({ elements: [{ id: `order-${seen.length}` }] });
  }) as typeof fetch;
  const page = await fetchCloverCollection(
    "merchant-1",
    "access-token",
    "/v3/merchants/merchant-1/orders",
    { limit: 100, offset: 200, expand: "lineItems,payments,customers" },
    fetcher,
  );
  assert.deepEqual(page.elements, [{ id: "order-1" }]);
  const url = new URL(seen[0]);
  assert.equal(url.origin, "https://apisandbox.dev.clover.com");
  assert.equal(url.pathname, "/v3/merchants/merchant-1/orders");
  assert.equal(url.searchParams.get("offset"), "200");
  assert.equal(url.searchParams.get("limit"), "100");
});

test("Clover order normalization preserves cents, fixed-point quantities, and source identity", async () => {
  const order = await normalizeCloverOrder("merchant-1", {
    id: "order-1",
    state: "locked",
    total: 4298,
    createdTime: 1_786_294_800_000,
    modifiedTime: 1_786_294_801_000,
    customers: { elements: [{ id: "customer-1", firstName: "Do not duplicate" }] },
    lineItems: { elements: [
      { id: "line-1", item: { id: "item-1" }, name: "Creatine", price: 1999, unitQty: 2000,
        priceWithModifiersAndItemAndOrderDiscounts: 3998 },
    ] },
  });
  assert.equal(order.sale.externalSaleId, "order-1");
  assert.equal(order.sale.outletRef, "merchant-1");
  assert.equal(order.sale.totalCents, 4298);
  assert.equal(order.sale.state, "completed");
  assert.equal(order.lines[0].quantityMilli, 2000);
  assert.equal(order.lines[0].netSalesCents, 3998);
  assert.equal(order.lines[0].customerRef, "customer-1");
  assert.doesNotMatch(JSON.stringify(order.sale), /Do not duplicate/);
});

test("Clover inventory and customer normalization retain required business fields only", async () => {
  const item = await normalizeCloverInventoryItem("merchant-1", {
    id: "item-1", name: "Creatine", sku: "CRE-1", code: "0001", price: 2999, cost: 1450,
    itemStock: { quantity: 42 },
  });
  assert.equal(item.product.defaultPriceCents, 2999);
  assert.equal(item.product.defaultCostCents, 1450);
  assert.equal(item.balance.onHandQuantity, 42);

  const customer = await normalizeCloverCustomer({
    id: "customer-1", firstName: "Ada", lastName: "Lovelace",
    emailAddresses: { elements: [{ emailAddress: "ada@example.invalid" }] },
    cards: { elements: [{ cardNumber: "4111111111111111" }] },
  });
  assert.equal(customer.displayName, "Ada Lovelace");
  assert.equal(customer.email, "ada@example.invalid");
  assert.doesNotMatch(JSON.stringify(customer), /4111111111111111/);
});

test("Clover payment normalization stores tender categories without cardholder data", async () => {
  const payments = await normalizeCloverPayments("merchant-1", [{
    id: "payment-1", amount: 4298, createdTime: 1_786_294_800_000,
    result: "SUCCESS", order: { id: "order-1" }, tender: { id: "tender-1", label: "Credit Card" },
    cardTransaction: { cardholderName: "Private Person", first6: "411111", last4: "1111" },
  }]);
  assert.equal(payments[0].category, "card");
  assert.equal(payments[0].amountCents, 4298);
  assert.doesNotMatch(JSON.stringify(payments), /Private Person|411111|1111/);
});

test("Clover webhook authentication is constant-value and fail closed", () => {
  assert.equal(verifyCloverWebhookAuth("test-clover-webhook-auth"), true);
  assert.equal(verifyCloverWebhookAuth("wrong"), false);
  assert.equal(verifyCloverWebhookAuth(null), false);
  assert.equal(verifyCloverWebhookAppId("test-clover-app-id"), true);
  assert.equal(verifyCloverWebhookAppId("other-app"), false);
});

test("Clover daily metrics aggregate only completed sales and retain source lineage", () => {
  const rows = buildCloverDailyMetrics([
    {
      externalSaleId: "o1", externalVersion: "1", outletRef: "merchant-1",
      soldAt: "2026-08-13T12:00:00.000Z", state: "completed", totalCents: 1200,
      taxCents: 50, costCents: 400, discountCents: 100, lineCount: 2, sourcePayloadHash: "a",
    },
    {
      externalSaleId: "o2", externalVersion: "1", outletRef: "merchant-1",
      soldAt: "2026-08-13T13:00:00.000Z", state: "open", totalCents: 900,
      taxCents: 0, costCents: 300, discountCents: 0, lineCount: 1, sourcePayloadHash: "b",
    },
  ], "connection-1");
  assert.deepEqual(rows, [{
    businessDate: "2026-08-13", locationRef: "clover:connection-1:merchant-1",
    grossSalesCents: 1250, netSalesCents: 1150, costOfGoodsCents: 400,
    transactionCount: 1, unitsSold: 2, refundsCents: 0, discountsCents: 100,
  }]);
});
