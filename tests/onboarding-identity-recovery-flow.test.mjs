import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";
import { Miniflare } from "miniflare";
import { registerSupabaseTestServer } from "./helpers/supabase-loopback-transport.mjs";
import { TERMS_OF_SERVICE_VERSION, PRIVACY_POLICY_VERSION, ACCOUNT_ACCEPTANCE_NOTICE_VERSION } from "../shared/legal-versions.ts";

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
    emailNotifications: true,
    timezone: "America/Edmonton",
    currency: "CAD",
    fiscalYearStart: "January",
    taxNumber: "",
    sourceMode: "connect_later",
    selectedPos: "",
    legalAccepted: true,
    termsVersion: TERMS_OF_SERVICE_VERSION,
    privacyPolicyVersion: PRIVACY_POLICY_VERSION,
    legalNoticeVersion: ACCOUNT_ACCEPTANCE_NOTICE_VERSION,
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
      SUPABASE_URL: registerSupabaseTestServer(authAddress.port),
      SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
      // A configured but unavailable address service must not block manual setup.
      ADDRESSCOMPLETE_API_KEY: "fictional-address-key-not-used",
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    };

    const now = Date.now();
    const originalEmail = "email-change-before@example.invalid";
    const originalProfile = await worker.fetch(new Request(`${origin}/api/v1/onboarding`, {
      method: "POST", headers: headers(originalEmail, "unchanged-auth-subject"),
      body: JSON.stringify(onboardingPayload("Email Change Store", originalEmail)),
    }), environment, context);
    assert.equal(originalProfile.status, 201);
    const originalOrganization = (await originalProfile.json()).organization.id;
    const emailChangeReadback = await worker.fetch(new Request(`${origin}/api/v1/onboarding`, {
      headers: headers("email-change-after@example.invalid", "unchanged-auth-subject"),
    }), environment, context);
    assert.equal((await emailChangeReadback.json()).organization?.id, originalOrganization,
      "An email change must not send the same verified owner through signup again");
    const checkoutEmail = "checkout-first@example.invalid";
    const checkoutHeaders = headers(checkoutEmail, "checkout-first-subject");
    const checkoutBody = { stage: "checkout", legalAccepted: true, termsVersion: TERMS_OF_SERVICE_VERSION,
      privacyPolicyVersion: PRIVACY_POLICY_VERSION, legalNoticeVersion: ACCOUNT_ACCEPTANCE_NOTICE_VERSION };
    const catalogue = await worker.fetch(new Request(`${origin}/api/v1/billing?onboarding=1`, {
      headers: checkoutHeaders,
    }), environment, context);
    assert.equal(catalogue.status, 200);
    const options = await catalogue.json();
    assert.equal(options.needsWorkspace, true);
    assert.equal(options.accessType, "none");
    assert.deepEqual(options.plans.map(plan => [plan.key, plan.price]),
      [["starter", 4900], ["growth", 9900], ["pro", 17900], ["bookloq", 5900]]);
    assert.equal((await database.prepare("SELECT COUNT(*) n FROM users WHERE email=?").bind(checkoutEmail).first()).n, 0,
      "Viewing plan prices must not create a workspace or record consent");
    const invalidConsent = await worker.fetch(new Request(`${origin}/api/v1/onboarding`, {
      method: "POST", headers: headers("checkout-no-consent@example.invalid", "checkout-no-consent"),
      body: JSON.stringify({ ...checkoutBody, legalAccepted: false }),
    }), environment, context);
    assert.equal(invalidConsent.status, 409);
    assert.equal((await invalidConsent.json()).error.code, "LEGAL_ACCEPTANCE_REQUIRED");
    const prepareCheckout = () => worker.fetch(new Request(`${origin}/api/v1/onboarding`, {
      method: "POST", headers: checkoutHeaders, body: JSON.stringify(checkoutBody),
    }), environment, context);
    const prepared = await prepareCheckout();
    assert.equal(prepared.status, 201, await prepared.clone().text());
    const pendingOrganization = (await prepared.json()).organization;
    assert.equal(pendingOrganization.setupComplete, false);
    assert.equal(pendingOrganization.businessName, "");
    assert.equal((await database.prepare("SELECT COUNT(*) n FROM organization_locations WHERE organization_id=?").bind(pendingOrganization.id).first()).n, 0);
    const resumed = await prepareCheckout();
    assert.equal(resumed.status, 200);
    assert.equal((await resumed.json()).organization.id, pendingOrganization.id);
    const cancelledReturn = await worker.fetch(new Request(`${origin}/api/v1/billing?onboarding=1&billing=success`, {
      headers: checkoutHeaders,
    }), environment, context);
    assert.equal((await cancelledReturn.json()).accessType, "none", "A success query string cannot grant paid access");
    const unpaidCompletion = await worker.fetch(new Request(`${origin}/api/v1/onboarding`, {
      method: "POST", headers: checkoutHeaders, body: JSON.stringify(onboardingPayload("Checkout Store", checkoutEmail)),
    }), environment, context);
    assert.equal(unpaidCompletion.status, 402, await unpaidCompletion.clone().text());
    assert.equal((await database.prepare("SELECT setup_complete FROM workspaces WHERE id=?").bind(pendingOrganization.id).first()).setup_complete, 0);
    await database.prepare(`INSERT INTO tenant_subscriptions (organization_id,base_plan,status,created_at,updated_at)
      VALUES (?,'starter','active',?,?)`).bind(pendingOrganization.id, now, now).run();
    const pendingProduct = await worker.fetch(new Request(`${origin}/api/v1/tasks`, { headers: checkoutHeaders }), environment, context);
    assert.equal(pendingProduct.status, 409);
    assert.equal((await pendingProduct.json()).error.code, "SETUP_REQUIRED");
    const paidCompletion = await worker.fetch(new Request(`${origin}/api/v1/onboarding`, {
      method: "POST", headers: checkoutHeaders, body: JSON.stringify({...onboardingPayload("Checkout Store", checkoutEmail),dashboardPreferences:{chart:"bar",priorities:["cash"]}}),
    }), environment, context);
    assert.equal(paidCompletion.status, 201, await paidCompletion.clone().text());
    assert.equal((await paidCompletion.json()).organization.id, pendingOrganization.id);
    assert.equal((await database.prepare("SELECT setup_complete FROM workspaces WHERE id=?").bind(pendingOrganization.id).first()).setup_complete, 1);
    const preferencesRequest = (body) => worker.fetch(new Request(`${origin}/api/v1/preferences`, {headers:checkoutHeaders,...(body ? {method:"POST",body:JSON.stringify(body)} : {})}),environment,context);
    let readPreferences=await preferencesRequest();
    assert.equal(readPreferences.status,200,await readPreferences.clone().text());
    const initialPreferences=(await readPreferences.json()).dashboardPreferences;
    assert.equal(initialPreferences.chart,"bar","Onboarding layout must persist");
    assert.deepEqual(initialPreferences.priorities,["cash"]);
    const concurrent=await Promise.all([
      preferencesRequest({dashboardPreferences:{...initialPreferences,chart:"line"}}),
      preferencesRequest({collectionsPreferences:{horizon:7,density:"compact"}}),
    ]);
    for(const result of concurrent)assert.equal(result.status,200,await result.clone().text());
    const concurrentSaved=(await (await preferencesRequest()).json()).dashboardPreferences;
    assert.equal(concurrentSaved.chart,"line");assert.equal(concurrentSaved.collections.horizon,7);assert.equal(concurrentSaved.collections.density,"compact");
    const forged=await preferencesRequest({dashboardPreferences:{...concurrentSaved,views:[{name:"Forged",layout:{goalRules:{net_revenue:{direction:"higher",from:"2026-09-01",to:"2026-09-30",locationId:"foreign-location"}}}}]}});
    assert.equal(forged.status,400);assert.equal((await forged.json()).error.code,"INVALID_LOCATION");
    const future=await preferencesRequest({dashboardPreferences:{...concurrentSaved,views:[{name:"Future",layout:{defaultPeriod:"custom",customDates:{from:"2099-01-01",to:"2099-01-31"}}}]}});
    assert.equal(future.status,400);
    const fixtureUser=await database.prepare("SELECT id FROM users WHERE email=?").bind(checkoutEmail).first();
    await database.prepare("UPDATE account_preferences SET dashboard_preferences_json=? WHERE user_id=?").bind(JSON.stringify({workspaceId:"another-workspace",dashboard:{chart:"bar",targets:{net_revenue:99999}}}),fixtureUser.id).run();
    const isolated=(await (await preferencesRequest()).json()).dashboardPreferences;
    assert.equal(isolated.chart,"line");assert.equal(isolated.targets.net_revenue,undefined);
    await database.prepare("UPDATE account_preferences SET dashboard_preferences_json=? WHERE user_id=?").bind(JSON.stringify({workspaceId:pendingOrganization.id,dashboard:{...concurrentSaved,goalRules:{net_revenue:{direction:"higher",from:"2026-09-01",to:"2026-09-30",locationId:"revoked-location"}}}}),fixtureUser.id).run();
    assert.equal((await preferencesRequest({collectionsPreferences:{horizon:90}})).status,200,"A stale saved goal must not block unrelated collection settings");
    await database.prepare("DELETE FROM legal_acceptances WHERE user_id=?").bind(fixtureUser.id).run();
    const legalRequest=body=>worker.fetch(new Request(`${origin}/api/v1/legal/acceptance`,{headers:checkoutHeaders,...(body?{method:"POST",body:JSON.stringify(body)}:{})}),environment,context);
    assert.equal((await (await legalRequest()).json()).accepted,false);
    for(let attempt=0;attempt<6;attempt++){
      const stale=await legalRequest({accepted:true,termsVersion:"old",privacyPolicyVersion:"old",noticeVersion:"old"});
      assert.equal(stale.status,409);assert.equal((await stale.json()).error.code,"LEGAL_VERSION_CHANGED");
    }
    const legalBody={accepted:true,termsVersion:TERMS_OF_SERVICE_VERSION,privacyPolicyVersion:PRIVACY_POLICY_VERSION,noticeVersion:ACCOUNT_ACCEPTANCE_NOTICE_VERSION};
    assert.equal((await legalRequest(legalBody)).status,200);
    assert.equal((await legalRequest(legalBody)).status,200);
    assert.equal((await database.prepare("SELECT COUNT(*) n FROM legal_acceptances WHERE user_id=?").bind(fixtureUser.id).first()).n,1);
    assert.equal((await (await legalRequest()).json()).accepted,true);
    const changedEmail = await worker.fetch(new Request(`${origin}/api/v1/onboarding`, {
      headers: headers("updated-checkout@example.invalid", "checkout-first-subject"),
    }), environment, context);
    assert.equal(changedEmail.status, 200);
    assert.equal((await changedEmail.json()).organization?.id, pendingOrganization.id,
      "A verified email change must preserve workspace access for the same authentication subject");
    const lookupStatus = await worker.fetch(new Request(`${origin}/api/v1/address`, {
      headers: headers("lookup-owner@example.invalid", "lookup-subject"),
    }), environment, context);
    assert.equal(lookupStatus.status, 200);
    assert.deepEqual(await lookupStatus.json(), { configured: false, provider: null, manualEntry: true });
    const pausedLookup = await worker.fetch(new Request(`${origin}/api/v1/address`, {
      method: "POST", headers: headers("lookup-owner@example.invalid", "lookup-subject"),
      body: JSON.stringify({ action: "find", search: "123 Fictional Avenue", country: "CA" }),
    }), environment, context);
    assert.equal(pausedLookup.status, 503);
    assert.equal((await pausedLookup.json()).error.code, "ADDRESS_LOOKUP_UNAVAILABLE");
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
    const location = await database.prepare(`SELECT country_code, administrative_area, postal_code, validation_status
      FROM organization_locations WHERE organization_id = (SELECT organization_id FROM memberships WHERE user_id = ?)`)
      .bind("orphan-user-row").first();
    assert.deepEqual(location, { country_code: "CA", administrative_area: "AB", postal_code: "T5J 4G8", validation_status: "entered" });

    const usEmail = "manual-us-owner@example.invalid";
    const usPayload = { ...onboardingPayload("Manual US Store", usEmail), country: "US", province: "WA",
      city: "Seattle", address: "123 Fictional Avenue", postalCode: "98101", currency: "USD", timezone: "America/Los_Angeles",
      addressVerificationToken: "stale-legacy-proof-must-not-mark-address-verified" };
    const usCreated = await worker.fetch(new Request(`${origin}/api/v1/onboarding`, {
      method: "POST", headers: headers(usEmail, "manual-us-subject"), body: JSON.stringify(usPayload),
    }), environment, context);
    assert.equal(usCreated.status, 201, await usCreated.clone().text());
    assert.deepEqual(await database.prepare(`SELECT country_code, administrative_area, postal_code, validation_status
      FROM organization_locations WHERE organization_id = (SELECT id FROM workspaces WHERE business_name = ?)`)
      .bind("Manual US Store").first(), { country_code: "US", administrative_area: "WA", postal_code: "98101", validation_status: "entered" });

    for (const [index, invalid] of [
      { country: "ZZ" }, { province: "WA" }, { postalCode: "not a postal code" }, { address: "" }, { city: "" },
      { country: "US", province: "AB", postalCode: "98101" }, { country: "US", province: "WA", postalCode: "T5J 4G8" },
    ].entries()) {
      const email = `invalid-address-${index}@example.invalid`;
      const rejected = await worker.fetch(new Request(`${origin}/api/v1/onboarding`, {
        method: "POST", headers: headers(email, `invalid-address-${index}`),
        body: JSON.stringify({ ...onboardingPayload(`Invalid Address ${index}`, email), ...invalid }),
      }), environment, context);
      assert.equal(rejected.status, 400, await rejected.clone().text());
      assert.equal((await database.prepare("SELECT COUNT(*) count FROM workspaces WHERE business_name = ?")
        .bind(`Invalid Address ${index}`).first()).count, 0);
    }

    const consentEmail = "manual-consent@example.invalid";
    const noConsent = await worker.fetch(new Request(`${origin}/api/v1/onboarding`, {
      method: "POST", headers: headers(consentEmail, "manual-consent-subject"),
      body: JSON.stringify({ ...onboardingPayload("Missing Consent", consentEmail), legalAccepted: false }),
    }), environment, context);
    assert.equal(noConsent.status, 409);
    assert.equal((await noConsent.json()).error.code, "LEGAL_ACCEPTANCE_REQUIRED");

    const wrongOrigin = await worker.fetch(new Request(`${origin}/api/v1/onboarding`, {
      method: "POST", headers: { ...headers("origin@example.invalid", "origin-subject"), origin: "https://untrusted.example", "sec-fetch-site": "cross-site" },
      body: JSON.stringify(onboardingPayload("Wrong Origin", "origin@example.invalid")),
    }), environment, context);
    assert.equal(wrongOrigin.status, 403);

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

    const blockedLookup = await worker.fetch(new Request(`${origin}/api/v1/onboarding`, {
      headers: headers(protectedEmail, "protected-replacement-subject"),
    }), environment, context);
    assert.equal(blockedLookup.status, 403);
    assert.equal((await blockedLookup.json()).error.code, "IDENTITY_CONFLICT");

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
