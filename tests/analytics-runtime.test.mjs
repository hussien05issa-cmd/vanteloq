import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { transform } from "esbuild";
import * as publicMarketingEvents from "../shared/public-marketing-events.ts";
import * as consentNavigation from "../app/analytics-consent-navigation.ts";
import * as publicRoutes from "../app/analytics-public-routes.ts";

const source = await readFile(new URL("../app/google-analytics-consent.tsx", import.meta.url), "utf8");
const { code } = await transform(source, { loader: "tsx", format: "cjs", jsx: "automatic", target: "es2022" });

// Executes the real effect bodies with changed inputs and browser event targets.
// This complements browser layout checks; it is not a React DOM renderer.
function fixture({ root = true, pathname = "/", search = "" } = {}) {
  const calls = [], disableStates = [], cookieWrites = [], scripts = new Map(), storage = new Map(), cookies = new Map(), rootListeners = new Set();
  let effects = [], cleanups = [];
  let networkBlocked = false, reloads = 0;
  let tree, storageWritable = true;
  class ElementMock extends EventTarget {
    constructor({ dataset = {}, tag = "button", publicSite = true } = {}) { super(); this.dataset = dataset; this.tag = tag; this.publicSite = publicSite; }
    closest(selector) { return selector === ".public-site" ? (this.publicSite ? this : null) : selector === "[data-public-event]" && this.dataset.publicEvent ? this : null; }
    matches(selector) { return selector.split(",").includes(this.tag); }
  }
  class CustomEventMock extends Event { constructor(type, options = {}) { super(type); this.detail = options.detail; } }
  const window = Object.assign(new EventTarget(), {
    location: { origin: "https://vanteloq.com", pathname, search, reload() { reloads++; } },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { if (!storageWritable) throw new Error("Storage is unavailable"); storage.set(key, String(value)); } },
    gtag: (...args) => { calls.push(args); disableStates.push(window["ga-disable-G-TEST123"]); },
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
    "../shared/public-marketing-events": publicMarketingEvents,
    "./analytics-consent-navigation": { ...consentNavigation, shouldShowConsentPanel: () => true },
    "./analytics-public-routes": publicRoutes,
    "./public-appearance": { usePublicAppearance: () => ({ theme: "dark" }) },
    "./analytics-network-policy": { blockOptionalAnalyticsNetwork: () => { networkBlocked = true; }, optionalAnalyticsNetworkBlocked: () => networkBlocked },
    "./analytics-public-surface": { getPublicRoot: () => root, getServerPublicRoot: () => false, subscribePublicRoot(listener) { rootListeners.add(listener); return () => rootListeners.delete(listener); } },
  };
  const evaluatedModule = { exports: {} };
  vm.runInNewContext(code, { module: evaluatedModule, exports: evaluatedModule.exports, require(name) { assert.ok(Object.hasOwn(modules, name), `Unexpected import: ${name}`); return modules[name]; }, process: { env: { NEXT_PUBLIC_GOOGLE_ANALYTICS_ID: "G-TEST123" } }, window, document, Event, Element: ElementMock, CustomEvent: CustomEventMock });
  return {
    window, calls, disableStates, cookies, cookieWrites, scripts,
    get networkBlocked() { return networkBlocked; }, get reloads() { return reloads; },
    commit(choice) { for (const cleanup of cleanups) cleanup(); if (choice !== undefined) storage.set("vanteloq:cookie-consent:v1", choice); effects = []; tree = evaluatedModule.exports.GoogleAnalyticsConsent(); cleanups = effects.map(run => run()).filter(value => typeof value === "function"); },
    failStorageWrites() { storageWritable = false; },
    choose(choice) {
      const label = choice === "analytics" ? "Allow analytics" : "Essential only";
      const visit = node => Array.isArray(node) ? node.flatMap(visit) : node && typeof node === "object" ? [node, ...visit(node.props?.children)] : [];
      const button = visit(tree).find(node => node.type === "button" && node.props.children === label);
      assert.ok(button); button.props.onClick();
    },
    setRoot(value) { root = value; for (const listener of rootListeners) listener(); },
    withdrawInAnotherTab() { storage.set("vanteloq:cookie-consent:v1", "essential"); const event = new Event("storage"); Object.defineProperty(event, "key", { value: "vanteloq:cookie-consent:v1" }); window.dispatchEvent(event); },
    convert(detail = "inquiry_sent") { window.dispatchEvent(new CustomEventMock("vanteloq:public-conversion", { detail })); },
    interact(type, dataset, options = {}) { const event = new Event(type); Object.defineProperty(event, "target", { value: new ElementMock({ dataset, ...options }) }); document.dispatchEvent(event); },
    finishLoad() { const script = scripts.get("vanteloq-google-analytics"); assert.ok(script); script.dispatchEvent(new Event("load")); },
    commands: name => calls.filter(call => call[0] === name),
    lastConsent: () => calls.filter(call => call[0] === "consent").at(-1)?.[2],
    close() { for (const cleanup of cleanups) cleanup(); },
  };
}

test("withdrawal locks SDK transports and renewed permission uses a fresh document", t => {
  const f = fixture(); t.after(() => f.close()); f.commit("analytics"); f.finishLoad(); f.commit("essential");
  assert.equal(f.lastConsent().analytics_storage, "denied"); assert.equal(f.window["ga-disable-G-TEST123"], true);
  f.commit("analytics");
  assert.equal(f.networkBlocked, true); assert.equal(f.reloads, 0, "automatic effects must not refresh a form");
  f.choose("analytics"); assert.equal(f.reloads, 1, "only deliberate renewed permission refreshes");
  assert.equal(f.lastConsent().analytics_storage, "denied");
  assert.equal(f.window["ga-disable-G-TEST123"], true); assert.equal(f.scripts.size, 1); assert.equal(f.commands("config").length, 1); assert.equal(f.commands("event").length, 1);
});

test("explicit withdrawal blocks queued transports even when saving the choice fails", t => {
  const f = fixture(); t.after(() => f.close()); f.commit("analytics"); f.finishLoad();
  f.failStorageWrites(); f.choose("essential");
  assert.equal(f.networkBlocked, true);
  assert.equal(f.window["ga-disable-G-TEST123"], true);
  assert.equal(f.reloads, 0);
});
test("late load after withdrawal cannot configure or send", t => {
  const f = fixture(); t.after(() => f.close()); f.commit("analytics"); f.commit("essential"); f.finishLoad();
  assert.equal(f.commands("config").length, 0); assert.equal(f.commands("event").length, 0); assert.equal(f.lastConsent().analytics_storage, "denied");
});

test("withdrawal disables measurement before the SDK receives any denied-consent command", t => {
  const f = fixture(); t.after(() => f.close()); f.commit("analytics"); f.finishLoad();
  const before = f.calls.length;
  f.withdrawInAnotherTab();
  for (let index = before; index < f.calls.length; index++) {
    assert.equal(f.disableStates[index], true, "SDK must already be disabled when it processes withdrawal");
  }
  assert.equal(f.lastConsent().analytics_storage, "denied");
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
test("public interactions require consent, public context and a fixed payload", t => {
  const f = fixture(); t.after(() => f.close());
  const dataset = { publicEvent: "story_step_selected", publicSection: "story", publicStep: "comparison", publicPlan: "private-account", value: "private input" };
  f.commit("essential"); f.interact("click", dataset); assert.equal(f.scripts.size, 0); assert.equal(f.commands("event").length, 0);
  f.commit("analytics"); f.finishLoad(); f.interact("click", dataset);
  const measured = f.commands("event").at(-1);
  assert.equal(measured[1], "story_step_selected");
  assert.equal(JSON.stringify(measured[2]), JSON.stringify({ section: "story", step: "comparison", page_location: "https://vanteloq.com/", page_path: "/" }));
  const before = f.commands("event").length;
  f.interact("click", dataset, { publicSite: false });
  f.window.location.search = "?account=private"; f.interact("click", dataset);
  f.window.location.search = ""; f.setRoot(false); f.interact("click", dataset);
  assert.equal(f.commands("event").length, before);
});

test("a select measures its change once and DOM clicks cannot fake completion", t => {
  const f = fixture(); t.after(() => f.close()); f.commit("analytics"); f.finishLoad();
  const dataset = { publicEvent: "industry_selected", publicSection: "industries", publicIndustry: "retail" };
  f.interact("click", dataset, { tag: "select" });
  f.interact("change", dataset, { tag: "select" });
  assert.equal(f.commands("event").filter(call => call[1] === "industry_selected").length, 1);
  f.interact("change", { publicEvent: "hero_play", publicSection: "hero" });
  f.interact("click", { publicEvent: "inquiry_sent" });
  assert.equal(f.commands("event").length, 2);
  f.convert(); assert.equal(f.commands("event").at(-1)[1], "inquiry_sent");
});

test("registered industry solutions gain public measurement, unknown industry routes do not", t => {
  const f = fixture({ pathname: "/solutions/retail" }); t.after(() => f.close()); f.commit("analytics"); f.finishLoad();
  assert.equal(f.commands("event").length, 1);
  f.window.location.pathname = "/solutions/restaurants"; f.commit();
  assert.equal(f.commands("event").length, 2);
  f.window.location.pathname = "/solutions/unlisted"; f.commit();
  f.interact("click", { publicEvent: "hero_play", publicSection: "hero" });
  assert.equal(f.commands("event").length, 2);
  assert.equal(f.window["ga-disable-G-TEST123"], true);
});

test("the Advisory landing page is an approved public measurement route", () => {
  assert.equal(publicRoutes.isPublicMeasurementPath("/advisory"), true);
});

test("confirmed public forms use a fixed conversion vocabulary", t => {
  const f = fixture({ pathname: "/advisory" }); t.after(() => f.close()); f.commit("analytics"); f.finishLoad();
  const initial = f.commands("event").length;
  f.convert("advisory_inquiry_sent");
  f.convert("demo_request_sent");
  f.convert("private_form_value");
  assert.deepEqual(f.commands("event").slice(initial).map(call => call[1]), ["advisory_inquiry_sent", "demo_request_sent"]);
});
