import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";
import { Miniflare } from "miniflare";
import { registerSupabaseTestServer } from "./helpers/supabase-loopback-transport.mjs";
import { activateTestSubscription } from "./helpers/subscription-fixture.mjs";
import { importPrivacyAcknowledgement } from "../domain/report-import-privacy";
import { providerPrivacyAcceptance } from "../domain/provider-privacy.ts";
import { TERMS_OF_SERVICE_VERSION, PRIVACY_POLICY_VERSION, ACCOUNT_ACCEPTANCE_NOTICE_VERSION } from "../shared/legal-versions.ts";

const origin = "https://vanteloq.example";
const executionContext = { waitUntil() {}, passThroughOnException() {} };

function identityHeaders(email: string, write = false) {
  const payload = Buffer.from(JSON.stringify({
    email,
    aal: "aal2",
    session_id: `session:${email}`,
  })).toString("base64url");
  const headers: Record<string, string> = {
    accept: "application/json",
    authorization: `Bearer test.${payload}.signature`,
  };
  if (write) {
    headers["content-type"] = "application/json";
    headers.origin = origin;
    headers["sec-fetch-site"] = "same-origin";
  }
  return headers;
}

function onboardingBody(ownerName: string, businessName: string) {
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  return {
    ownerName,
    businessName,
    legalName: `${businessName} Ltd.`,
    businessEmail: `${businessName.toLowerCase().replace(/[^a-z]/g, "")}@example.invalid`,
    phone: "",
    website: "",
    industry: "Retail",
    country: "CA",
    province: "AB",
    city: "Edmonton",
    address: "1 Test Avenue",
    postalCode: "T5A 1A1",
    emailNotifications: true,
    timezone: "America/Edmonton",
    currency: "CAD",
    fiscalYearStart: "January",
    taxNumber: "",
    hours: days.map((day) => ({ day, open: "10:00", close: "21:00", closed: false })),
    sourceMode: "csv",
    selectedPos: "",
    legalAccepted: true,
    termsVersion: TERMS_OF_SERVICE_VERSION,
    privacyPolicyVersion: PRIVACY_POLICY_VERSION,
    legalNoticeVersion: ACCOUNT_ACCEPTANCE_NOTICE_VERSION,
  };
}

async function createEnvironment() {
  const authServer = createServer((request, response) => {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      id: `test-user:${payload.email}`,
      email: payload.email,
      email_confirmed_at: "2026-08-01T00:00:00.000Z",
      user_metadata: { full_name: payload.email },
    }));
  });
  await new Promise<void>((resolve) => authServer.listen(0, "127.0.0.1", resolve));
  const address = authServer.address();
  assert.ok(address && typeof address !== "string");

  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: `vanteloq-bookloq-cash-${crypto.randomUUID()}` },
  });
  const database = await miniflare.getD1Database("DB");
  const migrations = (await readdir(new URL("../drizzle/", import.meta.url)))
    .filter((file) => /^\d{4}.*\.sql$/.test(file))
    .sort();
  for (const migration of migrations) {
    const sql = await readFile(new URL(`../drizzle/${migration}`, import.meta.url), "utf8");
    for (const statement of sql.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
      await database.prepare(statement).run();
    }
  }

  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("bookloq-cash-regression", crypto.randomUUID());
  const worker = (await import(workerUrl.href)).default;
  const environment = {
    DB: database,
    BOOKLOQ_DEMO_ENABLED: "true",
    SUPABASE_URL: registerSupabaseTestServer(address.port),
    SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  };
  const dispose = async () => {
    try {
      await miniflare.dispose();
    } finally {
      authServer.closeAllConnections();
      await new Promise<void>((resolve, reject) => authServer.close((error) => error ? reject(error) : resolve()));
    }
  };
  return { worker, environment, database, dispose };
}

async function dispatch(
  worker: { fetch: (request: Request, environment: unknown, context: unknown) => Promise<Response> },
  environment: unknown,
  path: string,
  options: { method?: string; email: string; body?: unknown; idempotencyKey?: string },
) {
  const method = options.method ?? "GET";
  const headers = identityHeaders(options.email, method !== "GET");
  if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;
  return worker.fetch(new Request(`${origin}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  }), environment, executionContext);
}

test("regular Free enrolment, setup, caps and upgrade stay in the same workspace without Stripe signup", async () => {
  const { worker, environment, database, dispose } = await createEnvironment();
  const originalFetch = globalThis.fetch;
  let stripeCalls = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    if (url.hostname === "api.stripe.com") { stripeCalls++; throw new Error("Free must not contact Stripe"); }
    return originalFetch(input, init);
  };
  const email = `free-${crypto.randomUUID()}@example.invalid`;
  const call = (path: string, method = "GET", body?: unknown, key?: string) => dispatch(worker,environment,path,{email,method,body:path === "/api/v1/daily-metrics" && body && typeof body === "object" ? { importPrivacyAcknowledgement: importPrivacyAcknowledgement(), ...body } : body,idempotencyKey:key});
  const expect = async (response: Response, status: number) => { assert.equal(response.status,status,await response.clone().text()); return response.json(); };
  try {
    const prepared = await expect(await call("/api/v1/onboarding","POST",{stage:"checkout",legalAccepted:true,termsVersion:TERMS_OF_SERVICE_VERSION,privacyPolicyVersion:PRIVACY_POLICY_VERSION,legalNoticeVersion:ACCOUNT_ACCEPTANCE_NOTICE_VERSION}),201);
    const org = prepared.organization.id;
    const offers = await expect(await call("/api/v1/billing?onboarding=1"),200);
    assert.equal(offers.configured,false);
    assert.equal(offers.freePlan.key,"free");
    const activated = await Promise.all([call("/api/v1/billing/free","POST",{}),call("/api/v1/billing/free","POST",{})]);
    for (const response of activated) assert.equal((await expect(response,200)).activated,true);
    let access = await expect(await call("/api/v1/entitlements"),200);
    assert.equal(access.accessType,"free");
    assert.equal(access.current.plan,"free");
    const finished = await expect(await call("/api/v1/onboarding","POST",onboardingBody("Free Owner","Free Pilot")),201);
    assert.equal(finished.organization.id,org);
    assert.equal(finished.organization.setupComplete,true);
    await expect(await call("/api/v1/command-centre"),200);
    await expect(await call("/api/v1/governance"),200);
    await expect(await call("/api/v1/governance","POST",{action:"update_profile",displayName:"Free Owner Updated",jobTitle:"Owner",emailNotifications:true}),200);
    await expect(await call("/api/v1/governance","POST",{action:"create_employee"}),403);
    await expect(await call("/api/v1/governance","POST",{action:"create_location"}),409);
    await expect(await call("/api/v1/bookloq"),403);
    await expect(await call("/api/v1/forecasting"),403);
    const privacy = providerPrivacyAcceptance(true);
    const selectedProviders = async () => (await database.prepare("SELECT provider FROM free_integration_selections WHERE organization_id=? ORDER BY provider")
      .bind(org).all<{provider:string}>()).results.map((selection: { provider: string }) => selection.provider);
    const missingPrivacy = await expect(await call("/api/v1/integrations/square/authorize","POST",{}),400);
    assert.equal(missingPrivacy.error.code,"PROVIDER_PRIVACY_REQUIRED");
    const unavailable = await expect(await call("/api/v1/integrations/square/authorize","POST",privacy),503);
    assert.equal(unavailable.error.code,"INTEGRATION_PROVIDER_UNAVAILABLE");
    const invalidProvider = await expect(await call("/api/v1/integrations","POST",{action:"select_provider",provider:"unknown"}),400);
    assert.equal(invalidProvider.error.code,"INTEGRATION_PROVIDER_UNAVAILABLE");
    const previewProvider = await expect(await call("/api/v1/integrations","POST",{action:"select_provider",provider:"shopify"}),403);
    assert.equal(previewProvider.error.code,"INTEGRATION_COMING_SOON");
    assert.deepEqual(await selectedProviders(),[],"Privacy, readiness and rollout failures must not consume a choice");
    Object.assign(environment, {
      SQUARE_APPLICATION_ID:"square-test-app", SQUARE_APPLICATION_SECRET:"square-test-secret", SQUARE_ENV:"sandbox",
      SQUARE_REDIRECT_URI:`${origin}/api/v1/integrations/square/callback`,
      SLACK_CLIENT_ID:"1234567890.1234567890", SLACK_CLIENT_SECRET:"slack-test-secret",
      SLACK_REDIRECT_URI:`${origin}/api/v1/integrations/slack/callback`,
      LIGHTSPEED_R_CLIENT_ID:"r-test-app", LIGHTSPEED_R_CLIENT_SECRET:"r-test-secret",
      LIGHTSPEED_R_REDIRECT_URI:`${origin}/api/v1/integrations/lightspeed-r/callback`,
      INTEGRATION_ENCRYPTION_KEY:Buffer.alloc(32,1).toString("base64"),
    });
    const square = await expect(await call("/api/v1/integrations/square/authorize","POST",privacy),200);
    assert.equal(new URL(square.authorizationUrl).hostname,"connect.squareupsandbox.com");
    await expect(await call("/api/v1/integrations/slack/authorize","POST",privacy),200);
    // Pending authorizations occupy slots, while another account at the same provider does not.
    const anotherSquare = await expect(await call("/api/v1/integrations/square/authorize","POST",privacy),200);
    assert.deepEqual(await selectedProviders(),["slack","square"]);
    const grants = (await database.prepare("SELECT free_grant_id FROM integration_connections WHERE organization_id=? AND provider='square'")
      .bind(org).all<{free_grant_id:string|null}>()).results;
    assert.equal(grants.length,2);
    assert.ok(grants[0].free_grant_id);
    assert.equal(grants[0].free_grant_id,grants[1].free_grant_id);
    const full = await expect(await call("/api/v1/integrations/lightspeed-r/authorize","POST",privacy),402);
    assert.equal(full.error.code,"FREE_INTEGRATION_LIMIT");
    assert.equal((await database.prepare("SELECT COUNT(*) total FROM integration_connections WHERE organization_id=? AND provider='lightspeed-r'")
      .bind(org).first<{total:number}>())?.total,0);
    await expect(await call("/api/v1/integrations/square/disconnect","POST",{connectionId:square.connectionId}),200);
    assert.deepEqual(await selectedProviders(),["slack","square"],"Another pending account retains the provider choice");
    await expect(await call("/api/v1/integrations/square/disconnect","POST",{connectionId:anotherSquare.connectionId}),200);
    assert.deepEqual(await selectedProviders(),["slack"]);
    await expect(await call("/api/v1/integrations/lightspeed-r/authorize","POST",privacy),200);
    assert.deepEqual(await selectedProviders(),["lightspeed-r","slack"]);
    await expect(await call("/api/v1/reports?format=csv"),403);
    const row = (index: number) => ({ businessDate:new Date(Date.UTC(2026,0,index+1)).toISOString().slice(0,10),locationRef:"all",grossSalesCents:1000,netSalesCents:900,costOfGoodsCents:300,transactionCount:2,unitsSold:2 });
    const bad = await expect(await call("/api/v1/daily-metrics","POST",{importType:"manual_entry",rows:[{...row(0),locationRef:"other-location"}]},crypto.randomUUID()),403);
    assert.equal(bad.error.code,"FREE_PLAN_LOCATION_LIMIT");
    const importKey = crypto.randomUUID();
    const payload = {importType:"daily_summary_csv",rows:Array.from({length:100},(_,index)=>row(index))};
    await expect(await call("/api/v1/daily-metrics","POST",payload,importKey),201);
    const replay = await expect(await call("/api/v1/daily-metrics","POST",payload,importKey),200);
    assert.equal(replay.replayed,true);
    const over = await expect(await call("/api/v1/daily-metrics","POST",{importType:"manual_entry",rows:[row(101)]},crypto.randomUUID()),402);
    assert.equal(over.error.code,"FREE_PLAN_LIMIT_REACHED");
    await expect(await call("/api/v1/reports"),200);
    const billing = await expect(await call("/api/v1/billing"),200);
    assert.equal(billing.freeUsage.importRows.used,100);
    assert.equal(billing.trialEligible,true);
    assert.equal(billing.current.hasCustomer,false);
    assert.equal((await database.prepare("SELECT COUNT(*) total FROM tenant_subscriptions WHERE organization_id=?").bind(org).first<{total:number}>())?.total,0);
    assert.equal((await database.prepare("SELECT COUNT(*) total FROM billing_checkout_attempts WHERE organization_id=?").bind(org).first<{total:number}>())?.total,0);
    assert.equal(stripeCalls,0);
    // A failed optional paid upgrade keeps app-owned Free access and all records.
    await expect(await call("/api/v1/billing/checkout","POST",{plan:"starter",interval:"month",includeBookloq:false}),503);
    access = await expect(await call("/api/v1/entitlements"),200);
    assert.equal(access.accessType,"free");
    await activateTestSubscription(database,org,"growth");
    access = await expect(await call("/api/v1/entitlements"),200);
    assert.equal(access.accessType,"subscription");
    assert.equal(access.current.plan,"growth");
    assert.equal(access.current.features.includes("pos.reporting.core"),true);
    await expect(await call("/api/v1/integrations/square/authorize","POST",privacy),200);
    assert.deepEqual(await selectedProviders(),["lightspeed-r","slack"],"Paid connections retain their existing access without consuming a Free choice");
    await expect(await call("/api/v1/daily-metrics","POST",{importType:"manual_entry",rows:[row(101)]},crypto.randomUUID()),201);
    assert.equal((await database.prepare("SELECT COUNT(*) total FROM daily_business_metrics WHERE organization_id=?").bind(org).first<{total:number}>())?.total,101);
    // Unpaid subscriptions must enter billing recovery, rather than bypassing it through Free.
    for (const status of ["past_due","unpaid","paused","incomplete"]) {
      await database.prepare("UPDATE tenant_subscriptions SET status=? WHERE organization_id=?").bind(status,org).run();
      const recovery = await expect(await call("/api/v1/integrations/square/authorize","POST",privacy),402);
      assert.equal(recovery.error.code,"SUBSCRIPTION_REQUIRED",status);
      assert.deepEqual(await selectedProviders(),["lightspeed-r","slack"]);
    }
    // Ending paid access restores the separately enrolled Free plan, without resetting its usage.
    await database.prepare("UPDATE tenant_subscriptions SET status='canceled' WHERE organization_id=?").bind(org).run();
    access = await expect(await call("/api/v1/entitlements"),200);
    assert.equal(access.accessType,"free");
    const restoredCap = await expect(await call("/api/v1/integrations/square/authorize","POST",privacy),402);
    assert.equal(restoredCap.error.code,"FREE_INTEGRATION_LIMIT");
    const resumed = await expect(await call("/api/v1/billing"),200);
    assert.equal(resumed.freeUsage.importRows.used,100);
    const pricing = await worker.fetch(new Request(`${origin}/pricing`),environment,executionContext);
    assert.equal(pricing.status,200);
    const html = await pricing.text();
    assert.match(html,/Start Free/);
    assert.match(html,/No card required/);
    assert.match(html,/plan=free/);
  } finally { globalThis.fetch = originalFetch; await dispose(); }
});
