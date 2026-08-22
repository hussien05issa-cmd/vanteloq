import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { ApiError } from "../server/api.ts";
import {
  createStripeCheckout,
  normalizeStripeSubscription,
  stripeBillingReadiness,
  verifyStripeBillingSignature,
} from "../server/billing/stripe.ts";
import { ADDONS, PLANS } from "../server/entitlements/catalog.ts";

const webhookSecret = "whsec_test_billing_webhook_secret";
(globalThis as typeof globalThis & { __vanteloqEnv?: Record<string, string> }).__vanteloqEnv = {
  STRIPE_SECRET_KEY: "sk_test_billing_platform_secret",
  STRIPE_BILLING_WEBHOOK_SECRET: webhookSecret,
};

function verifiedPrice(lookupKey: string) {
  const definitions = [...Object.values(PLANS), ...Object.values(ADDONS)];
  for (const definition of definitions) {
    for (const interval of ["month", "year"] as const) {
      const expected = definition.prices[interval];
      if (expected.lookupKey === lookupKey) return {
        id: `price_${lookupKey.replaceAll("_", "")}`,
        lookup_key: lookupKey,
        unit_amount: expected.amountCents,
        currency: "cad",
        active: true,
        recurring: { interval },
      };
    }
  }
  throw new Error(`Unexpected lookup key ${lookupKey}`);
}

test("Stripe Billing readiness requires both the platform and dedicated webhook secrets", () => {
  assert.deepEqual(stripeBillingReadiness(), { configured: true, missingConfiguration: [] });
});

test("Checkout uses only verified catalogue prices and binds the organization", async () => {
  const requests: Array<{ url: URL; body: URLSearchParams }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    if (url.pathname === "/v1/prices") {
      const lookup = url.searchParams.get("lookup_keys[]") ?? "";
      return Response.json({ data: [verifiedPrice(lookup)] });
    }
    const body = new URLSearchParams(String(init?.body ?? ""));
    requests.push({ url, body });
    return Response.json({ url: "https://checkout.stripe.com/c/pay/test-session" });
  };
  const result = await createStripeCheckout({
    organizationId: "org_verified_123",
    email: "owner@example.com",
    plan: "growth",
    interval: "month",
    includeBookloq: true,
    customerId: null,
    origin: "https://vanteloq.example",
    fetcher,
  });
  assert.match(result.url, /^https:\/\/checkout\.stripe\.com\//);
  assert.equal(requests.length, 1);
  const body = requests[0].body;
  assert.equal(body.get("integration_identifier"), "vanteloq_checkout_hpxqzrma");
  assert.equal(body.get("client_reference_id"), "org_verified_123");
  assert.equal(body.get("metadata[vanteloq_organization_id]"), "org_verified_123");
  assert.equal(body.get("metadata[vanteloq_interval]"), "month");
  assert.equal(body.get("payment_method_collection"), "always");
  assert.equal(body.get("billing_address_collection"), "required");
  assert.equal(body.get("customer_email"), "owner@example.com");
  assert.equal(body.get("line_items[0][price]"), verifiedPrice(PLANS.growth.prices.month.lookupKey).id);
  assert.equal(body.get("line_items[1][price]"), verifiedPrice(ADDONS.bookloq.prices.month.lookupKey).id);
  assert.doesNotMatch(body.toString(), /sk_test|whsec_|card/i);
});

test("Checkout rejects annual purchases before contacting Stripe", async () => {
  let requested = false;
  const fetcher: typeof fetch = async () => { requested = true; return Response.json({}); };
  await assert.rejects(
    createStripeCheckout({ organizationId: "org_verified_123", email: "owner@example.com", plan: "starter", interval: "year", includeBookloq: false, customerId: null, origin: "https://vanteloq.example", fetcher } as unknown as Parameters<typeof createStripeCheckout>[0]),
    (error: unknown) => error instanceof ApiError && error.code === "BILLING_INTERVAL_UNAVAILABLE",
  );
  assert.equal(requested, false);
});

test("Checkout fails closed when a Stripe monthly price differs from the catalogue", async () => {
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    const lookup = url.searchParams.get("lookup_keys[]") ?? "";
    return Response.json({ data: [{ ...verifiedPrice(lookup), unit_amount: 1 }] });
  };
  await assert.rejects(
    createStripeCheckout({ organizationId: "org_verified_123", email: "owner@example.com", plan: "starter", interval: "month", includeBookloq: false, customerId: null, origin: "https://vanteloq.example", fetcher }),
    (error: unknown) => error instanceof ApiError && error.code === "STRIPE_PRICE_CONFIGURATION_INVALID",
  );
});

test("Subscription normalization accepts catalogue facts and excludes payment data", () => {
  const plan = verifiedPrice(PLANS.pro.prices.year.lookupKey);
  const addon = verifiedPrice(ADDONS.bookloq.prices.year.lookupKey);
  const normalized = normalizeStripeSubscription({
    id: "sub_123456789",
    customer: "cus_123456789",
    status: "active",
    metadata: { vanteloq_organization_id: "org_verified_123" },
    cancel_at_period_end: false,
    items: { data: [
      { id: "si_plan123456", price: plan, current_period_end: 1_800_000_000 },
      { id: "si_addon12345", price: addon, current_period_end: 1_800_000_000 },
    ] },
    payment_method: { card: { last4: "4242" } },
  });
  assert.equal(normalized.basePlan, "pro");
  assert.equal(normalized.billingInterval, "year");
  assert.equal(normalized.addon?.key, "bookloq");
  assert.doesNotMatch(JSON.stringify(normalized), /4242|payment_method|card/i);
});

test("Billing webhook verification rejects tampering and stale replay", async () => {
  const timestamp = 1_786_265_000;
  const body = new TextEncoder().encode('{"id":"evt_123","type":"customer.subscription.updated"}');
  const signature = createHmac("sha256", webhookSecret).update(`${timestamp}.`).update(body).digest("hex");
  const header = `t=${timestamp},v1=${signature}`;
  assert.equal(await verifyStripeBillingSignature(body, header, timestamp + 60), true);
  assert.equal(await verifyStripeBillingSignature(new TextEncoder().encode("{}"), header, timestamp + 60), false);
  assert.equal(await verifyStripeBillingSignature(body, header, timestamp + 301), false);
});
