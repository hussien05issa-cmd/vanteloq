import assert from "node:assert/strict";
import test from "node:test";
import { posSqliteFixture } from "./helpers/pos-sqlite-fixture.ts";
import { bankSourceQuery } from "../server/bank-source-query.ts";
import { bankSources, loadBankSource } from "../server/bank-workflows.ts";
import { removeSupportingMatch } from "../server/supporting-match-correction.ts";

async function fixture() {
  const f = await posSqliteFixture();
  f.sqlite.exec(`INSERT INTO users(id,email,display_name,created_at,updated_at) VALUES ('actor','query@example.invalid','Query review',1,1);
    INSERT INTO workspaces(id,owner_name,business_name,legal_name,business_email,industry,city,address,postal_code,hours_json,created_at,updated_at)
      VALUES ('org','Test','Query test','Query test','query@example.invalid','Retail','Edmonton','Test','T5A1A1','[]',1,1),
      ('other','Test','Other test','Other test','query@example.invalid','Retail','Edmonton','Test','T5A1A1','[]',1,1);
    INSERT INTO bookloq_settings(organization_id,status,data_mode,base_currency,accounting_basis,updated_by_user_id,created_at,updated_at)
      VALUES ('org','active','live','CAD','accrual','actor',1,1);
    INSERT INTO financial_accounts(id,organization_id,code,name,account_type,account_subtype,normal_balance,system_key,created_at,updated_at)
      VALUES ('cash','org','1000','Operating cash','asset','cash','debit','operating_cash',1,1);
    INSERT INTO bank_accounts(id,organization_id,financial_account_id,name,account_type,institution_name,masked_number,currency,provider,connection_status,created_at,updated_at)
      VALUES ('bank','org','cash','Test bank','chequing','Test','1234','CAD','manual','manual',1,1);`);
  return f;
}

test("retained imports remain directly accessible beyond the recent 200, with indexed tenant isolation", async () => {
  const f = await fixture();
  try {
    const db = f.database;
    for (let i = 0; i < 260; i++) {
      const date = new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10), id = `source-${i}`;
      await db.prepare(`INSERT INTO bank_csv_imports(id,organization_id,bank_account_id,financial_account_id,start_date,end_date,currency,
        opening_balance_cents,closing_balance_cents,row_count,inflow_cents,outflow_cents,source_digest,fingerprint,file_name,object_key,mapping_json,status,approved_by_user_id,created_at)
        VALUES (?,'org','bank','cash',?,?,'CAD',0,100,1,100,0,?,?,'synthetic.csv',?,'{}','staging','actor',1)`)
        .bind(id,date,date,id,id,id).run();
      await db.prepare(`INSERT INTO financial_transactions(id,organization_id,transaction_date,posting_date,description,amount_cents,currency,account_id,source_system,external_source_id,created_at,updated_at)
        VALUES (?,'org',?,?,'Synthetic receipt',100,'CAD','cash','bank_csv',?,1,1)`).bind(`${id}:1`,date,date,id).run();
      await db.prepare("INSERT INTO bank_csv_rows(import_id,transaction_id,source_row_number) VALUES (?,?,1)").bind(id,`${id}:1`).run();
      await db.prepare("UPDATE bank_csv_imports SET status='approved' WHERE id=?").bind(id).run();
    }
    const recent = await bankSources(db,"org");
    assert.equal(recent.length,200);
    assert.equal(recent.some(row => row.id === "source-0"),false);
    const old = await loadBankSource(db,"org","csv","source-0");
    assert.equal(old.source.id,"source-0");
    assert.equal(old.rows.length,1);
    await assert.rejects(() => loadBankSource(db,"other","csv","source-0"),/unavailable/);
    await assert.rejects(() => loadBankSource(db,"org","csv","source-0' OR 1=1 --"),/unavailable/);
    const q = bankSourceQuery("org",{type:"csv",id:"source-0"});
    const plans = (await db.prepare(`EXPLAIN QUERY PLAN ${q.sql}`).bind(...q.bindings).all<{detail:string}>()).results!;
    assert.ok(plans.some(row => /SEARCH s USING INDEX .*\(id=\?\)/.test(row.detail)),JSON.stringify(plans));
    assert.ok(plans.some(row => /bank_reconciliation_source_idx/.test(row.detail)),JSON.stringify(plans));
    assert.equal(plans.some(row => /^SCAN s\b/.test(row.detail)),false,"Exact imports must not scan the retained source list");
    assert.equal((await db.prepare("SELECT COUNT(*) n FROM bank_csv_imports").first<{n:number}>())?.n,260);
  } finally { f.close(); }
});

test("supporting match corrections retain evidence and accounting, reject tenant/race boundaries and roll back failed audit", async t => {
  const f = await fixture();
  try {
    const db = f.database;
    f.sqlite.exec(`INSERT INTO bookloq_contacts(id,organization_id,contact_type,name,created_at,updated_at) VALUES ('contact','org','customer','Test customer',1,1);
      INSERT INTO customer_invoices(id,organization_id,customer_id,invoice_number,invoice_date,due_date,status,subtotal_cents,total_cents,paid_cents,created_at,updated_at)
        VALUES ('invoice','org','contact','INV-1','2026-10-04','2026-10-31','sent',50000,50000,0,1,1);
      INSERT INTO financial_transactions(id,organization_id,transaction_date,posting_date,description,amount_cents,currency,account_id,source_system,external_source_id,reconciliation_status,created_at,updated_at)
        VALUES ('txn','org','2026-10-04','2026-10-04','Synthetic receipt',50000,'CAD','cash','manual','txn','matched',1,1);
      INSERT INTO bookloq_transaction_matches(id,organization_id,transaction_id,customer_invoice_id,status,matched_amount_cents,note,created_at,updated_at)
        VALUES ('match','org','txn','invoice','confirmed',50000,'Original retained review',1,1);`);
    const input = {organizationId:"org",transactionId:"txn",matchId:"match",reason:"Wrong supporting invoice",actorUserId:"actor",timestamp:100,
      request:new Request("https://example.invalid"),requestId:"correction"};
    await t.test("a foreign workspace and invalid reason cannot change the link",async () => {
      await assert.rejects(() => removeSupportingMatch(db,{...input,organizationId:"other"}),/unavailable/);
      await assert.rejects(() => removeSupportingMatch(db,{...input,reason:"x"}),/Explain/);
    });
    await t.test("audit failure rolls back the entire correction",async () => {
      f.sqlite.exec("CREATE TRIGGER reject_match_audit BEFORE INSERT ON audit_events WHEN NEW.action='financial_transaction.supporting_record_unmatched' BEGIN SELECT RAISE(ABORT,'AUDIT_FAILED'); END");
      await assert.rejects(() => removeSupportingMatch(db,input),/AUDIT_FAILED/);
      assert.equal((await db.prepare("SELECT status FROM bookloq_transaction_matches WHERE id='match'").first())?.status,"confirmed");
      f.sqlite.exec("DROP TRIGGER reject_match_audit");
    });
    await t.test("a reconciliation completed between reading and writing wins",async () => {
      f.beforeBatch(() => f.sqlite.exec("UPDATE financial_transactions SET reconciliation_status='reconciled' WHERE id='txn'"));
      await assert.rejects(() => removeSupportingMatch(db,input),/completed reconciliation/);
      f.beforeBatch(undefined);
      assert.equal((await db.prepare("SELECT status FROM bookloq_transaction_matches WHERE id='match'").first())?.status,"confirmed");
      assert.equal((await db.prepare("SELECT COUNT(*) n FROM audit_events").first())?.n,0);
      f.sqlite.exec("UPDATE financial_transactions SET reconciliation_status='matched' WHERE id='txn'");
    });
    await t.test("correction and repeat retain the original evidence without changing paid amounts",async () => {
      assert.equal((await removeSupportingMatch(db,input)).replayed,false);
      assert.equal((await removeSupportingMatch(db,input)).replayed,true);
      const match = await db.prepare("SELECT status,note,matched_amount_cents FROM bookloq_transaction_matches WHERE id='match'").first();
      assert.equal(match?.status,"rejected");assert.equal(match?.note,"Original retained review");assert.equal(match?.matched_amount_cents,50000);
      assert.equal((await db.prepare("SELECT reconciliation_status FROM financial_transactions WHERE id='txn'").first())?.reconciliation_status,"unreconciled");
      assert.equal((await db.prepare("SELECT paid_cents FROM customer_invoices WHERE id='invoice'").first())?.paid_cents,0);
      const audit = await db.prepare("SELECT details_json FROM audit_events WHERE action='financial_transaction.supporting_record_unmatched'").first<{details_json:string}>();
      assert.equal(JSON.parse(audit!.details_json).reason,input.reason);
      assert.equal((await db.prepare("SELECT COUNT(*) n FROM audit_events").first())?.n,1);
      assert.equal((await db.prepare("SELECT COUNT(*) n FROM journal_entries").first())?.n,0);
    });
  } finally { f.close(); }
});
