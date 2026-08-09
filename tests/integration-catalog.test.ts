import assert from "node:assert/strict";
import test from "node:test";
import { integrationCatalog, preSyncControls, salesChannelGroups } from "../app/integration-catalog.ts";

test("the shared provider gate matches the implemented provider staging boundary", () => {
  const verified = preSyncControls.filter((control) => control.status === "verified");
  const gated = preSyncControls.filter((control) => control.status !== "verified");
  assert.equal(verified.length, 7);
  assert.deepEqual(gated.map((control) => control.id), ["reconciliation"]);
  assert.match(gated[0].detail, /before live metric promotion/i);
});

test("the integration directory uses the approved sales-channel taxonomy", () => {
  assert.deepEqual(salesChannelGroups, [
    { label: "Point of Sale", providers: ["Lightspeed", "Square", "Clover", "Shopify POS", "Moneris"] },
    { label: "E-commerce", providers: ["Shopify", "Amazon", "WooCommerce"] },
    { label: "Delivery", providers: ["DoorDash", "Uber Eats"] },
    { label: "Payments", providers: ["Stripe", "Square", "Moneris"] },
    { label: "Accounting", providers: ["QuickBooks", "Xero"] },
    { label: "Marketing", providers: ["Google", "Meta"] },
  ]);
  for (const provider of ["shopify-pos", "google", "meta"]) {
    assert.ok(integrationCatalog.some((entry) => entry.id === provider));
  }
});

test("only built pilots may claim that credentials are the remaining connection prerequisite", () => {
  const credentialReady = integrationCatalog.filter((provider) => provider.availability === "credentials_required");
  assert.deepEqual(credentialReady.map((provider) => provider.id).sort(), ["lightspeed", "lightspeed-r", "stripe"]);
  assert.ok(integrationCatalog.filter((provider) => !credentialReady.includes(provider)).every((provider) => provider.availability !== "credentials_required"));
});
