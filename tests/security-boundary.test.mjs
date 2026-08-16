import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("security-test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

const environment = {
  ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
};
const context = { waitUntil() {}, passThroughOnException() {} };

test("protected onboarding context does not disclose a workspace anonymously", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request("https://vanteloq.example/api/v1/onboarding", {
    headers: { accept: "application/json" },
  }), environment, context);
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.authenticated, false);
  assert.equal(body.organization, null);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  assert.match(response.headers.get("strict-transport-security") ?? "", /max-age=31536000/);
});

test("task APIs reject missing identity before database access", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request("https://vanteloq.example/api/v1/tasks", {
    headers: { accept: "application/json" },
  }), environment, context);
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error.code, "AUTHENTICATION_REQUIRED");
  assert.equal(typeof body.requestId, "string");
  assert.doesNotMatch(JSON.stringify(body), /stack|sql|owner@vanteloq\.local|default-workspace/i);
});

test("caller-supplied legacy Sites headers never authenticate a protected route", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request("https://vanteloq.example/api/v1/onboarding", {
    headers: {
      accept: "application/json",
      "oai-authenticated-user-email": "owner@example.com",
      "oai-authenticated-user-full-name": "Forged Owner",
    },
  }), { ...environment, SUPABASE_AUTH_MODE: "legacy" }, context);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).authenticated, false);
});

test("high-risk tenant and privilege boundaries remain enforced in source", async () => {
  const [api, governance, permissions, schema, documents, purchasing, bookloq, commerce, inventoryLifecycle] = await Promise.all([
    readFile(`${process.cwd()}/server/api.ts`, "utf8"),
    readFile(`${process.cwd()}/app/api/v1/governance/route.ts`, "utf8"),
    readFile(`${process.cwd()}/server/permissions.ts`, "utf8"),
    readFile(`${process.cwd()}/db/schema.ts`, "utf8"),
    readFile(`${process.cwd()}/app/api/v1/documents/route.ts`, "utf8"),
    readFile(`${process.cwd()}/app/api/v1/purchasing/route.ts`, "utf8"),
    readFile(`${process.cwd()}/app/api/v1/bookloq/route.ts`, "utf8"),
    readFile(`${process.cwd()}/app/api/v1/commerce/route.ts`, "utf8"),
    readFile(`${process.cwd()}/app/api/v1/inventory-lifecycle/route.ts`, "utf8"),
  ]);

  assert.doesNotMatch(api, /sitesIdentity\(/);
  assert.doesNotMatch(api, /identity\.provider === "supabase" &&/);
  assert.match(api, /identity\.provider !== "supabase" \|\| identity\.assuranceLevel !== "aal2"/);

  assert.match(governance, /const permission = governanceActionPermissions\[action as keyof typeof governanceActionPermissions\]/);
  assert.match(governance, /await requirePermission\(context, permission\)/);
  assert.match(governance, /validateEmployeeRelationships\(/);
  assert.match(governance, /validateRoleDelegation\(/);
  assert.doesNotMatch(governance, /ON CONFLICT\(id\) DO UPDATE/);
  assert.match(governance, /context\.role !== "owner" && requested\.includes\("organization\.ownership"\)/);
  assert.match(governance, /role\.systemKey === "account_owner"/);
  assert.match(governance, /if \(member\.userId\) statements\.push\(database\.prepare\("UPDATE memberships SET role = COALESCE\(\?, role\), status = \?, updated_at = \?/);
  assert.match(permissions, /eq\(teamMembers\.status, "active"\)/);

  assert.match(schema, /integration_connections_provider_external_account_unique/);
  assert.match(documents, /document\.scanStatus !== "clean"/);
  assert.match(purchasing, /document\.scanStatus !== "clean" \|\| !document\.scannedAt \|\| !document\.scanProvider/);
  assert.match(purchasing, /created_by_user_id != \?/);
  assert.match(purchasing, /Number\(result\.meta\.changes \?\? 0\) !== 1/);
  assert.match(commerce, /canReadProductCosts/);
  assert.match(commerce, /grossProfitCents: canViewVerifiedProfit \? row\.grossProfitCents : null/);
  assert.match(commerce, /displayName: null/);
  assert.match(commerce, /canReadSuppliers \? suppliers\.results \?\? \[\] : \[\]/);
  assert.match(inventoryLifecycle, /canViewValue/);
  assert.match(inventoryLifecycle, /unitCostCents: canViewValue \? lot\.unitCostCents : null/);
  assert.match(inventoryLifecycle, /costAtRiskCents: canViewValue/);

  for (const tenantJoin of [
    /a\.id = b\.financial_account_id AND a\.organization_id = b\.organization_id/,
    /a\.id = r\.account_id AND a\.organization_id = r\.organization_id/,
    /c\.id = b\.supplier_id AND c\.organization_id = b\.organization_id/,
    /c\.id = i\.customer_id AND c\.organization_id = i\.organization_id/,
    /a\.id = b\.account_id AND a\.organization_id = b\.organization_id/,
  ]) assert.match(bookloq, tenantJoin);
});

test("business intelligence APIs reject anonymous access before database reads", async () => {
  const worker = await loadWorker();
  for (const path of ["/api/v1/command-centre", "/api/v1/daily-metrics", "/api/v1/events", "/api/v1/operations", "/api/v1/inventory-lifecycle", "/api/v1/bookloq", "/api/v1/governance", "/api/v1/reports", "/api/v1/purchasing", "/api/v1/documents", "/api/v1/data-quality", "/api/v1/integrations", "/api/v1/commerce", "/api/v1/commerce-intelligence", "/api/v1/backend", "/api/v1/billing"]) {
    const response = await worker.fetch(new Request(`https://vanteloq.example${path}`, {
      headers: { accept: "application/json" },
    }), environment, context);
    assert.equal(response.status, 401, path);
    const body = await response.json();
    assert.equal(body.error.code, "AUTHENTICATION_REQUIRED", path);
  }
});

test("provider management routes reject anonymous same-origin writes", async () => {
  const worker = await loadWorker();
  for (const path of [
    "/api/v1/integrations/lightspeed/authorize",
    "/api/v1/integrations/lightspeed/outlets",
    "/api/v1/integrations/lightspeed/sync",
    "/api/v1/integrations/lightspeed/disconnect",
    "/api/v1/integrations/lightspeed-r/authorize",
    "/api/v1/integrations/lightspeed-r/shops",
    "/api/v1/integrations/lightspeed-r/sync",
    "/api/v1/integrations/lightspeed-r/disconnect",
    "/api/v1/integrations/clover/authorize",
    "/api/v1/integrations/clover/locations",
    "/api/v1/integrations/clover/sync",
    "/api/v1/integrations/clover/disconnect",
    "/api/v1/integrations/square/authorize",
    "/api/v1/integrations/square/locations",
    "/api/v1/integrations/square/sync",
    "/api/v1/integrations/square/disconnect",
    "/api/v1/integrations/shopify-pos/authorize",
    "/api/v1/integrations/shopify-pos/locations",
    "/api/v1/integrations/shopify-pos/sync",
    "/api/v1/integrations/shopify-pos/disconnect",
    "/api/v1/integrations/shopify/authorize",
    "/api/v1/integrations/shopify/locations",
    "/api/v1/integrations/shopify/sync",
    "/api/v1/integrations/shopify/disconnect",
    "/api/v1/integrations/stripe/authorize",
    "/api/v1/integrations/stripe/sync",
    "/api/v1/integrations/stripe/disconnect",
    "/api/v1/integrations/moneris/connect",
    "/api/v1/integrations/moneris/sync",
    "/api/v1/integrations/moneris/disconnect",
    "/api/v1/integrations/plaid/link-token",
    "/api/v1/integrations/plaid/exchange",
    "/api/v1/integrations/plaid/sync",
    "/api/v1/integrations/plaid/disconnect",
    "/api/v1/integrations/plaid/delete-data",
    "/api/v1/integrations/google/authorize",
    "/api/v1/integrations/google/resources",
    "/api/v1/integrations/google/sync",
    "/api/v1/integrations/google/disconnect",
    "/api/v1/integrations/meta/authorize",
    "/api/v1/integrations/meta/resources",
    "/api/v1/integrations/meta/sync",
    "/api/v1/integrations/meta/disconnect",
    "/api/v1/billing/checkout",
    "/api/v1/billing/portal",
  ]) {
    const response = await worker.fetch(new Request(`https://vanteloq.example${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://vanteloq.example",
        "sec-fetch-site": "same-origin",
      },
      body: "{}",
    }), environment, context);
    assert.equal(response.status, 401, path);
    assert.equal((await response.json()).error.code, "AUTHENTICATION_REQUIRED", path);
  }
});

test("the Lightspeed callback rejects malformed one-time state before database access", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request(
    "https://vanteloq.example/api/v1/integrations/lightspeed/callback?code=test-code&state=state-with-entropy&domain_prefix=north-store",
    { headers: { accept: "application/json" } },
  ), environment, context);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "LIGHTSPEED_CALLBACK_INVALID");
});

test("the R-Series callback rejects malformed one-time state before database access", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request(
    "https://vanteloq.example/api/v1/integrations/lightspeed-r/callback?code=test-code&state=state-with-entropy",
    { headers: { accept: "application/json" } },
  ), environment, context);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "LIGHTSPEED_R_CALLBACK_INVALID");
});

test("the Clover callback rejects malformed one-time state before database access", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request(
    "https://vanteloq.example/api/v1/integrations/clover/callback?code=test-code&merchant_id=merchant-test&state=too-short",
    { headers: { accept: "application/json" } },
  ), environment, context);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "CLOVER_CALLBACK_INVALID");
});

test("the Square callback rejects malformed one-time state before database access", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request(
    "https://vanteloq.example/api/v1/integrations/square/callback?code=test-code&state=too-short",
    { headers: { accept: "application/json" } },
  ), environment, context);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "SQUARE_CALLBACK_INVALID");
});

test("the Shopify POS callback rejects malformed one-time state before database access", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request(
    "https://vanteloq.example/api/v1/integrations/shopify-pos/callback?code=test-code&shop=test-store.myshopify.com&state=too-short",
    { headers: { accept: "application/json" } },
  ), environment, context);
  assert.equal(response.status, 400);
  assert.match((await response.json()).error.code, /^SHOPIFY_/u);
});

test("the Clover callback binds the provider redirect to a one-time initiating owner", async () => {
  const source = await readFile(`${process.cwd()}/app/api/v1/integrations/clover/callback/route.ts`, "utf8");
  assert.doesNotMatch(source, /requireAccess\(request/);
  assert.match(source, /eq\(users\.id, stored\.actorUserId\)/);
  assert.match(source, /eq\(memberships\.organizationId, stored\.organizationId\)/);
  assert.match(source, /isNull\(integrationOAuthStates\.consumedAt\)/);
  assert.match(source, /returning\(\{ stateHash: integrationOAuthStates\.stateHash \}\)/);
});

test("the Square callback binds the provider redirect to a one-time initiating owner", async () => {
  const source = await readFile(`${process.cwd()}/app/api/v1/integrations/square/callback/route.ts`, "utf8");
  assert.doesNotMatch(source, /requireAccess\(request/);
  assert.match(source, /eq\(users\.id, stored\.actorUserId\)/);
  assert.match(source, /eq\(memberships\.organizationId, stored\.organizationId\)/);
  assert.match(source, /isNull\(integrationOAuthStates\.consumedAt\)/);
  assert.match(source, /returning\(\{ stateHash: integrationOAuthStates\.stateHash \}\)/);
});

test("the Shopify POS callback binds the provider redirect to a one-time initiating owner", async () => {
  const source = await readFile(`${process.cwd()}/app/api/v1/integrations/shopify-pos/callback/route.ts`, "utf8");
  assert.doesNotMatch(source, /requireAccess\(request/);
  assert.match(source, /eq\(users\.id, stored\.actorUserId\)/);
  assert.match(source, /eq\(memberships\.organizationId, stored\.organizationId\)/);
  assert.match(source, /isNull\(integrationOAuthStates\.consumedAt\)/);
  assert.match(source, /returning\(\{ stateHash: integrationOAuthStates\.stateHash \}\)/);
});

test("the R-Series callback binds the provider redirect to a one-time initiating owner", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(
    `${process.cwd()}/app/api/v1/integrations/lightspeed-r/callback/route.ts`,
    "utf8",
  ));
  assert.doesNotMatch(source, /requireAccess\(request/);
  assert.match(source, /eq\(users\.id, stored\.actorUserId\)/);
  assert.match(source, /eq\(memberships\.organizationId, stored\.organizationId\)/);
  assert.match(source, /isNull\(integrationOAuthStates\.consumedAt\)/);
  assert.match(source, /returning\(\{ stateHash: integrationOAuthStates\.stateHash \}\)/);
});

test("the Stripe callback rejects malformed one-time state before database access", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request(
    "https://vanteloq.example/api/v1/integrations/stripe/callback?code=test-code&state=too-short",
    { headers: { accept: "application/json" } },
  ), environment, context);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "STRIPE_CALLBACK_INVALID");
});

test("marketing callbacks reject malformed one-time state before database access", async () => {
  const worker = await loadWorker();
  for (const provider of ["google", "meta"]) {
    const response = await worker.fetch(new Request(
      `https://vanteloq.example/api/v1/integrations/${provider}/callback?code=test-code&state=too-short`,
      { headers: { accept: "application/json" } },
    ), environment, context);
    assert.equal(response.status, 400, provider);
    assert.equal((await response.json()).error.code, "MARKETING_CALLBACK_INVALID", provider);
  }
});

test("marketing connector routes keep one-time state, tenant ownership, and sync fences", async () => {
  const source = await readFile(`${process.cwd()}/server/integrations/marketing-routes.ts`, "utf8");
  assert.match(source, /requireMarketingPermissions\(context\)/);
  assert.match(source, /isNull\(integrationOAuthStates\.consumedAt\)/);
  assert.match(source, /returning\(\{ stateHash: integrationOAuthStates\.stateHash \}\)/);
  assert.match(source, /requireOwnedIntegrationConnection\(context\.organizationId, provider/);
  assert.match(source, /acquireIntegrationSyncLease/);
  assert.match(source, /integrationConnections\.syncLeaseOwner/);
  assert.match(source, /integrationConnections\.syncVersion/);
  assert.match(source, /preserveGrant = Boolean\(currentConnection\)/);
});

test("the Stripe webhook rejects unsigned requests before database access", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request(
    "https://vanteloq.example/api/v1/integrations/stripe/webhook",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"id":"evt_unsigned","type":"payout.paid","account":"acct_12345678"}',
    },
  ), environment, context);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "STRIPE_WEBHOOK_SIGNATURE_INVALID");
});

test("the Stripe Billing webhook rejects unsigned requests before database access", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request(
    "https://vanteloq.example/api/v1/billing/stripe/webhook",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"id":"evt_unsigned","type":"customer.subscription.updated","created":1786265000}',
    },
  ), environment, context);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "STRIPE_BILLING_SIGNATURE_INVALID");
});

test("the Plaid webhook rejects unsigned requests before database access", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request(
    "https://vanteloq.example/api/v1/integrations/plaid/webhook",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"item_id":"item_unsigned","webhook_type":"TRANSACTIONS","webhook_code":"SYNC_UPDATES_AVAILABLE"}',
    },
  ), environment, context);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "PLAID_WEBHOOK_SIGNATURE_REQUIRED");
});

test("Plaid lifecycle routes keep delegated finance access and repair failures fail closed", async () => {
  for (const action of ["link-token", "exchange", "sync", "disconnect"]) {
    const source = await readFile(
      `${process.cwd()}/app/api/v1/integrations/plaid/${action}/route.ts`,
      "utf8",
    );
    assert.match(source, /requireAccess\(request, \["owner", "admin", "manager"\]\)/, action);
    assert.match(source, /requirePermission\(context, "finance\.connections"\)/, action);
  }
  const exchange = await readFile(
    `${process.cwd()}/app/api/v1/integrations/plaid/exchange/route.ts`,
    "utf8",
  );
  assert.match(exchange, /dataPromotionStatus: plaidRequiresUserRepair\(errorCode\) \? "blocked" : "staging"/);
});

test("provider approval uses the permission for the selected connection type", async () => {
  const source = await readFile(
    `${process.cwd()}/app/api/v1/integrations/route.ts`,
    "utf8",
  );
  const post = source.slice(source.indexOf("export async function POST"));
  assert.match(post, /requireAccess\(request, \["owner", "admin", "manager"\]\)/);
  assert.match(post, /connection\.provider === "plaid"[\s\S]*requirePermission\(context, "finance\.connections"\)/);
  assert.match(post, /\}\s*else\s*\{[\s\S]*requirePermission\(context, "integrations\.manage"\)/);
  assert.match(post, /isMarketingProvider[\s\S]*requirePermission\(context, "marketing\.manage"\)/);
  assert.match(post, /requireOrganizationWideLocationAccess\(context\)/);
});

test("the Lightspeed webhook rejects unsigned requests before database access", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request(
    "https://vanteloq.example/api/v1/integrations/lightspeed/webhook",
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "domain_prefix=north-store&payload=%7B%7D",
    },
  ), environment, context);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "LIGHTSPEED_WEBHOOK_SIGNATURE_INVALID");
});

test("the Clover webhook rejects unsigned merchant events before database access", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request(
    "https://vanteloq.example/api/v1/integrations/clover/webhook",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"appId":"test-app","merchants":{"merchant-test":[{"objectId":"O:order-test","type":"CREATE"}]}}',
    },
  ), environment, context);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "CLOVER_WEBHOOK_AUTH_INVALID");
});

test("the Square webhook rejects unsigned seller events before database access", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request(
    "https://vanteloq.example/api/v1/integrations/square/webhook",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"event_id":"evt_unsigned","merchant_id":"merchant-test","type":"order.updated"}',
    },
  ), environment, context);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "SQUARE_WEBHOOK_SIGNATURE_INVALID");
});

test("signed provider webhook replay keys stay connection-scoped after the multi-account migration", async () => {
  const { readFile } = await import("node:fs/promises");
  for (const route of ["lightspeed", "clover", "square", "stripe"]) {
    const source = await readFile(
      `${process.cwd()}/app/api/v1/integrations/${route}/webhook/route.ts`,
      "utf8",
    );
    assert.match(source, /id:\s*integrationConnections\.id/);
    assert.match(source, /connectionId:\s*connection\.id/);
    assert.match(source, /integrationWebhookEvents\.connectionId/);
  }
});

test("every cursor-bearing provider sync uses the connection lease and version fence", async () => {
  const { readFile } = await import("node:fs/promises");
  for (const route of ["lightspeed", "lightspeed-r", "clover", "stripe"]) {
    const source = await readFile(
      `${process.cwd()}/app/api/v1/integrations/${route}/sync/route.ts`,
      "utf8",
    );
    assert.match(source, /acquireIntegrationSyncLease/);
    assert.match(source, /renewIntegrationSyncLease/);
    assert.match(source, /integrationConnections\.syncLeaseOwner/);
    assert.match(source, /integrationConnections\.syncVersion/);
  }
  const plaid = await readFile(`${process.cwd()}/server/integrations/plaid.ts`, "utf8");
  assert.match(plaid, /acquireIntegrationSyncLease/);
  assert.match(plaid, /renewIntegrationSyncLease/);
  assert.match(plaid, /integrationConnections\.syncLeaseOwner/);
  assert.match(plaid, /integrationConnections\.syncVersion/);
  assert.match(plaid, /dataPromotionStatus: "staging"[\s\S]{0,500}syncLeaseOwner/);
  assert.match(plaid, /PLAID_WEBHOOK_SYNC_DEFERRED/);
});

test("R-Series shop mutations share the sync lease and revoke pending publication authorization", async () => {
  const source = await readFile(
    `${process.cwd()}/app/api/v1/integrations/lightspeed-r/shops/route.ts`,
    "utf8",
  );
  assert.match(source, /acquireIntegrationSyncLease/);
  assert.match(source, /releaseIntegrationSyncLease/);
  assert.match(source, /or\(\s*eq\(integrationConnections\.dataPromotionStatus, "approved"\),\s*isNotNull\(integrationConnections\.promotionAuthorizedAt\)/);
  assert.match(source, /integrationConnections\.syncLeaseOwner/);
  assert.match(source, /integrationConnections\.syncVersion/);
});

test("state-changing onboarding rejects a cross-site origin before data access", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request("https://vanteloq.example/api/v1/onboarding", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://attacker.example",
      "sec-fetch-site": "cross-site",
      "oai-authenticated-user-email": "owner@example.com",
    },
    body: "{}",
  }), environment, context);
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error.code, "ORIGIN_MISMATCH");
});

test("signup configuration fails closed and direct server-side account creation is unavailable", async () => {
  const worker = await loadWorker();
  const availability = await worker.fetch(new Request("https://vanteloq.example/api/v1/auth/signup"), environment, context);
  assert.equal(availability.status, 503);
  assert.deepEqual(await availability.json().then(({ configured }) => ({ configured })), { configured: false });

  const response = await worker.fetch(new Request("https://vanteloq.example/api/v1/auth/signup", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://attacker.example",
      "sec-fetch-site": "cross-site",
    },
    body: JSON.stringify({ name: "Owner", email: "owner@example.com", password: "not-a-real-password", turnstileToken: "not-a-real-token" }),
  }), environment, context);
  assert.equal(response.status, 405);
});

test("password sign-in fails closed and rejects cross-site credential attempts", async () => {
  const worker = await loadWorker();
  const sameOrigin = await worker.fetch(new Request("https://vanteloq.example/api/v1/auth/signin", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://vanteloq.example",
      "sec-fetch-site": "same-origin",
    },
    body: JSON.stringify({ email: "owner@example.com", password: "not-a-real-password", turnstileToken: "not-a-real-token" }),
  }), environment, context);
  assert.equal(sameOrigin.status, 503);
  assert.equal((await sameOrigin.json()).error.code, "SIGNIN_UNAVAILABLE");

  const crossSite = await worker.fetch(new Request("https://vanteloq.example/api/v1/auth/signin", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://attacker.example",
      "sec-fetch-site": "cross-site",
    },
    body: JSON.stringify({ email: "owner@example.com", password: "not-a-real-password", turnstileToken: "not-a-real-token" }),
  }), environment, context);
  assert.equal(crossSite.status, 403);
  assert.equal((await crossSite.json()).error.code, "ORIGIN_MISMATCH");
});

test("imports and business-memory writes reject cross-site origins before data access", async () => {
  const worker = await loadWorker();
  for (const path of [
    "/api/v1/daily-metrics",
    "/api/v1/events",
    "/api/v1/operations",
    "/api/v1/inventory-lifecycle",
    "/api/v1/growth",
    "/api/v1/bookloq/demo",
    "/api/v1/bookloq/journals",
    "/api/v1/bookloq/actions",
    "/api/v1/governance",
    "/api/v1/purchasing",
    "/api/v1/documents",
    "/api/v1/organization-logo",
    "/api/v1/integrations/lightspeed/authorize",
    "/api/v1/integrations/lightspeed/outlets",
    "/api/v1/integrations/lightspeed/sync",
    "/api/v1/integrations/lightspeed/disconnect",
    "/api/v1/integrations/lightspeed-r/authorize",
    "/api/v1/integrations/lightspeed-r/shops",
    "/api/v1/integrations/lightspeed-r/sync",
    "/api/v1/integrations/lightspeed-r/disconnect",
    "/api/v1/integrations/clover/authorize",
    "/api/v1/integrations/clover/locations",
    "/api/v1/integrations/clover/sync",
    "/api/v1/integrations/clover/disconnect",
    "/api/v1/integrations/shopify-pos/authorize",
    "/api/v1/integrations/shopify-pos/locations",
    "/api/v1/integrations/shopify-pos/sync",
    "/api/v1/integrations/shopify-pos/disconnect",
    "/api/v1/integrations/shopify/authorize",
    "/api/v1/integrations/shopify/locations",
    "/api/v1/integrations/shopify/sync",
    "/api/v1/integrations/shopify/disconnect",
    "/api/v1/integrations/stripe/authorize",
    "/api/v1/integrations/stripe/sync",
    "/api/v1/integrations/stripe/disconnect",
    "/api/v1/integrations/moneris/connect",
    "/api/v1/integrations/moneris/sync",
    "/api/v1/integrations/moneris/disconnect",
    "/api/v1/integrations/plaid/link-token",
    "/api/v1/integrations/plaid/exchange",
    "/api/v1/integrations/plaid/sync",
    "/api/v1/integrations/plaid/disconnect",
    "/api/v1/integrations/google/authorize",
    "/api/v1/integrations/google/resources",
    "/api/v1/integrations/google/sync",
    "/api/v1/integrations/google/disconnect",
    "/api/v1/integrations/meta/authorize",
    "/api/v1/integrations/meta/resources",
    "/api/v1/integrations/meta/sync",
    "/api/v1/integrations/meta/disconnect",
    "/api/v1/billing/checkout",
    "/api/v1/billing/portal",
  ]) {
    const response = await worker.fetch(new Request(`https://vanteloq.example${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
        "oai-authenticated-user-email": "owner@example.com",
      },
      body: "{}",
    }), environment, context);
    assert.equal(response.status, 403, path);
    const body = await response.json();
    assert.equal(body.error.code, "ORIGIN_MISMATCH", path);
  }
});

test("removed unversioned prototype APIs are unavailable", async () => {
  const worker = await loadWorker();
  for (const path of ["/api/onboarding", "/api/tasks"]) {
    const response = await worker.fetch(new Request(`https://vanteloq.example${path}`), environment, context);
    assert.equal(response.status, 404);
  }
});

test("operational health and API description expose no internal configuration", async () => {
  const worker = await loadWorker();
  const health = await worker.fetch(new Request("https://vanteloq.example/api/health"), environment, context);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok", service: "vanteloq" });

  const openapi = await worker.fetch(new Request("https://vanteloq.example/api/v1/openapi"), environment, context);
  assert.equal(openapi.status, 200);
  const specification = await openapi.json();
  assert.equal(specification.openapi, "3.1.0");
  assert.ok(specification.paths["/tasks"]);
  assert.ok(specification.paths["/command-centre"]);
  assert.ok(specification.paths["/daily-metrics"]);
  assert.ok(specification.paths["/events"]);
  assert.ok(specification.paths["/operations"]);
  assert.ok(specification.paths["/inventory-lifecycle"]);
  assert.ok(specification.paths["/backend"]);
  assert.ok(specification.paths["/bookloq"]);
  assert.equal(specification.paths["/bookloq/demo"], undefined);
  assert.ok(specification.paths["/bookloq/journals"]);
  assert.ok(specification.paths["/bookloq/actions"]);
  assert.doesNotMatch(JSON.stringify(specification), /secret|token|database_id/i);
});
