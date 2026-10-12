import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";
import { createSessionReader } from "../app/browser-session.ts";

const source = await readFile(new URL("../app/supabase-browser.ts", import.meta.url), "utf8");
const { code } = await transform(source, { loader: "ts", format: "cjs", target: "es2022", supported: { "dynamic-import": false } });
function fixture() {
  let sdkReads = 0, clients = 0, sessionReads = 0, failLoad = false, options;
  const listeners = [], signOutCalls = [], requests = [];
  const session = { access_token: "fictional-token", expires_at: Math.floor(Date.now() / 1000) + 3600 };
  const client = { auth: {
    onAuthStateChange(listener) { listeners.push(listener); return { data: { subscription: { unsubscribe() {} } } }; },
    async getSession() { sessionReads++; return { data: { session }, error: null }; },
    async signOut(option) { signOutCalls.push(option); for (const listener of listeners) listener("SIGNED_OUT", null); },
  } };
  const evaluatedModule = { exports: {} };
  const modules = {
    "./browser-session": { createSessionReader },
    "../domain/business-context": { businessContextHeaders: init => new Headers(init) },
    "./request-recovery": { recoverApiResponse: async response => response, requestRecoveryMessage: () => "Try again." },
  };
  vm.runInNewContext(code, {
    module: evaluatedModule, exports: evaluatedModule.exports, Headers, Request, URL, AbortSignal,
    window: { location: { href: "https://vanteloq.com/" }, dispatchEvent() {} },
    fetch: async (input, init) => { requests.push({ input, method: init?.method }); return new Response("{}", { status: 200 }); },
    require(name) {
      if (name === "@supabase/supabase-js") {
        sdkReads++;
        if (failLoad) throw new Error("Fictional module transport failure");
        return { createClient(_url, _key, configuration) { clients++; options = configuration; return client; } };
      }
      assert.ok(Object.hasOwn(modules, name), name); return modules[name];
    },
  });
  return { api: evaluatedModule.exports, client, session, requests, signOutCalls,
    counts: () => ({ sdkReads, clients, sessionReads }), options: () => options,
    fail(value) { failLoad = value; },
    update(value) { for (const listener of listeners) listener(value ? "SIGNED_IN" : "SIGNED_OUT", value); },
  };
}

test("evaluating the public client module does not evaluate the authentication SDK", () => {
  assert.deepEqual(fixture().counts(), { sdkReads: 0, clients: 0, sessionReads: 0 });
});

test("concurrent initialization shares one SDK client and keeps callback/session settings", async () => {
  const f = fixture(), first = f.api.getSupabase(), second = f.api.getSupabase();
  assert.equal(first, second);
  assert.deepEqual(await Promise.all([first, second]), [f.client, f.client]);
  assert.deepEqual(f.counts(), { sdkReads: 1, clients: 1, sessionReads: 0 });
  assert.equal(JSON.stringify(f.options().auth), JSON.stringify({ flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }));
});

test("failed SDK initialization rejects without caching a permanently failed client", async () => {
  const f = fixture(); f.fail(true);
  await assert.rejects(f.api.getSupabase(), /module transport failure/);
  f.fail(false);
  assert.equal(await f.api.getSupabase(), f.client);
  assert.deepEqual(f.counts(), { sdkReads: 2, clients: 1, sessionReads: 0 });
});

test("auth events retain in-memory sessions and cross-tab account/sign-out changes", async () => {
  const f = fixture(); await f.api.getSupabase();
  f.update(f.session);
  assert.equal(await f.api.currentSession(), f.session);
  const replacement = { ...f.session, access_token: "fictional-other-account" };
  f.update(replacement);
  assert.equal(await f.api.currentSession(), replacement);
  f.update(null);
  assert.equal(await f.api.currentSession(), null);
  assert.equal(f.counts().sessionReads, 0);
});

test("sign-out still ends the server lease and the shared SDK session", async () => {
  const f = fixture(); await f.api.getSupabase(); f.update(f.session);
  await f.api.signOut();
  assert.equal(f.requests[0].input, "/api/v1/session");
  assert.equal(f.requests[0].method, "DELETE");
  assert.equal(f.signOutCalls.length, 1);
  assert.equal(await f.api.currentSession(), null);
});
