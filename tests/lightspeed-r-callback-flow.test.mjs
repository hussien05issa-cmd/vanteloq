import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";
import { Miniflare } from "miniflare";
import { registerSupabaseTestServer } from "./helpers/supabase-loopback-transport.mjs";
import { activateTestSubscription } from "./helpers/subscription-fixture.mjs";

const origin = "https://vanteloq.example";
const context = { waitUntil() {}, passThroughOnException() {} };

function ownerHeaders(write = false) {
  const payload = Buffer.from(JSON.stringify({ email: "owner@example.invalid", aal: "aal2", session_id: "session:owner" })).toString("base64url");
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

test("R-Series completes a browser callback using the initiating one-time state", async () => {
  const authServer = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      id: "test-user:owner@example.invalid",
      email: "owner@example.invalid",
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
    d1Databases: { DB: `vanteloq-lightspeed-r-${crypto.randomUUID()}` },
  });
  const originalFetch = globalThis.fetch;
  try {
    const database = await miniflare.getD1Database("DB");
    await applyMigrations(database);
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("lightspeed-r-flow", crypto.randomUUID());
    const worker = (await import(workerUrl.href)).default;
    const environment = {
      DB: database,
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
      LIGHTSPEED_R_CLIENT_ID: "test-client-id",
      LIGHTSPEED_R_CLIENT_SECRET: "test-client-secret",
      LIGHTSPEED_R_REDIRECT_URI: `${origin}/api/v1/integrations/lightspeed-r/callback`,
      INTEGRATION_ENCRYPTION_KEY: Buffer.from(Uint8Array.from({ length: 32 }, (_, index) => index + 1)).toString("base64"),
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

    const misconfiguredEnvironment = { ...environment };
    delete misconfiguredEnvironment.LIGHTSPEED_R_CLIENT_SECRET;
    const misconfiguredAuthorization = await worker.fetch(new Request(
      `${origin}/api/v1/integrations/lightspeed-r/authorize`,
      { method: "POST", headers: ownerHeaders(true), body: "{}" },
    ), misconfiguredEnvironment, context);
    assert.equal(misconfiguredAuthorization.status, 503, await misconfiguredAuthorization.clone().text());
    assert.deepEqual(await database.prepare(`SELECT
      (SELECT COUNT(*) FROM integration_connections WHERE provider = 'lightspeed-r') connectionCount,
      (SELECT COUNT(*) FROM integration_oauth_states WHERE provider = 'lightspeed-r') stateCount,
      (SELECT COUNT(*) FROM audit_events WHERE action = 'integration.authorization_started'
        AND details_json LIKE '%lightspeed-r%') auditCount`).first(), {
      connectionCount: 0,
      stateCount: 0,
      auditCount: 0,
    });

    const authorization = await worker.fetch(new Request(`${origin}/api/v1/integrations/lightspeed-r/authorize`, {
      method: "POST", headers: ownerHeaders(true), body: "{}",
    }), environment, context);
    assert.equal(authorization.status, 200);
    const authorizationBody = await authorization.json();
    const authorizationUrl = new URL(authorizationBody.authorizationUrl);
    assert.equal(typeof authorizationBody.connectionId, "string");
    const state = authorizationUrl.searchParams.get("state");
    assert.match(state ?? "", /^[A-Za-z0-9_-]{43}$/);

    let failShopVerification = false;
    let failOptionalVendorRead = false;
    let injectSyncWarning = false;
    let emptyCatalogPage = false;
    let catalogSince = null;
    const mockLightspeedFetch = async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (url.origin === authOrigin) return originalFetch(request);
      if (url.origin === "https://cloud.lightspeedapp.com" && url.pathname === "/auth/oauth/token") {
        return Response.json({ access_token: "access-token", refresh_token: "refresh-token", expires_in: 3600 });
      }
      if (url.origin === "https://api.lightspeedapp.com" && url.pathname === "/API/V3/Account.json") {
        return Response.json({ Account: { accountID: "123", name: "Test R-Series account" } });
      }
      if (url.origin === "https://api.lightspeedapp.com" && url.pathname === "/API/V3/Account/123/Shop.json") {
        if (failShopVerification) {
          return Response.json({ error: "temporary provider outage" }, { status: 503 });
        }
        return Response.json({ Shop: [{ shopID: "1", name: "Main shop" }], "@attributes": {} });
      }
      if (url.origin === "https://api.lightspeedapp.com" && url.pathname === "/API/V3/Account/123/Sale.json") {
        return Response.json({
          Sale: [
            {
              saleID: "sale-100", timeStamp: injectSyncWarning ? "2026-08-10T16:00:00Z" : "2026-08-09T16:00:00Z", completeTime: "2026-08-09T15:58:00-06:00",
              completed: "true", voided: "false", shopID: "1", total: injectSyncWarning ? "205.00" : "105.00", taxTotal: "5.00",
              calcFIFOCost: injectSyncWarning ? "80.00" : "40.00", calcDiscount: "2.00", SaleLines: { SaleLine: [{ saleLineID: "line-1" }, { saleLineID: "line-2" }] },
              SalePayments: { SalePayment: [{ salePaymentID: "payment-1", paymentTypeID: "card-1", amount: "105.00" }] },
            },
            ...(injectSyncWarning ? [{ completed: "true", total: "999.00" }] : []),
          ],
          "@attributes": {},
        });
      }
      if (url.origin === "https://api.lightspeedapp.com" && url.pathname === "/API/V3/Account/123/PaymentType.json") {
        return Response.json({ PaymentType: [{ paymentTypeID: "card-1", name: "Visa" }], "@attributes": {} });
      }
      if (url.origin === "https://api.lightspeedapp.com" && url.pathname === "/API/V3/Account/123/Item.json") {
        assert.deepEqual(JSON.parse(url.searchParams.get("load_relations")), ["ItemShops", "ItemPrices", "Category"], "catalogue relations include prices and readable category names");
        catalogSince = url.searchParams.get("timeStamp");
        if (emptyCatalogPage) return Response.json({ Item: [], "@attributes": {} });
        return Response.json({
          Item: [
            {
              itemID: "item-1", description: "Creatine A", customSku: "CRE-A", categoryID: "12", Category: { fullPathName: "Performance/Creatine" },
              ItemShops: { ItemShop: [{ shopID: "1", qoh: "45", reorderPoint: "24" }] },
            },
          ],
          "@attributes": {},
        });
      }
      if (url.origin === "https://api.lightspeedapp.com" && url.pathname === "/API/V3/Account/123/SaleLine.json") {
        return Response.json({
          SaleLine: [
            { saleLineID: "line-1", saleID: "sale-100", itemID: "item-1", shopID: "1", unitQuantity: "1", calcSubtotal: "52.00", calcLineDiscount: "1.00", calcTransactionDiscount: "1.00", calcFIFOCost: "20.00" },
            { saleLineID: "line-2", saleID: "sale-100", itemID: "item-1", shopID: "1", unitQuantity: "1", calcSubtotal: "50.00", calcFIFOCost: "20.00" },
          ],
          "@attributes": {},
        });
      }
      if (url.origin === "https://api.lightspeedapp.com" && url.pathname === "/API/V3/Account/123/Customer.json") {
        return Response.json({
          Customer: [{ customerID: "customer-1", firstName: "Ada", lastName: "Lovelace", Contact: { email: "ada@example.invalid", phone: "555-0100" } }],
          "@attributes": {},
        });
      }
      if (url.origin === "https://api.lightspeedapp.com" && url.pathname === "/API/V3/Account/123/Vendor.json") {
        if (failOptionalVendorRead) {
          return Response.json({ error: "temporary vendor endpoint outage" }, { status: 503 });
        }
        return Response.json({
          Vendor: [{ vendorID: "vendor-1", name: "North Supply", accountNumber: "NS-14", Contact: { email: "orders@example.invalid" } }],
          "@attributes": {},
        });
      }
      throw new Error(`Unexpected outbound request: ${url.origin}${url.pathname}`);
    };
    globalThis.fetch = mockLightspeedFetch;

    const longCode = "a".repeat(900);
    const callback = await worker.fetch(new Request(
      `${origin}/api/v1/integrations/lightspeed-r/callback?code=${longCode}&state=${state}`,
      { headers: { accept: "text/html", cookie: authorization.headers.get("set-cookie").split(";")[0] } },
    ), environment, context);
    assert.equal(callback.status, 303);
    assert.equal(callback.headers.get("location"), `${origin}/?integration=lightspeed-r&connection=connected`);

    const connection = await database.prepare(
      "SELECT id, organization_id, status, external_account_ref, data_promotion_status FROM integration_connections WHERE provider = 'lightspeed-r'",
    ).first();
    assert.equal(typeof connection?.id, "string");
    assert.equal(connection.id, authorizationBody.connectionId);
    assert.equal(typeof connection.organization_id, "string");
    assert.deepEqual(connection, {
      id: connection.id,
      organization_id: connection.organization_id,
      status: "connected",
      external_account_ref: "123",
      data_promotion_status: "blocked",
    });
    const oauthState = await database.prepare(
      "SELECT consumed_at FROM integration_oauth_states WHERE provider = 'lightspeed-r'",
    ).first();
    assert.equal(typeof oauthState?.consumed_at, "number");

    const declinedAuthorization = await worker.fetch(new Request(
      `${origin}/api/v1/integrations/lightspeed-r/authorize`,
      { method: "POST", headers: ownerHeaders(true), body: "{}" },
    ), environment, context);
    assert.equal(declinedAuthorization.status, 200);
    const declinedAuthorizationBody = await declinedAuthorization.json();
    const declinedState = new URL(declinedAuthorizationBody.authorizationUrl).searchParams.get("state");
    assert.match(declinedState ?? "", /^[A-Za-z0-9_-]{43}$/);
    const declinedCallbackUrl = `${origin}/api/v1/integrations/lightspeed-r/callback?error=access_denied&error_description=do-not-audit-me&state=${declinedState}`;
    const declinedCallback = await worker.fetch(new Request(declinedCallbackUrl, {
      headers: { accept: "text/html", cookie: declinedAuthorization.headers.get("set-cookie").split(";")[0] },
    }), environment, context);
    assert.equal(declinedCallback.status, 303, await declinedCallback.clone().text());
    assert.equal(declinedCallback.headers.get("location"), `${origin}/?integration=lightspeed-r&connection=declined`);
    assert.equal((await database.prepare(
      "SELECT COUNT(*) count FROM integration_connections WHERE id = ?",
    ).bind(declinedAuthorizationBody.connectionId).first()).count, 0);
    assert.notEqual((await database.prepare(
      "SELECT consumed_at consumedAt FROM integration_oauth_states WHERE connection_id = ?",
    ).bind(declinedAuthorizationBody.connectionId).first()).consumedAt, null);
    const declinedAudit = await database.prepare(`SELECT action, resource_id resourceId, details_json detailsJson
      FROM audit_events WHERE action = 'integration.authorization_declined' AND resource_id = ?`
    ).bind(declinedAuthorizationBody.connectionId).first();
    assert.equal(declinedAudit.action, "integration.authorization_declined");
    assert.equal(declinedAudit.resourceId, declinedAuthorizationBody.connectionId);
    assert.deepEqual(JSON.parse(declinedAudit.detailsJson), {
      provider: "lightspeed-r",
      connectionId: declinedAuthorizationBody.connectionId,
      reason: "provider_declined",
      dataPromotionEnabled: false,
    });
    assert.equal(declinedAudit.detailsJson.includes("do-not-audit-me"), false);
    const declinedReplay = await worker.fetch(new Request(declinedCallbackUrl, {
      headers: { accept: "text/html" },
    }), environment, context);
    assert.equal(declinedReplay.status, 400);

    const originalConnection = await database.prepare(`SELECT
      c.status, c.connected_at connectedAt, c.updated_at updatedAt,
      c.last_error_code lastErrorCode, c.data_promotion_status dataPromotionStatus,
      s.access_token_ciphertext accessTokenCiphertext,
      s.refresh_token_ciphertext refreshTokenCiphertext,
      s.token_expires_at tokenExpiresAt, s.updated_at secretUpdatedAt
      FROM integration_connections c
      INNER JOIN integration_secrets s ON s.connection_id = c.id
      WHERE c.id = ?`).bind(connection.id).first();
    const duplicateAuthorization = await worker.fetch(new Request(
      `${origin}/api/v1/integrations/lightspeed-r/authorize`,
      { method: "POST", headers: ownerHeaders(true), body: "{}" },
    ), environment, context);
    assert.equal(duplicateAuthorization.status, 200);
    const duplicateAuthorizationBody = await duplicateAuthorization.json();
    const duplicateState = new URL(duplicateAuthorizationBody.authorizationUrl).searchParams.get("state");
    assert.match(duplicateState ?? "", /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(duplicateAuthorizationBody.connectionId, connection.id);
    failShopVerification = true;
    const duplicateCallback = await worker.fetch(new Request(
      `${origin}/api/v1/integrations/lightspeed-r/callback?code=${"b".repeat(900)}&state=${duplicateState}`,
      { headers: { accept: "text/html", cookie: duplicateAuthorization.headers.get("set-cookie").split(";")[0] } },
    ), environment, context);
    failShopVerification = false;
    assert.equal(duplicateCallback.status, 303, await duplicateCallback.clone().text());
    assert.equal(duplicateCallback.headers.get("location"), `${origin}/?integration=lightspeed-r&connection=connected`);
    assert.equal((await database.prepare(
      "SELECT COUNT(*) count FROM integration_connections WHERE id = ?",
    ).bind(duplicateAuthorizationBody.connectionId).first()).count, 0);
    assert.notEqual((await database.prepare(
      "SELECT consumed_at consumedAt FROM integration_oauth_states WHERE connection_id = ?",
    ).bind(duplicateAuthorizationBody.connectionId).first()).consumedAt, null);
    const preservedConnection = await database.prepare(`SELECT
      c.status, c.connected_at connectedAt, c.updated_at updatedAt,
      c.last_error_code lastErrorCode, c.data_promotion_status dataPromotionStatus,
      s.access_token_ciphertext accessTokenCiphertext,
      s.refresh_token_ciphertext refreshTokenCiphertext,
      s.token_expires_at tokenExpiresAt, s.updated_at secretUpdatedAt
      FROM integration_connections c
      INNER JOIN integration_secrets s ON s.connection_id = c.id
      WHERE c.id = ?`).bind(connection.id).first();
    assert.deepEqual(preservedConnection, originalConnection);

    const automaticDiscovery = await worker.fetch(new Request(`${origin}/api/v1/integrations/lightspeed-r/shops`, {
      method: "POST",
      headers: ownerHeaders(true),
      body: JSON.stringify({ action: "discover", connectionId: connection.id }),
    }), environment, context);
    assert.equal(automaticDiscovery.status, 200, await automaticDiscovery.clone().text());
    const automaticDiscoveryBody = await automaticDiscovery.json();
    assert.equal(automaticDiscoveryBody.autoMapped, 1);
    assert.equal(automaticDiscoveryBody.mappings[0].status, "mapped");
    assert.equal(automaticDiscoveryBody.mappings[0].localLocationId, automaticDiscoveryBody.localLocations[0].id);
    // Preserve this test's explicit warning-gate scenario after verifying the
    // single-shop/single-location production convenience path.
    await database.prepare(`UPDATE integration_location_mappings
      SET local_location_id = NULL, status = 'unmapped'
      WHERE connection_id = ?`).bind(connection.id).run();

    const sync = await worker.fetch(new Request(`${origin}/api/v1/integrations/lightspeed-r/sync`, {
      method: "POST", headers: ownerHeaders(true), body: JSON.stringify({ reason: "manual", connectionId: connection.id }),
    }), environment, context);
    assert.equal(sync.status, 200, await sync.clone().text());
    const syncBody = await sync.json();
    assert.equal(syncBody.dataPromotionEnabled, false);
    assert.equal(syncBody.stagingOnly, true);
    assert.deepEqual(syncBody.imported, {
      dailyMetrics: 0,
      inventoryBalances: 0,
      products: 1,
      customers: 1,
      suppliers: 1,
      saleLines: 0,
      payments: 0,
    });
    assert.equal(
      (await database.prepare("SELECT COUNT(*) count FROM commerce_products").first()).count,
      1,
      "valid catalog records remain normalized even while sale publication is staged",
    );
    assert.equal(
      (await database.prepare("SELECT COUNT(*) count FROM commerce_customers").first()).count,
      1,
      "valid customer records remain normalized independently of a sale-page warning",
    );
    assert.equal(
      (await database.prepare("SELECT COUNT(*) count FROM commerce_suppliers").first()).count,
      1,
      "valid supplier records remain normalized independently of a sale-page warning",
    );

    assert.equal(
      (await database.prepare("SELECT COUNT(*) count FROM daily_business_metrics").first()).count,
      0,
      "staged connector data must not reach operating metrics before approval",
    );
    assert.equal(
      (await database.prepare("SELECT COUNT(*) count FROM inventory_balances").first()).count,
      0,
      "staged connector inventory must remain outside canonical balances before approval",
    );
    assert.equal(
      (await database.prepare("SELECT COUNT(*) count FROM commerce_payments").first()).count,
      0,
      "unmapped shop data must stay outside canonical commerce tables",
    );
    const promoted = await database.prepare(
      "SELECT data_promotion_status FROM integration_connections WHERE provider = 'lightspeed-r'",
    ).first();
    assert.deepEqual(promoted, { data_promotion_status: "staging" });

    const shops = await worker.fetch(new Request(
      `${origin}/api/v1/integrations/lightspeed-r/shops?connection=${connection.id}`,
      { headers: ownerHeaders() },
    ), environment, context);
    assert.equal(shops.status, 200, await shops.clone().text());
    const shopsBody = await shops.json();
    assert.equal(shopsBody.mappings.length, 1);
    assert.equal(shopsBody.localLocations.length, 1);
    const mapping = await worker.fetch(new Request(`${origin}/api/v1/integrations/lightspeed-r/shops`, {
      method: "POST",
      headers: ownerHeaders(true),
      body: JSON.stringify({
        connectionId: connection.id,
        externalLocationRef: "1",
        localLocationId: shopsBody.localLocations[0].id,
        status: "mapped",
      }),
    }), environment, context);
    assert.equal(mapping.status, 200, await mapping.clone().text());

    const reviewedSync = await worker.fetch(new Request(`${origin}/api/v1/integrations/lightspeed-r/sync`, {
      method: "POST", headers: ownerHeaders(true), body: JSON.stringify({ reason: "manual", connectionId: connection.id }),
    }), environment, context);
    assert.equal(reviewedSync.status, 200, await reviewedSync.clone().text());
    const reviewedSyncBody = await reviewedSync.json();
    assert.equal(reviewedSyncBody.run.warningCount, 0);
    assert.deepEqual(reviewedSyncBody.imported, {
      dailyMetrics: 0,
      inventoryBalances: 1,
      products: 1,
      customers: 1,
      suppliers: 1,
      saleLines: 2,
      payments: 1,
    });
    const payment = await database.prepare(
      "SELECT external_sale_id, payment_type_name, category, amount_cents FROM commerce_payments",
    ).first();
    assert.deepEqual(payment, {
      external_sale_id: `${connection.id}:sale-100`,
      payment_type_name: "Visa",
      category: "card",
      amount_cents: 10_500,
    });
    emptyCatalogPage = true;
    await database.prepare("UPDATE integration_connections SET last_sync_cursor=? WHERE id=?").bind(JSON.stringify({ version: 4, watermark: '2099-01-01T00:00:00Z' }), connection.id).run();
    const linesOnlySync = await worker.fetch(new Request(`${origin}/api/v1/integrations/lightspeed-r/sync`, {
      method: "POST", headers: ownerHeaders(true), body: JSON.stringify({ reason: "manual", connectionId: connection.id }),
    }), environment, context);
    assert.equal(linesOnlySync.status, 200, await linesOnlySync.clone().text());
    assert.equal(catalogSince, null, "the old normalization checkpoint must trigger a full catalogue repair");
    assert.deepEqual(await database.prepare("SELECT SUM(net_sales_cents) net, SUM(discount_cents) discounts FROM commerce_sale_lines WHERE connection_id=?").bind(connection.id).first(), { net: 10000, discounts: 200 });
    assert.deepEqual(await database.prepare("SELECT name,sku,category_name AS categoryName FROM commerce_products WHERE connection_id=?").bind(connection.id).first(), { name: "Creatine A", sku: "CRE-A", categoryName: "Performance/Creatine" }, "sale-line fallback identities must not erase the verified Item catalogue");
    emptyCatalogPage = false;

    const reviewedRun = await database.prepare(`SELECT
      cursor_before cursorBefore, cursor_after cursorAfter,
      started_at startedAt, completed_at completedAt
      FROM integration_sync_runs
      WHERE organization_id = ? AND provider = 'lightspeed-r' AND connection_id = ?
        AND mode = 'incremental' AND warning_count = 0
      ORDER BY rowid DESC LIMIT 1`
    ).bind(connection.organization_id, connection.id).first();
    assert.equal(typeof reviewedRun.startedAt, "number");
    assert.equal(typeof reviewedRun.completedAt, "number");
    const insertTiedRun = (id, warningCount) => database.prepare(`INSERT INTO integration_sync_runs
      (id, organization_id, provider, connection_id, mode, status, cursor_before, cursor_after,
       records_read, records_staged, duplicates_skipped, warning_count, started_at, completed_at)
      VALUES (?, ?, 'lightspeed-r', ?, 'incremental', 'completed', ?, ?, 0, 0, 0, ?, ?, ?)`
    ).bind(
      id, connection.organization_id, connection.id,
      reviewedRun.cursorBefore, reviewedRun.cursorAfter, warningCount,
      reviewedRun.startedAt, reviewedRun.completedAt,
    ).run();
    await insertTiedRun(`zz-tied-warning-${connection.id}`, 1);
    await insertTiedRun(`aa-tied-clean-${connection.id}`, 0);

    const discoveryAt = Date.now() + 1_000;
    await database.prepare(`INSERT INTO integration_sync_runs
      (id, organization_id, provider, connection_id, mode, status, started_at, completed_at)
      VALUES (?, ?, 'lightspeed-r', ?, 'discovery', 'completed', ?, ?)`)
      .bind(`post-sync-discovery-${connection.id}`, connection.organization_id, connection.id, discoveryAt, discoveryAt)
      .run();

    const approval = await worker.fetch(new Request(`${origin}/api/v1/integrations`, {
      method: "POST",
      headers: ownerHeaders(true),
      body: JSON.stringify({ action: "approve_data", connectionId: connection.id, confirmed: true }),
    }), environment, context);
    assert.equal(approval.status, 200, await approval.clone().text());
    const approvalBody = await approval.json();
    assert.equal(approvalBody.publicationPending, true);
    assert.equal(
      approvalBody.nextStep,
      "Run one final R-Series sync to publish the reviewed data to dashboard features.",
    );
    const authorizedPublication = await database.prepare(`SELECT data_promotion_status dataPromotionStatus,
      promotion_authorized_at promotionAuthorizedAt
      FROM integration_connections WHERE id = ?`).bind(connection.id).first();
    assert.equal(authorizedPublication.dataPromotionStatus, "staging");
    assert.equal(typeof authorizedPublication.promotionAuthorizedAt, "number");

    const discoveryCountBeforeLease = (await database.prepare(`SELECT COUNT(*) count
      FROM integration_sync_runs WHERE connection_id = ? AND mode = 'discovery'`
    ).bind(connection.id).first()).count;
    await database.prepare(`UPDATE integration_connections
      SET sync_lease_owner = ?, sync_lease_expires_at = ?, sync_version = sync_version + 1
      WHERE id = ?`
    ).bind("test-active-publication-lease", Math.floor(Date.now() / 1_000) + 300, connection.id).run();

    const leasedDiscovery = await worker.fetch(new Request(`${origin}/api/v1/integrations/lightspeed-r/shops`, {
      method: "POST",
      headers: ownerHeaders(true),
      body: JSON.stringify({ action: "discover", connectionId: connection.id }),
    }), environment, context);
    assert.equal(leasedDiscovery.status, 409, await leasedDiscovery.clone().text());
    assert.equal((await leasedDiscovery.json()).error.code, "INTEGRATION_SYNC_IN_PROGRESS");
    assert.equal((await database.prepare(`SELECT COUNT(*) count
      FROM integration_sync_runs WHERE connection_id = ? AND mode = 'discovery'`
    ).bind(connection.id).first()).count, discoveryCountBeforeLease);

    const leasedMapping = await worker.fetch(new Request(`${origin}/api/v1/integrations/lightspeed-r/shops`, {
      method: "POST",
      headers: ownerHeaders(true),
      body: JSON.stringify({
        connectionId: connection.id,
        externalLocationRef: "1",
        localLocationId: null,
        status: "ignored",
      }),
    }), environment, context);
    assert.equal(leasedMapping.status, 409, await leasedMapping.clone().text());
    assert.equal((await leasedMapping.json()).error.code, "INTEGRATION_SYNC_IN_PROGRESS");
    assert.deepEqual(
      await database.prepare(`SELECT status, local_location_id localLocationId
        FROM integration_location_mappings WHERE connection_id = ? AND external_location_ref = '1'`
      ).bind(connection.id).first(),
      { status: "mapped", localLocationId: shopsBody.localLocations[0].id },
    );
    assert.deepEqual(
      await database.prepare(`SELECT data_promotion_status dataPromotionStatus,
        promotion_authorized_at promotionAuthorizedAt
        FROM integration_connections WHERE id = ?`).bind(connection.id).first(),
      authorizedPublication,
    );

    await database.prepare(`UPDATE integration_connections
      SET sync_lease_owner = NULL, sync_lease_expires_at = NULL WHERE id = ?`
    ).bind(connection.id).run();
    const authorizationRevokingMapping = await worker.fetch(new Request(`${origin}/api/v1/integrations/lightspeed-r/shops`, {
      method: "POST",
      headers: ownerHeaders(true),
      body: JSON.stringify({
        connectionId: connection.id,
        externalLocationRef: "1",
        localLocationId: shopsBody.localLocations[0].id,
        status: "mapped",
      }),
    }), environment, context);
    assert.equal(authorizationRevokingMapping.status, 200, await authorizationRevokingMapping.clone().text());
    assert.deepEqual(
      await database.prepare(`SELECT data_promotion_status dataPromotionStatus,
        promotion_authorized_at promotionAuthorizedAt
        FROM integration_connections WHERE id = ?`).bind(connection.id).first(),
      { dataPromotionStatus: "staging", promotionAuthorizedAt: null },
    );

    failOptionalVendorRead = true;
    const reReviewedSync = await worker.fetch(new Request(`${origin}/api/v1/integrations/lightspeed-r/sync`, {
      method: "POST", headers: ownerHeaders(true), body: JSON.stringify({ reason: "manual", connectionId: connection.id }),
    }), environment, context);
    assert.equal(reReviewedSync.status, 200, await reReviewedSync.clone().text());
    const reReviewedBody = await reReviewedSync.json();
    assert.equal(reReviewedBody.run.warningCount, 0);
    assert.deepEqual(reReviewedBody.coverageWarnings, ["suppliers"]);
    assert.equal(reReviewedBody.readyForReview, true, `verified staged sales should be reviewable while an optional catalog backfill retries: ${JSON.stringify(reReviewedBody)}`);
    const reapproval = await worker.fetch(new Request(`${origin}/api/v1/integrations`, {
      method: "POST",
      headers: ownerHeaders(true),
      body: JSON.stringify({ action: "approve_data", connectionId: connection.id, confirmed: true }),
    }), environment, context);
    assert.equal(reapproval.status, 200, await reapproval.clone().text());
    failOptionalVendorRead = false;

    const promotedSync = await worker.fetch(new Request(`${origin}/api/v1/integrations/lightspeed-r/sync`, {
      method: "POST", headers: ownerHeaders(true), body: JSON.stringify({ reason: "manual", connectionId: connection.id }),
    }), environment, context);
    assert.equal(promotedSync.status, 200, await promotedSync.clone().text());
    assert.equal((await promotedSync.json()).dataPromotionEnabled, true);
    assert.deepEqual(
      await database.prepare(`SELECT data_promotion_status dataPromotionStatus,
        promotion_authorized_at promotionAuthorizedAt
        FROM integration_connections WHERE id = ?`).bind(connection.id).first(),
      { dataPromotionStatus: "approved", promotionAuthorizedAt: null },
    );
    const metric = await database.prepare(`
      SELECT business_date, location_ref, gross_sales_cents, net_sales_cents, cost_of_goods_cents,
             transaction_count, units_sold, refunds_cents, discounts_cents
      FROM daily_business_metrics
    `).first();
    assert.deepEqual(metric, {
      business_date: "2026-08-09", location_ref: `lightspeed-r:${connection.id}:1`, gross_sales_cents: 10_200,
      net_sales_cents: 10_000, cost_of_goods_cents: 4_000, transaction_count: 1,
      units_sold: 2, refunds_cents: 0, discounts_cents: 200,
    });
    const balance = await database.prepare(`
      SELECT location_ref, sku, name, on_hand_quantity, reorder_point FROM inventory_balances
    `).first();
    assert.deepEqual(balance, {
      location_ref: `lightspeed-r:${connection.id}:1`, sku: "CRE-A", name: "Creatine A", on_hand_quantity: 45, reorder_point: 24,
    });

    failOptionalVendorRead = true;
    const partialCoverageSync = await worker.fetch(new Request(`${origin}/api/v1/integrations/lightspeed-r/sync`, {
      method: "POST", headers: ownerHeaders(true), body: JSON.stringify({ reason: "manual", connectionId: connection.id }),
    }), environment, context);
    assert.equal(partialCoverageSync.status, 200, await partialCoverageSync.clone().text());
    const partialCoverageBody = await partialCoverageSync.json();
    assert.equal(partialCoverageBody.dataPromotionEnabled, true);
    assert.equal(partialCoverageBody.publishedCanonical, true);
    assert.equal(partialCoverageBody.run.warningCount, 0);
    assert.deepEqual(partialCoverageBody.coverageWarnings, ["suppliers"]);
    const partialCheckpoint = JSON.parse(partialCoverageBody.run.cursorPreserved);
    assert.equal(partialCheckpoint.salesComplete, false, "a secondary outage must not let later sales fall outside the retry window");
    assert.equal(partialCheckpoint.suppliersComplete, false);
    assert.deepEqual(
      await database.prepare(`SELECT data_promotion_status dataPromotionStatus, last_error_code lastErrorCode
        FROM integration_connections WHERE id = ?`).bind(connection.id).first(),
      { dataPromotionStatus: "approved", lastErrorCode: null },
    );
    assert.deepEqual(await database.prepare(`
      SELECT business_date, location_ref, gross_sales_cents, net_sales_cents, cost_of_goods_cents,
             transaction_count, units_sold, refunds_cents, discounts_cents
      FROM daily_business_metrics WHERE source_connection_id = ?
    `).bind(connection.id).first(), metric);
    failOptionalVendorRead = false;

    const beforeWarning = await database.prepare(`
      SELECT data_promotion_status dataPromotionStatus,
             last_successful_sync_at lastSuccessfulSyncAt,
             last_sync_cursor lastSyncCursor
      FROM integration_connections WHERE id = ?
    `).bind(connection.id).first();
    injectSyncWarning = true;
    const warningSync = await worker.fetch(new Request(`${origin}/api/v1/integrations/lightspeed-r/sync`, {
      method: "POST", headers: ownerHeaders(true), body: JSON.stringify({ reason: "manual", connectionId: connection.id }),
    }), environment, context);
    assert.equal(warningSync.status, 200, await warningSync.clone().text());
    const warningBody = await warningSync.json();
    assert.ok(warningBody.run.warningCount > 0);
    assert.equal(warningBody.publishedCanonical, false);
    assert.equal(warningBody.usingLastApprovedData, true);
    assert.equal(warningBody.dataPromotionEnabled, true);
    assert.deepEqual(
      await database.prepare(`
        SELECT data_promotion_status dataPromotionStatus,
               last_successful_sync_at lastSuccessfulSyncAt,
               last_sync_cursor lastSyncCursor,
               last_error_code lastErrorCode
        FROM integration_connections WHERE id = ?
      `).bind(connection.id).first(),
      { ...beforeWarning, lastErrorCode: "LIGHTSPEED_R_RECONCILIATION_WARNINGS" },
    );
    assert.deepEqual(await database.prepare(`
      SELECT business_date, location_ref, gross_sales_cents, net_sales_cents, cost_of_goods_cents,
             transaction_count, units_sold, refunds_cents, discounts_cents
      FROM daily_business_metrics WHERE source_connection_id = ?
    `).bind(connection.id).first(), metric);
    assert.deepEqual(await database.prepare(`
      SELECT location_ref, sku, name, on_hand_quantity, reorder_point
      FROM inventory_balances WHERE source_connection_id = ?
    `).bind(connection.id).first(), balance);
    assert.deepEqual(await database.prepare(`
      SELECT COUNT(*) count, MAX(total_cents) maximumTotalCents
      FROM integration_staged_sales WHERE connection_id = ?
    `).bind(connection.id).first(), { count: 2, maximumTotalCents: 20_500 },
    "warning runs may stage valid source versions for review, but must not publish them as approved dashboard data");
    injectSyncWarning = false;

    const command = await worker.fetch(new Request(`${origin}/api/v1/command-centre`, {
      headers: ownerHeaders(),
    }), environment, context);
    assert.equal(command.status, 200);
    const commandBody = await command.json();
    assert.equal(commandBody.commandCentre.ready, true);
    assert.equal(commandBody.commandCentre.source.rowCount, 1);

    const inventory = await worker.fetch(new Request(`${origin}/api/v1/inventory-lifecycle`, {
      headers: ownerHeaders(),
    }), environment, context);
    assert.equal(inventory.status, 200);
    const inventoryBody = await inventory.json();
    assert.equal(inventoryBody.summary.posSkus, 1);
    assert.equal(inventoryBody.summary.posUnits, 45);
    assert.equal(inventoryBody.posBalances[0].sku, "CRE-A");

    const secondAuthorization = await worker.fetch(new Request(`${origin}/api/v1/integrations/lightspeed-r/authorize`, {
      method: "POST", headers: ownerHeaders(true), body: "{}",
    }), environment, context);
    assert.equal(secondAuthorization.status, 200);
    const secondAuthorizationBody = await secondAuthorization.json();
    const secondState = new URL(secondAuthorizationBody.authorizationUrl).searchParams.get("state");
    assert.match(secondState ?? "", /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(secondAuthorizationBody.connectionId, connection.id);

    globalThis.fetch = async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (url.origin === authOrigin) return originalFetch(request);
      if (url.origin === "https://cloud.lightspeedapp.com" && url.pathname === "/auth/oauth/token") {
        return Response.json({ access_token: "access-token-2", refresh_token: "refresh-token-2", expires_in: 3600 });
      }
      if (url.origin === "https://api.lightspeedapp.com" && url.pathname === "/API/V3/Account.json") {
        return Response.json({ Account: { accountID: "456", name: "Second R-Series account" } });
      }
      if (url.origin === "https://api.lightspeedapp.com" && url.pathname.startsWith("/API/V3/Account/456/")) {
        const rewritten = new URL(url);
        rewritten.pathname = rewritten.pathname.replace("/API/V3/Account/456/", "/API/V3/Account/123/");
        return mockLightspeedFetch(rewritten, init);
      }
      throw new Error(`Unexpected second-account request: ${url.origin}${url.pathname}`);
    };

    const secondCallback = await worker.fetch(new Request(
      `${origin}/api/v1/integrations/lightspeed-r/callback?code=${"b".repeat(900)}&state=${secondState}`,
      { headers: { accept: "text/html", cookie: secondAuthorization.headers.get("set-cookie").split(";")[0] } },
    ), environment, context);
    assert.equal(secondCallback.status, 303);

    const ambiguousSync = await worker.fetch(new Request(`${origin}/api/v1/integrations/lightspeed-r/sync`, {
      method: "POST", headers: ownerHeaders(true), body: JSON.stringify({ reason: "manual" }),
    }), environment, context);
    assert.equal(ambiguousSync.status, 409);
    assert.equal((await ambiguousSync.json()).error.code, "INTEGRATION_CONNECTION_REQUIRED");

    const secondSync = await worker.fetch(new Request(`${origin}/api/v1/integrations/lightspeed-r/sync`, {
      method: "POST", headers: ownerHeaders(true), body: JSON.stringify({ reason: "manual", connectionId: secondAuthorizationBody.connectionId }),
    }), environment, context);
    assert.equal(secondSync.status, 200, await secondSync.clone().text());
    assert.equal((await secondSync.json()).connectionId, secondAuthorizationBody.connectionId);

    const secondMapping = await worker.fetch(new Request(`${origin}/api/v1/integrations/lightspeed-r/shops`, {
      method: "POST",
      headers: ownerHeaders(true),
      body: JSON.stringify({
        connectionId: secondAuthorizationBody.connectionId,
        externalLocationRef: "1",
        localLocationId: shopsBody.localLocations[0].id,
        status: "mapped",
      }),
    }), environment, context);
    assert.equal(secondMapping.status, 200, await secondMapping.clone().text());
    const secondReviewedSync = await worker.fetch(new Request(`${origin}/api/v1/integrations/lightspeed-r/sync`, {
      method: "POST",
      headers: ownerHeaders(true),
      body: JSON.stringify({ reason: "manual", connectionId: secondAuthorizationBody.connectionId }),
    }), environment, context);
    assert.equal(secondReviewedSync.status, 200, await secondReviewedSync.clone().text());
    assert.equal((await secondReviewedSync.json()).run.warningCount, 0);
    const secondApproval = await worker.fetch(new Request(`${origin}/api/v1/integrations`, {
      method: "POST",
      headers: ownerHeaders(true),
      body: JSON.stringify({ action: "approve_data", connectionId: secondAuthorizationBody.connectionId, confirmed: true }),
    }), environment, context);
    assert.equal(secondApproval.status, 200, await secondApproval.clone().text());
    assert.equal((await secondApproval.json()).publicationPending, true);
    const secondPromotedSync = await worker.fetch(new Request(`${origin}/api/v1/integrations/lightspeed-r/sync`, {
      method: "POST", headers: ownerHeaders(true), body: JSON.stringify({ reason: "manual", connectionId: secondAuthorizationBody.connectionId }),
    }), environment, context);
    assert.equal(secondPromotedSync.status, 200, await secondPromotedSync.clone().text());
    assert.equal((await secondPromotedSync.json()).dataPromotionEnabled, true);

    const connectionCount = await database.prepare("SELECT COUNT(*) count FROM integration_connections WHERE provider = 'lightspeed-r' AND status = 'connected'").first();
    const secretCount = await database.prepare("SELECT COUNT(*) count FROM integration_secrets WHERE provider = 'lightspeed-r'").first();
    const mappingCount = await database.prepare("SELECT COUNT(*) count FROM integration_location_mappings WHERE provider = 'lightspeed-r' AND external_location_ref = '1'").first();
    const paymentRows = await database.prepare("SELECT connection_id connectionId, external_payment_id externalPaymentId FROM commerce_payments ORDER BY connection_id").all();
    const productRows = await database.prepare("SELECT connection_id connectionId, external_product_id externalProductId FROM commerce_products ORDER BY connection_id").all();
    assert.deepEqual({ connections: connectionCount.count, secrets: secretCount.count, mappings: mappingCount.count }, { connections: 2, secrets: 2, mappings: 2 });
    assert.deepEqual(new Set(paymentRows.results.map((row) => row.externalPaymentId)), new Set([`${connection.id}:payment-1`, `${secondAuthorizationBody.connectionId}:payment-1`]));
    assert.deepEqual(new Set(productRows.results.map((row) => row.externalProductId)), new Set([`${connection.id}:item-1`, `${secondAuthorizationBody.connectionId}:item-1`]));

    const integrations = await worker.fetch(new Request(`${origin}/api/v1/integrations`, { headers: ownerHeaders() }), environment, context);
    assert.equal(integrations.status, 200);
    const rSeries = (await integrations.json()).integrations.find((provider) => provider.id === "lightspeed-r");
    assert.equal(rSeries.connectionCount, 2);
    assert.deepEqual(new Set(rSeries.connections.map((item) => item.id)), new Set([connection.id, secondAuthorizationBody.connectionId]));

    // A long history is rebuilt in bounded D1 batches. It must preserve every
    // date and the other merchant's records before reopening publication.
    globalThis.fetch = mockLightspeedFetch;
    const historyRun = await database.prepare("SELECT id FROM integration_sync_runs WHERE connection_id=? AND status='completed' ORDER BY completed_at DESC LIMIT 1").bind(connection.id).first();
    for (let start = 0; start < 150; start += 50) await database.batch(Array.from({ length: 50 }, (_, offset) => {
      const index = start + offset, date = new Date(Date.UTC(2024, 0, 1 + index)).toISOString().slice(0, 10);
      return database.prepare(`INSERT INTO integration_staged_sales (id,organization_id,provider,connection_id,external_sale_id,external_version,outlet_ref,sold_at,state,total_cents,tax_cents,cost_cents,discount_cents,line_count,source_payload_hash,sync_run_id,staged_at)
        VALUES (?,?,'lightspeed-r',?,?,'1',?,?,'completed',100,0,40,0,0,'history-fixture',?,?)`)
        .bind(`history-${index}`, connection.organization_id, connection.id, `${connection.id}:history-${index}`, `${connection.id}:1`, `${date}T12:00:00-07:00`, historyRun.id, Date.now());
    }));
    const historySync = await worker.fetch(new Request(`${origin}/api/v1/integrations/lightspeed-r/sync`, { method: "POST", headers: ownerHeaders(true), body: JSON.stringify({ reason: "manual", connectionId: connection.id }) }), environment, context);
    assert.equal(historySync.status, 200, await historySync.clone().text());
    assert.equal((await historySync.json()).dataPromotionEnabled, true);
    assert.deepEqual(await database.prepare("SELECT count(*) dates, sum(net_sales_cents) sales FROM daily_business_metrics WHERE source_connection_id=? AND business_date LIKE '2024-%'").bind(connection.id).first(), { dates: 150, sales: 15000 });
    assert.ok((await database.prepare("SELECT count(*) count FROM daily_business_metrics WHERE source_connection_id=?").bind(secondAuthorizationBody.connectionId).first()).count > 0);

    const disconnect = await worker.fetch(new Request(`${origin}/api/v1/integrations/lightspeed-r/disconnect`, {
      method: "POST", headers: ownerHeaders(true), body: JSON.stringify({ connectionId: connection.id }),
    }), environment, context);
    assert.equal(disconnect.status, 200, await disconnect.clone().text());
    const remaining = await database.prepare("SELECT id, status FROM integration_connections WHERE provider = 'lightspeed-r' ORDER BY id").all();
    assert.equal(remaining.results.find((row) => row.id === connection.id).status, "revoked");
    assert.equal(remaining.results.find((row) => row.id === secondAuthorizationBody.connectionId).status, "connected");
    assert.equal((await database.prepare("SELECT COUNT(*) count FROM integration_secrets WHERE provider = 'lightspeed-r'").first()).count, 1);

    const commandAfterDisconnect = await worker.fetch(new Request(`${origin}/api/v1/command-centre`, { headers: ownerHeaders() }), environment, context);
    assert.equal(commandAfterDisconnect.status, 200);
    const commandAfterDisconnectBody = await commandAfterDisconnect.json();
    assert.equal(commandAfterDisconnectBody.commandCentre.source.rowCount, 1);
    assert.equal(commandAfterDisconnectBody.commandCentre.liveSource.accountName, "Second R-Series account");
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
