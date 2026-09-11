import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { acceptTeamInvitation, pendingTeamInvitation, liveTeamMembershipAllowed, verifiedTeamProvisioning } from "../server/team-invitations.ts";
import { findAccessContext } from "../server/authorization.ts";
import { getTenantEntitlements } from "../server/entitlements/engine.ts";
import type { TrustedIdentity } from "../server/api.ts";
import { TERMS_OF_SERVICE_VERSION, PRIVACY_POLICY_VERSION, ACCOUNT_ACCEPTANCE_NOTICE_VERSION } from "../shared/legal-versions.ts";

test("real D1 employee provisioning, free entitlements, retries, and revocation", async () => {
  const sqlite = new DatabaseSync(":memory:");
  // Exercise the production SQL without filesystem-backed worker state.
  const db = {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      let parameters: Array<string | number | null> = [];
      return {
        bind(...values: Array<string | number | null>) { parameters = values; return this; },
        async run() { return { success: true, meta: statement.run(...parameters) }; },
        async first<T>() { return (statement.get(...parameters) ?? null) as T | null; },
        async all() { return { results: statement.all(...parameters), success: true }; },
        async raw() {
          (statement as unknown as { setReturnArrays: (value: boolean) => void }).setReturnArrays(true);
          try { return statement.all(...parameters); }
          finally { (statement as unknown as { setReturnArrays: (value: boolean) => void }).setReturnArrays(false); }
        },
      };
    },
    async batch(statements: Array<{ all: () => Promise<unknown> }>) {
      sqlite.exec("BEGIN");
      try { const results = []; for (const statement of statements) results.push(await statement.all()); sqlite.exec("COMMIT"); return results; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  const originalFetch = globalThis.fetch;
  const now = Date.now();
  const ownerSubject = "11111111-1111-4111-8111-111111111111";
  const ownerEmail = "hussienissa@lexedgeconsulting.com";
  const rows = new Map<string, Record<string, unknown>>();
  let failFinalization = false;
  let invalidInvitationResponse = false;
  const identity = (email: string, subject: string): TrustedIdentity => ({ email, subject, displayName: "Test Employee", provider: "supabase", emailVerified: true, assuranceLevel: "aal2", sessionId: "test-session" });
  const request = (person: TrustedIdentity) => new Request("https://vanteloq.com/api/v1/team-invitations", { method: "POST", headers: {
    authorization: `Bearer test.${Buffer.from(JSON.stringify({ sub: person.subject, email: person.email, aal: "aal2", amr: [{ method: "recovery", timestamp: Date.now() / 1000 }] })).toString("base64url")}.test`,
    origin: "https://vanteloq.com", "content-type": "application/json",
  } });
  const legal = { displayName: "Test Employee", legalAccepted: true, termsVersion: TERMS_OF_SERVICE_VERSION, privacyPolicyVersion: PRIVACY_POLICY_VERSION, legalNoticeVersion: ACCOUNT_ACCEPTANCE_NOTICE_VERSION };
  try {
    for (const file of (await readdir("drizzle")).filter(name => /^\d{4}.*\.sql$/.test(name)).sort()) {
      for (const sql of (await readFile(`drizzle/${file}`, "utf8")).split("--> statement-breakpoint").map(sql => sql.trim()).filter(Boolean)) await db.prepare(sql).run();
    }
    (globalThis as unknown as { __vanteloqEnv: unknown }).__vanteloqEnv = { DB: db, SUPABASE_URL: "https://test.supabase.co", SUPABASE_PUBLISHABLE_KEY: "test-public", VANTELOQ_INTERNAL_ACCESS_ENABLED: "true" };
    await db.prepare("INSERT INTO users (id,email,auth_subject,auth_provider,display_name,status,created_at,updated_at) VALUES ('owner',?,?,'supabase','Owner','active',?,?)").bind(ownerEmail, ownerSubject, now, now).run();
    await db.prepare("INSERT INTO workspaces (id,owner_name,business_name,legal_name,business_email,industry,city,address,postal_code,hours_json,created_at,updated_at) VALUES ('company','Owner','Company','Company',?,'Retail','Edmonton','Test','T1T1T1','[]',?,?)").bind(ownerEmail, now, now).run();
    await db.prepare("INSERT INTO memberships (id,user_id,organization_id,role,status,created_at,updated_at) VALUES ('owner-membership','owner','company','owner','active',?,?)").bind(now, now).run();
    await db.prepare("INSERT INTO internal_access (id,user_id,organization_id,access_level,reason,active,mfa_required,created_by_user_id,created_at,updated_at) VALUES ('owner-internal','owner','company','founder','Owner',1,1,'owner',?,?)").bind(now, now).run();
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/rest/v1/team_access_invitations") {
        if (invalidInvitationResponse) return Response.json({ message: "Unexpected upstream response" });
        const row = rows.get(url.searchParams.get("email")!.slice(3));
        return Response.json(row && ["pending", "accepted"].includes(String(row.status)) ? [row] : []);
      }
      if (url.pathname === "/functions/v1/management-console") {
        if (failFinalization) return Response.json({ error: "Unavailable" }, { status: 503 });
        const body = JSON.parse(String(init?.body));
        const row = [...rows.values()].find(row => row.id === body.invitationId)!;
        row.status = "accepted";
        row.accepted_at = new Date().toISOString();
        return Response.json({ accepted: true });
      }
      throw new Error(`Unexpected external call: ${url.origin}${url.pathname}`);
    };
    let manager: TrustedIdentity | null = null;
    const newCustomer = identity("new-customer@example.invalid", crypto.randomUUID());
    assert.equal(await pendingTeamInvitation(request(newCustomer), newCustomer), null);
    invalidInvitationResponse = true;
    await assert.rejects(pendingTeamInvitation(request(newCustomer), newCustomer), /could not be checked safely/);
    invalidInvitationResponse = false;
    for (const role of ["manager", "read_only", "admin"]) {
      const email = `${role}@example.invalid`;
      const person = identity(email, crypto.randomUUID());
      if (role === "manager") manager = person;
      const row = { id: crypto.randomUUID(), email, invited_by_email: ownerEmail, invited_by_user_id: ownerSubject, vanteloq_access: true, vanteloq_role: role,
        console_access: true, console_role: "viewer", console_scopes: ["vanteloq"], invitation_generation: crypto.randomUUID(), status: "pending", expires_at: new Date(now + 86_400_000).toISOString(),
        auth_user_id: person.subject, accepted_at: null, acceptance_notice_version: null, lifecycle_operation: null };
      rows.set(email, row);
      assert.equal((await pendingTeamInvitation(request(person), person))?.vanteloqRole, role);
      const result = await acceptTeamInvitation(request(person), person, legal, crypto.randomUUID());
      assert.equal(result.role, role);
      assert.match(result.consoleActivationUrl!, /^https:\/\/lexedgeconsole\.com\/invite/);
      assert.equal(await pendingTeamInvitation(request(person), person), null);
      const context = await findAccessContext(person, request(person));
      assert.ok(context);
      assert.equal(context.role, role);
      assert.equal((await getTenantEntitlements(context)).accessType, "internal");
      assert.equal(await verifiedTeamProvisioning(request(person), person, row.id), true);
      await acceptTeamInvitation(request(person), person, legal, crypto.randomUUID());
      row.invitation_generation = crypto.randomUUID();
      assert.equal(await findAccessContext(person, request(person)), null, "stale receipt must not grant access");
      assert.ok(await pendingTeamInvitation(request(person), person));
      await acceptTeamInvitation(request(person), person, legal, crypto.randomUUID());
      row.lifecycle_operation = "delete" as never;
      assert.equal(await findAccessContext(person, request(person)), null, "in-progress delete blocks even active local membership");
      row.lifecycle_operation = null;
      row.status = "revoked";
      assert.equal(await findAccessContext(person, request(person)), null);
      await assert.rejects(acceptTeamInvitation(request(person), person, legal, crypto.randomUUID()), /missing, expired/);
    }
    assert.ok(manager);
    const row = rows.get(manager.email)!;
    row.status = "pending";
    row.invitation_generation = crypto.randomUUID();
    failFinalization = true;
    await assert.rejects(acceptTeamInvitation(request(manager), manager, legal, crypto.randomUUID()), /could not be finalized/);
    assert.equal(await findAccessContext(manager, request(manager)), null, "D1 writes without finalization never grant app access");
    failFinalization = false;
    await acceptTeamInvitation(request(manager), manager, legal, crypto.randomUUID());
    assert.ok(await findAccessContext(manager, request(manager)), "retry recovers safely");
    row.expires_at = "2020-01-01";
    assert.ok(await findAccessContext(manager, request(manager)), "accepted access survives invitation expiry");
    assert.equal(await liveTeamMembershipAllowed(undefined, manager, (await findAccessContext(manager, request(manager)))!.userId, "company", "manager"), false);
    assert.equal((await db.prepare("SELECT count(*) n FROM tenant_subscriptions").first<{ n: number }>())!.n, 0);
    assert.equal((await db.prepare("SELECT count(*) n FROM memberships WHERE role != 'owner'").first<{ n: number }>())!.n, 3);
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
});
