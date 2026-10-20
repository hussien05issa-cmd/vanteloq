import assert from "node:assert/strict";
import test from "node:test";
import { BOOKLOQ_CLOSE_CONTROLS, BOOKLOQ_STARTING_ACCOUNTS } from "../domain/bookloq-setup.ts";
import { createEnvironment, createReportWorkspace, dispatch, identityHeaders, onboardingBody, origin, context } from "./helpers/retail-worker-fixture.mjs";

const path = "/api/v1/bookloq/setup";
const firstPeriod = { initialize: true, label: "October 2026", startDate: "2026-10-01", endDate: "2026-10-31" };
const nextPeriod = { initialize: false, label: "November 2026", startDate: "2026-11-01", endDate: "2026-11-30" };

async function grantAddon(database, organizationId) {
  const now = Math.floor(Date.now() / 1000);
  await database.prepare("INSERT INTO tenant_addons(id,organization_id,addon_key,status,created_at,updated_at) VALUES(?,?,'bookloq','active',?,?)")
    .bind(crypto.randomUUID(), organizationId, now, now).run();
}

async function count(database, table, organizationId) {
  return (await database.prepare(`SELECT COUNT(*) n FROM ${table} WHERE organization_id=?`).bind(organizationId).first()).n;
}

async function expectResponse(response, status) {
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  return body;
}

test("built BookLoQ setup enforces entitlements, retries, tenant scope and period permission", { timeout: 120000 }, async () => {
  const { worker, environment, database, dispose } = await createEnvironment();
  try {
    // Onboarding alone grants no paid BookLoQ entitlement.
    const unpaidOwner = { email: `setup-unpaid-${crypto.randomUUID()}@example.invalid`, name: "Unpaid Setup Owner" };
    await expectResponse(await dispatch(worker, environment, "/api/v1/onboarding", { ...unpaidOwner, method: "POST", body: onboardingBody(unpaidOwner.name, "Unpaid BookLoQ Setup") }), 201);
    const unpaid = await database.prepare("SELECT m.organization_id organizationId FROM memberships m JOIN users u ON u.id=m.user_id WHERE u.email=?").bind(unpaidOwner.email).first();
    const denied = await dispatch(worker, environment, path, { ...unpaidOwner, method: "POST", body: firstPeriod });
    assert.ok([402, 403].includes(denied.status), await denied.clone().text());
    assert.ok(["SUBSCRIPTION_REQUIRED", "ADDON_NOT_INCLUDED", "FEATURE_NOT_INCLUDED"].includes((await denied.json()).error.code));
    assert.equal(await count(database, "financial_accounts", unpaid.organizationId), 0);
    assert.equal(await count(database, "accounting_periods", unpaid.organizationId), 0);

    const owner = await createReportWorkspace(worker, environment, database, "setup-owner");
    const other = await createReportWorkspace(worker, environment, database, "setup-other");
    // A paid base subscription also does not substitute for BookLoQ access.
    const withoutAddon = await expectResponse(await dispatch(worker, environment, path, { ...owner.owner, method: "POST", body: firstPeriod }), 403);
    assert.equal(withoutAddon.error.code, "ADDON_NOT_INCLUDED");
    await grantAddon(database, owner.organizationId);
    await grantAddon(database, other.organizationId);

    const created = await expectResponse(await dispatch(worker, environment, path, { ...owner.owner, method: "POST", body: firstPeriod }), 201);
    assert.equal(created.replayed, false);
    assert.equal(created.postedToLedger, false);
    assert.equal(created.period.id, `blq:${owner.organizationId}:period:2026-10-01:2026-10-31`);
    const retry = await expectResponse(await dispatch(worker, environment, path, { ...owner.owner, method: "POST", body: firstPeriod }), 200);
    assert.equal(retry.replayed, true);
    assert.deepEqual(retry.period, created.period);
    assert.equal(await count(database, "financial_accounts", owner.organizationId), BOOKLOQ_STARTING_ACCOUNTS.length);
    assert.equal(await count(database, "month_end_items", owner.organizationId), BOOKLOQ_CLOSE_CONTROLS.length);
    assert.equal(await count(database, "accounting_periods", owner.organizationId), 1);
    assert.equal((await database.prepare("SELECT COUNT(*) n FROM audit_events WHERE organization_id=? AND action='bookloq.initialized' AND outcome='success'").bind(owner.organizationId).first()).n, 1);
    for (const table of ["journal_entries", "journal_lines", "financial_transactions", "customer_invoices", "supplier_bills"]) assert.equal(await count(database, table, owner.organizationId), 0, table);
    assert.deepEqual(await database.prepare("SELECT base_currency currency,country_code country,province_code province,fiscal_year_start_month fiscalMonth,status,data_mode dataMode FROM bookloq_settings WHERE organization_id=?").bind(owner.organizationId).first(), { currency: "CAD", country: "CA", province: "AB", fiscalMonth: 1, status: "active", dataMode: "live" });

    // Tenant scope comes from identity. Supplying another organization cannot redirect setup.
    assert.equal(await count(database, "financial_accounts", other.organizationId), 0);
    const forged = await expectResponse(await dispatch(worker, environment, path, { ...owner.owner, method: "POST", body: { ...nextPeriod, organizationId: other.organizationId } }), 400);
    assert.equal(forged.error.code, "BOOKLOQ_SETUP_INPUT");
    assert.equal(await count(database, "accounting_periods", other.organizationId), 0);
    const separate = await expectResponse(await dispatch(worker, environment, path, { ...other.owner, method: "POST", body: firstPeriod }), 201);
    assert.notEqual(separate.period.id, created.period.id);
    assert.equal(await count(database, "accounting_periods", owner.organizationId), 1);
    assert.equal(await count(database, "financial_accounts", other.organizationId), BOOKLOQ_STARTING_ACCOUNTS.length);

    // The administrator can see the entire single-location organization and post
    // journals, but cannot create a period without the separate period permission.
    const admin = { email: `setup-admin-${crypto.randomUUID()}@example.invalid`, name: "Limited Setup Admin" };
    const userId = crypto.randomUUID(), roleId = crypto.randomUUID(), now = Math.floor(Date.now() / 1000);
    await database.batch([
      database.prepare("INSERT INTO users(id,email,display_name,status,created_at,updated_at) VALUES(?,?,?,'active',?,?)").bind(userId, admin.email, admin.name, now, now),
      database.prepare("INSERT INTO memberships(id,user_id,organization_id,role,status,created_at,updated_at) VALUES(?,?,?,'admin','active',?,?)").bind(crypto.randomUUID(), userId, owner.organizationId, now, now),
      database.prepare("INSERT INTO access_roles(id,organization_id,name,description,color,permissions_json,location_scope_json,archived,created_by_user_id,created_at,updated_at) VALUES(?,?,'Journal posting only','','#245fce',?,'[]',0,?,?,?)").bind(roleId, owner.organizationId, JSON.stringify(["finance.statements", "finance.journal_post"]), owner.userId, now, now),
      database.prepare("INSERT INTO team_members(id,organization_id,user_id,role_id,first_name,last_name,email,employee_code,primary_location_id,permitted_locations_json,status,remote_login,created_by_user_id,created_at,updated_at) VALUES(?,?,?,?,'Limited','Admin',?,'SETUP-ADMIN',?,?,'active',1,?,?,?)").bind(crypto.randomUUID(), owner.organizationId, userId, roleId, admin.email, owner.locationId, JSON.stringify([owner.locationId]), owner.userId, now, now),
    ]);
    const adminDenied = await expectResponse(await dispatch(worker, environment, path, { ...admin, method: "POST", body: nextPeriod }), 403);
    assert.equal(adminDenied.error.code, "INSUFFICIENT_PERMISSION");
    assert.equal(await count(database, "accounting_periods", owner.organizationId), 1);

    for (const variant of ["missing-origin", "foreign-origin", "cross-site"]) {
      const headers = identityHeaders(owner.owner.email, owner.owner.name, true);
      if (variant === "missing-origin") delete headers.origin;
      if (variant === "foreign-origin") headers.origin = "https://untrusted.example.invalid";
      if (variant === "cross-site") headers["sec-fetch-site"] = "cross-site";
      const rejected = await expectResponse(await worker.fetch(new Request(origin + path, { method: "POST", headers, body: JSON.stringify(nextPeriod) }), environment, context), 403);
      assert.equal(rejected.error.code, { "missing-origin": "ORIGIN_REQUIRED", "foreign-origin": "ORIGIN_MISMATCH", "cross-site": "CROSS_SITE_REQUEST" }[variant]);
    }
    assert.equal(await count(database, "accounting_periods", owner.organizationId), 1);
    assert.equal(await count(database, "journal_entries", owner.organizationId), 0);
  } finally { await dispose(); }
});

test("built BookLoQ initialization preserves bank-first records and the workspace fiscal month", { timeout: 120000 }, async () => {
  const { worker, environment, database, dispose } = await createEnvironment();
  try {
    const owner = await createReportWorkspace(worker, environment, database, "setup-bank-first");
    await grantAddon(database, owner.organizationId);
    const accountId = crypto.randomUUID(), bankId = crypto.randomUUID(), transactionId = crypto.randomUUID(), now = Math.floor(Date.now() / 1000);
    await database.batch([
      database.prepare("UPDATE workspaces SET fiscal_year_start='October' WHERE id=?").bind(owner.organizationId),
      database.prepare("INSERT INTO financial_accounts(id,organization_id,code,name,account_type,account_subtype,normal_balance,description,plain_language,created_at,updated_at) VALUES(?,?,'BS-fixture','Existing statement cash','asset','cash','debit','Original account','Original explanation',?,?)").bind(accountId, owner.organizationId, now, now),
      database.prepare("INSERT INTO bank_accounts(id,organization_id,financial_account_id,name,account_type,institution_name,masked_number,currency,provider,connection_status,created_at,updated_at) VALUES(?,?,?,'Existing statement account','chequing','Fictional Bank','0001','CAD','manual','manual',?,?)").bind(bankId, owner.organizationId, accountId, now, now),
      database.prepare("INSERT INTO financial_transactions(id,organization_id,transaction_date,posting_date,description,amount_cents,currency,account_id,source_system,external_source_id,created_at,updated_at) VALUES(?,?,'2026-09-30','2026-09-30','Previously reviewed bank movement',12345,'CAD',?,'bank_statement','setup-existing-transaction',?,?)").bind(transactionId, owner.organizationId, accountId, now, now),
    ]);
    const beforeAccount = await database.prepare("SELECT * FROM financial_accounts WHERE id=?").bind(accountId).first();
    const beforeBank = await database.prepare("SELECT * FROM bank_accounts WHERE id=?").bind(bankId).first();
    const beforeTransaction = await database.prepare("SELECT * FROM financial_transactions WHERE id=?").bind(transactionId).first();
    const created = await expectResponse(await dispatch(worker, environment, path, { ...owner.owner, method: "POST", body: firstPeriod }), 201);
    assert.equal(created.postedToLedger, false);
    assert.deepEqual(await database.prepare("SELECT * FROM financial_accounts WHERE id=?").bind(accountId).first(), beforeAccount);
    assert.deepEqual(await database.prepare("SELECT * FROM bank_accounts WHERE id=?").bind(bankId).first(), beforeBank);
    assert.deepEqual(await database.prepare("SELECT * FROM financial_transactions WHERE id=?").bind(transactionId).first(), beforeTransaction);
    assert.equal(await count(database, "financial_accounts", owner.organizationId), BOOKLOQ_STARTING_ACCOUNTS.length + 1);
    assert.equal(await count(database, "financial_transactions", owner.organizationId), 1);
    assert.equal(await count(database, "journal_entries", owner.organizationId), 0);
    assert.equal(await count(database, "journal_lines", owner.organizationId), 0);
    assert.deepEqual(await database.prepare("SELECT fiscal_year_start_month fiscalMonth,status,data_mode dataMode FROM bookloq_settings WHERE organization_id=?").bind(owner.organizationId).first(), { fiscalMonth: 10, status: "active", dataMode: "live" });
    const retry = await expectResponse(await dispatch(worker, environment, path, { ...owner.owner, method: "POST", body: firstPeriod }), 200);
    assert.equal(retry.replayed, true);
    assert.equal(await count(database, "financial_accounts", owner.organizationId), BOOKLOQ_STARTING_ACCOUNTS.length + 1);
  } finally { await dispose(); }
});
