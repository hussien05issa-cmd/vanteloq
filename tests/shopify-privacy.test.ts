import assert from "node:assert/strict";
import test from "node:test";
import { parseShopifyPrivacyScope, privacyShop } from "../server/integrations/shopify-privacy.ts";

test("Shopify privacy scope is bounded, rejects unsafe numeric identifiers and excludes unneeded contact fields", () => {
  const scope = parseShopifyPrivacyScope({ data_request: { id: 11 }, customer: { id: "44", email: "private@example.invalid", phone: "must not persist", first_name: "Excluded" }, orders_requested: [55, "55", "66"] }, "owner.myshopify.com");
  assert.deepEqual(scope, { version: 1, shop: "owner.myshopify.com", requestId: "11", customerId: "44", email: "private@example.invalid", orderIds: ["55", "66"] });
  assert.throws(() => parseShopifyPrivacyScope({ data_request: { id: Number.MAX_SAFE_INTEGER + 2 }, customer: { id: 44 }, orders_requested: [] }, scope.shop));
  assert.throws(() => parseShopifyPrivacyScope({ data_request: { id: 11 }, customer: { id: 44 }, orders_requested: ["55 OR 1=1"] }, scope.shop));
  assert.throws(() => parseShopifyPrivacyScope({ data_request: { id: 11 }, customer: {}, orders_requested: [] }, scope.shop));
  assert.throws(() => parseShopifyPrivacyScope({ data_request: { id: 11 }, customer: { id: 44 }, orders_requested: Array(10_001).fill(55) }, scope.shop));
  assert.equal(parseShopifyPrivacyScope({ data_request: { id: 12 }, customer: { email: "private@example.invalid" }, orders_requested: [] }, scope.shop).customerId, null);
});

test("signed privacy and uninstall payloads must match the store header", () => {
  assert.doesNotThrow(() => privacyShop({ shop_domain: "owner.myshopify.com" }, "customers/data_request", "owner.myshopify.com"));
  assert.doesNotThrow(() => privacyShop({ myshopify_domain: "owner.myshopify.com" }, "app/uninstalled", "owner.myshopify.com"));
  for (const payload of [{}, { shop_domain: "foreign.myshopify.com" }]) assert.throws(() => privacyShop(payload, "shop/redact", "owner.myshopify.com"));
  const dataRequest = { shop_domain: "owner.myshopify.com", customer: { id: 44 }, data_request: { id: 11 }, orders_requested: [55] };
  for (const topic of ["shop/redact", "customers/redact"]) assert.throws(() => privacyShop(dataRequest, topic, "owner.myshopify.com"));
});
