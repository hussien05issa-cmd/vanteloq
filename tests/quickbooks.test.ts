import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  buildQuickBooksAuthorizationUrl,
  exchangeQuickBooksAuthorizationCode,
  quickBooksReadiness,
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
    ["app/api/v1/integrations/quickbooks/disconnect/route.ts", 1],
  ] as const;

  for (const [relativePath, expectedNullAssignments] of routeExpectations) {
    const source = readFileSync(join(process.cwd(), relativePath), "utf8");
    assert.doesNotMatch(source, /domainPrefix:\s*readiness\.environment/);
    assert.equal(source.match(/domainPrefix:\s*null/g)?.length ?? 0, expectedNullAssignments);
  }
});

test("QuickBooks token exchange requires the accounting scope", async () => {
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
  const token = await exchangeQuickBooksAuthorizationCode("authorization-code", fetcher);
  assert.deepEqual(token.scopes, ["com.intuit.quickbooks.accounting"]);

  const wrongScope = (async () => Response.json({
    access_token: "access-token-value",
    refresh_token: "refresh-token-value",
    expires_in: 3_600,
    scope: "openid",
  })) as typeof fetch;
  await assert.rejects(
    () => exchangeQuickBooksAuthorizationCode("authorization-code", wrongScope),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "QUICKBOOKS_TOKEN_RESPONSE_INVALID",
  );
});

test("QuickBooks company verification retains identity only and excludes addresses", async () => {
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.match(String(input), /^https:\/\/sandbox-quickbooks\.api\.intuit\.com\/v3\/company\/123456789\/companyinfo\/123456789$/);
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer access-token-value");
    return Response.json({
      CompanyInfo: {
        Id: "123456789",
        CompanyName: "Vanteloq Sandbox Company",
        Country: "CA",
        CompanyAddr: { Line1: "Sensitive address", PostalCode: "A1A 1A1" },
      },
    });
  }) as typeof fetch;
  const company = await verifyQuickBooksCompany("123456789", "access-token-value", fetcher);
  assert.deepEqual(company, { realmId: "123456789", name: "Vanteloq Sandbox Company", country: "CA" });
  assert.doesNotMatch(JSON.stringify(company), /Sensitive address|A1A 1A1/);
});
