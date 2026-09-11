import assert from "node:assert/strict";
import test from "node:test";

let navigation = null;

try {
  navigation = await import("../app/analytics-consent-navigation.ts");
} catch (error) {
  const missingModule = error?.code === "ERR_MODULE_NOT_FOUND"
    && String(error?.message).includes("analytics-consent-navigation");
  if (!missingModule) throw error;
}

test("opening the Cookie Notice closes the consent panel and uses the notice route", () => {
  assert.equal(typeof navigation?.createCookieNoticeNavigation, "function");

  let panelOpen = true;
  const link = navigation.createCookieNoticeNavigation(() => {
    panelOpen = false;
  });

  assert.equal(link.href, "/cookies");
  link.onClick();
  assert.equal(panelOpen, false);
});

test("the initial consent panel stays out of the way on the Cookie Notice page", () => {
  assert.equal(typeof navigation?.shouldShowConsentPanel, "function");
  assert.equal(navigation.shouldShowConsentPanel("/cookies", null, false), false);
  assert.equal(navigation.shouldShowConsentPanel("/cookies", null, true), true);
  assert.equal(navigation.shouldShowConsentPanel("/privacy", null, false), true);
  assert.equal(navigation.shouldShowConsentPanel("/cookies", "analytics", false), false);
});
