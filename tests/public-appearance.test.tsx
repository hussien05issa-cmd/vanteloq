import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import Home from "../app/page";
import DiscoveryShell from "../app/discovery-shell";
import { createPublicAppearanceStore, PublicAppearanceBoundary, usePublicAppearance } from "../app/public-appearance";
import { createWorkspaceAppearanceStore, WorkspaceAppearanceControl } from "../app/workspace-appearance";

function deviceFixture(initial: boolean | null = false) {
  let dark = initial;
  const listeners = new Set<() => void>();
  return {
    environment: {
      systemDark: () => dark,
      subscribeSystem: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    },
    setDark(value: boolean | null) { dark = value; for (const listener of listeners) listener(); },
    listenerCount: () => listeners.size,
  };
}

test("homepage has a deterministic system fallback and no manual appearance control", () => {
  const html = renderToStaticMarkup(createElement(Home));
  assert.match(html, /data-public-theme="dark" data-public-appearance="system"/);
  assert.match(html, /A number without a source is a rumour\./);
  assert.match(html, /Your business, <em>at a glance\.<\/em>/);
  const header = html.slice(html.indexOf('<header class="public-nav"'), html.indexOf('</header>'));
  assert.match(header, /aria-label="Vanteloq home"/);
  assert.match(header, /aria-label="Vanteloq logo"/);
  assert.doesNotMatch(header, /<span>Vanteloq<\/span>/);
  assert.doesNotMatch(header, /aria-label="Colour theme"|public-appearance-control/);
});

test("public appearance follows live device changes independently of saved workspace overrides", () => {
  const device = deviceFixture(false);
  let saved = "dark";
  const writes: string[] = [];
  const workspace = createWorkspaceAppearanceStore({
    read: () => saved,
    write: value => { saved = value; writes.push(value); },
    ...device.environment,
    subscribeStorage: () => () => {},
  });
  const publicStore = createPublicAppearanceStore(device.environment);
  const publicThemes: string[] = [];
  const stopPublic = publicStore.subscribe(() => publicThemes.push(publicStore.getSnapshot().theme));
  const stopWorkspace = workspace.subscribe(() => {});
  assert.equal(publicStore.getSnapshot().theme, "light");
  assert.equal(workspace.getSnapshot().theme, "dark");
  assert.deepEqual(writes, []);
  device.setDark(true);
  assert.equal(publicStore.getSnapshot().theme, "dark");
  workspace.choose("light");
  assert.equal(workspace.getSnapshot().theme, "light");
  assert.equal(publicStore.getSnapshot().theme, "dark");
  device.setDark(false);
  assert.equal(publicStore.getSnapshot().theme, "light");
  assert.equal(saved, "light");
  assert.deepEqual(writes, ["light"], "Only an explicit internal choice may write the saved preference");
  assert.deepEqual(publicThemes, ["dark", "light"]);
  stopPublic(); stopWorkspace();
  assert.equal(device.listenerCount(), 0);
});

test("public theme subscriptions refresh after remount and do not notify unchanged snapshots", () => {
  const device = deviceFixture(false), store = createPublicAppearanceStore(device.environment);
  let calls = 0;
  const snapshot = store.getSnapshot();
  const stopA = store.subscribe(() => calls++), stopB = store.subscribe(() => calls++);
  assert.equal(device.listenerCount(), 1);
  device.setDark(false);
  assert.strictEqual(store.getSnapshot(), snapshot);
  assert.equal(calls, 0);
  stopA(); stopB();
  device.setDark(true);
  const stopAgain = store.subscribe(() => calls++);
  assert.equal(store.getSnapshot().theme, "dark");
  assert.equal(calls, 1);
  stopAgain();
  assert.equal(device.listenerCount(), 0);
});

test("unsupported device APIs fail safely without involving browser storage", () => {
  const store = createPublicAppearanceStore({
    systemDark: () => { throw Error("Unavailable"); },
    subscribeSystem: () => { throw Error("Unavailable"); },
  });
  assert.deepEqual(store.getSnapshot(), { appearance: "system", theme: "dark" });
  const unsubscribe = store.subscribe(() => {});
  assert.doesNotThrow(unsubscribe);
  const source = readFileSync(new URL("../app/public-appearance.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /localStorage|sessionStorage|WORKSPACE_APPEARANCE_KEY|useWorkspaceAppearance/);
});

test("public portal server rendering is stable without mutating the live device snapshot", () => {
  const store = createPublicAppearanceStore(deviceFixture(false).environment);
  function Sample() { const appearance = usePublicAppearance(store); return <span>{appearance.theme}</span>; }
  const html = renderToStaticMarkup(<PublicAppearanceBoundary store={store}><Sample/></PublicAppearanceBoundary>);
  assert.match(html, /data-workspace-theme="dark" data-workspace-appearance="system" data-public-appearance="system"/);
  assert.match(html, /<span>dark<\/span>/);
  assert.equal(store.getSnapshot().theme, "light");
});

test("public portals use the public theme while internal portals retain their saved theme boundary", () => {
  const surface = readFileSync(new URL("../app/expanding-surface.tsx", import.meta.url), "utf8");
  assert.match(surface, /<PublicAppearanceBoundary>\{surface\}<\/PublicAppearanceBoundary>/);
  assert.match(surface, /<WorkspaceAppearanceBoundary>\{surface\}<\/WorkspaceAppearanceBoundary>/);
  const consent = readFileSync(new URL("../app/google-analytics-consent.tsx", import.meta.url), "utf8");
  assert.match(consent, /usePublicAppearance\(\)/);
});

test("discovery pages follow the device without controls and retain fixed brand-page themes", () => {
  const html = renderToStaticMarkup(<DiscoveryShell><p>Public content</p></DiscoveryShell>);
  assert.match(html, /data-public-theme="dark" data-public-appearance="system"/);
  assert.doesNotMatch(html, /aria-label="Colour theme"|public-appearance-control/);
  const fixed = renderToStaticMarkup(<DiscoveryShell fixedTheme="dark"><p>Fixed brand theme</p></DiscoveryShell>);
  assert.match(fixed, /data-public-theme="dark" data-public-appearance="dark"/);
  const internal = renderToStaticMarkup(<WorkspaceAppearanceControl/>);
  assert.equal((internal.match(/type="radio"/g) ?? []).length, 3);
  for (const value of ["dark", "light", "system"]) assert.ok(internal.includes(`value="${value}"`));
});
