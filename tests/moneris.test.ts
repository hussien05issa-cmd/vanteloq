import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMonerisPayment, requestMonerisAccessToken, validateMonerisCredentialInput } from "../server/integrations/moneris.ts";

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
  assert.throws(() => validateMonerisCredentialInput({ ...credentials, scope: "payment.read\nwrite" }), /read scope/i);
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
