import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { POST as begin, GET as controls } from "../app/api/v1/account/deletion/route";
import { POST as resume } from "../app/api/v1/account/deletion/resume/route";
import { POST as planRoute } from "../app/api/v1/account/deletion/plan/route";
import { deletionHandler } from "../supabase/functions/vanteloq-account-deletion/handler";
import { requireBillingAccess } from "../server/authorization";
import { advanceDeletion, authorizeDeletionJob } from "../server/account-deletion";
import { type VanteloqRuntimeEnv } from "../db";

const owner = "aaaaaaaa-1111-4444-8888-111111111111";
const teammate = "bbbbbbbb-2222-4444-8888-222222222222";
const remoteOrg = "cccccccc-3333-4444-8888-333333333333";
const origin = "https://vanteloq.com";
const subjectEmail = (subject: string) => `${subject}@example.invalid`;
const jobSession = () => ({ jobId: crypto.randomUUID(), token: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex") });
const input = (session: ReturnType<typeof jobSession>, scope = "workspace") => ({ ...session,
  confirmation: scope === "workspace" ? "DELETE VANTELOQ WORKSPACE" : "DELETE MY VANTELOQ ACCOUNT", acknowledgeNoRecovery: true, acknowledgeBillingCancellation: true });
function request(path: string, body?: unknown, subject = owner, recent = true) {
  const payload = Buffer.from(JSON.stringify({ sub: subject, aal: "aal2", session_id: "test-session", amr: [{ method: "totp", timestamp: Math.floor(Date.now() / 1000) - (recent ? 0 : 3600) }] })).toString("base64url");
  return new Request(`${origin}${path}`, { method: body === undefined ? "GET" : "POST", headers: {
    origin, "sec-fetch-site": "same-origin", "content-type": "application/json", authorization: `Bearer test.${payload}.signature`,
  }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}

async function fixture(shared = false, caller = owner, orphan = false) {
  const miniflare = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('isolated')}}", d1Databases: { DB: crypto.randomUUID() } });
  const db = await miniflare.getD1Database("DB");
  for (const filename of (await readdir("drizzle")).filter((name) => /^\d{4}.*\.sql$/.test(name)).sort()) {
    for (const statement of (await readFile(`drizzle/${filename}`, "utf8")).split("--> statement-breakpoint").filter((s) => s.trim())) await db.prepare(statement).run();
  }
  for (const [id, email] of [[owner, subjectEmail(owner)], [teammate, subjectEmail(teammate)]]) {
    await db.prepare("INSERT INTO users (id,email,auth_subject,auth_provider,display_name,status,created_at,updated_at) VALUES (?,?,?,'supabase','Fixture','active',1,1)").bind(id,email,id).run();
  }
  await db.prepare(`INSERT INTO workspaces (id,owner_name,business_name,legal_name,business_email,industry,city,address,postal_code,hours_json,created_at,updated_at)
    VALUES ('target','Fixture','Fixture Store','Fixture Store','fixture@example.invalid','retail','Edmonton','Fixture','T5J4G8','[]',1,1),
    ('unrelated','Other','Other Store','Other Store','other@example.invalid','retail','Dubai','Other','00000','[]',1,1)`).run();
  for (const [subject,role] of [[owner,"owner"],[teammate,"employee"]]) await db.prepare("INSERT INTO memberships (id,user_id,organization_id,role,status,created_at,updated_at) VALUES (?,?,'target',?,'active',1,1)").bind(subject,subject,role).run();
  const objects = new Set(["target/documents/quarantine/file.pdf", "target/branding/logo.png", "unrelated/keep.pdf"]);
  const state = { shared, remoteDeleted: orphan, memberRemoved: orphan, authDeleted: false, failCleanup: false, failFiles: false, failProof: false, ignoreRemoteDelete: false, unexpectedMember: false, deletes: [] as string[] };
  if (orphan) await db.prepare("DELETE FROM memberships WHERE user_id = ?").bind(caller).run();
  const bucket = {
    list: async ({prefix}: {prefix:string}) => ({ objects: [...objects].filter((key) => key.startsWith(prefix)).map((key)=>({key})), truncated: false }),
    delete: async (keys: string[]) => { if (state.failFiles) throw new Error("fixture storage failure"); keys.forEach((key) => objects.delete(key)); },
  };
  (globalThis as typeof globalThis & { __vanteloqEnv?: VanteloqRuntimeEnv }).__vanteloqEnv = {
    DB: db as unknown as D1Database, BUCKET: bucket as unknown as R2Bucket,
    VANTELOQ_DELETION_ENABLED: "true", SUPABASE_URL: "https://identity.example.invalid", SUPABASE_PUBLISHABLE_KEY: "fixture",
    INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  };
  const realFetch = globalThis.fetch;
  const bridgeFetch: typeof fetch = async (url, init) => {
    const req = new Request(url, init); const parsed = new URL(req.url);
    if (req.url === `${origin}/api/v1/account/deletion/plan`) {
      if (state.failProof) return Response.json({}, {status:403});
      return planRoute(req);
    }
    assert.equal(parsed.origin, "https://identity.example.invalid", "no real provider call allowed");
    const path = parsed.pathname;
    if (path.startsWith("/auth/v1/admin/users/")) {
      if (req.method === "DELETE") { state.deletes.push(path); assert.equal(path.split("/").at(-1), caller); state.authDeleted = true; return Response.json({}); }
      return state.authDeleted ? Response.json({}, {status:404}) : Response.json({ id: caller, email: subjectEmail(caller) });
    }
    if (req.method === "DELETE") { state.deletes.push(path); if (!state.ignoreRemoteDelete && path.endsWith("organizations")) state.remoteDeleted = true; if (!state.ignoreRemoteDelete && path.endsWith("memberships")) state.memberRemoved = true; return Response.json([]); }
    if (path.endsWith("management_console_access")) return Response.json(state.shared ? [{id:"fixture-console-grant"}] : []);
    if (path.endsWith("team_access_invitations")) return Response.json([]);
    if (path.endsWith("organizations")) return Response.json(state.remoteDeleted || parsed.searchParams.get("created_by") === `eq.${teammate}` ? [] : [{ id: remoteOrg, name: "Fixture Store", created_by: owner }]);
    if (path.endsWith("memberships")) {
      if (state.remoteDeleted || state.memberRemoved) return Response.json([]);
      if (parsed.searchParams.has("organization_id")) return Response.json([{user_id:owner}, {user_id: state.unexpectedMember ? crypto.randomUUID() : teammate}]);
      return Response.json([{ organization_id: remoteOrg, role:caller === owner ? "owner" : "employee", user_id: caller }]);
    }
    throw new Error(`Unexpected fixture request ${path}`);
  };
  const bridge = deletionHandler({url:"https://identity.example.invalid", serviceKey:"fixture-service-key", fetcher:bridgeFetch});
  globalThis.fetch = async (url, init) => {
    const req = new Request(url, init); const path = new URL(req.url).pathname;
    if (path === "/auth/v1/user") {
      const payload = JSON.parse(Buffer.from(req.headers.get("authorization")!.split(".")[1], "base64url").toString());
      return Response.json({ id:payload.sub, email:subjectEmail(payload.sub), email_confirmed_at:"2026-01-01", user_metadata:{} });
    }
    if (path === "/functions/v1/vanteloq-account-deletion") {
      const body = await req.clone().json();
      if (state.failCleanup && body.action === "cleanup") return Response.json({ok:false}, {status:503});
      return bridge(req);
    }
    if (path === "/rest/v1/team_access_invitations") return Response.json([]);
    throw new Error(`Unexpected external request ${req.url}`);
  };
  return { db, state, objects, bridge, close: async () => { globalThis.fetch = realFetch; await miniflare.dispose(); } };
}

test("self-service deletion removes only the confirmed workspace, preserves console identity, and supports replay", async () => {
  const f = await fixture(true);
  try {
    const session = jobSession();
    const control = await controls(request("/api/v1/account/deletion"));
    assert.equal((await control.json()).available, true);
    const created = await begin(request("/api/v1/account/deletion", input(session)));
    assert.equal(created.status, 202, await created.clone().text());
    const completed = await resume(request("/api/v1/account/deletion/resume", session));
    assert.equal(completed.status, 200, await completed.clone().text());
    assert.equal((await completed.json()).identityRetained, true);
    assert.equal(f.state.authDeleted, false);
    assert.equal(await f.db.prepare("SELECT id FROM workspaces WHERE id='target'").first(), null);
    assert.ok(await f.db.prepare("SELECT id FROM workspaces WHERE id='unrelated'").first());
    assert.deepEqual([...f.objects], ["unrelated/keep.pdf"]);
    const row = await f.db.prepare("SELECT stage, plan_encrypted, user_id, organization_id FROM account_deletion_jobs WHERE id=?").bind(session.jobId).first();
    assert.deepEqual(row, {stage:"completed",plan_encrypted:"",user_id:"",organization_id:""});
    assert.equal((await (await resume(request("/api/v1/account/deletion/resume", session))).json()).deleted,true);
    assert.equal((await resume(request("/api/v1/account/deletion/resume", {...session,token:"f".repeat(64)}))).status,403);
    assert.equal(f.state.deletes.filter((path)=>path.includes("admin/users")).length,0);
  } finally { await f.close(); }
});

test("failed identity cleanup stays pending and can resume without a workspace login", async () => {
  const f = await fixture();
  try {
    const session = jobSession();
    assert.equal((await begin(request("/api/v1/account/deletion", input(session)))).status,202);
    f.state.failCleanup = true;
    assert.equal((await resume(request("/api/v1/account/deletion/resume",session))).status,503);
    assert.equal((await f.db.prepare("SELECT result FROM account_deletion_receipts WHERE id=?").bind(session.jobId).first())?.result,"auth_cleanup_pending");
    assert.equal(f.state.authDeleted,false);
    f.state.failCleanup = false;
    const retry = request("/api/v1/account/deletion/resume", session); retry.headers.delete("authorization");
    assert.equal((await (await resume(retry)).json()).deleted,true);
    assert.equal(f.state.authDeleted,true);
    assert.deepEqual(f.state.deletes.filter((path)=>path.includes("admin/users")),[`/auth/v1/admin/users/${owner}`]);
  } finally { await f.close(); }
});

test("fresh MFA, exact consent, origin, and immutable server proof are required", async () => {
  const f = await fixture();
  try {
    const session = jobSession();
    assert.equal((await begin(request("/api/v1/account/deletion", input(session),owner,false))).status,403);
    assert.equal((await begin(request("/api/v1/account/deletion", {...input(session),acknowledgeNoRecovery:false}))).status,400);
    const cross = request("/api/v1/account/deletion", input(session)); cross.headers.set("origin","https://evil.example.invalid");
    assert.equal((await begin(cross)).status,403);
    assert.equal((await begin(request("/api/v1/account/deletion", input(session)))).status,202);
    f.state.failProof = true;
    assert.equal((await resume(request("/api/v1/account/deletion/resume", session))).status,503);
    assert.ok(await f.db.prepare("SELECT id FROM workspaces WHERE id='target'").first());
    assert.equal(f.state.deletes.length,0);
    f.state.failProof = false;
    const tooSoon = await f.bridge(new Request("https://identity.example.invalid/functions/v1/vanteloq-account-deletion", {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...session,action:"cleanup",subject:teammate})}));
    assert.equal(tooSoon.status,409);
    assert.equal(f.state.deletes.length,0);
  } finally { await f.close(); }
});

test("storage failure preserves database records and blocks normal work while the confirmed job retries", async () => {
  const f = await fixture();
  try {
    const session = jobSession();
    assert.equal((await begin(request("/api/v1/account/deletion",input(session)))).status,202);
    f.state.failFiles = true;
    assert.equal((await resume(request("/api/v1/account/deletion/resume",session))).status,500);
    assert.ok(await f.db.prepare("SELECT id FROM workspaces WHERE id='target'").first());
    assert.equal(f.state.deletes.length,0);
    await assert.rejects(() => requireBillingAccess(request("/api/v1/billing"),["owner"]), /being deleted/);
    f.state.failFiles = false;
    assert.equal((await (await resume(request("/api/v1/account/deletion/resume",session))).json()).deleted,true);
  } finally { await f.close(); }
});

test("ambiguous or changed membership fails before any remote or local deletion", async () => {
  const f = await fixture();
  try {
    const session = jobSession();
    assert.equal((await begin(request("/api/v1/account/deletion",input(session)))).status,202);
    f.state.unexpectedMember = true;
    assert.equal((await resume(request("/api/v1/account/deletion/resume",session))).status,503);
    assert.equal(f.state.deletes.length,0);
    assert.ok(await f.db.prepare("SELECT id FROM workspaces WHERE id='target'").first());
  } finally { await f.close(); }
});

test("a teammate deletes only their own membership and keeps the employer workspace", async () => {
  const f = await fixture(false, teammate);
  try {
    const session = jobSession();
    assert.equal((await begin(request("/api/v1/account/deletion",input(session,"account"),teammate))).status,202);
    const result = await resume(request("/api/v1/account/deletion/resume",session,teammate));
    assert.equal(result.status,200,await result.clone().text());
    assert.equal((await result.json()).deleted,true);
    assert.ok(await f.db.prepare("SELECT id FROM workspaces WHERE id='target'").first());
    assert.ok(await f.db.prepare("SELECT id FROM memberships WHERE user_id=?").bind(owner).first());
    assert.equal(await f.db.prepare("SELECT id FROM memberships WHERE user_id=?").bind(teammate).first(),null);
    assert.equal(f.objects.size,3);
    assert.equal(f.state.remoteDeleted,false);
    assert.deepEqual(f.state.deletes.filter((path)=>path.includes("admin/users")),[`/auth/v1/admin/users/${teammate}`]);
  } finally { await f.close(); }
});

test("an account without onboarding or a paid subscription can delete itself", async () => {
  const f = await fixture(false,teammate,true);
  try {
    const session = jobSession();
    const control = await controls(request("/api/v1/account/deletion",undefined,teammate));
    assert.equal(control.status,200,await control.clone().text());
    assert.equal((await control.json()).scope,"account");
    assert.equal((await begin(request("/api/v1/account/deletion",input(session,"account"),teammate))).status,202);
    const result = await resume(request("/api/v1/account/deletion/resume",session,teammate));
    assert.equal(result.status,200,await result.clone().text());
    assert.equal((await result.json()).deleted,true);
    assert.equal(f.objects.size,3);
  } finally { await f.close(); }
});

test("active provider connections require disconnection before a deletion job is created", async () => {
  const f = await fixture();
  try {
    await f.db.prepare("INSERT INTO integration_connections (id,organization_id,provider,status,created_at,updated_at) VALUES ('test-connection','target','plaid','connected',1,1)").run();
    const result = await begin(request("/api/v1/account/deletion",input(jobSession())));
    assert.equal(result.status,409);
    assert.equal((await result.json()).error.code,"DELETION_DISCONNECT_REQUIRED");
    assert.equal((await f.db.prepare("SELECT COUNT(*) count FROM account_deletion_jobs").first())?.count,0);
  } finally { await f.close(); }
});

test("a held lease prevents competing deletion and a stale completed snapshot is harmless", async () => {
  const f = await fixture(true);
  try {
    const session = jobSession();
    assert.equal((await begin(request("/api/v1/account/deletion", input(session)))).status,202);
    const stale = await authorizeDeletionJob(session.jobId,session.token);
    await f.db.prepare("UPDATE account_deletion_jobs SET lease_until=? WHERE id=?").bind(Math.floor(Date.now()/1000)+120,session.jobId).run();
    const pending = await resume(request("/api/v1/account/deletion/resume", session));
    assert.equal((await pending.json()).pending,true);
    assert.equal(f.state.deletes.length,0);
    assert.equal(f.objects.size,3);
    await f.db.prepare("UPDATE account_deletion_jobs SET lease_until=0 WHERE id=?").bind(session.jobId).run();
    assert.equal((await (await resume(request("/api/v1/account/deletion/resume",session))).json()).deleted,true);
    assert.equal((await advanceDeletion(stale,session.token)).deleted,true);
  } finally { await f.close(); }
});

test("a successful provider HTTP response is not enough without verified removal", async () => {
  const f = await fixture();
  try {
    const session = jobSession();
    assert.equal((await begin(request("/api/v1/account/deletion",input(session)))).status,202);
    f.state.ignoreRemoteDelete = true;
    assert.equal((await resume(request("/api/v1/account/deletion/resume",session))).status,503);
    assert.equal(f.state.authDeleted,false);
    assert.equal((await f.db.prepare("SELECT stage FROM account_deletion_jobs WHERE id=?").bind(session.jobId).first())?.stage,"local_deleted");
    f.state.ignoreRemoteDelete = false;
    assert.equal((await (await resume(request("/api/v1/account/deletion/resume",session))).json()).deleted,true);
  } finally { await f.close(); }
});
