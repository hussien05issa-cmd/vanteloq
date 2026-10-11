import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../app/api/v1/bookloq/collections/route.ts";
import { posSqliteFixture } from "./helpers/pos-sqlite-fixture.ts";
import { businessClock } from "../domain/intraday-sales.ts";

// Actual HTTP source route, migrated SQLite and isolated fictional identity.
// This does not import an old built Worker or connect to production.
async function fixture() {
  const store = await posSqliteFixture(), previousEnv = globalThis.__vanteloqEnv, previousFetch = globalThis.fetch;
  const database = store.database, email = "decision-reader@example.invalid", origin = "https://vanteloq.example";
  globalThis.__vanteloqEnv = { DB: database, SUPABASE_URL: "https://decision-auth.example.invalid", SUPABASE_PUBLISHABLE_KEY: "fictional" };
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    assert.equal(url.origin, "https://decision-auth.example.invalid", "External network is not permitted by this fixture");
    if (url.pathname === "/rest/v1/team_access_invitations") return Response.json([]);
    assert.equal(url.pathname, "/auth/v1/user");
    return Response.json({ id: "decision-reader-subject", email, email_confirmed_at: "2026-01-01T00:00:00Z", user_metadata: {} });
  };
  await database.prepare("INSERT INTO users(id,email,display_name,created_at,updated_at) VALUES('actor',?,'Fictional reader',1,1)").bind(email).run();
  for (const org of ["decision-org", "foreign-org"]) {
    await database.prepare("INSERT INTO workspaces(id,owner_name,business_name,legal_name,business_email,industry,city,address,postal_code,hours_json,timezone,currency,created_at,updated_at) VALUES(?,'QA','QA','QA',?,'Retail','Edmonton','Test','T5A1A1','[]','America/Edmonton','CAD',1,1)").bind(org, email).run();
    await database.prepare("INSERT INTO tenant_subscriptions(organization_id,base_plan,billing_interval,status,created_at,updated_at) VALUES(?,'pro','month','active',1,1)").bind(org).run();
    await database.prepare("INSERT INTO tenant_addons(id,organization_id,addon_key,status,created_at,updated_at) VALUES(?,?,'bookloq','active',1,1)").bind(`addon-${org}`, org).run();
    await database.prepare("INSERT INTO bookloq_contacts(id,organization_id,contact_type,name,email,created_at,updated_at) VALUES(?,?,'both',?, ?,1,1)").bind(`contact-${org}`, org, org === "decision-org" ? "Private customer" : "Foreign private customer", `${org}@example.invalid`).run();
  }
  await database.batch([
    database.prepare("INSERT INTO memberships(id,user_id,organization_id,role,status,created_at,updated_at) VALUES('member','actor','decision-org','admin','active',1,1)"),
    database.prepare("INSERT INTO organization_locations(id,organization_id,name,country_code,address_line_1,locality,administrative_area,timezone,currency,created_at,updated_at) VALUES('main','decision-org','Main','CA','Test','Edmonton','AB','America/Edmonton','CAD',1,1)"),
    database.prepare("INSERT INTO access_roles(id,organization_id,name,description,color,permissions_json,location_scope_json,archived,created_by_user_id,created_at,updated_at) VALUES('role','decision-org','Review','','#2255cc','[\"finance.statements\",\"finance.ap_ar\"]','[]',0,'actor',1,1)"),
    database.prepare("INSERT INTO team_members(id,organization_id,user_id,role_id,first_name,last_name,email,employee_code,permitted_locations_json,status,remote_login,created_by_user_id,created_at,updated_at) VALUES('team','decision-org','actor','role','Read','Only',?,'REVIEW','[\"main\"]','active',1,'actor',1,1)").bind(email),
  ]);
  const today = businessClock(new Date(), "America/Edmonton").date;
  const shift = days => new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const invoice = (id, total, dueDate = shift(-1), org = "decision-org") => database.prepare("INSERT INTO customer_invoices(id,organization_id,customer_id,invoice_number,invoice_date,due_date,status,subtotal_cents,total_cents,paid_cents,currency,created_at,updated_at) VALUES(?,?,?,?,?,?,'sent',?,?,0,'CAD',1,1)").bind(id, org, `contact-${org}`, `INV-${id}`, shift(-10), dueDate, total, total).run();
  const bill = (id, total, dueDate = shift(6)) => database.prepare("INSERT INTO supplier_bills(id,organization_id,supplier_id,bill_number,invoice_date,due_date,status,subtotal_cents,total_cents,paid_cents,currency,approval_status,created_at,updated_at) VALUES(?,'decision-org','contact-decision-org',?,?,?,'approved',?,?,0,'CAD','approved',1,1)").bind(id, `B-${id}`, shift(-10), dueDate, total, total).run();
  const permissions = values => database.prepare("UPDATE access_roles SET permissions_json=? WHERE id='role'").bind(JSON.stringify(values)).run();
  const token = Buffer.from(JSON.stringify({ email, aal: "aal2", session_id: "decision-session" })).toString("base64url");
  const read = (query = "", authenticated = true) => GET(new Request(`${origin}/api/v1/bookloq/collections${query}`, { headers: authenticated ? { authorization: `Bearer test.${token}.signature` } : {} }));
  const expect = async (response, status = 200) => { const body = await response.json(); assert.equal(response.status, status, JSON.stringify(body)); return body; };
  const dispose = () => { globalThis.__vanteloqEnv = previousEnv; globalThis.fetch = previousFetch; store.close(); };
  return { database, today, shift, invoice, bill, permissions, read, expect, dispose };
}

test("collections HTTP cards use all current tenant rows, independently of search and paging, with complete source identities", { timeout: 120000 }, async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 31; i++) await f.invoice(`own-${i}`, 1_000 + i);
    await f.invoice("current", 100_000, f.today);
    await f.invoice("foreign", 999_999, f.shift(-1), "foreign-org");
    await f.bill("within", 7_000, f.shift(6));
    await f.bill("outside", 8_000, f.shift(7));
    const first = await f.expect(await f.read("?page=0")), last = await f.expect(await f.read("?page=1&q=own-3&horizon=90"));
    const invoice = first.decisionCards.find(card => card.kind === "overdue_invoices"), bill = first.decisionCards.find(card => card.kind === "bills_due");
    assert.equal(first.records.length, 25);
    assert.equal(invoice.status, "recorded");
    assert.equal(invoice.value.amount, 31_465);
    assert.equal(bill.value.amount, 7_000);
    assert.equal(invoice.evidence.sources[0].recordCount, 31);
    assert.ok(invoice.evidence.sources[0].recordIds.every(id => id.startsWith("own-")));
    assert.deepEqual(bill.evidence.sources[0].recordIds, ["within"]);
    assert.deepEqual(last.decisionCards, first.decisionCards);
    assert.doesNotMatch(JSON.stringify(first), /Foreign private|999999|foreign-org|Private customer/);
    assert.ok(first.records.every(record => record.contactName === "Customer"));
    await f.expect(await f.read("?workspace=foreign-org"), 403);
  } finally { f.dispose(); }
});

test("collections HTTP verified empty scope produces recorded zeros with no fabricated references", { timeout: 120000 }, async () => {
  const f = await fixture();
  try {
    const body = await f.expect(await f.read());
    assert.equal(body.records.length, 0);
    for (const card of body.decisionCards) {
      assert.equal(card.status, "recorded");
      assert.equal(card.value.amount, 0);
      assert.equal(card.evidence.sources[0].recordCount, 0);
      assert.deepEqual(card.evidence.sources[0].recordIds, []);
    }
  } finally { f.dispose(); }
});

test("collections HTTP requires authentication, statement and AP/AR permissions plus organization scope", { timeout: 120000 }, async () => {
  const f = await fixture();
  try {
    await f.invoice("private", 42_000);
    await f.expect(await f.read("", false), 401);
    await f.permissions(["finance.statements"]);
    const deniedAR = await f.expect(await f.read(), 403);
    assert.equal(deniedAR.error.code, "COLLECTIONS_ACCESS_REQUIRED");
    assert.doesNotMatch(JSON.stringify(deniedAR), /INV-private|42000|decisionCards/);
    await f.permissions(["finance.ap_ar"]);
    await f.expect(await f.read(), 403);
    await f.permissions(["finance.statements", "finance.ap_ar"]);
    await f.expect(await f.read());
    await f.database.prepare("INSERT INTO organization_locations(id,organization_id,name,country_code,address_line_1,locality,administrative_area,timezone,currency,created_at,updated_at) VALUES('restricted','decision-org','Restricted','CA','Test','Edmonton','AB','America/Edmonton','CAD',1,1)").run();
    const locationDenied = await f.expect(await f.read(), 403);
    assert.equal(locationDenied.error.code, "BOOKLOQ_ORGANIZATION_SCOPE_REQUIRED");
    assert.doesNotMatch(JSON.stringify(locationDenied), /INV-private|42000|decisionCards/);
  } finally { f.dispose(); }
});
