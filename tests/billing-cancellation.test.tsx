import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import BillingSubscriptionControls, { BillingStatusRecovery } from "../app/billing-subscription-controls";
import { billingRequestMessage } from "../domain/billing-feedback";
import { ApiError } from "../server/api";
import { createStripePortal, normalizeStripeSubscription } from "../server/billing/stripe";
import { PLANS } from "../server/entitlements/catalog";

const runtime = globalThis as typeof globalThis & { __vanteloqEnv?: Record<string, unknown> };
runtime.__vanteloqEnv = { STRIPE_SECRET_KEY: "sk_test_cancel_fixture" };
const customer = "cus_cancel123456";
const subscription = "sub_cancel123456";
const origin = "https://vanteloq.example";
const configuration = { id: "bpc_fixture123456", active: true, is_default: true, features: { subscription_cancel: { enabled: true, mode: "at_period_end" } } };

function stripeFixture(overrides: { config?: unknown; customer?: string; status?: string; url?: string } = {}) {
  const calls: Array<{ path: string; method: string; body: URLSearchParams }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    calls.push({ path: url.pathname, method: request.method, body: new URLSearchParams(await request.text()) });
    if (url.pathname === `/v1/subscriptions/${subscription}`) return Response.json({ id: subscription, customer: overrides.customer ?? customer, status: overrides.status ?? "active" });
    if (url.pathname === "/v1/billing_portal/configurations") {
      assert.equal(request.method, "GET");
      assert.equal(url.searchParams.get("is_default"), "true");
      assert.equal(url.searchParams.get("active"), "true");
      return Response.json({ data: [overrides.config ?? configuration] });
    }
    assert.equal(url.pathname, "/v1/billing_portal/sessions");
    assert.equal(request.method, "POST");
    return Response.json({ url: overrides.url ?? "https://billing.stripe.com/p/session/fixture" });
  };
  return { calls, fetcher };
}

test("cancel opens a period-end Stripe confirmation flow and performs no cancellation or configuration mutation", async () => {
  const f = stripeFixture();
  await createStripePortal(customer, origin, f.fetcher, subscription);
  assert.deepEqual(f.calls.map(({ path, method }) => ({ path, method })), [
    { path: `/v1/subscriptions/${subscription}`, method: "GET" },
    { path: "/v1/billing_portal/configurations", method: "GET" },
    { path: "/v1/billing_portal/sessions", method: "POST" },
  ]);
  const fields = f.calls[2].body;
  assert.equal(fields.get("customer"), customer);
  assert.equal(fields.get("configuration"), configuration.id);
  assert.equal(fields.get("flow_data[type]"), "subscription_cancel");
  assert.equal(fields.get("flow_data[subscription_cancel][subscription]"), subscription);
  assert.equal(fields.get("return_url"), `${origin}/?billing=returned#billing`);
  assert.equal(fields.get("flow_data[after_completion][redirect][return_url]"), `${origin}/?billing=returned#billing`);
});

test("general billing still opens without cancellation configuration or a webhook secret", async () => {
  const f = stripeFixture();
  await createStripePortal(customer, origin, f.fetcher);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].body.has("flow_data[type]"), false);
  assert.equal(f.calls[0].body.get("return_url"), `${origin}/?billing=returned#billing`);
});

test("cancellation verifies tenant billing identity, current subscription and the existing period-end policy", async () => {
  for (const [overrides, code] of [
    [{ customer: "cus_another123456" }, "STRIPE_BILLING_IDENTITY_MISMATCH"],
    [{ status: "canceled" }, "STRIPE_SUBSCRIPTION_ALREADY_ENDED"],
    [{ config: { ...configuration, features: { subscription_cancel: { enabled: true, mode: "immediately" } } } }, "STRIPE_CANCELLATION_CONFIGURATION_REQUIRED"],
    [{ config: { ...configuration, features: { subscription_cancel: { enabled: false, mode: "at_period_end" } } } }, "STRIPE_CANCELLATION_CONFIGURATION_REQUIRED"],
  ] as const) {
    const f = stripeFixture(overrides);
    await assert.rejects(createStripePortal(customer, origin, f.fetcher, subscription), (error: unknown) => error instanceof ApiError && error.code === code);
    assert.equal(f.calls.some(call => call.method !== "GET"), false);
  }
  const f = stripeFixture();
  await assert.rejects(createStripePortal(customer, "https://vanteloq.com", f.fetcher, subscription), (error: unknown) => error instanceof ApiError && error.code === "STRIPE_LIVE_BILLING_REQUIRED");
  assert.equal(f.calls.length, 0);
});

test("portal rejects an untrusted redirect URL", async () => {
  const f = stripeFixture({ url: "https://billing.stripe.com.evil.invalid/session" });
  await assert.rejects(createStripePortal(customer, origin, f.fetcher), (error: unknown) => error instanceof ApiError && error.code === "STRIPE_PORTAL_RESPONSE_INVALID");
});

test("flexible portal cancellation keeps the provider ending date and does not grant or remove access", () => {
  const expected = PLANS.starter.prices.month;
  const payload = {
    id: subscription, customer, status: "active", metadata: { vanteloq_organization_id: "org_fixture" },
    cancel_at_period_end: false, cancel_at: 1_800_500_000,
    items: { data: [{ id: "si_base123456", current_period_end: 1_800_000_000, price: {
      id: "price_fixture123456", lookup_key: expected.lookupKey, currency: "cad", unit_amount: expected.amountCents,
      recurring: { interval: "month", interval_count: 1, usage_type: "licensed" }, type: "recurring", billing_scheme: "per_unit", transform_quantity: null,
    } }] },
  };
  const scheduled = normalizeStripeSubscription(payload);
  assert.equal(scheduled.cancelAtPeriodEnd, true);
  assert.equal(scheduled.currentPeriodEndsAt?.getTime(), 1_800_500_000_000);
  assert.equal(scheduled.status, "active");
  const renewed = normalizeStripeSubscription({ ...payload, cancel_at: null });
  assert.equal(renewed.cancelAtPeriodEnd, false);
  assert.equal(renewed.currentPeriodEndsAt?.getTime(), 1_800_000_000_000);
  assert.equal(normalizeStripeSubscription({ ...payload, status: "canceled" }).cancelAtPeriodEnd, false);
  assert.equal(normalizeStripeSubscription({ ...payload, cancel_at: null, cancel_at_period_end: true }).cancelAtPeriodEnd, true);
});

test("subscription controls expose cancellation for paid, trial and unpaid states and separate permanent deletion", () => {
  const actions = { busy: false, onManage() {}, onCancel() {}, onRefresh() {} };
  for (const status of ["active", "trialing", "past_due", "unpaid", "paused"]) {
    const html = renderToStaticMarkup(<BillingSubscriptionControls {...actions} current={{ status, addons: ["bookloq"], trialEndsAt: "2026-10-10T12:00:00Z", currentPeriodEndsAt: "2026-10-10T12:00:00Z" }}/>);
    assert.match(html, />Cancel subscription<\/button>/);
    assert.match(html, /Opening the page does not cancel/);
    assert.match(html, /Permanent deletion is a separate action/);
    assert.match(html, /records are retained/);
    assert.match(html, /also ends its BookLoQ add-on/);
    assert.match(html, /UTC/);
    if (status === "trialing") assert.match(html, /before the trial ends/);
  }
  const scheduled = renderToStaticMarkup(<BillingSubscriptionControls {...actions} current={{ status: "active", cancelAtPeriodEnd: true, currentPeriodEndsAt: "2026-10-10T12:00:00Z" }}/>);
  assert.match(scheduled, /Cancellation scheduled/);
  assert.doesNotMatch(scheduled, />Cancel subscription<\/button>/);
  assert.match(scheduled, /Recorded subscription end/);
  const standalone = renderToStaticMarkup(<BillingSubscriptionControls {...actions} current={{ plan: "bookloq", status: "active", addons: ["bookloq"] }}/>);
  assert.doesNotMatch(standalone, /BookLoQ add-on/);
});

test("billing recovery distinguishes read timeout, unconfirmed portal opening and stale verified status", () => {
  for (const name of ["TimeoutError", "AbortError"]) {
    const reason = new DOMException("Native exception detail", name);
    assert.equal(billingRequestMessage(reason, "status"), "Billing status took too long to load. Try again.");
    assert.match(billingRequestMessage(reason, "portal"), /did not confirm a subscription change/);
    assert.doesNotMatch(billingRequestMessage(reason, "portal"), /Native exception|cancellation failed|subscription canceled/i);
    assert.match(billingRequestMessage(reason, "checkout"), /Check your subscription status before trying again/);
  }
  const initial = renderToStaticMarkup(<BillingStatusRecovery message="Could not load billing" busy={false} onRetry={() => {}}/>);
  assert.match(initial, /role="alert"/);
  assert.match(initial, />Try again<\/button>/);
  assert.doesNotMatch(initial, /Last verified status/);
  const stale = renderToStaticMarkup(<BillingStatusRecovery message="Could not refresh" stale busy onRetry={() => {}}/>);
  assert.match(stale, /Last verified status shown/);
  assert.match(stale, /disabled=""/);
  assert.match(stale, /Checking status/);
});
