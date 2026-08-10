import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { Miniflare } from "miniflare";

const origin = "https://vanteloq.example";
const context = { waitUntil() {}, passThroughOnException() {} };

function ownerHeaders(write = false) {
  const headers = {
    accept: "application/json",
    "oai-authenticated-user-email": "owner@example.invalid",
    "oai-authenticated-user-full-name": encodeURIComponent("Test Owner"),
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
    const statements = sql.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean);
    for (const statement of statements) await database.prepare(statement).run();
  }
}

test("R-Series completes a browser callback using the initiating one-time state", async () => {
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
        selectedPos: "", hours: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
          .map((day) => ({ day, open: "09:00", close: "17:00", closed: false })),
      }),
    }), environment, context);
    assert.equal(onboarding.status, 201);

    const authorization = await worker.fetch(new Request(`${origin}/api/v1/integrations/lightspeed-r/authorize`, {
      method: "POST", headers: ownerHeaders(true), body: "{}",
    }), environment, context);
    assert.equal(authorization.status, 200);
    const authorizationUrl = new URL((await authorization.json()).authorizationUrl);
    const state = authorizationUrl.searchParams.get("state");
    assert.match(state ?? "", /^[A-Za-z0-9_-]{43}$/);

    globalThis.fetch = async (input) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      if (url.origin === "https://cloud.lightspeedapp.com" && url.pathname === "/auth/oauth/token") {
        return Response.json({ access_token: "access-token", refresh_token: "refresh-token", expires_in: 3600 });
      }
      if (url.origin === "https://api.lightspeedapp.com" && url.pathname === "/API/V3/Account.json") {
        return Response.json({ Account: { accountID: "123", name: "Test R-Series account" } });
      }
      if (url.origin === "https://api.lightspeedapp.com" && url.pathname === "/API/V3/Account/123/Shop.json") {
        return Response.json({ Shop: [{ shopID: "1", name: "Main shop" }], "@attributes": {} });
      }
      if (url.origin === "https://api.lightspeedapp.com" && url.pathname === "/API/V3/Account/123/Sale.json") {
        return Response.json({
          Sale: [
            {
              saleID: "sale-100", timeStamp: "2026-08-09T16:00:00Z", completeTime: "2026-08-09T15:58:00-06:00",
              completed: "true", voided: "false", shopID: "1", total: "105.00", taxTotal: "5.00",
              calcFIFOCost: "40.00", calcDiscount: "2.00", SaleLines: { SaleLine: [{ saleLineID: "line-1" }, { saleLineID: "line-2" }] },
            },
          ],
          "@attributes": {},
        });
      }
      if (url.origin === "https://api.lightspeedapp.com" && url.pathname === "/API/V3/Account/123/Item.json") {
        return Response.json({
          Item: [
            {
              itemID: "item-1", description: "Creatine A", customSku: "CRE-A",
              ItemShops: { ItemShop: [{ shopID: "1", qoh: "45", reorderPoint: "24" }] },
            },
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
        return Response.json({
          Vendor: [{ vendorID: "vendor-1", name: "North Supply", accountNumber: "NS-14", Contact: { email: "orders@example.invalid" } }],
          "@attributes": {},
        });
      }
      throw new Error(`Unexpected outbound request: ${url.origin}${url.pathname}`);
    };

    const longCode = "a".repeat(900);
    const callback = await worker.fetch(new Request(
      `${origin}/api/v1/integrations/lightspeed-r/callback?code=${longCode}&state=${state}`,
      { headers: { accept: "text/html" } },
    ), environment, context);
    assert.equal(callback.status, 303);
    assert.equal(callback.headers.get("location"), `${origin}/?integration=lightspeed-r&connection=connected`);

    const connection = await database.prepare(
      "SELECT status, external_account_ref, data_promotion_status FROM integration_connections WHERE provider = 'lightspeed-r'",
    ).first();
    assert.deepEqual(connection, { status: "connected", external_account_ref: "123", data_promotion_status: "blocked" });
    const oauthState = await database.prepare(
      "SELECT consumed_at FROM integration_oauth_states WHERE provider = 'lightspeed-r'",
    ).first();
    assert.equal(typeof oauthState?.consumed_at, "number");

    const sync = await worker.fetch(new Request(`${origin}/api/v1/integrations/lightspeed-r/sync`, {
      method: "POST", headers: ownerHeaders(true), body: "{}",
    }), environment, context);
    assert.equal(sync.status, 200);
    const syncBody = await sync.json();
    assert.equal(syncBody.dataPromotionEnabled, true);
    assert.deepEqual(syncBody.imported, {
      dailyMetrics: 1,
      inventoryBalances: 1,
      products: 1,
      customers: 1,
      suppliers: 1,
      saleLines: 2,
    });

    const metric = await database.prepare(`
      SELECT business_date, location_ref, gross_sales_cents, net_sales_cents, cost_of_goods_cents,
             transaction_count, units_sold, refunds_cents, discounts_cents
      FROM daily_business_metrics
    `).first();
    assert.deepEqual(metric, {
      business_date: "2026-08-09", location_ref: "lightspeed-r:1", gross_sales_cents: 10_200,
      net_sales_cents: 10_000, cost_of_goods_cents: 4_000, transaction_count: 1,
      units_sold: 2, refunds_cents: 0, discounts_cents: 200,
    });
    const balance = await database.prepare(`
      SELECT location_ref, sku, name, on_hand_quantity, reorder_point FROM inventory_balances
    `).first();
    assert.deepEqual(balance, {
      location_ref: "lightspeed-r:1", sku: "CRE-A", name: "Creatine A", on_hand_quantity: 45, reorder_point: 24,
    });
    const promoted = await database.prepare(
      "SELECT data_promotion_status FROM integration_connections WHERE provider = 'lightspeed-r'",
    ).first();
    assert.deepEqual(promoted, { data_promotion_status: "approved" });

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
  } finally {
    globalThis.fetch = originalFetch;
    await miniflare.dispose();
  }
});
