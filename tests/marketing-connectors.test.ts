import assert from "node:assert/strict";
import test from "node:test";
import {
  GOOGLE_MARKETING_SCOPES,
  META_MARKETING_SCOPES,
  buildMarketingAuthorizationUrl,
  marketingReadiness,
} from "../server/integrations/marketing.ts";

const runtime = globalThis as typeof globalThis & { __vanteloqEnv?: Record<string, string> };

test("Google and Meta readiness identifies hosted configuration requirements", () => {
  runtime.__vanteloqEnv = {};
  assert.deepEqual(marketingReadiness("google").missingConfiguration, [
    "GOOGLE_MARKETING_CLIENT_ID",
    "GOOGLE_MARKETING_CLIENT_SECRET",
    "GOOGLE_MARKETING_REDIRECT_URI",
    "INTEGRATION_ENCRYPTION_KEY",
  ]);
  assert.deepEqual(marketingReadiness("meta").missingConfiguration, [
    "META_MARKETING_APP_ID",
    "META_MARKETING_APP_SECRET",
    "META_MARKETING_REDIRECT_URI",
    "INTEGRATION_ENCRYPTION_KEY",
  ]);
});

test("marketing authorization uses state-bound provider URLs and least-purpose scopes", () => {
  runtime.__vanteloqEnv = {
    GOOGLE_MARKETING_CLIENT_ID: "google-client",
    GOOGLE_MARKETING_CLIENT_SECRET: "google-secret",
    GOOGLE_MARKETING_REDIRECT_URI: "https://vanteloq.com/api/v1/integrations/google/callback",
    META_MARKETING_APP_ID: "meta-app",
    META_MARKETING_APP_SECRET: "meta-secret",
    META_MARKETING_REDIRECT_URI: "https://vanteloq.com/api/v1/integrations/meta/callback",
    META_GRAPH_API_VERSION: "v25.0",
    INTEGRATION_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  };
  const state = "A".repeat(43);
  const google = new URL(buildMarketingAuthorizationUrl("google", state));
  const meta = new URL(buildMarketingAuthorizationUrl("meta", state));
  assert.equal(google.searchParams.get("state"), state);
  assert.equal(google.searchParams.get("access_type"), "offline");
  for (const scope of GOOGLE_MARKETING_SCOPES) assert.ok(google.searchParams.get("scope")?.includes(scope));
  assert.equal(meta.pathname, "/v25.0/dialog/oauth");
  assert.equal(meta.searchParams.get("state"), state);
  for (const scope of META_MARKETING_SCOPES) assert.ok(meta.searchParams.get("scope")?.includes(scope));
});
