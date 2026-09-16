import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test, { describe } from "node:test";
import { metaAppSecretProof, metaTokenExpiry, prepareMetaGraphRequest } from "../server/integrations/meta-security.ts";
import { discoverMetaMarketingResources, exchangeMarketingAuthorizationCode, META_MARKETING_SCOPES } from "../server/integrations/marketing.ts";
import { fetchMarketingReport } from "../server/integrations/marketing-reporting.ts";

// Fictional fixture credentials only. Prepared for review, not executed.
const runtime = globalThis as typeof globalThis & { __vanteloqEnv?: Record<string, string> };
const fixture = {
  META_MARKETING_APP_ID: "fixture-app",
  META_MARKETING_APP_SECRET: "fixture-secret",
  META_MARKETING_REDIRECT_URI: "https://vanteloq.com/api/v1/integrations/meta/callback",
  META_GRAPH_API_VERSION: "v25.0",
  INTEGRATION_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
};

describe("Meta request and expiry boundaries", { concurrency: false }, () => {
  test("expiry uses the provider's lifetime without extending short or missing values", () => {
    const started = Date.parse("2026-09-16T12:00:00Z");
    assert.equal(metaTokenExpiry(120, started).getTime(), started + 120_000);
    assert.equal(metaTokenExpiry(3_600, started).getTime(), started + 3_600_000);
    for (const invalid of [undefined, null, 0, -1, 1.5, "3600", NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
      assert.throws(() => metaTokenExpiry(invalid, started), (error: unknown) => (error as { code?: string }).code === "META_TOKEN_EXPIRY_INVALID");
    }
  });

  test("Meta proof matches an independent HMAC and cannot be sent to a foreign host", async () => {
    const previous = runtime.__vanteloqEnv; runtime.__vanteloqEnv = fixture;
    try {
      const expected = createHmac("sha256", fixture.META_MARKETING_APP_SECRET).update("fixture-token").digest("hex");
      assert.equal(await metaAppSecretProof("fixture-token"), expected);
      const prepared = await prepareMetaGraphRequest("https://graph.facebook.com/v25.0/me?access_token=fixture-token&fields=id,name");
      const url = new URL(prepared.url);
      assert.equal(url.searchParams.has("access_token"), false);
      assert.equal(url.searchParams.get("appsecret_proof"), expected);
      assert.equal(new Headers(prepared.init.headers).get("Authorization"), "Bearer fixture-token");
      assert.equal(prepared.init.redirect, "manual");
      assert.equal(prepared.init.cache, "no-store");
      await assert.rejects(() => prepareMetaGraphRequest("https://unrelated.example/v25.0/me?access_token=fixture-token"));
      await assert.rejects(() => prepareMetaGraphRequest("https://graph.facebook.com/v25.0/me?access_token=second-token", { headers: { Authorization: "Bearer fixture-token" } }));
    } finally { runtime.__vanteloqEnv = previous; }
  });

  test("OAuth validates expiry before requesting account permissions", async () => {
    const previous = runtime.__vanteloqEnv, originalFetch = globalThis.fetch;
    runtime.__vanteloqEnv = fixture;
    let calls = 0;
    globalThis.fetch = async (_input, init) => {
      calls += 1;
      assert.equal(init?.redirect, "manual");
      return Response.json({ access_token: "fixture-token" });
    };
    try {
      await assert.rejects(() => exchangeMarketingAuthorizationCode("meta", "fixture-code"), (error: unknown) => (error as { code?: string }).code === "META_TOKEN_EXPIRY_INVALID");
      assert.equal(calls, 1);
    } finally { globalThis.fetch = originalFetch; runtime.__vanteloqEnv = previous; }
  });

  test("OAuth preserves a short expiry and sends proof for the permission check", async () => {
    const previous = runtime.__vanteloqEnv, originalFetch = globalThis.fetch;
    runtime.__vanteloqEnv = fixture;
    const expected = createHmac("sha256", fixture.META_MARKETING_APP_SECRET).update("fixture-token").digest("hex");
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/oauth/access_token")) return Response.json({ access_token: "fixture-token", expires_in: 120 });
      assert.equal(url.pathname, "/v25.0/me/permissions");
      assert.equal(url.searchParams.get("appsecret_proof"), expected);
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer fixture-token");
      return Response.json({ data: META_MARKETING_SCOPES.map((permission) => ({ permission, status: "granted" })) });
    };
    const before = Date.now();
    try {
      const token = await exchangeMarketingAuthorizationCode("meta", "fixture-code");
      assert.ok(token.expiresAt.getTime() >= before + 120_000);
      assert.ok(token.expiresAt.getTime() <= Date.now() + 120_000);
      assert.equal(token.refreshToken, "");
    } finally { globalThis.fetch = originalFetch; runtime.__vanteloqEnv = previous; }
  });

  test("Meta discovery rejects a redirect without following it", async () => {
    const previous = runtime.__vanteloqEnv, originalFetch = globalThis.fetch;
    runtime.__vanteloqEnv = fixture;
    let calls = 0;
    globalThis.fetch = async (input, init) => {
      calls += 1;
      assert.equal(new URL(String(input)).origin, "https://graph.facebook.com");
      assert.equal(init?.redirect, "manual");
      return new Response(null, { status: 307, headers: { Location: "https://unrelated.example/token-capture" } });
    };
    try {
      await assert.rejects(() => discoverMetaMarketingResources("fixture-token"), (error: unknown) => (error as { code?: string }).code === "META_AD_ACCOUNTS_FAILED");
      assert.equal(calls, 1);
    } finally { globalThis.fetch = originalFetch; runtime.__vanteloqEnv = previous; }
  });

  test("Google authorization does not require Meta configuration or receive Meta proof", async () => {
    const previous = runtime.__vanteloqEnv, originalFetch = globalThis.fetch;
    runtime.__vanteloqEnv = {
      GOOGLE_MARKETING_CLIENT_ID: "fixture-google-app",
      GOOGLE_MARKETING_CLIENT_SECRET: "fixture-google-secret",
      GOOGLE_MARKETING_REDIRECT_URI: "https://vanteloq.com/api/v1/integrations/google/callback",
      INTEGRATION_ENCRYPTION_KEY: fixture.INTEGRATION_ENCRYPTION_KEY,
    };
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), "https://oauth2.googleapis.com/token");
      assert.equal(init?.redirect, undefined);
      assert.equal(new URLSearchParams(String(init?.body)).has("appsecret_proof"), false);
      return Response.json({ access_token: "fixture-google-token", refresh_token: "fixture-refresh", expires_in: 3600, scope: "openid email https://www.googleapis.com/auth/analytics.readonly" });
    };
    try {
      const token = await exchangeMarketingAuthorizationCode("google", "fixture-code");
      assert.equal(token.accessToken, "fixture-google-token");
      assert.equal(token.refreshToken, "fixture-refresh");
    } finally { globalThis.fetch = originalFetch; runtime.__vanteloqEnv = previous; }
  });

  test("detailed Meta report requests carry proof without exposing the access token in URLs", async () => {
    const previous = runtime.__vanteloqEnv, originalFetch = globalThis.fetch;
    runtime.__vanteloqEnv = fixture;
    const expected = createHmac("sha256", fixture.META_MARKETING_APP_SECRET).update("fixture-token").digest("hex");
    let calls = 0;
    globalThis.fetch = async (input, init) => {
      calls += 1;
      const url = new URL(String(input));
      assert.equal(url.searchParams.get("appsecret_proof"), expected);
      assert.equal(url.searchParams.has("access_token"), false);
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer fixture-token");
      assert.equal(init?.redirect, "manual");
      return url.pathname.endsWith("/insights") ? Response.json({ data: [] }) : Response.json({ currency: "CAD", timezone_name: "America/Edmonton" });
    };
    try {
      await fetchMarketingReport("fixture-token", { id: "fixture-selection", provider: "meta", dataset: "meta_ads", externalResourceRef: "act_123", scopeKind: "organization", localLocationId: null }, "daily", 28, new Date("2026-09-16T12:00:00Z"));
      assert.equal(calls, 4);
    } finally { globalThis.fetch = originalFetch; runtime.__vanteloqEnv = previous; }
  });
});
