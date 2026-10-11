import assert from "node:assert/strict";
import test from "node:test";
import { posSqliteFixture } from "./helpers/pos-sqlite-fixture.ts";
import { bookloqReportCsv, bookloqReportQuery, canReadBookloqReportDetails, loadBookloqDatedReport, requireBookloqReportScope } from "../server/bookloq-reports.ts";

const permissions = ["finance.statements", "finance.costs", "metrics.profit", "metrics.revenue", "payroll.totals", "finance.bank_balances", "finance.ap_ar"];
const code = (value: string) => (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === value);
const query = (params = "") => bookloqReportQuery(new URLSearchParams(params), "2026-10-10");

test("dated report scope requires every ledger disclosure permission, all locations and separate export/detail grants", () => {
  requireBookloqReportScope(permissions, true, null, false);
  for (const permission of permissions) assert.throws(() => requireBookloqReportScope(permissions.filter(item => item !== permission), true, null, false), code("BOOKLOQ_LEDGER_ACCESS_REQUIRED"));
  for (const [organizationWide, location] of [[false, null], [true, "branch"]] as const) assert.throws(() => requireBookloqReportScope(permissions, organizationWide, location, false), code("BOOKLOQ_REPORT_ORGANIZATION_SCOPE_REQUIRED"));
  assert.throws(() => requireBookloqReportScope(permissions, true, null, true), code("BOOKLOQ_REPORT_EXPORT_REQUIRED"));
  requireBookloqReportScope([...permissions, "finance.export"], true, null, true);
  assert.equal(canReadBookloqReportDetails(permissions), false);
  assert.equal(canReadBookloqReportDetails([...permissions, "finance.bank_transactions"]), false);
  assert.equal(canReadBookloqReportDetails([...permissions, "payroll.individual"]), false);
  assert.equal(canReadBookloqReportDetails([...permissions, "payroll.individual", "finance.bank_transactions"]), true);
});

test("calendar filters validate leap dates, duplicate/unknown filters, ranges and bounded keyset cursors", () => {
  assert.deepEqual([query().from, query().to], ["2026-10-01", "2026-10-10"]);
  assert.equal(query("report=balance&to=2024-02-29").to, "2024-02-29");
  for (const params of ["from=2026-02-29", "to=2026-10-11", "from=2026-10-10&to=2026-10-09", "from=1800-01-01", "from=2000-01-01", "from=2026-10-01&from=2026-10-02", "organizationId=other", "report=cash", "format=pdf", "accountId="]) assert.throws(() => query(params));
  const after = btoa(JSON.stringify(["2026-09-30", "entry", 2]));
  assert.deepEqual(query("accountId=cash&after=" + encodeURIComponent(after)).after, ["2026-09-30", "entry", 2]);
  for (const params of ["after=" + after, "accountId=cash&after=not-json", "accountId=cash&format=csv&after=" + after]) assert.throws(() => query(params), code("BOOKLOQ_REPORT_CURSOR_INVALID"));
});

async function fixture() {
  const fixture = await posSqliteFixture();
  const db = fixture.database;
  await db.prepare("INSERT INTO users(id,email,display_name,created_at,updated_at) VALUES ('actor','reports@example.invalid','QA',1,1)").run();
  for (const org of ["org", "other"]) {
    await db.prepare("INSERT INTO workspaces(id,owner_name,business_name,legal_name,business_email,industry,city,address,postal_code,hours_json,created_at,updated_at) VALUES (?,'QA','QA','QA','qa@example.invalid','Retail','Edmonton','QA','T5A1A1','[]',1,1)").bind(org).run();
    await db.prepare("INSERT INTO bookloq_settings(organization_id,status,updated_by_user_id,created_at,updated_at) VALUES (?,'active','actor',1,1)").bind(org).run();
    await db.prepare("INSERT INTO accounting_periods(id,organization_id,label,start_date,end_date,status,created_at,updated_at) VALUES (?,?,'QA','2026-01-01','2026-12-31','open',1,1)").bind(org + "-period", org).run();
    for (const [id, type, subtype, normal] of [["cash", "asset", "cash", "debit"], ["sales", "revenue", "sales", "credit"], ["capital", "equity", "capital", "credit"], ["expense", "expense", "operating", "debit"], ["contra", "asset", "fixed_asset", "credit"]]) {
      await db.prepare("INSERT INTO financial_accounts(id,organization_id,code,name,account_type,account_subtype,normal_balance,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,1,1,1)").bind(org + "-" + id, org, id, id === "sales" ? "=fictional formula" : id, type, subtype, normal).run();
    }
  }
  const database = { prepare: db.prepare.bind(db), batch: async (items: D1PreparedStatement[]) => {
    fixture.sqlite.exec("BEGIN");
    try { const results = []; for (const item of items) results.push(await item.all()); fixture.sqlite.exec("COMMIT"); return results; }
    catch (error) { fixture.sqlite.exec("ROLLBACK"); throw error; }
  } } as D1Database;
  async function entry(id: string, date: string, debit: string, credit: string, amount: number, options: { org?: string; currency?: string; status?: string; reversalOf?: string } = {}) {
    const org = options.org ?? "org";
    await db.prepare("INSERT INTO journal_entries(id,organization_id,entry_number,entry_date,posting_date,period_id,status,source_type,source_ref,memo,currency,total_debit_cents,total_credit_cents,reversal_of_entry_id,idempotency_key,prepared_by_user_id,posted_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,'private-contact','Private payroll explanation',?,?,?,?,?,'actor',1791590400,1,1)")
      .bind(id, org, id, date, "2026-10-10", org + "-period", options.status ?? "posted", options.reversalOf ? "reversal" : "manual", options.currency ?? "CAD", amount, amount, options.reversalOf ?? null, id).run();
    for (const [index, account, dr, cr] of [[1, debit, amount, 0], [2, credit, 0, amount]] as const) await db.prepare("INSERT INTO journal_lines(id,organization_id,journal_entry_id,line_number,account_id,description,debit_cents,credit_cents,created_at) VALUES (?,?,?,?,?,'Private line',?,?,1)").bind(id + "-" + index, org, id, index, org + "-" + account, dr, cr).run();
  }
  const read = (params = "", options: Partial<Parameters<typeof loadBookloqDatedReport>[1]> = {}) => loadBookloqDatedReport(database, { organizationId: "org", currency: "CAD", timeZone: "America/Edmonton", contactIdentity: true, individualDetails: true, query: query(params), ...options }, new Date("2026-10-10T12:00:00Z"));
  return { ...fixture, db, database, entry, read };
}

test("real migrated SQLite separates period activity, closing balances, currencies, tenants and reversal dates", async () => {
  const f = await fixture();
  try {
    await f.entry("opening", "2026-08-01", "cash", "capital", 10000);
    await f.entry("original", "2026-09-30", "cash", "sales", 12345, { status: "reversed" });
    await f.entry("reversal", "2026-10-03", "sales", "cash", 12345, { reversalOf: "original" });
    await f.entry("oct-sale", "2026-10-04", "cash", "sales", 20001);
    await f.entry("cost", "2026-10-04", "expense", "cash", 101);
    await f.entry("depreciation", "2026-10-05", "expense", "contra", 999);
    await f.entry("future", "2026-10-11", "cash", "sales", 99999);
    await f.entry("draft", "2026-10-04", "cash", "sales", 99999, { status: "draft" });
    await f.entry("usd", "2026-10-04", "cash", "sales", 99999, { currency: "USD" });
    await f.entry("foreign-tenant", "2026-10-04", "cash", "sales", 99999, { org: "other" });
    await f.db.prepare("UPDATE financial_accounts SET active=0 WHERE id='org-contra'").run();
    const september = await f.read("from=2026-09-01&to=2026-09-30");
    assert.equal(september.profitAndLoss.revenueCents, 12345, "A later reversal does not erase the original from its earlier period");
    assert.equal(september.balanceSheet.assetCents, 22345);
    assert.equal(september.balanceSheet.differenceCents, 0);
    const october = await f.read();
    assert.equal(october.profitAndLoss.revenueCents, 7656);
    assert.equal(october.profitAndLoss.netProfitCents, 6556);
    assert.equal(october.balanceSheet.assetCents, 28901);
    assert.equal(october.balanceSheet.recordedEarningsCents, 18901);
    assert.equal(october.balanceSheet.equityCents, 28901);
    assert.equal(october.balanceSheet.differenceCents, 0);
    assert.equal(october.trialBalance.differenceCents, 0);
    assert.equal(october.accounts.find(row => row.id === "org-contra")?.closingBalanceCents, -999, "Credit-normal contra assets reduce assets");
    assert.equal(october.metadata.foreignEntryCount, 1);
    assert.equal(october.coverage.periodLineCount, 8);
    assert.equal(october.coverage.closingLineCount, 12);
    assert.equal(october.metadata.generatedAt, "2026-10-10T12:00:00.000Z");
    assert.ok(october.accounts.every(row => row.id.startsWith("org-")));
    const line = (await f.read("accountId=org-sales")).detail!.lines.find(row => row.entryId === "reversal")!;
    assert.equal(line.reversalOfEntryId, "original"); assert.equal(line.entryDate, "2026-10-03"); assert.equal(line.postingDate, "2026-10-10");
    const empty = await f.read("from=2026-01-01&to=2026-01-31");
    assert.equal(empty.coverage.closingLineCount, 0);
    const csv = bookloqReportCsv(october, "balance");
    assert.match(csv, /Amount unit,Integer minor units \(cents\)/);
    assert.match(csv, /Organization ID,org/);
    assert.match(csv, /Recorded earnings through as-of date \(included in equity\),equity,CAD,,,18901/);
    assert.match(bookloqReportCsv(october, "pnl"), /'=fictional formula/);
    // A trial balance lists net account balances, not lifetime debit/credit activity.
    // This account has postings on both sides, so gross movement would not reconcile
    // to either the screen's closing balances or the report's summary columns.
    const trialCsv = bookloqReportCsv(october, "trial").split("\r\n");
    const header = trialCsv.findIndex(line => line.startsWith("Account ID,"));
    assert.match(trialCsv[header], /Debit balance cents,Credit balance cents/);
    const exportedAccounts = trialCsv.slice(header + 1, header + 1 + october.accounts.length).map(line => line.split(","));
    assert.deepEqual(exportedAccounts.find(row => row[0] === "org-cash")?.slice(5, 7), ["29900", "0"]);
    assert.deepEqual(exportedAccounts.find(row => row[0] === "org-contra")?.slice(5, 7), ["0", "999"]);
    for (const row of exportedAccounts) {
      const account = october.accounts.find(account => account.id === row[0])!;
      assert.equal(Number(row[5]), Math.max(0, account.closingDebitCents - account.closingCreditCents));
      assert.equal(Number(row[6]), Math.max(0, account.closingCreditCents - account.closingDebitCents));
    }
    assert.equal(exportedAccounts.reduce((total, row) => total + Number(row[5]), 0), october.trialBalance.debitCents);
    assert.equal(exportedAccounts.reduce((total, row) => total + Number(row[6]), 0), october.trialBalance.creditCents);
  } finally { f.close(); }
});

test("cash basis, mismatched currency, inactive setup and individual detail restrictions fail closed", async () => {
  const f = await fixture();
  try {
    await f.entry("sensitive", "2026-10-04", "expense", "cash", 12345);
    for (const format of ["json", "csv"]) await assert.rejects(() => f.read("accountId=org-expense&format=" + format, { individualDetails: false }), code("BOOKLOQ_REPORT_DETAIL_ACCESS_REQUIRED"));
    const aggregate = await f.read("", { individualDetails: false });
    assert.equal(aggregate.metadata.detailAvailable, false); assert.equal(aggregate.detail, null);
    const redacted = await f.read("accountId=org-expense", { contactIdentity: false });
    assert.equal(redacted.detail!.lines[0].sourceRef, null);
    assert.doesNotMatch(bookloqReportCsv(redacted, "pnl"), /Private payroll|private-contact|Private line/);
    await assert.rejects(() => f.read("accountId=other-expense"), code("BOOKLOQ_REPORT_ACCOUNT_NOT_FOUND"));
    await f.db.prepare("UPDATE bookloq_settings SET accounting_basis='cash' WHERE organization_id='org'").run();
    await assert.rejects(() => f.read(), code("BOOKLOQ_REPORT_BASIS_UNSUPPORTED"));
    await f.db.prepare("UPDATE bookloq_settings SET accounting_basis='accrual' WHERE organization_id='org'").run();
    await assert.rejects(() => f.read("", { currency: "USD" }), code("BOOKLOQ_REPORT_CURRENCY_REVIEW"));
    await f.db.prepare("UPDATE bookloq_settings SET status='suspended' WHERE organization_id='org'").run();
    await assert.rejects(() => f.read(), code("BOOKLOQ_REPORT_SETUP_REQUIRED"));
  } finally { f.close(); }
});

test("account keyset pages include every matching line once and CSV refuses truncation", async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 205; i++) await f.entry("page-" + String(i).padStart(3, "0"), "2026-10-04", "cash", "sales", i + 1);
    const first = await f.read("accountId=org-sales"), next = await f.read("accountId=org-sales&after=" + encodeURIComponent(first.detail!.nextCursor!));
    assert.equal(first.detail!.lines.length, 200); assert.equal(next.detail!.lines.length, 5); assert.equal(next.detail!.nextCursor, null);
    assert.equal(new Set([...first.detail!.lines, ...next.detail!.lines].map(row => row.entryId)).size, 205);
    const csv = await f.read("accountId=org-sales&format=csv");
    assert.equal(csv.detail!.lines.length, 205);
    // Exercise the limit without creating thousands of unrelated fixture journals.
    const db = { prepare: f.database.prepare.bind(f.database), batch: async (items: D1PreparedStatement[]) => { const results = await f.database.batch(items); results[2].results = Array.from({ length: 10001 }, () => csv.detail!.lines[0]); return results; } } as D1Database;
    await assert.rejects(() => loadBookloqDatedReport(db, { organizationId: "org", currency: "CAD", timeZone: "UTC", contactIdentity: true, individualDetails: true, query: query("accountId=org-sales&format=csv") }), code("BOOKLOQ_REPORT_EXPORT_LIMIT"));
  } finally { f.close(); }
});

test("unsafe aggregate cents never produce rounded financial totals", async () => {
  const f = await fixture();
  try {
    const db = { prepare: f.database.prepare.bind(f.database), batch: async (items: D1PreparedStatement[]) => {
      const results = await f.database.batch(items);
      const row = results[0].results?.[0] as { debitCents: number } | undefined;
      assert.ok(row, "The fixture must return an account before corrupting its aggregate");
      row.debitCents = Number.MAX_SAFE_INTEGER + 1;
      return results;
    } } as D1Database;
    await assert.rejects(() => loadBookloqDatedReport(db, { organizationId: "org", currency: "CAD", timeZone: "UTC", contactIdentity: true, individualDetails: true, query: query() }), code("BOOKLOQ_REPORT_AMOUNT_INVALID"));
  } finally { f.close(); }
});
