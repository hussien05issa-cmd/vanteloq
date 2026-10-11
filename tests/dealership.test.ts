import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { allocateDealershipAmount, DEALERSHIP_CSV_TEMPLATE, dealershipDate, dealershipInstant, parseDealershipCsv, requireDealershipCurrency, validateDealershipCredits, type DealershipPermissions } from "../domain/dealership";
import { exportDealership, mutateDealership, readDealership } from "../server/dealership";
import type { AccessContext } from "../server/authorization";

const vehicle = { identifierKind: "vin", identifier: "1HGCM82633A004352", year: 2003, make: "Honda", model: "Accord", stockNumber: "A-01", acquiredDate: "2026-09-01" };
const permissions: DealershipPermissions = { stockEdit: true, import: true, export: true, costs: true, profit: true, costEdit: true, costApprove: true, tasks: true, tasksEdit: true, sales: true, salesEdit: true, customers: true, customersEdit: true };

test("dealership credits preserve whole-vehicle sales, exact cents and explicit unassigned credit", () => {
  assert.deepEqual(allocateDealershipAmount(10001, [{ personId: "a", shareBps: 6000 }, { personId: "b", shareBps: 4000 }]).map(row => row.amountCents), [6001, 4000, 0]);
  for (const amount of [-10001, -1, 0, 1, 99999999]) {
    const allocated = allocateDealershipAmount(amount, [{ personId: "a", shareBps: 3333 }, { personId: "b", shareBps: 3333 }]);
    assert.equal(allocated.reduce((sum, row) => sum + row.amountCents, 0), amount);
    assert.equal(allocated[2].shareBps, 3334);
  }
  assert.throws(() => validateDealershipCredits([{ personId: "a", shareBps: 6000 }, { personId: "b", shareBps: 6000 }]), /100%/);
  assert.throws(() => validateDealershipCredits([{ personId: "a", shareBps: 5000 }, { personId: "a", shareBps: 5000 }]), /once/);
  assert.throws(() => validateDealershipCredits([{ personId: "a", shareBps: 0.1 }]), /basis points/);
  assert.deepEqual(validateDealershipCredits([]), []);
});

test("dealership imports keep unknown amounts and physical, preparation and ownership states separate", () => {
  const csv = `${DEALERSHIP_CSV_TEMPLATE}vin,1HGCM82633A004352,2003,Honda,Accord,A-01,2026-09-01,consignment,offsite,blocked,\n`;
  const [row] = parseDealershipCsv(csv, "CAD");
  assert.equal(row.askingCents, null); assert.equal(row.ownership, "consignment"); assert.equal(row.physicalStatus, "offsite"); assert.equal(row.prepStatus, "blocked");
  assert.equal(row.vehicle.acquisitionCents, null);
  assert.throws(() => parseDealershipCsv(csv + csv.split("\n")[1], "CAD"), /repeats/);
  assert.throws(() => parseDealershipCsv(csv.replace("blocked", "sold"), "CAD"), /preparation/);
  assert.throws(() => dealershipDate("2026-02-30", "delivery"), /real/);
  assert.throws(() => dealershipInstant("2026-10-01T12:00"), /offset/);
  assert.equal(dealershipInstant("2026-10-01T12:00-06:00"), "2026-10-01T18:00:00.000Z");
  requireDealershipCurrency("CAD"); requireDealershipCurrency("USD");
  assert.throws(() => requireDealershipCurrency("JPY"), /two decimal/);
  assert.throws(() => requireDealershipCurrency("BHD"), /two decimal/);
});

/** Real SQLite transactions with D1's prepared/batch interface, no worker build or network. */
function fixture() {
  const database = new DatabaseSync(":memory:");
  let beforeBatch: (() => void) | undefined;
  for (const file of readdirSync(new URL("../drizzle/", import.meta.url)).filter(file => /^\d{4}.*\.sql$/.test(file)).sort()) database.exec(readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8").replaceAll("--> statement-breakpoint", ""));
  database.exec("PRAGMA foreign_keys=ON");
  class Prepared {
    values: unknown[] = [];
    constructor(readonly sql: string) {}
    bind(...values: unknown[]) { const p = new Prepared(this.sql); p.values = values; return p; }
    query() { return database.prepare(this.sql); }
    async all() { return { success: true, results: this.query().all(...this.values as never[]), meta: {} }; }
    async first(column?: string) { const row = this.query().get(...this.values as never[]); return row ? column ? row[column] : row : null; }
    async raw() { const q = this.query(); q.setReturnArrays(true); return q.all(...this.values as never[]); }
    async run() { const result = this.query().run(...this.values as never[]); return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }; }
  }
  const binding = { prepare: (sql: string) => new Prepared(sql), batch: async (items: Prepared[]) => {
    const hook = beforeBatch; beforeBatch = undefined; hook?.();
    database.exec("BEGIN IMMEDIATE");
    try { const results = []; for (const item of items) results.push(await item.run()); database.exec("COMMIT"); return results; }
    catch (error) { database.exec("ROLLBACK"); throw error; }
  } };
  const runtime = globalThis as typeof globalThis & { __vanteloqEnv?: { DB?: D1Database } };
  const previous = runtime.__vanteloqEnv;
  runtime.__vanteloqEnv = { DB: binding as unknown as D1Database };
  database.exec(`INSERT INTO users(id,email,display_name,created_at,updated_at) VALUES('owner','owner@example.invalid','Owner',1,1),('person-a','a@example.invalid','Person A',1,1),('person-b','b@example.invalid','Person B',1,1);
    INSERT INTO workspaces(id,owner_name,business_name,legal_name,business_email,industry,city,address,postal_code,hours_json,created_at,updated_at) VALUES('a','Owner','Dealer A','Dealer A','a@example.invalid','Dealership','Edmonton','1 Test','T5A1A1','[]',1,1),('b','Other','Dealer B','Dealer B','b@example.invalid','Dealership','Edmonton','2 Test','T5A1A1','[]',1,1);
    INSERT INTO memberships(id,user_id,organization_id,role,created_at,updated_at) VALUES('m-owner','owner','a','owner',1,1),('m-a','person-a','a','employee',1,1),('m-b','person-b','a','employee',1,1);
    INSERT INTO organization_locations(id,organization_id,name,country_code,address_line_1,locality,administrative_area,timezone,currency,created_at,updated_at) VALUES('a-loc','a','Main','CA','1 Test','Edmonton','AB','America/Edmonton','CAD',1,1),('a-second','a','Other','CA','2 Test','Edmonton','AB','America/Edmonton','CAD',1,1),('b-loc','b','Foreign','CA','3 Test','Edmonton','AB','America/Edmonton','CAD',1,1);`);
  const context = { organizationId: "a", userId: "owner", role: "owner", organization: { timezone: "America/Edmonton", currency: "CAD" } } as AccessContext;
  const write = (body: Record<string, unknown>, allowed = permissions) => mutateDealership(context, allowed, { mutationKey: crypto.randomUUID(), ...body });
  const acquire = (overrides: Record<string, unknown> = {}) => write({ action: "acquire", locationId: "a-loc", vehicle, ownership: "owned", physicalStatus: "on_lot", prepStatus: "ready", ...overrides });
  return { database, context, write, acquire, beforeBatch(hook: () => void) { beforeBatch = hook; }, read: (params = new URLSearchParams(), allowed = permissions) => readDealership(context, allowed, params), dispose() { runtime.__vanteloqEnv = previous; database.close(); } };
}

test("dealership workflow atomically reserves and delivers one vehicle, freezes costs, reverses without invented restocking", async () => {
  const f = fixture();
  try {
    const acquired = await f.acquire(); assert.ok("id" in acquired); const id = acquired.id;
    await f.write({ action: "add_cost", episodeId: id, category: "acquisition", status: "posted", amountCents: 1000000, description: "Purchase", sourceReference: "invoice-a" });
    await f.write({ action: "add_cost", episodeId: id, category: "preparation", status: "estimated", amountCents: 50000, description: "Estimate" });
    let row = (await f.read()).stock[0]; assert.equal(row.postedCostCents, 1000000); assert.equal(row.costComplete, false);
    await f.write({ action: "update_stock", episodeId: id, expectedVersion: row.version, physicalStatus: "on_lot", prepStatus: "ready", availability: "available", askingCents: null, costComplete: true });
    row = (await f.read()).stock[0];
    await f.write({ action: "reserve", episodeId: id, expectedVersion: row.version, expiresAt: new Date(Date.now() + 3600000).toISOString() });
    await assert.rejects(f.write({ action: "reserve", episodeId: id, expectedVersion: row.version, expiresAt: new Date(Date.now() + 3600000).toISOString() }), /changed|unavailable/);
    assert.equal(f.database.prepare("SELECT count(*) n FROM dealership_reservations WHERE status='active'").get()?.n, 1);
    row = (await f.read()).stock[0];
    await assert.rejects(f.write({ action: "transfer", episodeId: id, expectedVersion: row.version, locationId: "a-second" }), /changed|unavailable/);
    const delivery = { action: "deliver", episodeId: id, expectedVersion: row.version, deliveredDate: "2026-10-01", channel: "retail", amountCents: 1200001, credits: [{ personId: "person-a", shareBps: 6000 }, { personId: "person-b", shareBps: 4000 }], mutationKey: "deliver-once" };
    const sale = await f.write(delivery); assert.ok("id" in sale);
    assert.equal((await f.write(delivery) as { replayed?: boolean }).replayed, true);
    const report = await f.read(new URLSearchParams("from=2026-10-01&to=2026-10-02"));
    assert.equal(report.summary.currencies[0].deliveredUnits, 1); assert.equal(report.summary.currencies[0].vehicleSalesCents, 1200001);
    assert.equal(report.sales[0].grossCents, 200001); assert.equal(report.sales[0].credits.reduce((sum, credit) => sum + credit.allocatedSalesCents!, 0), 1200001);
    await assert.rejects(f.write({ action: "add_cost", episodeId: id, category: "other", status: "posted", amountCents: 1, description: "Late cost", sourceReference: "late" }), /closed/);
    await f.write({ action: "reverse_sale", saleId: sale.id, date: "2026-10-02", reason: "Delivery reversed after review" });
    const reversed = await f.read(new URLSearchParams("from=2026-10-02&to=2026-10-02"));
    assert.equal(reversed.summary.currencies[0].deliveredUnits, 0); assert.equal(reversed.summary.currencies[0].reversedUnits, 1);
    assert.equal(reversed.stock[0].availability, "delivered");
    await f.acquire({ vehicle: { ...vehicle, stockNumber: "REACQUIRED", acquiredDate: "2026-10-02" } });
    assert.equal(f.database.prepare("SELECT count(*) n FROM dealership_vehicle_identities").get()?.n, 1);
    assert.equal(f.database.prepare("SELECT count(*) n FROM dealership_stock_episodes").get()?.n, 2);
    f.database.exec("DELETE FROM users WHERE id='person-a'");
    const credit = f.database.prepare("SELECT person_id,person_name,share_bps FROM dealership_sale_credits WHERE share_bps=6000").get();
    assert.equal(credit?.person_id, null); assert.equal(credit?.person_name, "Former member"); assert.equal(credit?.share_bps, 6000);
    assert.equal(f.database.prepare("SELECT count(*) n FROM dealership_write_guards").get()?.n, 0);
  } finally { f.dispose(); }
});

test("imports are previewed, idempotent across normalized file retries and retain full scoped counts and exports", async () => {
  const f = fixture();
  try {
    const csv = DEALERSHIP_CSV_TEMPLATE + Array.from({ length: 100 }, (_, i) => `vin,1HGCM82633A00${String(i).padStart(4, "0")},2003,Honda,Accord,CSV-${i},2026-09-01,owned,on_lot,not_started,`).join("\n");
    const preview = await f.write({ action: "preview", locationId: "a-loc", csv }); assert.ok("fingerprint" in preview);
    assert.equal((await f.read()).stock.length, 0);
    const payload = { action: "confirm", locationId: "a-loc", csv, fingerprint: preview.fingerprint };
    await f.write(payload); assert.equal((await f.write(payload) as { replayed?: boolean }).replayed, true);
    await f.acquire();
    const page = await f.read(); assert.equal(page.stock.length, 100); assert.ok(page.nextCursor); assert.equal(page.summary.activeStock, 101);
    assert.equal((await f.read(new URLSearchParams(`after=${page.nextCursor}`))).stock.length, 1);
    const exported = await exportDealership(f.context, permissions, new URLSearchParams("format=csv&export=stock"));
    assert.equal(exported.csv.trim().split("\r\n").length, 102);
    const restricted = { ...permissions, costs: false, profit: false, sales: false, customers: false, export: true };
    const read = await f.read(undefined, restricted); assert.equal(read.costs.length, 0); assert.equal(read.sales.length, 0); assert.ok(read.stock.every(row => row.postedCostCents === null));
    const redacted = await exportDealership(f.context, restricted, new URLSearchParams()); assert.doesNotMatch(redacted.csv, /postedCostCents|costComplete/);
    await assert.rejects(exportDealership(f.context, restricted, new URLSearchParams("export=sales")), /permissions/);
    await assert.rejects(f.acquire({ locationId: "b-loc" }), /location/);
    await assert.rejects(f.write({ action: "add_cost", episodeId: page.stock[0].id, category: "other", status: "posted", amountCents: 1, description: "Invoice", sourceReference: "invoice" }, { ...permissions, costApprove: false }), /permissions/);
    assert.equal(f.database.prepare("SELECT count(*) n FROM dealership_write_guards").get()?.n, 0);
  } finally { f.dispose(); }
});

test("legacy adoption leaves sold delivery dates absent and costs unverified; customer work is scoped and versioned", async () => {
  const f = fixture();
  try {
    f.database.exec("INSERT INTO inventory_vehicles(id,organization_id,location_id,identifier_kind,identifier,model_year,make,model,stock_number,status,acquired_date,currency,source,acquisition_cents,created_at,updated_at) VALUES('legacy','a','a-loc','vin','1HGCM82633A004352',2003,'Honda','Accord','OLD','sold','2026-09-01','CAD','manual',10000,1,1)");
    await f.write({ action: "adopt_legacy", locationId: "a-loc" });
    const report = await f.read(); assert.equal(report.stock[0].availability, "legacy_sold"); assert.equal(report.stock[0].postedCostCents, null); assert.equal(report.stock[0].ownership, "unknown"); assert.equal(report.sales.length, 0); assert.equal(report.legacyAvailable, 0);
    assert.equal(f.database.prepare("SELECT exit_date FROM dealership_stock_episodes").get()?.exit_date, null);
    const lead = await f.write({ action: "save_lead", locationId: "a-loc", customerName: "Test customer", contact: "customer reference", stage: "new", assigneeId: "person-a", nextActionDate: "2026-10-02" }); assert.ok("id" in lead);
    await f.write({ action: "save_task", leadId: lead.id, title: "Customer requested a follow-up", status: "blocked", blockedReason: "Awaiting response", assigneeId: "person-a", dueDate: "2026-10-02" });
    await f.write({ action: "save_appointment", leadId: lead.id, scheduledAt: "2026-10-01T12:00-06:00", status: "attended" });
    assert.equal((await f.read()).tasks.length, 1); assert.equal((await f.read()).appointments.length, 1);
    assert.equal((await f.read(undefined, { ...permissions, customers: false })).tasks.length, 0);
    await assert.rejects(f.write({ action: "save_lead", id: lead.id, expectedVersion: 99, locationId: "a-loc", customerName: "Changed", contact: "", stage: "contacted" }), /changed/);
    f.database.exec("DELETE FROM users WHERE id='person-a'"); assert.equal((await f.read()).leads[0].assigneeId, null); assert.equal((await f.read()).tasks[0].assigneeId, null);
    f.database.exec("DELETE FROM workspaces WHERE id='a'");
    assert.equal(f.database.prepare("SELECT count(*) n FROM dealership_stock_episodes").get()?.n, 0);
  } finally { f.dispose(); }
});

test("two deleted credit recipients keep distinct allocation keys and preserve an unassigned remainder", async () => {
  const f = fixture();
  try {
    const acquired = await f.acquire(); assert.ok("id" in acquired);
    await f.write({ action: "deliver", episodeId: acquired.id, expectedVersion: 1, deliveredDate: "2026-10-01", channel: "retail", amountCents: 10001, credits: [{ personId: "person-a", shareBps: 3000 }, { personId: "person-b", shareBps: 4000 }] });
    f.database.exec("DELETE FROM users WHERE id IN ('person-a','person-b')");
    const sale = (await f.read(new URLSearchParams("from=2026-10-01&to=2026-10-02"))).sales[0];
    assert.equal(sale.unallocatedBps, 3000);
    assert.equal(new Set(sale.credits.map(row => row.personId)).size, 2);
    assert.ok(sale.credits.every(row => row.personId.startsWith("deleted:") && row.name === "Former member"));
    assert.deepEqual(sale.credits.map(row => row.allocatedSalesCents).sort((a, b) => a! - b!), [3000, 4001]);
    const full = allocateDealershipAmount(sale.amountCents, sale.credits);
    assert.equal(full.reduce((sum, row) => sum + row.amountCents, 0), 10001);
    assert.equal(full.find(row => row.personId === null)?.amountCents, 3000);
  } finally { f.dispose(); }
});

test("a transfer between parent authorization and task save rolls back the scoped task and its receipt", async () => {
  const f = fixture();
  try {
    const acquired = await f.acquire(); assert.ok("id" in acquired);
    f.beforeBatch(() => { f.database.prepare("UPDATE dealership_stock_episodes SET location_id='a-second',version=version+1 WHERE id=?").run(acquired.id); });
    await assert.rejects(f.write({ action: "save_task", mutationKey: "stale-task", episodeId: acquired.id, title: "Prepare stock", status: "open", assigneeId: null }), /changed|unavailable/);
    assert.equal(f.database.prepare("SELECT count(*) n FROM dealership_tasks").get()?.n, 0);
    assert.equal(f.database.prepare("SELECT count(*) n FROM dealership_mutations WHERE mutation_key='stale-task'").get()?.n, 0);
    assert.equal(f.database.prepare("SELECT count(*) n FROM dealership_write_guards").get()?.n, 0);
  } finally { f.dispose(); }
});
