import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createAdvisorAppearanceStore, normalizeAdvisorAppearance, useAdvisorAppearance } from "../app/advisor-appearance";

function browserFixture(stored: string | null = null, dark = false) {
  let blocked = false;
  const systemListeners = new Set<() => void>();
  const storageListeners = new Set<(value: string | null) => void>();
  const environment = {
    read: () => { if (blocked) throw new Error("Storage blocked"); return stored; },
    write: (value: string) => { if (blocked) throw new Error("Storage blocked"); stored = value; },
    systemDark: () => dark,
    subscribeSystem: (listener: () => void) => { systemListeners.add(listener); return () => { systemListeners.delete(listener); }; },
    subscribeStorage: (listener: (value: string | null) => void) => { storageListeners.add(listener); return () => { storageListeners.delete(listener); }; },
  };
  return {
    environment,
    blockStorage: (value: boolean) => { blocked = value; },
    storedValue: () => stored,
    setSystem: (value: boolean) => { dark = value; for (const listener of systemListeners) listener(); },
    setOtherTab: (value: string | null) => { stored = value; for (const listener of storageListeners) listener(value); },
    listenerCount: () => systemListeners.size + storageListeners.size,
  };
}

test("appearance reads a saved explicit choice and normalizes unsupported storage", () => {
  assert.equal(normalizeAdvisorAppearance("dark"), "dark");
  assert.equal(normalizeAdvisorAppearance("light"), "light");
  for (const invalid of [null, undefined, "", "system", "sepia", {}, true]) assert.equal(normalizeAdvisorAppearance(invalid), "system");
  const fixture = browserFixture("dark", false);
  const store = createAdvisorAppearanceStore(fixture.environment);
  assert.deepEqual(store.getSnapshot(), { appearance: "dark", theme: "dark", storageNotice: "" });
  assert.strictEqual(store.getSnapshot(), store.getSnapshot());
});

test("a selection persists and updates every subscriber in the same tab", () => {
  const fixture = browserFixture();
  const store = createAdvisorAppearanceStore(fixture.environment);
  const first: string[] = [], second: string[] = [];
  const unsubscribeFirst = store.subscribe(() => first.push(store.getSnapshot().theme));
  const unsubscribeSecond = store.subscribe(() => second.push(store.getSnapshot().theme));
  store.choose("dark");
  assert.equal(fixture.storedValue(), "dark");
  assert.deepEqual(first, ["dark"]);
  assert.deepEqual(second, ["dark"]);
  const snapshot = store.getSnapshot();
  store.choose("dark");
  assert.strictEqual(store.getSnapshot(), snapshot);
  assert.equal(first.length, 1);
  unsubscribeFirst();
  assert.equal(fixture.listenerCount(), 2);
  unsubscribeSecond();
  assert.equal(fixture.listenerCount(), 0);
});

test("system mode follows device changes while explicit choices stay fixed", () => {
  const fixture = browserFixture("system");
  const store = createAdvisorAppearanceStore(fixture.environment);
  const unsubscribe = store.subscribe(() => {});
  fixture.setSystem(true);
  assert.equal(store.getSnapshot().theme, "dark");
  store.choose("light");
  const explicit = store.getSnapshot();
  fixture.setSystem(false);
  fixture.setSystem(true);
  assert.strictEqual(store.getSnapshot(), explicit);
  store.choose("system");
  assert.equal(store.getSnapshot().theme, "dark");
  unsubscribe();
});

test("cross-tab changes and cleared storage update the current appearance", () => {
  const fixture = browserFixture("light", true);
  const store = createAdvisorAppearanceStore(fixture.environment);
  const unsubscribe = store.subscribe(() => {});
  fixture.setOtherTab("dark");
  assert.equal(store.getSnapshot().appearance, "dark");
  fixture.setOtherTab(null);
  assert.deepEqual(store.getSnapshot(), { appearance: "system", theme: "dark", storageNotice: "" });
  fixture.setOtherTab("unsupported");
  assert.equal(store.getSnapshot().appearance, "system");
  unsubscribe();
});

test("blocked storage preserves an unsaved choice across reopening and explains its scope", () => {
  const fixture = browserFixture("light");
  fixture.blockStorage(true);
  const store = createAdvisorAppearanceStore(fixture.environment);
  const unsubscribe = store.subscribe(() => {});
  assert.match(store.getSnapshot().storageNotice, /this open page/);
  store.choose("dark");
  assert.equal(store.getSnapshot().theme, "dark");
  assert.equal(fixture.storedValue(), "light");
  unsubscribe();
  // Even if reads recover, an older saved value must not replace the unsaved choice.
  fixture.blockStorage(false);
  const reopened = store.subscribe(() => {});
  assert.equal(store.getSnapshot().appearance, "dark");
  assert.match(store.getSnapshot().storageNotice, /could not save/);
  store.choose("dark");
  assert.equal(fixture.storedValue(), "dark");
  assert.equal(store.getSnapshot().storageNotice, "");
  reopened();
});

test("reopening refreshes changes made while no component was subscribed", () => {
  const fixture = browserFixture("light");
  const store = createAdvisorAppearanceStore(fixture.environment);
  const unsubscribe = store.subscribe(() => {});
  unsubscribe();
  fixture.setOtherTab("system");
  fixture.setSystem(true);
  const reopened = store.subscribe(() => {});
  assert.deepEqual(store.getSnapshot(), { appearance: "system", theme: "dark", storageNotice: "" });
  reopened();
  assert.equal(fixture.listenerCount(), 0);
});

test("server rendering uses a deterministic snapshot without browser APIs", () => {
  function AppearanceSample() {
    const { appearance, theme, storageNotice } = useAdvisorAppearance();
    return <span data-appearance={appearance} data-theme={theme}>{storageNotice}</span>;
  }
  assert.equal(renderToStaticMarkup(<AppearanceSample/>), '<span data-appearance="system" data-theme="light"></span>');
});
