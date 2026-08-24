import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";
import { Miniflare } from "miniflare";

const origin = "https://vanteloq.example";
const context = { waitUntil() {}, passThroughOnException() {} };

function headers(email, subject, aal = "aal2") {
  const payload = Buffer.from(JSON.stringify({
    email,
    subject,
    full_name: "Verified Owner",
    aal,
    session_id: `session:${subject}`,
  })).toString("base64url");
  return {
    accept: "application/json",
    authorization: `Bearer test.${payload}.signature`,
    "content-type": "application/json",
    origin,
    "sec-fetch-site": "same-origin",
  };
}

function onboardingPayload(businessName, email) {
  return {
    ownerName: "Verified Owner",
    businessName,
    legalName: `${businessName} Ltd.`,
    businessEmail: email,
    phone: "",
    website: "",
    industry: "Retail",
    country: "CA",
    province: "AB",
    city: "Edmonton",
    address: "10155 102 Street NW",
    postalCode: "T5J 4G8",
    addressVerificationToken: "",
    emailNotifications: true,
    timezone: "America/Edmonton",
    currency: "CAD",
    fiscalYearStart: "January",
    taxNumber: "",
    sourceMode: "connect_later",
    selectedPos: "",
    legalAccepted: true,
    termsVersion: "2026-08-16",
    privacyPolicyVersion: "2026-08-16",
    legalNoticeVersion: "account-creation-v1",
    hours: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
      .map((day) => ({ day, open: "09:00", close: "17:00", closed: false })),
  };
}

async function applyMigrations(database) {
  const migrations = (await readdir(new URL("../drizzle/", import.meta.url)))
    .filter((file) => /^\d{4}.*\.sql$/.test(file))
    .sort();
  for (const migration of migrations) {
    const sql = await readFile(new URL(`../drizzle/${migration}`, import.meta.url), "utf8");
    for (const statement of sql.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
      await database.prepare(statement).run();
    }
  }
}

test("onboarding rebinds only orphaned Supabase rows and protects existing workspaces", async () => {
  const authServer = createServer((request, response) => {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      id: payload.subject,
      email: payload.email,
      email_confirmed_at: "2026-08-01T00:00:00.000Z",
      user_metadata: { full_name: payload.full_name },
    }));
  });
  await new Promise((resolve) => authServer.listen(0, "127.0.0.1", resolve));
  const authAddress = authServer.address();
  assert.ok(authAddress && typeof authAddress !== "string");

  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: `vanteloq-identity-recovery-${crypto.randomUUID()}` },
  });
  const database = await miniflare.getD1Database("DB");
  try {
    await applyMigrations(database);
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("identity-recovery-test", crypto.randomUUID());
    const worker = (await import(workerUrl.href)).default;
    const environment = {
      DB: database,
      SUPABASE_URL: `http://127.0.0.1:${authAddress.port}`,
      SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    };

    const now = Date.now();
    const orphanEmail = "recreated-owner@example.invalid";
    await database.prepare(`INSERT INTO users
      (id, email, auth_subject, auth_provider, display_name, status, created_at, updated_at)
      VALUES (?, ?, ?, 'supabase', 'Old Owner', 'active', ?, ?)`)
      .bind("orphan-user-row", orphanEmail, "deleted-supabase-subject", now, now)
      .run();

    const recovered = await worker.fetch(new Request(`${origin}/api/v1/onboarding`, {
      method: "POST",
      headers: headers(orphanEmail, "replacement-supabase-subject"),
      body: JSON.stringify(onboardingPayload("Recovered Store", orphanEmail)),
    }), environment, context);
    assert.equal(recovered.status, 201, await recovered.clone().text());
    const recoveredUser = await database.prepare(`SELECT id, auth_subject authSubject FROM users WHERE email = ?`)
      .bind(orphanEmail).first();
    assert.deepEqual(recoveredUser, { id: "orphan-user-row", authSubject: "replacement-supabase-subject" });
    assert.equal((await database.prepare(`SELECT COUNT(*) count FROM memberships WHERE user_id = ?`)
      .bind("orphan-user-row").first()).count, 1);

    const protectedEmail = "protected-owner@example.invalid";
    const created = await worker.fetch(new Request(`${origin}/api/v1/onboarding`, {
      method: "POST",
      headers: headers(protectedEmail, "protected-original-subject"),
      body: JSON.stringify(onboardingPayload("Protected Store", protectedEmail)),
    }), environment, context);
    assert.equal(created.status, 201, await created.clone().text());

    const blockedWithoutMfa = await worker.fetch(new Request(`${origin}/api/v1/onboarding`, {
      method: "POST",
      headers: headers(protectedEmail, "protected-replacement-subject", "aal1"),
      body: JSON.stringify(onboardingPayload("Protected Store", protectedEmail)),
    }), environment, context);
    assert.equal(blockedWithoutMfa.status, 403, await blockedWithoutMfa.clone().text());
    assert.equal((await database.prepare(`SELECT auth_subject authSubject FROM users WHERE email = ?`)
      .bind(protectedEmail).first()).authSubject, "protected-original-subject");

    const blockedExisting = await worker.fetch(new Request(`${origin}/api/v1/onboarding`, {
      method: "POST",
      headers: headers(protectedEmail, "protected-replacement-subject"),
      body: JSON.stringify(onboardingPayload("Replacement Input Must Not Overwrite", protectedEmail)),
    }), environment, context);
    assert.equal(blockedExisting.status, 403, await blockedExisting.clone().text());
    assert.equal((await blockedExisting.json()).error.code, "IDENTITY_CONFLICT");
    assert.equal((await database.prepare(`SELECT auth_subject authSubject FROM users WHERE email = ?`)
      .bind(protectedEmail).first()).authSubject, "protected-original-subject");
    assert.equal((await database.prepare(`SELECT COUNT(*) count FROM memberships WHERE user_id = (
        SELECT id FROM users WHERE email = ?
      )`).bind(protectedEmail).first()).count, 1);
    assert.equal((await database.prepare(`SELECT COUNT(*) count FROM workspaces WHERE business_name = ?`)
      .bind("Replacement Input Must Not Overwrite").first()).count, 0);
    assert.equal((await database.prepare(`SELECT COUNT(*) count FROM audit_events
        WHERE action = 'account.identity_recovered' AND actor_user_id = (
          SELECT id FROM users WHERE email = ?
        )`).bind(protectedEmail).first()).count, 0);
  } finally {
    await miniflare.dispose();
    authServer.closeAllConnections();
    await new Promise((resolve, reject) => authServer.close((error) => error ? reject(error) : resolve()));
  }
});
