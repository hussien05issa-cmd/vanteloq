import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildShopifyAuthorizationUrl,
  normalizeShopDomain,
  SHOPIFY_API_VERSION,
  SHOPIFY_PROVIDER,
  shopifyReadiness,
  shopifyPosReadiness,
  verifyShopifyCallback,
  verifyShopifyWebhook,
} from "../server/integrations/shopify-pos.ts";

(globalThis as typeof globalThis & { __vanteloqEnv?: Record<string, string> }).__vanteloqEnv = {
  SHOPIFY_CLIENT_ID: "shopify-test-client",
  SHOPIFY_CLIENT_SECRET: "shopify-test-secret",
  SHOPIFY_REDIRECT_URI: "https://vanteloq.com/api/v1/integrations/shopify-pos/callback",
  SHOPIFY_WEBHOOK_URL: "https://vanteloq.com/api/v1/integrations/shopify-pos/webhook",
  SHOPIFY_COMMERCE_REDIRECT_URI: "https://vanteloq.com/api/v1/integrations/shopify/callback",
  SHOPIFY_COMMERCE_WEBHOOK_URL: "https://vanteloq.com/api/v1/integrations/shopify/webhook",
  INTEGRATION_ENCRYPTION_KEY: Buffer.from(Uint8Array.from({ length: 32 }, (_, index) => index + 1)).toString("base64"),
};

test("Shopify POS readiness exposes the exact read-only adapter boundary", () => {
  const readiness = shopifyPosReadiness();
  assert.equal(readiness.adapterBuilt, true);
  assert.equal(readiness.credentialsConfigured, true);
  assert.equal(readiness.webhookConfigured, true);
  assert.equal(readiness.apiVersion, SHOPIFY_API_VERSION);
  assert.equal(readiness.mode, "read_only_staged_sync");
  assert.equal(readiness.dataPromotionEnabled, false);
  assert.deepEqual(new Set(readiness.permissions), new Set(["read_all_orders", "read_orders", "read_products", "read_inventory", "read_locations", "read_customers"]));
});

test("Shopify e-commerce has a distinct ready OAuth and webhook boundary", () => {
  const readiness = shopifyReadiness();
  assert.equal(readiness.credentialsConfigured, true);
  assert.equal(readiness.webhookConfigured, true);
  const state = "b".repeat(43);
  const url = new URL(buildShopifyAuthorizationUrl("online-store.myshopify.com", state, SHOPIFY_PROVIDER));
  assert.equal(url.searchParams.get("redirect_uri"), "https://vanteloq.com/api/v1/integrations/shopify/callback");
  assert.doesNotMatch(url.toString(), /shopify-pos/);
});

test("Shopify authorization is state-bound and limited to permanent store domains", () => {
  const state = "a".repeat(43);
  const url = new URL(buildShopifyAuthorizationUrl("test-store.myshopify.com", state));
  assert.equal(url.origin, "https://test-store.myshopify.com");
  assert.equal(url.pathname, "/admin/oauth/authorize");
  assert.equal(url.searchParams.get("client_id"), "shopify-test-client");
  assert.equal(url.searchParams.get("redirect_uri"), "https://vanteloq.com/api/v1/integrations/shopify-pos/callback");
  assert.equal(url.searchParams.get("state"), state);
  assert.deepEqual(new Set(url.searchParams.get("scope")?.split(",")), new Set(["read_all_orders", "read_orders", "read_products", "read_inventory", "read_locations", "read_customers"]));
  assert.doesNotMatch(url.toString(), /shopify-test-secret/);
  assert.equal(normalizeShopDomain("https://TEST-STORE.myshopify.com/"), "test-store.myshopify.com");
  assert.throws(() => normalizeShopDomain("shopify.example.com"), /permanent .myshopify.com domain/i);
});

test("Shopify callback validation authenticates the canonical query and rejects tampering", async () => {
  const url = new URL("https://vanteloq.com/api/v1/integrations/shopify-pos/callback?code=install-code&shop=test-store.myshopify.com&state=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&timestamp=1786400000");
  const canonical = [...url.searchParams.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${value}`).join("&");
  url.searchParams.set("hmac", createHmac("sha256", "shopify-test-secret").update(canonical).digest("hex"));
  assert.equal(await verifyShopifyCallback(url), true);
  url.searchParams.set("shop", "changed-store.myshopify.com");
  assert.equal(await verifyShopifyCallback(url), false);
});

test("Shopify webhooks are verified against the exact raw body", async () => {
  const body = new TextEncoder().encode(JSON.stringify({ id: 101, admin_graphql_api_id: "gid://shopify/Order/101" }));
  const signature = createHmac("sha256", "shopify-test-secret").update(body).digest("base64");
  assert.equal(await verifyShopifyWebhook(body, signature), true);
  assert.equal(await verifyShopifyWebhook(new Uint8Array([...body, 32]), signature), false);
  assert.equal(await verifyShopifyWebhook(body, null), false);
});

test("Shopify compliance and uninstall topics terminate at the verified webhook route", () => {
  const route = readFileSync(`${process.cwd()}/app/api/v1/integrations/shopify-pos/webhook/route.ts`, "utf8");
  for (const topic of ["customers/data_request", "customers/redact", "shop/redact", "app/uninstalled"]) assert.match(route, new RegExp(topic.replace("/", "\\/")));
  assert.match(route, /verifyShopifyWebhook/);
  assert.match(route, /privacyDataDeletedAt/);
});

test("Shopify e-commerce routes preserve online-order lineage separately from Shopify POS", () => {
  const sync = readFileSync(`${process.cwd()}/app/api/v1/integrations/shopify-pos/sync/route.ts`, "utf8");
  const wrapper = readFileSync(`${process.cwd()}/app/api/v1/integrations/shopify/sync/route.ts`, "utf8");
  const configuration = readFileSync(`${process.cwd()}/shopify.app.toml`, "utf8");
  assert.match(sync, /isCommerce \? "source_name:web" : "source_name:pos"/);
  assert.match(sync, /SHOPIFY_ONLINE_LOCATION_REF/);
  assert.match(sync, /currentTotalRefundedSet/);
  assert.match(wrapper, /shopify-pos\/sync\/route/);
  assert.match(configuration, /integrations\/shopify\/callback/);
  assert.match(configuration, /integrations\/shopify\/webhook/);
  assert.equal(configuration.match(/compliance_topics/g)?.length, 1, "Shopify permits one subscription per compliance topic");
});
