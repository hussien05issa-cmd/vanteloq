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
