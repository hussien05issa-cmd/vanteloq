import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { transform } from "esbuild";

const source = await readFile(new URL("../app/google-analytics-consent.tsx", import.meta.url), "utf8");
const { code } = await transform(source, { loader: "tsx", format: "cjs", jsx: "automatic", target: "es2022" });

// Executes the real effect bodies with changed inputs and browser event targets.
// This complements browser layout checks; it is not a React DOM renderer.
function fixture({ root = true, pathname = "/", search = "" } = {}) {
  const calls = [], cookieWrites = [], scripts = new Map(), storage = new Map(), cookies = new Map(), rootListeners = new Set();
  let effects = [], cleanups = [];
  class ElementMock extends EventTarget {}
  class CustomEventMock extends Event { constructor(type, options = {}) { super(type); this.detail = options.detail; } }
  const window = Object.assign(new EventTarget(), {
    location: { origin: "https://vanteloq.com", pathname, search },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) },
    gtag: (...args) => calls.push(args),
  });
  const document = Object.assign(new EventTarget(), {
    getElementById: id => scripts.get(id) ?? null,
    createElement(tag) { assert.equal(tag, "script"); return new ElementMock(); },
    head: { append(script) { assert.equal(scripts.has(script.id), false, "duplicate script"); scripts.set(script.id, script); } },
  });
  Object.defineProperty(document, "cookie", {
    get: () => [...cookies].map(([key, value]) => `${key}=${value}`).join("; "),
    set(value) {
      cookieWrites.push(value);
      const [pair] = value.split(";"), separator = pair.indexOf("="), name = pair.slice(0, separator);
      if (/;\s*Max-Age=0(?:;|$)/i.test(value)) cookies.delete(name);
      else cookies.set(name, pair.slice(separator + 1));
    },
  });
  const noop = () => undefined, jsx = (type, props) => ({ type, props });
  const modules = {
    react: { useCallback: fn => fn, useEffect: fn => effects.push(fn), useRef: current => ({ current }), useState: initial => [typeof initial === "function" ? initial() : initial, noop], useSyncExternalStore: (_subscribe, snapshot) => snapshot() },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: Symbol("Fragment") },
    "next/link": { default: noop }, "next/navigation": { usePathname: () => window.location.pathname },
    "./product-brand-logo": { default: noop }, "./use-modal-focus": { useModalFocus: noop },
    "./analytics-consent-navigation": { createCookieNoticeNavigation: () => ({ href: "/cookies" }), shouldShowConsentPanel: () => false },
    "./analytics-public-surface": { getPublicRoot: () => root, getServerPublicRoot: () => false, subscribePublicRoot(listener) { rootListeners.add(listener); return () => rootListeners.delete(listener); } },
  };
  const evaluatedModule = { exports: {} };
  vm.runInNewContext(code, { module: evaluatedModule, exports: evaluatedModule.exports, require(name) { assert.ok(Object.hasOwn(modules, name), `Unexpected import: ${name}`); return modules[name]; }, process: { env: { NEXT_PUBLIC_GOOGLE_ANALYTICS_ID: "G-TEST123" } }, window, document, Event, Element: ElementMock, CustomEvent: CustomEventMock });
  return {
    window, calls, cookies, cookieWrites, scripts,
    commit(choice) { for (const cleanup of cleanups) cleanup(); if (choice !== undefined) storage.set("vanteloq:cookie-consent:v1", choice); effects = []; evaluatedModule.exports.GoogleAnalyticsConsent(); cleanups = effects.map(run => run()).filter(value => typeof value === "function"); },
    setRoot(value) { root = value; for (const listener of rootListeners) listener(); },
    withdrawInAnotherTab() { storage.set("vanteloq:cookie-consent:v1", "essential"); const event = new Event("storage"); Object.defineProperty(event, "key", { value: "vanteloq:cookie-consent:v1" }); window.dispatchEvent(event); },
    convert() { window.dispatchEvent(new CustomEventMock("vanteloq:public-conversion", { detail: "inquiry_sent" })); },
    finishLoad() { const script = scripts.get("vanteloq-google-analytics"); assert.ok(script); script.dispatchEvent(new Event("load")); },
    commands: name => calls.filter(call => call[0] === name),
    lastConsent: () => calls.filter(call => call[0] === "consent").at(-1)?.[2],
    close() { for (const cleanup of cleanups) cleanup(); },
  };
}

test("allow, withdraw, allow grants again without duplicating script or configuration", t => {
  const f = fixture(); t.after(() => f.close()); f.commit("analytics"); f.finishLoad(); f.commit("essential");
  assert.equal(f.lastConsent().analytics_storage, "denied"); assert.equal(f.window["ga-disable-G-TEST123"], true);
  f.commit("analytics");
  assert.equal(f.lastConsent().analytics_storage, "granted"); assert.equal(f.lastConsent().ad_storage, "denied");
  assert.equal(f.window["ga-disable-G-TEST123"], false); assert.equal(f.scripts.size, 1); assert.equal(f.commands("config").length, 1); assert.equal(f.commands("event").length, 2);
});
test("late load after withdrawal cannot configure or send", t => {
  const f = fixture(); t.after(() => f.close()); f.commit("analytics"); f.commit("essential"); f.finishLoad();
  assert.equal(f.commands("config").length, 0); assert.equal(f.commands("event").length, 0); assert.equal(f.lastConsent().analytics_storage, "denied");
});
test("public navigation preserves cookies; withdrawal removes only analytics", t => {
  const f = fixture(); t.after(() => f.close()); f.commit("analytics"); f.finishLoad();
  f.cookies.set("_ga", "fictional-id"); f.cookies.set("_ga_TEST123", "fictional-session"); f.cookies.set("session", "fictional-essential");
  const expected = Object.fromEntries(f.cookies);
  f.window.location.pathname = "/pricing"; f.commit();
  assert.deepEqual(Object.fromEntries(f.cookies), expected); assert.equal(f.cookieWrites.length, 0); assert.equal(f.commands("event").length, 2);
  f.window.location.pathname = "/"; f.setRoot(false); f.commit();
  assert.deepEqual(Object.fromEntries(f.cookies), expected); assert.equal(f.cookieWrites.length, 0); assert.equal(f.window["ga-disable-G-TEST123"], true); assert.equal(f.commands("event").length, 2);
  f.commit("essential"); assert.equal(f.cookies.has("_ga"), false); assert.equal(f.cookies.has("_ga_TEST123"), false); assert.equal(f.cookies.get("session"), "fictional-essential");
});
test("private root blocks initial loading and a pending public initialization", t => {
  const f = fixture({ root: false }); t.after(() => f.close()); f.commit("analytics"); assert.equal(f.scripts.size, 0);
  f.setRoot(true); f.commit(); f.setRoot(false); f.finishLoad();
  assert.equal(f.commands("config").length, 0); assert.equal(f.commands("event").length, 0); assert.equal(f.window["ga-disable-G-TEST123"], true);
});
test("query strings block initial loading and late configuration", t => {
  const f = fixture({ pathname: "/pricing", search: "?private=example" }); t.after(() => f.close()); f.commit("analytics"); assert.equal(f.scripts.size, 0);
  f.window.location.search = ""; f.commit(); assert.equal(f.scripts.size, 1); f.window.location.search = "?private=example"; f.finishLoad();
  assert.equal(f.commands("config").length, 0); assert.equal(f.commands("event").length, 0);
});
test("cross-tab withdrawal and a changed route stop stale conversion callbacks immediately", t => {
  const f = fixture(); t.after(() => f.close()); f.commit("analytics"); f.finishLoad(); f.convert(); assert.equal(f.commands("event").length, 2);
  f.window.location.pathname = "/pricing"; f.convert(); assert.equal(f.commands("event").length, 2);
  f.window.location.pathname = "/"; f.withdrawInAnotherTab(); f.convert();
  assert.equal(f.commands("event").length, 2); assert.equal(f.lastConsent().analytics_storage, "denied");
});
