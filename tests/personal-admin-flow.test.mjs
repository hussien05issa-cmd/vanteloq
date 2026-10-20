import assert from "node:assert/strict";
import test from "node:test";
import { createEnvironment, createReportWorkspace, identityHeaders, origin } from "./helpers/retail-worker-fixture.mjs";
import { GET } from "../app/api/v1/internal/personal-admin/route.ts";

const ownerEmail = "hussienissa@lexedgeconsulting.com";
const ownerSubject = "58f1ed83-647a-4297-bcea-e3db7d864bc8";

test("personal admin endpoint isolates the pinned owner, rejects weak identity and revoked leases, and preserves business data", { timeout: 120000 }, async () => {
  let confirmation = true;
  const fixture = await createEnvironment({ authResponse: ({ payload, user }) => ({ ...user,
    ...(payload.email === ownerEmail ? { id: ownerSubject } : {}),
    email_confirmed_at: confirmation ? user.email_confirmed_at : null,
    confirmed_at: "2026-08-01T00:00:00.000Z",
    user_metadata: { ...user.user_metadata, role: "owner", personalAdmin: true },
  }) });
  const { worker, environment, database, dispose } = fixture;
  const runtime = globalThis;
  const previousEnv = runtime.__vanteloqEnv;
  try {
    const own = await createReportWorkspace(worker, environment, database, "personal-lab-owner");
    const other = await createReportWorkspace(worker, environment, database, "personal-lab-other");
    await database.prepare("UPDATE users SET email=?,auth_subject=? WHERE id=?").bind(ownerEmail, ownerSubject, own.userId).run();
    runtime.__vanteloqEnv = { ...environment, VANTELOQ_INTERNAL_ACCESS_ENABLED: "true" };
    const request = (email = ownerEmail, { workspace = own.organizationId, aal = "aal2", token = true } = {}) => {
      const headers = new Headers(token ? identityHeaders(email, "Personal lab owner") : {});
      if (token) {
        const payload = Buffer.from(JSON.stringify({ email, aal, session_id: `session:${email}` })).toString("base64url");
        headers.set("authorization", `Bearer test.${payload}.signature`);
      }
      return new Request(`${origin}/api/v1/internal/personal-admin?workspace=${workspace}`, { headers });
    };
    const tables = ["users", "internal_access", "audit_events", "workspaces", "workspace_industry_config", "workspace_industry_history", "onboarding_drafts", "account_preferences", "tenant_subscriptions", "legal_acceptances", "memberships", "organization_locations"];
    const snapshot = async () => Object.fromEntries(await Promise.all(tables.map(async table => [table, (await database.prepare(`SELECT * FROM ${table}`).all()).results])));
    const before = await snapshot();
    const response = await GET(request());
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual(await response.json(), { personalAdmin: true, capabilities: ["business_preview", "onboarding_rehearsal"] });
    assert.match(response.headers.get("cache-control"), /private.*no-store/);
    assert.equal((await GET(request(other.owner.email, { workspace: other.organizationId }))).status, 403);
    assert.equal((await GET(request(ownerEmail, { workspace: other.organizationId }))).status, 403);
    assert.equal((await GET(request(ownerEmail, { aal: "aal1" }))).status, 403);
    assert.equal((await GET(request(ownerEmail, { token: false }))).status, 401);
    confirmation = false;
    assert.equal((await GET(request())).status, 403, "generic confirmed_at must not authorize personal admin");
    confirmation = true;
    for (const role of ["employee", "admin"]) {
      await database.prepare("UPDATE memberships SET role=? WHERE user_id=?").bind(role, own.userId).run();
      assert.equal((await GET(request())).status, 403);
    }
    await database.prepare("UPDATE memberships SET role='owner' WHERE user_id=?").bind(own.userId).run();
    await database.prepare("UPDATE users SET auth_subject=? WHERE id=?").bind("other-subject", own.userId).run();
    assert.equal((await GET(request())).status, 403);
    await database.prepare("UPDATE users SET auth_subject=? WHERE id=?").bind(ownerSubject, own.userId).run();
    await database.prepare("UPDATE users SET auth_subject=NULL,auth_provider=NULL WHERE id=?").bind(own.userId).run();
    assert.equal((await GET(request())).status, 403, "eligibility must not bind a legacy profile");
    const legacy = await database.prepare("SELECT auth_subject,auth_provider FROM users WHERE id=?").bind(own.userId).first();
    assert.deepEqual(legacy, { auth_subject: null, auth_provider: null });
    await database.prepare("UPDATE users SET auth_subject=?,auth_provider='supabase' WHERE id=?").bind(ownerSubject, own.userId).run();
    await database.prepare("UPDATE memberships SET status='suspended' WHERE user_id=?").bind(own.userId).run();
    assert.equal((await GET(request())).status, 403);
    await database.prepare("UPDATE memberships SET status='active' WHERE user_id=?").bind(own.userId).run();
    await database.prepare("UPDATE workspace_sessions SET revoked=1 WHERE user_id=?").bind(own.userId).run();
    assert.equal((await GET(request())).status, 401);
    assert.deepEqual(await snapshot(), before, "eligibility checks must not modify business, billing, setup or legal records");
  } finally {
    runtime.__vanteloqEnv = previousEnv;
    await dispose();
  }
});
