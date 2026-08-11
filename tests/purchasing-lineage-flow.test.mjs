import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { Miniflare } from "miniflare";

const origin = "https://vanteloq.example";
const owner = { email: "lineage-owner@example.invalid", name: "Lineage Owner" };
const executionContext = { waitUntil() {}, passThroughOnException() {} };

function identityHeaders(write = false) {
  const headers = {
    accept: "application/json",
    "oai-authenticated-user-email": owner.email,
    "oai-authenticated-user-full-name": encodeURIComponent(owner.name),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  };
  if (write) {
    headers["content-type"] = "application/json";
    headers.origin = origin;
    headers["sec-fetch-site"] = "same-origin";
  }
  return headers;
}

async function createEnvironment() {
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
    environment: { DB: database, ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
  };
}

async function dispatch(worker, environment, path, { method = "GET", body } = {}) {
  return worker.fetch(new Request(`${origin}${path}`, {
    method,
    headers: identityHeaders(method !== "GET"),
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
  };
}

test("purchase history stays isolated when same-provider accounts reuse a product reference", async () => {
  const { miniflare, database, worker, environment } = await createEnvironment();
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
    assert.equal(created.status, 201);
    const payload = await created.json();
    const products = new Map(payload.catalog.products.map((product) => [product.id, product]));
    assert.equal(products.get("product-account-a").incomingUnits, 5);
    assert.equal(products.get("product-account-b").incomingUnits, 0);
    assert.equal(payload.orders[0].lines[0].connectionId, "pos-account-a");
  } finally {
    await miniflare.dispose();
  }
});
