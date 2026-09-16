import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { unstable_splitSqlQuery } from "wrangler";
import { reviewedBankStatement, statementFingerprint } from "../domain/bank-statement.ts";
import { commitStatement, prepareStatement, statementAccounts, undoStatement } from "../server/bank-statement.ts";
import { loadBookloqCashActivity } from "../server/bookloq-cash-activity.ts";

function input(overrides: Record<string, unknown> = {}) { return {
  documentId: "doc-one", newAccount: { name: "Operating account", institutionName: "Test Bank", last4: "1234" }, currency: "CAD", startDate: "2026-09-01", endDate: "2026-09-15", openingBalanceCents: 100000, closingBalanceCents: 125000,
  rows: [{ postingDate: "2026-09-02", description: "Customer deposit", amountCents: 40000 }, { postingDate: "2026-09-04", description: "Supplier payment", amountCents: -15000 }], ...overrides,
}; }
test("reviewed statement reconciles signed cents without treating movements as revenue", async () => {
  const result = reviewedBankStatement(input(), "2026-09-16");
  assert.equal(result.inflowCents, 40000); assert.equal(result.outflowCents, 15000); assert.equal(result.netCashFlowCents, 25000); assert.equal(result.differenceCents, 0);
  assert.equal(await statementFingerprint(result), await statementFingerprint(reviewedBankStatement(input(), "2026-09-16")));
  assert.notEqual(await statementFingerprint(result), await statementFingerprint(reviewedBankStatement(input({ openingBalanceCents: 0, closingBalanceCents: 25000 }), "2026-09-16")));
});
test("statement review rejects wrong totals, dates, currencies, precision and oversized imports", () => {
  for (const changed of [{ closingBalanceCents: 125001 }, { endDate: "2026-09-17" }, { startDate: "2026-02-30" }, { openingBalanceCents: 0.1 }, { rows: [] }, { rows: Array(501).fill({ postingDate: "2026-09-02", description: "Deposit", amountCents: 1 }) }, { rows: [{ postingDate: "2026-08-31", description: "Wrong period", amountCents: 25000 }] }, { rows: [{ postingDate: "2026-09-01", description: "Wrong currency", amountCents: 25000, currency: "USD" }] }, { newAccount: { name: "Account", institutionName: "Bank", last4: "123456789" } }]) assert.throws(() => reviewedBankStatement(input(changed), "2026-09-16"));
});

test("statement database import is atomic, scoped, duplicate-safe and supplies historical cash only", { timeout: 120000 }, async () => {
  const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('ok')}}", d1Databases: { DB: `statement-${crypto.randomUUID()}` } });
  try {
    const db = await mf.getD1Database("DB") as unknown as D1Database;
    for (const file of (await readdir(new URL("../drizzle/", import.meta.url))).filter(file => /^\d{4}.*\.sql$/.test(file)).sort()) {
      const migration = await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8");
      // Exercise the provider SQL splitter too: CASE ... END; inside a trigger
      // can be split differently from the local Drizzle breakpoint path.
      const statements = file === "0051_reviewed_bank_statements.sql" ? unstable_splitSqlQuery(migration) : migration.split("--> statement-breakpoint").map(text => text.trim()).filter(Boolean);
      if (file === "0051_reviewed_bank_statements.sql") assert.equal(statements.filter(sql => /^CREATE TRIGGER/i.test(sql)).length, 4);
      for (const sql of statements) await db.prepare(sql).run();
    }
    await db.batch([
      db.prepare("INSERT INTO users(id,email,display_name,created_at,updated_at) VALUES ('actor','statement@example.invalid','Test',1,1)"),
      db.prepare("INSERT INTO workspaces(id,owner_name,business_name,legal_name,business_email,industry,city,address,postal_code,hours_json,created_at,updated_at) VALUES ('org','Test','Statement test','Statement test','test@example.invalid','Retail','Edmonton','Test','T5A1A1','[]',1,1)"),
    ]);
    const addDocument = (id: string) => db.prepare("INSERT INTO workspace_documents(id,organization_id,document_type,file_name,object_key,content_type,size_bytes,sha256_hex,security_state,status,scan_status,extraction_status,uploaded_by_user_id,created_at,updated_at) VALUES (?,'org','other','Statement.pdf',?,'application/pdf',100,?,'clean','review_required','clean','complete','actor',1,1)").bind(id,id,id).run();
    await addDocument("doc-one"); await addDocument("doc-two"); await addDocument("doc-three");
    const bucket = { get: async () => ({ customMetadata: { organizationId: "org", securityState: "clean" } }) } as unknown as R2Bucket;
    const first = reviewedBankStatement(input(), "2026-09-16"), fingerprint = await statementFingerprint(first);
    const prepared = await prepareStatement(db,bucket,"org",first,"CAD","bank_statement");
    assert.equal(prepared.prior,null);
    const imported = await commitStatement(db,"org","actor",first,fingerprint,null);
    assert.equal(imported.rowCount,2); assert.equal(imported.postedToLedger,false);
    const transactions = await db.prepare("SELECT amount_cents,source_system,journal_entry_id,categorization_status FROM financial_transactions WHERE organization_id='org' ORDER BY amount_cents").all();
    assert.deepEqual(transactions.results?.map(row => row.amount_cents),[-15000,40000]);
    assert.ok(transactions.results?.every(row => row.source_system === "bank_statement" && row.journal_entry_id === null && row.categorization_status === "missing"));
    const accounts = await statementAccounts(db,"org","CAD",false); assert.equal(accounts.length,1); assert.equal(accounts[0].connectionStatus,"manual");
    assert.equal((await db.prepare("SELECT live_balance_cents FROM bank_accounts WHERE id=?").bind(imported.bankAccountId).first())?.live_balance_cents,null);
    const cash = await loadBookloqCashActivity(db,{ organizationId:"org",currency:"CAD",asOf:"2026-09-16",dataMode:"live",allowed:true });
    assert.equal(cash.days30.inflowCents,40000); assert.equal(cash.days30.outflowCents,15000); assert.equal(cash.days30.transactionCount,2);
    const replay = await prepareStatement(db,bucket,"org",first,"CAD","bank_statement"); assert.equal(replay.prior?.fingerprint,fingerprint);
    await assert.rejects(() => commitStatement(db,"org","actor",first,fingerprint,null));
    const overlap = reviewedBankStatement(input({ documentId:"doc-two",bankAccountId:imported.bankAccountId,newAccount:null }),"2026-09-16");
    await assert.rejects(() => prepareStatement(db,bucket,"org",overlap,"CAD","bank_statement"),/already has an imported statement/);
    await assert.rejects(() => commitStatement(db,"org","actor",overlap,"0".repeat(64),accounts[0]));
    assert.equal((await db.prepare("SELECT COUNT(*) count FROM financial_transactions").first())?.count,2);
    await assert.rejects(() => prepareStatement(db,bucket,"other-org",first,"CAD","bank_statement"),/uploaded to this workspace/);
    await db.prepare("UPDATE bank_accounts SET provider='plaid' WHERE id=?").bind(imported.bankAccountId).run();
    await assert.rejects(() => prepareStatement(db,bucket,"org",reviewedBankStatement(input({documentId:"doc-three",bankAccountId:imported.bankAccountId,newAccount:null}),"2026-09-16"),"CAD","bank_statement"),/manual cash account/);
    const withheld = await loadBookloqCashActivity(db,{organizationId:"org",currency:"CAD",asOf:"2026-09-16",dataMode:"live",allowed:true}); assert.equal(withheld.days30.transactionCount,0);
    await db.prepare("UPDATE bank_accounts SET provider='manual' WHERE id=?").bind(imported.bankAccountId).run();
    await db.prepare("UPDATE financial_transactions SET reconciliation_status='matched' WHERE id=?").bind(`${imported.id}:1`).run();
    await assert.rejects(() => undoStatement(db,"org",imported.id),/posted, matched, reconciled/);
    assert.equal((await db.prepare("SELECT status FROM workspace_documents WHERE id='doc-one'").first())?.status,"approved");
    assert.equal((await db.prepare("SELECT COUNT(*) count FROM financial_transactions").first())?.count,2);
    await db.prepare("UPDATE financial_transactions SET reconciliation_status='unreconciled' WHERE id=?").bind(`${imported.id}:1`).run();
    await db.prepare("INSERT INTO bookloq_transaction_matches(id,organization_id,transaction_id,document_id,status,method,confidence_basis_points,matched_amount_cents,matched_by_user_id,created_at,updated_at) VALUES ('confirmed-link','org',?,'doc-two','confirmed','manual',10000,40000,'actor',1,1)").bind(`${imported.id}:1`).run();
    await assert.rejects(() => undoStatement(db,"org",imported.id),/posted, matched, reconciled/);
    await db.prepare("DELETE FROM bookloq_transaction_matches WHERE id='confirmed-link'").run();
    await db.prepare("INSERT INTO journal_entries(id,organization_id,entry_number,entry_date,posting_date,status,memo,total_debit_cents,total_credit_cents,idempotency_key,prepared_by_user_id,created_at,updated_at) VALUES ('linked-journal','org','TEST-DRAFT','2026-09-01','2026-09-01','draft','Draft linked test',0,0,'linked-journal','actor',1,1)").run();
    await db.prepare("UPDATE financial_transactions SET journal_entry_id='linked-journal' WHERE id=?").bind(`${imported.id}:1`).run();
    await assert.rejects(() => undoStatement(db,"org",imported.id),/posted, matched, reconciled/);
    await db.prepare("UPDATE financial_transactions SET journal_entry_id=NULL WHERE id=?").bind(`${imported.id}:1`).run();
    await assert.rejects(() => undoStatement(db,"other-org",imported.id),/unavailable/);
    const undone = await undoStatement(db,"org",imported.id); assert.equal(undone.rowCount,2);
    assert.equal((await db.prepare("SELECT COUNT(*) count FROM financial_transactions").first())?.count,0);
    assert.equal((await db.prepare("SELECT status FROM workspace_documents WHERE id='doc-one'").first())?.status,"review_required");
    assert.equal((await db.prepare("SELECT COUNT(*) count FROM bank_accounts").first())?.count,1,"undo preserves the manual account");
    const emptyCash = await loadBookloqCashActivity(db,{organizationId:"org",currency:"CAD",asOf:"2026-09-16",dataMode:"live",allowed:true}); assert.equal(emptyCash.days30.transactionCount,0);
    await assert.rejects(() => undoStatement(db,"org",imported.id),/already been undone/);
    const corrected = reviewedBankStatement(input({bankAccountId:imported.bankAccountId,newAccount:null}),"2026-09-16");
    const correctedContext = await prepareStatement(db,bucket,"org",corrected,"CAD","bank_statement");
    await commitStatement(db,"org","actor",corrected,await statementFingerprint(corrected),correctedContext.account!);
    await db.prepare("UPDATE financial_transactions SET reconciliation_status='reconciled' WHERE organization_id='org'").run();
    await db.prepare("DELETE FROM workspaces WHERE id='org'").run();
    assert.equal((await db.prepare("SELECT COUNT(*) count FROM bank_statement_imports").first())?.count,0);
    assert.equal((await db.prepare("SELECT COUNT(*) count FROM bank_statement_rows").first())?.count,0);
    assert.equal((await db.prepare("SELECT COUNT(*) count FROM financial_transactions").first())?.count,0);
  } finally { await mf.dispose(); }
});
