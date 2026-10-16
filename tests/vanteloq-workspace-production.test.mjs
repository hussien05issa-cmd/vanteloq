import assert from "node:assert/strict";
import test from "node:test";

const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("vanteloq-workspace-production", `${process.pid}-${Date.now()}`);
const { default: worker } = await import(workerUrl.href);

const env = {
  ASSETS: {
    fetch: async () => new Response("Not found", { status: 404 }),
  },
};
const ctx = { waitUntil() {}, passThroughOnException() {} };

async function fetchRoute(path) {
  return worker.fetch(new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }), env, ctx);
}

test("Data Studio entry links redirect only to approved app destinations without carrying account context", async () => {
  const origin = "https://vanteloq-workspace.hussien05issa.chatgpt.site";
  for (const [path, destination] of [
    ["/datstudio", "/"],
    ["/datstudio/compose", "/compose"],
    ["/datstudio/model", "/workspace#app=model"],
    ["/datstudio/deckly", "/workspace#app=deckly"],
    ["/datstudio/blueprint", "/workspace#app=blueprint"],
    ["/datstudio/calendar", "/workspace#app=calendar"],
    ["/datstudio/studio", "/workspace#app=studio"],
    ["/datstudio/files", "/workspace"],
    ["/datstudio/demo", "/demo"],
  ]) {
    const response = await worker.fetch(new Request(`https://vanteloq.com${path}?return_to=https://untrusted.invalid&access_token=do-not-forward`, {
      headers: { cookie: "session=do-not-forward", authorization: "Bearer do-not-forward" },
    }), env, ctx);
    assert.equal(response.status, 302, path);
    assert.equal(response.headers.get("location"), origin + destination, path);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(response.headers.has("set-cookie"), false);
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(await response.text(), "");
  }
});

test("Data Studio navigation rejects unsupported routes and mutation methods", async () => {
  for (const path of ["/datstudio/unknown", "/datstudio/compose/unknown", "/datstudio-extra"]) {
    assert.equal((await fetchRoute(path)).status, 404, path);
  }
  const response = await worker.fetch(new Request("http://localhost/datstudio", {method: "POST", body: "private data"}), env, ctx);
  assert.equal(response.status, 405);
  assert.equal(response.headers.has("location"), false);
});

test("the built worker serves the exact Workspace gateway route with its security boundary", async () => {
  const response = await fetchRoute("/vanteloqworkspace");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);

  const html = await response.text();
  assert.match(html, /https:\/\/vanteloq\.com\/vanteloqworkspace/);
  assert.match(html, /https:\/\/vanteloq-workspace\.hussien05issa\.chatgpt\.site\//);
  for (const name of ["Compose", "Model", "Deckly", "Blueprint", "Calendar", "Studio"]) assert.match(html, new RegExp(`>${name}<`));
  assert.match(html, /separate sign-in and data boundary/i);
  assert.match(html, /No merchant sync or customer account is created here/);
  assert.doesNotMatch(html, /<iframe|access_token|refresh_token|oai-authenticated-user/);
});

test("the built worker leaves adjacent and existing route ownership intact", async () => {
  const [root, adjacent] = await Promise.all([fetchRoute("/"), fetchRoute("/vanteloqworkspace-extra")]);
  assert.equal(root.status, 200);
  assert.equal(adjacent.status, 404);
  assert.match(adjacent.headers.get("x-robots-tag") ?? "", /noindex/);
});
