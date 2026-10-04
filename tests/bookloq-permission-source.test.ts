import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { Miniflare } from "miniflare";
import { registerSupabaseTestServer } from "./helpers/supabase-loopback-transport.mjs";
import { GET } from "../app/api/v1/bookloq/route.ts";
import type { VanteloqRuntimeEnv } from "../db/index.ts";

test("BookLoQ API enforces identity/target permissions and replacement Plaid source isolation", { timeout: 120000 }, async t => {
  const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('isolated')}}", d1Databases: { DB: crypto.randomUUID() } });
  const auth = createServer((_request, response) => { response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ id: "visibility-subject", email: "visibility@example.invalid", email_confirmed_at: "2026-01-01T00:00:00Z", user_metadata: {} })); });
  const runtime = globalThis as typeof globalThis & { __vanteloqEnv?: VanteloqRuntimeEnv };
  const previous = runtime.__vanteloqEnv;
  await new Promise<void>(resolve => auth.listen(0, "127.0.0.1", resolve));
  try {
    const address = auth.address(); assert.ok(address && typeof address !== "string");
    const db = await mf.getD1Database("DB") as unknown as D1Database;
    for (const file of (await readdir(new URL("../drizzle/", import.meta.url))).filter(file => /^\d{4}.*\.sql$/.test(file)).sort()) {
      for (const sql of (await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8")).split("--> statement-breakpoint").map(text => text.trim()).filter(Boolean)) await db.prepare(sql).run();
    }
    runtime.__vanteloqEnv = { DB: db, SUPABASE_URL: registerSupabaseTestServer(address.port), SUPABASE_PUBLISHABLE_KEY: "fixture" };
    const now = Date.now();
    await db.prepare("INSERT INTO users(id,email,display_name,created_at,updated_at) VALUES('actor','visibility@example.invalid','Reader',?,?)").bind(now, now).run();
    for (const org of ["org", "other"]) await db.prepare("INSERT INTO workspaces(id,owner_name,business_name,legal_name,business_email,industry,city,address,postal_code,hours_json,created_at,updated_at) VALUES(?,'Test','Workspace','Workspace','workspace@example.invalid','Retail','Edmonton','Test','T5A1A1','[]',?,?)").bind(org, now, now).run();
    await db.batch([
      db.prepare("INSERT INTO memberships(id,user_id,organization_id,role,status,created_at,updated_at) VALUES('member','actor','org','admin','active',?,?)").bind(now, now),
      db.prepare("INSERT INTO tenant_subscriptions(organization_id,base_plan,billing_interval,status,cancel_at_period_end,version,created_at,updated_at) VALUES('org','pro','month','active',0,1,?,?)").bind(now, now),
      db.prepare("INSERT INTO tenant_addons(id,organization_id,addon_key,status,created_at,updated_at) VALUES('addon','org','bookloq','active',?,?)").bind(now, now),
      db.prepare("INSERT INTO organization_locations(id,organization_id,name,country_code,address_line_1,locality,administrative_area,timezone,currency,created_at,updated_at) VALUES('location','org','Primary','CA','Test','Edmonton','AB','America/Edmonton','CAD',?,?)").bind(now, now),
      db.prepare("INSERT INTO access_roles(id,organization_id,name,description,color,permissions_json,location_scope_json,archived,created_by_user_id,created_at,updated_at) VALUES('role','org','Financial reader','','#2255cc','[]','[]',0,'actor',?,?)").bind(now, now),
      db.prepare("INSERT INTO team_members(id,organization_id,user_id,role_id,first_name,last_name,email,employee_code,permitted_locations_json,status,remote_login,created_by_user_id,created_at,updated_at) VALUES('team','org','actor','role','Read','Only','visibility@example.invalid','VIEW','[\"location\"]','active',1,'actor',?,?)").bind(now, now),
      db.prepare("INSERT INTO bookloq_contacts(id,organization_id,contact_type,name,email,created_at,updated_at) VALUES('contact','org','both','Private Person','private@example.invalid',1,1)"),
      db.prepare("INSERT INTO customer_invoices(id,organization_id,customer_id,invoice_number,invoice_date,due_date,status,subtotal_cents,total_cents,emailed_to,created_at,updated_at) VALUES('invoice','org','contact','INV-SECRET','2026-10-01','2026-10-31','sent',42000,42000,'recipient@example.invalid',1,1)"),
      db.prepare("INSERT INTO supplier_bills(id,organization_id,supplier_id,bill_number,invoice_date,due_date,status,subtotal_cents,total_cents,created_at,updated_at) VALUES('bill','org','contact','BILL-SECRET','2026-10-01','2026-10-31','received',12000,12000,1,1)"),
      db.prepare("INSERT INTO workspace_documents(id,organization_id,document_type,file_name,object_key,content_type,size_bytes,sha256_hex,security_state,status,scan_status,extraction_status,uploaded_by_user_id,created_at,updated_at) VALUES('doc-secret','org','receipt','Private Person receipt.pdf','test','application/pdf',100,'test','clean','approved','clean','complete','actor',1,1)"),
    ]);
    const transaction = (id: string, source = "manual", account: string | null = null) => db.prepare("INSERT INTO financial_transactions(id,organization_id,transaction_date,posting_date,description,original_description,amount_cents,account_id,contact_id,source_system,external_source_id,created_at,updated_at) VALUES(?,'org','2026-10-04','2026-10-04','Payment from Private Person','private@example.invalid',42000,?,'contact',?,?,1,1)").bind(id, account, source, id).run();
    await transaction("manual"); await transaction("receipt");
    const addMatch = (id: string, transactionId: string, invoice: string | null, document: string | null) => db.prepare("INSERT INTO bookloq_transaction_matches(id,organization_id,transaction_id,customer_invoice_id,document_id,status,method,confidence_basis_points,matched_amount_cents,reasons_json,note,matched_by_user_id,created_at,updated_at) VALUES(?,'org',?,?,?,'confirmed','manual',10000,42000,'[\"Private Person confirmed\"]','Call Private Person','actor',1,1)").bind(id, transactionId, invoice, document).run();
    await addMatch("invoice-match", "manual", "invoice", null); await addMatch("receipt-match", "receipt", null, "doc-secret");
    const base = ["finance.statements", "finance.bank_transactions", "payroll.totals"];
    const permissions = (extra: string[]) => db.prepare("UPDATE access_roles SET permissions_json=? WHERE id='role'").bind(JSON.stringify([...base, ...extra])).run();
    const payload = Buffer.from(JSON.stringify({ email: "visibility@example.invalid", aal: "aal2", session_id: "visibility-session" })).toString("base64url");
    const read = async () => { const response = await GET(new Request("https://vanteloq.example/api/v1/bookloq", { headers: { authorization: `Bearer test.${payload}.signature` } })); assert.equal(response.status, 200, await response.clone().text()); return (await response.json()).bookloq; };

    await t.test("identity denial sanitizes the actual API response and preserves financial amounts", async () => {
      await permissions(["finance.ap_ar"]);
      const result = await read();
      assert.equal(result.transactions.length, 2); assert.equal(result.invoices[0].totalCents, 42000);
      assert.equal(result.invoices[0].customerName, "Customer"); assert.equal(result.bills[0].supplierName, "Supplier");
      assert.deepEqual(result.contacts, []);
      assert.doesNotMatch(JSON.stringify(result), /Private Person|private@example|recipient@example/);
    });

    await t.test("bank access does not reveal restricted invoice or document targets through matches", async () => {
      await permissions(["customers.identity"]);
      const result = await read();
      assert.equal(result.transactions[0].contactName, "Private Person");
      assert.deepEqual(result.invoices, []); assert.deepEqual(result.bills, []); assert.deepEqual(result.documents, []);
      assert.equal(result.transactionMatches.length, 2);
      for (const match of result.transactionMatches) { assert.equal(match.customerInvoiceId, null); assert.equal(match.documentId, null); assert.equal(match.targetLabel, "Restricted supporting record"); assert.equal(match.note, ""); assert.equal(match.reasonsJson, "[]"); }
      assert.doesNotMatch(JSON.stringify(result.transactionMatches), /INV-SECRET|doc-secret|receipt\.pdf|Call Private Person/);
      await permissions(["customers.identity", "finance.ap_ar", "documents.view"]);
      const complete = await read();
      assert.equal(complete.invoices[0].customerEmail, "private@example.invalid");
      assert.equal(complete.transactionMatches.find((match: { id: string }) => match.id === "receipt-match").documentId, "doc-secret");
    });

    await t.test("an approved replacement Item does not promote retained transactions or matches", async () => {
      for (const [id, org] of [["a", "org"], ["b", "org"], ["foreign", "other"]]) {
        await db.prepare("INSERT INTO financial_accounts(id,organization_id,code,name,account_type,account_subtype,normal_balance,created_at,updated_at) VALUES(?,?,?,'Bank','asset','bank','debit',1,1)").bind(`account-${id}`, org, id).run();
        await db.prepare("INSERT INTO bank_accounts(id,organization_id,financial_account_id,name,account_type,institution_name,masked_number,provider,external_account_ref,external_item_ref,connection_status,created_at,updated_at) VALUES(?,?,?,'Bank','chequing','Fixture Bank','1234','plaid',?,?,'healthy',1,1)").bind(`bank-${id}`, org, `account-${id}`, `external-${id}`, `item-${id}`).run();
      }
      await db.prepare("INSERT INTO integration_connections(id,organization_id,provider,source_namespace,status,external_account_ref,data_promotion_status,created_at,updated_at) VALUES('connection','org','plaid','legacy','connected','item-a','approved',1,1)").run();
      await transaction("plaid-a", "plaid", "account-a"); await transaction("plaid-b", "plaid", "account-b");
      await transaction("plaid-foreign", "plaid", "account-foreign");
      await addMatch("retained-match", "plaid-a", "invoice", null);
      const ids = async () => (await read()).transactions.filter((row: { sourceSystem: string }) => row.sourceSystem === "plaid").map((row: { id: string }) => row.id).sort();
      assert.deepEqual(await ids(), ["plaid-a"]);
      await db.batch([
        db.prepare("UPDATE bank_accounts SET external_item_ref=NULL,connection_status='error' WHERE id='bank-a'"),
        db.prepare("UPDATE integration_connections SET external_account_ref='item-b' WHERE id='connection'"),
      ]);
      assert.deepEqual(await ids(), ["plaid-b"]);
      assert.ok(!(await read()).transactionMatches.some((row: { id: string }) => row.id === "retained-match"));
      assert.equal((await db.prepare("SELECT COUNT(*) n FROM financial_transactions WHERE id='plaid-a'").first())?.n, 1);
      assert.equal((await db.prepare("SELECT COUNT(*) n FROM bookloq_transaction_matches WHERE id='retained-match'").first())?.n, 1);
      await db.prepare("UPDATE integration_connections SET data_promotion_status='staging' WHERE id='connection'").run();
      assert.deepEqual(await ids(), []);
      await db.prepare("UPDATE integration_connections SET data_promotion_status='approved',sync_lease_owner='worker',sync_lease_expires_at=? WHERE id='connection'").bind(Math.floor(Date.now()/1000)+3600).run();
      assert.deepEqual(await ids(), []);
      await db.prepare("UPDATE integration_connections SET sync_lease_owner=NULL WHERE id='connection'").run();
      assert.deepEqual(await ids(), ["plaid-b"]);
    });
  } finally {
    runtime.__vanteloqEnv = previous;
    await mf.dispose(); auth.closeAllConnections();
    await new Promise<void>((resolve, reject) => auth.close(error => error ? reject(error) : resolve()));
  }
});
