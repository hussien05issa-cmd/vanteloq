import assert from "node:assert/strict";
import test from "node:test";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("does not render development preview metadata", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  assert.doesNotMatch(await response.text(), developmentPreviewMeta);
});

test("self-service deletion pages render without authentication and are not indexable", async () => {
  const { default: worker } = await import(new URL("../dist/server/index.js", import.meta.url).href);
  for (const [path, heading] of [["/account/deletion", "Vanteloq account deletion"], ["/account/deletion-status", "Your deletion status"]]) {
    const response = await worker.fetch(new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
      { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(response.status, 200, path);
    const html = await response.text();
    assert.ok(html.includes(heading), path);
    assert.match(html, /<meta[^>]+name="robots"[^>]+content="noindex,\s*nofollow"/);
    assert.match(html, /<meta[^>]+name="referrer"[^>]+content="no-referrer"/);
    assert.doesNotMatch(html, /"token":"[a-f0-9]{64}"/);
  }
});
