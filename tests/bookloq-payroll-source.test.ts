import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { bookloqPayrollSourceAllowed, buildBookloqPayrollSource, type PayrollSourceRow } from "../domain/bookloq-payroll-source.ts";
import { loadBookloqPayrollSource, readBookloqPayrollSourceRows } from "../server/bookloq-payroll-source.ts";
import type { AccessContext } from "../server/authorization.ts";
import type { VanteloqRuntimeEnv } from "../db/index.ts";

const now = Date.parse("2026-10-09T12:00:00Z");
const row = (overrides: Partial<PayrollSourceRow> = {}): PayrollSourceRow => ({ id: "current", accountName: "Payroll organization", status: "connected", promotionStatus: "staging", lastSuccessfulSyncAt: now / 1000, mappedLocationCount: 1, lastErrorCode: null, syncLeaseOwner: null, latestSyncStatus: "completed", latestWarningCount: 0, reportId: "report", periodFrom: "2026-09-01", periodTo: "2026-09-30", importedAtMs: now, ...overrides });

test("payroll source access requires every source permission and a supported role", () => {
  const permissions = ["payroll.totals", "integrations.view"];
  for (const role of ["owner", "admin", "manager"]) assert.equal(bookloqPayrollSourceAllowed(permissions, role), true);
  for (const role of ["employee", "read_only", "integration"]) assert.equal(bookloqPayrollSourceAllowed(permissions, role), false);
  for (const removed of permissions) assert.equal(bookloqPayrollSourceAllowed(permissions.filter(permission => permission !== removed), "owner"), false);
});

test("unauthorized, demo and non-preview callers do not read payroll sources", { concurrency: false }, async () => {
  const input = { allowed: false, dataMode: "live", locationId: null };
  assert.equal((await loadBookloqPayrollSource({} as AccessContext, input)).status, "restricted");
  assert.equal((await loadBookloqPayrollSource({ role: "employee" } as AccessContext, { ...input, allowed: true })).status, "restricted");
  const context = { role: "owner" } as AccessContext;
  assert.equal((await loadBookloqPayrollSource(context, { ...input, allowed: true, dataMode: "demonstration" })).status, "unavailable");
  const runtime = globalThis as typeof globalThis & { __vanteloqEnv?: VanteloqRuntimeEnv };
  const previous = runtime.__vanteloqEnv;
  runtime.__vanteloqEnv = { VANTELOQ_INTERNAL_ACCESS_ENABLED: "false" };
  try {
    // No DB binding exists: any source read would throw.
    const result = await loadBookloqPayrollSource(context, { ...input, allowed: true });
    assert.equal(result.status, "unavailable");
    assert.deepEqual(result.connections, []);
    assert.equal(result.configuredEnvironment, null);
  } finally { runtime.__vanteloqEnv = previous; }
});

test("staged payroll metadata stays distinct from production provenance and posted payroll", () => {
  for (const environment of ["sandbox", "production"] as const) {
    const result = buildBookloqPayrollSource([row(), row(), row({ reportId: "newer-period", periodFrom: "2026-10-01", periodTo: "2026-10-07", importedAtMs: now - 1000 })], environment);
    assert.equal(result.status, "staged");
    assert.equal(result.configuredEnvironment, environment);
    assert.equal(result.recordEnvironment, "unverified");
    assert.equal(result.connections[0].reportCount, 2);
    assert.deepEqual(result.connections[0].latestReportPeriod, { start: "2026-10-01", end: "2026-10-07" });
    assert.equal(result.connections[0].lastImportedAt, now / 1000);
    assert.equal(result.connections[0].lastSuccessfulSyncAt, now / 1000);
    assert.match(result.boundary, /do not post journals, taxes, payroll liabilities or cash movements/);
  }
  assert.equal(buildBookloqPayrollSource([], "sandbox").status, "not_connected");
  assert.equal(buildBookloqPayrollSource([row({ promotionStatus: "approved" })], "production").status, "staged", "approved connection cannot certify payroll finality");
});

test("incomplete or invalid retained evidence requires review", () => {
  for (const overrides of [{ latestWarningCount: 1 }, { latestSyncStatus: "failed" }, { status: "error" }, { promotionStatus: "blocked" }, { syncLeaseOwner: "active" }, { mappedLocationCount: 0 }, { reportId: null }, { periodFrom: "2026-02-31" }, { periodTo: "2026-08-01" }, { importedAtMs: -1 }]) {
    const result = buildBookloqPayrollSource([row(overrides)], "sandbox");
    assert.equal(result.status, "needs_review", JSON.stringify(overrides));
    assert.ok(result.connections[0].reviewReasons.length);
  }
  const invalid = buildBookloqPayrollSource([row(), row({ reportId: "bad", periodTo: "invalid" })], "sandbox");
  assert.equal(invalid.connections[0].reportCount, 0);
  assert.equal(invalid.connections[0].latestReportPeriod, null);
});

test("Deel source reads enforce tenant, current namespace, location mapping and staging boundaries without financial writes", { timeout: 120000 }, async () => {
  const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('ok')}}", d1Databases: { DB: `payroll-source-${crypto.randomUUID()}` } });
  try {
    const database = await mf.getD1Database("DB") as unknown as D1Database;
    for (const file of (await readdir(new URL("../drizzle/", import.meta.url))).filter(file => /^\d{4}.*\.sql$/.test(file)).sort()) {
      for (const sql of (await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8")).split("--> statement-breakpoint").map(text => text.trim()).filter(Boolean)) await database.prepare(sql).run();
    }
    for (const org of ["org", "other"]) await database.prepare("INSERT INTO workspaces(id,owner_name,business_name,legal_name,business_email,industry,city,address,postal_code,hours_json,created_at,updated_at) VALUES(?,'Test','Payroll','Payroll','test@example.invalid','Retail','Edmonton','Test','T5A1A1','[]',1,1)").bind(org).run();
    for (const [id, org] of [["north", "org"], ["south", "org"], ["foreign-location", "other"]]) await database.prepare("INSERT INTO organization_locations(id,organization_id,name,country_code,address_line_1,locality,administrative_area,timezone,currency,created_at,updated_at) VALUES(?,?,?,'CA','Test','Edmonton','AB','America/Edmonton','CAD',1,1)").bind(id, org, id).run();
    for (const [id, org, status, promotion, lease, error] of [["current", "org", "connected", "staging", null, null], ["foreign", "other", "connected", "staging", null, null], ["revoked", "org", "revoked", "blocked", null, null], ["blocked", "org", "connected", "blocked", null, null], ["syncing", "org", "connected", "staging", "lease", null], ["failed", "org", "connected", "staging", null, "DEEL_SYNC_FAILED"]]) {
      await database.prepare("INSERT INTO integration_connections(id,organization_id,provider,source_namespace,status,data_promotion_status,sync_lease_owner,last_error_code,connected_at,last_successful_sync_at,created_at,updated_at) VALUES(?,?,'deel',?,?,?,?,?,1,?,1,1)").bind(id, org, id, status, promotion, lease, error, now / 1000).run();
      await database.prepare("INSERT INTO integration_location_mappings(id,organization_id,provider,connection_id,external_location_ref,external_name,local_location_id,status,last_seen_at,created_at,updated_at) VALUES(?,?,'deel',?,'entity','Entity',?,'mapped',1,1,1)").bind(id, org, id, org === "org" ? "north" : "foreign-location").run();
      await database.prepare("INSERT INTO retail_measurements(id,organization_id,connection_id,provider,outlet_ref,kind,reference,period_from,period_to,source_label,values_json,version,updated_at) VALUES(?,?,?,'deel',?,'labour','deel-payroll-cycle:cycle:CAD','2026-09-01','2026-09-30','Deel available payroll-report aggregate',?,1,?)").bind(id, org, id, `${id}:entity`, '[{"values":{"finalized":true,"paid":true,"employeeName":"PRIVATE","wagesCents":999999}}]', now).run();
    }
    for (const [id, entity, location, state] of [["south-map", "south-entity", "south", "mapped"], ["bad-map", "other-entity", "foreign-location", "mapped"], ["ignored-map", "ignored-entity", "north", "ignored"]]) {
      await database.prepare("INSERT INTO integration_location_mappings(id,organization_id,provider,connection_id,external_location_ref,external_name,local_location_id,status,last_seen_at,created_at,updated_at) VALUES(?,'org','deel','current',?,'Entity',?,?,1,1,1)").bind(id, entity, location, state).run();
    }
    for (const [id, org, outlet, provider, label] of [["south-report", "org", "current:south-entity", "deel", "Deel available payroll-report aggregate"], ["old-generation", "org", "old:entity", "deel", "Deel available payroll-report aggregate"], ["tenant-mismatch", "other", "current:entity", "deel", "Deel available payroll-report aggregate"], ["invalid-location", "org", "current:other-entity", "deel", "Deel available payroll-report aggregate"], ["ignored-location", "org", "current:ignored-entity", "deel", "Deel available payroll-report aggregate"], ["wrong-provider", "org", "current:entity", "square", "Deel available payroll-report aggregate"], ["manual", "org", "current:entity", "deel", "Manual labour entry"]]) {
      await database.prepare("INSERT INTO retail_measurements(id,organization_id,connection_id,provider,outlet_ref,kind,reference,period_from,period_to,source_label,values_json,version,updated_at) VALUES(?,?,'current',?,?,'labour',?,'2026-10-01','2026-10-07',?,'[]',1,?)").bind(id, org, provider, outlet, `deel-payroll-cycle:${id}:CAD`, label, now).run();
    }
    const financialCounts = () => database.prepare("SELECT COUNT(*) n FROM journal_entries UNION ALL SELECT COUNT(*) FROM financial_transactions UNION ALL SELECT COUNT(*) FROM supplier_bills UNION ALL SELECT COUNT(*) FROM bookloq_budgets").all();
    const before = await financialCounts();
    const all = await readBookloqPayrollSourceRows(database, "org", null);
    assert.deepEqual(all.filter(item => item.reportId).map(item => item.reportId).sort(), ["current", "south-report"]);
    assert.equal(all.some(item => item.id === "revoked" || item.id === "foreign"), false);
    assert.equal(all.find(item => item.id === "current")?.mappedLocationCount, 2);
    assert.deepEqual((await readBookloqPayrollSourceRows(database, "org", "north")).filter(item => item.reportId).map(item => item.reportId), ["current"]);
    assert.deepEqual((await readBookloqPayrollSourceRows(database, "org", "south")).map(item => item.reportId), ["south-report"]);
    assert.deepEqual(await readBookloqPayrollSourceRows(database, "org", "foreign-location"), []);
    assert.equal(/PRIVATE|wagesCents|valuesJson|999999/.test(JSON.stringify(buildBookloqPayrollSource(all, "production"))), false);
    await database.prepare("UPDATE integration_connections SET source_namespace='replacement' WHERE id='current'").run();
    assert.equal((await readBookloqPayrollSourceRows(database, "org", "north")).filter(item => item.reportId).length, 0, "retained old-generation reports are not current connection evidence");
    assert.deepEqual((await financialCounts()).results, before.results);
    assert.equal((await database.prepare("PRAGMA foreign_key_check").all()).results?.length, 0);
  } finally { await mf.dispose(); }
});
