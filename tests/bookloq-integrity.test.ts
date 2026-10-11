import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { prepareAudit } from "../server/audit.ts";
import {
  confirmSupportingMatch, findJournalReplay, journalInput, lockBookloqPeriod,
  saveBookloqBudget, updateCloseItem, validateJournalContacts,
} from "../server/bookloq.ts";

const journal = () => journalInput({ entryDate: "2026-10-04", memo: "Reviewed supplies", currency: "CAD", lines: [
  { accountId: "expense", debitCents: 10000, contactId: "contact" },
  { accountId: "cash", creditCents: 10000 },
] });
const code = (expected: string) => (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === expected);

test("BookLoQ integrity guards run against migrated D1 without a built worker", { timeout: 120000 }, async t => {
  const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('ok')}}", d1Databases: { DB: `bookloq-integrity-${crypto.randomUUID()}` } });
  try {
    const db = await mf.getD1Database("DB") as unknown as D1Database;
    for (const file of (await readdir(new URL("../drizzle/", import.meta.url))).filter(file => /^\d{4}.*\.sql$/.test(file)).sort()) {
      for (const sql of (await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8")).split("--> statement-breakpoint").map(text => text.trim()).filter(Boolean)) await db.prepare(sql).run();
    }
    await db.prepare("INSERT INTO users(id,email,display_name,created_at,updated_at) VALUES ('actor','integrity@example.invalid','Test',1,1)").run();
    for (const org of ["org", "other"]) await db.prepare("INSERT INTO workspaces(id,owner_name,business_name,legal_name,business_email,industry,city,address,postal_code,hours_json,created_at,updated_at) VALUES (?, 'Test','Integrity','Integrity','test@example.invalid','Retail','Edmonton','Test','T5A1A1','[]',1,1)").bind(org).run();
    for (const [id, org, active] of [["contact", "org", 1], ["foreign", "other", 1], ["inactive", "org", 0]]) await db.prepare("INSERT INTO bookloq_contacts(id,organization_id,contact_type,name,active,created_at,updated_at) VALUES (?,?,'both','Test',?,1,1)").bind(id, org, active).run();
    await db.batch([
      db.prepare("INSERT INTO financial_accounts(id,organization_id,code,name,account_type,account_subtype,normal_balance,created_at,updated_at) VALUES ('expense','org','6000','Supplies','expense','operating','debit',1,1)"),
      db.prepare("INSERT INTO financial_accounts(id,organization_id,code,name,account_type,account_subtype,normal_balance,created_at,updated_at) VALUES ('cash','org','1000','Cash','asset','cash','debit',1,1)"),
      db.prepare("INSERT INTO accounting_periods(id,organization_id,label,start_date,end_date,status,created_at,updated_at) VALUES ('period','org','October','2026-10-01','2026-10-31','open',1,1)"),
    ]);
    const entry = (id: string, key: string, reversalOf: string | null = null, reason = "Reviewed supplies") => db.prepare(`INSERT INTO journal_entries
      (id,organization_id,entry_number,entry_date,posting_date,period_id,status,source_type,memo,currency,total_debit_cents,total_credit_cents,reversal_of_entry_id,idempotency_key,prepared_by_user_id,created_at,updated_at)
      VALUES (?,'org',?,'2026-10-04','2026-10-04','period','posted',?,?,'CAD',10000,10000,?,?,'actor',1,1)`)
      .bind(id, id, reversalOf ? "reversal" : "manual", reason, reversalOf, key);
    const lines = (id: string) => journal().lines.map((line, index) => db.prepare(`INSERT INTO journal_lines
      (id,organization_id,journal_entry_id,line_number,account_id,description,debit_cents,credit_cents,tax_code,tax_amount_cents,contact_id,location_ref,department_ref,project_ref,created_at)
      VALUES (?,'org',?,?,?,?,?,?,?,?,?,?,?,?,1)`)
      .bind(`${id}:${index}`, id, index + 1, line.accountId, line.description, line.debitCents, line.creditCents,
        line.taxCode, line.taxAmountCents, line.contactId, line.locationRef, line.departmentRef, line.projectRef));

    await t.test("journal contacts are tenant scoped and inactive/missing contacts fail uniformly", async () => {
      await validateJournalContacts(db, "org", journal().lines);
      await validateJournalContacts(db, "org", journal().lines.map(line => ({ ...line, contactId: null })));
      for (const id of ["foreign", "inactive", "missing"]) await assert.rejects(() => validateJournalContacts(db, "org", journal().lines.map(line => ({ ...line, contactId: id }))), code("JOURNAL_CONTACT_UNAVAILABLE"));
    });

    await t.test("idempotency compares all persisted journal fields and separates posting from reversal", async () => {
      assert.equal(await findJournalReplay(db, "org", "absent", { kind: "manual", input: journal() }), null);
      await db.batch([entry("journal", "journal-key"), ...lines("journal")]);
      assert.equal((await findJournalReplay(db, "org", "journal-key", { kind: "manual", input: journal() }))?.id, "journal");
      assert.equal(await findJournalReplay(db, "other", "journal-key", { kind: "manual", input: journal() }), null);
      const changed = [
        { ...journal(), memo: "Different request" }, { ...journal(), entryDate: "2026-10-05" },
        { ...journal(), currency: "USD" }, { ...journal(), lines: [...journal().lines].reverse() },
        { ...journal(), lines: journal().lines.map(line => ({ ...line, contactId: null })) },
        { ...journal(), lines: journal().lines.map(line => ({ ...line, departmentRef: "changed" })) },
        journalInput({ entryDate: "2026-10-04", memo: "Reviewed supplies", currency: "CAD", lines: [{ accountId: "expense", debitCents: 9999 }, { accountId: "cash", creditCents: 9999 }] }),
      ];
      for (const input of changed) await assert.rejects(() => findJournalReplay(db, "org", "journal-key", { kind: "manual", input }), code("JOURNAL_REQUEST_CONFLICT"));
      await assert.rejects(() => findJournalReplay(db, "org", "journal-key", { kind: "reversal", entryId: "journal", reason: "Fix", reversalDate: "2026-10-04" }), code("JOURNAL_REQUEST_CONFLICT"));
      await db.batch([entry("reversal", "reversal-key", "journal", "Correct amount"), db.prepare("UPDATE journal_entries SET status='reversed' WHERE id='journal'")]);
      const replay = { kind: "reversal" as const, entryId: "journal", reason: "Correct amount", reversalDate: "2026-10-04" };
      assert.equal((await findJournalReplay(db, "org", "reversal-key", replay))?.id, "reversal");
      for (const request of [{ ...replay, entryId: "different" }, { ...replay, reason: "Different" }, { ...replay, reversalDate: "2026-10-05" }]) await assert.rejects(() => findJournalReplay(db, "org", "reversal-key", request), code("JOURNAL_REQUEST_CONFLICT"));
      await assert.rejects(() => findJournalReplay(db, "org", "reversal-key", { kind: "manual", input: journal() }), code("JOURNAL_REQUEST_CONFLICT"));
      await db.prepare("UPDATE accounting_periods SET status='locked' WHERE id='period'").run();
      assert.equal((await findJournalReplay(db, "org", "journal-key", { kind: "manual", input: journal() }))?.status, "reversed", "Exact replay does not reapply current period/account eligibility");
      await db.prepare("UPDATE accounting_periods SET status='open' WHERE id='period'").run();
    });

    await t.test("prepared audit failure rolls back the journal and lines and valid audit stores trusted fields", async () => {
      const audit = (id: string) => prepareAudit(db, { request: new Request("https://example.invalid/"), requestId: "request", organizationId: "org", actorUserId: "actor", action: "journal.posted", resourceType: "journal_entry", resourceId: id, details: { debitCents: 10000 } });
      await db.prepare("CREATE TRIGGER reject_test_audit BEFORE INSERT ON audit_events WHEN NEW.action='journal.posted' BEGIN SELECT RAISE(ABORT,'AUDIT_FAILED'); END").run();
      await assert.rejects(() => audit("rollback").then(statement => db.batch([entry("rollback", "rollback-key"), ...lines("rollback"), statement])), /AUDIT_FAILED/);
      assert.equal(await db.prepare("SELECT id FROM journal_entries WHERE id='rollback'").first(), null);
      assert.equal((await db.prepare("SELECT count(*) count FROM journal_lines WHERE journal_entry_id='rollback'").first())?.count, 0);
      await db.prepare("DROP TRIGGER reject_test_audit").run();
      await db.batch([entry("audited", "audited-key"), ...lines("audited"), await audit("audited")]);
      const event = await db.prepare("SELECT * FROM audit_events WHERE resource_id='audited'").first();
      assert.equal(event?.actor_user_id, "actor"); assert.equal(event?.organization_id, "org"); assert.equal(event?.outcome, "success");
      assert.equal(JSON.parse(String(event?.details_json)).debitCents, 10000);
      assert.ok(Number(event?.created_at) < 10_000_000_000, "Audit timestamp uses schema seconds, not milliseconds");
    });

    const addTransaction = (id: string, state = "posted", reconciliation = "unreconciled") => db.prepare(`INSERT INTO financial_transactions
      (id,organization_id,transaction_date,posting_date,description,amount_cents,currency,source_system,external_source_id,source_state,reconciliation_status,created_at,updated_at)
      VALUES (?,'org','2026-10-04','2026-10-04','Deposit',10000,'CAD','manual',?,?,?,?,1)`)
      .bind(id, id, state, reconciliation, 1).run();
    for (const id of ["invoice-a", "invoice-b"]) await db.prepare(`INSERT INTO customer_invoices
      (id,organization_id,customer_id,invoice_number,invoice_date,due_date,status,subtotal_cents,total_cents,created_at,updated_at)
      VALUES (?,'org','contact',?,'2026-10-04','2026-10-31','sent',10000,10000,1,1)`).bind(id, id).run();
    const match = (transactionId: string, targetId = "invoice-a") => ({ organizationId: "org", transactionId, targetType: "customer_invoice" as const, targetId, amountCents: 10000, currency: "CAD", demoRecord: 0, note: "Reviewed evidence", actorUserId: "actor", timestamp: 1 });

    await t.test("concurrent different matches leave exactly one confirmed target; retry preserves its ID", async () => {
      await addTransaction("race");
      const results = await Promise.allSettled([confirmSupportingMatch(db, match("race")), confirmSupportingMatch(db, match("race", "invoice-b"))]);
      assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
      const matches = await db.prepare("SELECT id,customer_invoice_id target FROM bookloq_transaction_matches WHERE transaction_id='race' AND status='confirmed'").all<{ id: string; target: string }>();
      const confirmed = matches.results ?? [];
      assert.equal(confirmed.length, 1);
      assert.equal(await confirmSupportingMatch(db, match("race", confirmed[0].target)), confirmed[0].id);
      assert.equal((await db.prepare("SELECT reconciliation_status FROM financial_transactions WHERE id='race'").first())?.reconciliation_status, "matched");
      assert.equal((await db.prepare("SELECT paid_cents FROM customer_invoices WHERE id='invoice-a'").first())?.paid_cents, 0, "Supporting evidence does not record payment");
    });

    await t.test("matches reject stale amounts, currency/mode/tenant drift and preserve reconciled state", async () => {
      for (const [id, state, reconciliation] of [["pending", "pending", "unreconciled"], ["removed", "removed", "unreconciled"], ["reconciled", "posted", "reconciled"]]) {
        await addTransaction(id, state, reconciliation);
        await assert.rejects(() => confirmSupportingMatch(db, match(id)), code("MATCH_RECORD_CHANGED"));
        assert.equal((await db.prepare("SELECT reconciliation_status FROM financial_transactions WHERE id=?").bind(id).first())?.reconciliation_status, reconciliation);
      }
      await addTransaction("stale");
      for (const input of [{ ...match("stale"), amountCents: 9999 }, { ...match("stale"), currency: "USD" }, { ...match("stale"), demoRecord: 1 }, { ...match("stale"), organizationId: "other" }]) await assert.rejects(() => confirmSupportingMatch(db, input), code("MATCH_RECORD_CHANGED"));
      await db.prepare("UPDATE customer_invoices SET status='void' WHERE id='invoice-a'").run();
      await assert.rejects(() => confirmSupportingMatch(db, match("stale")), code("MATCH_RECORD_CHANGED"));
      await db.prepare("UPDATE customer_invoices SET status='sent' WHERE id='invoice-a'").run();
      assert.equal((await db.prepare("SELECT COUNT(*) count FROM bookloq_transaction_matches WHERE transaction_id='stale'").first())?.count, 0);
    });

    await t.test("a failed transaction status write rolls back the supporting match", async () => {
      await addTransaction("rollback-match");
      await db.prepare("CREATE TRIGGER reject_match_status BEFORE UPDATE OF reconciliation_status ON financial_transactions WHEN NEW.id='rollback-match' BEGIN SELECT RAISE(ABORT,'STATUS_FAILED'); END").run();
      await assert.rejects(() => confirmSupportingMatch(db, match("rollback-match")), /STATUS_FAILED/);
      assert.equal((await db.prepare("SELECT COUNT(*) count FROM bookloq_transaction_matches WHERE transaction_id='rollback-match'").first())?.count, 0);
      await db.prepare("DROP TRIGGER reject_match_status").run();
    });

    await t.test("upserting a budget returns the stored identity for the exact scope", async () => {
      const input = { organizationId: "org", accountId: "expense", periodStart: "2026-10-01", periodEnd: "2026-10-31", locationRef: "all", departmentRef: "all", budgetCents: 10000, committedCents: 0, forecastCents: 0, timestamp: 1 };
      const first = await saveBookloqBudget(db, input);
      assert.equal(await saveBookloqBudget(db, { ...input, budgetCents: 20000, timestamp: 2 }), first);
      const saved = await db.prepare("SELECT id,budget_cents FROM bookloq_budgets WHERE organization_id='org'").all();
      assert.deepEqual(saved.results, [{ id: first, budget_cents: 20000 }]);
    });

    await t.test("period locks require a nonempty complete review and prevent later checklist mutation", async () => {
      const lock = () => lockBookloqPeriod(db, { organizationId: "org", periodId: "period", actorUserId: "actor", timestamp: 2 });
      await assert.rejects(lock, code("CLOSE_INCOMPLETE_OR_CHANGED"));
      await db.prepare("INSERT INTO month_end_items(id,organization_id,period_id,item_key,title,status,updated_at) VALUES ('close','org','period','review','Review statements','not_started',1)").run();
      await assert.rejects(lock, code("CLOSE_INCOMPLETE_OR_CHANGED"));
      await updateCloseItem(db, { organizationId: "org", itemId: "close", beforeStatus: "not_started", status: "complete", timestamp: 2 });
      await lock();
      await assert.rejects(() => updateCloseItem(db, { organizationId: "org", itemId: "close", beforeStatus: "complete", status: "not_started", timestamp: 3 }), code("CLOSE_ITEM_LOCKED_OR_CHANGED"));
      await assert.rejects(() => updateCloseItem(db, { organizationId: "other", itemId: "close", beforeStatus: "complete", status: "not_started", timestamp: 3 }), code("CLOSE_ITEM_LOCKED_OR_CHANGED"));
      await db.prepare("UPDATE accounting_periods SET status='review' WHERE id='period'").run();
      await updateCloseItem(db, { organizationId: "org", itemId: "close", beforeStatus: "complete", status: "in_progress", timestamp: 3 });
      await assert.rejects(() => updateCloseItem(db, { organizationId: "org", itemId: "close", beforeStatus: "complete", status: "not_started", timestamp: 4 }), code("CLOSE_ITEM_LOCKED_OR_CHANGED"));
      await updateCloseItem(db, { organizationId: "org", itemId: "close", beforeStatus: "in_progress", status: "complete", timestamp: 4 });
      const race = await Promise.allSettled([lock(), updateCloseItem(db, { organizationId: "org", itemId: "close", beforeStatus: "complete", status: "not_started", timestamp: 5 })]);
      assert.equal(race.filter(result => result.status === "fulfilled").length, 1);
      const state = await db.prepare("SELECT p.status periodStatus,m.status itemStatus FROM accounting_periods p JOIN month_end_items m ON m.period_id=p.id WHERE p.id='period'").first();
      assert.ok(state?.periodStatus !== "locked" || state?.itemStatus === "complete", "A lock and competing edit cannot leave a locked incomplete review");
    });
  } finally { await mf.dispose(); }
});
