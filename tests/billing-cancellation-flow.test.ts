import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { POST } from "../app/api/v1/billing/portal/route";
import { type VanteloqRuntimeEnv } from "../db";

const origin = "https://vanteloq.example";
const identities = { owner: "aaaaaaaa-1111-4444-8888-111111111111", employee: "bbbbbbbb-2222-4444-8888-222222222222", other: "cccccccc-3333-4444-8888-333333333333", admin: "dddddddd-4444-4444-8888-444444444444" };
function request(subject = identities.owner, body: Record<string, unknown> = { action: "cancel" }, headers: Record<string, string> = {}) {
  const payload = Buffer.from(JSON.stringify({ sub: subject, aal: "aal2", session_id: `session:${subject}` })).toString("base64url");
  return new Request(`${origin}/api/v1/billing/portal`, { method: "POST", headers: { origin, "content-type": "application/json", "sec-fetch-site": "same-origin", authorization: `Bearer test.${payload}.signature`, ...headers }, body: JSON.stringify(body) });
}

test("cancellation route remains available without paid access, binds stored billing IDs, and requires tenant authority", async () => {
  const miniflare = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('isolated')}}", d1Databases: { DB: crypto.randomUUID() } });
  const db = await miniflare.getD1Database("DB");
  const originalFetch = globalThis.fetch;
  const runtime = globalThis as typeof globalThis & { __vanteloqEnv?: VanteloqRuntimeEnv };
  const priorEnvironment = runtime.__vanteloqEnv;
  const calls: Array<{ path: string; method: string; fields: URLSearchParams }> = [];
  let providerStatus = "past_due";
  try {
    for (const name of (await readdir("drizzle")).filter(name => /^\d{4}.*\.sql$/.test(name)).sort()) {
      for (const sql of (await readFile(`drizzle/${name}`, "utf8")).split("--> statement-breakpoint").filter(sql => sql.trim())) await db.prepare(sql).run();
    }
    for (const [name, subject] of Object.entries(identities)) {
      await db.prepare("INSERT INTO users(id,email,auth_subject,auth_provider,display_name,status,created_at,updated_at) VALUES(?,?,?,'supabase',?,'active',1,1)").bind(subject, `${subject}@example.invalid`, subject, name).run();
    }
    await db.prepare("INSERT INTO workspaces(id,owner_name,business_name,legal_name,business_email,industry,city,address,postal_code,hours_json,created_at,updated_at) VALUES('target','Owner','Target','Target','target@example.invalid','Retail','Edmonton','1 Test','T5J4G8','[]',1,1),('other','Other','Other','Other','other@example.invalid','Retail','Edmonton','2 Test','T5J4G8','[]',1,1)").run();
    for (const [name, subject] of Object.entries(identities)) {
      await db.prepare("INSERT INTO memberships(id,user_id,organization_id,role,status,created_at,updated_at) VALUES(?,?,?,?, 'active',1,1)").bind(subject, subject, name === "other" ? "other" : "target", name === "other" ? "owner" : name).run();
    }
    await db.prepare("INSERT INTO tenant_subscriptions(organization_id,base_plan,billing_interval,status,stripe_customer_id,stripe_subscription_id,cancel_at_period_end,version,created_at,updated_at) VALUES('target','starter','month','past_due','cus_target123456','sub_target123456',0,1,1,1)").run();
    // An admin's custom role deliberately excludes billing management.
    await db.prepare("INSERT INTO access_roles(id,organization_id,name,description,color,permissions_json,location_scope_json,archived,created_by_user_id,created_at,updated_at) VALUES('admin-role','target','Operations admin','','#123456','[\"organization.settings\"]','[]',0,?,1,1)").bind(identities.owner).run();
    await db.prepare("INSERT INTO team_members(id,organization_id,user_id,role_id,first_name,last_name,email,employee_code,permitted_locations_json,status,remote_login,created_by_user_id,created_at,updated_at) VALUES('admin-member','target',?,'admin-role','Admin','Fixture',?,'ADMIN','[]','active',1,?,1,1)").bind(identities.admin, `${identities.admin}@example.invalid`, identities.owner).run();
    runtime.__vanteloqEnv = { DB: db as unknown as D1Database, SUPABASE_URL: "https://identity.example.invalid", SUPABASE_PUBLISHABLE_KEY: "fixture", STRIPE_SECRET_KEY: "sk_test_fixture_billing" };
    globalThis.fetch = async (input, init) => {
      const req = new Request(input, init), url = new URL(req.url);
      if (url.pathname === "/auth/v1/user") {
        const token = req.headers.get("authorization")!.split(".")[1];
        const payload = JSON.parse(Buffer.from(token, "base64url").toString());
        return Response.json({ id: payload.sub, email: `${payload.sub}@example.invalid`, email_confirmed_at: "2026-01-01", user_metadata: {} });
      }
      if (url.pathname === "/rest/v1/team_access_invitations") return Response.json([]);
      assert.equal(url.origin, "https://api.stripe.com");
      calls.push({ path: url.pathname, method: req.method, fields: new URLSearchParams(await req.text()) });
      if (url.pathname === "/v1/subscriptions/sub_target123456") return Response.json({ id: "sub_target123456", customer: "cus_target123456", status: providerStatus });
      if (url.pathname === "/v1/billing_portal/configurations") return Response.json({ data: [{ id: "bpc_default123456", active: true, is_default: true, features: { subscription_cancel: { enabled: true, mode: "at_period_end" } } }] });
      assert.equal(url.pathname, "/v1/billing_portal/sessions");
      return Response.json({ url: "https://billing.stripe.com/p/session/fixture" });
    };
    for (const status of ["past_due", "unpaid", "paused", "trialing", "active"]) {
      providerStatus = status;
      await db.prepare("UPDATE tenant_subscriptions SET status=? WHERE organization_id='target'").bind(status).run();
      const response = await POST(request());
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal(calls.at(-1)?.fields.get("customer"), "cus_target123456");
      assert.equal(calls.at(-1)?.fields.get("flow_data[subscription_cancel][subscription]"), "sub_target123456");
    }
    assert.equal(calls.some(call => call.method === "DELETE" || (call.method === "POST" && call.path !== "/v1/billing_portal/sessions")), false);
    assert.equal((await db.prepare("SELECT cancel_at_period_end FROM tenant_subscriptions WHERE organization_id='target'").first())?.cancel_at_period_end, 0, "opening confirmation must not pretend a cancellation occurred");
    const count = calls.length;
    for (const [req, status, code] of [
      [request(identities.employee), 403, "INSUFFICIENT_PERMISSION"],
      [request(identities.admin), 403, "INSUFFICIENT_PERMISSION"],
      [request(identities.other), 409, "STRIPE_CUSTOMER_REQUIRED"],
      [request(identities.owner, { action: "cancel", subscriptionId: "sub_other123456" }), 400, "BILLING_PORTAL_ACTION_INVALID"],
      [request(identities.owner, { action: "cancel" }, { origin: "https://foreign.invalid" }), 403, "ORIGIN_MISMATCH"],
    ] as const) {
      const response = await POST(req);
      assert.equal(response.status, status, await response.clone().text());
      assert.equal((await response.json()).error.code, code);
    }
    assert.equal(calls.length, count);
    await db.prepare("UPDATE tenant_subscriptions SET status='canceled' WHERE organization_id='target'").run();
    assert.equal((await POST(request())).status, 409);
    const managed = await POST(request(identities.owner, {}));
    assert.equal(managed.status, 200, "ended subscriptions retain general billing and invoice access");
    assert.equal(calls.at(-1)?.fields.has("flow_data[type]"), false);
  } finally {
    globalThis.fetch = originalFetch;
    runtime.__vanteloqEnv = priorEnvironment;
    await miniflare.dispose();
  }
});
