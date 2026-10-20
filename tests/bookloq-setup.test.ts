import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { bookloqSetupInput, BOOKLOQ_STARTING_ACCOUNTS } from "../domain/bookloq-setup.ts";
import { configureBookLoQ } from "../server/bookloq-setup.ts";
import { loadBookLoQLedgerAccounts, canReadCompleteBookLoQLedger } from "../server/bookloq-ledger-view.ts";
import { buildFinancialStatements } from "../server/bookloq.ts";

const input = (initialize = true, startDate = "2026-10-01", endDate = "2026-10-31") => bookloqSetupInput({ initialize, label: `Period ${startDate}`, startDate, endDate });
test("accounting setup validates real dates, bounded periods and explicit initialization", () => {
  assert.equal(input().initialize, true);
  for (const value of [ { ...input(), startDate: "2026-02-30" }, { ...input(), endDate: "2026-09-30" }, { ...input(), endDate: "2028-01-01" }, { ...input(), initialize: "true" }, { ...input(), label: "" }, { ...input(), overwrite: true } ]) assert.throws(() => bookloqSetupInput(value));
});
test("complete ledger needs every financial disclosure permission", () => {
  const full = ["finance.statements", "finance.costs", "metrics.profit", "metrics.revenue", "payroll.totals", "finance.bank_balances", "finance.ap_ar"];
  assert.equal(canReadCompleteBookLoQLedger(full), true);
  for (const denied of full) assert.equal(canReadCompleteBookLoQLedger(full.filter(permission => permission !== denied)), false, denied);
});

test("live setup and subsequent periods are atomic, retry-safe and preserve archived posted balances", { timeout: 120000 }, async () => {
  const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('isolated')}}", d1Databases: { DB: crypto.randomUUID() } });
  try {
    const db = await mf.getD1Database("DB") as unknown as D1Database;
    for (const file of (await readdir(new URL("../drizzle/", import.meta.url))).filter(file => /^\d{4}.*\.sql$/.test(file)).sort()) {
      for (const sql of (await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8")).split("--> statement-breakpoint").map(text => text.trim()).filter(Boolean)) await db.prepare(sql).run();
    }
    await db.prepare("INSERT INTO users(id,email,display_name,created_at,updated_at) VALUES('actor','setup@example.invalid','Test',1,1)").run();
    for (const org of ["org", "other", "rollback", "overlap", "bankfirst", "collision"]) await db.prepare("INSERT INTO workspaces(id,owner_name,business_name,legal_name,business_email,industry,city,address,postal_code,hours_json,created_at,updated_at) VALUES(?,'Test','Test','Test','test@example.invalid','Retail','Edmonton','Test','T5A1A1','[]',1,1)").bind(org).run();
    const ctx = (organizationId = "org") => ({organizationId,userId:"actor",currency:"CAD",country:"CA",province:"AB",fiscalYearStartMonth:10,requestId:crypto.randomUUID(),sourceHash:"test"});
    // Bank imports can precede accounting setup. Keep their accounts and add the
    // empty starting chart without replacing records or posting opening balances.
    await db.prepare("INSERT INTO financial_accounts(id,organization_id,code,name,account_type,account_subtype,normal_balance,created_at,updated_at) VALUES('imported-bank','bankfirst','BS-TEST','Imported bank','asset','cash','debit',1,1)").run();
    await assert.rejects(() => configureBookLoQ(db,ctx("bankfirst"),input(false)),/chart already exists/);
    await configureBookLoQ(db,ctx("bankfirst"),input());
    assert.equal((await db.prepare("SELECT COUNT(*) n FROM financial_accounts WHERE organization_id='bankfirst'").first())?.n,BOOKLOQ_STARTING_ACCOUNTS.length+1);
    assert.equal((await db.prepare("SELECT name FROM financial_accounts WHERE id='imported-bank'").first())?.name,"Imported bank");
    assert.equal((await db.prepare("SELECT fiscal_year_start_month n FROM bookloq_settings WHERE organization_id='bankfirst'").first())?.n,10);
    // A conflicting existing account is preserved and the whole setup rolls back.
    await db.prepare("INSERT INTO financial_accounts(id,organization_id,code,name,account_type,account_subtype,normal_balance,created_at,updated_at) VALUES('custom-account','collision',?,'Custom account','asset','cash','debit',1,1)").bind(BOOKLOQ_STARTING_ACCOUNTS[0][0]).run();
    await assert.rejects(() => configureBookLoQ(db,ctx("collision"),input()),/chart already exists/);
    assert.equal((await db.prepare("SELECT COUNT(*) n FROM financial_accounts WHERE organization_id='collision'").first())?.n,1);
    assert.equal((await db.prepare("SELECT COUNT(*) n FROM accounting_periods WHERE organization_id='collision'").first())?.n,0);
    await assert.rejects(() => configureBookLoQ(db,{...ctx("other"),fiscalYearStartMonth:0},input()),/fiscal year start/);
    const attempts = await Promise.all([configureBookLoQ(db, ctx(), input()),configureBookLoQ(db, ctx(), input())]);
    assert.equal(attempts.filter(value => !value.replayed).length, 1);
    assert.equal((await db.prepare("SELECT COUNT(*) n FROM financial_accounts WHERE organization_id='org'").first())?.n, BOOKLOQ_STARTING_ACCOUNTS.length);
    assert.equal((await db.prepare("SELECT COUNT(*) n FROM month_end_items WHERE organization_id='org'").first())?.n, 6);
    assert.equal((await db.prepare("SELECT COUNT(*) n FROM audit_events WHERE organization_id='org'").first())?.n, 1);
    assert.equal((await db.prepare("SELECT COUNT(*) n FROM journal_entries").first())?.n, 0);
    assert.equal((await db.prepare("SELECT COUNT(*) n FROM financial_accounts WHERE organization_id='other'").first())?.n, 0);
    await assert.rejects(() => configureBookLoQ(db, ctx(), input(false,"2026-10-31","2026-11-30")), /overlaps/);
    await assert.rejects(() => configureBookLoQ(db, ctx("other"), input(false)), /chart already exists/);
    await configureBookLoQ(db,ctx(),input(false,"2026-11-01","2026-11-30"));
    assert.equal((await db.prepare("SELECT COUNT(*) n FROM accounting_periods WHERE organization_id='org'").first())?.n, 2);
    await assert.rejects(() => configureBookLoQ(db,ctx(),input(true,"2026-12-01","2026-12-31")),/chart already exists/);
    // Failed downstream insertion cannot leave a chart, period or successful audit.
    await db.prepare("CREATE TRIGGER test_setup_failure BEFORE INSERT ON month_end_items WHEN NEW.organization_id='rollback' BEGIN SELECT RAISE(ABORT,'test setup rollback'); END").run();
    await assert.rejects(() => configureBookLoQ(db,ctx("rollback"),input()),/could not|chart already exists|test setup rollback/);
    for (const table of ["financial_accounts","accounting_periods","bookloq_settings","audit_events"]) assert.equal((await db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE organization_id='rollback'`).first())?.n,0,table);
    // Different overlapping requests cannot both succeed.
    await configureBookLoQ(db,ctx("overlap"),input());
    const racing = await Promise.allSettled([configureBookLoQ(db,ctx("overlap"),input(false,"2026-11-01","2026-11-30")),configureBookLoQ(db,ctx("overlap"),input(false,"2026-11-15","2026-12-15"))]);
    assert.equal(racing.filter(value => value.status === "fulfilled").length,1);
    const period = attempts[0].period.id;
    await db.batch([
      db.prepare("INSERT INTO journal_entries(id,organization_id,entry_number,entry_date,posting_date,period_id,status,source_type,memo,currency,exchange_rate_ppm,total_debit_cents,total_credit_cents,idempotency_key,prepared_by_user_id,approved_by_user_id,posted_at,created_at,updated_at) VALUES('entry','org','JE-TEST','2026-10-02','2026-10-02',?,'posted','manual','Test','CAD',1000000,10000,10000,'setup-journal','actor','actor',1,1,1)").bind(period),
      db.prepare("INSERT INTO journal_lines(id,organization_id,journal_entry_id,line_number,account_id,description,debit_cents,credit_cents,tax_amount_cents,location_ref,created_at) VALUES('line1','org','entry',1,'blq:org:account:operating_cash','Test',10000,0,0,'all',1)"),
      db.prepare("INSERT INTO journal_lines(id,organization_id,journal_entry_id,line_number,account_id,description,debit_cents,credit_cents,tax_amount_cents,location_ref,created_at) VALUES('line2','org','entry',2,'blq:org:account:owner_equity','Test',0,10000,0,'all',1)"),
    ]);
    await db.prepare("UPDATE financial_accounts SET active=0,archived_at=2 WHERE id='blq:org:account:operating_cash'").run();
    const rows = (await loadBookLoQLedgerAccounts(db,"org")).results ?? [];
    const report = buildFinancialStatements(rows);
    assert.equal(report.trialBalance.totalDebitCents,10000); assert.equal(report.trialBalance.totalCreditCents,10000);
    assert.equal(rows.find(row=>row.id==='blq:org:account:operating_cash')?.active,0);
    assert.equal((await loadBookLoQLedgerAccounts(db,"other")).results?.length,0);
  } finally { await mf.dispose(); }
});
