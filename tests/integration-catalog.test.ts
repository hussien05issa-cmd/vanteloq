import assert from "node:assert/strict";
import test from "node:test";
import { integrationCatalog, integrationCategoryOrder, preSyncControls, salesChannelGroups } from "../app/integration-catalog.ts";

test("the shared provider gate matches the implemented provider staging boundary", () => {
  const verified = preSyncControls.filter((control) => control.status === "verified");
  const gated = preSyncControls.filter((control) => control.status !== "verified");
  assert.equal(verified.length, 7);
  assert.deepEqual(gated.map((control) => control.id), ["reconciliation"]);
  assert.match(gated[0].detail, /before dashboard results can use the data/i);
});

test("the integration directory uses the approved sales-channel taxonomy", () => {
  assert.deepEqual(salesChannelGroups, [
    { label: "Point of Sale", providers: ["Lightspeed", "Square", "Clover", "Shopify POS", "Moneris"] },
    { label: "E-commerce", providers: ["Shopify"] },
    { label: "Delivery", providers: ["DoorDash", "Uber Eats"] },
    { label: "Payments", providers: ["Stripe", "Square", "Moneris"] },
    { label: "Accounting", providers: ["QuickBooks", "Xero"] },
    { label: "Marketing", providers: ["Google", "Meta"] },
  ]);
  for (const provider of ["shopify", "shopify-pos", "google", "meta"]) {
    assert.ok(integrationCatalog.some((entry) => entry.id === provider));
  }
  assert.ok(integrationCatalog.every((entry) => entry.id !== "amazon" && entry.id !== "woocommerce"));
});

test("only built pilots may claim that credentials are the remaining connection prerequisite", () => {
  const credentialReady = integrationCatalog.filter((provider) => provider.availability === "credentials_required");
  assert.deepEqual(credentialReady.map((provider) => provider.id).sort(), ["clover", "google", "lightspeed", "lightspeed-r", "meta", "moneris", "plaid", "shopify", "shopify-pos", "square", "stripe"]);
  assert.ok(integrationCatalog.filter((provider) => !credentialReady.includes(provider)).every((provider) => provider.availability !== "credentials_required"));
});

test("DoorDash is gated by Marketplace approval and never represented as a Drive reporting connection", () => {
  const doorDash = integrationCatalog.find((provider) => provider.id === "doordash");
  assert.ok(doorDash);
  assert.equal(doorDash.availability, "provider_access_required");
  assert.match(doorDash.activationRequirement, /Marketplace access is approval-only/i);
  assert.match(doorDash.activationRequirement, /Drive API does not provide this merchant reporting feed/i);
  assert.match(doorDash.externalApplicationUrl ?? "", /^https:\/\/docs\.google\.com\/forms\//);
});

test("integration cards use one canonical ordered category taxonomy", () => {
  const categories = integrationCatalog.map((provider) => provider.category);
  assert.ok(categories.every((category) => integrationCategoryOrder.includes(category)));
  assert.equal(new Set(categories.map((category) => category.toLocaleLowerCase())).size, new Set(categories).size);
  assert.deepEqual(integrationCategoryOrder, [
    "Point of sale",
    "Commerce",
    "Payments",
    "Banking",
    "Accounting",
    "Marketplace",
    "Delivery",
    "Marketing",
    "Labour",
    "Manual imports",
  ]);
});
