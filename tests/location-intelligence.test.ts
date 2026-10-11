import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { locationPeriodMetrics, locationReportingPeriod, type LocationMetricRow } from "../domain/location-intelligence";
import { readLocationIntelligence } from "../server/location-intelligence";
import type { AccessContext } from "../server/authorization";

const permissions = ["dashboard.view", "metrics.revenue", "metrics.profit", "inventory.value", "integrations.view", "integrations.manage"];
const period = locationReportingPeriod("2026-09-30")!;
const dates = Array.from({ length: 30 }, (_, day) => `2026-09-${String(day + 1).padStart(2, "0")}`);
const rows = (locationRef = "main", sourceConnectionId: string | null = null): LocationMetricRow[] => dates.map(businessDate => ({ businessDate, locationRef, sourceConnectionId, netSalesCents: 100, costOfGoodsCents: 40, transactionCount: 1, inventoryValueCents: 900, updatedAt: new Date("2026-10-01T10:00:00Z") }));
const metric = (override: Partial<Parameters<typeof locationPeriodMetrics>[0]> = {}) => locationPeriodMetrics({ locationId: "main", locationCurrency: "CAD", currency: "CAD", timeZone: "America/Edmonton", today: "2026-10-01", period, rows: rows(), scopes: [], authority: "ready", queryComplete: true, permissions, ...override });

test("location summaries require every date per authoritative outlet and preserve recorded zero", () => {
  const recorded = metric();
  assert.equal(recorded.netSalesCents, 3000); assert.equal(recorded.grossProfitCents, 1800);
  assert.equal(recorded.inventoryValueCents, 900); assert.equal(recorded.profitAvailability, "owner_reviewed");
  const zero = metric({ rows: rows().map(row => ({ ...row, netSalesCents: 0, costOfGoodsCents: 0 })) });
  assert.equal(zero.netSalesCents, 0); assert.equal(zero.grossProfitCents, 0);
  const outletRows = rows("square:a", "one");
  const scopes = [{ connectionId: "one", metricLocationRef: "square:a" }, { connectionId: "one", metricLocationRef: "square:b" }];
  const partial = metric({ scopes, rows: [...outletRows, ...rows("square:b", "one").slice(1)] });
  assert.equal(partial.days, 30); assert.equal(partial.coverage.observedRecords, 59); assert.equal(partial.coverage.expectedRecords, 60);
  assert.equal(partial.netSalesCents, null); assert.equal(partial.transactionCount, null);
  const complete = metric({ scopes, rows: [...outletRows, ...rows("square:b", "one"), ...rows("other", "foreign")] });
  assert.equal(complete.netSalesCents, 6000); assert.equal(complete.grossProfitCents, null); assert.equal(complete.inventoryValueCents, null);
});

test("source conflict, incomplete query and duplicate observations cannot become usable totals", () => {
  for (const override of [{ authority: "conflict" as const }, { authority: "needs_data" as const }, { queryComplete: false }, { rows: [...rows(), rows()[0]] }]) {
    const result = metric(override);
    assert.equal(result.netSalesCents, null); assert.equal(result.grossProfitCents, null); assert.equal(result.comparisonEligible, false);
  }
  assert.equal(metric({ rows: [] }).netSalesCents, null);
  assert.equal(locationReportingPeriod("2026-02-30"), null);
});

test("currency mismatch, absent permissions, stale periods and overflow remain explicit", () => {
  const mixed = metric({ locationCurrency: "USD" });
  assert.equal(mixed.netSalesCents, null); assert.equal(mixed.grossProfitCents, null); assert.equal(mixed.inventoryValueCents, null);
  assert.equal(mixed.currency, "CAD"); assert.equal(mixed.locationCurrency, "USD"); assert.equal(mixed.status, "currency_mismatch");
  assert.equal(mixed.transactionCount, 30);
  const denied = metric({ permissions: [] });
  assert.equal(denied.netSalesCents, null); assert.equal(denied.transactionCount, null); assert.equal(denied.lastUpdatedAt, null); assert.equal(denied.coverage.observedRecords, null);
  assert.equal(denied.period, null); assert.equal(denied.from, null); assert.equal(denied.to, null); assert.equal(denied.coverage.sourceScopes, 0);
  assert.doesNotMatch(denied.limitations.join(" "), /30|2026/);
  const stale = metric({ today: "2026-10-20" });
  assert.equal(stale.status, "stale"); assert.equal(stale.comparisonEligible, false); assert.equal(stale.netSalesCents, 3000, "explicitly dated historical totals remain recorded");
  const overflow = metric({ rows: rows().map(row => ({ ...row, netSalesCents: Number.MAX_SAFE_INTEGER })) });
  assert.equal(overflow.netSalesCents, null); assert.equal(overflow.status, "needs_data");
});

/** Actual migrated SQLite, Drizzle queries and authorization scope, without a Worker or network. */
function fixture() {
  const database = new DatabaseSync(":memory:");
  for (const file of readdirSync(new URL("../drizzle/", import.meta.url)).filter(file => /^\d{4}.*\.sql$/.test(file)).sort()) database.exec(readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8"));
  database.exec("PRAGMA foreign_keys=ON");
  let metricPages = 0;
  class Prepared {
    values: SQLInputValue[] = [];
    constructor(readonly query: string) {}
    bind(...values: SQLInputValue[]) { const p = new Prepared(this.query); p.values = values; return p; }
    async all() { return { success: true, results: database.prepare(this.query).all(...this.values), meta: {} }; }
    async first(column?: string) { const row = database.prepare(this.query).get(...this.values); return row ? column ? row[column] : row : null; }
    async raw() { if (this.query.includes('from "daily_business_metrics"') && this.query.includes('order by "daily_business_metrics"."id"')) metricPages++; const q = database.prepare(this.query); q.setReturnArrays(true); return q.all(...this.values); }
    async run() { const result = database.prepare(this.query).run(...this.values); return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }; }
  }
  const binding = { prepare: (query: string) => new Prepared(query) } as unknown as D1Database;
  const runtime = globalThis as typeof globalThis & { __vanteloqEnv?: { DB?: D1Database } };
  const previous = runtime.__vanteloqEnv;
  runtime.__vanteloqEnv = { DB: binding };
  const insert = (table: string, values: Record<string, SQLInputValue>) => database.prepare(`INSERT INTO ${table} (${Object.keys(values).join(",")}) VALUES (${Object.keys(values).map(() => "?").join(",")})`).run(...Object.values(values));
  insert("users", { id: "owner", email: "owner@example.invalid", display_name: "Owner", created_at: 1, updated_at: 1 });
  insert("users", { id: "limited", email: "limited@example.invalid", display_name: "Limited", created_at: 1, updated_at: 1 });
  for (const id of ["a", "b"]) insert("workspaces", { id, owner_name: "Owner", business_name: id, legal_name: id, business_email: `${id}@example.invalid`, industry: "Retail", city: "Edmonton", address: "Test", postal_code: "T5A1A1", hours_json: "[]", created_at: 1, updated_at: 1 });
  const context = { organizationId: "a", userId: "owner", role: "owner", organization: { timezone: "America/Edmonton", currency: "CAD" } } as AccessContext;
  const location = (id: string, organizationId = "a", currency = "CAD") => insert("organization_locations", { id, organization_id: organizationId, name: id, country_code: "CA", address_line_1: "Test", locality: "Edmonton", administrative_area: "AB", timezone: "America/Edmonton", currency, created_at: 1, updated_at: 1 });
  const source = (id: string, provider: string, localId: string, outlet = "1", organizationId = "a") => {
    insert("integration_connections", { id, organization_id: organizationId, provider, source_namespace: id, status: "connected", data_promotion_status: "approved", last_successful_sync_at: 1, created_at: 1, updated_at: 1 });
    insert("integration_location_mappings", { id: `map-${id}`, organization_id: organizationId, provider, connection_id: id, external_location_ref: outlet, external_name: id, local_location_id: localId, status: "mapped", last_seen_at: 1, created_at: 1, updated_at: 1 });
    return `${provider}:${id}:${outlet}`;
  };
  const facts = (locationRef: string, connection: string | null = null, provider: string | null = null, organizationId = "a", amount = 100, sourceDates = dates) => {
    for (const businessDate of sourceDates) insert("daily_business_metrics", { organization_id: organizationId, business_date: businessDate, location_ref: locationRef, gross_sales_cents: Math.max(0, amount), net_sales_cents: amount, cost_of_goods_cents: 40, transaction_count: 1, units_sold: 1, inventory_value_cents: 900, source_provider: provider, source_connection_id: connection, created_by_user_id: "owner", created_at: 1, updated_at: 1 });
  };
  return { database, insert, context, location, source, facts, pages: () => metricPages, read: (actor = context, allowed = permissions) => readLocationIntelligence(actor, allowed), dispose() { runtime.__vanteloqEnv = previous; database.close(); } };
}

test("actual location query excludes competing feeds and manual duplicates until one source is selected", async () => {
  const f = fixture();
  try {
    f.location("main"); f.location("manual");
    f.facts(f.source("square", "square", "main"), "square", "square");
    f.facts(f.source("clover", "clover", "main"), "clover", "clover", "a", 900);
    f.facts("main", null, null, "a", 9999); f.facts("manual");
    const conflict = await f.read();
    assert.equal(conflict.locations.find(row => row.id === "main")!.metrics.status, "source_conflict");
    assert.equal(conflict.locations.find(row => row.id === "main")!.metrics.netSalesCents, null);
    assert.equal(conflict.locations.find(row => row.id === "manual")!.metrics.netSalesCents, 3000);
    f.insert("integration_source_authorities", { id: "authority", organization_id: "a", local_location_id: "main", channel: "retail", fact_family: "sales", provider: "square", connection_id: "square", created_by_user_id: "owner", updated_by_user_id: "owner", version: 1, created_at: 1, updated_at: 1 });
    const selected = (await f.read()).locations.find(row => row.id === "main")!;
    assert.equal(selected.metrics.netSalesCents, 3000); assert.equal(selected.metrics.transactionCount, 30);
    assert.equal(selected.metrics.grossProfitCents, null, "unverified provider costs must not imply a zero-cost 100% margin");
    assert.equal(selected.metrics.inventoryValueCents, null);
    f.database.prepare("UPDATE integration_connections SET sync_lease_owner='busy',sync_lease_expires_at=? WHERE id='square'").run(Math.floor(Date.now() / 1000) + 600);
    assert.equal((await f.read()).locations.find(row => row.id === "main")!.metrics.netSalesCents, null, "an in-progress refresh cannot expose old totals");
  } finally { f.dispose(); }
});

test("location query enforces actual member location scope and hides other tenants and currencies", async () => {
  const f = fixture();
  try {
    f.location("main"); f.location("restricted"); f.location("foreign", "b"); f.location("usd", "a", "USD");
    f.facts("main"); f.facts("restricted", null, null, "a", 900, ["2026-10-01"]); f.facts("foreign", null, null, "b", 8888, ["2026-10-02"]); f.facts("usd");
    f.insert("team_members", { id: "limited-team", organization_id: "a", user_id: "limited", first_name: "Limited", last_name: "Reader", email: "limited@example.invalid", employee_code: "L", permitted_locations_json: '["main"]', status: "active", created_by_user_id: "owner", created_at: 1, updated_at: 1 });
    const limited = await f.read({ ...f.context, userId: "limited", role: "employee" });
    assert.deepEqual(limited.locations.map(row => row.id), ["main"]); assert.equal(limited.latestBusinessDate, "2026-09-30");
    assert.equal(limited.locations[0].metrics.netSalesCents, 3000);
    f.database.prepare("DELETE FROM daily_business_metrics WHERE location_ref='restricted'").run();
    const full = await f.read();
    assert.equal(full.locations.find(row => row.id === "usd")!.metrics.netSalesCents, null);
    assert.equal(full.locations.find(row => row.id === "usd")!.metrics.locationCurrency, "USD");
    assert.equal(full.locations.find(row => row.id === "restricted")!.metrics.netSalesCents, null, "a complete store cannot hide an empty one");
    assert.equal(full.comparisonEligible, false);
    const denied = await f.read(f.context, ["dashboard.view"]);
    assert.equal(denied.latestBusinessDate, null);
    assert.equal(denied.locations.every(row => row.metrics.netSalesCents === null && row.metrics.lastUpdatedAt === null && row.sourceMappings.length === 0), true);
  } finally { f.dispose(); }
});

test("location query reads all 2,700 current rows using stable pagination instead of a 2,500-row sample", async () => {
  const f = fixture();
  try {
    for (let index = 0; index < 90; index++) { const id = `store-${index}`; f.location(id); f.facts(id); }
    // Older records and another organization's newer date cannot move this window.
    f.facts("store-0", null, null, "a", 999999, ["2020-01-01"]);
    f.location("foreign", "b"); f.facts("foreign", null, null, "b", 999999, ["2026-10-02"]);
    const result = await f.read();
    assert.equal(result.locations.length, 90); assert.equal(result.latestBusinessDate, "2026-09-30");
    assert.equal(result.locations.every(row => row.metrics.netSalesCents === 3000 && row.metrics.coverage.complete && row.metrics.coverage.queryComplete), true);
    assert.equal(result.locations.reduce((total, row) => total + row.metrics.netSalesCents!, 0), 270000);
    assert.equal(f.pages(), 3);
  } finally { f.dispose(); }
});
