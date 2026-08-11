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
  for (const provider of ["Square", "Moneris", "QuickBooks", "Xero"]) {
    assert.match(html, new RegExp(`<strong>${provider}</strong>[\\s\\S]{0,180}<small>PLANNED</small>`));
  }
  assert.match(html, /<strong>Plaid<\/strong>[\s\S]{0,220}<small>ADAPTER BUILT<\/small>/);
  assert.match(html, /Plaid still requires approved production credentials/);
  for (const provider of ["Google", "Meta"]) {
    assert.match(html, new RegExp(`<strong>${provider}</strong>[\\s\\S]{0,220}<small>COMING SOON!</small>`));
  }
  assert.doesNotMatch(html, /(?:Square|Moneris|QuickBooks|Xero|Plaid|Google|Meta) (?:is )?(?:connected|available now|live)/i);
  assert.doesNotMatch(html, /\b(?:SOC 2|ISO 27001|HIPAA|PCI)\s+(?:certified|compliant|accredited)\b/i);
  assert.match(html, /Lightspeed R-Series/);
  assert.match(html, /LIMITED PILOT/);
  assert.match(html, /STAGING/);
  assert.match(html, /PLANNED/);
  assert.doesNotMatch(html, /\u2014/u, "homepage prose should not contain an em dash");
  assert.match(html, /home-intelligence-map/);
  assert.match(html, /home-resource-art/);
  assert.doesNotMatch(html, /ILLUSTRATIVE WORKFLOW|Illustrative inventory decision workflow/i);
  assert.match(html, /connect-import-visual\.webp/);
  assert.match(html, /verify-organize-visual\.webp/);
  assert.match(html, /business-sources-visual\.webp/);
  assert.match(html, /inventory-decision-visual\.webp/);
  assert.match(html, /href="\/privacy"/);
  assert.match(html, /href="\/terms"/);
  assert.match(html, /href="\/cookies"/);
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
  assert.match(css, /\.home-connection-grid \{ display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(css, /\.public-nav-actions\s+\.nav-login\s*\{\s*display:\s*none/);
  assert.match(css, /\.public-nav-actions\s+\.nav-login\s*\{[\s\S]*?display:\s*inline-flex/);
});

test("homepage and resource cards keep the hosted visual layout", async () => {
  const [homepageResponse, resourcesResponse, homepageCss, resourcesCss] = await Promise.all([
    fetchRoute("/"),
    fetchRoute("/resources"),
    readFile(new URL("../app/homepage.css", import.meta.url), "utf8"),
    readFile(new URL("../app/resources/resources.css", import.meta.url), "utf8"),
  ]);
  assert.equal(homepageResponse.status, 200);
  assert.equal(resourcesResponse.status, 200);
  const [homepage, resources] = await Promise.all([
    homepageResponse.text(),
    resourcesResponse.text(),
  ]);

  assert.match(homepage, /home-resource-art/);
  assert.doesNotMatch(homepage, /home-resource-thumbnail/);
  assert.match(resources, /resource-visual/);
  assert.doesNotMatch(resources, /resource-card-hero/);
  assert.match(homepageCss, /\.home-proof li::before[^}]*content:\s*"✓"/);
  assert.match(homepageCss, /\.home-step-review-visual::after[^}]*content:\s*"✓"/);
  assert.match(homepageCss, /\.home-resource-grid \{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(homepageCss, /\.home-resource-grid[^}]*repeat\(6, minmax\(0, 1fr\)\)/);
  assert.match(resourcesCss, /\.resource-latest \.resource-card-grid \{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(resourcesCss, /\.resource-latest \.resource-card-grid[^}]*repeat\(6, minmax\(0, 1fr\)\)/);
});

test("the above-the-fold product image is compact and dimensioned", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const image = await stat(new URL("../public/brand/vanteloq-command-ledger.webp", import.meta.url));
  assert.ok(image.size < 100_000, `product image should stay below 100 KB, received ${image.size}`);
  assert.match(source, /vanteloq-command-ledger\.webp/);
  assert.match(source, /width=\{1487\} height=\{1058\}/);
  assert.match(source, /fetchPriority="high"/);
});

test("generated editorial visuals stay compact and production-ready", async () => {
  const [connect, verify, sources, decision, method] = await Promise.all([
    stat(new URL("../public/brand/connect-import-visual.webp", import.meta.url)),
    stat(new URL("../public/brand/verify-organize-visual.webp", import.meta.url)),
    stat(new URL("../public/brand/business-sources-visual.webp", import.meta.url)),
    stat(new URL("../public/brand/inventory-decision-visual.webp", import.meta.url)),
    stat(new URL("../public/brand/resource-method-visual.webp", import.meta.url)),
  ]);
  assert.ok(connect.size < 160_000, `connect illustration should stay below 160 KB, received ${connect.size}`);
  assert.ok(verify.size < 160_000, `verify illustration should stay below 160 KB, received ${verify.size}`);
  assert.ok(sources.size < 160_000, `source illustration should stay below 160 KB, received ${sources.size}`);
  assert.ok(decision.size < 160_000, `decision illustration should stay below 160 KB, received ${decision.size}`);
  assert.ok(method.size < 160_000, `method illustration should stay below 160 KB, received ${method.size}`);
});
