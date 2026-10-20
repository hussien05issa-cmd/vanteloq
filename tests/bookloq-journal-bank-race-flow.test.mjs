import assert from "node:assert/strict";
import test from "node:test";
import { POST, PATCH } from "../app/api/v1/bookloq/journals/route.ts";
import { bankAccounting } from "../server/bank-workflows.ts";
import { createEnvironment, createReportWorkspace, dispatch, identityHeaders, origin } from "./helpers/retail-worker-fixture.mjs";

async function expect(response, status) {
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  return body;
}

for (const mode of ["source", "built"]) {
  test(`${mode} journal reversal reports a retained bank match as 409 and succeeds after audited unmatch`, { timeout: 120000 }, async () => {
    const { worker, environment, database, dispose } = await createEnvironment();
    const previousEnv = globalThis.__vanteloqEnv;
    try {
      const account = await createReportWorkspace(worker, environment, database, `journal-bank-race-${mode}`);
      const org = account.organizationId, now = Math.floor(Date.now() / 1000);
      await database.prepare("INSERT INTO tenant_addons(id,organization_id,addon_key,status,created_at,updated_at) VALUES (?,?,'bookloq','active',?,?)")
        .bind(crypto.randomUUID(), org, now, now).run();
      await expect(await dispatch(worker, environment, "/api/v1/bookloq/setup", { ...account.owner, method: "POST", body: { initialize: true, label: "October", startDate: "2026-10-01", endDate: "2026-10-31" } }), 201);
      const cash = await database.prepare("SELECT id FROM financial_accounts WHERE organization_id=? AND active=1 AND account_type='asset' AND normal_balance='debit' AND account_subtype IN ('cash','bank') ORDER BY code LIMIT 1").bind(org).first();
      const revenue = await database.prepare("SELECT id FROM financial_accounts WHERE organization_id=? AND system_key='sales_revenue'").bind(org).first();
      assert.ok(cash?.id && revenue?.id);
      const path = "/api/v1/bookloq/journals";
      const call = (method, body, key) => {
        if (mode === "built") return dispatch(worker, environment, path, { ...account.owner, method, body, idempotencyKey: key });
        globalThis.__vanteloqEnv = environment;
        const request = new Request(origin + path, { method, headers: { ...identityHeaders(account.owner.email, account.owner.name, true), "Idempotency-Key": key }, body: JSON.stringify(body) });
        return (method === "POST" ? POST : PATCH)(request);
      };
      const posted = await expect(await call("POST", { entryDate: "2026-10-04", memo: "Fictional deposit awaiting bank review", currency: "CAD", lines: [
        { accountId: cash.id, description: "Cash receipt", debitCents: 7000, creditCents: 0, locationRef: "all" },
        { accountId: revenue.id, description: "Service revenue", debitCents: 0, creditCents: 7000, locationRef: "all" },
      ] }, crypto.randomUUID()), 201);
      const transactionId = crypto.randomUUID();
      await database.prepare("INSERT INTO financial_transactions(id,organization_id,transaction_date,posting_date,description,amount_cents,currency,account_id,source_system,external_source_id,created_at,updated_at) VALUES (?,?,'2026-10-04','2026-10-04','Fictional reviewed deposit',7000,'CAD',?,'manual',?,?,?)")
        .bind(transactionId, org, cash.id, transactionId, now, now).run();
      const cashLine = await database.prepare("SELECT id FROM journal_lines WHERE organization_id=? AND journal_entry_id=? AND account_id=? AND debit_cents=7000").bind(org, posted.journal.id, cash.id).first();
      assert.ok(cashLine?.id);
      const ctx = () => ({ organizationId: org, actorUserId: account.userId, today: "2026-10-11", key: crypto.randomUUID(), requestId: crypto.randomUUID(), request: new Request(origin + path) });
      const statementSql = new WeakMap();
      const wrap = (statement, sql) => {
        const wrapped = new Proxy(statement, { get(target, key) {
          if (key === "bind") return (...args) => wrap(target.bind(...args), sql);
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        } });
        statementSql.set(wrapped, sql);
        return wrapped;
      };
      let raced = false;
      environment.DB = new Proxy(database, { get(target, key) {
        if (key === "prepare") return sql => wrap(target.prepare(sql), sql);
        if (key === "batch") return async statements => {
          if (!raced && statements.some(statement => /UPDATE journal_entries SET status = 'reversed'/.test(statementSql.get(statement) ?? ""))) {
            raced = true;
            await bankAccounting(database, { action: "match", transactionId, cashLineId: cashLine.id, reason: "Reviewed deposit committed during journal correction", reviewed: true }, ctx());
          }
          return target.batch(statements);
        };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      } });
      const reversalKey = crypto.randomUUID(), reversal = { entryId: posted.journal.id, reason: "Correct the original fictional deposit", reversalDate: "2026-10-04" };
      const conflict = await expect(await call("PATCH", reversal, reversalKey), 409);
      assert.equal(raced, true, "The bank match must commit after the route's initial checks");
      assert.equal(conflict.error.code, "BANK_CORRECTION_REQUIRED");
      assert.match(conflict.error.message, /Banking or Reconciliation/);
      assert.match(conflict.error.message, /reopen/i);
      assert.match(conflict.error.message, /release.*ledger match/i);
      assert.equal((await database.prepare("SELECT status FROM journal_entries WHERE id=?").bind(posted.journal.id).first()).status, "posted");
      assert.equal((await database.prepare("SELECT COUNT(*) count FROM journal_entries WHERE organization_id=? AND idempotency_key=?").bind(org, reversalKey).first()).count, 0, "Rejected correction must retain no reversal header");
      assert.equal((await database.prepare("SELECT COUNT(*) count FROM audit_events WHERE organization_id=? AND action='journal.reversed'").bind(org).first()).count, 0, "Rejected correction must retain no reversal audit");
      assert.equal((await database.prepare("SELECT journal_entry_id FROM financial_transactions WHERE id=?").bind(transactionId).first()).journal_entry_id, posted.journal.id);
      environment.DB = database;
      await bankAccounting(database, { action: "unmatch", transactionId, reason: "Release reviewed link before journal correction", reviewed: true }, ctx());
      assert.equal((await database.prepare("SELECT COUNT(*) count FROM audit_events WHERE organization_id=? AND action='bank_transaction.unmatch'").bind(org).first()).count, 1);
      const corrected = await expect(await call("PATCH", reversal, reversalKey), 201);
      assert.equal(corrected.journal.reversalOfEntryId, posted.journal.id);
      assert.equal((await database.prepare("SELECT status FROM journal_entries WHERE id=?").bind(posted.journal.id).first()).status, "reversed");
      assert.equal((await database.prepare("SELECT journal_entry_id FROM financial_transactions WHERE id=?").bind(transactionId).first()).journal_entry_id, null);
    } finally {
      globalThis.__vanteloqEnv = previousEnv;
      await dispose();
    }
  });
}
