import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMonerisPayment, requestMonerisAccessToken, validateMonerisCredentialInput, resolveMonerisEnvironment, monerisNextCursor } from "../server/integrations/moneris.ts";

const credentials = {
  environment: "sandbox" as const,
  merchantId: "0123456789101",
  clientId: "application-id",
  clientSecret: "a-long-client-secret-value",
  scope: "payment.read",
};

test("Moneris merchant credentials fail closed before any provider request", () => {
  assert.throws(() => validateMonerisCredentialInput({ ...credentials, merchantId: "short" }), /exactly 13/i);
  assert.throws(() => validateMonerisCredentialInput({ ...credentials, clientSecret: "short" }), /client secret/i);
  assert.throws(() => validateMonerisCredentialInput({ ...credentials, scope: "payment.read\nwrite" }), /read-only/i);
});

test("Moneris client credentials use form encoding and never a query secret", async () => {
  let captured: { url: string; init?: RequestInit } | null = null;
  const fetcher: typeof fetch = async (input, init) => {
    captured = { url: String(input), init };
    return new Response(JSON.stringify({ access_token: "temporary-token", expires_in: 900 }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const token = await requestMonerisAccessToken(credentials, fetcher);
  const request = captured as { url: string; init?: RequestInit } | null;
  assert.ok(request);
  assert.equal(token.accessToken, "temporary-token");
  assert.equal(request.url, "https://api.sb.moneris.io/oauth2/token");
  assert.equal(request.init?.method, "POST");
  assert.ok(String(request.init?.body).includes("grant_type=client_credentials"));
  assert.ok(!request.url.includes(credentials.clientSecret));
});

test("Moneris normalization retains only successful non-cardholder payment facts", async () => {
  const normalized = await normalizeMonerisPayment({
    id: "pay-1", orderId: "order-1", paymentStatus: "SUCCEEDED",
    amount: { amount: "16000", currency: "CAD" }, createdAt: "2026-08-14T12:00:00Z",
    paymentMethod: { type: "credit_card", pan: "4111111111111111", cvv: "123" },
  });
  assert.equal(normalized?.amountCents, 16000);
  assert.equal(normalized?.category, "card");
  assert.equal(JSON.stringify(normalized).includes("4111111111111111"), false);
  assert.equal(JSON.stringify(normalized).includes("123"), false);
  assert.equal(await normalizeMonerisPayment({ id: "pay-2", paymentStatus: "DECLINED", amount: { amount: "100" } }), null);
});
test("Moneris connection environment uses its merchant namespace and supports unambiguous legacy records", () => {
  assert.equal(resolveMonerisEnvironment(credentials.merchantId, `production:${credentials.merchantId}`, null), "production");
  assert.equal(resolveMonerisEnvironment(credentials.merchantId, `sandbox:${credentials.merchantId}`, null), "sandbox");
  assert.equal(resolveMonerisEnvironment(credentials.merchantId, "legacy", "sandbox"), "sandbox");
  assert.equal(resolveMonerisEnvironment(credentials.merchantId, null, "production"), "production");
  assert.throws(() => resolveMonerisEnvironment(credentials.merchantId, "production:anothermerchant", "production"), /reconnect/i);
  assert.throws(() => resolveMonerisEnvironment(credentials.merchantId, "legacy", null), /reconnect/i);
});

test("Moneris accepts only the read-only payment scope", () => {
  assert.equal(validateMonerisCredentialInput({ ...credentials, scope: "" }).scope, "payment.read");
  for (const scope of ["payment.write", "payment.read payment.write", "refund.read", "payment.read\nwrite"]) {
    assert.throws(() => validateMonerisCredentialInput({ ...credentials, scope }), /read-only/i);
  }
});

test("Moneris token requests stay read-only even for a legacy credential object", async () => {
  let requestBody = "";
  const fetcher: typeof fetch = async (_input, init) => {
    requestBody = String(init?.body);
    return Response.json({ access_token: "fixture-token", expires_in: 900 });
  };
  await requestMonerisAccessToken({ ...credentials, scope: "payment.write" }, fetcher);
  assert.equal(new URLSearchParams(requestBody).get("scope"), "payment.read");
});

test("Moneris payment pagination extracts the documented next-page URI cursor", () => {
  assert.equal(monerisNextCursor({ data: [], next: "/payments?cursor=second%2Bpage&limit=20" }, "sandbox"), "second+page");
  assert.equal(monerisNextCursor({ data: [], next: "https://api.moneris.io/payments?cursor=production-page" }, "production"), "production-page");
  assert.equal(monerisNextCursor({ data: [], next: null }, "sandbox"), null);
  assert.equal(monerisNextCursor({ data: [], next_cursor: "legacy-page" }, "sandbox"), "legacy-page");
});

test("Moneris pagination rejects foreign origins, wrong environments and malformed links", () => {
  for (const next of [
    "https://example.com/payments?cursor=foreign",
    "https://api.moneris.io/payments?cursor=production",
    "/refunds?cursor=wrong-resource",
    "/payments?limit=20",
    "https://user:password@api.sb.moneris.io/payments?cursor=bad",
    "",
    42,
  ]) {
    assert.throws(() => monerisNextCursor({ data: [], next }, "sandbox"), /invalid payment-history page link/i);
  }
});

test("Moneris normalization uses documented transaction time and nested payment method", async () => {
  const normalized = await normalizeMonerisPayment({
    paymentId: "pi0105ARZ3NDEKTSV4RRFFQ69G5FAV", orderId: "order-2", paymentStatus: "SUCCEEDED",
    amount: { amount: 16000, currency: "CAD" },
    createdAt: "2026-08-14T12:00:00Z", transactionDateTime: "2026-08-14T12:03:00Z",
    paymentMethod: { paymentMethodInformation: { paymentMethodType: "CARD", cardInformation: { lastFour: "1234" } } },
  });
  assert.equal(normalized?.paidAt, "2026-08-14T12:03:00.000Z");
  assert.equal(normalized?.paymentTypeName, "CARD");
  assert.equal(normalized?.category, "card");
  assert.doesNotMatch(JSON.stringify(normalized), /lastFour/);
  await assert.rejects(() => normalizeMonerisPayment({ id: "missing-status", amount: { amount: 100, currency: "CAD" } }), /status missing/i);
});

test("Moneris requires explicit matching cents-based currency and a payment date", async () => {
  const payment = { paymentId: "money", paymentStatus: "SUCCEEDED", amount: { amount: 100, currency: "CAD" }, transactionDateTime: "2026-09-16T12:00:00Z" };
  assert.equal((await normalizeMonerisPayment(payment, "CAD"))?.amountCents, 100);
  const usd = { ...payment, amount: { amount: 100, currency: "USD" } };
  await assert.rejects(() => normalizeMonerisPayment(usd, "CAD"), /differs from/i);
  assert.equal((await normalizeMonerisPayment(usd, "USD"))?.amountCents, 100);
  assert.notEqual((await normalizeMonerisPayment(usd, "USD"))?.sourcePayloadHash, (await normalizeMonerisPayment(payment, "CAD"))?.sourcePayloadHash);
  for (const currency of [undefined, "", "JPY", "CADUSD"]) await assert.rejects(() => normalizeMonerisPayment({ ...payment, amount: { amount: 100, currency } }), /currency/i);
  for (const transactionDateTime of [undefined, "invalid"]) await assert.rejects(() => normalizeMonerisPayment({ ...payment, transactionDateTime }), /date/i);
});
