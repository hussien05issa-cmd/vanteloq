import { getRuntimeEnv } from "../../db";
import { ADDONS, PLANS, type AddonKey, type BillingInterval, type PlanKey, type PurchaseBillingInterval } from "../entitlements/catalog";
import { SUBSCRIPTION_STATUSES, type SubscriptionStatus } from "../entitlements/engine";
import { ApiError } from "../api";

const STRIPE_API = "https://api.stripe.com";
const PRICE_ID = /^price_[A-Za-z0-9]{8,128}$/;
const CUSTOMER_ID = /^cus_[A-Za-z0-9]{8,128}$/;
const SUBSCRIPTION_ID = /^sub_[A-Za-z0-9]{8,128}$/;

type StripePrice = {
  id?: unknown;
  lookup_key?: unknown;
  unit_amount?: unknown;
  currency?: unknown;
  active?: unknown;
  recurring?: { interval?: unknown };
};

export type NormalizedBillingSubscription = {
  organizationId: string;
  customerId: string;
  subscriptionId: string;
  basePlan: PlanKey;
  billingInterval: BillingInterval;
  status: SubscriptionStatus;
  basePriceId: string;
  trialEndsAt: Date | null;
  currentPeriodEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
  addon: null | {
    key: AddonKey;
    itemId: string;
    priceId: string;
    currentPeriodEndsAt: Date | null;
  };
};

export function stripeBillingReadiness() {
  const env = getRuntimeEnv();
  const missing = [
    ["STRIPE_SECRET_KEY", env.STRIPE_SECRET_KEY],
    ["STRIPE_BILLING_WEBHOOK_SECRET", env.STRIPE_BILLING_WEBHOOK_SECRET],
  ].filter((entry) => !entry[1]).map((entry) => entry[0]);
  return { configured: missing.length === 0, missingConfiguration: missing };
}

function secretKey() {
  const value = getRuntimeEnv().STRIPE_SECRET_KEY ?? "";
  if (!value.startsWith("sk_") || value.length > 256) {
    throw new ApiError(503, "STRIPE_BILLING_CONFIGURATION_REQUIRED", "Stripe Billing is not configured yet.");
  }
  return value;
}

function billingWebhookSecret() {
  const value = getRuntimeEnv().STRIPE_BILLING_WEBHOOK_SECRET ?? "";
  if (!value.startsWith("whsec_") || value.length > 256) {
    throw new ApiError(503, "STRIPE_BILLING_CONFIGURATION_REQUIRED", "Stripe Billing webhook verification is not configured yet.");
  }
  return value;
}

async function stripeFormRequest(path: string, fields?: URLSearchParams, method: "GET" | "POST" = "POST", fetcher: typeof fetch = fetch) {
  const url = new URL(path, STRIPE_API);
  if (method === "GET" && fields) url.search = fields.toString();
  const response = await fetcher(url, {
    method,
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${btoa(`${secretKey()}:`)}`,
      ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      "User-Agent": "Vanteloq-Stripe-Billing/1.0",
    },
    body: method === "POST" ? fields : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (response.status === 429) throw new ApiError(503, "STRIPE_BILLING_RATE_LIMITED", "Stripe Billing is temporarily rate limited. Try again shortly.");
  if (!response.ok) throw new ApiError(502, "STRIPE_BILLING_PROVIDER_ERROR", "Stripe Billing could not complete the request.");
  return body;
}

async function resolveVerifiedPrice(plan: PlanKey | AddonKey, interval: BillingInterval, kind: "plan" | "addon", fetcher: typeof fetch) {
  const definition = kind === "plan" ? PLANS[plan as PlanKey] : ADDONS[plan as AddonKey];
  const expected = definition.prices[interval];
  const query = new URLSearchParams({ active: "true", limit: "2" });
  query.append("lookup_keys[]", expected.lookupKey);
  const response = await stripeFormRequest("/v1/prices", query, "GET", fetcher);
  const data = Array.isArray(response.data) ? response.data.filter(isObject) as StripePrice[] : [];
  if (data.length !== 1) throw new ApiError(503, "STRIPE_PRICE_CONFIGURATION_INVALID", `Stripe price ${expected.lookupKey} is missing or duplicated.`);
  const price = data[0];
  if (
    typeof price.id !== "string" || !PRICE_ID.test(price.id) ||
    price.lookup_key !== expected.lookupKey || price.active !== true ||
    price.currency !== "cad" || price.unit_amount !== expected.amountCents ||
    price.recurring?.interval !== interval
  ) {
    throw new ApiError(503, "STRIPE_PRICE_CONFIGURATION_INVALID", `Stripe price ${expected.lookupKey} does not match Vanteloq's verified catalogue.`);
  }
  return price.id;
}

export async function createStripeCheckout(input: {
  organizationId: string;
  email: string;
  plan: PlanKey;
  interval: PurchaseBillingInterval;
  includeBookloq: boolean;
  customerId: string | null;
  origin: string;
  fetcher?: typeof fetch;
}) {
  if (input.interval !== "month") {
    throw new ApiError(400, "BILLING_INTERVAL_UNAVAILABLE", "Vanteloq plans are available month to month.");
  }
  if (!stripeBillingReadiness().configured) throw new ApiError(503, "STRIPE_BILLING_CONFIGURATION_REQUIRED", "Stripe Billing must be configured before checkout can begin.");
  const fetcher = input.fetcher ?? fetch;
  const [basePriceId, addonPriceId] = await Promise.all([
    resolveVerifiedPrice(input.plan, input.interval, "plan", fetcher),
    input.includeBookloq ? resolveVerifiedPrice("bookloq", input.interval, "addon", fetcher) : Promise.resolve(null),
  ]);
  const fields = new URLSearchParams({
    mode: "subscription",
    client_reference_id: input.organizationId,
    success_url: `${input.origin}/?billing=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.origin}/?billing=canceled`,
    "line_items[0][price]": basePriceId,
    "line_items[0][quantity]": "1",
    payment_method_collection: "always",
    "metadata[vanteloq_organization_id]": input.organizationId,
    "metadata[vanteloq_plan]": input.plan,
    "metadata[vanteloq_interval]": input.interval,
    "subscription_data[metadata][vanteloq_organization_id]": input.organizationId,
  });
  if (input.customerId && CUSTOMER_ID.test(input.customerId)) fields.set("customer", input.customerId);
  else fields.set("customer_email", input.email);
  if (addonPriceId) {
    fields.set("line_items[1][price]", addonPriceId);
    fields.set("line_items[1][quantity]", "1");
  }
  const session = await stripeFormRequest("/v1/checkout/sessions", fields, "POST", fetcher);
  const url = typeof session.url === "string" ? session.url : "";
  if (!url.startsWith("https://checkout.stripe.com/")) throw new ApiError(502, "STRIPE_CHECKOUT_RESPONSE_INVALID", "Stripe did not return a secure Checkout URL.");
  return { url };
}

export async function createStripePortal(customerId: string, origin: string, fetcher: typeof fetch = fetch) {
  if (!CUSTOMER_ID.test(customerId)) throw new ApiError(409, "STRIPE_CUSTOMER_REQUIRED", "Complete Stripe checkout before opening billing management.");
  const session = await stripeFormRequest("/v1/billing_portal/sessions", new URLSearchParams({ customer: customerId, return_url: `${origin}/?billing=returned` }), "POST", fetcher);
  const url = typeof session.url === "string" ? session.url : "";
  if (!url.startsWith("https://billing.stripe.com/")) throw new ApiError(502, "STRIPE_PORTAL_RESPONSE_INVALID", "Stripe did not return a secure billing portal URL.");
  return { url };
}

export async function retrieveStripeSubscription(subscriptionId: string, fetcher: typeof fetch = fetch) {
  if (!SUBSCRIPTION_ID.test(subscriptionId)) throw new ApiError(400, "STRIPE_SUBSCRIPTION_INVALID", "Stripe subscription reference is invalid.");
  const query = new URLSearchParams();
  query.append("expand[]", "items.data.price");
  return stripeFormRequest(`/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, query, "GET", fetcher);
}

export function normalizeStripeSubscription(object: Record<string, unknown>): NormalizedBillingSubscription {
  const subscriptionId = string(object.id);
  const customerId = string(object.customer);
  const status = string(object.status) as SubscriptionStatus;
  const metadata = isObject(object.metadata) ? object.metadata : {};
  const organizationId = string(metadata.vanteloq_organization_id);
  if (!SUBSCRIPTION_ID.test(subscriptionId) || !CUSTOMER_ID.test(customerId) || !SUBSCRIPTION_STATUSES.includes(status) || !organizationId || organizationId.length > 200) {
    throw new ApiError(400, "STRIPE_SUBSCRIPTION_PAYLOAD_INVALID", "Stripe subscription data could not be safely mapped.");
  }
  const itemsObject = isObject(object.items) ? object.items : {};
  const items = Array.isArray(itemsObject.data) ? itemsObject.data.filter(isObject) : [];
  let base: { plan: PlanKey; interval: BillingInterval; priceId: string; period: Date | null } | null = null;
  let addon: NormalizedBillingSubscription["addon"] = null;
  for (const item of items) {
    const price = isObject(item.price) ? item.price as StripePrice : {};
    const match = matchCatalogPrice(price);
    if (!match) continue;
    const period = unixDate(item.current_period_end);
    if (match.kind === "plan") {
      if (base) throw new ApiError(400, "STRIPE_SUBSCRIPTION_PAYLOAD_INVALID", "Stripe subscription contains more than one Vanteloq base plan.");
      base = { plan: match.key, interval: match.interval, priceId: string(price.id), period };
    } else {
      addon = { key: match.key, itemId: string(item.id), priceId: string(price.id), currentPeriodEndsAt: period };
    }
  }
  if (!base) throw new ApiError(400, "STRIPE_SUBSCRIPTION_PAYLOAD_INVALID", "Stripe subscription does not contain a verified Vanteloq base plan.");
  return {
    organizationId,
    customerId,
    subscriptionId,
    basePlan: base.plan,
    billingInterval: base.interval,
    status,
    basePriceId: base.priceId,
    trialEndsAt: unixDate(object.trial_end),
    currentPeriodEndsAt: base.period ?? unixDate(object.current_period_end),
    cancelAtPeriodEnd: object.cancel_at_period_end === true,
    addon,
  };
}

function matchCatalogPrice(price: StripePrice): null | { kind: "plan"; key: PlanKey; interval: BillingInterval } | { kind: "addon"; key: AddonKey; interval: BillingInterval } {
  const lookup = string(price.lookup_key);
  for (const [key, definition] of Object.entries(PLANS)) {
    for (const interval of ["month", "year"] as const) {
      const expected = definition.prices[interval];
      if (lookup === expected.lookupKey && validPrice(price, expected.amountCents, interval)) return { kind: "plan", key: key as PlanKey, interval };
    }
  }
  for (const [key, definition] of Object.entries(ADDONS)) {
    for (const interval of ["month", "year"] as const) {
      const expected = definition.prices[interval];
      if (lookup === expected.lookupKey && validPrice(price, expected.amountCents, interval)) return { kind: "addon", key: key as AddonKey, interval };
    }
  }
  return null;
}

function validPrice(price: StripePrice, amountCents: number, interval: BillingInterval) {
  return typeof price.id === "string" && PRICE_ID.test(price.id) && price.currency === "cad" && price.unit_amount === amountCents && price.recurring?.interval === interval;
}

export async function verifyStripeBillingSignature(body: Uint8Array, header: string | null, nowSeconds = Math.floor(Date.now() / 1000)) {
  const parts = (header ?? "").split(",").map((part) => part.trim().split("=", 2));
  const timestampText = parts.find(([key]) => key === "t")?.[1] ?? "";
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value).filter(Boolean);
  const timestamp = /^\d{10}$/.test(timestampText) ? Number(timestampText) : null;
  if (timestamp === null || !signatures.length || Math.abs(nowSeconds - timestamp) > 300) return false;
  const prefix = new TextEncoder().encode(`${timestamp}.`);
  const signed = new Uint8Array(prefix.length + body.length);
  signed.set(prefix); signed.set(body, prefix.length);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(billingWebhookSecret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, asArrayBuffer(signed)));
  const expected = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return signatures.some((signature) => constantTimeEqual(signature.toLowerCase(), expected));
}

export async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", asArrayBuffer(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function unixDate(value: unknown) {
  const seconds = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(seconds) && seconds > 0 ? new Date(seconds * 1000) : null;
}
function string(value: unknown) { return typeof value === "string" ? value : ""; }
function isObject(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function asArrayBuffer(bytes: Uint8Array): ArrayBuffer { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer; }
function constantTimeEqual(left: string, right: string) {
  const a = new TextEncoder().encode(left); const b = new TextEncoder().encode(right);
  let mismatch = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) mismatch |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return mismatch === 0;
}
