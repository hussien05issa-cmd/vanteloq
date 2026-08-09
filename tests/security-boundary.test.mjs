import assert from "node:assert/strict";
import test from "node:test";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("security-test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

const environment = {
  ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
};
const context = { waitUntil() {}, passThroughOnException() {} };

test("protected onboarding context does not disclose a workspace anonymously", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request("https://vanteloq.example/api/v1/onboarding", {
    headers: { accept: "application/json" },
  }), environment, context);
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.authenticated, false);
  assert.equal(body.organization, null);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  assert.match(response.headers.get("strict-transport-security") ?? "", /max-age=31536000/);
});

test("task APIs reject missing identity before database access", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request("https://vanteloq.example/api/v1/tasks", {
    headers: { accept: "application/json" },
  }), environment, context);
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error.code, "AUTHENTICATION_REQUIRED");
  assert.equal(typeof body.requestId, "string");
  assert.doesNotMatch(JSON.stringify(body), /stack|sql|owner@vanteloq\.local|default-workspace/i);
});

test("business intelligence APIs reject anonymous access before database reads", async () => {
  const worker = await loadWorker();
  for (const path of ["/api/v1/command-centre", "/api/v1/daily-metrics", "/api/v1/events", "/api/v1/operations", "/api/v1/inventory-lifecycle", "/api/v1/bookloq", "/api/v1/governance", "/api/v1/reports", "/api/v1/purchasing", "/api/v1/documents", "/api/v1/data-quality", "/api/v1/integrations", "/api/v1/backend", "/api/v1/billing"]) {
    const response = await worker.fetch(new Request(`https://vanteloq.example${path}`, {
      headers: { accept: "application/json" },
    }), environment, context);
    assert.equal(response.status, 401, path);
    const body = await response.json();
    assert.equal(body.error.code, "AUTHENTICATION_REQUIRED", path);
  }
});

test("Lightspeed management routes reject anonymous same-origin writes", async () => {
  const worker = await loadWorker();
  for (const path of [
    "/api/v1/integrations/lightspeed/authorize",
    "/api/v1/integrations/lightspeed/outlets",
    "/api/v1/integrations/lightspeed/sync",
    "/api/v1/integrations/lightspeed/disconnect",
    "/api/v1/integrations/lightspeed-r/authorize",
    "/api/v1/integrations/lightspeed-r/shops",
    "/api/v1/integrations/lightspeed-r/sync",
    "/api/v1/integrations/lightspeed-r/disconnect",
    "/api/v1/integrations/stripe/authorize",
    "/api/v1/integrations/stripe/sync",
    "/api/v1/integrations/stripe/disconnect",
    "/api/v1/billing/checkout",
    "/api/v1/billing/portal",
  ]) {
    const response = await worker.fetch(new Request(`https://vanteloq.example${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://vanteloq.example",
        "sec-fetch-site": "same-origin",
      },
      body: "{}",
    }), environment, context);
    assert.equal(response.status, 401, path);
    assert.equal((await response.json()).error.code, "AUTHENTICATION_REQUIRED", path);
  }
});

test("the Lightspeed callback rejects malformed one-time state before database access", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request(
    "https://vanteloq.example/api/v1/integrations/lightspeed/callback?code=test-code&state=state-with-entropy&domain_prefix=north-store",
    { headers: { accept: "application/json" } },
  ), environment, context);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "LIGHTSPEED_CALLBACK_INVALID");
});

test("the R-Series callback requires the initiating signed-in owner", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request(
    "https://vanteloq.example/api/v1/integrations/lightspeed-r/callback?code=test-code&state=state-with-entropy",
    { headers: { accept: "application/json" } },
  ), environment, context);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "AUTHENTICATION_REQUIRED");
});

test("the Stripe callback requires the initiating signed-in owner", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request(
    "https://vanteloq.example/api/v1/integrations/stripe/callback?code=test-code&state=state-with-enough-entropy-for-validation",
    { headers: { accept: "application/json" } },
  ), environment, context);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "AUTHENTICATION_REQUIRED");
});

test("the Stripe webhook rejects unsigned requests before database access", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request(
    "https://vanteloq.example/api/v1/integrations/stripe/webhook",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"id":"evt_unsigned","type":"payout.paid","account":"acct_12345678"}',
    },
  ), environment, context);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "STRIPE_WEBHOOK_SIGNATURE_INVALID");
});

test("the Stripe Billing webhook rejects unsigned requests before database access", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request(
    "https://vanteloq.example/api/v1/billing/stripe/webhook",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"id":"evt_unsigned","type":"customer.subscription.updated","created":1786265000}',
    },
  ), environment, context);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "STRIPE_BILLING_SIGNATURE_INVALID");
});

test("the Lightspeed webhook rejects unsigned requests before database access", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request(
    "https://vanteloq.example/api/v1/integrations/lightspeed/webhook",
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "domain_prefix=north-store&payload=%7B%7D",
    },
  ), environment, context);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "LIGHTSPEED_WEBHOOK_SIGNATURE_INVALID");
});

test("state-changing onboarding rejects a cross-site origin before data access", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request("https://vanteloq.example/api/v1/onboarding", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://attacker.example",
      "sec-fetch-site": "cross-site",
      "oai-authenticated-user-email": "owner@example.com",
    },
    body: "{}",
  }), environment, context);
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error.code, "ORIGIN_MISMATCH");
});

test("signup protection fails closed and rejects cross-site account creation", async () => {
  const worker = await loadWorker();
  const availability = await worker.fetch(new Request("https://vanteloq.example/api/v1/auth/signup"), environment, context);
  assert.equal(availability.status, 503);
  assert.deepEqual(await availability.json().then(({ configured }) => ({ configured })), { configured: false });

  const response = await worker.fetch(new Request("https://vanteloq.example/api/v1/auth/signup", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://attacker.example",
      "sec-fetch-site": "cross-site",
    },
    body: JSON.stringify({ name: "Owner", email: "owner@example.com", password: "not-a-real-password", turnstileToken: "not-a-real-token" }),
  }), environment, context);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "ORIGIN_MISMATCH");
});

test("imports and business-memory writes reject cross-site origins before data access", async () => {
  const worker = await loadWorker();
  for (const path of [
    "/api/v1/daily-metrics",
    "/api/v1/events",
    "/api/v1/operations",
    "/api/v1/inventory-lifecycle",
    "/api/v1/growth",
    "/api/v1/bookloq/demo",
    "/api/v1/bookloq/journals",
    "/api/v1/bookloq/actions",
    "/api/v1/governance",
    "/api/v1/purchasing",
    "/api/v1/documents",
    "/api/v1/organization-logo",
    "/api/v1/integrations/lightspeed/authorize",
    "/api/v1/integrations/lightspeed/outlets",
    "/api/v1/integrations/lightspeed/sync",
    "/api/v1/integrations/lightspeed/disconnect",
    "/api/v1/integrations/lightspeed-r/authorize",
    "/api/v1/integrations/lightspeed-r/shops",
    "/api/v1/integrations/lightspeed-r/sync",
    "/api/v1/integrations/lightspeed-r/disconnect",
    "/api/v1/integrations/stripe/authorize",
    "/api/v1/integrations/stripe/sync",
    "/api/v1/integrations/stripe/disconnect",
    "/api/v1/billing/checkout",
    "/api/v1/billing/portal",
  ]) {
    const response = await worker.fetch(new Request(`https://vanteloq.example${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
        "oai-authenticated-user-email": "owner@example.com",
      },
      body: "{}",
    }), environment, context);
    assert.equal(response.status, 403, path);
    const body = await response.json();
    assert.equal(body.error.code, "ORIGIN_MISMATCH", path);
  }
});

test("removed unversioned prototype APIs are unavailable", async () => {
  const worker = await loadWorker();
  for (const path of ["/api/onboarding", "/api/tasks"]) {
    const response = await worker.fetch(new Request(`https://vanteloq.example${path}`), environment, context);
    assert.equal(response.status, 404);
  }
});

test("operational health and API description expose no internal configuration", async () => {
  const worker = await loadWorker();
  const health = await worker.fetch(new Request("https://vanteloq.example/api/health"), environment, context);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok", service: "vanteloq" });

  const openapi = await worker.fetch(new Request("https://vanteloq.example/api/v1/openapi"), environment, context);
  assert.equal(openapi.status, 200);
  const specification = await openapi.json();
  assert.equal(specification.openapi, "3.1.0");
  assert.ok(specification.paths["/tasks"]);
  assert.ok(specification.paths["/command-centre"]);
  assert.ok(specification.paths["/daily-metrics"]);
  assert.ok(specification.paths["/events"]);
  assert.ok(specification.paths["/operations"]);
  assert.ok(specification.paths["/inventory-lifecycle"]);
  assert.ok(specification.paths["/backend"]);
  assert.ok(specification.paths["/bookloq"]);
  assert.equal(specification.paths["/bookloq/demo"], undefined);
  assert.ok(specification.paths["/bookloq/journals"]);
  assert.ok(specification.paths["/bookloq/actions"]);
  assert.doesNotMatch(JSON.stringify(specification), /secret|token|database_id/i);
});
