import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";
import { Miniflare } from "miniflare";
import { registerSupabaseTestServer } from "./helpers/supabase-loopback-transport.mjs";
import { createHmac } from "node:crypto";
import { PLANS, ADDONS, type AddonDefinition, type PlanDefinition } from "../server/entitlements/catalog.ts";
import { navigationEntitlement } from "../domain/navigation-entitlements.ts";

const origin = "https://vanteloq.example";
const executionContext = { waitUntil() {}, passThroughOnException() {} };

function identityHeaders(email: string, write = false) {
  const payload = Buffer.from(JSON.stringify({
    email,
    aal: "aal2",
    session_id: `session:${email}`,
  })).toString("base64url");
  const headers: Record<string, string> = {
    accept: "application/json",
    authorization: `Bearer test.${payload}.signature`,
  };
  if (write) {
    headers["content-type"] = "application/json";
    headers.origin = origin;
    headers["sec-fetch-site"] = "same-origin";
  }
  return headers;
}

function onboardingBody(ownerName: string, businessName: string) {
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  return {
    ownerName,
    businessName,
    legalName: `${businessName} Ltd.`,
    businessEmail: `${businessName.toLowerCase().replace(/[^a-z]/g, "")}@example.invalid`,
    phone: "",
    website: "",
    industry: "Retail",
    country: "CA",
    province: "AB",
    city: "Edmonton",
    address: "1 Test Avenue",
    postalCode: "T5A 1A1",
    emailNotifications: true,
    timezone: "America/Edmonton",
    currency: "CAD",
    fiscalYearStart: "January",
    taxNumber: "",
    hours: days.map((day) => ({ day, open: "10:00", close: "21:00", closed: false })),
    sourceMode: "csv",
    selectedPos: "",
    legalAccepted: true,
    termsVersion: "2026-09-05",
    privacyPolicyVersion: "2026-09-10",
    legalNoticeVersion: "account-creation-v2",
  };
}

async function createEnvironment() {
  const authServer = createServer((request, response) => {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      id: `test-user:${payload.email}`,
      email: payload.email,
      email_confirmed_at: "2026-08-01T00:00:00.000Z",
      user_metadata: { full_name: payload.email },
    }));
  });
  await new Promise<void>((resolve) => authServer.listen(0, "127.0.0.1", resolve));
  const address = authServer.address();
  assert.ok(address && typeof address !== "string");

  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: `vanteloq-bookloq-cash-${crypto.randomUUID()}` },
  });
  const database = await miniflare.getD1Database("DB");
  const migrations = (await readdir(new URL("../drizzle/", import.meta.url)))
    .filter((file) => /^\d{4}.*\.sql$/.test(file))
    .sort();
  for (const migration of migrations) {
    const sql = await readFile(new URL(`../drizzle/${migration}`, import.meta.url), "utf8");
    for (const statement of sql.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
      await database.prepare(statement).run();
    }
  }

  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("bookloq-cash-regression", crypto.randomUUID());
  const worker = (await import(workerUrl.href)).default;
  const environment = {
    DB: database,
    BOOKLOQ_DEMO_ENABLED: "true",
    STRIPE_SECRET_KEY: "sk_test_fake_billing_fixture",
    STRIPE_BILLING_WEBHOOK_SECRET: "whsec_fake_billing_fixture",
    SUPABASE_URL: registerSupabaseTestServer(address.port),
    SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  };
  const dispose = async () => {
    try {
      await miniflare.dispose();
    } finally {
      authServer.closeAllConnections();
      await new Promise<void>((resolve, reject) => authServer.close((error) => error ? reject(error) : resolve()));
    }
  };
  return { worker, environment, database, dispose };
}

async function dispatch(
  worker: { fetch: (request: Request, environment: unknown, context: unknown) => Promise<Response> },
  environment: unknown,
  path: string,
  options: { method?: string; email: string; body?: unknown; idempotencyKey?: string },
) {
  const method = options.method ?? "GET";
  const headers = identityHeaders(options.email, method !== "GET");
  if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;
  return worker.fetch(new Request(`${origin}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  }), environment, executionContext);
}

test("verified subscription events control interface, BookLoQ and server access through the billing lifecycle", async () => {
  const { worker, environment, database, dispose } = await createEnvironment();
  const originalFetch = globalThis.fetch;
  try {
    const email = `billing-${crypto.randomUUID()}@example.invalid`;
    const created = await dispatch(worker, environment, "/api/v1/onboarding", { method: "POST", email, body: onboardingBody("Billing Owner", "Billing Pilot") });
    assert.equal(created.status, 201, await created.clone().text());
    const catalogueResponse = await dispatch(worker, environment, "/api/v1/billing", { email });
    assert.equal(catalogueResponse.status, 200);
    const catalogue = await catalogueResponse.json();
    for (const advertised of catalogue.plans) {
      const definition = PLANS[advertised.key as keyof typeof PLANS];
      const capacity = advertised.included.find((line: string) => line.startsWith("Up to "));
      assert.ok(capacity, `${advertised.key} must disclose its capacity before checkout`);
      const quantities = capacity.match(/\d+/g)?.map(Number);
      assert.deepEqual(quantities, [definition.limits.activeLocations, definition.limits.users]);
      assert.equal(advertised.price, definition.prices.month.amountCents);
    }
    assert.equal(catalogue.addon.price, ADDONS.bookloq.prices.month.amountCents);
    const identity = await database.prepare("SELECT u.id userId, m.organization_id organizationId FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.email=?")
      .bind(email).first<{ userId: string; organizationId: string }>();
    assert.ok(identity);
    const org = identity.organizationId;
    const price = (definition: PlanDefinition | AddonDefinition) => ({ id: `price_${definition.key}12345678`, lookup_key: definition.prices.month.lookupKey, unit_amount: definition.prices.month.amountCents, currency: "cad", recurring: { interval: "month" } });
    let plan: keyof typeof PLANS = "starter";
    let bookloq = false;
    let status = "active";
    let cancelAtPeriodEnd = false;
    let subscriptionId = "sub_billing123456";
    const snapshot = () => ({ id: subscriptionId, customer: "cus_billing123456", status,
      metadata: { vanteloq_organization_id: org }, cancel_at_period_end: cancelAtPeriodEnd,
      items: { data: [ { id: "si_base12345678", quantity: 1, price: price(PLANS[plan]), current_period_end: 1_900_000_000 },
        ...(bookloq ? [{ id: "si_bookloq123456", quantity: 1, price: price(ADDONS.bookloq), current_period_end: 1_900_000_000 }] : []) ] } });
    let delayedFetch: null | (() => Promise<Response>) = null;
    globalThis.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
      if (url.origin === "https://api.stripe.com") {
        if (delayedFetch) { const next = delayedFetch; delayedFetch = null; return next(); }
        return Response.json(snapshot());
      }
      return originalFetch(input, init);
    };
    let sequence = 0;
    const event = (id = `evt_billing${++sequence}12345678`, created = 1_800_000_000 + sequence, eventSub = subscriptionId) => ({ id, created, type: "customer.subscription.updated", data: { object: { id: eventSub, metadata: { vanteloq_organization_id: org } } } });
    const deliver = async (payload: unknown = event()) => {
      const body = JSON.stringify(payload);
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = createHmac("sha256", environment.STRIPE_BILLING_WEBHOOK_SECRET).update(`${timestamp}.${body}`).digest("hex");
      return worker.fetch(new Request(`${origin}/api/v1/billing/stripe/webhook`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": `t=${timestamp},v1=${signature}` }, body }), environment, executionContext);
    };
    const sync = async (payload: unknown = event()) => { const response = await deliver(payload); assert.equal(response.status, 200, await response.clone().text()); return response.json(); };
    const access = async () => { const response = await dispatch(worker, environment, "/api/v1/entitlements", { email }); assert.equal(response.status, 200); return response.json(); };
    const assertAccess = async (expectedPlan: string | null, withBookloq: boolean) => {
      const result = await access();
      assert.equal(result.current.plan, expectedPlan);
      assert.equal(result.current.addons.includes("bookloq"), withBookloq);
      assert.equal(navigationEntitlement("BookLoQ", result.current.features).allowed, withBookloq);
      const report = await dispatch(worker, environment, "/api/v1/bookloq", { email });
      assert.equal(report.status, withBookloq ? 200 : expectedPlan ? 403 : 402, await report.clone().text());
      return result;
    };
    // Browser URL selections never grant paid access.
    assert.equal((await dispatch(worker, environment, "/api/v1/bookloq?plan=pro&bookloq=1", { email })).status, 402);
    // The actual hosted checkout emits two different events in the same second.
    // Force both handlers to observe version zero before either can persist it.
    let pairedReads = 0;
    let releasePair!: () => void;
    const pairReady = new Promise<void>(resolve => { releasePair = resolve; });
    delayedFetch = async function pairedFetch() {
      pairedReads += 1;
      if (pairedReads === 1) delayedFetch = pairedFetch;
      if (pairedReads === 2) { delayedFetch = null; releasePair(); }
      await pairReady;
      return Response.json(snapshot());
    };
    const initial = event();
    const checkout = { ...initial, id: "evt_checkout12345678", type: "checkout.session.completed", data: { object: { subscription: subscriptionId, metadata: { vanteloq_organization_id: org } } } };
    await Promise.all([sync(initial), sync(checkout)]);
    assert.equal(pairedReads, 2);
    const concurrentEvents = await database.prepare("SELECT status FROM stripe_billing_events WHERE event_id IN (?, ?)").bind(initial.id, checkout.id).all<{status:string}>();
    assert.equal(concurrentEvents.results.length, 2);
    assert.ok(concurrentEvents.results.every((row: {status: string}) => row.status === "processed"));
    await assertAccess("starter", false);
    assert.equal((await sync(initial)).duplicate, true);
    bookloq = true; await sync(); await assertAccess("starter", true);
    const seeded = await dispatch(worker, environment, "/api/v1/bookloq/demo", { method: "POST", email, body: {} });
    assert.equal(seeded.status, 201, await seeded.clone().text());
    const records = await database.prepare("SELECT COUNT(*) total FROM journal_entries WHERE organization_id=?").bind(org).first<{total:number}>();
    assert.ok(records && records.total > 0);
    plan = "pro"; bookloq = false; await sync();
    const pro = await assertAccess("pro", false);
    assert.equal(navigationEntitlement("Scenario Planner", pro.current.features).allowed, true);
    bookloq = true; cancelAtPeriodEnd = true; await sync(); await assertAccess("pro", true);
    status = "canceled"; await sync(); await assertAccess(null, false);
    assert.deepEqual(await database.prepare("SELECT COUNT(*) total FROM journal_entries WHERE organization_id=?").bind(org).first(), records);
    subscriptionId = "sub_replacement123"; status = "active"; cancelAtPeriodEnd = false; plan = "growth";
    await sync(); await assertAccess("growth", true);
    // Delayed events cannot roll back a newer confirmed plan.
    assert.equal((await sync(event("evt_stale12345678", 1_700_000_000))).stale, true);
    await assertAccess("growth", true);
    status = "past_due"; await sync(); await assertAccess(null, false);
    const duplicateCheckout = await dispatch(worker, environment, "/api/v1/billing/checkout", { method: "POST", email, body: {plan:"starter",interval:"month",includeBookloq:false} });
    assert.equal(duplicateCheckout.status, 409, await duplicateCheckout.clone().text());
    status = "active"; await sync(); await assertAccess("growth", true);
    // Force an add-on write failure; the base plan and version must also roll back.
    const before = await database.prepare("SELECT base_plan plan, version FROM tenant_subscriptions WHERE organization_id=?").bind(org).first();
    await database.prepare("CREATE TRIGGER fail_addon_update BEFORE UPDATE ON tenant_addons BEGIN SELECT RAISE(ABORT,'test add-on failure'); END").run();
    plan = "starter"; bookloq = false;
    const failedEvent = event(); const failed = await deliver(failedEvent); assert.equal(failed.status, 500);
    assert.deepEqual(await database.prepare("SELECT base_plan plan, version FROM tenant_subscriptions WHERE organization_id=?").bind(org).first(), before);
    await database.prepare("DROP TRIGGER fail_addon_update").run();
    await sync(failedEvent); await assertAccess("starter", false);
    // Two snapshots read the same version. The losing writer retries against current Stripe data.
    let release!: () => void; let started!: () => void;
    const fetched = new Promise<void>(resolve => { started = resolve; });
    const hold = new Promise<void>(resolve => { release = resolve; });
    plan = "growth"; const oldSnapshot = snapshot();
    delayedFetch = async () => { started(); await hold; return Response.json(oldSnapshot); };
    const older = event(); const pending = deliver(older); await fetched;
    plan = "pro"; bookloq = true;
    await sync(); release(); assert.equal((await pending).status, 200); // Older event is ignored atomically.
    await assertAccess("pro", true);
    // A member without finance permissions receives no BookLoQ records even when the organization paid.
    await database.prepare("UPDATE memberships SET role='employee' WHERE organization_id=? AND user_id=?").bind(org, identity.userId).run();
    const roleDenied = await dispatch(worker, environment, "/api/v1/bookloq", { email });
    assert.equal(roleDenied.status, 403, await roleDenied.clone().text());
  } finally { globalThis.fetch = originalFetch; await dispose(); }
});
