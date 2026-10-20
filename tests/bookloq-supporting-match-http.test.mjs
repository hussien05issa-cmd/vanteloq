import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../app/api/v1/bookloq/actions/route.ts";
import { POST as setupPOST } from "../app/api/v1/bookloq/setup/route.ts";
import { POST as invoicePOST } from "../app/api/v1/bookloq/invoices/route.ts";
import { POST as accountingPOST } from "../app/api/v1/bookloq/invoices/accounting/route.ts";
import { posSqliteFixture } from "./helpers/pos-sqlite-fixture.ts";
import { dispatch, identityHeaders, origin, context } from "./helpers/retail-worker-fixture.mjs";

// Exercise actual source HTTP routes with the shared identity headers,
// migrated SQLite and atomic prepared/batch semantics. Native D1 regression
// coverage runs separately; this test does not rely on a previously built Worker.
async function createEnvironment() {
  const f = await posSqliteFixture(), previousEnv = globalThis.__vanteloqEnv, previousFetch = globalThis.fetch;
  const database = { ...f.database, batch: async items => {
    f.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const item of items) results.push(/^\s*(SELECT|WITH|EXPLAIN)\b/i.test(item.sql) || /\bRETURNING\b/i.test(item.sql) ? await item.all() : await item.run());
      f.sqlite.exec("COMMIT");
      return results;
    } catch (error) { f.sqlite.exec("ROLLBACK"); throw error; }
  } };
  const environment = { DB: database, SUPABASE_URL: "https://match-identity.example.invalid", SUPABASE_PUBLISHABLE_KEY: "fictional" };
  globalThis.__vanteloqEnv = environment;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    assert.equal(url.origin, environment.SUPABASE_URL, "Only fictional identity requests are permitted");
    if (url.pathname === "/rest/v1/team_access_invitations") return Response.json([]);
    assert.equal(url.pathname, "/auth/v1/user");
    const payload = JSON.parse(Buffer.from(request.headers.get("authorization").split(".")[1], "base64url").toString());
    return Response.json({ id: `test-user:${payload.email}`, email: payload.email, email_confirmed_at: "2026-01-01", user_metadata: {} });
  };
  const worker = { fetch: request => {
    const path = new URL(request.url).pathname;
    if (path === "/api/v1/bookloq/setup") return setupPOST(request);
    if (path === "/api/v1/bookloq/invoices") return invoicePOST(request);
    if (path === "/api/v1/bookloq/invoices/accounting") return accountingPOST(request);
    throw new Error(`Unimplemented fictional fixture route: ${path}`);
  } };
  return { worker, environment, database, dispose: async () => { globalThis.fetch = previousFetch; globalThis.__vanteloqEnv = previousEnv; f.close(); } };
}

async function createReportWorkspace(_worker, _environment, database) {
  const organizationId = crypto.randomUUID(), userId = crypto.randomUUID(), locationId = crypto.randomUUID();
  const owner = { email: `match-owner-${crypto.randomUUID()}@example.invalid`, name: "Fictional owner" };
  await database.batch([
    database.prepare("INSERT INTO users(id,email,display_name,created_at,updated_at) VALUES(?,?,?,1,1)").bind(userId, owner.email, owner.name),
    database.prepare("INSERT INTO workspaces(id,owner_name,business_name,legal_name,business_email,industry,city,address,postal_code,hours_json,timezone,currency,created_at,updated_at) VALUES(?,'QA','QA','QA',?,'Retail','Edmonton','Test','T5A1A1','[]','America/Edmonton','CAD',1,1)").bind(organizationId, owner.email),
    database.prepare("INSERT INTO tenant_subscriptions(organization_id,base_plan,billing_interval,status,created_at,updated_at) VALUES(?,'pro','month','active',1,1)").bind(organizationId),
    database.prepare("INSERT INTO memberships(id,user_id,organization_id,role,status,created_at,updated_at) VALUES(?,?,?,'owner','active',1,1)").bind(crypto.randomUUID(), userId, organizationId),
    database.prepare("INSERT INTO organization_locations(id,organization_id,name,country_code,address_line_1,locality,administrative_area,timezone,currency,created_at,updated_at) VALUES(?,?,'Main','CA','Test','Edmonton','AB','America/Edmonton','CAD',1,1)").bind(locationId, organizationId),
  ]);
  return { organizationId, userId, locationId, owner };
}

async function expect(response, status) {
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  return body;
}

test("supporting match HTTP requires every source and target permission, retaining posted invoice payment accounting on unlink", { timeout: 120000 }, async () => {
  const { worker, environment, database, dispose } = await createEnvironment();
  try {
    const workspace = await createReportWorkspace(worker, environment, database, "supporting-http");
    const org = workspace.organizationId, now = Math.floor(Date.now() / 1000);
    await database.prepare("INSERT INTO tenant_addons(id,organization_id,addon_key,status,created_at,updated_at) VALUES(?,?,'bookloq','active',?,?)")
      .bind(crypto.randomUUID(), org, now, now).run();
    await expect(await dispatch(worker, environment, "/api/v1/bookloq/setup", { ...workspace.owner, method: "POST", body: { initialize: true, label: "Supporting evidence", startDate: "2026-10-01", endDate: "2026-10-31" } }), 201);
    const accounts = (await database.prepare("SELECT id,system_key systemKey FROM financial_accounts WHERE organization_id=?").bind(org).all()).results;
    const cash = accounts.find(row => row.systemKey === "operating_cash").id;
    const objects = new Map();
    environment.BUCKET = { put: async (key, bytes, options) => { objects.set(key, { bytes, ...options }); return { key, etag: "fixture" }; }, get: async key => { const item = objects.get(key); return item ? { body: new Uint8Array(item.bytes), customMetadata: item.customMetadata } : null; }, delete: async key => objects.delete(key) };
    const form = new FormData();
    form.set("invoice", JSON.stringify({ invoiceNumber: "SUPPORT-1", invoiceDate: "2026-10-04", dueDate: "2026-10-31", currency: "CAD", issuer: { name: "Fictional operator", address: "1 Test Street" }, customer: { name: "Fictional customer", address: "2 Test Street" }, lines: [{ description: "Delivered services", quantityMilli: 1000, unitPriceCents: 10000, taxRateBasisPoints: 0 }] }));
    const headers = identityHeaders(workspace.owner.email, workspace.owner.name, true);
    delete headers["content-type"];
    const { invoice } = await expect(await worker.fetch(new Request(origin + "/api/v1/bookloq/invoices", { method: "POST", headers, body: form }), environment, context), 201);
    const tx = crypto.randomUUID(), receiptTx = crypto.randomUUID(), billTx = crypto.randomUUID(), receipt = crypto.randomUUID(), supplier = crypto.randomUUID(), bill = crypto.randomUUID();
    await database.batch([
      ...[[tx, 10000], [receiptTx, -3000], [billTx, -5000]].map(([id, amount]) => database.prepare("INSERT INTO financial_transactions(id,organization_id,transaction_date,posting_date,description,amount_cents,currency,account_id,source_system,external_source_id,created_at,updated_at) VALUES(?,?,'2026-10-04','2026-10-04','Fictional bank movement',?,'CAD',?,'manual',?,?,?)").bind(id, org, amount, cash, id, now, now)),
      database.prepare("INSERT INTO workspace_documents(id,organization_id,document_type,file_name,object_key,content_type,size_bytes,sha256_hex,security_state,scan_status,status,uploaded_by_user_id,created_at,updated_at) VALUES(?,?,'receipt','fictional.pdf',?,'application/pdf',10,?,'clean','clean','approved',?,?,?)").bind(receipt, org, receipt, receipt, workspace.userId, now, now),
      database.prepare("INSERT INTO bookloq_contacts(id,organization_id,contact_type,name,created_at,updated_at) VALUES(?,?,'supplier','Fictional supplier',?,?)").bind(supplier, org, now, now),
      database.prepare("INSERT INTO supplier_bills(id,organization_id,supplier_id,bill_number,invoice_date,due_date,status,subtotal_cents,total_cents,currency,created_at,updated_at) VALUES(?,?,?,'SUPPORT-BILL','2026-10-04','2026-10-31','approved',5000,5000,'CAD',?,?)").bind(bill, org, supplier, now, now),
    ]);
    const accounting = async body => expect(await dispatch(worker, environment, "/api/v1/bookloq/invoices/accounting", { ...workspace.owner, method: "POST", body, idempotencyKey: crypto.randomUUID() }), 201);
    await accounting({ type: "issue", invoiceId: invoice.id, date: "2026-10-04", revenueAccountId: accounts.find(row => row.systemKey === "sales_revenue").id, reviewed: true });
    const paid = await accounting({ type: "payment", invoiceId: invoice.id, date: "2026-10-04", cashAccountId: cash, amountCents: 10000, transactionId: tx, reference: "Retained bank receipt", reviewed: true });
    const reader = { email: `match-reviewer-${crypto.randomUUID()}@example.invalid`, name: "Supporting reviewer" }, user = crypto.randomUUID(), role = crypto.randomUUID();
    const all = ["finance.statements", "finance.reconcile", "finance.bank_transactions", "payroll.totals", "finance.ap_ar", "documents.view"];
    await database.batch([
      database.prepare("INSERT INTO users(id,email,display_name,status,created_at,updated_at) VALUES(?,?,?,'active',?,?)").bind(user, reader.email, reader.name, now, now),
      database.prepare("INSERT INTO memberships(id,user_id,organization_id,role,status,created_at,updated_at) VALUES(?,?,?,'admin','active',?,?)").bind(crypto.randomUUID(), user, org, now, now),
      database.prepare("INSERT INTO access_roles(id,organization_id,name,description,color,permissions_json,location_scope_json,archived,created_by_user_id,created_at,updated_at) VALUES(?,?,'Supporting reviewer','','#245fce',?,'[]',0,?,?,?)").bind(role, org, JSON.stringify(all), workspace.userId, now, now),
      database.prepare("INSERT INTO team_members(id,organization_id,user_id,role_id,first_name,last_name,email,employee_code,primary_location_id,permitted_locations_json,status,remote_login,created_by_user_id,created_at,updated_at) VALUES(?,?,?,?,'Supporting','Reviewer',?,'SUPPORT-REVIEW',?,?,'active',1,?,?,?)").bind(crypto.randomUUID(), org, user, role, reader.email, workspace.locationId, JSON.stringify([workspace.locationId]), workspace.userId, now, now),
    ]);
    globalThis.__vanteloqEnv = environment;
    const post = (identity, body) => POST(new Request(origin + "/api/v1/bookloq/actions", { method: "POST", headers: identityHeaders(identity.email, identity.name, true), body: JSON.stringify(body) }));
    const grants = permissions => database.prepare("UPDATE access_roles SET permissions_json=? WHERE id=? AND organization_id=?").bind(JSON.stringify(permissions), role, org).run();
    const retained = async () => ({
      journal: await database.prepare("SELECT * FROM journal_entries WHERE id=? AND organization_id=?").bind(paid.event.journalEntryId, org).first(),
      lines: (await database.prepare("SELECT * FROM journal_lines WHERE journal_entry_id=? AND organization_id=? ORDER BY id").bind(paid.event.journalEntryId, org).all()).results,
      event: await database.prepare("SELECT * FROM invoice_accounting_events WHERE id=? AND organization_id=?").bind(paid.event.id, org).first(),
      invoice: await database.prepare("SELECT paid_cents,journal_entry_id,status FROM customer_invoices WHERE id=? AND organization_id=?").bind(invoice.id, org).first(),
      transaction: await database.prepare("SELECT journal_entry_id,amount_cents,source_system,external_source_id FROM financial_transactions WHERE id=? AND organization_id=?").bind(tx, org).first(),
    });
    const baseline = await retained();
    assert.equal(baseline.invoice.paid_cents, 10000);
    assert.equal(baseline.journal.status, "posted");
    assert.equal(baseline.transaction.journal_entry_id, paid.event.journalEntryId);
    for (const [targetType, transactionId, targetId, permission] of [["customer_invoice", tx, invoice.id, "finance.ap_ar"], ["supplier_bill", billTx, bill, "finance.ap_ar"], ["receipt", receiptTx, receipt, "documents.view"]]) {
      const match = { type: "match_transaction", transactionId, targetId, targetType, note: "Fictional evidence review" };
      const initial = await expect(await post(workspace.owner, match), 200);
      const unmatch = { type: "unmatch_transaction", transactionId, targetId: initial.matchId, reason: "Wrong supporting record" };
      for (const missing of ["finance.reconcile", "finance.bank_transactions", "payroll.totals", permission]) {
        await grants(all.filter(value => value !== missing));
        assert.equal((await expect(await post(reader, match), 403)).error.code, "INSUFFICIENT_PERMISSION", `${targetType}: missing ${missing} must deny match`);
        assert.equal((await expect(await post(reader, unmatch), 403)).error.code, "INSUFFICIENT_PERMISSION", `${targetType}: missing ${missing} must deny unmatch`);
        assert.equal((await database.prepare("SELECT status FROM bookloq_transaction_matches WHERE id=? AND organization_id=?").bind(initial.matchId, org).first()).status, "confirmed");
      }
      await grants(all);
      await expect(await post(reader, match), 200);
      assert.equal((await expect(await post(reader, unmatch), 200)).replayed, false);
      assert.equal((await expect(await post(reader, unmatch), 200)).replayed, true);
      assert.equal((await database.prepare("SELECT status FROM bookloq_transaction_matches WHERE id=? AND organization_id=?").bind(initial.matchId, org).first()).status, "rejected");
      assert.deepEqual(await retained(), baseline, "Unlinking supporting evidence must not reverse posted journals or payments");
    }
    const audits = (await database.prepare("SELECT details_json FROM audit_events WHERE organization_id=? AND action='financial_transaction.supporting_record_unmatched'").bind(org).all()).results;
    assert.equal(audits.length, 3);
    assert.ok(audits.every(row => JSON.parse(row.details_json).ledgerUnchanged === true));
  } finally {
    await dispose();
  }
});
