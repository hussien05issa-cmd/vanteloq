import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { advertisingAmountMinor, advertisingCurrencyExponent, buildBookloqAdvertisingSpend, type AdvertisingBudget, type AdvertisingSpendRow } from "../domain/bookloq-advertising-spend.ts";
import { readBookloqAdvertisingRows, loadBookloqAdvertisingSpend } from "../server/bookloq-advertising-spend.ts";
import { syncMetaMarketing } from "../server/integrations/marketing.ts";
import { persistMarketingSnapshot } from "../server/integrations/marketing-routes.ts";
import type { VanteloqRuntimeEnv } from "../db/index.ts";

const now = Date.parse("2026-10-09T12:00:00Z") / 1000;
const period = { start: "2026-07-12", end: "2026-10-09" };
const row = (overrides: Partial<AdvertisingSpendRow> = {}): AdvertisingSpendRow => ({ selectionId: "selected", accountRef: "act_123", accountName: "Local ads", scopeKind: "location", locationId: "north", metricDate: "2026-10-01", amountMinor: 1250, currency: "CAD", reportingTimezone: "America/Edmonton", updatedAt: now, lastSyncedAt: now, ...overrides });
const budget = (overrides: Partial<AdvertisingBudget> = {}): AdvertisingBudget => ({ id: "budget", accountId: "marketing", accountSystemKey: "marketing_expense", accountType: "expense", periodStart: "2026-10-01", periodEnd: "2026-10-31", locationRef: "north", departmentRef: "all", ...overrides });
const build = (rows: AdvertisingSpendRow[], budgets: AdvertisingBudget[] = [budget()]) => buildBookloqAdvertisingSpend({ rows, budgets, baseCurrency: "CAD", period, nowSeconds: now });

test("advertising money uses exact decimal parsing and source currency precision", () => {
  assert.equal(advertisingAmountMinor("0.29", "CAD"), 29);
  assert.equal(advertisingAmountMinor("12.5000", "CAD"), 1250);
  assert.equal(advertisingAmountMinor("123.00", "JPY"), 123);
  assert.equal(advertisingAmountMinor("1.234", "KWD"), 1234);
  assert.equal(advertisingCurrencyExponent("CAD"), 2);
  for (const input of ["12.501", "1e3", "-1", "", "NaN", "9007199254740992", 1.23, null]) assert.equal(advertisingAmountMinor(input, "CAD"), null);
  for (const currency of ["ZZZ", "cad", "", null]) assert.equal(advertisingAmountMinor("1", currency), null);
});

test("reported spend compares only to the advertising account and exact budget scope without financial mutation", () => {
  const inputs = [row(), row({ metricDate: "2026-10-02", amountMinor: 750 }), row({ accountRef: "act_456", locationId: "south", amountMinor: 900 })];
  const budgets = [budget(), budget({ id: "all", locationRef: "all" }), budget({ id: "other", accountSystemKey: "rent_expense" }), budget({ id: "department", departmentRef: "sales" })];
  const before = JSON.stringify({ inputs, budgets });
  const result = build(inputs, budgets);
  assert.equal(result.budgets.find(item => item.budgetId === "budget")?.reportedSpendCents, 2000);
  assert.equal(result.budgets.find(item => item.budgetId === "all")?.reportedSpendCents, 2900);
  assert.equal(result.budgets.find(item => item.budgetId === "other"), undefined);
  assert.equal(result.budgets.find(item => item.budgetId === "department")?.reportedSpendCents, null);
  assert.equal(JSON.stringify({ inputs, budgets }), before);
  assert.match(result.boundary, /not added to budget actuals, commitments, forecasts, cash balances or financial statements/);
});

test("natural account-day identity deduplicates copies and fails closed on conflict", () => {
  const original = row();
  const copy = row({ selectionId: "replacement", updatedAt: now + 1 });
  assert.equal(build([original, copy]).accounts[0].reportedSpendCents, 1250);
  for (const changed of [row({ selectionId: "second", amountMinor: 1251 }), row({ selectionId: "second", currency: "USD" }), row({ selectionId: "second", locationId: "south" })]) {
    const result = build([original, changed]);
    assert.equal(result.accounts[0].status, "needs_review");
    assert.equal(result.accounts[0].reportedSpendCents, null);
    assert.equal(result.budgets[0].reportedSpendCents, null);
  }
  // An upserted source correction is one replacement, not another expense.
  assert.equal(build([row({ amountMinor: 1200 })]).accounts[0].reportedSpendCents, 1200);
});

test("foreign, legacy, invalid, stale and overflowing evidence never becomes a base-currency total", () => {
  const foreign = build([row({ currency: "USD" })]);
  assert.equal(foreign.accounts[0].amountMinor, 1250);
  assert.equal(foreign.accounts[0].reportedSpendCents, null);
  for (const overrides of [{ currency: null }, { reportingTimezone: null }, { reportingTimezone: "Account timezone" }, { amountMinor: null }, { amountMinor: -1 }, { amountMinor: 1.5 }, { metricDate: "2026-99-01" }, { updatedAt: now - 8 * 86400 }, { lastSyncedAt: now + 1000 }]) {
    const result = build([row(overrides)]);
    assert.equal(result.accounts[0].reportedSpendCents, null, JSON.stringify(overrides));
    assert.notEqual(result.budgets[0].status, "ready");
  }
  assert.equal(build([row({ amountMinor: Number.MAX_SAFE_INTEGER }), row({ metricDate: "2026-10-02", amountMinor: 1 })]).accounts[0].amountMinor, null);
  assert.equal(build([row({ amountMinor: 0 })]).budgets[0].reportedSpendCents, 0);
  assert.equal(build([]).status, "unavailable");
});

test("missing evidence and wider or unallocated budget scopes remain visibly unavailable", () => {
  assert.equal(build([row()], [budget({ periodStart: "2026-01-01" })]).budgets[0].reportedSpendCents, null);
  assert.equal(build([row({ scopeKind: "organization", locationId: null })]).budgets[0].status, "no_data");
  const result = build([row(), row({ accountRef: "act_999", metricDate: null, amountMinor: null, currency: null, reportingTimezone: null })]);
  assert.equal(result.budgets[0].reportedSpendCents, null);
  assert.equal(buildBookloqAdvertisingSpend({ rows: [row()], budgets: [budget()], baseCurrency: "CAD", period, restricted: true }).accounts.length, 0);
});

test("restricted and demonstration books never query live advertising sources", async () => {
  // A missing context/database would throw if either branch accessed a source.
  const context = {} as Parameters<typeof loadBookloqAdvertisingSpend>[0];
  const input = { baseCurrency: "CAD", locationId: null, budgets: [], allowed: false, dataMode: "live", nowMs: now * 1000 };
  assert.equal((await loadBookloqAdvertisingSpend(context, input)).status, "restricted");
  assert.equal((await loadBookloqAdvertisingSpend(context, { ...input, allowed: true, dataMode: "demonstration" })).status, "unavailable");
});

test("Meta typed spend is withheld for unknown metadata, unsafe amounts and incomplete reporting", { concurrency: false }, async () => {
  const runtime = globalThis as typeof globalThis & { __vanteloqEnv?: Record<string, string> };
  const previousEnv = runtime.__vanteloqEnv;
  runtime.__vanteloqEnv = { META_MARKETING_APP_ID: "test", META_MARKETING_APP_SECRET: "test", META_MARKETING_REDIRECT_URI: "https://example.invalid/callback", INTEGRATION_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" };
  const originalFetch = globalThis.fetch;
  try {
    for (const scenario of ["valid", "currency", "timezone", "account", "precision", "paging"]) {
      globalThis.fetch = async input => String(input).includes("/insights?")
        ? Response.json({ data: [{ date_start: "2026-10-01", spend: scenario === "precision" ? "1.001" : "0.29" }], ...(scenario === "paging" ? { paging: { next: "https://graph.facebook.com/next" } } : {}) })
        : Response.json({ id: scenario === "account" ? "act_456" : "act_123", currency: scenario === "currency" ? "ZZZ" : "CAD", timezone_name: scenario === "timezone" ? "unknown" : "America/Edmonton" });
      const result = await syncMetaMarketing("test", [{ id: "selected", provider: "meta", dataset: "meta_ads", externalResourceRef: "act_123", scopeKind: "organization", localLocationId: null }]);
      assert.equal(result.metrics.find(item => item.metricKey === "meta_spend")?.moneyAmountMinor ?? null, scenario === "valid" ? 29 : null, scenario);
      assert.equal(result.warnings.length === 0, scenario === "valid");
    }
  } finally { globalThis.fetch = originalFetch; runtime.__vanteloqEnv = previousEnv; }
});

test("additive money migration preserves source rows and source reads enforce tenant, location and promotion", { timeout: 120000 }, async () => {
  const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('ok')}}", d1Databases: { DB: `advertising-spend-${crypto.randomUUID()}` } });
  try {
    const db = await mf.getD1Database("DB") as unknown as D1Database;
    const migrations = (await readdir(new URL("../drizzle/", import.meta.url))).filter(file => /^\d{4}.*\.sql$/.test(file)).sort();
    const apply = async (file: string) => { for (const sql of (await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8")).split("--> statement-breakpoint").map(text => text.trim()).filter(Boolean)) await db.prepare(sql).run(); };
    for (const file of migrations.filter(file => file < "0076")) await apply(file);
    await db.prepare("INSERT INTO users(id,email,display_name,created_at,updated_at) VALUES('actor','ads@example.invalid','Test',1,1)").run();
    for (const org of ["org", "other"]) await db.prepare("INSERT INTO workspaces(id,owner_name,business_name,legal_name,business_email,industry,city,address,postal_code,hours_json,created_at,updated_at) VALUES(?,'Test','Ads','Ads','ads@example.invalid','Retail','Edmonton','Test','T5A1A1','[]',1,1)").bind(org).run();
    for (const id of ["north", "south"]) await db.prepare("INSERT INTO organization_locations(id,organization_id,name,country_code,address_line_1,locality,administrative_area,timezone,currency,created_at,updated_at) VALUES(?,'org',?,'CA','Test','Edmonton','AB','America/Edmonton','CAD',1,1)").bind(id,id).run();
    for (const [id, org, promotion, location, lease] of [["approved","org","approved","north",null], ["south-source","org","approved","south",null], ["staged","org","staging","north",null], ["foreign","other","approved",null,null], ["syncing","org","approved","north","active"]]) {
      await db.prepare("INSERT INTO integration_connections(id,organization_id,provider,source_namespace,status,data_promotion_status,sync_lease_owner,last_successful_sync_at,created_at,updated_at) VALUES(?,?,'meta',?,'connected',?,?,?,1,1)").bind(id,org,id,promotion,lease,now).run();
      await db.prepare("INSERT INTO marketing_resource_selections(id,organization_id,connection_id,provider,dataset,external_resource_ref,external_resource_name,scope_kind,local_location_id,selected_by_user_id,selected_at,created_at,updated_at) VALUES(?,?,?,'meta','meta_ads',?,?,?,?,'actor',1,1,1)").bind(id,org,id,`act_${id}`,id,location ? "location" : "organization",location).run();
      await db.prepare("INSERT INTO marketing_daily_metrics(id,resource_selection_id,metric_date,metric_key,value_milli,source_event_id,created_at,updated_at) VALUES(?,?,'2026-10-01','meta_spend',12500,?,1,?)").bind(id,id,id,now).run();
    }
    await apply(migrations.find(file => file.startsWith("0076_"))!);
    const legacy = await readBookloqAdvertisingRows(db,"org","north",period);
    assert.deepEqual(legacy.map(item => item.selectionId), ["approved"]);
    assert.equal(legacy[0].amountMinor, null);
    assert.equal(build(legacy).accounts[0].status, "needs_review");
    await db.prepare("UPDATE marketing_daily_metrics SET money_amount_minor=1250,money_currency='CAD',reporting_timezone='America/Edmonton' WHERE id='approved'").run();
    const before = await db.prepare("SELECT COUNT(*) n FROM journal_entries UNION ALL SELECT COUNT(*) FROM financial_transactions UNION ALL SELECT COUNT(*) FROM supplier_bills UNION ALL SELECT COUNT(*) FROM bookloq_budgets").all();
    assert.equal(build(await readBookloqAdvertisingRows(db,"org","north",period)).budgets[0].reportedSpendCents, 1250);
    assert.deepEqual((await readBookloqAdvertisingRows(db,"org",null,period)).map(item => item.selectionId).sort(), ["approved","south-source"]);
    assert.deepEqual(await readBookloqAdvertisingRows(db,"org","missing",period), []);
    assert.deepEqual(await db.prepare("SELECT COUNT(*) n FROM journal_entries UNION ALL SELECT COUNT(*) FROM financial_transactions UNION ALL SELECT COUNT(*) FROM supplier_bills UNION ALL SELECT COUNT(*) FROM bookloq_budgets").all().then(result => result.results), before.results);
    assert.equal((await db.prepare("PRAGMA foreign_key_check").all()).results?.length, 0);
    await db.prepare("UPDATE integration_connections SET last_error_code='MARKETING_PARTIAL_SYNC' WHERE id='approved'").run();
    assert.deepEqual(await readBookloqAdvertisingRows(db,"org","north",period), [], "a failed refresh must not certify retained money evidence");
    await db.prepare("UPDATE integration_connections SET last_error_code=NULL WHERE id='approved'").run();
    await db.prepare("UPDATE marketing_resource_selections SET external_resource_ref='act_approved' WHERE id='south-source'").run();
    assert.equal(build(await readBookloqAdvertisingRows(db,"org","north",period)).accounts[0].reportedSpendCents, null, "a location filter must not hide conflicting assignments of the same ad account");

    const runtime = globalThis as typeof globalThis & { __vanteloqEnv?: VanteloqRuntimeEnv };
    const previousEnv = runtime.__vanteloqEnv;
    runtime.__vanteloqEnv = { DB: db };
    try {
      const snapshot = { metrics: [{ resourceSelectionId: "approved", metricDate: "2026-10-01", metricKey: "meta_spend", valueMilli: 12500, sourceEventId: "approved", moneyAmountMinor: 1250, moneyCurrency: "CAD", reportingTimezone: "America/Edmonton" }], resourcesRead: 1, warnings: [], resourceResults: [{ resourceSelectionId: "approved", recordsRead: 1, warningCodes: [] }] };
      const source = { organizationId: "org", connectionId: "approved", provider: "meta" as const, mode: "incremental" as const };
      await persistMarketingSnapshot(snapshot, source);
      await persistMarketingSnapshot(snapshot, source);
      assert.equal((await db.prepare("SELECT COUNT(*) n FROM marketing_daily_metrics WHERE resource_selection_id='approved'").first<{n:number}>())?.n, 1);
      await persistMarketingSnapshot({ ...snapshot, metrics: [{ ...snapshot.metrics[0], valueMilli: 12000, moneyAmountMinor: 1200 }] }, source);
      assert.equal((await db.prepare("SELECT money_amount_minor amount FROM marketing_daily_metrics WHERE id='approved'").first<{amount:number}>())?.amount, 1200);
      await persistMarketingSnapshot({ ...snapshot, metrics: [] }, source);
      const omitted = await db.prepare("SELECT value_milli value, money_amount_minor amount FROM marketing_daily_metrics WHERE id='approved'").first();
      assert.deepEqual(omitted, { value: 12000, amount: null }, "an omitted day retains analytics but loses financial verification");
      assert.deepEqual(await db.prepare("SELECT COUNT(*) n FROM journal_entries UNION ALL SELECT COUNT(*) FROM financial_transactions UNION ALL SELECT COUNT(*) FROM supplier_bills UNION ALL SELECT COUNT(*) FROM bookloq_budgets").all().then(result => result.results), before.results);
    } finally { runtime.__vanteloqEnv = previousEnv; }
  } finally { await mf.dispose(); }
});
