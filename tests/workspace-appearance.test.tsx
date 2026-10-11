import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createWorkspaceAppearanceStore, normalizeWorkspaceAppearance, useWorkspaceAppearance,
  WorkspaceAppearanceBoundary, WorkspaceAppearanceControl,
} from "../app/workspace-appearance";

function browserFixture(stored: string | null = null, dark: boolean | null = false) {
  let blocked = false;
  const systemListeners = new Set<() => void>();
  const storageListeners = new Set<(value: string | null) => void>();
  const writes: string[] = [];
  const environment = {
    read: () => { if (blocked) throw new Error("Storage blocked"); return stored; },
    write: (value: string) => { if (blocked) throw new Error("Storage blocked"); stored = value; writes.push(value); },
    systemDark: () => dark,
    subscribeSystem: (listener: () => void) => { systemListeners.add(listener); return () => { systemListeners.delete(listener); }; },
    subscribeStorage: (listener: (value: string | null) => void) => { storageListeners.add(listener); return () => { storageListeners.delete(listener); }; },
  };
  return {
    environment, writes,
    blockStorage: (value: boolean) => { blocked = value; },
    storedValue: () => stored,
    setSystem: (value: boolean | null) => { dark = value; for (const listener of systemListeners) listener(); },
    setOtherTab: (value: string | null) => { stored = value; for (const listener of storageListeners) listener(value); },
    listenerCount: () => systemListeners.size + storageListeners.size,
  };
}

test("new and unsupported device preferences default to dark regardless of system light", () => {
  for (const invalid of [null, undefined, "", "sepia", {}, true]) assert.equal(normalizeWorkspaceAppearance(invalid), "dark");
  for (const valid of ["dark", "light", "system"] as const) assert.equal(normalizeWorkspaceAppearance(valid), valid);
  const fixture = browserFixture();
  const store = createWorkspaceAppearanceStore(fixture.environment);
  assert.deepEqual(store.getSnapshot(), { appearance: "dark", theme: "dark", storageNotice: "", systemNotice: "" });
  assert.strictEqual(store.getSnapshot(), store.getSnapshot());
  assert.deepEqual(fixture.writes, []); // Rendering never overwrites the stored preference.
});

test("saved light is honoured on the client, with a deterministic dark SSR snapshot", () => {
  const store = createWorkspaceAppearanceStore(browserFixture("light", true).environment);
  assert.equal(store.getSnapshot().theme, "light");
  assert.equal(store.getServerSnapshot().theme, "dark");
  assert.strictEqual(store.getServerSnapshot(), store.getServerSnapshot());
});

test("selections persist and update multiple consumers with stable unchanged snapshots", () => {
  const fixture = browserFixture();
  const store = createWorkspaceAppearanceStore(fixture.environment);
  const first: string[] = [], second: string[] = [];
  const stopFirst = store.subscribe(() => first.push(store.getSnapshot().theme));
  const stopSecond = store.subscribe(() => second.push(store.getSnapshot().theme));
  store.choose("light");
  assert.equal(fixture.storedValue(), "light");
  assert.deepEqual(first, ["light"]);
  assert.deepEqual(second, ["light"]);
  const snapshot = store.getSnapshot();
  store.choose("light");
  assert.strictEqual(store.getSnapshot(), snapshot);
  assert.equal(first.length, 1);
  stopFirst();
  assert.equal(fixture.listenerCount(), 2);
  stopSecond();
  assert.equal(fixture.listenerCount(), 0);
});

test("system follows live device changes, explicit choices stay fixed, unsupported devices fall back truthfully", () => {
  const fixture = browserFixture("system");
  const store = createWorkspaceAppearanceStore(fixture.environment);
  const stop = store.subscribe(() => {});
  assert.equal(store.getSnapshot().theme, "light");
  fixture.setSystem(true);
  assert.equal(store.getSnapshot().theme, "dark");
  store.choose("light");
  const explicit = store.getSnapshot();
  fixture.setSystem(false); fixture.setSystem(true);
  assert.strictEqual(store.getSnapshot(), explicit);
  fixture.setSystem(null); store.choose("system");
  assert.equal(store.getSnapshot().theme, "dark");
  assert.match(store.getSnapshot().systemNotice, /unavailable/);
  fixture.setSystem(false);
  assert.equal(store.getSnapshot().theme, "light");
  assert.equal(store.getSnapshot().systemNotice, "");
  stop();
});

test("cross-tab changes and storage clear refresh every subscribed consumer", () => {
  const fixture = browserFixture("light");
  const store = createWorkspaceAppearanceStore(fixture.environment);
  const stop = store.subscribe(() => {});
  fixture.setOtherTab("system");
  assert.equal(store.getSnapshot().theme, "light");
  fixture.setOtherTab(null);
  assert.equal(store.getSnapshot().theme, "dark");
  assert.equal(store.getSnapshot().appearance, "dark");
  fixture.setOtherTab("unsupported");
  assert.equal(store.getSnapshot().appearance, "dark");
  stop();
});

test("blocked writes preserve a choice across remount and can be retried after recovery", () => {
  const fixture = browserFixture("dark"); fixture.blockStorage(true);
  const store = createWorkspaceAppearanceStore(fixture.environment);
  const stop = store.subscribe(() => {});
  assert.match(store.getSnapshot().storageNotice, /this open page/);
  store.choose("light"); stop();
  assert.equal(fixture.storedValue(), "dark");
  fixture.blockStorage(false);
  const remount = store.subscribe(() => {});
  assert.equal(store.getSnapshot().theme, "light");
  assert.match(store.getSnapshot().storageNotice, /could not load or save/);
  store.choose("light");
  assert.equal(fixture.storedValue(), "light");
  assert.equal(store.getSnapshot().storageNotice, "");
  remount();
});

test("subscription mount/unmount/remount refreshes missed events and leaves no listener leaks", () => {
  const fixture = browserFixture("light");
  const store = createWorkspaceAppearanceStore(fixture.environment);
  const callback = () => {};
  const first = store.subscribe(callback), second = store.subscribe(callback);
  first(); first();
  assert.equal(fixture.listenerCount(), 2); // One consumer still exists.
  second();
  assert.equal(fixture.listenerCount(), 0);
  fixture.setOtherTab("system"); fixture.setSystem(true);
  const remount = store.subscribe(callback);
  assert.deepEqual(store.getSnapshot(), { appearance: "system", theme: "dark", storageNotice: "", systemNotice: "" });
  remount();
  assert.equal(fixture.listenerCount(), 0);
});

test("throwing device and subscription APIs do not break rendering or unmount", () => {
  const fixture = browserFixture("system");
  const store = createWorkspaceAppearanceStore({ ...fixture.environment,
    systemDark: () => { throw new Error("Unavailable"); },
    subscribeSystem: () => { throw new Error("Unavailable"); },
    subscribeStorage: () => () => { throw new Error("Unavailable"); },
  });
  const stop = store.subscribe(() => {});
  assert.equal(store.getSnapshot().theme, "dark");
  assert.match(store.getSnapshot().systemNotice, /unavailable/);
  assert.doesNotThrow(stop);
  store.choose("light");
  assert.equal(store.getSnapshot().theme, "light");
  assert.equal(store.getSnapshot().systemNotice, "");
});

test("React server rendering and portal boundary use dark without browser APIs", () => {
  const store = createWorkspaceAppearanceStore(browserFixture("light").environment);
  function Sample() {
    const value = useWorkspaceAppearance(store);
    return <span data-theme={value.theme}>{value.appearance}</span>;
  }
  const html = renderToStaticMarkup(<WorkspaceAppearanceBoundary store={store}><Sample/></WorkspaceAppearanceBoundary>);
  assert.match(html, /data-workspace-theme="dark" data-workspace-appearance="dark"/);
  assert.match(html, /<span data-theme="dark">dark<\/span>/);
  assert.equal(store.getSnapshot().theme, "light"); // SSR did not mutate device state.
});

test("settings control has three labelled native choices, one selected choice, and device scope", () => {
  const html = renderToStaticMarkup(<WorkspaceAppearanceControl/>);
  assert.equal((html.match(/type="radio"/g) ?? []).length, 3);
  assert.equal((html.match(/checked=""/g) ?? []).length, 1);
  assert.match(html, /value="dark"/);
  assert.match(html, /<legend[^>]*>Colour theme<\/legend>/);
  assert.match(html, /Follow your device/);
  assert.match(html, /Saved in this browser/);
  assert.match(html, /role="status" aria-live="polite"/);
});

const css = readFileSync(new URL("../app/workspace-appearance.css", import.meta.url), "utf8");
function tokens(mode: string) {
  const block = css.match(new RegExp(`\\[data-workspace-theme="${mode}"\\] \\{([^}]+)\\}`))?.[1];
  assert.ok(block, `Missing ${mode} theme`);
  return Object.fromEntries([...block.matchAll(/--ws-([\w-]+):\s*(#[\da-f]{6})/gi)].map(match => [match[1], match[2]]));
}
function luminance(hex: string) {
  const channels = [1,3,5].map(start => Number.parseInt(hex.slice(start,start+2),16)/255).map(value => value <= .04045 ? value/12.92 : ((value+.055)/1.055)**2.4);
  return .2126*channels[0]+.7152*channels[1]+.0722*channels[2];
}
function contrast(a: string,b: string) { const x=luminance(a),y=luminance(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); }
for (const mode of ["dark","light"]) test(`${mode} CSS tokens meet declared text, control and financial-status contrast pairs`, () => {
  const t=tokens(mode);
  for(const surface of ["canvas","panel","raised","selected"]) for(const text of ["ink","muted","blue","purple","positive","negative","warning"])
    assert.ok(contrast(t[text],t[surface])>=4.5, `${mode}: ${text}/${surface} = ${contrast(t[text],t[surface]).toFixed(2)}`);
  for(const surface of ["canvas","panel","raised"]) for(const control of ["control","purple"])
    assert.ok(contrast(t[control],t[surface])>=3, `${mode}: ${control}/${surface}`);
  for(const status of ["positive","negative","warning"]) assert.ok(contrast(t[status],t[`${status}-bg`])>=4.5,`${mode}: ${status} message`);
  for(const primary of ["primary","primary-hover"]) assert.ok(contrast(t["on-primary"],t[primary])>=4.5,`${mode}: primary text`);
});

test("theme rules preserve public scope, brands and explicit financial states", () => {
  assert.doesNotMatch(css, /(?:^|\n)\s*(?:body|html|:root|\.reference-home)\s*[,{]/);
  assert.doesNotMatch(css, /filter:\s*(?:invert|brightness|grayscale)/);
  assert.match(css, /\.change-up[^}]+var\(--ws-positive\)/);
  assert.match(css, /\[data-negative="true"\][^}]+var\(--ws-negative\)/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /forced-colors:\s*active/);
  assert.match(css, /forced-color-adjust:\s*auto/);
});
