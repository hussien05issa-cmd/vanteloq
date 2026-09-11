import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";
import { Miniflare } from "miniflare";
import { registerSupabaseTestServer } from "./helpers/supabase-loopback-transport.mjs";
import { activateTestSubscription } from "./helpers/subscription-fixture.mjs";

test("Square imports resume without publishing partial data or counting tax as revenue", async () => {
  const origin = "https://vanteloq.example";
  const ownerEmail = "square-flow@example.invalid";
  const authServer = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ id: `test-user:${ownerEmail}`, email: ownerEmail,
      email_confirmed_at: "2026-08-01T00:00:00Z", user_metadata: { full_name: "Square Test Owner" } }));
  });
  await new Promise((resolve) => authServer.listen(0, "127.0.0.1", resolve));
  const miniflare = new Miniflare({ modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: `square-sync-${crypto.randomUUID()}` } });
  const originalFetch = globalThis.fetch;
  try {
    const database = await miniflare.getD1Database("DB");
    for (const file of (await readdir(new URL("../drizzle/", import.meta.url))).filter((name) => /^\d{4}.*\.sql$/.test(name)).sort()) {
      const sql = await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8");
      for (const statement of sql.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) await database.prepare(statement).run();
    }
    const worker = (await import(new URL("../dist/server/index.js", import.meta.url))).default;
    const environment = {
      DB: database, ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
      SUPABASE_URL: registerSupabaseTestServer(authServer.address().port), SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
      SQUARE_APPLICATION_ID: "square-test", SQUARE_APPLICATION_SECRET: "square-fixture-secret",
      SQUARE_REDIRECT_URI: `${origin}/api/v1/integrations/square/callback`, SQUARE_ENV: "sandbox",
      INTEGRATION_ENCRYPTION_KEY: Buffer.from(new Uint8Array(32)).toString("base64"),
    };
    const dispatch = (path, body, cookie = "") => {
      const token = Buffer.from(JSON.stringify({ email: ownerEmail, aal: "aal2", session_id: "square-test-session" })).toString("base64url");
      return worker.fetch(new Request(`${origin}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { accept: "application/json", authorization: `Bearer test.${token}.signature`,
          origin, "sec-fetch-site": "same-origin", "content-type": "application/json", cookie },
        body: body === undefined ? undefined : JSON.stringify(body),
      }), environment, { waitUntil() {}, passThroughOnException() {} });
    };
    const onboard = await dispatch("/api/v1/onboarding", {
      ownerName: "Square Test Owner", businessName: "Square Test", legalName: "Square Test Ltd.",
      businessEmail: ownerEmail, phone: "", website: "", industry: "Retail",
      country: "CA", province: "AB", city: "Edmonton", address: "1 Test Avenue", postalCode: "T5A 1A1",
      emailNotifications: true, timezone: "America/Edmonton", currency: "CAD", fiscalYearStart: "January",
      taxNumber: "", sourceMode: "connect_later", selectedPos: "", legalAccepted: true,
      termsVersion: "2026-09-05", privacyPolicyVersion: "2026-09-10", legalNoticeVersion: "account-creation-v2",
      hours: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        .map((day) => ({ day, open: "09:00", close: "17:00", closed: false })),
    });
    assert.equal(onboard.status, 201, await onboard.clone().text());
    await activateTestSubscription(database, (await onboard.json()).organization.id);
    const orderRequests = [];
    const streamCalls = { catalog: 0, customers: 0, payments: 0 };
    let updatedOrder = false;
    let supersedeImport = false;
    let paginateApprovedUpdate = false;
    let quantity = 1;
    let archiveProduct = false;
    const order = (id, total, tax) => ({
      id, location_id: "store-one", state: "COMPLETED", version: updatedOrder ? quantity + 1 + Number(archiveProduct) : 1,
      closed_at: "2026-09-07T15:00:00Z", updated_at: updatedOrder ? "2026-09-08T10:00:00Z" : "2026-09-07T15:00:00Z",
      total_money: { amount: total }, total_tax_money: { amount: tax }, total_discount_money: { amount: 0 },
      line_items: [{ uid: `line-${id}`, name: "Test item", quantity: String(quantity), catalog_object_id: "item-one",
        total_money: { amount: total }, total_tax_money: { amount: tax } }],
    });
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.hostname !== "connect.squareupsandbox.com") return originalFetch(input, init);
      if (url.pathname === "/oauth2/token") return Response.json({
        access_token: "fixture-access", refresh_token: "fixture-refresh", merchant_id: "seller-one",
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      });
      if (url.pathname === "/v2/merchants/me") return Response.json({ merchant: { id: "seller-one", business_name: "Test seller", country: "CA" } });
      if (url.pathname === "/v2/locations") return Response.json({ locations: [{ id: "store-one", name: "Main store", status: "ACTIVE" }] });
      if (url.pathname === "/v2/catalog/search") { streamCalls.catalog++; return Response.json({ objects: [
        { id: "item-one", type: "ITEM_VARIATION", is_deleted: archiveProduct, item_variation_data: { name: "Test item", sku: "TEST" } },
      ] }); }
      if (url.pathname === "/v2/inventory/counts/batch-retrieve") return Response.json({ counts: [] });
      if (url.pathname === "/v2/customers/search") { streamCalls.customers++; return Response.json({ customers: [] }); }
      if (url.pathname === "/v2/payments") {
        streamCalls.payments++;
        assert.equal(url.searchParams.get("sort_field"), "UPDATED_AT");
        assert.ok(url.searchParams.has("updated_at_begin_time"));
        return Response.json({ payments: [] });
      }
      if (url.pathname === "/v2/orders/search") {
        if (supersedeImport) await database.prepare("UPDATE integration_connections SET sync_lease_owner = 'newer-sync', sync_version = sync_version + 1, last_error_code = 'NEWER_SYNC' WHERE id = ?").bind(connectionId).run();
        const body = JSON.parse(String(init.body));
        orderRequests.push(body);
        assert.equal(body.query.sort.sort_field, "UPDATED_AT");
        assert.ok(body.query.filter.date_time_filter.updated_at);
        if (updatedOrder) return Response.json({
          orders: paginateApprovedUpdate && body.cursor ? [] : [order("sale-one", 8400, 400)],
          ...(paginateApprovedUpdate && !body.cursor ? { cursor: "updated-page-two" } : {}),
        });
        if (!body.cursor) return Response.json({ orders: [order("sale-one", 10500, 500)], cursor: "page-two" });
        assert.equal(body.cursor, "page-two");
        return Response.json({ orders: [order("sale-two", 5250, 250)] });
      }
      throw new Error(`Unexpected Square fixture request: ${url.pathname}`);
    };
    const authorize = await dispatch("/api/v1/integrations/square/authorize", {});
    assert.equal(authorize.status, 200, await authorize.clone().text());
    const authorization = await authorize.json();
    const state = new URL(authorization.authorizationUrl).searchParams.get("state");
    const callback = await dispatch(`/api/v1/integrations/square/callback?state=${state}&code=fixture-code`, undefined, authorize.headers.get("set-cookie").split(";")[0]);
    assert.equal(callback.status, 303, await callback.clone().text());
    assert.equal(new URL(callback.headers.get("location")).searchParams.get("connection"), "connected");
    const connectionId = authorization.connectionId;
    const sync = () => dispatch("/api/v1/integrations/square/sync", { connectionId, reason: "manual" });
    const connection = () => database.prepare("SELECT * FROM integration_connections WHERE id = ?").bind(connectionId).first();
    const metrics = () => database.prepare("SELECT * FROM daily_business_metrics WHERE source_connection_id = ? ORDER BY business_date").bind(connectionId).all();
    const first = await sync();
    assert.equal(first.status, 200, await first.clone().text());
    const firstBody = await first.json();
    assert.equal(firstBody.hasMore, true);
    assert.equal(firstBody.readyForReview, false);
    assert.equal((await connection()).last_successful_sync_at, null);
    assert.equal((await metrics()).results.length, 0);
    const premature = await dispatch("/api/v1/integrations", { action: "approve_data", connectionId, confirmed: true });
    assert.equal(premature.status, 409);
    const second = await sync();
    assert.equal(second.status, 200, await second.clone().text());
    assert.equal((await second.json()).hasMore, false);
    assert.deepEqual(streamCalls, { catalog: 1, customers: 1, payments: 1 });
    assert.deepEqual(orderRequests[0].query.filter.date_time_filter, orderRequests[1].query.filter.date_time_filter);
    assert.equal((await metrics()).results.length, 0);
    const lines = await database.prepare("SELECT net_sales_cents FROM commerce_sale_lines WHERE connection_id = ? ORDER BY net_sales_cents").bind(connectionId).all();
    assert.deepEqual(lines.results.map((row) => row.net_sales_cents), [5000, 10000]);
    const checkpoint = JSON.parse((await connection()).last_sync_cursor);
    assert.equal(checkpoint.watermark, orderRequests[0].query.filter.date_time_filter.updated_at.end_at);
    await database.prepare("UPDATE commerce_products SET owner_cost_cents = 2000, owner_cost_source = 'manual' WHERE connection_id = ?").bind(connectionId).run();
    const approved = await dispatch("/api/v1/integrations", { action: "approve_data", connectionId, confirmed: true });
    assert.equal(approved.status, 200, await approved.clone().text());
    updatedOrder = true;
    const updated = await sync();
    assert.equal(updated.status, 200, await updated.clone().text());
    const published = (await metrics()).results;
    assert.equal(published.length, 1);
    assert.equal(published[0].net_sales_cents, 13000);
    assert.equal(published[0].transaction_count, 2);
    assert.equal(published[0].cost_of_goods_cents, 4000);
    assert.equal(Date.parse(orderRequests.at(-1).query.filter.date_time_filter.updated_at.start_at), Date.parse(checkpoint.watermark) - 300_000);
    const duplicate = await sync();
    assert.equal(duplicate.status, 200, await duplicate.clone().text());
    assert.equal((await metrics()).results[0].net_sales_cents, 13000);
    const beforePartial = (await metrics()).results;
    paginateApprovedUpdate = true;
    quantity = 2;
    const partialUpdate = await sync();
    assert.equal(partialUpdate.status, 200, await partialUpdate.clone().text());
    assert.equal((await partialUpdate.json()).hasMore, true);
    assert.deepEqual((await metrics()).results, beforePartial);
    const completeUpdate = await sync();
    assert.equal(completeUpdate.status, 200, await completeUpdate.clone().text());
    assert.equal((await completeUpdate.json()).hasMore, false);
    assert.equal((await metrics()).results[0].net_sales_cents, 13000);
    assert.equal((await metrics()).results[0].cost_of_goods_cents, 6000);
    paginateApprovedUpdate = false;
    // Historical owner costs survive a later sale version after product archival.
    archiveProduct = true;
    const archivedUpdate = await sync();
    assert.equal(archivedUpdate.status, 200, await archivedUpdate.clone().text());
    assert.equal((await metrics()).results[0].cost_of_goods_cents, 6000);
    // A failed replacement must preserve the previously published daily snapshot.
    await database.prepare("CREATE TRIGGER fail_square_snapshot BEFORE INSERT ON daily_business_metrics WHEN NEW.source_provider = 'square' BEGIN SELECT RAISE(ABORT, 'fixture snapshot failure'); END").run();
    const failedPublish = await sync();
    assert.equal(failedPublish.status, 500);
    assert.equal((await metrics()).results[0].net_sales_cents, 13000);
    assert.equal((await metrics()).results[0].cost_of_goods_cents, 6000);
    await database.prepare("DROP TRIGGER fail_square_snapshot").run();
    // Inject a new lease after renewal but immediately before the publication batch.
    const publicationGuards = new WeakSet();
    environment.DB = new Proxy(database, { get(target, key) {
      if (key === "prepare") return (sql) => {
        const statement = target.prepare(sql);
        if (!sql.includes("INSERT INTO integration_connections (id) SELECT")) return statement;
        return new Proxy(statement, { get(prepared, method) {
          if (method === "bind") return (...values) => { const bound = prepared.bind(...values); publicationGuards.add(bound); return bound; };
          const value = Reflect.get(prepared, method);
          return typeof value === "function" ? value.bind(prepared) : value;
        } });
      };
      if (key === "batch") return async (statements) => {
        if (statements.some((statement) => publicationGuards.has(statement))) {
          await database.prepare("UPDATE integration_connections SET sync_lease_owner = 'newer-transaction', sync_version = sync_version + 1 WHERE id = ?").bind(connectionId).run();
        }
        return target.batch(statements);
      };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const beforeRace = (await metrics()).results;
    const stalePublish = await sync();
    assert.equal(stalePublish.status, 500);
    assert.deepEqual((await metrics()).results, beforeRace);
    environment.DB = database;
    await database.prepare("UPDATE integration_connections SET sync_lease_owner = NULL, sync_lease_expires_at = NULL WHERE id = ?").bind(connectionId).run();
    supersedeImport = true;
    const superseded = await sync();
    assert.equal(superseded.status, 409, await superseded.clone().text());
    assert.equal((await superseded.json()).error.code, "INTEGRATION_SYNC_LEASE_LOST");
    assert.equal((await connection()).last_error_code, "NEWER_SYNC");
    assert.equal((await metrics()).results[0].net_sales_cents, 13000);
  } finally {
    globalThis.fetch = originalFetch;
    await miniflare.dispose();
    await new Promise((resolve) => authServer.close(resolve));
  }
});
