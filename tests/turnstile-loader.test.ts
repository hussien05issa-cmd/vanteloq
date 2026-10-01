import assert from "node:assert/strict";
import test from "node:test";
import { loadTurnstile, loadTurnstileConfiguration } from "../app/turnstile-loader.ts";

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
  const originalFetch = globalThis.fetch;
  const configurationRequests: Array<{ url: string; signal?: AbortSignal | null; resolve: (response: Response) => void }> = [];
  globalThis.fetch = async (input, init) => new Promise<Response>(resolve => {
    configurationRequests.push({ url: String(input), signal: init?.signal, resolve });
  });
  Object.defineProperty(globalThis, "window", { value: fakeWindow, configurable: true });
  Object.defineProperty(globalThis, "document", { value: fakeDocument, configurable: true });
  try {
    const controller = new AbortController();
    const prepared = loadTurnstileConfiguration("signup", controller.signal);
    assert.equal(scripts.length, 1, "The script starts before configuration responds.");
    assert.equal(configurationRequests.length, 1, "Configuration starts without waiting for the script.");
    assert.equal(configurationRequests[0].url, "/api/v1/auth/signup?action=signup");
    assert.equal(configurationRequests[0].signal, controller.signal);
    const first = loadTurnstile();
    assert.equal(loadTurnstile(), first);
    configurationRequests[0].resolve(Response.json({ configured: true, siteKey: "fixture-site", action: "signup" }));
    assert.deepEqual(await prepared, { siteKey: "fixture-site", action: "signup" });
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

    const wrongAction = loadTurnstileConfiguration("signin", controller.signal);
    configurationRequests[1].resolve(Response.json({ configured: true, siteKey: "fixture-site", action: "signup" }));
    await assert.rejects(wrongAction, /protection is unavailable/);
    const canceled = loadTurnstileConfiguration("signup", controller.signal);
    controller.abort();
    configurationRequests[2].resolve(Response.json({ configured: true, siteKey: "fixture-site", action: "signup" }));
    await assert.rejects(canceled, { name: "AbortError" });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
