import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as navigation from "../app/analytics-consent-navigation.ts";
import * as routes from "../app/analytics-public-routes.ts";

const source = await readFile(new URL("../app/google-analytics-consent.tsx", import.meta.url), "utf8");
const { code } = await transform(source, { loader: "tsx", format: "cjs", jsx: "automatic", target: "es2022" });
function render(pathname) {
  const evaluatedModule = { exports: {} };
  const modules = {
    react: React, "react/jsx-runtime": jsxRuntime,
    "next/link": { __esModule: true, default: props => React.createElement("a", props) },
    "next/navigation": { usePathname: () => pathname },
    "./analytics-consent-navigation": navigation, "./analytics-public-routes": routes,
    "./analytics-public-surface": { subscribePublicRoot: () => () => {}, getPublicRoot: () => false, getServerPublicRoot: () => false },
    "./workspace-appearance": { useWorkspaceAppearance: () => ({ theme: "dark" }) },
    "./use-modal-focus": { useModalFocus: () => {} },
    "../shared/public-marketing-events": { publicMarketingEvent: () => null },
  };
  vm.runInNewContext(code, { module: evaluatedModule, exports: evaluatedModule.exports, process: { env: {} }, require(name) {
    assert.ok(Object.hasOwn(modules, name), name); return modules[name];
  } });
  return renderToStaticMarkup(React.createElement(evaluatedModule.exports.GoogleAnalyticsConsent));
}

test("first public response includes readable privacy choices without client hydration or analytics", () => {
  for (const pathname of ["/", "/pricing", "/tools/cash-order-planner"]) {
    const html = render(pathname);
    assert.match(html, /id="analytics-consent-copy"/);
    assert.match(html, /Essential only/);
    assert.match(html, /Allow analytics/);
    assert.match(html, /data-consent-initial="true"/);
    assert.doesNotMatch(html, /<script|googletagmanager\.com/);
  }
});

test("initial privacy choices do not cover the Cookie Notice or private application routes", () => {
  for (const pathname of ["/cookies", "/signin", "/api/v1/me", "/admin"]) {
    assert.doesNotMatch(render(pathname), /id="analytics-consent-copy"/);
  }
  assert.equal(navigation.shouldShowConsentPanel("/cookies", "essential", true), true, "explicit reopening is still available");
});

test("pre-paint suppression accepts only exact existing saved choices and cannot start tracking", () => {
  for (const saved of ["analytics", "essential", null, "", "true", "old-version", "</script><script>alert(1)</script>"]) {
    const dataset = {};
    vm.runInNewContext(navigation.CONSENT_PRESENTATION_BOOTSTRAP, {
      localStorage: { getItem(key) { assert.equal(key, navigation.CONSENT_STORAGE_KEY); return saved; } },
      document: { documentElement: { dataset } },
    });
    assert.deepEqual(dataset, saved === "analytics" || saved === "essential" ? { analyticsConsentSaved: "true" } : {});
  }
  const dataset = {};
  assert.doesNotThrow(() => vm.runInNewContext(navigation.CONSENT_PRESENTATION_BOOTSTRAP, {
    localStorage: { getItem() { throw new Error("Storage unavailable"); } }, document: { documentElement: { dataset } },
  }));
  assert.deepEqual(dataset, {}, "blocked storage leaves choices visible");
});
