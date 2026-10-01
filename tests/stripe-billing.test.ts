import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { ApiError } from "../server/api.ts";
import {
  prepareStripeCheckout,
  normalizeStripeSubscription,
  stripeBillingReadiness,
  terminateStripeBilling,
  verifyStripeBillingSignature,
} from "../server/billing/stripe.ts";
import { ADDONS, PLANS } from "../server/entitlements/catalog.ts";
import { SUBSCRIPTION_TRIAL_POLICY } from "../shared/subscription-trial.ts";

const webhookSecret = "whsec_test_billing_webhook_secret";
(globalThis as typeof globalThis & { __vanteloqEnv?: Record<string, string> }).__vanteloqEnv = {
  STRIPE_SECRET_KEY: "sk_test_billing_platform_secret",
  STRIPE_BILLING_WEBHOOK_SECRET: webhookSecret,
};

function verifiedPrice(lookupKey: string) {
  const definitions = [...Object.values(PLANS), ...Object.values(ADDONS)];
  for (const definition of definitions) {
    for (const expected of Object.values(definition.prices)) {
      if (expected.lookupKey === lookupKey) return {
        id: `price_${lookupKey.replaceAll("_", "")}`,
        lookup_key: lookupKey,
        unit_amount: expected.amountCents,
        currency: "cad",
        active: true,
        recurring: { interval: expected.interval, interval_count: 1, usage_type: "licensed" }, type: "recurring", billing_scheme: "per_unit", transform_quantity: null,
      };
    }
  }
  throw new Error(`Unexpected lookup key ${lookupKey}`);
}

test("Stripe Billing readiness requires both the platform and dedicated webhook secrets", () => {
  assert.deepEqual(stripeBillingReadiness(), { configured: true, missingConfiguration: [] });
});

test("production checkout fails closed when a test Stripe key is configured", async () => {
  let requested = false;
  await assert.rejects(
    prepareStripeCheckout({
      organizationId: "org_verified_123",
      email: "owner@example.com",
      plan: "starter",
      interval: "month",
      includeBookloq: false,
      customerId: null,
      origin: "https://vanteloq.com",
      fetcher: async () => { requested = true; return Response.json({}); },
    }),
    (error: unknown) => error instanceof ApiError && error.code === "STRIPE_LIVE_BILLING_REQUIRED",
  );
  assert.equal(requested, false);
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
  const body = await prepareStripeCheckout({
    organizationId: "org_verified_123",
    email: "owner@example.com",
    plan: "growth",
    interval: "month",
    includeBookloq: true,
    customerId: null,
    origin: "https://vanteloq.example",
    fetcher,
  });
  assert.equal(requests.length, 0);
  assert.equal(body.get("integration_identifier"), "vanteloq_checkout_hpxqzrma");
  assert.equal(body.get("client_reference_id"), "org_verified_123");
  assert.equal(body.get("metadata[vanteloq_organization_id]"), "org_verified_123");
  assert.equal(body.get("metadata[vanteloq_interval]"), "month");
  assert.equal(body.get("payment_method_collection"), "always");
  assert.equal(body.get("billing_address_collection"), "required");
  assert.equal(body.get("customer_email"), "owner@example.com");
  assert.equal(body.get("line_items[0][price]"), verifiedPrice(PLANS.growth.prices.month.lookupKey).id);
  assert.equal(body.get("line_items[1][price]"), verifiedPrice(ADDONS.bookloq.prices.month.lookupKey).id);
  assert.equal([...body.keys()].some(key => key.toLowerCase().includes("trial")), false);
  assert.doesNotMatch(body.toString(), /sk_test|whsec_|card/i);
});

test("standalone BookLoQ checkout charges one verified $59 CAD monthly price", async () => {
  const requestedLookups: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    const lookup = url.searchParams.get("lookup_keys[]") ?? "";
    requestedLookups.push(lookup);
    return Response.json({ data: [verifiedPrice(lookup)] });
  };
  const body = await prepareStripeCheckout({
    organizationId: "org_bookloq_123",
    email: "bookloq@example.com",
    plan: "bookloq",
    interval: "month",
    includeBookloq: false,
    customerId: null,
    origin: "https://vanteloq.example",
    fetcher,
  });
  assert.deepEqual(requestedLookups, ["bookloq_standalone_monthly_cad"]);
  assert.equal(PLANS.bookloq.prices.month.amountCents, 5_900);
  assert.equal(ADDONS.bookloq.prices.month.amountCents, 3_900);
  assert.equal(body.get("metadata[vanteloq_plan]"), "bookloq");
  assert.equal(body.get("line_items[0][price]"), verifiedPrice("bookloq_standalone_monthly_cad").id);
  assert.equal(body.has("line_items[1][price]"), false);
});

test("standalone BookLoQ checkout rejects a duplicate add-on before contacting Stripe", async () => {
  let requested = false;
  const fetcher: typeof fetch = async () => { requested = true; return Response.json({}); };
  await assert.rejects(
    prepareStripeCheckout({ organizationId: "org_bookloq_123", email: "bookloq@example.com", plan: "bookloq", interval: "month", includeBookloq: true, customerId: null, origin: "https://vanteloq.example", fetcher }),
    (error: unknown) => error instanceof ApiError && error.code === "BILLING_SELECTION_INVALID",
  );
  assert.equal(requested, false);
});

test("Checkout rejects annual purchases before contacting Stripe", async () => {
  let requested = false;
  const fetcher: typeof fetch = async () => { requested = true; return Response.json({}); };
  await assert.rejects(
    prepareStripeCheckout({ organizationId: "org_verified_123", email: "owner@example.com", plan: "starter", interval: "year", includeBookloq: false, customerId: null, origin: "https://vanteloq.example", fetcher } as unknown as Parameters<typeof prepareStripeCheckout>[0]),
    (error: unknown) => error instanceof ApiError && error.code === "BILLING_INTERVAL_UNAVAILABLE",
  );
  assert.equal(requested, false);
});

test("Workspace deletion recognizes already canceled billing after an interrupted request", async () => {
  const requests: Array<{ path: string; method: string }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    requests.push({ path: url.pathname, method: init?.method ?? "GET" });
    if (url.pathname.startsWith("/v1/subscriptions/")) return Response.json({ id: "sub_123456789", status: "canceled" });
    return Response.json({ id: "cus_123456789", deleted: true });
  };
  assert.deepEqual(await terminateStripeBilling({ subscriptionId: "sub_123456789", customerId: "cus_123456789", fetcher }), {
    subscriptionCanceled: true,
    customerDeleted: true,
  });
  assert.deepEqual(requests, [
    { path: "/v1/subscriptions/sub_123456789", method: "GET" },
    { path: "/v1/customers/cus_123456789", method: "GET" },
  ]);
});

test("workspace deletion confirms active billing identities before canceling them", async () => {
  const writes: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (init?.method === "DELETE") writes.push(path);
    return path.includes("subscriptions")
      ? Response.json({id:"sub_123456789",status:init?.method === "DELETE" ? "canceled" : "active"})
      : Response.json({id:"cus_123456789",deleted:init?.method === "DELETE"});
  };
  assert.deepEqual(await terminateStripeBilling({subscriptionId:"sub_123456789",customerId:"cus_123456789",fetcher}),{subscriptionCanceled:true,customerDeleted:true});
  assert.deepEqual(writes,["/v1/subscriptions/sub_123456789","/v1/customers/cus_123456789"]);
  await assert.rejects(()=>terminateStripeBilling({subscriptionId:"sub_123456789",customerId:null,fetcher:async()=>Response.json({id:"sub_OTHER12345",status:"active"})}),/identity could not be confirmed/);
});

test("Checkout fails closed when a Stripe monthly price differs from the catalogue", async () => {
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    const lookup = url.searchParams.get("lookup_keys[]") ?? "";
    return Response.json({ data: [{ ...verifiedPrice(lookup), unit_amount: 1 }] });
  };
  await assert.rejects(
    prepareStripeCheckout({ organizationId: "org_verified_123", email: "owner@example.com", plan: "starter", interval: "month", includeBookloq: false, customerId: null, origin: "https://vanteloq.example", fetcher }),
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

test("Subscription normalization accepts standalone BookLoQ without an add-on item", () => {
  const normalized = normalizeStripeSubscription({
    id: "sub_bookloq123456",
    customer: "cus_bookloq123456",
    status: "active",
    metadata: { vanteloq_organization_id: "org_bookloq_123" },
    cancel_at_period_end: false,
    items: { data: [
      { id: "si_bookloqbase123", quantity: 1, price: verifiedPrice(PLANS.bookloq.prices.month.lookupKey), current_period_end: 1_800_000_000 },
    ] },
  });
  assert.equal(normalized.basePlan, "bookloq");
  assert.equal(normalized.billingInterval, "month");
  assert.equal(normalized.addon, null);
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

test("eligible first checkout applies one seven-day trial to selected items and keeps payment collection mandatory", async () => {
  const fetcher: typeof fetch = async input => Response.json({ data: [verifiedPrice(new URL(String(input)).searchParams.get("lookup_keys[]")!)] });
  for (const plan of ["starter", "growth", "pro", "bookloq"] as const) {
    const input = { organizationId: "org_trial_123", email: "owner@example.invalid", plan, interval: "month" as const, includeBookloq: plan !== "bookloq", customerId: null, origin: "https://vanteloq.example", fetcher };
    const trial = await prepareStripeCheckout({ ...input, trialEligible: true });
    assert.equal(trial.get("subscription_data[trial_period_days]"), "7");
    assert.equal(trial.get("payment_method_collection"), "always");
    assert.equal(trial.get("subscription_data[trial_settings][end_behavior][missing_payment_method]"), "cancel");
    assert.equal(trial.get("subscription_data[metadata][vanteloq_trial_policy]"), SUBSCRIPTION_TRIAL_POLICY);
    assert.match(trial.get("custom_text[submit][message]")!, /first billing date.*Cancel/);
    const paid = await prepareStripeCheckout({ ...input, trialEligible: false });
    assert.equal(paid.has("subscription_data[trial_period_days]"), false);
    assert.equal(paid.get("line_items[0][price]"), trial.get("line_items[0][price]"));
  }
});

test("trial conversion evidence requires a paid invoice for the exact customer, subscription and base item", () => {
  const periodEnd = 1_800_000_000;
  const price = verifiedPrice(PLANS.starter.prices.month.lookupKey);
  const invoice = { status: "paid", currency: "cad", customer: "cus_trial123456", parent: { subscription_details: { subscription: "sub_trial123456" } },
    lines: { has_more: false, data: [{ pricing: { price_details: { price: price.id } }, parent: { subscription_item_details: { subscription_item: "si_trial123456", proration: false } }, period: { end: periodEnd } }] } };
  const object = { id: "sub_trial123456", customer: "cus_trial123456", status: "active", metadata: { vanteloq_organization_id: "org_trial" }, items: { data: [{ id: "si_trial123456", price, current_period_end: periodEnd }] }, latest_invoice: invoice };
  assert.equal(normalizeStripeSubscription(object).paidInvoicePeriodEndsAt?.getTime(), periodEnd * 1000);
  for (const changed of [{ ...invoice, status: "open" }, { ...invoice, currency: "usd" }, { ...invoice, customer: "cus_other123456" }, { ...invoice, parent: {} }, { ...invoice, lines: { ...invoice.lines, has_more: true } }, { ...invoice, lines: { data: [{ ...invoice.lines.data[0], pricing: { price_details: { price: "price_other123456" } } }] } }]) {
    assert.equal(normalizeStripeSubscription({ ...object, latest_invoice: changed }).paidInvoicePeriodEndsAt, null);
  }
  const legacy = { ...invoice, subscription: object.id, lines: { data: [{ subscription_item: "si_trial123456", price, period: { end: periodEnd } }] } };
  assert.equal(normalizeStripeSubscription({ ...object, latest_invoice: legacy }).paidInvoicePeriodEndsAt?.getTime(), periodEnd * 1000);
});

test("fixed catalogue prices reject quarterly, metered and transformed billing", async () => {
  const good=verifiedPrice(PLANS.starter.prices.month.lookupKey);
  for(const bad of [
    {...good,recurring:{...good.recurring,interval_count:3}},
    {...good,recurring:{...good.recurring,usage_type:"metered"}},
    {...good,transform_quantity:{divide_by:10,round:"down"}},
    {...good,billing_scheme:"tiered"},
  ]) {
    await assert.rejects(prepareStripeCheckout({organizationId:"org_price_test",email:"test@example.invalid",plan:"starter",interval:"month",includeBookloq:false,customerId:null,origin:"https://vanteloq.example",fetcher:async()=>Response.json({data:[bad]})}),/does not match/);
    assert.throws(()=>normalizeStripeSubscription({id:"sub_contract1234",customer:"cus_contract1234",status:"active",metadata:{vanteloq_organization_id:"org_price_test"},items:{data:[{price:bad,quantity:1}]}}),/does not match/);
  }
});

test("a malformed recognized add-on cannot become a silent removal",()=>{
  const payload={id:"sub_contract1234",customer:"cus_contract1234",status:"active",metadata:{vanteloq_organization_id:"org_price_test"},items:{data:[{price:verifiedPrice(PLANS.starter.prices.month.lookupKey),quantity:1},{id:"si_addon123456",price:{...verifiedPrice(ADDONS.bookloq.prices.month.lookupKey),unit_amount:1},quantity:1}]}};
  assert.throws(()=>normalizeStripeSubscription(payload),/add-on does not match/);
});

test("normalization rejects duplicate add-ons, invalid quantities and partial item lists", () => {
  const base = { id: "si_base12345678", quantity: 1, price: verifiedPrice(PLANS.starter.prices.month.lookupKey) };
  const addon = { id: "si_addon1234567", quantity: 1, price: verifiedPrice(ADDONS.bookloq.prices.month.lookupKey) };
  const subscription = { id:"sub_123456789", customer:"cus_123456789", status:"active", metadata:{vanteloq_organization_id:"org_verified_123"} };
  for (const items of [{ data:[base,addon,addon] }, { data:[{...base,quantity:2}] }, { data:[base],has_more:true }]) {
    assert.throws(() => normalizeStripeSubscription({...subscription,items}), (error: unknown) => error instanceof ApiError && error.code === "STRIPE_SUBSCRIPTION_PAYLOAD_INVALID");
  }
});

test("normalization rejects standalone BookLoQ combined with the BookLoQ add-on", () => {
  const subscription = {
    id: "sub_bookloq123456",
    customer: "cus_bookloq123456",
    status: "active",
    metadata: { vanteloq_organization_id: "org_bookloq_123" },
    items: { data: [
      { id: "si_bookloqbase123", quantity: 1, price: verifiedPrice(PLANS.bookloq.prices.month.lookupKey) },
      { id: "si_bookloqaddon12", quantity: 1, price: verifiedPrice(ADDONS.bookloq.prices.month.lookupKey) },
    ] },
  };
  assert.throws(
    () => normalizeStripeSubscription(subscription),
    (error: unknown) => error instanceof ApiError && error.code === "STRIPE_SUBSCRIPTION_PAYLOAD_INVALID",
  );
});
