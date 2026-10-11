import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import type { VanteloqRuntimeEnv } from "../db";
import {getDb} from "../db";
import {workspaces} from "../db/schema";
import {eq} from "drizzle-orm";
import type {AccessContext} from "../server/authorization";
import {
  acquireDeelGrantLease, activateDeelGrant, deelAccessToken, DEEL_READ_SCOPES,
  encryptDeelSecret, exchangeDeelCode, failDeelAuthorization,
  fetchDeelOrganizationWithToken, removeDeelLocalGrant, stageDeelMeasurement,
  type DeelToken,
} from "../server/integrations/deel";
import { releaseIntegrationSyncLease } from "../server/integrations/connection";
import { GET as callback } from "../app/api/v1/integrations/deel/callback/route";
import { POST as disconnect } from "../app/api/v1/integrations/deel/disconnect/route";
import { runDeelSync } from "../server/integrations/sync/deel";

let runtime: Miniflare, db: D1Database;
const globals = globalThis as typeof globalThis & { __vanteloqEnv?: VanteloqRuntimeEnv };
const originalEnv = globals.__vanteloqEnv;
const env: VanteloqRuntimeEnv = {
  DEEL_CLIENT_ID: "deel_fixture_client", DEEL_CLIENT_SECRET: "deel_fixture_secret",
  DEEL_REDIRECT_URI: "https://vanteloq.example/api/v1/integrations/deel/callback", DEEL_ENV: "sandbox",
  INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
};
before(async () => {
  runtime = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('isolated')}}", d1Databases: { DB: crypto.randomUUID() } });
  db = await runtime.getD1Database("DB") as unknown as D1Database;
  for (const file of (await readdir("drizzle")).filter(file => /^\d{4}.*\.sql$/.test(file)).sort()) {
    for (const sql of (await readFile(`drizzle/${file}`, "utf8")).split("--> statement-breakpoint").filter(text => text.trim())) await db.prepare(sql).run();
  }
  globals.__vanteloqEnv = { ...env, DB: db };
}, { timeout: 120000 });
after(async () => { globals.__vanteloqEnv = originalEnv; await runtime?.dispose(); });

const token = (expired = false): DeelToken => ({ accessToken: "fixture-access", refreshToken: "fixture-refresh",
  accessTokenExpiresAt: new Date(Date.now() + (expired ? -60_000 : 3_600_000)), scopes: [...DEEL_READ_SCOPES] });
async function fixture(expired = false, pending = false) {
  const organizationId = crypto.randomUUID(), connectionId = crypto.randomUUID(), providerOrganizationId = crypto.randomUUID();
  await db.batch([
    db.prepare("INSERT INTO workspaces(id,owner_name,business_name,legal_name,business_email,industry,city,address,postal_code,hours_json,created_at,updated_at) VALUES (?,'Test','Deel test','Deel test',?,'Retail','Edmonton','Test','T5A1A1','[]',1,1)").bind(organizationId, `${organizationId}@example.invalid`),
    db.prepare("INSERT INTO integration_connections(id,organization_id,provider,status,external_account_ref,source_namespace,data_promotion_status,created_at,updated_at) VALUES (?,?,'deel',?,?,?,'staging',1,1)").bind(connectionId, organizationId, pending ? "pending" : "connected", pending ? null : providerOrganizationId, connectionId),
  ]);
  if (!pending) {
    await db.prepare("INSERT INTO integration_secrets(id,organization_id,provider,connection_id,access_token_ciphertext,refresh_token_ciphertext,token_expires_at,created_at,updated_at) VALUES (?,?,'deel',?,?,?,?,1,1)")
      .bind(crypto.randomUUID(), organizationId, connectionId, await encryptDeelSecret(token(expired).accessToken),
        await encryptDeelSecret(token(expired).refreshToken), Math.floor(token(expired).accessTokenExpiresAt.getTime() / 1000)).run();
  }
  return { organizationId, connectionId, namespace: connectionId, providerOrganizationId };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const secret = (ctx: Fixture) => db.prepare("SELECT * FROM integration_secrets WHERE organization_id=? AND connection_id=?").bind(ctx.organizationId, ctx.connectionId).first();
const connection = (ctx: Fixture) => db.prepare("SELECT * FROM integration_connections WHERE organization_id=? AND id=?").bind(ctx.organizationId, ctx.connectionId).first();
const mappingCount = (ctx: Fixture) => db.prepare("SELECT COUNT(*) AS count FROM integration_location_mappings WHERE organization_id=? AND connection_id=?").bind(ctx.organizationId, ctx.connectionId).first<{count:number}>();
const measureCount = (ctx: Fixture) => db.prepare("SELECT COUNT(*) AS count FROM retail_measurements WHERE organization_id=? AND connection_id=?").bind(ctx.organizationId, ctx.connectionId).first<{count:number}>();
const isCode = (code: string) => (error: unknown) => error instanceof Error && "code" in error && error.code === code;
const neverFetch = (async () => { throw Error("Provider must not be contacted"); }) as typeof fetch;
function pausedRefresh() {
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { entered = resolve; });
  let calls = 0;
  const fetcher = (async (input, init) => {
    calls++;
    assert.equal(String(input), "https://app-sandbox.letsdeel.com/oauth/token");
    assert.equal(init?.redirect, "manual");
    assert.equal(new URLSearchParams(String(init?.body)).get("refresh_token"), "fixture-refresh");
    entered(); await gate;
    return Response.json({ access_token: "refreshed-access", refresh_token: "refreshed-refresh", token_type: "Bearer", expires_in: 3600, scope: DEEL_READ_SCOPES.join(" ") });
  }) as typeof fetch;
  return { fetcher, ready, release, calls: () => calls };
}
const stagedRow = () => ({ outletRef: "fixture-location", reference: crypto.randomUUID(), periodFrom: "2026-09-01", periodTo: "2026-09-30",
  valuesJson: JSON.stringify([{reference:"location",values:{finalized:true,reportingEligible:false,complete:false,wagesCents:null,paidMinutes:null,currency:"CAD",reportedTotalsCents:100}}]), updatedByUserId: null });
const providerOrg = (ctx: Fixture) => ({id:ctx.providerOrganizationId,name:"Fixture Deel organization"});
const entities = () => [{id:crypto.randomUUID(),name:"Fixture legal entity",country:"CA"}];

test("copied callback, disconnect and sync modules load without source checkout edits", () => {
  assert.equal(typeof callback, "function"); assert.equal(typeof disconnect, "function"); assert.equal(typeof runDeelSync, "function");
});
test("a normal one hour Deel token is reused and tenant mismatches fail closed", async () => {
  const first = await fixture(), second = await fixture();
  assert.equal(await deelAccessToken(first.organizationId, first.connectionId, neverFetch), "fixture-access");
  assert.ok(Number((await secret(first))?.token_expires_at) < 1e11);
  assert.doesNotMatch(JSON.stringify(await secret(first)), /fixture-access|fixture-refresh/);
  await assert.rejects(() => deelAccessToken(second.organizationId, first.connectionId, neverFetch), isCode("DEEL_NOT_CONNECTED"));
});
test("concurrent expired token reads consume the single-use token once", async () => {
  const ctx = await fixture(true), refresh = pausedRefresh();
  const first = deelAccessToken(ctx.organizationId, ctx.connectionId, refresh.fetcher);
  await refresh.ready;
  await assert.rejects(() => deelAccessToken(ctx.organizationId, ctx.connectionId, neverFetch), isCode("DEEL_CONNECTION_BUSY"));
  refresh.release(); assert.equal(await first, "refreshed-access"); assert.equal(refresh.calls(), 1);
  assert.equal(await deelAccessToken(ctx.organizationId, ctx.connectionId, neverFetch), "refreshed-access");
});
test("sync-owned refresh reuses the lease without nesting or releasing it", async () => {
  const ctx = await fixture(true), lease = await acquireDeelGrantLease(ctx.organizationId, ctx.connectionId), refresh = pausedRefresh();
  try {
    const first = deelAccessToken(ctx.organizationId, ctx.connectionId, refresh.fetcher, lease);
    await refresh.ready; refresh.release(); assert.equal(await first, "refreshed-access");
    assert.equal((await connection(ctx))?.sync_lease_owner, lease.owner);
    await stageDeelMeasurement(lease, ctx.namespace, stagedRow());
    assert.equal((await measureCount(ctx))?.count, 1);
  } finally { await releaseIntegrationSyncLease(lease); }
});
test("late refresh cannot recreate credentials or aggregates after disconnect", async () => {
  const ctx = await fixture(true), refresh = pausedRefresh();
  const pending = deelAccessToken(ctx.organizationId, ctx.connectionId, refresh.fetcher);
  const rejected = assert.rejects(pending, isCode("DEEL_GRANT_CHANGED"));
  await refresh.ready;
  const old = await connection(ctx);
  await removeDeelLocalGrant(ctx.organizationId, ctx.connectionId, ctx.namespace);
  refresh.release(); await rejected;
  assert.equal(await secret(ctx), null); assert.equal((await connection(ctx))?.status, "revoked");
  assert.equal((await connection(ctx))?.sync_lease_owner, null);
  assert.ok(Number((await connection(ctx))?.sync_version) > Number(old?.sync_version));
  assert.equal((await measureCount(ctx))?.count, 0);
});
test("late refresh rejects namespace changes, successor secrets and expired leases", async () => {
  for (const mutation of ["namespace", "secret", "lease"]) {
    const ctx = await fixture(true), refresh = pausedRefresh();
    const pending = deelAccessToken(ctx.organizationId, ctx.connectionId, refresh.fetcher);
    const rejected = assert.rejects(pending, isCode("DEEL_GRANT_CHANGED")); await refresh.ready;
    if (mutation === "namespace") await db.prepare("UPDATE integration_connections SET source_namespace=? WHERE id=?").bind(crypto.randomUUID(), ctx.connectionId).run();
    if (mutation === "secret") await db.prepare("UPDATE integration_secrets SET refresh_token_ciphertext='successor-secret' WHERE connection_id=?").bind(ctx.connectionId).run();
    if (mutation === "lease") await db.prepare("UPDATE integration_connections SET sync_lease_expires_at=1 WHERE id=?").bind(ctx.connectionId).run();
    const before = await secret(ctx); refresh.release(); await rejected; assert.deepEqual(await secret(ctx), before, mutation);
  }
});
test("unknown refresh outcome disables reuse of the possibly consumed refresh token", async () => {
  const ctx = await fixture(true); let calls=0;
  await assert.rejects(() => deelAccessToken(ctx.organizationId, ctx.connectionId, (async () => { calls++; throw Error("unknown network outcome"); }) as typeof fetch), isCode("DEEL_REFRESH_RECONNECT_REQUIRED"));
  assert.equal(calls, 1); assert.equal(await secret(ctx), null); assert.equal((await connection(ctx))?.status, "error");
  await assert.rejects(() => deelAccessToken(ctx.organizationId, ctx.connectionId, neverFetch), isCode("DEEL_NOT_CONNECTED"));
});
test("callback activation atomically commits verified credentials and mappings", async () => {
  const ctx = await fixture(false, true), lease = await acquireDeelGrantLease(ctx.organizationId, ctx.connectionId);
  try {
    await db.prepare(`CREATE TRIGGER test_deel_activation_failure BEFORE UPDATE ON integration_connections WHEN NEW.id='${ctx.connectionId}' AND NEW.status='connected' BEGIN SELECT RAISE(ABORT, 'activation failure'); END`).run();
    try { await assert.rejects(() => activateDeelGrant(lease, ctx.namespace, token(), providerOrg(ctx), entities(), null)); }
    finally { await db.prepare("DROP TRIGGER test_deel_activation_failure").run(); }
    assert.equal(await secret(ctx), null); assert.equal((await mappingCount(ctx))?.count, 0); assert.equal((await connection(ctx))?.status, "pending");
    await activateDeelGrant(lease, ctx.namespace, token(), providerOrg(ctx), entities(), null);
    assert.equal((await connection(ctx))?.status, "connected"); assert.equal((await mappingCount(ctx))?.count, 1);
    assert.equal(await deelAccessToken(ctx.organizationId, ctx.connectionId, neverFetch, lease), "fixture-access");
  } finally { await releaseIntegrationSyncLease(lease); }
});
test("withdrawn callback and its catch handler cannot create credentials, mappings or an error status", async () => {
  const ctx = await fixture(false, true), lease = await acquireDeelGrantLease(ctx.organizationId, ctx.connectionId);
  await removeDeelLocalGrant(ctx.organizationId, ctx.connectionId, ctx.namespace);
  await assert.rejects(() => activateDeelGrant(lease, ctx.namespace, token(), providerOrg(ctx), entities(), null), isCode("DEEL_GRANT_CHANGED"));
  await failDeelAuthorization(lease, ctx.namespace, "late-callback-error");
  assert.equal(await secret(ctx), null); assert.equal((await mappingCount(ctx))?.count, 0); assert.equal((await connection(ctx))?.status, "revoked");
});
test("late sync measurements cannot recreate deleted evidence", async () => {
  const ctx = await fixture(), lease = await acquireDeelGrantLease(ctx.organizationId, ctx.connectionId);
  await stageDeelMeasurement(lease, ctx.namespace, stagedRow()); assert.equal((await measureCount(ctx))?.count, 1);
  const removed = await removeDeelLocalGrant(ctx.organizationId, ctx.connectionId, ctx.namespace);
  assert.equal(removed.stagedAggregatesDeleted, 1);
  await assert.rejects(() => stageDeelMeasurement(lease, ctx.namespace, stagedRow()), isCode("DEEL_GRANT_CHANGED"));
  assert.equal((await measureCount(ctx))?.count, 0); assert.equal((await connection(ctx))?.status, "revoked");
});
test("Worker-compatible manual redirect mode rejects token and data redirects without following", async () => {
  let calls=0;
  const redirected = (async (_input, init) => { calls++; assert.equal(init?.redirect, "manual"); return new Response(null,{status:302,headers:{Location:"https://outside.invalid/"}}); }) as typeof fetch;
  await assert.rejects(() => exchangeDeelCode("fixture-code", redirected), isCode("DEEL_REDIRECT_REJECTED"));
  await assert.rejects(() => fetchDeelOrganizationWithToken("fixture-token", redirected), isCode("DEEL_REDIRECT_REJECTED"));
  assert.equal(calls, 2);
});

test("available payroll reports do not certify finality and remain staged across grant checks", async () => {
  for (const removeDuringRead of [false, true]) {
    const ctx=await fixture(), userId=crypto.randomUUID(), legalEntityId=crypto.randomUUID(), cycleId=crypto.randomUUID();
    await db.batch([
      db.prepare("INSERT INTO users(id,email,display_name,status,created_at,updated_at) VALUES (?,?,'Fixture Owner','active',1,1)").bind(userId,`${userId}@example.invalid`),
      db.prepare("INSERT INTO integration_location_mappings(id,organization_id,provider,connection_id,external_location_ref,external_name,local_location_id,status,last_seen_at,created_at,updated_at) VALUES (?,?,'deel',?,?,'Fixture legal entity',?,'mapped',1,1,1)").bind(crypto.randomUUID(),ctx.organizationId,ctx.connectionId,legalEntityId,crypto.randomUUID()),
    ]);
    const [organization]=await getDb().select().from(workspaces).where(eq(workspaces.id,ctx.organizationId));
    const context:AccessContext={organizationId:ctx.organizationId,userId,role:"owner",organization,authSubject:null,authProvider:"sites",
      identity:{email:`${userId}@example.invalid`,displayName:"Fixture Owner",subject:null,provider:"sites",emailVerified:true,assuranceLevel:null,sessionId:null}};
    let entered!:()=>void, release!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve}), ready=new Promise<void>(resolve=>{entered=resolve});
    const original=globalThis.fetch;
    globalThis.fetch=(async input=>{
      const path=new URL(String(input)).pathname;
      if(path==="/rest/organizations")return Response.json({data:[providerOrg(ctx)]});
      if(path.includes("/legal-entities/"))return Response.json({data:[{id:cycleId,type:"REGULAR",date_start:"2026-09-01T00:00:00Z",date_end:"2026-09-30T00:00:00Z",has_g2n_report:true,legal_entity_id:legalEntityId}],has_more:false,next_cursor:null});
      entered();await gate;
      return Response.json({data:[{currency:"CAD",items:[{category_group:"ADDITIONS",value:100}]}],has_more:false,next_cursor:null});
    }) as typeof fetch;
    try {
      const pending=runDeelSync(new Request("https://vanteloq.example/api/v1/integrations/deel/sync"),crypto.randomUUID(),context,
        {connectionId:ctx.connectionId,dateStart:"2026-09-01",dateEnd:"2026-09-30"});
      const rejected=removeDuringRead?assert.rejects(pending,isCode("DEEL_GRANT_CHANGED")):null;
      await ready;
      if(removeDuringRead)await removeDeelLocalGrant(ctx.organizationId,ctx.connectionId,ctx.namespace);
      release();
      if(rejected)await rejected;
      else {
        const response = await pending;
        assert.equal(response.status,200);
        const body = await response.json() as {dataPromotionEnabled:boolean;payrollCyclesRead:number};
        assert.equal(body.dataPromotionEnabled,false);
        assert.equal(body.payrollCyclesRead,1);
        assert.equal((await measureCount(ctx))?.count,1);
        const staged = await db.prepare("SELECT values_json FROM retail_measurements WHERE organization_id = ? AND connection_id = ?").bind(ctx.organizationId,ctx.connectionId).first<{values_json:string}>();
        assert.ok(staged);
        const values = JSON.parse(staged.values_json)[0].values;
        assert.equal(values.reportAvailable,true);
        assert.equal(values.finalized,null);
        assert.equal(values.payrollStatusVerified,false);
        assert.equal(values.reportingEligible,false);
        assert.equal(values.complete,false);
        assert.equal(values.wagesCents,null);
        assert.equal(values.paidMinutes,null);
        assert.ok((await connection(ctx))?.last_successful_sync_at);
      }
      const row=await connection(ctx);
      assert.equal(row?.status,removeDuringRead?"revoked":"connected");
      assert.equal(row?.data_promotion_status,removeDuringRead?"blocked":"staging");
      assert.equal(row?.last_error_code,null);
      if(removeDuringRead){assert.equal((await measureCount(ctx))?.count,0);assert.equal(row?.last_successful_sync_at,null);assert.equal(row?.last_sync_cursor,null);}
    }finally{globalThis.fetch=original;release();}
  }
});
