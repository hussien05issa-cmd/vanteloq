import assert from "node:assert/strict";
import test from "node:test";
import { providerPrivacyAcceptance, validProviderPrivacyAcceptance } from "../domain/provider-privacy.ts";

test("connection acknowledgement survives the client JSON request and rejects absent or stale consent", () => {
  const request = JSON.parse(JSON.stringify({ ...providerPrivacyAcceptance(true), updateItemId: "fictional-bank-item" }));
  assert.equal(validProviderPrivacyAcceptance(request), true);
  assert.equal(validProviderPrivacyAcceptance(providerPrivacyAcceptance(false)), false);
  assert.equal(validProviderPrivacyAcceptance({}), false);
  assert.equal(validProviderPrivacyAcceptance({ ...request, providerPrivacyNoticeVersion: "old-notice" }), false);
  assert.equal(validProviderPrivacyAcceptance({ ...request, providerPrivacyAccepted: "true" }), false);
});
