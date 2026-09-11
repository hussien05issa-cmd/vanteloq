import assert from "node:assert/strict";
import test from "node:test";
import { loadTurnstile } from "../app/turnstile-loader.ts";

test("security verification retries failed downloads and timeouts, sharing an in-flight load", async () => {
  const scripts: Array<{ onload: null | (() => void); onerror: null | (() => void); removed: boolean; dataset: object; remove(): void }> = [];
  let expire: (() => void) | undefined;
  const fakeWindow = {
    turnstile: undefined as object | undefined,
    setTimeout(callback: () => void) { expire = callback; return 1; },
    clearTimeout() { expire = undefined; },
  };
  const fakeDocument = {
    createElement() {
      const script = { onload: null, onerror: null, removed: false, dataset: {}, remove() { this.removed = true; } };
      scripts.push(script);
      return script;
    },
    head: { appendChild() {} },
  };
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "window", { value: fakeWindow, configurable: true });
  Object.defineProperty(globalThis, "document", { value: fakeDocument, configurable: true });
  try {
    const first = loadTurnstile();
    assert.equal(loadTurnstile(), first);
    scripts[0].onerror!();
    await assert.rejects(first, /could not load/);
    assert.equal(scripts[0].removed, true);
    const second = loadTurnstile();
    expire!();
    await assert.rejects(second, /timed out/);
    assert.equal(scripts[1].removed, true);
    const third = loadTurnstile();
    fakeWindow.turnstile = {};
    scripts[2].onload!();
    await third;
    await loadTurnstile();
    assert.equal(scripts.length, 3);
    assert.equal(expire, undefined);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
