import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import type { VanteloqRuntimeEnv } from "../db";
import { POST as daily } from "../app/api/v1/daily-metrics/route";
import { POST as documents } from "../app/api/v1/documents/route";
import { POST as retail } from "../app/api/v1/retail-measurements/route";
import { POST as costs } from "../app/api/v1/inventory-costs/route";
import { POST as vehicles } from "../app/api/v1/vehicles/route";
import { POST as dealership } from "../app/api/v1/dealership/route";
import { REPORT_IMPORT_PRIVACY_VERSION, importPrivacyAcknowledgement, appendImportPrivacyAcknowledgement } from "../domain/report-import-privacy";
import { activateTestSubscription } from "./helpers/subscription-fixture.mjs";

let runtime: Miniflare, database: D1Database;
const globals = globalThis as typeof globalThis & { __vanteloqEnv?: VanteloqRuntimeEnv };
const originalEnv = globals.__vanteloqEnv, originalFetch = globalThis.fetch;
const identities = new Map<string, { subject: string; email: string }>();
let storedFiles = 0;
before(async () => {
  runtime = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('isolated')}}", d1Databases: { DB: crypto.randomUUID() } });
  database = await runtime.getD1Database("DB") as unknown as D1Database;
  for (const file of (await readdir("drizzle")).filter(file => /^\d{4}.*\.sql$/.test(file)).sort()) {
    for (const sql of (await readFile(`drizzle/${file}`, "utf8")).split("--> statement-breakpoint").filter(text => text.trim())) await database.prepare(sql).run();
  }
  globals.__vanteloqEnv = { DB: database, SUPABASE_URL: "https://fixture.supabase.co", SUPABASE_PUBLISHABLE_KEY: "fictional-key",
    BUCKET: { put: async () => { storedFiles++; }, delete: async () => {} } as unknown as R2Bucket };
  globalThis.fetch = (async (input, init) => {
    if (new URL(String(input)).hostname !== "fixture.supabase.co") throw new Error("No external provider calls are authorized in this fixture.");
    const token = new Headers(init?.headers).get("authorization")!.split(".")[1]!;
    const email = JSON.parse(Buffer.from(token, "base64url").toString()).email;
    const identity = identities.get(email)!;
    return Response.json({ id: identity.subject, email, email_confirmed_at: "2026-01-01", user_metadata: { full_name: "Fixture owner" } });
  }) as typeof fetch;
}, { timeout: 120_000 });
after(async () => { globalThis.fetch = originalFetch; globals.__vanteloqEnv = originalEnv; await runtime?.dispose(); });

async function fixture(role = "owner") {
  const userId = crypto.randomUUID(), organizationId = crypto.randomUUID(), locationId = crypto.randomUUID(), subject = `fixture:${userId}`, email = `${userId}@example.invalid`;
  identities.set(email, { subject, email });
  await database.batch([
    database.prepare("INSERT INTO workspaces(id,owner_name,business_name,legal_name,business_email,industry,city,address,postal_code,hours_json,created_at,updated_at) VALUES (?,'Fixture','Fixture','Fixture',?,'Car dealership','Edmonton','Test','T5A1A1','[]',1,1)").bind(organizationId, email),
    database.prepare("INSERT INTO users(id,email,auth_subject,auth_provider,display_name,status,created_at,updated_at) VALUES (?,?,?,'supabase','Fixture owner','active',1,1)").bind(userId, email, subject),
    database.prepare("INSERT INTO memberships(id,organization_id,user_id,role,status,created_at,updated_at) VALUES (?,?,?,?,'active',1,1)").bind(crypto.randomUUID(), organizationId, userId, role),
    database.prepare("INSERT INTO organization_locations(id,organization_id,name,status,country_code,address_line_1,address_line_2,address_line_3,locality,district,administrative_area,postal_code,timezone,currency,locale,tax_jurisdiction,validation_status,created_at,updated_at) VALUES (?,?,'Primary','active','CA','1 Test Avenue','','','Edmonton','','AB','T5A 1A1','America/Edmonton','CAD','en-CA','','validated',1,1)").bind(locationId, organizationId),
  ]);
  await activateTestSubscription(database, organizationId);
  return { userId, organizationId, locationId, email };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function request(ctx: Fixture, path: string, body: Record<string, unknown> | FormData, key = crypto.randomUUID(), origin = "https://vanteloq.example") {
  const token = Buffer.from(JSON.stringify({ email: ctx.email, aal: "aal2", session_id: `fixture-session:${ctx.userId}` })).toString("base64url");
  const multipart = body instanceof FormData;
  return new Request(`https://vanteloq.example/api/v1/${path}`, { method: "POST", headers: { Authorization: `Bearer test.${token}.signature`, Origin: origin,
    "Sec-Fetch-Site": "same-origin", "Idempotency-Key": key, ...(multipart ? {} : { "Content-Type": "application/json" }) }, body: multipart ? body : JSON.stringify(body) });
}
const row = { businessDate: "2026-09-01", locationRef: "all", grossSalesCents: 10000, netSalesCents: 9000, costOfGoodsCents: 5000, transactionCount: 10, unitsSold: 12 };
async function expect(response: Response, status: number) { assert.equal(response.status, status, await response.clone().text()); return response.json(); }
const receipt = async (ctx: Fixture, action: string) => database.prepare("SELECT organization_id,actor_user_id,created_at,details_json FROM audit_events WHERE organization_id=? AND action=? ORDER BY created_at DESC LIMIT 1").bind(ctx.organizationId, action).first<{organization_id:string;actor_user_id:string;created_at:number;details_json:string}>();
function assertReceipt(ctx: Fixture, saved: Awaited<ReturnType<typeof receipt>>) {
  assert.ok(saved); assert.equal(saved.organization_id, ctx.organizationId); assert.equal(saved.actor_user_id, ctx.userId);
  assert.ok(Math.abs(saved.created_at * 1000 - Date.now()) < 30_000);
  const details = JSON.parse(saved.details_json); assert.equal(details.importPrivacyVersion, REPORT_IMPORT_PRIVACY_VERSION); assert.equal(details.importPrivacyAccepted, true);
  assert.doesNotMatch(saved.details_json, /Fictional original|1HGCM|reference,|Fixture secret/);
}

test("every JSON import and preview rejects missing, false and stale acknowledgement before writes", async () => {
  const ctx = await fixture();
  const cases = [
    [daily, "daily-metrics", { rows: [row] }], [retail, "retail-measurements", { action: "save", kind: "stock" }],
    [costs, "inventory-costs", { source: "csv", entries: [] }], [vehicles, "vehicles", { action: "preview", csv: "Fixture secret" }],
    [vehicles, "vehicles", { action: "confirm", csv: "Fixture secret" }], [dealership, "dealership", { action: "preview", csv: "Fixture secret" }],
    [dealership, "dealership", { action: "confirm", csv: "Fixture secret" }],
  ] as const;
  for (const [handler, path, body] of cases) {
    for (const acknowledgement of [undefined, { version: REPORT_IMPORT_PRIVACY_VERSION, accepted: false }, { version: "old-notice", accepted: true }]) {
      const result = await expect(await handler(request(ctx, path, { ...body, importPrivacyAcknowledgement: acknowledgement })), acknowledgement?.version === "old-notice" ? 409 : 400);
      assert.equal(result.error.code, acknowledgement?.version === "old-notice" ? "REPORT_IMPORT_PRIVACY_STALE" : "REPORT_IMPORT_PRIVACY_REQUIRED");
    }
  }
  for (const table of ["daily_business_metrics", "data_imports", "retail_measurements", "inventory_vehicles", "dealership_stock_episodes", "audit_events"]) {
    assert.equal((await database.prepare(`SELECT COUNT(*) count FROM ${table} WHERE organization_id=?`).bind(ctx.organizationId).first<{count:number}>())!.count, 0);
  }
});

test("daily import acknowledgement is transactionally recorded without changing idempotency or source protection", async () => {
  const ctx = await fixture(), key = crypto.randomUUID(), body = { rows: [row], importPrivacyAcknowledgement: importPrivacyAcknowledgement() };
  await expect(await daily(request(ctx, "daily-metrics", body, key)), 201);
  assertReceipt(ctx, await receipt(ctx, "daily_metrics.imported"));
  assert.equal((await expect(await daily(request(ctx, "daily-metrics", body, key)), 200)).replayed, true);
  const conflict = await expect(await daily(request(ctx, "daily-metrics", { ...body, rows: [{ ...row, netSalesCents: 1 }] }, key)), 409);
  assert.equal(conflict.error.code, "IDEMPOTENCY_KEY_CONFLICT");
  const protectedSource = await expect(await daily(request(ctx, "daily-metrics", { ...body, rows: [{ ...row, locationRef: "square:protected" }] })), 409);
  assert.equal(protectedSource.error.code, "IMPORT_PROVIDER_SOURCE_PROTECTED");
  assert.equal((await database.prepare("SELECT net_sales_cents amount FROM daily_business_metrics WHERE organization_id=?").bind(ctx.organizationId).first<{amount:number}>())!.amount, 9000);
});

test("documents require multipart acknowledgement before private storage and retain separate processing consent", async () => {
  const ctx = await fixture(), initial = storedFiles;
  const form = () => { const value = new FormData(); value.set("file", new Blob(["%PDF-1.4\nFictional original\n%%EOF"], { type: "application/pdf" }), "fictional.pdf"); value.set("documentType", "other"); return value; };
  const missing = await expect(await documents(request(ctx, "documents", form())), 400); assert.equal(missing.error.code, "REPORT_IMPORT_PRIVACY_REQUIRED");
  const stale = form(); appendImportPrivacyAcknowledgement(stale); stale.set("importPrivacyVersion", "old-notice");
  assert.equal((await expect(await documents(request(ctx, "documents", stale)), 409)).error.code, "REPORT_IMPORT_PRIVACY_STALE");
  assert.equal(storedFiles, initial);
  const accepted = form(); appendImportPrivacyAcknowledgement(accepted);
  await expect(await documents(request(ctx, "documents", accepted)), 201); assert.equal(storedFiles, initial + 1);
  assertReceipt(ctx, await receipt(ctx, "document.uploaded_to_quarantine"));
  const saved = await database.prepare("SELECT security_state,scan_status,extracted_json FROM workspace_documents WHERE organization_id=?").bind(ctx.organizationId).first<{security_state:string;scan_status:string;extracted_json:string}>();
  assert.equal(saved!.security_state, "quarantined"); assert.equal(saved!.scan_status, "pending"); assert.equal(saved!.extracted_json, "{}");
});

async function approvedSource(ctx: Fixture) {
  const connectionId = crypto.randomUUID(), runId = crypto.randomUUID();
  await database.batch([
    database.prepare("INSERT INTO integration_connections(id,organization_id,provider,status,source_namespace,external_account_ref,scopes_json,data_promotion_status,created_at,updated_at) VALUES (?,?,'square','connected','legacy',?,'[]','approved',1,1)").bind(connectionId, ctx.organizationId, connectionId),
    database.prepare("INSERT INTO integration_location_mappings(id,organization_id,provider,connection_id,external_location_ref,external_name,local_location_id,status,last_seen_at,created_at,updated_at) VALUES (?,?,'square',?,'shop','Fixture shop',?,'mapped',1,1,1)").bind(crypto.randomUUID(), ctx.organizationId, connectionId, ctx.locationId),
    database.prepare("INSERT INTO integration_sync_runs(id,organization_id,provider,connection_id,mode,status,started_at,completed_at) VALUES (?,?,'square',?,'incremental','completed',1,1)").bind(runId, ctx.organizationId, connectionId),
    database.prepare("INSERT INTO commerce_products(id,organization_id,provider,connection_id,external_product_id,sku,name,source_payload_hash,sync_run_id,updated_at) VALUES (?,?,'square',?,'product','SKU','Fictional item','fixture',?,1)").bind(crypto.randomUUID(), ctx.organizationId, connectionId, runId),
  ]);
  return connectionId;
}

test("retail saves persist acknowledgement, preserve version conflicts and leave deletion available", async () => {
  const ctx = await fixture(), connectionId = await approvedSource(ctx);
  const body = { action: "save", kind: "catalog", from: "2026-09-01", to: "2026-09-01", provider: "square", connectionId, outletRef: "", source: "Reviewed classification", reviewed: true,
    expectedVersion: null, csv: "reference,category,itemType\nSKU,Fixture category,Fixture type", importPrivacyAcknowledgement: importPrivacyAcknowledgement() };
  await expect(await retail(request(ctx, "retail-measurements", body)), 200); assertReceipt(ctx, await receipt(ctx, "retail.evidence_saved"));
  assert.equal((await expect(await retail(request(ctx, "retail-measurements", body)), 409)).error.code, "RETAIL_INPUT_CONFLICT");
  await expect(await retail(request(ctx, "retail-measurements", { ...body, action: "delete", expectedVersion: 1, importPrivacyAcknowledgement: undefined })), 200);
});

test("product cost CSV records acknowledgement while manual cost edits remain available", async () => {
  const ctx = await fixture(), connectionId = await approvedSource(ctx), entries = [{ provider: "square", connectionId, externalProductId: "product", unitCostCents: 321 }];
  await expect(await costs(request(ctx, "inventory-costs", { source: "csv", entries, importPrivacyAcknowledgement: importPrivacyAcknowledgement() })), 200);
  assertReceipt(ctx, await receipt(ctx, "inventory.costs_imported"));
  await expect(await costs(request(ctx, "inventory-costs", { source: "manual", entries: [{ ...entries[0], unitCostCents: 432 }] })), 200);
  assert.equal((await database.prepare("SELECT owner_cost_cents amount FROM commerce_products WHERE organization_id=?").bind(ctx.organizationId).first<{amount:number}>())!.amount, 432);
});

test("vehicle and DMS CSV previews and confirmations retain privacy evidence without storing raw files", async () => {
  const ctx = await fixture();
  const csv = "identifier_kind,identifier,year,make,model,stock_number,status,acquired_date,currency,acquisition_amount,reconditioning_amount\nvin,1HGCM82633A004352,2003,Honda,Accord,CSV-01,available,2026-09-01,CAD,10000.01,0.00\n";
  const body = { csv, locationId: ctx.locationId, importPrivacyAcknowledgement: importPrivacyAcknowledgement() };
  const preview = await expect(await vehicles(request(ctx, "vehicles", { ...body, action: "preview" })), 200);
  assertReceipt(ctx, await receipt(ctx, "inventory.vehicles_import_privacy_acknowledged"));
  await expect(await vehicles(request(ctx, "vehicles", { ...body, action: "confirm", fingerprint: preview.fingerprint })), 201);
  assertReceipt(ctx, await receipt(ctx, "inventory.vehicles_imported"));
  const dmsCsv = "identifier_kind,identifier,year,make,model,stock_number,acquired_date,ownership,physical_status,prep_status,asking_amount\nvin,1HGCM82633A004353,2003,Honda,Accord,DMS-01,2026-09-01,owned,on_lot,ready,15000.00\n";
  const dmsBody = { csv: dmsCsv, locationId: ctx.locationId, importPrivacyAcknowledgement: importPrivacyAcknowledgement() };
  const dmsPreview = await expect(await dealership(request(ctx, "dealership", { ...dmsBody, action: "preview" })), 200);
  await expect(await dealership(request(ctx, "dealership", { ...dmsBody, action: "confirm", mutationKey: crypto.randomUUID(), fingerprint: dmsPreview.fingerprint })), 200);
  assertReceipt(ctx, await receipt(ctx, "dealership.import_privacy_acknowledged"));
});

test("accepting a notice grants no role, subscription, location or same-origin access", async () => {
  const owner = await fixture(), employee = await fixture("employee"), foreign = await fixture();
  const body = { rows: [row], importPrivacyAcknowledgement: importPrivacyAcknowledgement() };
  await expect(await daily(request(employee, "daily-metrics", body)), 403);
  await expect(await daily(request(owner, "daily-metrics", body, crypto.randomUUID(), "https://foreign.invalid")), 403);
  await expect(await vehicles(request(owner, "vehicles", { action: "preview", csv: "invalid", locationId: foreign.locationId, importPrivacyAcknowledgement: importPrivacyAcknowledgement() })), 400);
  const source = "identifier_kind,identifier,year,make,model,stock_number,status,acquired_date,currency,acquisition_amount,reconditioning_amount\nvin,1HGCM82633A004352,2003,Honda,Accord,FOREIGN,available,2026-09-01,CAD,,\n";
  await expect(await vehicles(request(owner, "vehicles", { action: "preview", csv: source, locationId: foreign.locationId, importPrivacyAcknowledgement: importPrivacyAcknowledgement() })), 403);
  await database.prepare("UPDATE tenant_subscriptions SET status='canceled' WHERE organization_id=?").bind(owner.organizationId).run();
  assert.equal((await expect(await daily(request(owner, "daily-metrics", body)), 402)).error.code, "SUBSCRIPTION_REQUIRED");
});
