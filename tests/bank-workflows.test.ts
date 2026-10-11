import assert from "node:assert/strict";
import test from "node:test";
import { readFile,readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { bankMoneyCents,parseBankCsv,bankCsvRows,type CsvMapping } from "../domain/bank-csv.ts";
import { archiveUnpostedBankCsv,bankAccounting,bankReconciliationPreview,bankSources,commitBankCsv,previewBankCsv,completeBankReconciliation,reopenBankReconciliation } from "../server/bank-workflows.ts";
import { confirmSupportingMatch } from "../server/bookloq.ts";
import { loadReconciledCashScenario } from "../server/cash-planning.ts";
const mapping:CsvMapping={delimiter:",",dateColumn:0,descriptionColumn:1,amountColumn:2,moneyInColumn:null,moneyOutColumn:null,dateFormat:"ymd",decimalFormat:"dot",positiveMeans:"in"};
test("CSV parsing preserves quoted data and requires exact dates, amounts and explicit directions",async()=>{
  assert.deepEqual(parseBankCsv('\uFEFFDate,Description,Amount\r\n2026-10-04,"Customer, \"\"A\"\"\nreceipt",100.01\r\n',','),[['Date','Description','Amount'],['2026-10-04','Customer, "A"\nreceipt','100.01']]);
  assert.equal(bankMoneyCents('($1,234.56)'),-123456);
  assert.equal(bankMoneyCents('1.234,56','comma'),123456);
  for(const bad of ['1.234','1e3','1,23.45','NaN','1.001','90071992547410.00'])assert.throws(()=>bankMoneyCents(bad));
  assert.throws(()=>parseBankCsv('Date,Description,Amount\n2026-10-04,"Unclosed,10',','));
  assert.throws(()=>bankCsvRows('Date,Description,Amount\n10/04/2026,Sale,10',mapping),/Row 2/);
  assert.equal(bankCsvRows('Date,Description,Amount\n10/04/2026,Sale,10',{...mapping,dateFormat:'mdy',positiveMeans:'out'}).rows[0].amountCents,-1000);
  assert.throws(()=>bankCsvRows('Date,Description,In,Out\n2026-10-04,Sale,10,5',{...mapping,amountColumn:null,moneyInColumn:2,moneyOutColumn:3}),/only one column/);
});
const code=(expected:string)=>(e:unknown)=>!!e&&typeof e==='object'&&'code'in e&&e.code===expected;
test("identical CSV new-account imports remain independent across tenants and replay within each tenant",{timeout:120000},async()=>{
  const mf=new Miniflare({modules:true,script:"export default {fetch(){return new Response('ok')}}",d1Databases:{DB:crypto.randomUUID()},r2Buckets:['BUCKET']});
  try {
    const db=await mf.getD1Database('DB') as unknown as D1Database,bucket=await mf.getR2Bucket('BUCKET') as unknown as R2Bucket;
    for(const file of (await readdir(new URL('../drizzle/',import.meta.url))).filter(f=>/^\d{4}.*\.sql$/.test(f)).sort())for(const sql of (await readFile(new URL(`../drizzle/${file}`,import.meta.url),'utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
    await db.prepare("INSERT INTO users(id,email,display_name,created_at,updated_at) VALUES ('actor','tenant-bank@example.invalid','Bank test',1,1)").run();
    const ctx=(organizationId:string)=>({organizationId,actorUserId:'actor',today:'2026-10-20',request:new Request('https://example.invalid'),requestId:'test',key:crypto.randomUUID()});
    for(const organizationId of ['tenant-a','tenant-b']) {
      await db.prepare("INSERT INTO workspaces(id,owner_name,business_name,legal_name,business_email,industry,city,address,postal_code,hours_json,created_at,updated_at) VALUES (?,'Test','Bank test','Bank test','tenant-bank@example.invalid','Retail','Edmonton','Test','T5A1A1','[]',1,1)").bind(organizationId).run();
      await db.prepare("INSERT INTO bookloq_settings(organization_id,status,data_mode,base_currency,accounting_basis,updated_by_user_id,created_at,updated_at) VALUES (?,'active','live','CAD','accrual','actor',1,1)").bind(organizationId).run();
    }
    const input={csvText:'Date,Description,Amount\r\n2026-10-04,Received transfer,25.00\r\n',fileName:'bank.csv',mapping,newAccount:{name:'Operating bank',institutionName:'Test bank',last4:'1234'},currency:'CAD',startDate:'2026-10-01',endDate:'2026-10-10',openingBalanceCents:0,closingBalanceCents:2500};
    const previewA=await previewBankCsv(db,input,ctx('tenant-a')),previewB=await previewBankCsv(db,input,ctx('tenant-b'));
    assert.equal(previewA.input.fingerprint,previewB.input.fingerprint,'Review details deliberately match across both businesses');
    const confirmed={...input,reviewConfirmed:true,previewFingerprint:previewA.input.fingerprint};
    const importedA=await commitBankCsv(db,bucket,confirmed,ctx('tenant-a')),importedB=await commitBankCsv(db,bucket,confirmed,ctx('tenant-b'));
    assert.notEqual(importedA.id,importedB.id);
    const sourcesA=await bankSources(db,'tenant-a'),sourcesB=await bankSources(db,'tenant-b');
    assert.equal(sourcesA.length,1);assert.equal(sourcesB.length,1);
    assert.notEqual(sourcesA[0].bankAccountId,sourcesB[0].bankAccountId);assert.notEqual(sourcesA[0].accountId,sourcesB[0].accountId);
    for(const [organizationId,imported] of [['tenant-a',importedA],['tenant-b',importedB]] as const) {
      assert.deepEqual(await commitBankCsv(db,bucket,confirmed,ctx(organizationId)),{id:imported.id,replayed:true});
      for(const table of ['bank_csv_imports','bank_accounts','financial_accounts','financial_transactions'])assert.equal((await db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE organization_id=?`).bind(organizationId).first())?.n,1,`${table} must not duplicate on retry`);
      const own=await bankReconciliationPreview(db,organizationId,'csv',imported.id);assert.equal(own.rows.length,1);assert.equal(own.rows[0].accountId,own.source.accountId);
      const retained=await db.prepare('SELECT object_key objectKey FROM bank_csv_imports WHERE organization_id=? AND id=?').bind(organizationId,imported.id).first<{objectKey:string}>();
      assert.equal((await bucket.get(retained!.objectKey))!.customMetadata?.organizationId,organizationId);
    }
    await assert.rejects(()=>bankReconciliationPreview(db,'tenant-a','csv',importedB.id),code('BANK_SOURCE'));
    await assert.rejects(()=>bankReconciliationPreview(db,'tenant-b','csv',importedA.id),code('BANK_SOURCE'));
    await assert.rejects(()=>archiveUnpostedBankCsv(db,{importId:importedB.id,reason:'Foreign import',reviewed:true},ctx('tenant-a')),code('BANK_CSV_ARCHIVE_REVIEW'));
    assert.equal((await bankSources(db,'tenant-b')).length,1);
  } finally {await mf.dispose();}
});
test("CSV → reviewed cash journals → independently reconciled statement retains evidence and controls",{timeout:120000},async t=>{
  const mf=new Miniflare({modules:true,script:"export default {fetch(){return new Response('ok')}}",d1Databases:{DB:crypto.randomUUID()},r2Buckets:['BUCKET']});
  try {
    const db=await mf.getD1Database('DB') as unknown as D1Database,bucket=await mf.getR2Bucket('BUCKET') as unknown as R2Bucket;
    for(const file of (await readdir(new URL('../drizzle/',import.meta.url))).filter(f=>/^\d{4}.*\.sql$/.test(f)).sort())for(const sql of (await readFile(new URL(`../drizzle/${file}`,import.meta.url),'utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
    await db.prepare("INSERT INTO users(id,email,display_name,created_at,updated_at) VALUES ('actor','bank@example.invalid','Bank test',1,1)").run();
    for(const id of ['org','other'])await db.prepare("INSERT INTO workspaces(id,owner_name,business_name,legal_name,business_email,industry,city,address,postal_code,hours_json,created_at,updated_at) VALUES (?,'Test','Bank test','Bank test','bank@example.invalid','Retail','Edmonton','Test','T5A1A1','[]',1,1)").bind(id).run();
    await db.prepare("INSERT INTO bookloq_settings(organization_id,status,data_mode,base_currency,accounting_basis,updated_by_user_id,created_at,updated_at) VALUES ('org','active','live','CAD','accrual','actor',1,1)").run();
    for(const [id,type,subtype,balance,system]of [['cash','asset','cash','debit','operating_cash'],['sales','revenue','sales','credit','sales_revenue'],['expense','expense','operating','debit','operating_expense'],['itc','asset','tax_recoverable','debit','gst_recoverable'],['equity','equity','capital','credit','owner_equity'],['ar','asset','receivable','debit','accounts_receivable']])await db.prepare("INSERT INTO financial_accounts(id,organization_id,code,name,account_type,account_subtype,normal_balance,system_key,created_at,updated_at) VALUES (?,'org',?,?,?,?,?,?,1,1)").bind(id,id,id,type,subtype,balance,system).run();
    await db.prepare("INSERT INTO bank_accounts(id,organization_id,financial_account_id,name,account_type,institution_name,masked_number,currency,provider,connection_status,created_at,updated_at) VALUES ('bank','org','cash','Cash bank','chequing','Test bank','1234','CAD','manual','manual',1,1)").run();
    await db.prepare("INSERT INTO accounting_periods(id,organization_id,label,start_date,end_date,status,created_at,updated_at) VALUES ('period','org','October','2026-10-01','2026-10-31','open',1,1)").run();
    const ctx=(key=crypto.randomUUID(),organizationId='org')=>({organizationId,actorUserId:'actor',today:'2026-10-20',request:new Request('https://example.invalid'),requestId:'test',key});
    const journal=async(id:string,date:string,amount:number,counter='sales')=>{
      await db.prepare("INSERT INTO journal_entries(id,organization_id,entry_number,entry_date,posting_date,period_id,status,source_type,memo,currency,total_debit_cents,total_credit_cents,idempotency_key,prepared_by_user_id,posted_at,created_at,updated_at) VALUES (?,'org',?,?,?,'period','posted','manual','Verified test basis','CAD',?,?,?,'actor',1,1,1)").bind(id,id,date,date,Math.abs(amount),Math.abs(amount),id).run();
      await db.prepare("INSERT INTO journal_lines(id,organization_id,journal_entry_id,line_number,account_id,description,debit_cents,credit_cents,location_ref,created_at) VALUES (?,'org',?,1,'cash','Cash',?,?,'all',1),(?,'org',?,2,?,'Purpose',?,?,'all',1)").bind(`${id}:cash`,id,Math.max(amount,0),Math.max(-amount,0),`${id}:counter`,id,counter,Math.max(-amount,0),Math.max(amount,0)).run();
    };
    await journal('opening','2026-10-03',100000,'equity');await journal('outstanding','2026-10-09',7000);
    const input={csvText:'Date,Description,Amount\r\n2026-10-04,Delivered sale,500.00\r\n2026-10-05,Rent,-200.00\r\n2026-10-06,Equipment,-50.00\r\n',fileName:'bank.csv',mapping,bankAccountId:'bank',currency:'CAD',startDate:'2026-10-04',endDate:'2026-10-10',openingBalanceCents:100000,closingBalanceCents:125000};
    const p=await previewBankCsv(db,input,ctx());let sourceId='';
    await t.test('original evidence, duplicate imports and staging never manufacture profit',async()=>{
      const result=await commitBankCsv(db,bucket,{...input,reviewConfirmed:true,previewFingerprint:p.input.fingerprint},ctx());sourceId=result.id;
      assert.equal((await bankSources(db,'org')).length,1);
      const source=await db.prepare('SELECT object_key objectKey,source_digest sourceDigest FROM bank_csv_imports WHERE id=?').bind(sourceId).first<{objectKey:string;sourceDigest:string}>();assert.equal(await new Response((await bucket.get(source!.objectKey))!.body).text(),input.csvText);
      assert.equal((await db.prepare("SELECT COUNT(*) n FROM journal_entries WHERE source_type='bank_transaction'").first())?.n,0);
      assert.equal((await commitBankCsv(db,bucket,{...input,reviewConfirmed:true,previewFingerprint:p.input.fingerprint},ctx())).replayed,true);
      await assert.rejects(()=>previewBankCsv(db,{...input,closingBalanceCents:125001},ctx()),code('BANK_CSV_INPUT'));
      await assert.rejects(()=>previewBankCsv(db,{...input,csvText:input.csvText.replace('Rent','Same period')},ctx()),code('STATEMENT_PERIOD_OVERLAP'));
      await assert.rejects(()=>bankReconciliationPreview(db,'other','csv',sourceId),code('BANK_SOURCE'));
    });
    const post=(row:number,counter:string,tax=0)=>({action:'post',transactionId:`${sourceId}:${row}`,counterAccountId:counter,taxCents:tax,taxAccountId:tax?'itc':undefined,reason:'Reviewed source and supplied goods or services',reviewed:true});
    await t.test('posting is balanced, once-only, reviewed and never silently adjusts a reconciliation',async()=>{
      assert.equal((await bankReconciliationPreview(db,'org','csv',sourceId)).ready,false);
      await assert.rejects(()=>db.prepare("UPDATE accounting_periods SET status='locked' WHERE id='period'").run(),/BANK_CLOSE_REVIEW_REQUIRED/);
      await assert.rejects(()=>bankAccounting(db,{...post(2,'sales'),reviewed:false},ctx()),code('BANK_REVIEW'));
      await assert.rejects(()=>bankAccounting(db,post(2,'ar'),ctx()),code('BANK_COUNTER_ACCOUNT'));
      await db.prepare("CREATE TRIGGER reject_bank_audit BEFORE INSERT ON audit_events WHEN NEW.action='bank_transaction.post' BEGIN SELECT RAISE(ABORT,'AUDIT_FAILED'); END").run();
      await assert.rejects(()=>bankAccounting(db,post(2,'sales'),ctx()),/AUDIT_FAILED/);
      assert.equal((await db.prepare("SELECT COUNT(*) n FROM journal_entries WHERE source_type='bank_transaction'").first())?.n,0);
      assert.equal((await db.prepare('SELECT COUNT(*) n FROM bank_accounting_events').first())?.n,0);
      assert.equal((await db.prepare('SELECT journal_entry_id FROM financial_transactions WHERE id=?').bind(`${sourceId}:2`).first())?.journal_entry_id,null);
      await db.prepare('DROP TRIGGER reject_bank_audit').run();
      const same=ctx();const sale=await bankAccounting(db,post(2,'sales'),same);assert.equal((await bankAccounting(db,post(2,'sales'),same)).id,sale.id);
      await assert.rejects(()=>bankAccounting(db,{...post(2,'sales'),reason:'Changed'},same),code('BANK_REQUEST_CONFLICT'));
      const rent=await Promise.allSettled([bankAccounting(db,post(3,'expense',1000),ctx()),bankAccounting(db,post(3,'expense',1000),ctx())]);assert.equal(rent.filter(r=>r.status==='fulfilled').length,1);
      await bankAccounting(db,post(4,'expense'),ctx());
      const preview=await bankReconciliationPreview(db,'org','csv',sourceId);assert.equal(preview.ready,true);assert.equal(preview.closingBookCents,132000);assert.equal(preview.unclearedCents,7000);assert.equal(preview.clearedClosingCents,125000);assert.equal(preview.differenceCents,0);
      await assert.rejects(()=>completeBankReconciliation(db,{sourceType:'csv',sourceId,reviewed:true,openingBasisConfirmed:true,previewFingerprint:'stale'},ctx()),code('BANK_RECONCILIATION_REVIEW'));
    });
    await t.test('posted bank movements reject incompatible invoice and bill matches without blocking correction',async()=>{
      await db.prepare("INSERT INTO bookloq_contacts(id,organization_id,contact_type,name,created_at,updated_at) VALUES ('contact','org','both','Test contact',1,1)").run();
      await db.prepare("INSERT INTO customer_invoices(id,organization_id,customer_id,invoice_number,invoice_date,due_date,status,subtotal_cents,total_cents,created_at,updated_at) VALUES ('support-invoice','org','contact','SUPPORT-1','2026-10-04','2026-10-31','sent',50000,50000,1,1)").run();
      await db.prepare("INSERT INTO supplier_bills(id,organization_id,supplier_id,bill_number,invoice_date,due_date,status,subtotal_cents,total_cents,created_at,updated_at) VALUES ('support-bill','org','contact','SUPPORT-1','2026-10-05','2026-10-31','received',20000,20000,1,1)").run();
      const match=(row:number,targetType:'customer_invoice'|'supplier_bill',targetId:string,amountCents:number)=>({organizationId:'org',transactionId:`${sourceId}:${row}`,targetType,targetId,amountCents,currency:'CAD',demoRecord:0,note:'Reviewed evidence',actorUserId:'actor',timestamp:1});
      await assert.rejects(()=>confirmSupportingMatch(db,match(2,'customer_invoice','support-invoice',50000)),code('MATCH_RECORD_CHANGED'));
      await assert.rejects(()=>confirmSupportingMatch(db,match(3,'supplier_bill','support-bill',-20000)),code('MATCH_RECORD_CHANGED'));
      const insert=(id:string,status:string)=>db.prepare("INSERT INTO bookloq_transaction_matches(id,organization_id,transaction_id,customer_invoice_id,status,matched_amount_cents,created_at,updated_at) VALUES (?,'org',?,'support-invoice',?,50000,1,1)").bind(id,`${sourceId}:2`,status).run();
      await assert.rejects(()=>insert('incompatible-confirmed','confirmed'),/SUPPORTING_MATCH_ACCOUNTING/);
      await insert('incompatible-suggestion','suggested');
      await assert.rejects(()=>db.prepare("UPDATE bookloq_transaction_matches SET status='confirmed' WHERE id='incompatible-suggestion'").run(),/SUPPORTING_MATCH_ACCOUNTING/);
      assert.equal((await db.prepare("SELECT COUNT(*) n FROM bookloq_transaction_matches WHERE transaction_id=? AND status='confirmed'").bind(`${sourceId}:2`).first())?.n,0);
      await bankAccounting(db,{action:'reverse',transactionId:`${sourceId}:2`,date:'2026-10-04',reason:'Correct the reviewed account',reviewed:true},ctx());
      await bankAccounting(db,post(2,'sales'),ctx());
      assert.equal((await bankReconciliationPreview(db,'org','csv',sourceId)).ready,true);
    });
    let outstandingCashLine='outstanding:cash';
    await t.test('an active bank match blocks a stale generic reversal batch until audited unmatch',async()=>{
      await db.prepare("INSERT INTO financial_transactions(id,organization_id,transaction_date,posting_date,description,amount_cents,currency,account_id,source_system,external_source_id,created_at,updated_at) VALUES ('matched-deposit','org','2026-10-09','2026-10-09','Reviewed deposit',7000,'CAD','cash','manual','matched-deposit',1,1)").run();
      await bankAccounting(db,{action:'match',transactionId:'matched-deposit',cashLineId:outstandingCashLine,reason:'Reviewed bank receipt',reviewed:true},ctx());
      const reverse=()=>db.batch([
        db.prepare("INSERT INTO journal_entries(id,organization_id,entry_number,entry_date,posting_date,period_id,status,source_type,source_ref,memo,currency,total_debit_cents,total_credit_cents,reversal_of_entry_id,idempotency_key,prepared_by_user_id,posted_at,created_at,updated_at) VALUES ('matched-reversal','org','MATCH-REV','2026-10-09','2026-10-09','period','posted','reversal','outstanding','Correct deposit','CAD',7000,7000,'outstanding','matched-reversal','actor',1,1,1)"),
        db.prepare("UPDATE journal_entries SET status='reversed' WHERE id='outstanding' AND status='posted'"),
        db.prepare("INSERT INTO journal_lines(id,organization_id,journal_entry_id,line_number,account_id,description,debit_cents,credit_cents,location_ref,created_at) VALUES ('matched-reversal:cash','org','matched-reversal',1,'cash','Correct deposit',0,7000,'all',1),('matched-reversal:counter','org','matched-reversal',2,'sales','Correct deposit',7000,0,'all',1)")
      ]);
      await assert.rejects(reverse,/BANK_JOURNAL_RETAINED/);
      assert.equal((await db.prepare("SELECT status FROM journal_entries WHERE id='outstanding'").first())?.status,'posted');
      assert.equal((await db.prepare("SELECT COUNT(*) n FROM journal_entries WHERE id='matched-reversal'").first())?.n,0,'The rejected batch must roll back its reversal header');
      assert.equal((await db.prepare("SELECT journal_entry_id FROM financial_transactions WHERE id='matched-deposit'").first())?.journal_entry_id,'outstanding');
      await bankAccounting(db,{action:'unmatch',transactionId:'matched-deposit',reason:'Remove the link before correction',reviewed:true},ctx());
      assert.equal((await db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='bank_transaction.unmatch'").first())?.n,1);
      await reverse();
      await journal('outstanding-replacement','2026-10-09',7000);outstandingCashLine='outstanding-replacement:cash';
    });
    let runId='';
    await t.test('completed reconciliation protects source/ledger, supports a controlled reopen and retains history',async()=>{
      const preview=await bankReconciliationPreview(db,'org','csv',sourceId);
      const completion={sourceType:'csv',sourceId,reviewed:true,openingBasisConfirmed:true,previewFingerprint:preview.previewFingerprint};
      await db.prepare("CREATE TRIGGER reject_reconciliation_audit BEFORE INSERT ON audit_events WHEN NEW.action='bank_reconciliation.completed' BEGIN SELECT RAISE(ABORT,'AUDIT_FAILED'); END").run();
      await assert.rejects(()=>completeBankReconciliation(db,completion,ctx()),/AUDIT_FAILED/);
      assert.equal((await db.prepare('SELECT COUNT(*) n FROM bank_reconciliation_runs').first())?.n,0);
      assert.equal((await db.prepare("SELECT COUNT(*) n FROM financial_transactions WHERE reconciliation_status='reconciled'").first())?.n,0);
      await db.prepare('DROP TRIGGER reject_reconciliation_audit').run();
      const results=await Promise.all([completeBankReconciliation(db,completion,ctx()),completeBankReconciliation(db,completion,ctx())]);runId=results[0].id!;assert.equal(results[1].id,runId);
      const cashInput={organizationId:'org',currency:'CAD',asOf:'2026-10-11',nowMs:Date.parse('2026-10-11T12:00:00Z'),allowed:true,dataMode:'live',bookloqActive:true};
      const datedCash=await loadReconciledCashScenario(db,cashInput);
      assert.equal(datedCash.status,'available');assert.equal(datedCash.scenarioOpeningCashCents,125000);
      assert.equal(datedCash.purchasingOpeningCashCents,125000);assert.equal(datedCash.outstandingReceiptsCents,7000);
      assert.equal(datedCash.outstandingWithdrawalsCents,0,'Cancelled uncleared journal reversal pairs do not manufacture an outstanding payment');
      assert.equal((await loadReconciledCashScenario(db,{...cashInput,organizationId:'other'})).scenarioOpeningCashCents,null);
      assert.equal((await loadReconciledCashScenario(db,{...cashInput,allowed:false})).sourceIds.length,0);
      assert.equal((await db.prepare('SELECT COUNT(*) n FROM bank_reconciliation_lines WHERE run_id=? AND active=1').bind(runId).first())?.n,3);
      assert.equal((await db.prepare("SELECT COUNT(*) n FROM financial_transactions WHERE reconciliation_status='reconciled'").first())?.n,3);
      await assert.rejects(()=>bankAccounting(db,{action:'reverse',transactionId:`${sourceId}:3`,date:'2026-10-11',reason:'Correction',reviewed:true},ctx()),code('BANK_RECONCILED'));
      await assert.rejects(()=>journal('backdate','2026-10-08',1000),/BANK_RECONCILED_BACKDATE/);
      await db.prepare("DELETE FROM journal_entries WHERE id='backdate'").run();
      await assert.rejects(()=>db.prepare('DELETE FROM bank_csv_imports WHERE id=?').bind(sourceId).run(),/BANK_CSV_RETAINED/);
      await assert.rejects(()=>db.prepare("UPDATE financial_transactions SET amount_cents=1 WHERE id=?").bind(`${sourceId}:3`).run(),/BANK_SOURCE_RETAINED/);
      await db.prepare("UPDATE accounting_periods SET status='locked' WHERE id='period'").run();
      await assert.rejects(()=>reopenBankReconciliation(db,{runId,reason:'Review correction'},ctx()),code('BANK_RECONCILIATION_REOPEN'));
      await db.prepare("UPDATE accounting_periods SET status='open' WHERE id='period'").run();
      await reopenBankReconciliation(db,{runId,reason:'Review correction'},ctx());
      assert.equal((await loadReconciledCashScenario(db,cashInput)).scenarioOpeningCashCents,null,'The latest reopened run cannot fall back to an earlier cash balance');
      assert.equal((await db.prepare('SELECT COUNT(*) n FROM bank_reconciliation_lines WHERE run_id=? AND active=0').bind(runId).first())?.n,3);
      await bankAccounting(db,{action:'reverse',transactionId:`${sourceId}:3`,date:'2026-10-05',reason:'Wrong expense account',reviewed:true},ctx());
      assert.equal((await db.prepare('SELECT journal_entry_id FROM financial_transactions WHERE id=?').bind(`${sourceId}:3`).first())?.journal_entry_id,null);
      await bankAccounting(db,post(3,'expense',1000),ctx());
      const again=await bankReconciliationPreview(db,'org','csv',sourceId);assert.equal(again.ready,true);
      await completeBankReconciliation(db,{sourceType:'csv',sourceId,reviewed:true,openingBasisConfirmed:true,previewFingerprint:again.previewFingerprint},ctx());
      assert.equal((await db.prepare('SELECT COUNT(*) n FROM bank_reconciliation_runs').first())?.n,2);
    });
    await t.test('archive retains an unposted original, corrected replacement carries outstanding cash into the next statement',async()=>{
      const next={...input,csvText:'Date,Description,Amount\r\n2026-10-12,Outstanding deposit cleared,70.00\r\n',startDate:'2026-10-11',endDate:'2026-10-12',openingBalanceCents:125000,closingBalanceCents:132000};
      const a=await previewBankCsv(db,next,ctx());const initial=await commitBankCsv(db,bucket,{...next,reviewConfirmed:true,previewFingerprint:a.input.fingerprint},ctx());
      await archiveUnpostedBankCsv(db,{importId:initial.id,reason:'Correct the statement ending date',reviewed:true},ctx());
      assert.equal((await bankSources(db,'org')).some(s=>s.id===initial.id),false);
      assert.equal((await db.prepare('SELECT source_state FROM financial_transactions WHERE id=?').bind(`${initial.id}:2`).first())?.source_state,'removed');
      assert.equal((await db.prepare('SELECT COUNT(*) n FROM bank_csv_rows WHERE import_id=?').bind(initial.id).first())?.n,1);
      await assert.rejects(()=>archiveUnpostedBankCsv(db,{importId:sourceId,reason:'Already posted',reviewed:true},ctx()),code('BANK_CSV_ARCHIVE_REVIEW'));
      const corrected={...next,endDate:'2026-10-13'},b=await previewBankCsv(db,corrected,ctx());const replacement=await commitBankCsv(db,bucket,{...corrected,reviewConfirmed:true,previewFingerprint:b.input.fingerprint},ctx());
      await bankAccounting(db,{action:'match',transactionId:`${replacement.id}:2`,cashLineId:outstandingCashLine,reason:'Confirmed deposit on next statement',reviewed:true},ctx());
      const preview=await bankReconciliationPreview(db,'org','csv',replacement.id);assert.equal(preview.ready,true);assert.equal(preview.unclearedCents,0);assert.equal(preview.clearedClosingCents,132000);assert.ok(preview.previousRunId);
      const final=await completeBankReconciliation(db,{sourceType:'csv',sourceId:replacement.id,reviewed:true,openingBasisConfirmed:true,previewFingerprint:preview.previewFingerprint},ctx());assert.ok(final.id);
      const continuedCash=await loadReconciledCashScenario(db,{organizationId:'org',currency:'CAD',asOf:'2026-10-14',nowMs:Date.parse('2026-10-14T12:00:00Z'),allowed:true,dataMode:'live',bookloqActive:true});
      assert.equal(continuedCash.status,'available');assert.equal(continuedCash.sourceAsOf,'2026-10-13');
      assert.equal(continuedCash.purchasingOpeningCashCents,132000);assert.equal(continuedCash.outstandingReceiptsCents,0);
      const earlierRun=(await bankSources(db,'org')).find(s=>s.id===sourceId)!.runId;
      await assert.rejects(()=>reopenBankReconciliation(db,{runId:earlierRun,reason:'Earlier statement'},ctx()),code('BANK_RECONCILIATION_REOPEN'));
      await assert.rejects(()=>db.prepare("UPDATE journal_entries SET entry_date='2026-10-10' WHERE id='outstanding'").run(),/BANK_JOURNAL_RETAINED/);
    });
    await t.test('workspace deletion removes tenant records and accounting history together',async()=>{
      await db.prepare("DELETE FROM workspaces WHERE id='org'").run();assert.equal((await db.prepare('SELECT COUNT(*) n FROM bank_csv_imports').first())?.n,0);assert.equal((await db.prepare('SELECT COUNT(*) n FROM bank_reconciliation_runs').first())?.n,0);
    });
  } finally {await mf.dispose();}
});
