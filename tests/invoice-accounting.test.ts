import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { invoiceAccountingCommand } from "../domain/invoice-accounting.ts";
import { invoiceAccountingHistory, postInvoiceAccounting } from "../server/invoice-accounting.ts";
import { loadBookloqDatedReport, bookloqReportQuery } from "../server/bookloq-reports.ts";
import { confirmSupportingMatch } from "../server/bookloq.ts";
import { bankAccounting } from "../server/bank-workflows.ts";

test("accounting commands reject unsupported data, inexact money and unconfirmed requests", () => {
  const valid = { type: "payment", invoiceId: "i", date: "2026-10-04", cashAccountId: "cash", amountCents: 6000, reference: "Receipt A", reviewed: true };
  assert.equal(invoiceAccountingCommand(valid).type, "payment");
  for (const change of [{ amountCents: 1.1 }, { amountCents: -1 }, { amountCents: Number.MAX_SAFE_INTEGER + 1 }, { reviewed: false }, { date: "2026-02-30" }, { organizationId: "foreign" }, { reference: "" }]) assert.throws(() => invoiceAccountingCommand({ ...valid, ...change }));
});

const errorCode = (code: string) => (error: unknown) => !!error && typeof error === "object" && "code" in error && error.code === code;
test("invoice accounting keeps live D1 invoices, payments, source receipts and ledger entries consistent", { timeout: 120000 }, async t => {
  const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('ok')}}", d1Databases: { DB: `invoice-accounting-${crypto.randomUUID()}` } });
  try {
    const db = await mf.getD1Database("DB") as unknown as D1Database;
    for (const file of (await readdir(new URL("../drizzle/", import.meta.url))).filter(f => /^\d{4}.*\.sql$/.test(f)).sort())
      for (const sql of (await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8")).split("--> statement-breakpoint").map(s => s.trim()).filter(Boolean)) await db.prepare(sql).run();
    await db.prepare("INSERT INTO users(id,email,display_name,created_at,updated_at) VALUES ('actor','invoice@example.invalid','Test',1,1)").run();
    for (const org of ["org", "other"]) await db.prepare("INSERT INTO workspaces(id,owner_name,business_name,legal_name,business_email,industry,city,address,postal_code,hours_json,created_at,updated_at) VALUES (?,'Test','Invoices','Invoices','invoice@example.invalid','Retail','Edmonton','Test','T5A1A1','[]',1,1)").bind(org).run();
    await db.prepare("INSERT INTO bookloq_settings(organization_id,status,data_mode,base_currency,accounting_basis,updated_by_user_id,created_at,updated_at) VALUES ('org','active','live','CAD','accrual','actor',1,1)").run();
    await db.prepare("INSERT INTO bookloq_contacts(id,organization_id,contact_type,name,created_at,updated_at) VALUES ('customer','org','customer','Customer',1,1)").run();
    for (const [id, type, subtype, balance, system] of [["ar","asset","receivable","debit","accounts_receivable"],["cash","asset","cash","debit","operating_cash"],["sales","revenue","sales","credit","sales_revenue"],["tax","liability","tax_payable","credit","gst_collected"]])
      await db.prepare("INSERT INTO financial_accounts(id,organization_id,code,name,account_type,account_subtype,normal_balance,system_key,created_at,updated_at) VALUES (?,'org',?,?,?,?,?,?,1,1)").bind(id,id,id,type,subtype,balance,system).run();
    await db.prepare("INSERT INTO accounting_periods(id,organization_id,label,start_date,end_date,status,created_at,updated_at) VALUES ('period','org','October','2026-10-01','2026-10-31','open',1,1)").run();
    const createInvoice = async (id: string) => {
      await db.prepare("INSERT INTO customer_invoices(id,organization_id,customer_id,invoice_number,invoice_date,due_date,status,subtotal_cents,tax_cents,total_cents,created_at,updated_at) VALUES (?,'org','customer',?,'2026-10-04','2026-10-31','draft',10000,500,10500,1,1)").bind(id,id).run();
      await db.prepare("INSERT INTO customer_invoice_lines(id,organization_id,invoice_id,line_number,description,quantity_milli,unit_price_cents,tax_rate_basis_points,subtotal_cents,tax_cents,total_cents,created_at) VALUES (?,'org',?,1,'Delivered service',1000,10000,500,10000,500,10500,1)").bind(`line:${id}`,id).run();
    };
    const context = (key = crypto.randomUUID(), organizationId = "org") => ({ organizationId, actorUserId: "actor", key, today: "2026-10-10", request: new Request("https://example.invalid/"), requestId: "test", now: new Date("2026-10-10T12:00:00Z") });
    const issue = (invoiceId: string) => ({ type: "issue", invoiceId, date: "2026-10-04", revenueAccountId: "sales", taxAccountId: "tax", reviewed: true });
    const payment = (invoiceId: string, amountCents: number, reference: string) => ({ type: "payment", invoiceId, date: "2026-10-04", cashAccountId: "cash", amountCents, reference, reviewed: true });
    const ledger = async () => (await db.prepare("SELECT a.id,COALESCE(SUM(l.debit_cents-l.credit_cents),0) balance FROM financial_accounts a LEFT JOIN journal_lines l ON l.account_id=a.id AND l.organization_id=a.organization_id WHERE a.organization_id='org' GROUP BY a.id ORDER BY a.id").all()).results;

    await t.test("issue, partial payment, settlement, correction and void use balanced retained journals", async () => {
      await createInvoice("cycle");
      const issued = await postInvoiceAccounting(db, issue("cycle"), context());
      assert.equal(issued.event.amountCents,10500);
      assert.deepEqual(await ledger(),[{ id:"ar",balance:10500 },{ id:"cash",balance:0 },{ id:"sales",balance:-10000 },{ id:"tax",balance:-500 }]);
      const a = await postInvoiceAccounting(db,payment("cycle",6000,"Receipt A"),context());
      assert.equal((await invoiceAccountingHistory(db,"org","cycle")).invoice.status,"partially_paid");
      const b = await postInvoiceAccounting(db,payment("cycle",4500,"Receipt B"),context());
      assert.equal((await invoiceAccountingHistory(db,"org","cycle")).invoice.status,"paid");
      assert.deepEqual(await ledger(),[{ id:"ar",balance:0 },{ id:"cash",balance:10500 },{ id:"sales",balance:-10000 },{ id:"tax",balance:-500 }],"Payment never recognizes revenue a second time");
      const report=await loadBookloqDatedReport(db,{organizationId:'org',currency:'CAD',timeZone:'America/Edmonton',contactIdentity:true,individualDetails:false,query:bookloqReportQuery(new URLSearchParams('from=2026-10-01&to=2026-10-04'),'2026-10-10')},new Date('2026-10-10T12:00:00Z'));
      assert.equal(report.profitAndLoss.revenueCents,10000);assert.equal(report.balanceSheet.assetCents,10500);assert.equal(report.trialBalance.differenceCents,0);
      await postInvoiceAccounting(db,{ type:"reverse_payment",invoiceId:"cycle",date:"2026-10-04",paymentId:b.event.id,reason:"Incorrect recorded receipt",reviewed:true },context());
      assert.equal((await invoiceAccountingHistory(db,"org","cycle")).invoice.paidCents,6000);
      await assert.rejects(()=>postInvoiceAccounting(db,{ type:"void",invoiceId:"cycle",date:"2026-10-04",reason:"Cancelled",reviewed:true },context()),errorCode("INVOICE_VOID_PAYMENTS"));
      await postInvoiceAccounting(db,{ type:"reverse_payment",invoiceId:"cycle",date:"2026-10-04",paymentId:a.event.id,reason:"Correct the recorded receipt",reviewed:true },context());
      await postInvoiceAccounting(db,{ type:"void",invoiceId:"cycle",date:"2026-10-05",reason:"Cancelled invoice",reviewed:true },context());
      const history = await invoiceAccountingHistory(db,"org","cycle");
      assert.equal(history.invoice.status,"void"); assert.equal(history.events.length,6);
      assert.ok((await ledger())!.every(r=>r.balance===0));
      const earlier=await loadBookloqDatedReport(db,{organizationId:'org',currency:'CAD',timeZone:'America/Edmonton',contactIdentity:true,individualDetails:false,query:bookloqReportQuery(new URLSearchParams('from=2026-10-01&to=2026-10-04'),'2026-10-10')});assert.equal(earlier.profitAndLoss.revenueCents,10000,'A later void preserves earned revenue on the original accounting date');
      await assert.rejects(()=>db.prepare("UPDATE invoice_accounting_events SET amount_cents=1 WHERE id=?").bind(a.event.id).run(),/INVOICE_ACCOUNTING_IMMUTABLE/);
      await assert.rejects(()=>db.prepare("UPDATE journal_lines SET debit_cents=1 WHERE journal_entry_id=? AND debit_cents>0").bind(a.event.journalEntryId).run(),/INVOICE_ACCOUNTING_IMMUTABLE/);
      await assert.rejects(()=>db.prepare("UPDATE customer_invoices SET currency='USD' WHERE id='cycle'").run(),/INVOICE_ACCOUNTING_IMMUTABLE/);
    });
    await t.test("exact replay is safe, changed replay conflicts, tenant/mode/currency/date/period guards hold", async () => {
      await createInvoice("guards"); const ctx=context();
      const result=await postInvoiceAccounting(db,issue("guards"),ctx);
      await db.prepare("UPDATE accounting_periods SET status='locked' WHERE id='period'").run();
      assert.equal((await postInvoiceAccounting(db,issue("guards"),ctx)).event.id,result.event.id);
      await assert.rejects(()=>postInvoiceAccounting(db,{...issue("guards"),date:"2026-10-05"},ctx),errorCode("INVOICE_REQUEST_CONFLICT"));
      await assert.rejects(()=>postInvoiceAccounting(db,payment("guards",1000,"Locked"),context()),errorCode("ACCOUNTING_PERIOD_UNAVAILABLE"));
      await db.prepare("UPDATE accounting_periods SET status='open' WHERE id='period'").run();
      await assert.rejects(()=>postInvoiceAccounting(db,issue("guards"),context(undefined,"other")),errorCode("INVOICE_ACCOUNTING_SETUP"));
      await assert.rejects(()=>invoiceAccountingHistory(db,"other","guards"),errorCode("INVOICE_NOT_FOUND"));
      await assert.rejects(()=>postInvoiceAccounting(db,{...payment("guards",1000,"Future"),date:"2026-10-11"},context()),errorCode("INVOICE_ACCOUNTING_DATE"));
      await assert.rejects(()=>postInvoiceAccounting(db,payment("guards",10501,"Too much"),context()),errorCode("INVOICE_OVERPAYMENT"));
      await db.prepare("UPDATE bookloq_settings SET data_mode='demonstration' WHERE organization_id='org'").run();
      await assert.rejects(()=>postInvoiceAccounting(db,payment("guards",1000,"Demo"),context()),errorCode("INVOICE_ACCOUNTING_SETUP"));
      await db.prepare("UPDATE bookloq_settings SET data_mode='live' WHERE organization_id='org'").run();
    });
    await t.test("simultaneous issue/payment requests cannot double issue or oversettle an invoice", async () => {
      await createInvoice("race");
      const issues=await Promise.allSettled([postInvoiceAccounting(db,issue("race"),context()),postInvoiceAccounting(db,issue("race"),context())]);
      assert.equal(issues.filter(r=>r.status==="fulfilled").length,1);
      const payments=await Promise.allSettled([postInvoiceAccounting(db,payment("race",8000,"Race A"),context()),postInvoiceAccounting(db,payment("race",8000,"Race B"),context())]);
      assert.equal(payments.filter(r=>r.status==="fulfilled").length,1);
      assert.equal((await invoiceAccountingHistory(db,"org","race")).invoice.paidCents,8000);
    });
    await t.test("a bank receipt is linked once and correction releases its posting, without reconciling it", async () => {
      await createInvoice("source");await postInvoiceAccounting(db,issue("source"),context());
      await db.prepare("INSERT INTO financial_transactions(id,organization_id,transaction_date,posting_date,description,amount_cents,currency,account_id,source_system,external_source_id,created_at,updated_at) VALUES ('receipt','org','2026-10-04','2026-10-04','Receipt',3000,'CAD','cash','manual','receipt',1,1)").run();
      const cmd={...payment("source",3000,"Source A"),transactionId:"receipt"};
      const paid=await postInvoiceAccounting(db,cmd,context());
      assert.deepEqual(await db.prepare("SELECT journal_entry_id,reconciliation_status FROM financial_transactions WHERE id='receipt'").first(),{journal_entry_id:paid.event.journalEntryId,reconciliation_status:"unreconciled"});
      const supporting={organizationId:'org',transactionId:'receipt',targetType:'customer_invoice' as const,targetId:'source',amountCents:3000,currency:'CAD',demoRecord:0,note:'Same paid invoice evidence',actorUserId:'actor',timestamp:1};
      const matchId=await confirmSupportingMatch(db,supporting);
      assert.equal(await confirmSupportingMatch(db,supporting),matchId,'The same source-linked invoice payment remains compatible');
      await assert.rejects(()=>confirmSupportingMatch(db,{...supporting,targetId:'guards'}),errorCode('MATCH_RECORD_CHANGED'));
      await assert.rejects(()=>postInvoiceAccounting(db,{...cmd,reference:"Source B"},context()),errorCode("INVOICE_PAYMENT_SOURCE"));
      await postInvoiceAccounting(db,{type:"reverse_payment",invoiceId:"source",date:"2026-10-04",paymentId:paid.event.id,reason:"Wrong allocation",reviewed:true},context());
      assert.equal((await db.prepare("SELECT journal_entry_id FROM financial_transactions WHERE id='receipt'").first())?.journal_entry_id,null);
    });
    await t.test("a later bank match returns an actionable conflict until released, then invoice correction succeeds",async()=>{
      await createInvoice('bank-matched');await postInvoiceAccounting(db,issue('bank-matched'),context());
      const paid=await postInvoiceAccounting(db,payment('bank-matched',2000,'Separately recorded receipt'),context());
      await db.prepare("INSERT INTO financial_transactions(id,organization_id,transaction_date,posting_date,description,amount_cents,currency,account_id,source_system,external_source_id,created_at,updated_at) VALUES ('later-bank-receipt','org','2026-10-04','2026-10-04','Later bank receipt',2000,'CAD','cash','manual','later-bank-receipt',1,1)").run();
      const cashLine=await db.prepare('SELECT id FROM journal_lines WHERE journal_entry_id=? AND account_id=\'cash\'').bind(paid.event.journalEntryId).first<{id:string}>();
      await bankAccounting(db,{action:'match',transactionId:'later-bank-receipt',cashLineId:cashLine!.id,reason:'Exact recorded payment',reviewed:true},context());
      const correction={type:'reverse_payment',invoiceId:'bank-matched',date:'2026-10-04',paymentId:paid.event.id,reason:'Correct the recorded receipt',reviewed:true};
      await assert.rejects(()=>postInvoiceAccounting(db,correction,context()),(error:unknown)=>errorCode('INVOICE_BANK_MATCH_REQUIRED')(error)&&error instanceof Error&&/Banking or Reconciliation.*release the ledger match/.test(error.message));
      assert.equal((await invoiceAccountingHistory(db,'org','bank-matched')).invoice.paidCents,2000,'A blocked correction retains the payment and rolls back the reversal');
      assert.equal((await db.prepare('SELECT COUNT(*) n FROM invoice_accounting_events WHERE reversal_of_event_id=?').bind(paid.event.id).first())?.n,0);
      await bankAccounting(db,{action:'unmatch',transactionId:'later-bank-receipt',reason:'Release before invoice correction',reviewed:true},context());
      await postInvoiceAccounting(db,correction,context());
      assert.equal((await invoiceAccountingHistory(db,'org','bank-matched')).invoice.paidCents,0);
      assert.equal((await db.prepare("SELECT journal_entry_id FROM financial_transactions WHERE id='later-bank-receipt'").first())?.journal_entry_id,null);
    });
    await t.test("failed audit and commit-time period changes roll back all financial effects", async () => {
      await createInvoice("rollback");
      await db.prepare("CREATE TRIGGER reject_invoice_audit BEFORE INSERT ON audit_events WHEN NEW.action='customer_invoice.issue' BEGIN SELECT RAISE(ABORT,'AUDIT_FAILED'); END").run();
      await assert.rejects(()=>postInvoiceAccounting(db,issue("rollback"),context()),/AUDIT_FAILED/);
      assert.equal((await invoiceAccountingHistory(db,"org","rollback")).events.length,0);
      assert.equal((await db.prepare("SELECT journal_entry_id FROM customer_invoices WHERE id='rollback'").first())?.journal_entry_id,null);
      assert.equal((await db.prepare("SELECT COUNT(*) n FROM journal_entries WHERE source_ref='rollback'").first())?.n,0);
      await db.prepare("DROP TRIGGER reject_invoice_audit").run();
      await db.prepare("CREATE TRIGGER close_during_invoice BEFORE INSERT ON invoice_accounting_events WHEN NEW.invoice_id='rollback' BEGIN UPDATE accounting_periods SET status='locked' WHERE id='period'; END").run();
      await assert.rejects(()=>postInvoiceAccounting(db,issue("rollback"),context()),errorCode("INVOICE_ACCOUNTING_CHANGED"));
      await db.prepare("DROP TRIGGER close_during_invoice").run();
    });
    await t.test("workspace deletion cascades retained invoice history",async()=>{
      await db.prepare("DELETE FROM workspaces WHERE id='org'").run();
      assert.equal((await db.prepare("SELECT COUNT(*) n FROM invoice_accounting_events").first())?.n,0);
    });
  } finally { await mf.dispose(); }
});
