import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createServer } from "node:http";
import {
  buildQuickBooksAuthorizationUrl,
  exchangeQuickBooksAuthorizationCode,
  quickBooksReadiness,
  newQuickBooksGrantNamespace,
  revokeQuickBooksAuthorization,
  verifyQuickBooksCompany,
} from "../server/integrations/quickbooks.ts";

const encryptionKey = Buffer.alloc(32, 7).toString("base64");
(globalThis as typeof globalThis & { __vanteloqEnv?: Record<string, string> }).__vanteloqEnv = {
  QUICKBOOKS_CLIENT_ID: "quickbooks_test_client_identifier_12345",
  QUICKBOOKS_CLIENT_SECRET: "quickbooks_test_client_secret_value_12345",
  QUICKBOOKS_REDIRECT_URI: "https://vanteloq.example/api/v1/integrations/quickbooks/callback",
  QUICKBOOKS_ENV: "sandbox",
  INTEGRATION_ENCRYPTION_KEY: encryptionKey,
};

test("QuickBooks authorization is state bound, accounting scoped, and excludes the client secret", () => {
  const state = "a".repeat(43);
  const url = new URL(buildQuickBooksAuthorizationUrl(state));
  assert.equal(url.origin, "https://appcenter.intuit.com");
  assert.equal(url.pathname, "/connect/oauth2");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("scope"), "com.intuit.quickbooks.accounting");
  assert.equal(url.searchParams.get("redirect_uri"), "https://vanteloq.example/api/v1/integrations/quickbooks/callback");
  assert.equal(url.searchParams.get("state"), state);
  assert.doesNotMatch(url.toString(), /quickbooks_test_client_secret_value/);
});

test("QuickBooks readiness is sandbox and staging only", () => {
  const readiness = quickBooksReadiness();
  assert.equal(readiness.adapterBuilt, true);
  assert.equal(readiness.credentialsConfigured, true);
  assert.equal(readiness.environment, "sandbox");
  assert.equal(readiness.mode, "sandbox_read_only_staging");
  assert.equal(readiness.companyVerificationEnabled, true);
  assert.equal(readiness.ledgerImportEnabled, false);
  assert.equal(readiness.dataPromotionEnabled, false);
});

test("QuickBooks environment metadata does not occupy the cross tenant domain uniqueness key", () => {
  const routeExpectations = [
    ["app/api/v1/integrations/quickbooks/authorize/route.ts", 1],
    ["app/api/v1/integrations/quickbooks/callback/route.ts", 2],
    ["app/api/v1/integrations/quickbooks/disconnect/route.ts", 0],
  ] as const;

  for (const [relativePath, expectedNullAssignments] of routeExpectations) {
    const source = readFileSync(join(process.cwd(), relativePath), "utf8");
    assert.doesNotMatch(source, /domainPrefix:\s*readiness\.environment/);
    assert.equal(source.match(/domainPrefix:\s*null/g)?.length ?? 0, expectedNullAssignments);
  }
});

test("QuickBooks token exchange validates an explicitly returned accounting scope", async () => {
  const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(init?.method, "POST");
    assert.match(String((init?.headers as Record<string, string>).Authorization), /^Basic /);
    return Response.json({
      access_token: "access-token-value",
      refresh_token: "refresh-token-value",
      expires_in: 3_600,
      x_refresh_token_expires_in: 8_726_400,
      scope: "com.intuit.quickbooks.accounting",
    });
  }) as typeof fetch;
  const token = await exchangeQuickBooksAuthorizationCode("authorization-code", await newQuickBooksGrantNamespace(), fetcher);
  assert.deepEqual(token.scopes, ["com.intuit.quickbooks.accounting"]);

  const wrongScope = (async () => Response.json({
    access_token: "access-token-value",
    refresh_token: "refresh-token-value",
    expires_in: 3_600,
    scope: "openid",
  })) as typeof fetch;
  await assert.rejects(
    async () => exchangeQuickBooksAuthorizationCode("authorization-code", await newQuickBooksGrantNamespace(), wrongScope),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "QUICKBOOKS_TOKEN_RESPONSE_INVALID",
  );
});

test("QuickBooks accepts Intuit's documented token response without scope", async () => {
  const token = await exchangeQuickBooksAuthorizationCode("authorization-code", await newQuickBooksGrantNamespace(), (async () => Response.json({
    access_token: "access-token-value",
    refresh_token: "refresh-token-value",
    expires_in: 3_600,
    token_type: "bearer",
    x_refresh_token_expires_in: 8_726_400,
  })) as typeof fetch);
  assert.deepEqual(token.scopes, ["com.intuit.quickbooks.accounting"]);
  assert.equal(token.accessToken, "access-token-value");
  assert.equal(token.refreshToken, "refresh-token-value");
});

test("QuickBooks does not infer scope when an explicit invalid scope or incomplete token is returned", async () => {
  const valid = { access_token: "access-token-value", refresh_token: "refresh-token-value", expires_in: 3_600 };
  for (const payload of [
    { ...valid, scope: "" }, { ...valid, scope: null }, { ...valid, scope: ["com.intuit.quickbooks.accounting"] },
    { ...valid, scope: "openid" }, { ...valid, access_token: "" }, { ...valid, refresh_token: "" }, { ...valid, expires_in: 0 },
  ]) {
    await assert.rejects(
      async () => exchangeQuickBooksAuthorizationCode("authorization-code", await newQuickBooksGrantNamespace(), (async () => Response.json(payload)) as typeof fetch),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "QUICKBOOKS_TOKEN_RESPONSE_INVALID",
    );
  }
});

test("QuickBooks company verification retains identity only and excludes addresses", async () => {
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.match(String(input), /^https:\/\/sandbox-quickbooks\.api\.intuit\.com\/v3\/company\/123456789\/companyinfo\/123456789$/);
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer access-token-value");
    return Response.json({
      CompanyInfo: {
        Id: "1",
        CompanyName: "Vanteloq Sandbox Company",
        Country: "CA",
        CompanyAddr: { Line1: "Sensitive address", PostalCode: "A1A 1A1" },
      },
    });
  }) as typeof fetch;
  const company = await verifyQuickBooksCompany("123456789", "access-token-value", await newQuickBooksGrantNamespace(), fetcher);
  assert.deepEqual(company, { realmId: "123456789", name: "Vanteloq Sandbox Company", country: "CA" });
  assert.doesNotMatch(JSON.stringify(company), /Sensitive address|A1A 1A1/);
});

test("QuickBooks requires the authorized realm to return a valid company record", async () => {
  for (const status of [401, 403]) {
    await assert.rejects(
      async () => verifyQuickBooksCompany("123456789", "access-token-value", await newQuickBooksGrantNamespace(), (async () => Response.json({}, { status })) as typeof fetch),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "QUICKBOOKS_AUTHORIZATION_EXPIRED",
    );
  }
  for (const CompanyInfo of [{}, { Id: "1" }, { CompanyName: "Incomplete company" }]) {
    await assert.rejects(
      async () => verifyQuickBooksCompany("123456789", "access-token-value", await newQuickBooksGrantNamespace(), (async () => Response.json({ CompanyInfo })) as typeof fetch),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "QUICKBOOKS_COMPANY_RESPONSE_INVALID",
    );
  }
});

test("QuickBooks rejects missing or unsupported environment without silently selecting sandbox", async () => {
  const globals = globalThis as typeof globalThis & { __vanteloqEnv?: Record<string, string> };
  const original = globals.__vanteloqEnv;
  try {
    for (const environment of [undefined, "", "staging", "prod"]) {
      globals.__vanteloqEnv = { ...original!, QUICKBOOKS_ENV: environment as string };
      const readiness = quickBooksReadiness();
      assert.equal(readiness.credentialsConfigured, false); assert.equal(readiness.environment, null);
      assert.equal(readiness.mode, "configuration_required"); assert.ok(readiness.missingConfiguration.includes("QUICKBOOKS_ENV"));
      await assert.rejects(() => newQuickBooksGrantNamespace(), (error: unknown) => error instanceof Error && "code" in error && error.code === "QUICKBOOKS_ENVIRONMENT_INVALID");
    }
  } finally { globals.__vanteloqEnv = original; }
});

test("QuickBooks credentialed requests reject 307 redirects without sending codes or tokens to the next host", async () => {
  let redirectedRequests = 0;
  const receiver = createServer((_request, response) => { redirectedRequests++; response.end("unexpected"); });
  await new Promise<void>(resolve => receiver.listen(0, "127.0.0.1", resolve));
  const target = `http://127.0.0.1:${(receiver.address() as { port: number }).port}/redirect-target`;
  const redirector = createServer((_request, response) => { response.writeHead(307, { Location: target }); response.end(); });
  await new Promise<void>(resolve => redirector.listen(0, "127.0.0.1", resolve));
  try {
    const namespace = await newQuickBooksGrantNamespace();
    const fetcher = (async (_input, init) => {
      assert.equal(init?.redirect, "error");
      // Only fictional credentials and loopback endpoints are used in this transport test.
      return fetch(`http://127.0.0.1:${(redirector.address() as { port: number }).port}/start`, init);
    }) as typeof fetch;
    await assert.rejects(() => exchangeQuickBooksAuthorizationCode("fictional-code", namespace, fetcher));
    await assert.rejects(() => verifyQuickBooksCompany("123456789", "fictional-token", namespace, fetcher));
    await assert.rejects(() => revokeQuickBooksAuthorization("fictional-refresh", namespace, fetcher));
    assert.equal(redirectedRequests, 0);
  } finally {
    await Promise.all([new Promise<void>(resolve => redirector.close(() => resolve())), new Promise<void>(resolve => receiver.close(() => resolve()))]);
  }
});
