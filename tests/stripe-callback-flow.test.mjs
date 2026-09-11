import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";
import { Miniflare } from "miniflare";
import { registerSupabaseTestServer } from "./helpers/supabase-loopback-transport.mjs";
import { activateTestSubscription } from "./helpers/subscription-fixture.mjs";

const origin = "https://vanteloq.example";
const context = { waitUntil() {}, passThroughOnException() {} };

function ownerHeaders(write = false, email = "stripe-owner@example.invalid") {
  const payload = Buffer.from(JSON.stringify({
    email,
    full_name: "Stripe Owner",
    aal: "aal2",
    session_id: `session:${email}`,
  })).toString("base64url");
  const headers = {
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

function onboardingPayload(businessName, businessEmail) {
  return {
    ownerName: "Stripe Owner", businessName, legalName: `${businessName} Ltd.`,
    businessEmail, phone: "", website: "", industry: "Retail",
    country: "CA", province: "AB", city: "Edmonton", address: "1 Test Avenue",
    postalCode: "T5A 1A1", emailNotifications: true, timezone: "America/Edmonton",
    currency: "CAD", fiscalYearStart: "January", taxNumber: "", sourceMode: "connect_later",
    selectedPos: "", legalAccepted: true, termsVersion: "2026-09-05",
    privacyPolicyVersion: "2026-09-10", legalNoticeVersion: "account-creation-v2",
    hours: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
      .map((day) => ({ day, open: "09:00", close: "17:00", closed: false })),
  };
}

function signedWebhookRequest(event, secret) {
  const body = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return new Request(`${origin}/api/v1/integrations/stripe/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": `t=${timestamp},v1=${signature}`,
    },
    body,
  });
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

test("Stripe callback ownership and signed webhooks preserve unambiguous tenant lineage", async () => {
  const authServer = createServer((request, response) => {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      id: `test-user:${payload.email}`,
      email: payload.email,
      email_confirmed_at: "2026-08-01T00:00:00.000Z",
      user_metadata: { full_name: payload.full_name },
    }));
  });
  await new Promise((resolve) => authServer.listen(0, "127.0.0.1", resolve));
  const authAddress = authServer.address();
  assert.ok(authAddress && typeof authAddress !== "string");
  const authOrigin = registerSupabaseTestServer(authAddress.port);
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: `vanteloq-stripe-${crypto.randomUUID()}` },
  });
  const originalFetch = globalThis.fetch;
  try {
    const database = await miniflare.getD1Database("DB");
    await applyMigrations(database);
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("stripe-flow", crypto.randomUUID());
    const worker = (await import(workerUrl.href)).default;
    const environment = {
      DB: database,
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
      SUPABASE_URL: authOrigin,
      SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
      STRIPE_CLIENT_ID: "ca_test_client_12345678",
      STRIPE_SECRET_KEY: "sk_test_platform_12345678",
      STRIPE_REDIRECT_URI: `${origin}/api/v1/integrations/stripe/callback`,
      STRIPE_WEBHOOK_SECRET: "whsec_test_webhook_12345678",
      SUPABASE_URL: authOrigin,
      SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
    };

    const onboarding = await worker.fetch(new Request(`${origin}/api/v1/onboarding`, {
      method: "POST",
      headers: ownerHeaders(true),
      body: JSON.stringify(onboardingPayload("Stripe Store", "stripe-store@example.invalid")),
    }), environment, context);
    assert.equal(onboarding.status, 201);
    await activateTestSubscription(database, (await onboarding.json()).organization.id);

    const authorization = await worker.fetch(new Request(`${origin}/api/v1/integrations/stripe/authorize`, {
      method: "POST", headers: ownerHeaders(true), body: "{}",
    }), environment, context);
    assert.equal(authorization.status, 200, await authorization.clone().text());
    const authorizationBody = await authorization.json();
    const state = new URL(authorizationBody.authorizationUrl).searchParams.get("state");
    assert.match(state ?? "", /^[A-Za-z0-9_-]{43}$/);

    globalThis.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      if (url.origin === authOrigin) return originalFetch(input, init);
      if (url.origin === "https://connect.stripe.com" && url.pathname === "/oauth/token") {
        return Response.json({ stripe_user_id: "acct_12345678", scope: "read_only", livemode: false, token_type: "bearer" });
      }
      if (url.origin === "https://api.stripe.com" && url.pathname === "/v1/account") {
        assert.equal(new Headers(init?.headers).get("stripe-account"), "acct_12345678");
        return Response.json({ id: "acct_12345678", livemode: false });
      }
      throw new Error(`Unexpected outbound request: ${url.origin}${url.pathname}`);
    };

    const callbackUrl = `${origin}/api/v1/integrations/stripe/callback?code=test-code&state=${state}`;
    const browserCookie = authorization.headers.get("set-cookie").split(";")[0];
    const wrongBrowser = await worker.fetch(new Request(callbackUrl, { headers: { accept: "application/json" } }), environment, context);
    assert.equal(wrongBrowser.status, 400);
    assert.equal((await wrongBrowser.json()).error.code, "OAUTH_BROWSER_BINDING_INVALID");
    const callback = await worker.fetch(new Request(callbackUrl, { headers: { accept: "text/html", cookie: browserCookie } }), environment, context);
    assert.equal(callback.status, 303, await callback.clone().text());
    assert.equal(callback.headers.get("location"), `${origin}/?integration=stripe&connection=connected`);
    const originalConnection = await database.prepare(
      "SELECT id, organization_id organizationId, status, external_account_ref accountRef FROM integration_connections WHERE id = ?",
    ).bind(authorizationBody.connectionId).first();
    assert.equal(originalConnection.id, authorizationBody.connectionId);
    assert.equal(typeof originalConnection.organizationId, "string");
    assert.equal(originalConnection.status, "connected");
    assert.equal(originalConnection.accountRef, "acct_12345678");
    assert.equal(typeof (await database.prepare(
      "SELECT consumed_at consumedAt FROM integration_oauth_states WHERE connection_id = ?",
    ).bind(authorizationBody.connectionId).first()).consumedAt, "number");

    const replay = await worker.fetch(new Request(callbackUrl, { headers: { accept: "application/json", cookie: browserCookie } }), environment, context);
    assert.equal(replay.status, 400);
    assert.equal((await replay.json()).error.code, "STRIPE_STATE_INVALID");
    assert.equal((await database.prepare(
      "SELECT status FROM integration_connections WHERE id = ?",
    ).bind(authorizationBody.connectionId).first()).status, "connected");

    const webhookEvent = {
      id: "evt_stripe_lineage_0001",
      type: "balance.available",
      account: "acct_12345678",
      data: { object: { id: "txn_stripe_lineage_0001" } },
    };
    const webhook = await worker.fetch(
      signedWebhookRequest(webhookEvent, environment.STRIPE_WEBHOOK_SECRET), environment, context,
    );
    assert.equal(webhook.status, 200, await webhook.clone().text());
    assert.deepEqual(await webhook.json(), { received: true, duplicate: false, processed: true, queued: false });
    const receipt = await database.prepare(`
      SELECT organization_id organizationId, connection_id connectionId, status,
             processed_at processedAt, external_object_ref externalObjectRef
      FROM integration_webhook_events WHERE provider = 'stripe'
    `).first();
    assert.equal(receipt.organizationId, originalConnection.organizationId);
    assert.equal(receipt.connectionId, authorizationBody.connectionId);
    assert.equal(receipt.status, "processed");
    assert.equal(typeof receipt.processedAt, "number");
    assert.equal(receipt.externalObjectRef, "txn_stripe_lineage_0001");

    await database.prepare(`
      UPDATE integration_webhook_events SET status = 'queued', processed_at = NULL
      WHERE provider = 'stripe' AND connection_id = ?
    `).bind(authorizationBody.connectionId).run();
    const replayedWebhook = await worker.fetch(
      signedWebhookRequest(webhookEvent, environment.STRIPE_WEBHOOK_SECRET), environment, context,
    );
    assert.equal(replayedWebhook.status, 200, await replayedWebhook.clone().text());
    assert.deepEqual(await replayedWebhook.json(), { received: true, duplicate: true, processed: true, queued: false });
    assert.equal((await database.prepare(
      "SELECT COUNT(*) count FROM integration_webhook_events WHERE provider = 'stripe'",
    ).first()).count, 1);
    const replayedReceipt = await database.prepare(`
      SELECT status, processed_at processedAt
      FROM integration_webhook_events WHERE provider = 'stripe' AND connection_id = ?
    `).bind(authorizationBody.connectionId).first();
    assert.equal(replayedReceipt.status, "processed");
    assert.equal(typeof replayedReceipt.processedAt, "number");

    const duplicateAuthorization = await worker.fetch(new Request(`${origin}/api/v1/integrations/stripe/authorize`, {
      method: "POST", headers: ownerHeaders(true), body: "{}",
    }), environment, context);
    assert.equal(duplicateAuthorization.status, 200, await duplicateAuthorization.clone().text());
    const duplicateAuthorizationBody = await duplicateAuthorization.json();
    const duplicateState = new URL(duplicateAuthorizationBody.authorizationUrl).searchParams.get("state");
    const duplicateCallback = await worker.fetch(new Request(
      `${origin}/api/v1/integrations/stripe/callback?code=duplicate-code&state=${duplicateState}`,
      { headers: { accept: "text/html", cookie: duplicateAuthorization.headers.get("set-cookie").split(";")[0] } },
    ), environment, context);
    assert.equal(duplicateCallback.status, 303, await duplicateCallback.clone().text());
    assert.equal(duplicateCallback.headers.get("location"), `${origin}/?integration=stripe&connection=connected`);
    assert.equal(await database.prepare(
      "SELECT id FROM integration_connections WHERE id = ?",
    ).bind(duplicateAuthorizationBody.connectionId).first(), null);
    assert.deepEqual(await database.prepare(`
      SELECT id, status, external_account_ref accountRef
      FROM integration_connections
      WHERE organization_id = ? AND provider = 'stripe'
    `).bind(originalConnection.organizationId).all().then((result) => result.results), [{
      id: authorizationBody.connectionId,
      status: "connected",
      accountRef: "acct_12345678",
    }]);

    const secondEmail = "stripe-second-owner@example.invalid";
    const secondOnboarding = await worker.fetch(new Request(`${origin}/api/v1/onboarding`, {
      method: "POST",
      headers: ownerHeaders(true, secondEmail),
      body: JSON.stringify(onboardingPayload("Second Stripe Store", "second-stripe-store@example.invalid")),
    }), environment, context);
    assert.equal(secondOnboarding.status, 201, await secondOnboarding.clone().text());
    const secondOrganizationId = (await secondOnboarding.json()).organization.id;
    await activateTestSubscription(database, secondOrganizationId);
    const crossTenantAuthorization = await worker.fetch(new Request(`${origin}/api/v1/integrations/stripe/authorize`, {
      method: "POST", headers: ownerHeaders(true, secondEmail), body: "{}",
    }), environment, context);
    assert.equal(crossTenantAuthorization.status, 200, await crossTenantAuthorization.clone().text());
    const crossTenantAuthorizationBody = await crossTenantAuthorization.json();
    const crossTenantState = new URL(crossTenantAuthorizationBody.authorizationUrl).searchParams.get("state");
    const crossTenantCallback = await worker.fetch(new Request(
      `${origin}/api/v1/integrations/stripe/callback?code=cross-tenant-code&state=${crossTenantState}`,
      { headers: { accept: "text/html", cookie: crossTenantAuthorization.headers.get("set-cookie").split(";")[0] } },
    ), environment, context);
    assert.equal(crossTenantCallback.status, 303, await crossTenantCallback.clone().text());
    assert.equal(crossTenantCallback.headers.get("location"), `${origin}/?integration=stripe&connection=failed`);
    assert.deepEqual(await database.prepare(`
      SELECT status, external_account_ref accountRef
      FROM integration_connections WHERE id = ?
    `).bind(crossTenantAuthorizationBody.connectionId).first(), { status: "error", accountRef: null });
    assert.deepEqual(await database.prepare(`
      SELECT id, organization_id organizationId
      FROM integration_connections
      WHERE provider = 'stripe' AND status = 'connected' AND external_account_ref = 'acct_12345678'
    `).all().then((result) => result.results), [{
      id: authorizationBody.connectionId,
      organizationId: originalConnection.organizationId,
    }]);

    const historicalConnectionId = crypto.randomUUID();
    const now = Date.now();
    // Simulate duplicate legacy rows that predate the global provider/account
    // uniqueness guard so the webhook ambiguity defense remains covered.
    await database.prepare("DROP INDEX integration_connections_provider_external_account_unique").run();
    await database.prepare(`
      INSERT INTO integration_connections (
        id, organization_id, provider, source_namespace, status, external_account_ref,
        external_account_name, scopes_json, data_promotion_status, connected_at, created_at, updated_at
      ) VALUES (?, ?, 'stripe', ?, 'connected', 'acct_12345678', 'Historical duplicate',
        '[]', 'blocked', ?, ?, ?)
    `).bind(historicalConnectionId, secondOrganizationId, historicalConnectionId, now, now, now).run();

    const ambiguousEvent = {
      id: "evt_stripe_lineage_0002",
      type: "payout.updated",
      account: "acct_12345678",
      data: { object: { id: "po_stripe_lineage_0002" } },
    };
    const ambiguousWebhook = await worker.fetch(
      signedWebhookRequest(ambiguousEvent, environment.STRIPE_WEBHOOK_SECRET), environment, context,
    );
    assert.equal(ambiguousWebhook.status, 409, await ambiguousWebhook.clone().text());
    assert.equal((await ambiguousWebhook.json()).error.code, "STRIPE_CONNECTION_AMBIGUOUS");
    assert.equal((await database.prepare(
      "SELECT COUNT(*) count FROM integration_webhook_events WHERE provider = 'stripe'",
    ).first()).count, 1);
  } finally {
    globalThis.fetch = originalFetch;
    try {
      await miniflare.dispose();
    } finally {
      authServer.closeAllConnections();
      await new Promise((resolve, reject) => authServer.close((error) => error ? reject(error) : resolve()));
    }
  }
});
