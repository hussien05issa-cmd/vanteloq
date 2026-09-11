import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";
import { Miniflare } from "miniflare";
import { registerSupabaseTestServer } from "./helpers/supabase-loopback-transport.mjs";
import { activateTestSubscription } from "./helpers/subscription-fixture.mjs";

const origin = "https://vanteloq.example";
const owner = { email: "lineage-owner@example.invalid", name: "Lineage Owner" };
const executionContext = { waitUntil() {}, passThroughOnException() {} };

function identityHeaders(write = false, actor = owner) {
  const payload = Buffer.from(JSON.stringify({
    email: actor.email,
    aal: "aal2",
    session_id: `session:${actor.email}`,
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

async function createEnvironment() {
  const authServer = createServer((request, response) => {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      id: `test-user:${payload.email}`,
      email: payload.email,
      email_confirmed_at: "2026-08-01T00:00:00.000Z",
      user_metadata: { full_name: owner.name },
    }));
  });
  await new Promise((resolve) => authServer.listen(0, "127.0.0.1", resolve));
  const authAddress = authServer.address();
  assert.ok(authAddress && typeof authAddress !== "string");
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: `vanteloq-purchasing-lineage-${crypto.randomUUID()}` },
  });
  const database = await miniflare.getD1Database("DB");
  const migrations = (await readdir(new URL("../drizzle/", import.meta.url)))
    .filter((file) => /^\d{4}.*\.sql$/.test(file))
    .sort();
  for (const migration of migrations) {
    const sql = await readFile(new URL(`../drizzle/${migration}`, import.meta.url), "utf8");
    const statements = sql.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean);
    for (const statement of statements) await database.prepare(statement).run();
  }
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("purchasing-lineage-test", crypto.randomUUID());
  const worker = (await import(workerUrl.href)).default;
  return {
    miniflare,
    database,
    worker,
    authServer,
    environment: {
      DB: database,
      SUPABASE_URL: registerSupabaseTestServer(authAddress.port),
      SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    },
  };
}

async function dispatch(worker, environment, path, { method = "GET", body, actor = owner } = {}) {
  return worker.fetch(new Request(`${origin}${path}`, {
    method,
    headers: identityHeaders(method !== "GET", actor),
    body: body ? JSON.stringify(body) : undefined,
  }), environment, executionContext);
}

function onboardingBody() {
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  return {
    ownerName: owner.name,
    businessName: "Lineage Store",
    legalName: "Lineage Store Ltd.",
    businessEmail: owner.email,
    phone: "",
    website: "",
    industry: "Retail",
    country: "CA",
    province: "AB",
    city: "Edmonton",
    address: "1 Lineage Avenue",
    postalCode: "T5A 1A1",
    emailNotifications: true,
    timezone: "America/Edmonton",
    currency: "CAD",
    fiscalYearStart: "January",
    taxNumber: "",
    hours: days.map((day) => ({ day, open: "10:00", close: "21:00", closed: false })),
    sourceMode: "connect_later",
    selectedPos: "",
    legalAccepted: true,
    termsVersion: "2026-09-05",
    privacyPolicyVersion: "2026-09-10",
    legalNoticeVersion: "account-creation-v2",
  };
}

async function onboardFixture(worker, environment, database) {
  const onboarding = await dispatch(worker, environment, "/api/v1/onboarding", {
    method: "POST",
    body: onboardingBody(),
  });
  assert.equal(onboarding.status, 201);
  const identity = await database.prepare(`SELECT u.id AS userId, m.organization_id AS organizationId
    FROM users u JOIN memberships m ON m.user_id = u.id WHERE u.email = ?`).bind(owner.email).first();
  const location = await database.prepare(`SELECT id FROM organization_locations
    WHERE organization_id = ? AND status = 'active' ORDER BY created_at LIMIT 1`).bind(identity.organizationId).first();
  assert.ok(identity?.userId && identity?.organizationId && location?.id);
  await activateTestSubscription(database, identity.organizationId);
  return { ...identity, locationId: location.id };
}

async function seedCatalogProduct(database, fixture, suffix, defaultCostCents = 12_345) {
  const now = Date.now();
  const connectionId = `pos-${suffix}`;
  const runId = `run-${suffix}`;
  const productId = `product-${suffix}`;
  await database.batch([
    database.prepare(`INSERT INTO integration_connections
      (id, organization_id, provider, source_namespace, status, external_account_ref,
       data_promotion_status, connected_at, last_successful_sync_at, created_at, updated_at)
      VALUES (?, ?, 'lightspeed-r', ?, 'connected', ?, 'approved', ?, ?, ?, ?)`).bind(
      connectionId,
      fixture.organizationId,
      suffix,
      connectionId,
      now,
      now,
      now,
      now,
    ),
    database.prepare(`INSERT INTO integration_sync_runs
      (id, organization_id, provider, connection_id, mode, status, started_at, completed_at)
      VALUES (?, ?, 'lightspeed-r', ?, 'incremental', 'completed', ?, ?)`).bind(
      runId,
      fixture.organizationId,
      connectionId,
      now,
      now,
    ),
    database.prepare(`INSERT INTO commerce_products
      (id, organization_id, provider, connection_id, external_product_id, sku, name,
       default_cost_cents, source_payload_hash, sync_run_id, updated_at)
      VALUES (?, ?, 'lightspeed-r', ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      productId,
      fixture.organizationId,
      connectionId,
      `external-${suffix}`,
      `SKU-${suffix.toUpperCase()}`,
      `Product ${suffix}`,
      defaultCostCents,
      `hash-${suffix}`,
      runId,
      now,
    ),
  ]);
  return { connectionId, productId, externalProductId: `external-${suffix}`, sku: `SKU-${suffix.toUpperCase()}` };
}

function allObjectKeys(value, keys = []) {
  if (Array.isArray(value)) {
    for (const item of value) allObjectKeys(item, keys);
    return keys;
  }
  if (!value || typeof value !== "object") return keys;
  for (const [key, item] of Object.entries(value)) {
    keys.push(key);
    allObjectKeys(item, keys);
  }
  return keys;
}

test("purchase history stays isolated when same-provider accounts reuse a product reference", async () => {
  const { miniflare, database, worker, environment, authServer } = await createEnvironment();
  try {
    const onboarding = await dispatch(worker, environment, "/api/v1/onboarding", {
      method: "POST",
      body: onboardingBody(),
    });
    assert.equal(onboarding.status, 201);

    const identity = await database.prepare(`SELECT u.id AS userId, m.organization_id AS organizationId
      FROM users u JOIN memberships m ON m.user_id = u.id WHERE u.email = ?`).bind(owner.email).first();
    const location = await database.prepare(`SELECT id FROM organization_locations
      WHERE organization_id = ? AND status = 'active' ORDER BY created_at LIMIT 1`).bind(identity.organizationId).first();
    assert.ok(identity?.userId && identity?.organizationId && location?.id);
    await activateTestSubscription(database, identity.organizationId);

    const now = Date.now();
    await database.batch([
      database.prepare(`INSERT INTO integration_connections
        (id, organization_id, provider, source_namespace, status, external_account_ref,
         data_promotion_status, connected_at, last_successful_sync_at, created_at, updated_at)
        VALUES ('pos-account-a', ?, 'lightspeed-r', 'account-a', 'connected', 'account-a',
          'approved', ?, ?, ?, ?)`)
        .bind(identity.organizationId, now, now, now, now),
      database.prepare(`INSERT INTO integration_connections
        (id, organization_id, provider, source_namespace, status, external_account_ref,
         data_promotion_status, connected_at, last_successful_sync_at, created_at, updated_at)
        VALUES ('pos-account-b', ?, 'lightspeed-r', 'account-b', 'connected', 'account-b',
          'approved', ?, ?, ?, ?)`)
        .bind(identity.organizationId, now, now, now, now),
      database.prepare(`INSERT INTO integration_sync_runs
        (id, organization_id, provider, connection_id, mode, status, started_at, completed_at)
        VALUES ('lineage-run-a', ?, 'lightspeed-r', 'pos-account-a', 'incremental', 'completed', ?, ?)`)
        .bind(identity.organizationId, now, now),
      database.prepare(`INSERT INTO integration_sync_runs
        (id, organization_id, provider, connection_id, mode, status, started_at, completed_at)
        VALUES ('lineage-run-b', ?, 'lightspeed-r', 'pos-account-b', 'incremental', 'completed', ?, ?)`)
        .bind(identity.organizationId, now, now),
      database.prepare(`INSERT INTO commerce_products
        (id, organization_id, provider, connection_id, external_product_id, sku, name,
         default_cost_cents, source_payload_hash, sync_run_id, updated_at)
        VALUES ('product-account-a', ?, 'lightspeed-r', 'pos-account-a', 'shared-product', 'SKU-A',
          'Account A product', 250, 'hash-a', 'lineage-run-a', ?)`)
        .bind(identity.organizationId, now),
      database.prepare(`INSERT INTO commerce_products
        (id, organization_id, provider, connection_id, external_product_id, sku, name,
         default_cost_cents, source_payload_hash, sync_run_id, updated_at)
        VALUES ('product-account-b', ?, 'lightspeed-r', 'pos-account-b', 'shared-product', 'SKU-B',
          'Account B product', 300, 'hash-b', 'lineage-run-b', ?)`)
        .bind(identity.organizationId, now),
    ]);

    const created = await dispatch(worker, environment, "/api/v1/purchasing", {
      method: "POST",
      body: {
        action: "create",
        orderNumber: "PO-LINEAGE-1",
        supplierName: "Lineage Supplier",
        deliveryLocationId: location.id,
        orderDate: "2026-08-11",
        currency: "CAD",
        paymentTerms: "",
        lines: [{ productId: "product-account-a", quantity: 5, unitCostCents: 250 }],
      },
    });
    assert.equal(created.status, 201, await created.clone().text());
    const payload = await created.json();
    const draftProducts = new Map(payload.catalog.products.map((product) => [product.id, product]));
    assert.equal(draftProducts.get("product-account-a").incomingUnits, 0);
    assert.equal(draftProducts.get("product-account-b").incomingUnits, 0);
    assert.equal(payload.orders[0].lines[0].connectionId, "pos-account-a");
    await database.prepare("UPDATE purchase_orders SET status = 'sent' WHERE id = ?")
      .bind(payload.orders[0].id).run();
    const sentResponse = await dispatch(worker, environment, "/api/v1/purchasing");
    assert.equal(sentResponse.status, 200);
    const sentProducts = new Map((await sentResponse.json()).catalog.products.map((product) => [product.id, product]));
    assert.equal(sentProducts.get("product-account-a").incomingUnits, 5);
    assert.equal(sentProducts.get("product-account-b").incomingUnits, 0);
  } finally {
    authServer.closeAllConnections();
    await new Promise((resolve) => authServer.close(resolve));
    await miniflare.dispose();
  }
});

test("cost-restricted purchasing stays redacted and cannot use hidden catalog cost as a validation oracle", async () => {
  const { miniflare, database, worker, environment, authServer } = await createEnvironment();
  try {
    const fixture = await onboardFixture(worker, environment, database);
    const product = await seedCatalogProduct(database, fixture, "privacy", 12_345);
    const manager = { email: "cost-restricted@example.invalid", name: "Cost Restricted" };
    const managerUserId = crypto.randomUUID();
    const managerRoleId = crypto.randomUUID();
    const now = Date.now();
    await database.batch([
      database.prepare(`INSERT INTO users (id, email, display_name, status, created_at, updated_at)
        VALUES (?, ?, ?, 'active', ?, ?)`).bind(managerUserId, manager.email, manager.name, now, now),
      database.prepare(`INSERT INTO memberships (id, user_id, organization_id, role, status, created_at, updated_at)
        VALUES (?, ?, ?, 'manager', 'active', ?, ?)`).bind(
        crypto.randomUUID(), managerUserId, fixture.organizationId, now, now,
      ),
      database.prepare(`INSERT INTO access_roles
        (id, organization_id, name, description, color, permissions_json, location_scope_json,
         archived, created_by_user_id, created_at, updated_at)
        VALUES (?, ?, 'Cost-restricted buyer', '', '#53657a', ?, '[]', 0, ?, ?, ?)`).bind(
        managerRoleId,
        fixture.organizationId,
        JSON.stringify(["purchasing.view", "purchasing.create"]),
        fixture.userId,
        now,
        now,
      ),
      database.prepare(`INSERT INTO team_members
        (id, organization_id, user_id, role_id, first_name, last_name, email, employee_code,
         primary_location_id, permitted_locations_json, status, remote_login, created_by_user_id,
         created_at, updated_at)
        VALUES (?, ?, ?, ?, 'Cost', 'Restricted', ?, 'COST-RESTRICTED', ?, ?, 'active', 1, ?, ?, ?)`).bind(
        crypto.randomUUID(),
        fixture.organizationId,
        managerUserId,
        managerRoleId,
        manager.email,
        fixture.locationId,
        JSON.stringify([fixture.locationId]),
        fixture.userId,
        now,
        now,
      ),
    ]);

    const listed = await dispatch(worker, environment, "/api/v1/purchasing", { actor: manager });
    assert.equal(listed.status, 200, await listed.clone().text());
    const payload = await listed.json();
    const listedProduct = payload.catalog.products.find((item) => item.id === product.productId);
    assert.ok(listedProduct, "the product remains selectable without finance.costs");
    assert.equal(listedProduct.cashDecision, "restricted");
    assert.equal(listedProduct.cashConstrainedQuantity, null);
    assert.equal(payload.catalog.cashContext, null);
    const keys = allObjectKeys(payload);
    assert.equal(keys.some((key) => key.endsWith("Cents")), false, `redacted payload exposed: ${keys.filter((key) => key.endsWith("Cents")).join(", ")}`);
    for (const derivedCostKey of ["priceChangeRate", "recommendedCostCents", "remainingMerchandiseCents"]) {
      assert.equal(keys.includes(derivedCostKey), false, `${derivedCostKey} must be absent`);
    }

    const probe = async (orderNumber, discountCents) => {
      const response = await dispatch(worker, environment, "/api/v1/purchasing", {
        method: "POST",
        actor: manager,
        body: {
          action: "create",
          orderNumber,
          supplierName: "Restricted Supplier",
          deliveryLocationId: fixture.locationId,
          orderDate: "2026-08-11",
          currency: "CAD",
          paymentTerms: "",
          taxCents: 0,
          discountCents,
          lines: [{ productId: product.productId, quantity: 1 }],
        },
      });
      return { status: response.status, body: await response.json() };
    };
    const zeroDiscount = await probe("PO-COST-PROBE-ZERO", 0);
    const largeDiscount = await probe("PO-COST-PROBE-LARGE", 99_999_999);
    assert.equal(zeroDiscount.status, 400);
    assert.equal(largeDiscount.status, 400);
    assert.deepEqual(largeDiscount.body.error, zeroDiscount.body.error,
      "changing the discount must not reveal whether it crosses a hidden catalog subtotal");
    const probes = await database.prepare(`SELECT COUNT(*) AS count FROM purchase_orders
      WHERE organization_id = ? AND order_number LIKE 'PO-COST-PROBE-%'`).bind(fixture.organizationId).first();
    assert.equal(probes.count, 0);
  } finally {
    authServer.closeAllConnections();
    await new Promise((resolve) => authServer.close(resolve));
    await miniflare.dispose();
  }
});

test("incoming inventory counts only vendor-facing statuses and clamps over-received lines", async () => {
  const { miniflare, database, worker, environment, authServer } = await createEnvironment();
  try {
    const fixture = await onboardFixture(worker, environment, database);
    const product = await seedCatalogProduct(database, fixture, "incoming", 100);
    const now = Date.now();
    const cases = [
      { suffix: "approved", status: "approved", quantity: 100, received: 0 },
      { suffix: "sent", status: "sent", quantity: 10, received: 2 },
      { suffix: "received", status: "received", quantity: 5, received: 2 },
      { suffix: "invoiced", status: "invoiced", quantity: 7, received: 3 },
      { suffix: "disputed", status: "disputed", quantity: 4, received: 6 },
      { suffix: "sent-open", status: "sent", quantity: 3, received: 0 },
    ];
    const statements = [];
    for (const item of cases) {
      const purchaseOrderId = `po-incoming-${item.suffix}`;
      statements.push(
        database.prepare(`INSERT INTO purchase_orders
          (id, organization_id, order_number, supplier_name, delivery_location_id, order_date,
           currency, status, subtotal_cents, tax_cents, discount_cents, total_cents,
           created_by_user_id, created_at, updated_at)
          VALUES (?, ?, ?, 'Incoming Supplier', ?, '2026-08-11', 'CAD', ?, ?, 0, 0, ?, ?, ?, ?)`).bind(
          purchaseOrderId,
          fixture.organizationId,
          `PO-INCOMING-${item.suffix.toUpperCase()}`,
          fixture.locationId,
          item.status,
          item.quantity * 100,
          item.quantity * 100,
          fixture.userId,
          now,
          now,
        ),
        database.prepare(`INSERT INTO purchase_order_lines
          (id, organization_id, purchase_order_id, line_number, provider, connection_id,
           external_product_ref, sku, description, quantity, received_quantity, invoiced_quantity,
           unit_cost_cents, created_at, updated_at)
          VALUES (?, ?, ?, 1, 'lightspeed-r', ?, ?, ?, 'Incoming product', ?, ?, 0, 100, ?, ?)`).bind(
          `line-incoming-${item.suffix}`,
          fixture.organizationId,
          purchaseOrderId,
          product.connectionId,
          product.externalProductId,
          product.sku,
          item.quantity,
          item.received,
          now,
          now,
        ),
      );
    }
    await database.batch(statements);

    for (const path of [
      "/api/v1/purchasing",
      `/api/v1/purchasing?location=${encodeURIComponent(fixture.locationId)}`,
    ]) {
      const response = await dispatch(worker, environment, path);
      assert.equal(response.status, 200, await response.clone().text());
      const payload = await response.json();
      const listedProduct = payload.catalog.products.find((item) => item.id === product.productId);
      assert.equal(listedProduct?.incomingUnits, 18, path);
    }
  } finally {
    authServer.closeAllConnections();
    await new Promise((resolve) => authServer.close(resolve));
    await miniflare.dispose();
  }
});

test("purchase-order actions enforce the vendor-facing state and exact-money boundaries", async () => {
  const { miniflare, database, worker, environment, authServer } = await createEnvironment();
  try {
    const fixture = await onboardFixture(worker, environment, database);
    const create = (overrides = {}) => dispatch(worker, environment, "/api/v1/purchasing", {
      method: "POST",
      body: {
        action: "create",
        orderNumber: `PO-STATE-${crypto.randomUUID()}`,
        supplierName: "State Supplier",
        deliveryLocationId: fixture.locationId,
        orderDate: "2026-08-11",
        currency: "CAD",
        lines: [{ sku: "STATE", description: "State product", quantity: 1, unitCostCents: 100 }],
        ...overrides,
      },
    });

    const created = await create();
    assert.equal(created.status, 201, await created.clone().text());
    const order = (await created.json()).orders[0];
    const receiveDraft = await dispatch(worker, environment, "/api/v1/purchasing", {
      method: "POST",
      body: { action: "receive", purchaseOrderId: order.id, receivedDate: "2026-08-11", lines: [{ lineId: order.lines[0].id, quantity: 1 }] },
    });
    assert.equal(receiveDraft.status, 409);

    await database.prepare("UPDATE purchase_orders SET status = 'approved' WHERE id = ? AND organization_id = ?")
      .bind(order.id, fixture.organizationId).run();
    const missingDate = await dispatch(worker, environment, "/api/v1/purchasing", {
      method: "POST",
      body: { action: "mark_sent", purchaseOrderId: order.id, confirmExternalSend: true },
    });
    assert.equal(missingDate.status, 409);
    const setDate = await dispatch(worker, environment, "/api/v1/purchasing", {
      method: "POST",
      body: { action: "set_commitment_date", purchaseOrderId: order.id, committedCashDate: "2026-08-18" },
    });
    assert.equal(setDate.status, 200, await setDate.clone().text());
    const sent = await dispatch(worker, environment, "/api/v1/purchasing", {
      method: "POST",
      body: { action: "mark_sent", purchaseOrderId: order.id, confirmExternalSend: true },
    });
    assert.equal(sent.status, 200, await sent.clone().text());
    const duplicateSend = await dispatch(worker, environment, "/api/v1/purchasing", {
      method: "POST",
      body: { action: "mark_sent", purchaseOrderId: order.id, confirmExternalSend: true },
    });
    assert.equal(duplicateSend.status, 409);
    const sendAudits = await database.prepare(`SELECT COUNT(*) count FROM audit_events
      WHERE organization_id = ? AND action = 'purchase_order.external_send_confirmed' AND resource_id = ?`)
      .bind(fixture.organizationId, order.id).first();
    assert.equal(sendAudits.count, 1);

    const invalidDate = await create({ orderDate: "2026-02-30" });
    assert.equal(invalidDate.status, 400);
    const invalidCurrency = await create({ currency: "ZZZ" });
    assert.equal(invalidCurrency.status, 400);
    const overflow = await create({
      lines: [{ sku: "BIG", description: "Too large", quantity: 1_000_000, unitCostCents: 1_000_000_000_000 }],
    });
    assert.equal(overflow.status, 400);
  } finally {
    authServer.closeAllConnections();
    await new Promise((resolve) => authServer.close(resolve));
    await miniflare.dispose();
  }
});
