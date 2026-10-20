import assert from "node:assert/strict";
import test from "node:test";
import { providerPrivacy, providerPrivacyAcceptance, validProviderPrivacyAcceptance, type PrivacyProvider } from "../domain/provider-privacy.ts";
import { connectionPermissionSummary } from "../domain/provider-connection-notice.ts";

test("connection acknowledgement survives the client JSON request and rejects absent or stale consent", () => {
  const request = JSON.parse(JSON.stringify({ ...providerPrivacyAcceptance(true), updateItemId: "fictional-bank-item" }));
  assert.equal(validProviderPrivacyAcceptance(request), true);
  assert.equal(validProviderPrivacyAcceptance(providerPrivacyAcceptance(false)), false);
  assert.equal(validProviderPrivacyAcceptance({}), false);
  assert.equal(validProviderPrivacyAcceptance({ ...request, providerPrivacyNoticeVersion: "old-notice" }), false);
  assert.equal(validProviderPrivacyAcceptance({ ...request, providerPrivacyAccepted: "true" }), false);
});

test("Google notice follows configured grants and distinguishes management from reporting", () => {
  const prefix = "https://www.googleapis.com/auth/";
  const scopes = ["openid", "email", `${prefix}analytics.readonly`, `${prefix}webmasters.readonly`, `${prefix}business.manage`];
  const withoutAds = connectionPermissionSummary("google", scopes);
  assert.equal(withoutAds.some(row => row.title.includes("Ads")), false);
  assert.match(withoutAds.find(row => row.title === "Business Profile")!.description, /management access.*separate confirmation/);
  const withAds = connectionPermissionSummary("google", [...scopes, `${prefix}adwords`]);
  assert.match(withAds.find(row => row.title === "Google Ads")!.description, /edit, create and delete.*does not change Google campaigns/);
  assert.equal(connectionPermissionSummary("google", ["openid", "email"]).length, 1);
});

test("every implemented provider has a permission summary and an HTTPS policy", () => {
  for (const key of Object.keys(providerPrivacy) as PrivacyProvider[]) {
    assert.equal(new URL(providerPrivacy[key].url).protocol, "https:");
    assert.ok(connectionPermissionSummary(key).length > 0, key);
  }
  assert.match(connectionPermissionSummary("quickbooks")[0].description, /changing company records.*does not create or change/);
  assert.match(connectionPermissionSummary("deel")[0].description, /payslips.*excludes/);
});
