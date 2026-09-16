import assert from "node:assert/strict";
import test from "node:test";
import {
  integrationCatalog,
  integrationCategoryOrder,
  integrationPublicStatus,
  preSyncControls,
  salesChannelGroups,
} from "../app/integration-catalog.ts";

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
  assert.deepEqual(credentialReady.map((provider) => provider.id).sort(), ["clover", "google", "lightspeed", "lightspeed-r", "meta", "moneris", "plaid", "quickbooks", "shopify", "shopify-pos", "square", "stripe"]);
  assert.ok(integrationCatalog.filter((provider) => !credentialReady.includes(provider)).every((provider) => provider.availability !== "credentials_required"));
});

test("DoorDash and Uber Eats are consistently non-interactive coming soon connectors", () => {
  const doorDash = integrationCatalog.find((provider) => provider.id === "doordash");
  const uberEats = integrationCatalog.find((provider) => provider.id === "uber-eats");
  assert.ok(doorDash);
  assert.ok(uberEats);
  for (const provider of [doorDash, uberEats]) {
    assert.equal(provider.availability, "coming_soon");
    assert.match(provider.activationRequirement, /^Coming soon\./i);
    assert.equal(provider.externalApplicationUrl, undefined);
  }
});

test("QuickBooks exposes only the built sandbox company-verification boundary", () => {
  const quickBooks = integrationCatalog.find((provider) => provider.id === "quickbooks");
  assert.ok(quickBooks);
  assert.equal(quickBooks.availability, "credentials_required");
  assert.match(quickBooks.setupDetails!, /read only/i);
  assert.match(quickBooks.setupDetails!, /sandbox remains staging only/i);
  assert.match(quickBooks.setupDetails!, /ledger import/i);
});

test("public connector labels disclose the real activation boundary", () => {
  assert.equal(integrationPublicStatus(integrationCatalog.find((provider) => provider.id === "quickbooks")!).label, "Coming Soon");
  assert.equal(integrationPublicStatus(integrationCatalog.find((provider) => provider.id === "plaid")!).label, "Coming Soon");
  for (const id of ["shopify", "shopify-pos"]) assert.equal(integrationPublicStatus(integrationCatalog.find((provider) => provider.id === id)!).label, "Coming Soon");
  assert.equal(integrationPublicStatus(integrationCatalog.find((provider) => provider.id === "moneris")!).label, "Coming Soon");
  assert.equal(integrationPublicStatus(integrationCatalog.find((provider) => provider.id === "xero")!).label, "Coming Soon");
  assert.equal(integrationPublicStatus(integrationCatalog.find((provider) => provider.id === "doordash")!).label, "Coming Soon");
  assert.equal(integrationPublicStatus(integrationCatalog.find((provider) => provider.id === "payroll")!).label, "Coming Soon");
  assert.equal(integrationPublicStatus(integrationCatalog.find((provider) => provider.id === "stripe")!).label, "Available");
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
