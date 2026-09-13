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
  const authOrigin = registerSupabaseTestServer(authAddress.port);
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
        selectedPos: "", legalAccepted: true, termsVersion: "2026-09-05",
        privacyPolicyVersion: "2026-09-10", legalNoticeVersion: "account-creation-v2",
        hours: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
          .map((day) => ({ day, open: "09:00", close: "17:00", closed: false })),
      }),
    }), environment, context);
    assert.equal(onboarding.status, 201);
    await activateTestSubscription(database, (await onboarding.json()).organization.id);

    let failNorthOutletVerification = false;
    let saleVersion = 1, corruptSale = false, currency = "CAD";
    globalThis.fetch = async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (url.origin === authOrigin) return originalFetch(request);
      if (url.pathname === "/api/1.0/token" && url.hostname.endsWith(".retail.lightspeed.app")) {
        return Response.json({
          access_token: `access-${url.hostname}`,
          refresh_token: `refresh-${url.hostname}`,
          expires_in: 3600,
          scope: "customers:read inventory:read outlets:read products:read retailer:read sales:read suppliers:read",
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
        if (Number(url.searchParams.get("after") ?? 0) >= saleVersion) return Response.json({ data: [], version: { max: saleVersion } });
        return Response.json({
          data: [{
            id: "sale-1", state: saleVersion === 3 ? "voided" : "closed", date: "2026-08-10T15:00:00Z",
            source: { outlet_id: "outlet-1" }, totals: { price: saleVersion === 2 ? 60 : 40, tax: 2.55, price_incl_tax: saleVersion === 2 ? 62.55 : 42.55 },
            line_items: [{ id: "line-1", product: { id: "product-1" }, quantity: saleVersion === 2 ? 3 : 2, pricing: { total: corruptSale ? 1 : saleVersion === 2 ? 60 : 40, cost: 9 } }], _metadata: { version: saleVersion },
            payments: [{ id: "payment-1", amount: saleVersion === 2 ? 62.55 : 42.55, date: "2026-08-10T15:00:00Z", type: { name: "Cash" } }],
          }],
          version: { max: saleVersion },
        });
      }
      if (url.pathname === "/api/2026-07/retailer") return Response.json({ data: { domain_prefix: url.hostname.split(".")[0], currency: { code: currency } } });
      const catalogs = {
        products: [{ id: "product-1", sku: "CRE", name: "Creatine", product_category: { id: "cat", name: "Performance" }, supply_price: 9, active: true }],
        customers: [{ id: "customer-1", first_name: "Test", email: "do-not-store" }],
        suppliers: [{ id: "supplier-1", name: "Supplier" }],
        inventory: [{ id: "stock-1", product_id: "product-1", outlet_id: "outlet-1", current_inventory_level: 22, reorder_point: 5 }],
      };
      const resource = url.pathname.split("/").at(-1);
      if (catalogs[resource]) {
        const after = resource === "inventory" ? (await request.json()).after : url.searchParams.get("after");
        if (resource === "products" && url.hostname.startsWith("history-store.")) {
          const rows = !after ? [catalogs.products[0], ...Array.from({length:99},(_,i)=>({id:'history-'+i,sku:'H'+i,name:'Historical item '+i}))]
            : Number(after)===100 ? [{id:'history-last',sku:'LAST',name:'Final history item'}] : [];
          return Response.json({data:rows,version:{max:!after?100:101}});
        }
        return Response.json({ data: after ? [] : catalogs[resource], version: { max: 1 } });
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
      const cookie = authorization.headers.get("set-cookie")?.split(";")[0] ?? "";
      assert.equal(cookie, `__Host-vanteloq_lightspeed_oauth=${state}`);
      return { body, state, cookie };
    };

    const connectAccount = async (domainPrefix) => {
      const { body, state, cookie } = await startAuthorization();
      const callback = await worker.fetch(new Request(
        `${origin}/api/v1/integrations/lightspeed/callback?code=test-code&state=${state}&domain_prefix=${domainPrefix}`,
        { headers: { accept: "text/html", cookie } },
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
      { headers: { accept: "text/html", cookie: duplicate.cookie } },
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
      headers: { accept: "text/html", cookie: declined.cookie },
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
      headers: { accept: "text/html", cookie: declined.cookie },
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
    assert.equal(webhookEvents.results[0].status, "queued");
    assert.equal(webhookEvents.results[0].processedAt, null);

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
      assert.ok((await sync.json()).run.recordsStaged >= 7);
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
    assert.equal(new Set(stagedRows.results.map((row) => row.externalSaleId)).size, 2);
    assert.ok(stagedRows.results.every(row => row.externalSaleId.endsWith(":sale-1")));

    const syncNorth = () => worker.fetch(new Request(`${origin}/api/v1/integrations/lightspeed/sync`, { method: "POST", headers: ownerHeaders(true), body: JSON.stringify({ connectionId: firstConnectionId }) }), environment, context);
    const local = await database.prepare("SELECT id FROM organization_locations LIMIT 1").first();
    await database.prepare("UPDATE integration_location_mappings SET status='mapped',local_location_id=? WHERE connection_id=?").bind(local.id,firstConnectionId).run();
    assert.equal((await syncNorth()).status,200);
    const approval = await worker.fetch(new Request(`${origin}/api/v1/integrations`, { method: "POST", headers: ownerHeaders(true), body: JSON.stringify({ action: "approve_data", connectionId: firstConnectionId, confirmed: true }) }), environment, context);
    assert.equal(approval.status,200,await approval.clone().text());
    const publication = await syncNorth();
    assert.equal(publication.status,200,await publication.clone().text());
    assert.equal((await publication.json()).dataPromotionEnabled,true);
    const metric = await database.prepare("SELECT net_sales_cents net,units_sold units,cost_of_goods_cents cost FROM daily_business_metrics WHERE source_connection_id=?").bind(firstConnectionId).first();
    assert.deepEqual(metric,{net:4000,units:2,cost:1800});
    assert.equal((await database.prepare("SELECT on_hand_quantity quantity FROM inventory_balances WHERE source_connection_id=?").bind(firstConnectionId).first()).quantity,22);
    assert.equal((await database.prepare("SELECT category_name category FROM commerce_products WHERE connection_id=?").bind(firstConnectionId).first()).category,"Performance");
    assert.equal((await database.prepare("SELECT email FROM commerce_customers WHERE connection_id=?").bind(firstConnectionId).first()).email,null);
    saleVersion = 2;
    assert.equal((await syncNorth()).status,200);
    assert.equal((await database.prepare("SELECT net_sales_cents net FROM daily_business_metrics WHERE source_connection_id=?").bind(firstConnectionId).first()).net,6000);
    assert.equal((await database.prepare("SELECT COUNT(*) count FROM commerce_sale_lines WHERE connection_id=?").bind(firstConnectionId).first()).count,1);
    saleVersion = 3;
    assert.equal((await syncNorth()).status,200);
    assert.equal((await database.prepare("SELECT COUNT(*) count FROM commerce_sale_lines WHERE connection_id=?").bind(firstConnectionId).first()).count,0);
    assert.equal((await database.prepare("SELECT COUNT(*) count FROM daily_business_metrics WHERE source_connection_id=?").bind(firstConnectionId).first()).count,0);
    assert.equal((await database.prepare("SELECT COUNT(*) count FROM commerce_sale_lines WHERE connection_id=?").bind(secondConnectionId).first()).count,1);
    const checkpointBefore = (await database.prepare("SELECT last_sync_cursor cursor FROM integration_connections WHERE id=?").bind(firstConnectionId).first()).cursor;
    saleVersion = 4; corruptSale = true;
    const corrupt = await syncNorth(); assert.equal(corrupt.status,502);
    assert.equal((await corrupt.json()).error.code,"LIGHTSPEED_RECORDS_INVALID");
    assert.equal((await database.prepare("SELECT last_sync_cursor cursor FROM integration_connections WHERE id=?").bind(firstConnectionId).first()).cursor,checkpointBefore);
    corruptSale = false; currency = "USD";
    assert.equal((await (await syncNorth()).json()).error.code,"LIGHTSPEED_CURRENCY_MISMATCH");
    currency = "CAD";

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
    saleVersion=1; corruptSale=false;
    const historyId=await connectAccount("history-store");
    await database.prepare("UPDATE integration_location_mappings SET status='mapped',local_location_id=? WHERE connection_id=?").bind(local.id,historyId).run();
    const syncHistory=()=>worker.fetch(new Request(`${origin}/api/v1/integrations/lightspeed/sync`,{method:'POST',headers:ownerHeaders(true),body:JSON.stringify({connectionId:historyId})}),environment,context);
    const historyFirst=await syncHistory(); assert.equal(historyFirst.status,200,await historyFirst.clone().text());
    const historyFirstBody=await historyFirst.json(); assert.equal(historyFirstBody.backfillComplete,false); assert.equal(historyFirstBody.reconciliation.inventoryBalances,0);
    const earlyApproval=await worker.fetch(new Request(`${origin}/api/v1/integrations`,{method:'POST',headers:ownerHeaders(true),body:JSON.stringify({action:'approve_data',connectionId:historyId,confirmed:true})}),environment,context);
    assert.equal((await earlyApproval.json()).error.code,'INTEGRATION_HISTORY_INCOMPLETE');
    const historySecond=await syncHistory(); assert.equal(historySecond.status,200,await historySecond.clone().text());
    const historySecondBody=await historySecond.json(); assert.equal(historySecondBody.backfillComplete,true); assert.equal(historySecondBody.reconciliation.inventoryBalances,1);
    assert.equal((await database.prepare("SELECT COUNT(*) count FROM commerce_products WHERE connection_id=?").bind(historyId).first()).count,101);
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
