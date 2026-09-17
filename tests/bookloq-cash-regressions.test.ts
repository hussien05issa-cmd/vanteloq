import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";
import { Miniflare } from "miniflare";
import { registerSupabaseTestServer } from "./helpers/supabase-loopback-transport.mjs";
import { buildThirteenWeekCashFlow } from "../domain/thirteen-week-cash-flow.ts";
import { businessClock } from "../domain/intraday-sales.ts";

const origin = "https://vanteloq.example";
const executionContext = { waitUntil() {}, passThroughOnException() {} };

function identityHeaders(email: string, write = false) {
  const payload = Buffer.from(JSON.stringify({
    email,
    aal: "aal2",
    session_id: `session:${email}`,
  })).toString("base64url");
  const headers: Record<string, string> = {
    accept: "application/json",
    authorization: `Bearer test.${payload}.signature`,
  };
  if (write) {
    headers["content-type"] = "application/json";
    headers.origin = origin;
    headers["sec-fetch-site"] = "same-origin";
  }
  return headers;
}

function onboardingBody(ownerName: string, businessName: string) {
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  return {
    ownerName,
    businessName,
    legalName: `${businessName} Ltd.`,
    businessEmail: `${businessName.toLowerCase().replace(/[^a-z]/g, "")}@example.invalid`,
    phone: "",
    website: "",
    industry: "Retail",
    country: "CA",
    province: "AB",
    city: "Edmonton",
    address: "1 Test Avenue",
    postalCode: "T5A 1A1",
    emailNotifications: true,
    timezone: "America/Edmonton",
    currency: "CAD",
    fiscalYearStart: "January",
    taxNumber: "",
    hours: days.map((day) => ({ day, open: "10:00", close: "21:00", closed: false })),
    sourceMode: "csv",
    selectedPos: "",
    legalAccepted: true,
    termsVersion: "2026-09-05",
    privacyPolicyVersion: "2026-09-10",
    legalNoticeVersion: "account-creation-v2",
  };
}

async function createEnvironment() {
  const authServer = createServer((request, response) => {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      id: `test-user:${payload.email}`,
      email: payload.email,
      email_confirmed_at: "2026-08-01T00:00:00.000Z",
      user_metadata: { full_name: payload.email },
    }));
  });
  await new Promise<void>((resolve) => authServer.listen(0, "127.0.0.1", resolve));
  const address = authServer.address();
  assert.ok(address && typeof address !== "string");

  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: `vanteloq-bookloq-cash-${crypto.randomUUID()}` },
  });
  const database = await miniflare.getD1Database("DB");
  const migrations = (await readdir(new URL("../drizzle/", import.meta.url)))
    .filter((file) => /^\d{4}.*\.sql$/.test(file))
    .sort();
  for (const migration of migrations) {
    const sql = await readFile(new URL(`../drizzle/${migration}`, import.meta.url), "utf8");
    for (const statement of sql.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
      await database.prepare(statement).run();
    }
  }

  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("bookloq-cash-regression", crypto.randomUUID());
  const worker = (await import(workerUrl.href)).default;
  const environment = {
    DB: database,
    BOOKLOQ_DEMO_ENABLED: "true",
    SUPABASE_URL: registerSupabaseTestServer(address.port),
    SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  };
  const dispose = async () => {
    try {
      await miniflare.dispose();
    } finally {
      authServer.closeAllConnections();
      await new Promise<void>((resolve, reject) => authServer.close((error) => error ? reject(error) : resolve()));
    }
  };
  return { worker, environment, database, dispose };
}

async function dispatch(
  worker: { fetch: (request: Request, environment: unknown, context: unknown) => Promise<Response> },
  environment: unknown,
  path: string,
  options: { method?: string; email: string; body?: unknown; idempotencyKey?: string },
) {
  const method = options.method ?? "GET";
  const headers = identityHeaders(options.email, method !== "GET");
  if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;
  return worker.fetch(new Request(`${origin}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  }), environment, executionContext);
}

async function grantBookLoQ(database: D1Database, organizationId: string) {
  const now = Date.now();
  await database.batch([
    database.prepare(`INSERT INTO tenant_subscriptions
      (organization_id, base_plan, billing_interval, status, cancel_at_period_end, version, created_at, updated_at)
      VALUES (?, 'pro', 'month', 'active', 0, 1, ?, ?)`).bind(organizationId, now, now),
    database.prepare(`INSERT INTO tenant_addons
      (id, organization_id, addon_key, status, created_at, updated_at)
      VALUES (?, ?, 'bookloq', 'active', ?, ?)`).bind(crypto.randomUUID(), organizationId, now, now),
  ]);
}

test("ledger authorization and period guards preserve legitimate accounting", async () => {
  const { worker, environment, database, dispose } = await createEnvironment();
  try {
    const email = `release-${crypto.randomUUID()}@example.invalid`;
    const created = await dispatch(worker, environment, "/api/v1/onboarding", { method: "POST", email, body: onboardingBody("Release Owner", "Release Ledger") });
    assert.equal(created.status, 201, await created.clone().text());
    const identity = await database.prepare("SELECT u.id userId, m.organization_id organizationId FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.email=?")
      .bind(email).first<{ userId: string; organizationId: string }>();
    assert.ok(identity);
    const org = identity.organizationId;
    await grantBookLoQ(database, org);
    const seeded = await dispatch(worker, environment, "/api/v1/bookloq/demo", { method: "POST", email, body: {} });
    assert.equal(seeded.status, 201, await seeded.clone().text());
    const read = async () => {
      const response = await dispatch(worker, environment, "/api/v1/bookloq", { email });
      assert.equal(response.status, 200, await response.clone().text());
      return (await response.json()).bookloq;
    };
    const owner = await read();
    assert.ok(owner.statements.accounts.length > 0);
    assert.ok(owner.journals.length > 0);
    const customer = await database.prepare("SELECT id FROM bookloq_contacts WHERE organization_id=? AND contact_type='customer' LIMIT 1").bind(org).first<{ id: string }>();
    assert.ok(customer);
    const today = businessClock(new Date(), "America/Edmonton")!.date;
    const overdueCases = [
      ...Array.from({ length: 205 }, (_, index) => ({ id: `aging-issued-${index}`, status: index % 2 ? "sent" : "partially_paid", paid: index % 2 ? 0 : 500, due: "2020-01-01", demo: 1 })),
      ...["draft", "paid", "void", "written_off"].map((status) => ({ id: `aging-${status}`, status, paid: 0, due: "2020-01-01", demo: 1 })),
      { id: "aging-settled", status: "sent", paid: 1000, due: "2020-01-01", demo: 1 },
      { id: "aging-today", status: "sent", paid: 0, due: today, demo: 1 },
      { id: "aging-future", status: "sent", paid: 0, due: "2099-01-01", demo: 1 },
      { id: "aging-other-mode", status: "sent", paid: 0, due: "2020-01-01", demo: 0 },
    ];
    await database.batch(overdueCases.map((invoice) => database.prepare(`INSERT INTO customer_invoices
      (id,organization_id,customer_id,invoice_number,invoice_date,due_date,status,subtotal_cents,total_cents,paid_cents,demo_record,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(invoice.id, org, customer.id, invoice.id, "2020-01-01", invoice.due, invoice.status, 1000, 1000, invoice.paid, invoice.demo, Date.now(), Date.now())));
    const aged = await read();
    assert.equal(aged.summary.overdueInvoicesCount, owner.summary.overdueInvoicesCount + 205, "Only issued unpaid invoices count, across the full list and the selected data mode");
    assert.ok(aged.invoices.length <= 200, "The table limit must not cap the overdue summary");
    await database.batch(overdueCases.map((invoice) => database.prepare("DELETE FROM customer_invoices WHERE id=? AND organization_id=?").bind(invoice.id, org)));
    const location = await database.prepare("SELECT id FROM organization_locations WHERE organization_id=? LIMIT 1").bind(org).first<{ id: string }>();
    assert.ok(location);
    const roleId = crypto.randomUUID();
    const now = Date.now();
    await database.batch([
      database.prepare("UPDATE memberships SET role='admin' WHERE organization_id=? AND user_id=?").bind(org, identity.userId),
      database.prepare("INSERT INTO access_roles (id,organization_id,name,description,color,permissions_json,location_scope_json,archived,created_by_user_id,created_at,updated_at) VALUES (?,?,'Ledger reviewer','','#2255cc',?,'[]',0,?,?,?)")
        .bind(roleId, org, JSON.stringify(["finance.statements"]), identity.userId, now, now),
      database.prepare("INSERT INTO team_members (id,organization_id,user_id,role_id,first_name,last_name,email,employee_code,permitted_locations_json,status,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,'Release','Reviewer',?,'RELEASE',?,'active',?,?,?)")
        .bind(crypto.randomUUID(), org, identity.userId, roleId, email, JSON.stringify([location.id]), identity.userId, now, now),
    ]);
    for (const permission of [[], ["payroll.totals"], ["finance.bank_balances"], ["payroll.totals", "finance.bank_balances"], ["finance.ap_ar"], ["finance.bank_transactions", "audit.view", "finance.reconcile"]]) {
      await database.prepare("UPDATE access_roles SET permissions_json=? WHERE id=?").bind(JSON.stringify(["finance.statements", ...permission]), roleId).run();
      const limited = await read();
      assert.deepEqual(limited.statements.accounts, []);
      assert.deepEqual(limited.journals, []);
      assert.deepEqual(limited.budgets, []);
      assert.equal(limited.summary.payrollObligationsCents, null);
      assert.equal(limited.summary.totalExpensesCents, null);
      assert.ok(limited.accountCatalog.length > 0, "permitted accounting category selection must remain available");
      assert.ok(limited.accountCatalog.every((account: Record<string, unknown>) => !Object.keys(account).some((key) => /Cents|balance/i.test(key) && key !== "normalBalance")));
      assert.deepEqual(limited.transactions, []);
      assert.deepEqual(limited.reconciliations, []);
      assert.deepEqual(limited.alerts, []);
      assert.ok(limited.audit.every((event: { detailsJson: string }) => event.detailsJson === "{}"));
    }
    const secondLocation = crypto.randomUUID();
    await database.batch([
      database.prepare("INSERT INTO organization_locations (id,organization_id,name,country_code,address_line_1,locality,administrative_area,timezone,currency,created_at,updated_at) VALUES (?,?,'Second location','CA','2 Test Street','Edmonton','AB','America/Edmonton','CAD',?,?)").bind(secondLocation, org, now, now),
      database.prepare("UPDATE access_roles SET permissions_json=?,location_scope_json=? WHERE id=?").bind(JSON.stringify(["dashboard.view", "finance.statements"]), JSON.stringify([location.id]), roleId),
      database.prepare("UPDATE team_members SET permitted_locations_json=? WHERE organization_id=? AND user_id=?").bind(JSON.stringify([location.id, secondLocation]), org, identity.userId),
    ]);
    const scopedLocations = await dispatch(worker, environment, "/api/v1/locations", { email });
    assert.equal(scopedLocations.status, 200, await scopedLocations.clone().text());
    assert.deepEqual((await scopedLocations.json()).locations.map((item: { id: string }) => item.id), [location.id], "role scope must intersect member scope");
    const scopedLedger = await dispatch(worker, environment, "/api/v1/bookloq", { email });
    assert.equal(scopedLedger.status, 403, "a custom administrator with one location cannot read the organization ledger");
    await database.prepare("UPDATE team_members SET role_id=NULL WHERE organization_id=? AND user_id=?").bind(org, identity.userId).run();
    const invitedAdmin = await dispatch(worker, environment, "/api/v1/locations", { email });
    assert.equal(invitedAdmin.status, 200, await invitedAdmin.clone().text());
    assert.deepEqual(new Set((await invitedAdmin.json()).locations.map((item: { id: string }) => item.id)), new Set([location.id, secondLocation]), "legacy invited administrators retain their intended location access");
    await database.prepare("UPDATE memberships SET role='owner' WHERE organization_id=? AND user_id=?").bind(org, identity.userId).run();
    const restored = await read();
    assert.equal(restored.statements.accounts.length, owner.statements.accounts.length);
    const categoryRequestId = crypto.randomUUID();
    const categoryBody = { type: "create_category", categoryRequestId,
      categoryName: "Scoped budget regression", categoryType: "expense" };
    const createCategory = (body: Record<string, unknown>, actor = email) =>
      dispatch(worker, environment, "/api/v1/bookloq/actions", { method: "POST", email: actor, body });
    for (const invalidId of [undefined, "not-a-uuid"]) {
      const invalid = await createCategory({ ...categoryBody, categoryRequestId: invalidId });
      assert.equal(invalid.status, 400, await invalid.clone().text());
      assert.equal((await invalid.json()).error.code, "INVALID_CATEGORY_REQUEST");
    }
    const customCategory = await createCategory(categoryBody);
    assert.equal(customCategory.status, 201, await customCategory.clone().text());
    const originalCategory = (await customCategory.json()).category;
    const expenseAccount = originalCategory.id;
    assert.equal(expenseAccount, categoryRequestId);
    // The caller can recover after discarding/losing the first successful response.
    const categoryReplay = await createCategory({ ...categoryBody,
      categoryRequestId: categoryRequestId.toUpperCase(), categoryName: ` ${categoryBody.categoryName} ` });
    assert.equal(categoryReplay.status, 200, await categoryReplay.clone().text());
    const replayBody = await categoryReplay.json();
    assert.equal(replayBody.replayed, true);
    assert.deepEqual(replayBody.category, originalCategory);
    for (const changed of [{ categoryName: "Changed payload" }, { categoryType: "revenue" }]) {
      const rejected = await createCategory({ ...categoryBody, ...changed });
      assert.equal(rejected.status, 409, await rejected.clone().text());
      assert.equal((await rejected.json()).error.code, "CATEGORY_REQUEST_CONFLICT");
    }
    const categoryRows = await database.prepare(`SELECT id, name, account_type accountType
      FROM financial_accounts WHERE organization_id = ? AND id = ?`)
      .bind(org, categoryRequestId).all();
    assert.deepEqual(categoryRows.results, [{ id: categoryRequestId,
      name: categoryBody.categoryName, accountType: "expense" }]);

    const concurrentId = crypto.randomUUID();
    const concurrentBody = { ...categoryBody, categoryRequestId: concurrentId, categoryName: "Concurrent category" };
    const concurrent = await Promise.all(Array.from({ length: 3 }, () => createCategory(concurrentBody)));
    assert.deepEqual(concurrent.map(response => response.status).sort(), [200, 200, 201]);
    const concurrentCategories = await Promise.all(concurrent.map(response => response.json()));
    assert.ok(concurrentCategories.every(result => result.category.id === concurrentId));
    assert.equal((await database.prepare(`SELECT COUNT(*) count FROM financial_accounts
      WHERE organization_id = ? AND name = ?`).bind(org, concurrentBody.categoryName)
      .first<{ count: number }>())?.count, 1);
    assert.equal((await database.prepare(`SELECT COUNT(*) count FROM audit_events
      WHERE organization_id = ? AND action = 'financial_account.custom_category_created' AND resource_id = ?`)
      .bind(org, concurrentId).first<{ count: number }>())?.count, 1);

    // Different legitimate attempts must also allocate distinct codes successfully.
    const independent = await Promise.all(["A", "B"].map(suffix => createCategory({ ...categoryBody,
      categoryRequestId: crypto.randomUUID(), categoryName: `Independent ${suffix}` })));
    assert.ok(independent.every(response => response.status === 201));
    const independentCategories = await Promise.all(independent.map(response => response.json()));
    assert.equal(new Set(independentCategories.map(result => result.category.code)).size, 2);

    // A request ID from another tenant must never replay or change that tenant's category.
    const otherEmail = `category-other-${crypto.randomUUID()}@example.invalid`;
    const otherOnboarding = await dispatch(worker, environment, "/api/v1/onboarding", {
      method: "POST", email: otherEmail, body: onboardingBody("Other Owner", "Other Category") });
    assert.equal(otherOnboarding.status, 201, await otherOnboarding.clone().text());
    const otherIdentity = await database.prepare(`SELECT m.organization_id organizationId FROM users u
      JOIN memberships m ON m.user_id = u.id WHERE u.email = ?`).bind(otherEmail)
      .first<{ organizationId: string }>();
    assert.ok(otherIdentity);
    await grantBookLoQ(database, otherIdentity.organizationId);
    const foreignReplay = await createCategory(categoryBody, otherEmail);
    assert.equal(foreignReplay.status, 409, await foreignReplay.clone().text());
    const foreignBody = await foreignReplay.json();
    assert.equal(foreignBody.error.code, "CATEGORY_REQUEST_CONFLICT");
    assert.equal(foreignBody.category, undefined);
    assert.equal((await database.prepare(`SELECT COUNT(*) count FROM financial_accounts
      WHERE organization_id = ? AND id = ?`).bind(otherIdentity.organizationId, categoryRequestId)
      .first<{ count: number }>())?.count, 0);
    const cashAccount = owner.statements.accounts.find((account: { accountType: string }) => account.accountType === "asset").id;
    const budgetPeriod = owner.periods.find((period: { status: string }) => period.status === "open");
    assert.ok(budgetPeriod);
    const earlyDate = budgetPeriod.startDate;
    const lateDate = budgetPeriod.endDate;
    for (const [entryDate, amount, locationRef, departmentRef] of [
      [earlyDate, 80_000, location.id, "retail"],
      [lateDate, 20_000, location.id, "retail"],
      [lateDate, 35_000, secondLocation, "retail"],
      [lateDate, 15_000, location.id, "office"],
    ] as const) {
      const posted = await dispatch(worker, environment, "/api/v1/bookloq/journals", { method: "POST", email, idempotencyKey: crypto.randomUUID(), body: { entryDate, memo: "Scoped budget input", currency: "CAD", lines: [
        { accountId: expenseAccount, description: "Expense", debitCents: amount, creditCents: 0, locationRef, departmentRef },
        { accountId: cashAccount, description: "Cash", debitCents: 0, creditCents: amount, locationRef, departmentRef },
      ] } });
      assert.equal(posted.status, 201, await posted.clone().text());
    }
    for (const scope of [{ locationRef: location.id, departmentRef: "retail", expected: 20_000 }, { locationRef: "all", departmentRef: "all", expected: 70_000 }]) {
      const budgetId = crypto.randomUUID();
      await database.prepare("INSERT INTO bookloq_budgets (id,organization_id,account_id,period_start,period_end,location_ref,department_ref,budget_cents,committed_cents,forecast_cents,created_at,updated_at) VALUES (?,?,?,?,?,?,?,50000,0,0,?,?)").bind(budgetId, org, expenseAccount, lateDate, lateDate, scope.locationRef, scope.departmentRef, now, now).run();
      const actual = (await read()).budgets.find((budget: { id: string }) => budget.id === budgetId).actualCents;
      assert.equal(actual, scope.expected, "Budget actual excludes other dates, locations and departments, without reusing cumulative balances");
    }
    const matchTransaction = owner.transactions.find((item: { amountCents: number }) => item.amountCents < 0);
    const matchBill = owner.bills.find((item: { status: string }) => item.status !== "void");
    assert.ok(matchTransaction && matchBill);
    const originalTransaction = await database.prepare("SELECT source_state sourceState, currency, demo_record demoRecord FROM financial_transactions WHERE id=? AND organization_id=?").bind(matchTransaction.id, org).first<{ sourceState: string; currency: string; demoRecord: number }>();
    assert.ok(originalTransaction);
    const matchBody = { type: "match_transaction", transactionId: matchTransaction.id, targetType: "supplier_bill", targetId: matchBill.id };
    for (const scenario of [
      { state: "pending", currency: matchBill.currency, demo: matchBill.demoRecord, code: "MATCH_POSTED_TRANSACTION_REQUIRED" },
      { state: "posted", currency: "USD", demo: matchBill.demoRecord, code: "MATCH_SOURCE_MISMATCH" },
      { state: "posted", currency: matchBill.currency, demo: matchBill.demoRecord ? 0 : 1, code: "MATCH_SOURCE_MISMATCH" },
    ]) {
      await database.prepare("UPDATE financial_transactions SET source_state=?,currency=?,demo_record=? WHERE id=? AND organization_id=?").bind(scenario.state, scenario.currency, scenario.demo, matchTransaction.id, org).run();
      const result = await dispatch(worker, environment, "/api/v1/bookloq/actions", { method: "POST", email, body: matchBody });
      assert.equal(result.status, 409, await result.clone().text());
      assert.equal((await result.json()).error.code, scenario.code);
    }
    await database.prepare("UPDATE financial_transactions SET source_state=?,currency=?,demo_record=? WHERE id=? AND organization_id=?").bind("posted", matchBill.currency, matchBill.demoRecord, matchTransaction.id, org).run();
    const confirmedMatch = await dispatch(worker, environment, "/api/v1/bookloq/actions", { method: "POST", email, body: matchBody });
    assert.equal(confirmedMatch.status, 200, await confirmedMatch.clone().text());
    await database.prepare("UPDATE financial_transactions SET source_state=?,currency=?,demo_record=? WHERE id=? AND organization_id=?").bind(originalTransaction.sourceState, originalTransaction.currency, originalTransaction.demoRecord, matchTransaction.id, org).run();
    const date = new Date().toISOString().slice(0, 10);
    const accounts = owner.statements.accounts;
    const body = { entryDate: date, memo: "Verified regression entry", currency: "CAD", lines: [
      { accountId: accounts[0].id, description: "Debit", debitCents: 12345, creditCents: 0, locationRef: "all" },
      { accountId: accounts[1].id, description: "Credit", debitCents: 0, creditCents: 12345, locationRef: "all" },
    ] };
    const foreign = await dispatch(worker, environment, "/api/v1/bookloq/journals", { method: "POST", email, body: { ...body, currency: "USD" }, idempotencyKey: crypto.randomUUID() });
    assert.equal(foreign.status, 400);
    assert.equal((await foreign.json()).error.code, "JOURNAL_CURRENCY_UNSUPPORTED");
    const key = crypto.randomUUID();
    const posted = await dispatch(worker, environment, "/api/v1/bookloq/journals", { method: "POST", email, body, idempotencyKey: key });
    assert.equal(posted.status, 201, await posted.clone().text());
    const replay = await dispatch(worker, environment, "/api/v1/bookloq/journals", { method: "POST", email, body, idempotencyKey: key });
    assert.equal((await replay.json()).replayed, true);
    const period = await database.prepare("SELECT id FROM accounting_periods WHERE organization_id=? AND start_date<=? AND end_date>=?").bind(org, date, date).first<{ id: string }>();
    assert.ok(period);
    await database.prepare("UPDATE accounting_periods SET status='locked' WHERE id=?").bind(period.id).run();
    const locked = await dispatch(worker, environment, "/api/v1/bookloq/journals", { method: "POST", email, body, idempotencyKey: crypto.randomUUID() });
    assert.equal(locked.status, 409);
    await assert.rejects(database.prepare("INSERT INTO journal_entries (id,organization_id,entry_number,entry_date,posting_date,period_id,status,source_type,memo,currency,total_debit_cents,total_credit_cents,idempotency_key,prepared_by_user_id,created_at,updated_at) VALUES (?,?,?, ?,?,?,'posted','manual','Direct late write','CAD',100,100,?,?,?,?)")
      .bind(crypto.randomUUID(), org, `RACE-${crypto.randomUUID()}`, date, date, period.id, crypto.randomUUID(), identity.userId, Math.floor(now / 1000), Math.floor(now / 1000)).run(), /ACCOUNTING_PERIOD_UNAVAILABLE/);
    assert.equal((await database.prepare("SELECT COUNT(*) count FROM journal_entries WHERE organization_id=? AND memo='Direct late write'").bind(org).first<{ count: number }>())?.count, 0);
    const unlocked = await dispatch(worker, environment, "/api/v1/bookloq/actions", { method: "POST", email, body: { type: "unlock_period", periodId: period.id, reason: "Review correction against source evidence" } });
    assert.equal(unlocked.status, 200, await unlocked.clone().text());
    const correction = await dispatch(worker, environment, "/api/v1/bookloq/journals", { method: "POST", email, body: { ...body, memo: "Correction in reopened review period" }, idempotencyKey: crypto.randomUUID() });
    assert.equal(correction.status, 201, await correction.clone().text());
  } finally { await dispose(); }
});

async function getCashFlow(
  worker: { fetch: (request: Request, environment: unknown, context: unknown) => Promise<Response> },
  environment: unknown,
  email: string,
) {
  const response = await dispatch(worker, environment, "/api/v1/bookloq", { email });
  assert.equal(response.status, 200);
  return (await response.json()).bookloq.thirteenWeekCashFlow;
}

function forecastTotals(flow: { weeks: Array<{ confirmedNetCents: number; expectedNetCents: number }> }) {
  return flow.weeks.reduce((totals, week) => ({
    confirmedCents: totals.confirmedCents + week.confirmedNetCents,
    expectedCents: totals.expectedCents + week.expectedNetCents,
  }), { confirmedCents: 0, expectedCents: 0 });
}

async function clearLiveCommitments(database: D1Database, organizationId: string) {
  await database.batch([
    database.prepare("DELETE FROM supplier_bills WHERE organization_id = ? AND demo_record = 0").bind(organizationId),
    database.prepare("DELETE FROM purchase_orders WHERE organization_id = ?").bind(organizationId),
  ]);
}

async function seedPurchaseOrder(database: D1Database, input: {
  organizationId: string;
  userId: string;
  locationId: string;
  id: string;
  orderNumber: string;
  currency?: string;
  totalCents?: number;
  committedCashDate?: string | null;
  expectedDeliveryDate?: string | null;
}) {
  const today = businessClock(new Date(), "America/Edmonton")!.date;
  const now = Date.now();
  const totalCents = input.totalCents ?? 100_000;
  await database.prepare(`INSERT INTO purchase_orders
    (id, organization_id, order_number, supplier_name, delivery_location_id, order_date,
     expected_delivery_date, currency, status, subtotal_cents, tax_cents, discount_cents,
     total_cents, committed_cash_date, created_by_user_id, created_at, updated_at)
    VALUES (?, ?, ?, 'Regression supplier', ?, ?, ?, ?, 'sent', ?, 0, 0, ?, ?, ?, ?, ?)`).bind(
      input.id,
      input.organizationId,
      input.orderNumber,
      input.locationId,
      today,
      input.expectedDeliveryDate === undefined ? today : input.expectedDeliveryDate,
      input.currency ?? "CAD",
      totalCents,
      totalCents,
      input.committedCashDate === undefined ? today : input.committedCashDate,
      input.userId,
      now,
      now,
    ).run();
}

async function seedSupplierBill(database: D1Database, input: {
  organizationId: string;
  supplierId: string;
  id: string;
  billNumber: string;
  purchaseOrderRef: string;
  status: string;
  approvalStatus: string;
  totalCents: number;
  paidCents: number;
}) {
  const today = businessClock(new Date(), "America/Edmonton")!.date;
  const now = Date.now();
  await database.prepare(`INSERT INTO supplier_bills
    (id, organization_id, supplier_id, bill_number, invoice_date, due_date, status,
     subtotal_cents, tax_cents, total_cents, paid_cents, currency, purchase_order_ref,
     location_ref, approval_status, demo_record, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'CAD', ?, 'all', ?, 0, ?, ?)`).bind(
      input.id,
      input.organizationId,
      input.supplierId,
      input.billNumber,
      today,
      today,
      input.status,
      input.totalCents,
      input.totalCents,
      input.paidCents,
      input.purchaseOrderRef,
      input.approvalStatus,
      now,
      now,
    ).run();
}

test("BookLoQ cash-flow route deduplicates commitments and only counts trusted cash movements", async (t) => {
  const { worker, environment, database, dispose } = await createEnvironment();
  try {
    const suffix = crypto.randomUUID().slice(0, 8);
    const email = `bookloq-cash-${suffix}@example.invalid`;
    const businessName = `BookLoQ cash ${suffix}`;
    const onboarding = await dispatch(worker, environment, "/api/v1/onboarding", {
      method: "POST",
      email,
      body: onboardingBody("Cash Control Owner", businessName),
    });
    assert.equal(onboarding.status, 201);

    const identity = await database.prepare(`SELECT u.id userId, m.organization_id organizationId
      FROM users u JOIN memberships m ON m.user_id = u.id WHERE u.email = ?`).bind(email).first<{
        userId: string;
        organizationId: string;
      }>();
    assert.ok(identity?.userId && identity.organizationId);
    const location = await database.prepare(`SELECT id FROM organization_locations
      WHERE organization_id = ? AND status = 'active' ORDER BY created_at LIMIT 1`)
      .bind(identity.organizationId).first<{ id: string }>();
    assert.ok(location?.id);
    await grantBookLoQ(database, identity.organizationId);

    const seeded = await dispatch(worker, environment, "/api/v1/bookloq/demo", {
      method: "POST",
      email,
      body: {},
    });
    assert.equal(seeded.status, 201);

    const nowMs = Date.now();
    const nowSeconds = Math.floor(nowMs / 1_000);
    const approvedItemRef = `plaid-item-${suffix}`;
    await database.batch([
      database.prepare("UPDATE bookloq_settings SET data_mode = 'live', updated_at = ? WHERE organization_id = ?")
        .bind(nowSeconds, identity.organizationId),
      database.prepare(`UPDATE bank_accounts SET provider = 'plaid', demo_record = 0,
        external_account_ref = ?, external_item_ref = ?, currency = 'CAD',
        connection_status = 'healthy', live_balance_cents = 2397800,
        available_balance_cents = 2397800, last_sync_at = ?, updated_at = ?
        WHERE organization_id = ?`)
        .bind(`plaid-account-${suffix}`, approvedItemRef, nowSeconds - 60, nowSeconds, identity.organizationId),
      database.prepare(`INSERT INTO integration_connections
        (id, organization_id, provider, status, external_account_ref, scopes_json,
         data_promotion_status, connected_at, last_successful_sync_at, created_at, updated_at)
        VALUES (?, ?, 'plaid', 'connected', ?, '["transactions","balance"]',
          'approved', ?, ?, ?, ?)`)
        .bind(`plaid-connection-${suffix}`, identity.organizationId, approvedItemRef,
          nowSeconds, nowSeconds, nowSeconds, nowSeconds),
    ]);
    const supplier = await database.prepare(`SELECT id FROM bookloq_contacts
      WHERE organization_id = ? AND contact_type = 'supplier' ORDER BY created_at LIMIT 1`)
      .bind(identity.organizationId).first<{ id: string }>();
    assert.ok(supplier?.id);

    await t.test("a fully paid and reconciled linked bill retires the purchase-order commitment", async () => {
      await clearLiveCommitments(database, identity.organizationId);
      await seedPurchaseOrder(database, {
        organizationId: identity.organizationId,
        userId: identity.userId,
        locationId: location.id,
        id: "cash-regression-paid-po",
        orderNumber: "PO-CASH-PAID",
      });
      await seedSupplierBill(database, {
        organizationId: identity.organizationId,
        supplierId: supplier.id,
        id: "cash-regression-paid-bill",
        billNumber: "BILL-CASH-PAID",
        purchaseOrderRef: "cash-regression-paid-po",
        status: "reconciled",
        approvalStatus: "approved",
        totalCents: 100_000,
        paidCents: 100_000,
      });

      assert.deepEqual(forecastTotals(await getCashFlow(worker, environment, email)), {
        confirmedCents: 0,
        expectedCents: 0,
      });
    });

    await t.test("a provisional bill below its PO value leaves only the unpaid PO amount confirmed", async () => {
      await clearLiveCommitments(database, identity.organizationId);
      await seedPurchaseOrder(database, {
        organizationId: identity.organizationId,
        userId: identity.userId,
        locationId: location.id,
        id: "cash-regression-below-po",
        orderNumber: "PO-CASH-BELOW",
      });
      await seedSupplierBill(database, {
        organizationId: identity.organizationId,
        supplierId: supplier.id,
        id: "cash-regression-below-bill",
        billNumber: "BILL-CASH-BELOW",
        purchaseOrderRef: "cash-regression-below-po",
        status: "under_review",
        approvalStatus: "pending",
        totalCents: 60_000,
        paidCents: 20_000,
      });

      assert.deepEqual(forecastTotals(await getCashFlow(worker, environment, email)), {
        confirmedCents: -80_000,
        expectedCents: 0,
      });
    });

    await t.test("a provisional bill above its PO value retains the uncovered variance as expected", async () => {
      await clearLiveCommitments(database, identity.organizationId);
      await seedPurchaseOrder(database, {
        organizationId: identity.organizationId,
        userId: identity.userId,
        locationId: location.id,
        id: "cash-regression-above-po",
        orderNumber: "PO-CASH-ABOVE",
      });
      await seedSupplierBill(database, {
        organizationId: identity.organizationId,
        supplierId: supplier.id,
        id: "cash-regression-above-bill",
        billNumber: "BILL-CASH-ABOVE",
        purchaseOrderRef: "PO-CASH-ABOVE",
        status: "under_review",
        approvalStatus: "pending",
        totalCents: 140_000,
        paidCents: 20_000,
      });

      assert.deepEqual(forecastTotals(await getCashFlow(worker, environment, email)), {
        confirmedCents: -80_000,
        expectedCents: -40_000,
      });
    });

    await t.test("actual cash excludes credit accounts and Plaid items without an approved connection", async () => {
      await clearLiveCommitments(database, identity.organizationId);
      const operatingBank = await database.prepare(`SELECT financial_account_id financialAccountId
        FROM bank_accounts WHERE organization_id = ? AND account_type = 'chequing' LIMIT 1`)
        .bind(identity.organizationId).first<{ financialAccountId: string }>();
      assert.ok(operatingBank?.financialAccountId);
      const creditAccountId = `cash-regression-credit-${suffix}`;
      const disconnectedAccountId = `cash-regression-disconnected-${suffix}`;
      const disconnectedItemRef = `plaid-disconnected-${suffix}`;
      await database.batch([
        database.prepare(`INSERT INTO financial_accounts
          (id, organization_id, code, name, account_type, account_subtype, normal_balance,
           system_key, description, plain_language, tax_treatment, restricted, active, created_at, updated_at)
          VALUES (?, ?, '1098', 'Regression credit card', 'liability', 'credit_card', 'credit',
            NULL, '', '', 'none', 0, 1, ?, ?)`)
          .bind(creditAccountId, identity.organizationId, nowSeconds, nowSeconds),
        database.prepare(`INSERT INTO financial_accounts
          (id, organization_id, code, name, account_type, account_subtype, normal_balance,
           system_key, description, plain_language, tax_treatment, restricted, active, created_at, updated_at)
          VALUES (?, ?, '1099', 'Regression disconnected cash', 'asset', 'bank', 'debit',
            NULL, '', '', 'none', 0, 1, ?, ?)`)
          .bind(disconnectedAccountId, identity.organizationId, nowSeconds, nowSeconds),
        database.prepare(`INSERT INTO bank_accounts
          (id, organization_id, financial_account_id, name, account_type, institution_name,
           masked_number, currency, provider, external_account_ref, external_item_ref,
           live_balance_cents, available_balance_cents, book_balance_cents, connection_status,
           last_sync_at, demo_record, created_at, updated_at)
          VALUES (?, ?, ?, 'Regression card', 'credit_card', 'Regression bank', '1001',
            'CAD', 'plaid', ?, ?, -10000, NULL, -10000, 'healthy', ?, 0, ?, ?)`)
          .bind(`cash-regression-credit-bank-${suffix}`, identity.organizationId, creditAccountId,
            `plaid-credit-${suffix}`, approvedItemRef, nowSeconds - 60, nowSeconds, nowSeconds),
        database.prepare(`INSERT INTO bank_accounts
          (id, organization_id, financial_account_id, name, account_type, institution_name,
           masked_number, currency, provider, external_account_ref, external_item_ref,
           live_balance_cents, available_balance_cents, book_balance_cents, connection_status,
           last_sync_at, demo_record, created_at, updated_at)
          VALUES (?, ?, ?, 'Disconnected cash', 'merchant', 'Regression bank', '1002',
            'CAD', 'plaid', ?, ?, 0, 0, 0, 'healthy', ?, 0, ?, ?)`)
          .bind(`cash-regression-disconnected-bank-${suffix}`, identity.organizationId, disconnectedAccountId,
            `plaid-disconnected-account-${suffix}`, disconnectedItemRef, nowSeconds - 60, nowSeconds, nowSeconds),
      ]);

      const today = businessClock(new Date(), "America/Edmonton")!.date;
      const transaction = (id: string, accountId: string, amountCents: number) => database.prepare(`INSERT INTO financial_transactions
        (id, organization_id, transaction_date, posting_date, description, original_description,
         amount_cents, currency, exchange_rate_ppm, tax_amount_cents, account_id, source_system,
         external_source_id, source_state, location_ref, reconciliation_status,
         categorization_status, confidence_basis_points, approval_status, demo_record, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, '', ?, 'CAD', 1000000, 0, ?, 'plaid', ?, 'posted', 'all',
          'unreconciled', 'confirmed', 10000, 'not_required', 0, ?, ?)`).bind(
            id,
            identity.organizationId,
            today,
            today,
            id,
            amountCents,
            accountId,
            id,
            nowSeconds,
            nowSeconds,
          );
      await database.batch([
        transaction(`cash-regression-operating-${suffix}`, operatingBank.financialAccountId, 10_000),
        transaction(`cash-regression-credit-transaction-${suffix}`, creditAccountId, 20_000),
        transaction(`cash-regression-disconnected-transaction-${suffix}`, disconnectedAccountId, 30_000),
      ]);

      // More than a transaction page, plus same-day money in and money out.
      for (let offset = 0; offset < 1002; offset += 100) {
        await database.batch(Array.from({ length: Math.min(100, 1002 - offset) }, (_, index) =>
          transaction(`cash-volume-${suffix}-${offset + index}`, operatingBank.financialAccountId, 1)));
      }
      await database.batch([
        transaction(`cash-out-${suffix}`, operatingBank.financialAccountId, -4_000),
        transaction(`cash-pending-${suffix}`, operatingBank.financialAccountId, 90_000),
        transaction(`cash-removed-${suffix}`, operatingBank.financialAccountId, 90_000),
        transaction(`cash-foreign-${suffix}`, operatingBank.financialAccountId, 90_000),
        transaction(`cash-demo-${suffix}`, operatingBank.financialAccountId, 90_000),
        transaction(`cash-pos-${suffix}`, operatingBank.financialAccountId, 90_000),
      ]);
      await database.batch([
        database.prepare("UPDATE financial_transactions SET source_state='pending' WHERE id=?").bind(`cash-pending-${suffix}`),
        database.prepare("UPDATE financial_transactions SET source_state='removed' WHERE id=?").bind(`cash-removed-${suffix}`),
        database.prepare("UPDATE financial_transactions SET currency='USD' WHERE id=?").bind(`cash-foreign-${suffix}`),
        database.prepare("UPDATE financial_transactions SET demo_record=1 WHERE id=?").bind(`cash-demo-${suffix}`),
        database.prepare("UPDATE financial_transactions SET source_system='square' WHERE id=?").bind(`cash-pos-${suffix}`),
      ]);
      const flow = await getCashFlow(worker, environment, email);
      assert.equal(flow.actualInflowCents, 11_002);
      assert.equal(flow.actualOutflowCents, 4_000);
      assert.equal(flow.weeks.reduce((sum: number, week: { actualNetCents: number }) => sum + week.actualNetCents, 0), 7_002);
      const beforeCategory = await database.prepare("SELECT category_account_id category FROM financial_transactions WHERE id=?").bind(`cash-out-${suffix}`).first<{category:string|null}>();
      const invalidRule = await dispatch(worker, environment, "/api/v1/bookloq/actions", { email, method:"POST", body:{ type:"categorize_transaction", transactionId:`cash-out-${suffix}`, accountId:operatingBank.financialAccountId, createRule:true, matchText:"a" } });
      assert.equal(invalidRule.status, 400);
      const afterCategory = await database.prepare("SELECT category_account_id category FROM financial_transactions WHERE id=?").bind(`cash-out-${suffix}`).first<{category:string|null}>();
      assert.deepEqual(afterCategory, beforeCategory, "rejected rule cannot partially update its transaction");
      const response = await dispatch(worker, environment, "/api/v1/bookloq", { email });
      assert.equal(response.status, 200);
      const payload = (await response.json()).bookloq;
      for (const activity of ["days30", "days90", "months12"].map(key => payload.cashActivity[key]) as Array<{ transactionCount: number; inflowCents: number; outflowCents: number; netCashFlowCents: number; timeline: { inflowCents: number; outflowCents: number }[] }>) {
        assert.equal(activity.transactionCount, 1004);
        assert.equal(activity.inflowCents, 11_002);
        assert.equal(activity.outflowCents, 4_000);
        assert.equal(activity.netCashFlowCents, 7_002);
        assert.equal(activity.timeline.reduce((sum, bucket) => sum + bucket.inflowCents, 0), activity.inflowCents);
        assert.equal(activity.timeline.reduce((sum, bucket) => sum + bucket.outflowCents, 0), activity.outflowCents);
      }
    });

    await t.test("malformed committed cash dates are rejected and legacy malformed values fail closed", async () => {
      await clearLiveCommitments(database, identity.organizationId);
      const today = businessClock(new Date(), "America/Edmonton")!.date;
      const createResponse = await dispatch(worker, environment, "/api/v1/purchasing", {
        method: "POST",
        email,
        body: {
          action: "create",
          supplierName: "Regression supplier",
          deliveryLocationId: location.id,
          orderNumber: `PO-MALFORMED-${suffix}`,
          orderDate: today,
          expectedDeliveryDate: today,
          committedCashDate: "2026-02-30",
          currency: "CAD",
          lines: [{ description: "Regression item", quantity: 1, unitCostCents: 100_000 }],
        },
      });
      assert.equal(createResponse.status, 400);
      assert.equal((await createResponse.json()).error.code, "INVALID_FIELD");

      await seedPurchaseOrder(database, {
        organizationId: identity.organizationId,
        userId: identity.userId,
        locationId: location.id,
        id: "cash-regression-malformed-po",
        orderNumber: "PO-CASH-MALFORMED",
        committedCashDate: "2026-02-30",
      });
      const flow = await getCashFlow(worker, environment, email);
      assert.equal(flow.status, "needs_review");
      assert.equal(flow.capacityStatus, "commitment_date_required");
      assert.equal(flow.purchasingCapacityCents, null);
      assert.equal(flow.undatedCommittedItemCount, 1);
      assert.ok(flow.decisionBlocks.includes("undated_purchase_commitments"));
    });

    await t.test("foreign, undated, and combined commitments retain their specific review states", async () => {
      const today = businessClock(new Date(), "America/Edmonton")!.date;
      const cases = [
        {
          label: "foreign",
          orders: [{ id: "cash-regression-foreign-po", orderNumber: "PO-CASH-FOREIGN", currency: "USD", committedCashDate: today }],
          status: "needs_review",
          capacityStatus: "currency_review_required",
          excludedCurrencyItemCount: 1,
          undatedCommittedItemCount: 0,
        },
        {
          label: "undated",
          orders: [{ id: "cash-regression-undated-po", orderNumber: "PO-CASH-UNDATED", currency: "CAD", committedCashDate: null }],
          status: "needs_review",
          capacityStatus: "commitment_date_required",
          excludedCurrencyItemCount: 0,
          undatedCommittedItemCount: 1,
        },
        {
          label: "both",
          orders: [
            { id: "cash-regression-both-foreign-po", orderNumber: "PO-CASH-BOTH-FOREIGN", currency: "USD", committedCashDate: today },
            { id: "cash-regression-both-undated-po", orderNumber: "PO-CASH-BOTH-UNDATED", currency: "CAD", committedCashDate: null },
          ],
          status: "needs_review",
          capacityStatus: "currency_review_required",
          excludedCurrencyItemCount: 1,
          undatedCommittedItemCount: 1,
        },
      ] as const;

      for (const scenario of cases) {
        await clearLiveCommitments(database, identity.organizationId);
        for (const order of scenario.orders) {
          await seedPurchaseOrder(database, {
            organizationId: identity.organizationId,
            userId: identity.userId,
            locationId: location.id,
            ...order,
          });
        }
        const flow = await getCashFlow(worker, environment, email);
        assert.equal(flow.status, scenario.status, scenario.label);
        assert.equal(flow.capacityStatus, scenario.capacityStatus, scenario.label);
        assert.equal(flow.purchasingCapacityCents, null, scenario.label);
        assert.equal(flow.excludedCurrencyItemCount, scenario.excludedCurrencyItemCount, scenario.label);
        assert.equal(flow.undatedCommittedItemCount, scenario.undatedCommittedItemCount, scenario.label);
      }
    });
  } finally {
    await dispose();
  }
});

test("cash-flow capacity statuses prioritize the actionable review reason", () => {
  const cases = [
    {
      label: "foreign",
      decisionBlocks: ["foreign_currency_obligations"],
      excludedCurrencyItemCount: 1,
      undatedCommittedItemCount: 0,
      status: "needs_review",
      capacityStatus: "currency_review_required",
    },
    {
      label: "undated",
      decisionBlocks: ["undated_purchase_commitments"],
      excludedCurrencyItemCount: 0,
      undatedCommittedItemCount: 1,
      status: "needs_review",
      capacityStatus: "commitment_date_required",
    },
    {
      label: "foreign and undated",
      decisionBlocks: ["foreign_currency_obligations", "undated_purchase_commitments"],
      excludedCurrencyItemCount: 1,
      undatedCommittedItemCount: 1,
      status: "needs_review",
      capacityStatus: "currency_review_required",
    },
    {
      label: "bank unavailable",
      decisionBlocks: ["bank_data_unavailable"],
      excludedCurrencyItemCount: 0,
      undatedCommittedItemCount: 0,
      status: "unavailable",
      capacityStatus: "unavailable",
    },
  ] as const;

  for (const scenario of cases) {
    const result = buildThirteenWeekCashFlow({
      asOf: "2026-08-11",
      openingCashCents: scenario.label === "bank unavailable" ? null : 500_000,
      safetyThresholdCents: 100_000,
      actualTransactions: [],
      forecastItems: [],
      excludedCurrencyItemCount: scenario.excludedCurrencyItemCount,
      undatedCommittedItemCount: scenario.undatedCommittedItemCount,
      decisionBlocks: scenario.decisionBlocks,
    });
    assert.equal(result.status, scenario.status, scenario.label);
    assert.equal(result.capacityStatus, scenario.capacityStatus, scenario.label);
    assert.equal(result.purchasingCapacityCents, null, scenario.label);
  }
});

test("cash-flow UI names every commitment blocker and reserves bank guidance for bank failures", async () => {
  const source = await readFile(new URL("../app/bookloq-workspace.tsx", import.meta.url), "utf8");

  assert.match(source, /decisionBlocks\.includes\("foreign_currency_obligations"\)[\s\S]{0,500}foreign-currency obligation/);
  assert.match(source, /decisionBlocks\.includes\("undated_purchase_commitments"\)[\s\S]{0,500}valid cash date/);
  assert.match(source, /capacityWarnings\.join\(" "\)/);
  assert.match(
    source,
    /flow\.status === "needs_review" \? <ProviderGate title="Cash forecast needs commitment review" detail=\{capacityWarning[\s\S]{0,500}: <ProviderGate title="Verified cash forecast unavailable" detail="Connect and synchronize a healthy owner-authorized bank source/,
    "Commitment review must select its specific warning before the generic bank-unavailable remediation.",
  );
});


test("executive report keeps period accounting behind add-on and organization scope", async () => {
  const {worker,environment,database,dispose}=await createEnvironment();
  try {
    const email='executive-'+crypto.randomUUID()+'@example.invalid';
    const response=await dispatch(worker,environment,'/api/v1/onboarding',{method:'POST',email,body:onboardingBody('Executive Owner','Executive Fixture')});
    assert.equal(response.status,201,await response.clone().text());
    const identity=await database.prepare('SELECT m.organization_id organizationId FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.email=?').bind(email).first<{organizationId:string}>();
    assert.ok(identity);const org=identity.organizationId;await grantBookLoQ(database,org);
    const seed=await dispatch(worker,environment,'/api/v1/bookloq/demo',{method:'POST',email,body:{}});assert.equal(seed.status,201,await seed.clone().text());
    const path='/api/v1/command-centre?executive=1&period=ytd&basis=ledger';
    const read=async(suffix='')=>{const r=await dispatch(worker,environment,path+suffix,{email});assert.equal(r.status,200,await r.clone().text());return (await r.json()).executiveReport;};
    assert.equal((await read()).finance,null,'demo ledger never flows into live overview');
    // Only the isolated, synthetic database is switched to exercise the live-code query path.
    await database.prepare("UPDATE bookloq_settings SET data_mode='live' WHERE organization_id=?").bind(org).run();
    const report=await read();assert.equal(report.metrics.length,8);assert.ok(report.finance);assert.equal(report.finance.closing.balanceDifferenceCents,0);assert.ok(report.finance.cashClassification);
    assert.ok(report.finance.current);assert.equal(report.finance.current.operatingProfitCents,report.finance.current.operatingRevenueCents-report.finance.current.cogsCents-report.finance.current.operatingExpensesCents);
    const location=await database.prepare('SELECT id FROM organization_locations WHERE organization_id=? LIMIT 1').bind(org).first<{id:string}>();assert.ok(location);
    assert.equal((await read('&location='+location.id)).finance,null,'location view cannot silently show whole-company ledger totals');
    await database.prepare("UPDATE tenant_addons SET status='inactive' WHERE organization_id=? AND addon_key='bookloq'").bind(org).run();
    const revoked=await read();assert.equal(revoked.finance,null);assert.equal(revoked.metrics.find((m:{key:string})=>m.key==='operating_profit').value,null);
    const invalid=await dispatch(worker,environment,'/api/v1/command-centre?executive=1&period=custom&from=2026-02-30&to=2026-03-01',{email});assert.equal(invalid.status,400);
  } finally {await dispose();}
});
