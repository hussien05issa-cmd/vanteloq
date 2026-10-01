import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { loadCommerceFieldEvidence } from "../server/integrations/data-readiness.ts";
import { buildConnectionDataReadiness } from "../domain/integration-data-readiness.ts";

test("migrated database evidence isolates accounts and organizations, preserves zero and unknown costs, and redacts restricted counts", async () => {
  const sql = new DatabaseSync(":memory:");
  try {
    for (const file of (await readdir(new URL("../drizzle/", import.meta.url))).filter(file => /^\d{4}.*\.sql$/.test(file)).sort()) {
      sql.exec(await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8"));
    }
    const db = { prepare(query: string) { return { bind(...values: SQLInputValue[]) { return { async first() { return sql.prepare(query).get(...values) ?? null; } }; } }; } } as unknown as D1Database;
    const insert = (table: string, values: Record<string, SQLInputValue>) => sql.prepare(`INSERT INTO ${table} (${Object.keys(values).join(",")}) VALUES (${Object.keys(values).map(() => "?").join(",")})`).run(...Object.values(values));
    const now = Math.floor(Date.now() / 1000);
    insert("users", { id: "owner", email: "owner@example.invalid", display_name: "Owner", created_at: now, updated_at: now });
    for (const org of ["org-a", "org-b"]) insert("workspaces", { id: org, owner_name: "Owner", business_name: "Business", legal_name: "Business", business_email: `${org}@example.invalid`, industry: "Retail", city: "Edmonton", address: "Test", postal_code: "T5A1A1", hours_json: "[]", created_at: now, updated_at: now });
    for (const [org, account] of [["org-a", "sales"], ["org-a", "payments"], ["org-b", "other"]]) {
      insert("integration_connections", { id: account, organization_id: org, provider: "square", source_namespace: account, status: "connected", data_promotion_status: "approved", created_at: now, updated_at: now });
      insert("integration_sync_runs", { id: `run-${account}`, organization_id: org, provider: "square", connection_id: account, mode: "incremental", status: "completed", started_at: now, completed_at: now });
    }
    for (const [org, account] of [["org-a", "sales"], ["org-b", "other"]]) insert("daily_business_metrics", { organization_id: org, business_date: "2026-09-01", location_ref: account, gross_sales_cents: 0, net_sales_cents: 0, cost_of_goods_cents: 0, transaction_count: 1, units_sold: 1, source_provider: "square", source_connection_id: account, created_by_user_id: "owner", created_at: now, updated_at: now });
    for (const [id, known, customer, sold] of [["known-zero", 1, "customer-ref", "2026-09-01T12:00:00Z"], ["unknown-zero", 0, null, null]] as const) {
      insert("commerce_sale_lines", { id, organization_id: "org-a", provider: "square", connection_id: "sales", external_sale_id: "order", external_line_id: id, quantity_milli: 1000, net_sales_cents: 0, cost_cents: 0, cost_known: known, product_ref: "product-ref", customer_ref: customer, sold_at: sold, source_payload_hash: id, sync_run_id: "run-sales", updated_at: now });
    }
    for (const [id, cost, ownerCost, archived] of [["unknown-product", null, null, 0], ["explicit-zero-product", null, 0, 0], ["archived-product", 100, null, 1]] as const) {
      insert("commerce_products", { id, organization_id: "org-a", provider: "square", connection_id: "sales", external_product_id: id, sku: id, name: id, default_cost_cents: cost, owner_cost_cents: ownerCost, archived, source_payload_hash: id, sync_run_id: "run-sales", updated_at: now });
    }
    insert("commerce_payments", { id: "payment", organization_id: "org-a", provider: "square", connection_id: "payments", external_payment_id: "payment", external_sale_id: "order", amount_cents: 0, paid_at: "2026-09-01T12:00:00Z", payment_type_name: "Cash", source_payload_hash: "payment", sync_run_id: "run-payments", updated_at: now });
    for (const status of ["mapped", "unmapped", "ignored"]) insert("integration_location_mappings", { id: status, organization_id: "org-a", provider: "square", connection_id: "sales", external_location_ref: status, external_name: status, local_location_id: status === "mapped" ? "owned-location" : null, status, last_seen_at: now, created_at: now, updated_at: now });
    insert("inventory_balances", { id: "stock", organization_id: "org-a", location_ref: "owned-location", sku: "product", name: "Product", on_hand_quantity: 0, source_provider: "square", source_connection_id: "sales", updated_at: now });
    const permissions = ["integrations.view", "metrics.revenue", "sales.transactions", "finance.costs", "metrics.profit", "inventory.view", "inventory.value", "customers.totals", "purchasing.view"];
    const sales = await loadCommerceFieldEvidence(db, "org-a", "sales", permissions);
    assert.deepEqual(sales.fields["sales.net"], { records: 1, populated: 1, authorised: true }, "a real zero sale remains a populated fact");
    assert.deepEqual(sales.fields["lines.cost"], { records: 2, populated: 1, authorised: true }, "zero with cost_known=false is not known cost");
    assert.deepEqual(sales.fields["products.cost"], { records: 2, populated: 1, authorised: true }, "explicit owner cost zero counts, null and archived products do not");
    assert.equal(sales.fields["lines.date"]?.populated, 1);
    assert.equal(sales.fields["lines.customer"]?.populated, 1);
    assert.equal(sales.fields["payments.amount"]?.records, 0, "sibling payments cannot fill the sales account");
    assert.deepEqual(sales.fields["locations.mapping"], { records: 2, populated: 1, authorised: true }, "an unmapped location remains visible; ignored locations are excluded");
    assert.deepEqual(sales.observedPeriod, { from: "2026-09-01", to: "2026-09-01" });
    const payment = await loadCommerceFieldEvidence(db, "org-a", "payments", permissions);
    assert.equal(payment.fields["payments.amount"]?.populated, 1, "zero tender amounts remain populated facts");
    assert.equal(payment.fields["sales.net"]?.records, 0);
    const crossTenant = await loadCommerceFieldEvidence(db, "org-a", "other", permissions);
    assert.equal(Object.values(crossTenant.fields).every(field => field.records === 0), true);
    const restricted = await loadCommerceFieldEvidence(db, "org-a", "sales", ["integrations.view"]);
    const visible = buildConnectionDataReadiness({ connectionId: "sales", commerceImplemented: true, authorised: true, approved: true, stale: false, ...restricted });
    assert.equal(visible.fields.find(field => field.id === "lines.cost")?.records, null);
    assert.equal(visible.fields.find(field => field.id === "sales.net")?.populated, null);
    assert.deepEqual(visible.observedPeriod, { from: null, to: null });
    assert.equal(visible.metrics.some(metric => metric.ready), false);
    assert.equal(restricted.coverage.sales, false);
  } finally { sql.close(); }
});
