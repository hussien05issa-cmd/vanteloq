import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("homepage-quality", `${process.pid}-${Date.now()}`);
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

test("homepage keeps every crawlable internal link on a working route", async () => {
  const response = await fetchRoute("/");
  assert.equal(response.status, 200);
  const html = await response.text();
  const internalLinks = new Set(
    [...html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)]
      .map((match) => match[1])
      .filter((href) => href.startsWith("/") && !href.startsWith("/#")),
  );

  assert.ok(internalLinks.size >= 7, "homepage should expose meaningful crawlable internal links");
  for (const href of internalLinks) {
    const linked = await fetchRoute(href);
    assert.equal(linked.status, 200, `${href} should return a successful HTML response`);
  }
});

test("homepage copy stays within the verified product boundary", async () => {
  const html = await (await fetchRoute("/")).text();
  assert.doesNotMatch(html, /Start (?:Your )?Free Trial/i);
  assert.doesNotMatch(html, /\b(?:Square|Moneris|QuickBooks|Xero|Plaid|Google Ads|Meta Ads)\b/);
  assert.doesNotMatch(html, /\b(?:SOC 2|ISO 27001|HIPAA|PCI)\s+(?:certified|compliant|accredited)\b/i);
  assert.match(html, /Lightspeed R-Series/);
  assert.match(html, /LIMITED PILOT/);
  assert.match(html, /STAGING/);
});

test("homepage preserves responsive and keyboard interaction safeguards", async () => {
  const [source, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/homepage.css", import.meta.url), "utf8"),
  ]);

  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /aria-label=\{mobileNavOpen \? "Close navigation menu" : "Open navigation menu"\}/);
  assert.match(css, /overflow-x:\s*clip/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /@media \(max-width: 390px\)/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("the above-the-fold product image is compact and dimensioned", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const image = await stat(new URL("../public/brand/vanteloq-command-ledger.webp", import.meta.url));
  assert.ok(image.size < 100_000, `product image should stay below 100 KB, received ${image.size}`);
  assert.match(source, /vanteloq-command-ledger\.webp/);
  assert.match(source, /width=\{1487\} height=\{1058\}/);
  assert.match(source, /fetchPriority="high"/);
});
