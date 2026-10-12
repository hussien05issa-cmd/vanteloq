import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { posSqliteFixture } from "./helpers/pos-sqlite-fixture.ts";
import { activateTestSubscription } from "./helpers/subscription-fixture.mjs";
import { GET } from "../app/api/v1/data-studio/executive/route.ts";
import type { VanteloqRuntimeEnv } from "../db/index.ts";
import { STUDIO_MAX_RECORDS, studioSalesSummary, type StudioExecutiveReview } from "../domain/data-studio.ts";
import { executiveReviewXlsx } from "../server/data-studio-xlsx.ts";
import { studioPolicy, revalidateStudioPolicy } from "../server/data-studio.ts";
import ExcelJS from "exceljs";

const globals = globalThis as typeof globalThis & { __vanteloqEnv?: VanteloqRuntimeEnv };
const oldEnv = globals.__vanteloqEnv, oldFetch = globalThis.fetch;
const identities = new Map<string, string>();
let fixture: Awaited<ReturnType<typeof posSqliteFixture>>;
before(async () => {
  fixture = await posSqliteFixture();
  globals.__vanteloqEnv = { DB: fixture.database, SUPABASE_URL: "https://studio-fixture.supabase.co", SUPABASE_PUBLISHABLE_KEY: "fictional-key" };
  globalThis.fetch = (async (input, init) => {
    if (new URL(String(input)).hostname !== "studio-fixture.supabase.co") throw Error("No external provider calls in Studio fixtures.");
    const token = new Headers(init?.headers).get("authorization")?.split(".")[1];
    const email = token ? JSON.parse(Buffer.from(token, "base64url").toString()).email : null;
    const id = identities.get(email);
    return id ? Response.json({ id, email, email_confirmed_at: "2026-01-01", user_metadata: {} }) : Response.json({}, { status: 401 });
  }) as typeof fetch;
});
after(() => { globalThis.fetch = oldFetch; globals.__vanteloqEnv = oldEnv; fixture?.close(); });
type Actor = { user: string; organization: string; email: string; location: string };
async function actor(plan = "pro", role = "owner"): Promise<Actor> {
  const user = crypto.randomUUID(), organization = crypto.randomUUID(), email = `${user}@example.invalid`, location = `${organization}:shop`;
  identities.set(email, `fixture:${user}`);
  await fixture.database.batch([
    fixture.database.prepare("INSERT INTO workspaces(id,owner_name,business_name,legal_name,business_email,industry,city,address,postal_code,hours_json,setup_complete,created_at,updated_at) VALUES (?,'Fictional','Fictional','Fictional',?,'Retail','Edmonton','Test','T5A1A1','[]',1,1,1)").bind(organization, email),
    fixture.database.prepare("INSERT INTO users(id,email,auth_subject,auth_provider,display_name,status,created_at,updated_at) VALUES (?,?,?,'supabase','Fictional','active',1,1)").bind(user, email, `fixture:${user}`),
    fixture.database.prepare("INSERT INTO memberships(id,organization_id,user_id,role,status,created_at,updated_at) VALUES (?,?,?,?,'active',1,1)").bind(crypto.randomUUID(), organization, user, role),
    fixture.database.prepare("INSERT INTO organization_locations(id,organization_id,name,status,timezone,currency,country_code,address_line_1,locality,administrative_area,created_at,updated_at) VALUES (?,?,'Shop','active','America/Edmonton','CAD','CA','Fictional','Edmonton','AB',1,1)").bind(location, organization),
  ]);
  await activateTestSubscription(fixture.database, organization, plan);
  return { user, organization, email, location };
}
function request(a: Actor, parameters = "", aal = "aal2") {
  const token = Buffer.from(JSON.stringify({ email: a.email, aal, session_id: `fixture-session:${a.user}` })).toString("base64url");
  return new Request(`https://vanteloq.example/api/v1/data-studio/executive?from=2026-10-01&to=2026-10-02${parameters}`, { headers: { Authorization: `Bearer test.${token}.signature`, Origin: "https://vanteloq.example", "Sec-Fetch-Site": "same-origin" } });
}
async function daily(a: Actor, value: number, cost: number, date = "2026-10-01") {
  await fixture.database.prepare("INSERT INTO daily_business_metrics(organization_id,business_date,location_ref,gross_sales_cents,net_sales_cents,cost_of_goods_cents,transaction_count,units_sold,created_by_user_id,created_at,updated_at) VALUES (?,?,?,10000,?,?,2,3,?,1,1)").bind(a.organization, date, a.location, value, cost, a.user).run();
}
async function expect(response: Response, status: number) { assert.equal(response.status, status, await response.clone().text()); return response.json(); }
test("real Studio API isolates tenants, captures every accepted row and exports the same typed seven-sheet result", async () => {
  const a = await actor(), b = await actor(); await daily(a, 10000, 5000); await daily(a, -1000, -600, "2026-10-02"); await daily(b, 999999, 0);
  const review: StudioExecutiveReview = await expect(await GET(request(a)), 200);
  assert.equal(review.sales.rows.length, 2); assert.equal(review.sales.summary?.netSalesCents, 9000); assert.equal(review.sales.summary?.grossProfitCents, 4600);
  assert.equal(review.metadata.truncated, false); assert.equal(review.metadata.canExport, true); assert.doesNotMatch(JSON.stringify(review), new RegExp(b.organization));
  const response = await GET(request(a, `&format=xlsx&snapshot=${review.metadata.snapshotHash}`));
  assert.equal(response.status, 200, response.status !== 200 ? await response.text() : ""); assert.equal(response.headers.get("X-Studio-Snapshot"), review.metadata.snapshotHash);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await response.arrayBuffer());
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ["Overview", "Sales", "Margin", "Inventory", "Cash", "Data Quality", "Sources"]);
  assert.equal(workbook.getWorksheet("Sales")!.getCell("E2").value, 100); assert.equal(workbook.getWorksheet("Sales")!.getCell("E3").value, -10);
  assert.equal(workbook.getWorksheet("Sales")!.getCell("A2").type, ExcelJS.ValueType.String);
  assert.equal(workbook.getWorksheet("Sales")!.getCell("B2").value, "2026-10-01");
  assert.equal(workbook.getWorksheet("Sales")!.views[0].state, "frozen");
});
test("stored seconds and cost-writer milliseconds retain the same actual update instant in preview and XLSX", async () => {
  const a = await actor(); await daily(a, 100, 20); await daily(a, 200, 40, "2026-10-02");
  const instant = "2026-10-01T09:10:11.000Z", milliseconds = Date.parse(instant);
  await fixture.database.prepare("UPDATE daily_business_metrics SET updated_at=CASE WHEN business_date='2026-10-01' THEN ? ELSE ? END WHERE organization_id=?").bind(milliseconds / 1000, milliseconds, a.organization).run();
  const review: StudioExecutiveReview = await expect(await GET(request(a)), 200);
  assert.deepEqual(review.sales.rows.map(row => row.updatedUtc), [instant, instant]);
  assert.equal(review.metadata.latestRecordUpdateUtc, instant);
  const response = await GET(request(a, `&format=xlsx&snapshot=${review.metadata.snapshotHash}`)); assert.equal(response.status, 200);
  const book = new ExcelJS.Workbook(); await book.xlsx.load(await response.arrayBuffer());
  const sales = book.getWorksheet("Sales")!, updatedColumn = sales.columnCount;
  assert.equal(sales.getCell(1, updatedColumn).value, "Record updated UTC");
  assert.equal(sales.getCell(2, updatedColumn).value, instant); assert.equal(sales.getCell(3, updatedColumn).value, instant);
});
test("Studio enforces role, independent export entitlement, inaccessible location, revoked membership and MFA", async () => {
  const starter = await actor("starter"); await daily(starter, 100, 20);
  await expect(await GET(request(starter)), 200); await expect(await GET(request(starter, "&format=xlsx")), 403);
  const a = await actor(), b = await actor();
  await expect(await GET(request(a, `&location=${b.location}`)), 403); await expect(await GET(request(a, "", "aal1")), 403);
  await fixture.database.prepare("UPDATE memberships SET status='suspended' WHERE organization_id=? AND user_id=?").bind(a.organization, a.user).run();
  await expect(await GET(request(a)), 403);
});
test("Studio rejects changed snapshot and full scopes above its limit instead of exporting a visible-row sample", async () => {
  const a = await actor(); await daily(a, 100, 20);
  const review = await expect(await GET(request(a)), 200);
  await fixture.database.prepare("UPDATE daily_business_metrics SET net_sales_cents=101,updated_at=2 WHERE organization_id=?").bind(a.organization).run();
  const changed = await expect(await GET(request(a, `&format=xlsx&snapshot=${review.metadata.snapshotHash}`)), 409);
  assert.equal(changed.error.code, "STUDIO_RECORDS_CHANGED");
  await fixture.database.prepare("WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n<?) INSERT INTO daily_business_metrics(organization_id,business_date,location_ref,gross_sales_cents,net_sales_cents,cost_of_goods_cents,transaction_count,units_sold,created_by_user_id,created_at,updated_at) SELECT ?,'2026-10-01','legacy-'||n,1,1,0,1,1,?,1,1 FROM numbers").bind(STUDIO_MAX_RECORDS, a.organization, a.user).run();
  const large = await expect(await GET(request(a, "&format=xlsx")), 409); assert.equal(large.error.code, "STUDIO_SCOPE_TOO_LARGE");
});
test("workbook treats formula-like labels and long identifiers as text and preserves exact large amounts", async () => {
  const a = await actor(); await daily(a, 100, 20); const review: StudioExecutiveReview = await expect(await GET(request(a)), 200);
  review.sales.rows[0] = { ...review.sales.rows[0], id: "000012345678901234567890", locationRef: '=HYPERLINK("https://example.invalid")', netSalesCents: 9007199254740991, costOfGoodsCents: null, transactionCount:Number.MAX_SAFE_INTEGER,unitsSold:0.125 };
  review.sales.summary = studioSalesSummary(review.sales.rows);
  const bytes = await executiveReviewXlsx(review), workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(new Uint8Array(bytes).buffer);
  const sales = workbook.getWorksheet("Sales")!;
  assert.equal(sales.getCell("A2").value, "000012345678901234567890"); assert.equal(sales.getCell("C2").type, ExcelJS.ValueType.String);
  assert.equal(sales.getCell("E2").value, "90071992547409.91"); assert.equal(sales.getCell("F2").value, "9007199254740991");
  assert.equal(sales.getCell("G2").value, "9007199254740991"); assert.equal(sales.getCell("H2").value,0.125);
  for (const sheet of workbook.worksheets) sheet.eachRow(row => row.eachCell(cell => assert.notEqual(cell.type, ExcelJS.ValueType.Formula)));
});

test("preview fingerprints bind dates and reporting settings even when source rows are unchanged", async () => {
  const a=await actor(); await daily(a,100,20);
  const review:StudioExecutiveReview=await expect(await GET(request(a)),200);
  const base=request(a,`&format=xlsx&snapshot=${review.metadata.snapshotHash}`);
  const changedPeriod=new Request(base.url.replace("to=2026-10-02","to=2026-10-03"),{headers:base.headers});
  const period=await expect(await GET(changedPeriod),409); assert.equal(period.error.code,"STUDIO_RECORDS_CHANGED");
  await fixture.database.prepare("UPDATE workspaces SET timezone='Asia/Tokyo' WHERE id=?").bind(a.organization).run();
  const settings=await expect(await GET(base),409); assert.equal(settings.error.code,"STUDIO_RECORDS_CHANGED");
});
test("fractional quantities survive the actual stored-row API and numeric XLSX cells",async()=>{
  const a=await actor(); await daily(a,100,20);
  await fixture.database.prepare("UPDATE daily_business_metrics SET units_sold=0.125 WHERE organization_id=?").bind(a.organization).run();
  const review:StudioExecutiveReview=await expect(await GET(request(a)),200); assert.equal(review.sales.summary?.unitsSold,0.125);
  const r=await GET(request(a,`&format=xlsx&snapshot=${review.metadata.snapshotHash}`)); assert.equal(r.status,200);
  const book=new ExcelJS.Workbook(); await book.xlsx.load(await r.arrayBuffer()); assert.equal(book.getWorksheet("Sales")!.getCell("H2").value,0.125);
});

test("a posted standard BookLoQ cash account populates the separately labelled accounting section", async () => {
  const a=await actor(); await daily(a,100,20);
  await fixture.database.prepare("INSERT INTO tenant_addons(id,organization_id,addon_key,status,created_at,updated_at) VALUES (?,?,'bookloq','active',1,1)").bind(crypto.randomUUID(),a.organization).run();
  await fixture.database.prepare("INSERT INTO bookloq_settings(organization_id,status,updated_by_user_id,created_at,updated_at) VALUES (?,'active',?,1,1)").bind(a.organization,a.user).run();
  const period=crypto.randomUUID(),cash=crypto.randomUUID(),capital=crypto.randomUUID(),entry=crypto.randomUUID();
  await fixture.database.prepare("INSERT INTO accounting_periods(id,organization_id,label,start_date,end_date,status,created_at,updated_at) VALUES (?,?,'Fixture','2026-01-01','2026-12-31','open',1,1)").bind(period,a.organization).run();
  for(const [id,code,type,subtype,normal,key] of [[cash,'1000','asset','bank','debit','operating_cash'],[capital,'3000','equity','owner_equity','credit','owner_equity']]) await fixture.database.prepare("INSERT INTO financial_accounts(id,organization_id,code,name,account_type,account_subtype,normal_balance,system_key,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,1,1,1)").bind(id,a.organization,code,code,type,subtype,normal,key).run();
  await fixture.database.prepare("INSERT INTO journal_entries(id,organization_id,entry_number,entry_date,posting_date,period_id,status,source_type,memo,currency,total_debit_cents,total_credit_cents,idempotency_key,prepared_by_user_id,posted_at,created_at,updated_at) VALUES (?,?,'Fixture','2026-10-01','2026-10-01',?,'posted','manual','Fictional','CAD',12345,12345,?,?,1790870400,1,1)").bind(entry,a.organization,period,entry,a.user).run();
  for(const [line,account,debit,credit] of [[1,cash,12345,0],[2,capital,0,12345]]) await fixture.database.prepare("INSERT INTO journal_lines(id,organization_id,journal_entry_id,line_number,account_id,description,debit_cents,credit_cents,created_at) VALUES (?,?,?,?,?,'Fictional',?,?,1)").bind(crypto.randomUUID(),a.organization,entry,line,account,debit,credit).run();
  const review:StudioExecutiveReview=await expect(await GET(request(a)),200);
  assert.equal(review.cash.state,"recorded"); assert.equal(review.cash.ledgerCents,12345); assert.equal(review.ledger?.dataMode,"live");
  assert.equal(review.ledger?.balanceDifferenceCents,0); assert.equal(review.sales.summary?.netSalesCents,100);
  await fixture.database.prepare("UPDATE bookloq_settings SET data_mode='demonstration' WHERE organization_id=?").bind(a.organization).run();
  const demo:StudioExecutiveReview=await expect(await GET(request(a)),200); assert.match(demo.cash.reason,/Demonstration accounting data/);
});

test("restricted fields are removed server-side and permission changes invalidate a captured review", async () => {
  const a = await actor("pro", "employee"); await daily(a, 10000, 5000);
  const role = crypto.randomUUID();
  await fixture.database.prepare("INSERT INTO access_roles(id,organization_id,name,permissions_json,created_by_user_id,created_at,updated_at) VALUES (?,?,'Sales reviewer',?,?,1,1)").bind(role, a.organization, JSON.stringify(["reports.operational", "metrics.revenue", "reports.export"]), a.user).run();
  await fixture.database.prepare("INSERT INTO team_members(id,organization_id,user_id,role_id,first_name,last_name,email,employee_code,permitted_locations_json,status,remote_login,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,'Fictional','Reviewer',?,'TEST',?,'active',1,?,1,1)").bind(crypto.randomUUID(), a.organization, a.user, role, a.email, JSON.stringify([a.location]), a.user).run();
  const review: StudioExecutiveReview = await expect(await GET(request(a)), 200);
  assert.equal(review.margin.state, "restricted"); assert.equal(review.sales.summary?.grossProfitCents, null);
  assert.ok(review.sales.rows.length); assert.equal(review.ledger, undefined);
  for (const row of review.sales.rows) for (const field of ["costOfGoodsCents", "refundsCents", "discountsCents", "sourceProvider", "sourceConnectionId", "sourceImportId"]) assert.equal(field in row, false, field);
  const scope = { from: "2026-10-01", to: "2026-10-02", location: null, connection: null };
  const policy = await studioPolicy(request(a), scope, true);
  await fixture.database.prepare("UPDATE access_roles SET permissions_json=? WHERE id=?").bind(JSON.stringify(["reports.operational", "metrics.revenue"]), role).run();
  await assert.rejects(() => revalidateStudioPolicy(request(a), scope, true, policy.fingerprint), { code: "INSUFFICIENT_PERMISSION" });
  await expect(await GET(request(a, "&format=xlsx")), 403);
});

test("revocation during extraction prevents a download and currencies and unsupported filters fail closed", async () => {
  const a = await actor(); await daily(a, 100, 20);
  await expect(await GET(request(a, "&organizationId=other")), 400);
  await expect(await GET(request(a, "&format=xlsx&format=preview")), 400);
  await fixture.database.prepare("UPDATE organization_locations SET currency='USD' WHERE id=?").bind(a.location).run();
  await expect(await GET(request(a)), 409);
  await fixture.database.prepare("UPDATE organization_locations SET currency='CAD' WHERE id=?").bind(a.location).run();
  fixture.beforeBatch(items => {
    if (items.some(item => /SELECT[\s\S]*daily_business_metrics/.test(item.sql))) {
      fixture.beforeBatch(undefined);
      fixture.sqlite.prepare("UPDATE memberships SET status='suspended' WHERE organization_id=?").run(a.organization);
    }
  });
  try { await expect(await GET(request(a, "&format=xlsx")), 403); }
  finally { fixture.beforeBatch(undefined); }
});
