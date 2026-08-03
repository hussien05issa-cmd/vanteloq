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
  assert.doesNotMatch(JSON.stringify(specification), /secret|token|database_id/i);
});

