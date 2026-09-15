import assert from "node:assert/strict";
import type { RetailLine, RetailMeasurement, RetailStock } from "../domain/retail-intelligence";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { registerSupabaseTestServer } from "../tests/helpers/supabase-loopback-transport.mjs";

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



const fixturePath = process.argv[2];
if (!fixturePath) throw new Error("Provide the explicitly fictional fixture.json path.");
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
assert.match(fixture.expected.label, /FICTIONAL QA DATA/);
const output = new URL("./", new URL(`file:///${fixturePath.replaceAll("\\", "/")}`));
const { parseDailyCsv } = await import("../domain/daily-summary-csv.ts");
const { buildRetailIntelligence } = await import("../domain/retail-intelligence.ts");
const { parseCommercePeriod } = await import("../domain/commerce-intelligence.ts");
const context = await createEnvironment();
try {
  const { database: db, worker, environment } = context;
  const email = "financial-qa@example.invalid";
  const send = (path: string, body?: unknown, key?: string) => dispatch(worker, environment, path, { email, method: body ? "POST" : "GET", body, idempotencyKey: key });
  const expect = async (response: Response, status: number) => { assert.equal(response.status, status, await response.clone().text()); return response.json(); };
  await expect(await send("/api/v1/onboarding", onboardingBody("QA Owner", "Northline QA Retail")), 201);
  const identity = await db.prepare("SELECT u.id userId,m.organization_id organizationId FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.email=?").bind(email).first<{userId:string;organizationId:string}>();
  assert.ok(identity);
  const org = identity.organizationId, now = Math.floor(Date.now()/1000), prefix = `blq:${org}`, account = (key:string) => `${prefix}:account:${key}`;
  await grantBookLoQ(db, org);
  await expect(await send("/api/v1/bookloq/demo", {}), 201);
  // Only this newly created in-memory D1 is modified. No live credentials or endpoints exist here.
  for (const table of ["bookloq_transaction_matches","financial_transactions","reconciliations","customer_invoice_lines","customer_invoices","supplier_bills","month_end_items","bookloq_budgets","bookloq_alerts","journal_lines","journal_entries"]) await db.prepare(`DELETE FROM ${table} WHERE organization_id=?`).bind(org).run();
  await db.prepare("UPDATE accounting_periods SET start_date='2026-07-01',end_date='2026-09-30',label='QA July to September' WHERE organization_id=?").bind(org).run();
  for (const entry of fixture.journals) {
    const body = { entryDate: entry.entryDate, memo: entry.memo, currency: "CAD", lines: entry.lines.map((line:{accountKey:string;description:string;debitCents:number;creditCents:number}) => ({ accountId: account(line.accountKey), description: line.description, debitCents: line.debitCents, creditCents: line.creditCents, locationRef:"all" })) };
    await expect(await send("/api/v1/bookloq/journals",body,crypto.randomUUID()),201);
  }
  const csv = await readFile(new URL("Vanteloq_Test_Pack/01_IMPORT_SALES/TEST_ONLY_daily_sales.csv", output),"utf8");
  const rows = parseDailyCsv(csv);
  assert.deepEqual(rows, fixture.dailyRows);
  const importBody={importType:"daily_summary_csv",fileName:"TEST_ONLY_daily_sales.csv",rows};
  await expect(await send("/api/v1/daily-metrics",importBody,crypto.randomUUID()),201);
  await expect(await send("/api/v1/daily-metrics",importBody,crypto.randomUUID()),201);
  const daily = await db.prepare("SELECT COUNT(*) count,SUM(net_sales_cents) net,SUM(transaction_count) transactions FROM daily_business_metrics WHERE organization_id=?").bind(org).first<{count:number;net:number;transactions:number}>();
  assert.equal(daily!.count,112);assert.equal(daily!.net,6524032);assert.equal(daily!.transactions,1076);
  await expect(await send("/api/v1/daily-metrics",{...importBody,rows:[{...rows[0],businessDate:"2026-02-30"}]},crypto.randomUUID()),400);
  for (const file of ["REJECT_blank_net_sales.csv","REJECT_invalid_date.csv","REJECT_fractional_transactions.csv","REJECT_duplicate_day_location.csv"]) {
    const bad=await readFile(new URL(`Vanteloq_Test_Pack/05_ERROR_CASES/${file}`,output),"utf8");
    assert.throws(()=>parseDailyCsv(bad),file);
  }
  await db.prepare("UPDATE bank_accounts SET name='TEST ONLY Operating account',institution_name='Northline QA Bank',masked_number='TEST ONLY',live_balance_cents=?,available_balance_cents=?,book_balance_cents=?,last_sync_at=?,last_reconciled_at=? WHERE organization_id=?").bind(fixture.expected.accounting.cashCents,fixture.expected.accounting.cashCents,fixture.expected.accounting.cashCents,now,now,org).run();
  for (const [i,row] of fixture.bankTransactions.entries()) await db.prepare(`INSERT INTO financial_transactions
    (id,organization_id,transaction_date,posting_date,description,original_description,amount_cents,currency,account_id,source_system,external_source_id,location_ref,reconciliation_status,categorization_status,confidence_basis_points,approval_status,demo_record,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,'CAD',?,'qa_fixture',?,'all','unreconciled','missing',0,'not_required',1,?,?)`)
    .bind(`qa-bank-${i}`,org,row.postingDate,row.postingDate,row.description,row.description,row.amountCents,account('cash'),row.reference,now,now).run();
  await db.prepare(`INSERT INTO supplier_bills (id,organization_id,supplier_id,bill_number,invoice_date,due_date,status,subtotal_cents,tax_cents,total_cents,paid_cents,currency,location_ref,approval_status,demo_record,created_at,updated_at)
    VALUES ('qa-bill',?,?,'TEST-AP-001','2026-09-10','2026-10-10','approved',300000,15000,315000,0,'CAD','all','approved',1,?,?)`).bind(org,`${prefix}:contact:supplier_peak`,now,now).run();
  await db.prepare(`INSERT INTO customer_invoices (id,organization_id,customer_id,invoice_number,invoice_date,due_date,status,subtotal_cents,tax_cents,total_cents,paid_cents,currency,location_ref,demo_record,created_at,updated_at)
    VALUES ('qa-invoice',?,?,'TEST-AR-001','2026-09-12','2026-09-27','sent',200000,10000,210000,0,'CAD','all',1,?,?)`).bind(org,`${prefix}:contact:customer_corp`,now,now).run();
  const demoState = await expect(await send("/api/v1/bookloq"),200);
  assert.equal(demoState.bookloq.thirteenWeekCashFlow.openingCashCents, null, "Demonstration data cannot authorize spending");
  // Simulate an approved bank adapter only inside this disposable D1 to test the
  // same forecast pathway used by production. This does not verify Plaid service.
  await db.batch([
    db.prepare("UPDATE bookloq_settings SET data_mode='live' WHERE organization_id=?").bind(org),
    db.prepare("UPDATE bank_accounts SET provider='plaid',demo_record=0,external_account_ref='qa-bank-account',external_item_ref='qa-bank-item' WHERE organization_id=?").bind(org),
    db.prepare("INSERT INTO integration_connections (id,organization_id,provider,status,external_account_ref,scopes_json,data_promotion_status,connected_at,last_successful_sync_at,created_at,updated_at) VALUES ('qa-bank-connection',?,'plaid','connected','qa-bank-item','[]','approved',?,?,?,?)").bind(org,now,now,now,now),
    db.prepare("UPDATE supplier_bills SET demo_record=0 WHERE organization_id=?").bind(org),
    db.prepare("UPDATE customer_invoices SET demo_record=0 WHERE organization_id=?").bind(org),
    db.prepare("UPDATE financial_transactions SET demo_record=0,source_system='plaid' WHERE organization_id=?").bind(org),
  ]);
  const bookloq = await expect(await send("/api/v1/bookloq"),200);
  const expectedInflows = fixture.bankTransactions.reduce((n:number,row:{amountCents:number})=>n+Math.max(0,row.amountCents),0);
  const expectedOutflows = fixture.bankTransactions.reduce((n:number,row:{amountCents:number})=>n+Math.max(0,-row.amountCents),0);
  assert.equal(bookloq.bookloq.cashActivity.days90.inflowCents, expectedInflows);
  assert.equal(bookloq.bookloq.cashActivity.days90.outflowCents, expectedOutflows);
  assert.equal(bookloq.bookloq.thirteenWeekCashFlow.openingCashCents, fixture.expected.accounting.cashCents);
  assert.equal(bookloq.bookloq.thirteenWeekCashFlow.weeks.at(-1).conservativeClosingCashCents, fixture.expected.accounting.cashCents - 315000);
  assert.equal(bookloq.bookloq.thirteenWeekCashFlow.weeks.at(-1).planningClosingCashCents, fixture.expected.accounting.cashCents - 315000 + 210000);
  const statements=bookloq.bookloq.statements,expected=fixture.expected.accounting;
  for (const key of ["revenueCents","expenseCents","cogsCents","grossProfitCents","operatingProfitCents"]) assert.equal(statements.profitAndLoss[key],expected[key],key);
  for (const key of ["assetCents","liabilityCents","equityCents"]) assert.equal(statements.balanceSheet[key],expected[key],key);
  assert.equal(statements.trialBalance.totalDebitCents,expected.trialDebitCents);
  assert.equal(statements.trialBalance.totalCreditCents,expected.trialCreditCents);
  const source = { provider: "qa_fixture", connectionId: "qa-local-only" };
  const period = parseCommercePeriod(fixture.expected.currentFrom,fixture.expected.toDate);
  const measurements: RetailMeasurement[] = [];
  const stock: RetailStock[] = [];
  for (const outletRef of ["QA Main","QA West"]) {
    const wagesCents = rows.filter(r=>r.locationRef===outletRef&&r.businessDate>=period.from).reduce((n,r)=>n+r.labourCostCents,0);
    measurements.push({...source,outletRef,kind:"labour",reference:"QA aggregate payroll",from:period.from,to:period.to,source:"Fictional payroll, CAD $24/hour",values:{wagesCents,paidMinutes:wagesCents/2400*60,complete:true}});
    for (const product of fixture.products as Array<[string,string,string,string,number,number]>) {
      const [sku,name,,,,cost] = product;
      const lines=(fixture.retailLines as RetailLine[]).filter(l=>l.sku===sku&&l.outletRef===outletRef);
      const priorUnits=lines.filter(l=>l.soldAt.slice(0,10)<period.from).reduce((n,l)=>n+l.quantityMilli/1000,0);
      const allUnits=lines.reduce((n,l)=>n+l.quantityMilli/1000,0);
      const openingUnits=250-priorUnits,onHand=250-allUnits;
      stock.push({...source,key:JSON.stringify([source.provider,source.connectionId,outletRef,sku]),name,sku,outletRef,onHand,reorderPoint:15,updatedAt:Date.now()});
      measurements.push({...source,outletRef,kind:"stock",reference:sku,from:period.from,to:period.to,source:"Fictional retail stock roll-forward; unallocated wholesale inventory excluded",values:{openingUnits,receivedUnits:0,openingValueCents:openingUnits*cost,closingValueCents:onHand*cost}});
    }
  }
  const retail=buildRetailIntelligence({ lines:fixture.retailLines,period,timeZone:"America/Edmonton",asOfDate:fixture.expected.toDate,stock,measurements,lots:[{name:"TEST Protein Bar lot",sku:"QA-BAR",locationRef:"QA Main",expirationDate:"2026-09-20",quantity:12,costCents:180}] });
  assert.equal(retail.current.netCents,2788420);assert.equal(retail.prior.netCents,3735612);assert.equal(retail.current.purchaseBaskets,461);
  assert.equal(retail.categories.reduce((n,r)=>n+r.netCents,0),2788420);assert.equal(retail.products.reduce((n,r)=>n+r.netCents,0),2788420);
  assert.equal(retail.hours.reduce((n,r)=>n+(r.netCents??0),0),2788420);
  assert.ok(retail.baskets.products.pairs.length>0);assert.ok(retail.customers.repeatBuyers>0);
  assert.equal(retail.operations.paidHours,336);
  assert.equal(retail.operations.salesPerLabourHourCents,2788420/336);
  assert.equal(retail.operations.averagePaidRateCents,2400);
  assert.ok(retail.inventory.some(s=>s.turnover!==null&&s.sellThrough!==null));
  assert.ok(retail.inventory.filter(s=>s.stockInputIssue).every(s=>s.sellThrough===null), "Oversold stock must be flagged, not presented as a valid sell-through rate");
  assert.equal(retail.expiry[0].valueAtRiskCents,2160);
  assert.equal(retail.bridge!.reduce((n,driver)=>n+driver.impactCents,0),-947192);
  await writeFile(new URL("verified-bookloq.json",output),JSON.stringify(bookloq,null,2));
  await writeFile(new URL("verified-retail.json",output),JSON.stringify(retail,null,2));
  await writeFile(new URL("verification.json",output),JSON.stringify({fixture:"FICTIONAL QA ONLY",date:new Date().toISOString(),daily,postedJournals:fixture.journals.length,statements,retail:{current:retail.current,prior:retail.prior,bridge:retail.bridge,productPairs:retail.baskets.products.pairs.length},checks:["112 daily rows imported twice without duplication","4 malformed CSV fixtures rejected","Invalid date rejected by API","26 balanced journals posted through API","P&L and balance sheet match independent fixture totals","Retail SKU/category/hour totals agree","Basket associations and repeat customers available"]},null,2));
  console.log(JSON.stringify({passed:true,daily,postedJournals:fixture.journals.length,profitAndLoss:statements.profitAndLoss,balanceSheet:statements.balanceSheet,productPairs:retail.baskets.products.pairs.length}));
} finally { await context.dispose(); }
