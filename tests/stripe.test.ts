import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  buildStripeAuthorizationUrl,
  exchangeStripeAuthorizationCode,
  normalizeStripeBalanceTransaction,
  normalizeStripePayout,
  stripeReadiness,
  verifyStripeWebhookSignature,
} from "../server/integrations/stripe.ts";

const webhookSecret = "whsec_test_webhook_secret_value";
(globalThis as typeof globalThis & { __vanteloqEnv?: Record<string, string> }).__vanteloqEnv = {
  STRIPE_CLIENT_ID: "ca_test_platform_client",
  STRIPE_SECRET_KEY: "sk_test_platform_secret_value",
  STRIPE_REDIRECT_URI: "https://vanteloq.example/api/v1/integrations/stripe/callback",
  STRIPE_WEBHOOK_SECRET: webhookSecret,
  STRIPE_API_VERSION: "2026-02-25.clover",
};

test("Stripe authorization is state-bound and does not disclose the platform key", () => {
  const state = "state-with-at-least-thirty-two-characters-of-entropy";
  const url = new URL(buildStripeAuthorizationUrl(state));
  assert.equal(url.origin, "https://connect.stripe.com");
  assert.equal(url.pathname, "/oauth/authorize");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), "ca_test_platform_client");
  assert.equal(url.searchParams.get("redirect_uri"), "https://vanteloq.example/api/v1/integrations/stripe/callback");
  assert.equal(url.searchParams.get("state"), state);
  assert.equal(url.searchParams.has("scope"), false);
  assert.doesNotMatch(url.toString(), /sk_test_platform_secret_value|whsec_/);
});

test("Stripe readiness remains staging-only", () => {
  const readiness = stripeReadiness();
  assert.equal(readiness.adapterBuilt, true);
  assert.equal(readiness.credentialsConfigured, true);
  assert.equal(readiness.mode, "read_only_staging");
  assert.equal(readiness.dataPromotionEnabled, false);
  assert.equal(readiness.apiVersion, "2026-02-25.clover");
});

test("Stripe Connect accepts only a read-only account grant", async () => {
  const readOnlyFetcher = (async () => Response.json({
    stripe_user_id: "acct_123456789",
    scope: "read_only",
    livemode: false,
  })) as typeof fetch;
  const readOnly = await exchangeStripeAuthorizationCode("ac_test_read_only", readOnlyFetcher);
  assert.equal(readOnly.scope, "read_only");

  const readWriteFetcher = (async () => Response.json({
    stripe_user_id: "acct_123456789",
    scope: "read_write",
    livemode: false,
  })) as typeof fetch;
  await assert.rejects(
    () => exchangeStripeAuthorizationCode("ac_test_read_write", readWriteFetcher),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "STRIPE_SCOPE_NOT_READ_ONLY",
  );
});

test("Stripe balance normalization preserves settlement facts and excludes payment PII", async () => {
  const normalized = await normalizeStripeBalanceTransaction({
    id: "txn_123456789",
    amount: 10_000,
    fee: 320,
    net: 9_680,
    created: 1_786_200_000,
    available_on: 1_786_286_400,
    currency: "cad",
    reporting_category: "charge",
    source: "ch_123456789",
    status: "available",
    livemode: true,
    customer: { email: "private@example.invalid" },
    payment_method_details: { card: { last4: "4242" } },
  });
  assert.equal(normalized.grossCents, 10_000);
  assert.equal(normalized.feeCents, 320);
  assert.equal(normalized.netCents, 9_680);
  assert.equal(normalized.currency, "cad");
  assert.equal(normalized.category, "charge");
  assert.doesNotMatch(JSON.stringify(normalized), /private@example|4242|customer/i);
});

test("Stripe payout normalization stages arrival and state without bank details", async () => {
  const normalized = await normalizeStripePayout({
    id: "po_123456789",
    amount: 9_680,
    created: 1_786_200_000,
    arrival_date: 1_786_286_400,
    currency: "cad",
    status: "paid",
    balance_transaction: "txn_123456789",
    destination: "ba_sensitive_destination",
    livemode: true,
  });
  assert.equal(normalized.recordType, "payout");
  assert.equal(normalized.netCents, 9_680);
  assert.equal(normalized.state, "paid");
  assert.doesNotMatch(JSON.stringify(normalized), /ba_sensitive_destination/);
});

test("Stripe webhook verification rejects tampering and stale replay", async () => {
  const timestamp = 1_786_265_000;
  const body = new TextEncoder().encode('{"id":"evt_123","type":"payout.paid"}');
  const signature = createHmac("sha256", webhookSecret)
    .update(`${timestamp}.`)
    .update(body)
    .digest("hex");
  const header = `t=${timestamp},v1=${signature}`;
  assert.equal((await verifyStripeWebhookSignature(body, header, timestamp + 60)).valid, true);
  assert.equal((await verifyStripeWebhookSignature(new TextEncoder().encode("{}"), header, timestamp + 60)).valid, false);
  assert.equal((await verifyStripeWebhookSignature(body, header, timestamp + 301)).valid, false);
});
