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
  const connections = html.match(/<section class="home-connections"[\s\S]*?<\/section>/)?.[0] ?? "";
  assert.ok(connections, "homepage should render the public connector section");
  assert.doesNotMatch(html, /Start (?:Your )?Free Trial/i);
  for (const provider of ["Lightspeed Retail R-Series", "Lightspeed Retail X-Series", "Square", "Moneris", "QuickBooks", "Xero", "Plaid", "Google", "Meta"]) assert.match(connections, new RegExp(`<strong>${provider}</strong>`));
  for (const provider of ["DoorDash", "Uber Eats"]) assert.match(connections, new RegExp(`<strong>${provider}</strong>[\\s\\S]*?Coming soon`));
  assert.match(connections, /QuickBooks[\s\S]*?Sandbox only/);
  assert.match(connections, /Plaid[\s\S]*?Production approval needed/);
  assert.match(connections, /Xero[\s\S]*?In development/);
  assert.match(connections, /Stripe[\s\S]*?Setup required/);
  assert.match(connections, /Connect the tools that already run your business/);
  assert.match(connections, /Use owner-authorized balances and transactions in cash planning/);
  assert.doesNotMatch(connections, /(?:AVAILABLE NOW|PRODUCTION READY|FULLY CONNECTED|honest availability)/i);
  assert.doesNotMatch(html, /\b(?:SOC 2|ISO 27001|HIPAA|PCI)\s+(?:certified|compliant|accredited)\b/i);
  assert.doesNotMatch(html, /\u2014/u, "homepage prose should not contain an em dash");
  assert.match(html, /home-intelligence-map/);
  assert.match(html, /home-resource-art/);
  assert.doesNotMatch(html, /ILLUSTRATIVE WORKFLOW|Illustrative inventory decision workflow/i);
  assert.match(html, /connect-import-visual\.webp/);
  assert.match(html, /verify-organize-visual\.webp/);
  assert.match(html, /home-record-review/);
  assert.match(html, /Ready for owner review/);
  assert.match(html, /Sources synchronized/);
  assert.match(html, /Receipt 1458/);
  assert.match(html, /Example values show how Vanteloq/);
  assert.match(html, /inventory-decision-visual\.webp/);
  assert.match(html, /href="\/privacy"/);
  assert.match(html, /href="\/terms"/);
  assert.match(html, /href="\/cookies"/);
  assert.match(html, /Vanteloq is a LexEdge Consulting product/);
  assert.match(html, /Vanteloq is owned and operated by LexEdge Consulting/);
  assert.match(html, /lexedge-consulting-logo-web\.png/);
  assert.match(html, /Can I delete my account and data\?/);
  assert.match(html, /Is Vanteloq a replacement for an accountant or legal adviser\?/);
  assert.match(html, /What happens after you create an account/);
  assert.match(html, /IMPLEMENTED SECURITY CONTROLS/);
  assert.doesNotMatch(html, /VERIFIED SECURITY CONTROLS/);
});

test("homepage omits the former independent retail label", async () => {
  const html = await (await fetchRoute("/")).text();
  assert.doesNotMatch(html, /Operations and analytics for independent retail/);
  assert.doesNotMatch(html, /<span class="public-pill">/);
});

test("homepage sequence labels do not use leading zeroes", async () => {
  const html = await (await fetchRoute("/")).text();
  const platform = html.match(/<section class="home-platform"[\s\S]*?<\/section>/)?.[0] ?? "";
  const capabilities = html.match(/<section class="home-capabilities"[\s\S]*?<\/section>/)?.[0] ?? "";
  const gemini = html.match(/<section class="home-gemini"[\s\S]*?<\/section>/)?.[0] ?? "";

  assert.ok(platform, "homepage should render the platform sequence");
  assert.ok(capabilities, "homepage should render the capability sequence");
  assert.ok(gemini, "homepage should render the Gemini evidence sequence");
  assert.match(platform, /<b>1<\/b>/);
  assert.match(platform, /<b>2<\/b>/);
  assert.match(platform, /<b>3<\/b>/);
  assert.match(gemini, /<b>1<\/b>/);
  assert.match(gemini, /<b>2<\/b>/);
  assert.match(gemini, /<b>3<\/b>/);
  for (const number of [1, 2, 3, 4, 5, 6]) assert.match(capabilities, new RegExp(`<small>${number}<\\/small>`));
  assert.doesNotMatch(`${platform}${capabilities}${gemini}`, />(?:01|02|03|04|05|06)</);
});

test("resource research links use current official guidance", async () => {
  const content = await readFile(new URL("../app/resources/content.ts", import.meta.url), "utf8");

  assert.match(content, /support\.google\.com\/webmasters\/answer\/7576553\?hl=en/);
  assert.match(content, /canada\.ca\/en\/revenue-agency\/services\/tax\/businesses\/topics\/sole-proprietorships-partnerships\/business-expenses\.html/);
  assert.doesNotMatch(content, /support\.google\.com\/webmasters\/answer\/17010961/);
  assert.doesNotMatch(content, /small-businesses-self-employed-income\/business-income-tax-reporting\/business-expenses\/what-business-expenses\.html/);
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
  assert.match(source, /function FeatureReelStage/);
  assert.match(source, /Illustrative interface/);
  assert.doesNotMatch(source, /vanteloq-feature-reel-v1\.webp/);
  assert.match(source, /Pause feature tour/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(source, /className="tour-focus/);
  assert.match(css, /\.home-connection-grid \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.home-capabilities,\s*\.home-gemini,\s*\.home-product-family/);
  assert.match(css, /@media \(max-width: 1050px\)[\s\S]*?\.home-gemini-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*?\.home-gemini-grid \{ grid-template-columns: 1fr/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(source, /public-nav-mobile-actions/);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*?\.public-nav\s*>\s*\.public-nav-actions\s*\{\s*display:\s*none/);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*?\.public-nav-mobile-actions\s*\{\s*display:\s*grid/);
  assert.match(css, /\.home-connection-grid article > div \.home-connection-status[\s\S]{0,260}font-size:\s*12px/);
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
  assert.match(resources, /resource-card-image/);
  assert.match(resources, /inventory-tracking-editorial-v2\.webp/);
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
  const [connect, verify, decision, method, inventory, margin, dashboard, growth, bookkeeping] = await Promise.all([
    stat(new URL("../public/brand/connect-import-visual.webp", import.meta.url)),
    stat(new URL("../public/brand/verify-organize-visual.webp", import.meta.url)),
    stat(new URL("../public/brand/inventory-decision-visual.webp", import.meta.url)),
    stat(new URL("../public/brand/resource-method-visual.webp", import.meta.url)),
    stat(new URL("../public/brand/inventory-tracking-editorial-v2.webp", import.meta.url)),
    stat(new URL("../public/brand/gross-margin-editorial-v2.webp", import.meta.url)),
    stat(new URL("../public/brand/dashboard-measures-editorial-v2.webp", import.meta.url)),
    stat(new URL("../public/brand/scaling-decision-editorial-hero.webp", import.meta.url)),
    stat(new URL("../public/brand/bookkeeping-month-end-editorial.webp", import.meta.url)),
  ]);
  assert.ok(connect.size < 160_000, `connect illustration should stay below 160 KB, received ${connect.size}`);
  assert.ok(verify.size < 160_000, `verify illustration should stay below 160 KB, received ${verify.size}`);
  assert.ok(decision.size < 160_000, `decision illustration should stay below 160 KB, received ${decision.size}`);
  assert.ok(method.size < 160_000, `method illustration should stay below 160 KB, received ${method.size}`);
  for (const [name, asset] of Object.entries({ inventory, margin, dashboard, growth, bookkeeping })) {
    assert.ok(asset.size < 160_000, `${name} article image should stay below 160 KB, received ${asset.size}`);
  }
});

test("the supplied LexEdge ownership mark is present and web ready", async () => {
  const asset = await stat(new URL("../public/brand/lexedge-consulting-logo-web.png", import.meta.url));
  assert.ok(asset.size < 100_000, `LexEdge logo should stay below 100 KB, received ${asset.size}`);
});
