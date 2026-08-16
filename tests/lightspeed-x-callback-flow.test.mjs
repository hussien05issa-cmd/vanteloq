import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";
import { Miniflare } from "miniflare";

const origin = "https://vanteloq.example";
const context = { waitUntil() {}, passThroughOnException() {} };

function ownerHeaders(write = false) {
  const payload = Buffer.from(JSON.stringify({
    email: "owner@example.invalid",
    aal: "aal2",
    session_id: "session:owner",
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

async function applyMigrations(database) {
  const migrations = (await readdir(new URL("../drizzle/", import.meta.url)))
    .filter((file) => /^\d{4}.*\.sql$/.test(file))
    .sort();
  for (const migration of migrations) {
    const sql = await readFile(new URL(`../drizzle/${migration}`, import.meta.url), "utf8");
    const statements = sql.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean);
    for (const statement of statements) await database.prepare(statement).run();
  }
}

test("X-Series isolates two retailer accounts and every account action", async () => {
  const authServer = createServer((request, response) => {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      id: `test-user:${payload.email}`,
      email: payload.email,
      email_confirmed_at: "2026-08-01T00:00:00.000Z",
      user_metadata: { full_name: "Test Owner" },
    }));
  });
  await new Promise((resolve) => authServer.listen(0, "127.0.0.1", resolve));
  const authAddress = authServer.address();
  assert.ok(authAddress && typeof authAddress !== "string");
  const authOrigin = `http://127.0.0.1:${authAddress.port}`;
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: `vanteloq-lightspeed-x-${crypto.randomUUID()}` },
  });
  const originalFetch = globalThis.fetch;
  try {
    const database = await miniflare.getD1Database("DB");
    await applyMigrations(database);
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("lightspeed-x-flow", crypto.randomUUID());
    const worker = (await import(workerUrl.href)).default;
    const environment = {
      DB: database,
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
      LIGHTSPEED_X_CLIENT_ID: "test-client-id",
      LIGHTSPEED_X_CLIENT_SECRET: "test-client-secret",
      LIGHTSPEED_X_REDIRECT_URI: `${origin}/api/v1/integrations/lightspeed/callback`,
      LIGHTSPEED_X_API_VERSION: "2026-07",
      LIGHTSPEED_X_TOKEN_ENCRYPTION_KEY: Buffer.from(
        Uint8Array.from({ length: 32 }, (_, index) => index + 1),
      ).toString("base64"),
      SUPABASE_URL: authOrigin,
      SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
    };

    const onboarding = await worker.fetch(new Request(`${origin}/api/v1/onboarding`, {
      method: "POST",
      headers: ownerHeaders(true),
      body: JSON.stringify({
        ownerName: "Test Owner", businessName: "Test Store", legalName: "Test Store Ltd.",
        businessEmail: "store@example.invalid", phone: "", website: "", industry: "Retail",
        country: "CA", province: "AB", city: "Edmonton", address: "1 Test Avenue",
        postalCode: "T5A 1A1", emailNotifications: true, timezone: "America/Edmonton",
        currency: "CAD", fiscalYearStart: "January", taxNumber: "", sourceMode: "connect_later",
        selectedPos: "", legalAccepted: true, termsVersion: "2026-08-16",
        privacyPolicyVersion: "2026-08-16", legalNoticeVersion: "account-creation-v1",
        hours: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
          .map((day) => ({ day, open: "09:00", close: "17:00", closed: false })),
      }),
    }), environment, context);
    assert.equal(onboarding.status, 201);

    let failNorthOutletVerification = false;
    globalThis.fetch = async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (url.origin === authOrigin) return originalFetch(request);
      if (url.pathname === "/api/1.0/token" && url.hostname.endsWith(".retail.lightspeed.app")) {
        return Response.json({
          access_token: `access-${url.hostname}`,
          refresh_token: `refresh-${url.hostname}`,
          expires_in: 3600,
          scope: "outlets:read sales:read",
        });
      }
      if (url.pathname === "/api/2026-07/outlets") {
        if (failNorthOutletVerification && url.hostname.startsWith("north-store.")) {
          return Response.json({ error: "temporary provider failure" }, { status: 503 });
        }
        if (url.searchParams.has("after")) return Response.json({ data: [], version: { max: 1 } });
        return Response.json({ data: [{ id: "outlet-1", name: `${url.hostname} outlet` }], version: { max: 1 } });
      }
      if (url.pathname === "/api/2026-07/sales") {
        if (url.searchParams.has("after")) return Response.json({ data: [], version: { max: 1 } });
        return Response.json({
          data: [{
            id: "sale-1", state: "closed", date: "2026-08-10T15:00:00Z",
            outlet_id: "outlet-1", totals: { total_price: 42.55, total_tax: 2.55 },
            line_items: [{ quantity: 1, pricing: { cost: 18 } }], _metadata: { version: 1 },
          }],
          version: { max: 1 },
        });
      }
      throw new Error(`Unexpected outbound request: ${url.origin}${url.pathname}`);
    };

    const startAuthorization = async () => {
      const authorization = await worker.fetch(new Request(`${origin}/api/v1/integrations/lightspeed/authorize`, {
        method: "POST", headers: ownerHeaders(true), body: "{}",
      }), environment, context);
      assert.equal(authorization.status, 200);
      const body = await authorization.json();
      const state = new URL(body.authorizationUrl).searchParams.get("state");
      assert.match(state ?? "", /^[A-Za-z0-9_-]{43}$/);
      return { body, state };
    };

    const connectAccount = async (domainPrefix) => {
      const { body, state } = await startAuthorization();
      const callback = await worker.fetch(new Request(
        `${origin}/api/v1/integrations/lightspeed/callback?code=test-code&state=${state}&domain_prefix=${domainPrefix}`,
        { headers: { accept: "text/html" } },
      ), environment, context);
      assert.equal(callback.status, 303, await callback.clone().text());
      assert.equal(callback.headers.get("location"), `${origin}/?integration=lightspeed&connection=connected`);
      return body.connectionId;
    };

    const firstConnectionId = await connectAccount("north-store");
    const secondConnectionId = await connectAccount("south-store");
    assert.notEqual(firstConnectionId, secondConnectionId);

    const originalNorth = await database.prepare(`SELECT
      c.status, c.connected_at connectedAt, c.updated_at updatedAt, c.last_error_code lastErrorCode,
      s.access_token_ciphertext accessTokenCiphertext, s.refresh_token_ciphertext refreshTokenCiphertext,
      s.token_expires_at tokenExpiresAt, s.updated_at secretUpdatedAt
      FROM integration_connections c
      INNER JOIN integration_secrets s ON s.connection_id = c.id
      WHERE c.id = ?`).bind(firstConnectionId).first();
    const duplicate = await startAuthorization();
    failNorthOutletVerification = true;
    const duplicateCallback = await worker.fetch(new Request(
      `${origin}/api/v1/integrations/lightspeed/callback?code=duplicate-code&state=${duplicate.state}&domain_prefix=north-store`,
      { headers: { accept: "text/html" } },
    ), environment, context);
    failNorthOutletVerification = false;
    assert.equal(duplicateCallback.status, 303, await duplicateCallback.clone().text());
    assert.equal(duplicateCallback.headers.get("location"), `${origin}/?integration=lightspeed&connection=connected`);
    assert.equal((await database.prepare(
      "SELECT COUNT(*) count FROM integration_connections WHERE id = ?",
    ).bind(duplicate.body.connectionId).first()).count, 0);
    assert.notEqual((await database.prepare(
      "SELECT consumed_at consumedAt FROM integration_oauth_states WHERE connection_id = ?",
    ).bind(duplicate.body.connectionId).first()).consumedAt, null);
    const preservedNorth = await database.prepare(`SELECT
      c.status, c.connected_at connectedAt, c.updated_at updatedAt, c.last_error_code lastErrorCode,
      s.access_token_ciphertext accessTokenCiphertext, s.refresh_token_ciphertext refreshTokenCiphertext,
      s.token_expires_at tokenExpiresAt, s.updated_at secretUpdatedAt
      FROM integration_connections c
      INNER JOIN integration_secrets s ON s.connection_id = c.id
      WHERE c.id = ?`).bind(firstConnectionId).first();
    assert.deepEqual(preservedNorth, originalNorth);

    const declined = await startAuthorization();
    const declinedCallbackUrl = `${origin}/api/v1/integrations/lightspeed/callback?error=access_denied&error_description=do-not-audit-me&state=${declined.state}`;
    const declinedCallback = await worker.fetch(new Request(declinedCallbackUrl, {
      headers: { accept: "text/html" },
    }), environment, context);
    assert.equal(declinedCallback.status, 303, await declinedCallback.clone().text());
    assert.equal(declinedCallback.headers.get("location"), `${origin}/?integration=lightspeed&connection=declined`);
    assert.equal((await database.prepare(
      "SELECT COUNT(*) count FROM integration_connections WHERE id = ?",
    ).bind(declined.body.connectionId).first()).count, 0);
    assert.notEqual((await database.prepare(
      "SELECT consumed_at consumedAt FROM integration_oauth_states WHERE connection_id = ?",
    ).bind(declined.body.connectionId).first()).consumedAt, null);
    const declineAudit = await database.prepare(`SELECT action, resource_id resourceId, details_json detailsJson
      FROM audit_events WHERE action = 'integration.authorization_declined' AND resource_id = ?`).bind(declined.body.connectionId).first();
    assert.equal(declineAudit.action, "integration.authorization_declined");
    assert.equal(declineAudit.resourceId, declined.body.connectionId);
    assert.deepEqual(JSON.parse(declineAudit.detailsJson), {
      provider: "lightspeed",
      connectionId: declined.body.connectionId,
      reason: "provider_declined",
      dataPromotionEnabled: false,
    });
    assert.equal(declineAudit.detailsJson.includes("do-not-audit-me"), false);
    const declinedReplay = await worker.fetch(new Request(declinedCallbackUrl, {
      headers: { accept: "text/html" },
    }), environment, context);
    assert.equal(declinedReplay.status, 400);

    const webhookBody = new URLSearchParams({
      domain_prefix: "south-store",
      payload: JSON.stringify({ type: "sale.update", id: "sale-webhook-1" }),
    }).toString();
    const webhookSignature = createHmac("sha256", environment.LIGHTSPEED_X_CLIENT_SECRET)
      .update(webhookBody)
      .digest("hex");
    const postWebhook = () => worker.fetch(new Request(`${origin}/api/v1/integrations/lightspeed/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-signature": `algorithm=HMAC-SHA256, signature=${webhookSignature}`,
      },
      body: webhookBody,
    }), environment, context);
    assert.equal((await postWebhook()).status, 204);
    assert.equal((await postWebhook()).status, 204);
    const webhookEvents = await database.prepare(`SELECT connection_id connectionId, status, processed_at processedAt
      FROM integration_webhook_events WHERE provider = 'lightspeed' AND external_object_ref = 'sale-webhook-1'`).all();
    assert.equal(webhookEvents.results.length, 1);
    assert.equal(webhookEvents.results[0].connectionId, secondConnectionId);
    assert.equal(webhookEvents.results[0].status, "processed");
    assert.equal(typeof webhookEvents.results[0].processedAt, "number");

    const ambiguousSync = await worker.fetch(new Request(`${origin}/api/v1/integrations/lightspeed/sync`, {
      method: "POST", headers: ownerHeaders(true), body: "{}",
    }), environment, context);
    assert.equal(ambiguousSync.status, 409);
    assert.equal((await ambiguousSync.json()).error.code, "INTEGRATION_CONNECTION_REQUIRED");

    for (const connectionId of [firstConnectionId, secondConnectionId]) {
      const sync = await worker.fetch(new Request(`${origin}/api/v1/integrations/lightspeed/sync`, {
        method: "POST", headers: ownerHeaders(true), body: JSON.stringify({ connectionId }),
      }), environment, context);
      assert.equal(sync.status, 200, await sync.clone().text());
      assert.equal((await sync.json()).run.recordsStaged, 1);
    }

    const connectionCount = await database.prepare(
      "SELECT COUNT(*) count FROM integration_connections WHERE provider = 'lightspeed' AND status = 'connected'",
    ).first();
    const secretCount = await database.prepare(
      "SELECT COUNT(*) count FROM integration_secrets WHERE provider = 'lightspeed'",
    ).first();
    const mappingCount = await database.prepare(
      "SELECT COUNT(*) count FROM integration_location_mappings WHERE provider = 'lightspeed' AND external_location_ref = 'outlet-1'",
    ).first();
    const stagedRows = await database.prepare(
      "SELECT connection_id connectionId, external_sale_id externalSaleId FROM integration_staged_sales WHERE provider = 'lightspeed' ORDER BY connection_id",
    ).all();
    assert.deepEqual(
      { connections: connectionCount.count, secrets: secretCount.count, mappings: mappingCount.count, sales: stagedRows.results.length },
      { connections: 2, secrets: 2, mappings: 2, sales: 2 },
    );
    assert.deepEqual(new Set(stagedRows.results.map((row) => row.connectionId)), new Set([firstConnectionId, secondConnectionId]));
    assert.deepEqual(new Set(stagedRows.results.map((row) => row.externalSaleId)), new Set(["sale-1"]));

    const integrations = await worker.fetch(
      new Request(`${origin}/api/v1/integrations`, { headers: ownerHeaders() }),
      environment,
      context,
    );
    assert.equal(integrations.status, 200);
    const xSeries = (await integrations.json()).integrations.find((provider) => provider.id === "lightspeed");
    assert.equal(xSeries.connectionCount, 2);
    assert.deepEqual(new Set(xSeries.connections.map((row) => row.id)), new Set([firstConnectionId, secondConnectionId]));

    const disconnect = await worker.fetch(new Request(`${origin}/api/v1/integrations/lightspeed/disconnect`, {
      method: "POST", headers: ownerHeaders(true), body: JSON.stringify({ connectionId: firstConnectionId }),
    }), environment, context);
    assert.equal(disconnect.status, 200, await disconnect.clone().text());
    const remaining = await database.prepare(
      "SELECT id, status FROM integration_connections WHERE provider = 'lightspeed' ORDER BY id",
    ).all();
    assert.equal(remaining.results.find((row) => row.id === firstConnectionId).status, "revoked");
    assert.equal(remaining.results.find((row) => row.id === secondConnectionId).status, "connected");
    assert.equal((await database.prepare(
      "SELECT COUNT(*) count FROM integration_secrets WHERE provider = 'lightspeed'",
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
