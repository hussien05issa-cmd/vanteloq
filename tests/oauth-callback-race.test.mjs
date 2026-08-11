import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { Miniflare } from "miniflare";

const origin = "https://vanteloq.example";
const context = { waitUntil() {}, passThroughOnException() {} };

function ownerHeaders(write = false) {
  const headers = {
    accept: "application/json",
    "oai-authenticated-user-email": "oauth-race-owner@example.invalid",
    "oai-authenticated-user-full-name": encodeURIComponent("OAuth Race Owner"),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  };
  if (write) {
    headers["content-type"] = "application/json";
    headers.origin = origin;
    headers["sec-fetch-site"] = "same-origin";
  }
  return headers;
}

async function applyMigrations(database) {
  const migrations = (await readdir(new URL("../drizzle/", import.meta.url)))
    .filter((file) => /^\d{4}.*\.sql$/.test(file))
    .sort();
  for (const migration of migrations) {
    const sql = await readFile(new URL(`../drizzle/${migration}`, import.meta.url), "utf8");
    for (const statement of sql.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
      await database.prepare(statement).run();
    }
  }
}

async function createHarness(label) {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: `vanteloq-oauth-race-${label}-${crypto.randomUUID()}` },
  });
  const database = await miniflare.getD1Database("DB");
  await applyMigrations(database);
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("oauth-race-flow", crypto.randomUUID());
  const worker = (await import(workerUrl.href)).default;
  const encryptionKey = Buffer.from(Uint8Array.from({ length: 32 }, (_, index) => index + 1)).toString("base64");
  const environment = {
    DB: database,
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    LIGHTSPEED_R_CLIENT_ID: "test-r-client-id",
    LIGHTSPEED_R_CLIENT_SECRET: "test-r-client-secret",
    LIGHTSPEED_R_REDIRECT_URI: `${origin}/api/v1/integrations/lightspeed-r/callback`,
    LIGHTSPEED_X_CLIENT_ID: "test-x-client-id",
    LIGHTSPEED_X_CLIENT_SECRET: "test-x-client-secret",
    LIGHTSPEED_X_REDIRECT_URI: `${origin}/api/v1/integrations/lightspeed/callback`,
    LIGHTSPEED_X_API_VERSION: "2026-07",
    LIGHTSPEED_X_TOKEN_ENCRYPTION_KEY: encryptionKey,
    STRIPE_CLIENT_ID: "ca_test_client_12345678",
    STRIPE_SECRET_KEY: "sk_test_platform_12345678",
    STRIPE_REDIRECT_URI: `${origin}/api/v1/integrations/stripe/callback`,
    STRIPE_WEBHOOK_SECRET: "whsec_test_webhook_12345678",
    INTEGRATION_ENCRYPTION_KEY: encryptionKey,
  };
  const onboarding = await worker.fetch(new Request(`${origin}/api/v1/onboarding`, {
    method: "POST",
    headers: ownerHeaders(true),
    body: JSON.stringify({
      ownerName: "OAuth Race Owner", businessName: "OAuth Race Store", legalName: "OAuth Race Store Ltd.",
      businessEmail: "oauth-race-store@example.invalid", phone: "", website: "", industry: "Retail",
      country: "CA", province: "AB", city: "Edmonton", address: "1 Race Avenue",
      postalCode: "T5A 1A1", emailNotifications: true, timezone: "America/Edmonton",
      currency: "CAD", fiscalYearStart: "January", taxNumber: "", sourceMode: "connect_later",
      selectedPos: "", hours: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        .map((day) => ({ day, open: "09:00", close: "17:00", closed: false })),
    }),
  }), environment, context);
  assert.equal(onboarding.status, 201, await onboarding.clone().text());
  return { miniflare, database, worker, environment };
}

test("R-Series callback cannot restore a connection disconnected during token exchange", async () => {
  const originalFetch = globalThis.fetch;
  const harness = await createHarness("lightspeed-r");
  const { miniflare, database, worker, environment } = harness;
  try {
    const authorization = await worker.fetch(new Request(`${origin}/api/v1/integrations/lightspeed-r/authorize`, {
      method: "POST", headers: ownerHeaders(true), body: "{}",
    }), environment, context);
    assert.equal(authorization.status, 200, await authorization.clone().text());
    const authorizationBody = await authorization.json();
    const state = new URL(authorizationBody.authorizationUrl).searchParams.get("state");
    let disconnected = false;
    globalThis.fetch = async (input) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      if (url.origin === "https://cloud.lightspeedapp.com" && url.pathname === "/auth/oauth/token") {
        if (!disconnected) {
          disconnected = true;
          const response = await worker.fetch(new Request(`${origin}/api/v1/integrations/lightspeed-r/disconnect`, {
            method: "POST",
            headers: ownerHeaders(true),
            body: JSON.stringify({ connectionId: authorizationBody.connectionId }),
          }), environment, context);
          assert.equal(response.status, 200, await response.clone().text());
        }
        return Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 });
      }
      if (url.origin === "https://api.lightspeedapp.com" && url.pathname === "/API/V3/Account.json") {
        return Response.json({ Account: { accountID: "123", name: "Race account" } });
      }
      if (url.origin === "https://api.lightspeedapp.com" && url.pathname === "/API/V3/Account/123/Shop.json") {
        return Response.json({ Shop: [{ shopID: "race-shop", name: "Race shop" }], "@attributes": {} });
      }
      throw new Error(`Unexpected outbound request: ${url.origin}${url.pathname}`);
    };

    const callback = await worker.fetch(new Request(
      `${origin}/api/v1/integrations/lightspeed-r/callback?code=${"r".repeat(900)}&state=${state}`,
      { headers: { accept: "text/html" } },
    ), environment, context);
    assert.equal(callback.status, 303, await callback.clone().text());
    assert.equal(callback.headers.get("location"), `${origin}/?integration=lightspeed-r&connection=failed`);
    assert.deepEqual(await database.prepare(`SELECT status, external_account_ref externalAccountRef,
      data_promotion_status dataPromotionStatus FROM integration_connections WHERE id = ?`
    ).bind(authorizationBody.connectionId).first(), {
      status: "revoked",
      externalAccountRef: null,
      dataPromotionStatus: "blocked",
    });
    assert.deepEqual(await database.prepare(`SELECT
      (SELECT COUNT(*) FROM integration_secrets WHERE connection_id = ?) secretCount,
      (SELECT COUNT(*) FROM integration_location_mappings WHERE connection_id = ?) mappingCount`
    ).bind(authorizationBody.connectionId, authorizationBody.connectionId).first(), {
      secretCount: 0,
      mappingCount: 0,
    });
  } finally {
    globalThis.fetch = originalFetch;
    await miniflare.dispose();
  }
});

test("X-Series callback removes artifacts when disconnected during outlet verification", async () => {
  const originalFetch = globalThis.fetch;
  const harness = await createHarness("lightspeed-x");
  const { miniflare, database, worker, environment } = harness;
  try {
    const authorization = await worker.fetch(new Request(`${origin}/api/v1/integrations/lightspeed/authorize`, {
      method: "POST", headers: ownerHeaders(true), body: "{}",
    }), environment, context);
    assert.equal(authorization.status, 200, await authorization.clone().text());
    const authorizationBody = await authorization.json();
    const state = new URL(authorizationBody.authorizationUrl).searchParams.get("state");
    let disconnected = false;
    globalThis.fetch = async (input) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      if (url.origin === "https://race-store.retail.lightspeed.app" && url.pathname === "/api/1.0/token") {
        return Response.json({
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_in: 3600,
          scope: "outlets:read sales:read",
        });
      }
      if (url.origin === "https://race-store.retail.lightspeed.app" && url.pathname === "/api/2026-07/outlets") {
        if (!disconnected) {
          disconnected = true;
          const response = await worker.fetch(new Request(`${origin}/api/v1/integrations/lightspeed/disconnect`, {
            method: "POST",
            headers: ownerHeaders(true),
            body: JSON.stringify({ connectionId: authorizationBody.connectionId }),
          }), environment, context);
          assert.equal(response.status, 200, await response.clone().text());
        }
        return Response.json({ data: [{ id: "race-outlet", name: "Race outlet" }], version: { max: 1 } });
      }
      throw new Error(`Unexpected outbound request: ${url.origin}${url.pathname}`);
    };

    const callback = await worker.fetch(new Request(
      `${origin}/api/v1/integrations/lightspeed/callback?code=x-code&state=${state}&domain_prefix=race-store`,
      { headers: { accept: "text/html" } },
    ), environment, context);
    assert.equal(callback.status, 303, await callback.clone().text());
    assert.equal(callback.headers.get("location"), `${origin}/?integration=lightspeed&connection=failed`);
    assert.deepEqual(await database.prepare(`SELECT status, external_account_ref externalAccountRef,
      data_promotion_status dataPromotionStatus FROM integration_connections WHERE id = ?`
    ).bind(authorizationBody.connectionId).first(), {
      status: "revoked",
      externalAccountRef: null,
      dataPromotionStatus: "blocked",
    });
    assert.deepEqual(await database.prepare(`SELECT
      (SELECT COUNT(*) FROM integration_secrets WHERE connection_id = ?) secretCount,
      (SELECT COUNT(*) FROM integration_location_mappings WHERE connection_id = ?) mappingCount`
    ).bind(authorizationBody.connectionId, authorizationBody.connectionId).first(), {
      secretCount: 0,
      mappingCount: 0,
    });
  } finally {
    globalThis.fetch = originalFetch;
    await miniflare.dispose();
  }
});

test("Stripe callback preserves a connection disconnected during token exchange", async () => {
  const originalFetch = globalThis.fetch;
  const harness = await createHarness("stripe");
  const { miniflare, database, worker, environment } = harness;
  try {
    const authorization = await worker.fetch(new Request(`${origin}/api/v1/integrations/stripe/authorize`, {
      method: "POST", headers: ownerHeaders(true), body: "{}",
    }), environment, context);
    assert.equal(authorization.status, 200, await authorization.clone().text());
    const authorizationBody = await authorization.json();
    const state = new URL(authorizationBody.authorizationUrl).searchParams.get("state");
    let disconnected = false;
    let deauthorizations = 0;
    globalThis.fetch = async (input) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      if (url.origin === "https://connect.stripe.com" && url.pathname === "/oauth/token") {
        if (!disconnected) {
          disconnected = true;
          const response = await worker.fetch(new Request(`${origin}/api/v1/integrations/stripe/disconnect`, {
            method: "POST",
            headers: ownerHeaders(true),
            body: JSON.stringify({ connectionId: authorizationBody.connectionId }),
          }), environment, context);
          assert.equal(response.status, 200, await response.clone().text());
        }
        return Response.json({
          stripe_user_id: "acct_race12345678",
          scope: "read_write",
          livemode: false,
          token_type: "bearer",
        });
      }
      if (url.origin === "https://api.stripe.com" && url.pathname === "/v1/account") {
        return Response.json({ id: "acct_race12345678", livemode: false });
      }
      if (url.origin === "https://connect.stripe.com" && url.pathname === "/oauth/deauthorize") {
        deauthorizations += 1;
        return Response.json({ stripe_user_id: "acct_race12345678" });
      }
      throw new Error(`Unexpected outbound request: ${url.origin}${url.pathname}`);
    };

    const callback = await worker.fetch(new Request(
      `${origin}/api/v1/integrations/stripe/callback?code=stripe-code&state=${state}`,
      { headers: { accept: "text/html" } },
    ), environment, context);
    assert.equal(callback.status, 303, await callback.clone().text());
    assert.equal(callback.headers.get("location"), `${origin}/?integration=stripe&connection=failed`);
    assert.equal(deauthorizations, 1, "the provider grant created after disconnect must be revoked");
    assert.deepEqual(await database.prepare(`SELECT status, external_account_ref externalAccountRef,
      data_promotion_status dataPromotionStatus FROM integration_connections WHERE id = ?`
    ).bind(authorizationBody.connectionId).first(), {
      status: "revoked",
      externalAccountRef: null,
      dataPromotionStatus: "blocked",
    });
  } finally {
    globalThis.fetch = originalFetch;
    await miniflare.dispose();
  }
});

test("Stripe callback never deauthorizes an account used by an existing connection", async () => {
  const originalFetch = globalThis.fetch;
  const harness = await createHarness("stripe-existing");
  const { miniflare, database, worker, environment } = harness;
  try {
    let verificationFails = false;
    let deauthorizations = 0;
    globalThis.fetch = async (input) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      if (url.origin === "https://connect.stripe.com" && url.pathname === "/oauth/token") {
        return Response.json({
          stripe_user_id: "acct_existing12345678",
          scope: "read_write",
          livemode: false,
          token_type: "bearer",
        });
      }
      if (url.origin === "https://api.stripe.com" && url.pathname === "/v1/account") {
        return verificationFails
          ? Response.json({ error: { message: "temporary failure" } }, { status: 503 })
          : Response.json({ id: "acct_existing12345678", livemode: false });
      }
      if (url.origin === "https://connect.stripe.com" && url.pathname === "/oauth/deauthorize") {
        deauthorizations += 1;
        return Response.json({ stripe_user_id: "acct_existing12345678" });
      }
      throw new Error(`Unexpected outbound request: ${url.origin}${url.pathname}`);
    };

    const firstAuthorization = await worker.fetch(new Request(`${origin}/api/v1/integrations/stripe/authorize`, {
      method: "POST", headers: ownerHeaders(true), body: "{}",
    }), environment, context);
    assert.equal(firstAuthorization.status, 200, await firstAuthorization.clone().text());
    const firstBody = await firstAuthorization.json();
    const firstState = new URL(firstBody.authorizationUrl).searchParams.get("state");
    const firstCallback = await worker.fetch(new Request(
      `${origin}/api/v1/integrations/stripe/callback?code=first-code&state=${firstState}`,
      { headers: { accept: "text/html" } },
    ), environment, context);
    assert.equal(firstCallback.headers.get("location"), `${origin}/?integration=stripe&connection=connected`);

    const secondAuthorization = await worker.fetch(new Request(`${origin}/api/v1/integrations/stripe/authorize`, {
      method: "POST", headers: ownerHeaders(true), body: "{}",
    }), environment, context);
    assert.equal(secondAuthorization.status, 200, await secondAuthorization.clone().text());
    const secondBody = await secondAuthorization.json();
    const secondState = new URL(secondBody.authorizationUrl).searchParams.get("state");
    verificationFails = true;
    const secondCallback = await worker.fetch(new Request(
      `${origin}/api/v1/integrations/stripe/callback?code=second-code&state=${secondState}`,
      { headers: { accept: "text/html" } },
    ), environment, context);
    assert.equal(secondCallback.headers.get("location"), `${origin}/?integration=stripe&connection=failed`);
    assert.equal(deauthorizations, 0, "an existing connection's provider grant must be preserved");
    const connectionRows = await database.prepare(`SELECT id, status FROM integration_connections
      WHERE provider = 'stripe' ORDER BY connected_at DESC, created_at ASC`).all();
    assert.deepEqual(connectionRows.results, [
      { id: firstBody.connectionId, status: "connected" },
      { id: secondBody.connectionId, status: "error" },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    await miniflare.dispose();
  }
});
