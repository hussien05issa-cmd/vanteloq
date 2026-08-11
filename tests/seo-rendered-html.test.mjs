import assert from "node:assert/strict";
import test from "node:test";

const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("seo-test", `${process.pid}-${Date.now()}`);
const { default: worker } = await import(workerUrl.href);

const env = {
  ASSETS: {
    fetch: async () => new Response("Not found", { status: 404 }),
  },
};

const ctx = { waitUntil() {}, passThroughOnException() {} };

async function fetchText(path) {
  const response = await worker.fetch(new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }), env, ctx);
  return { response, text: await response.text() };
}

test("homepage exposes the marketing page in initial HTML", async () => {
  const { response, text } = await fetchText("/");
  assert.equal(response.status, 200);
  assert.match(text, /Understand your business/);
  assert.doesNotMatch(text, />Preparing Vanteloq…</);
  assert.equal((text.match(/<h1\b/g) ?? []).length, 1);
  assert.match(text, /Business Analytics for Independent Retail/);
  assert.match(text, /Lightspeed R-Series/);
  assert.match(text, /href="\/resources\/what-should-small-business-dashboard-show"/);
  assert.match(text, /id="security"/);
  assert.match(text, /<link[^>]+rel="canonical"[^>]+href="https:\/\/vanteloq\.com\/"/i);
  assert.match(text, /"@type":"Organization"/);
});

test("resource index is server rendered with distinct metadata", async () => {
  const { response, text } = await fetchText("/resources");
  assert.equal(response.status, 200);
  assert.match(text, /Make better business decisions with clearer operating data/);
  assert.match(text, /<title>Small Business Operations Resources \| Vanteloq<\/title>/);
  assert.match(text, /href="https:\/\/vanteloq\.com\/resources"/);
  assert.match(text, /How to Track Inventory for a Small Business/);
});

test("article HTML includes content, canonical, article and breadcrumb schemas", async () => {
  const path = "/resources/how-to-track-inventory-small-business";
  const { response, text } = await fetchText(path);
  assert.equal(response.status, 200);
  assert.match(text, /<h1>How to Track Inventory for a Small Business<\/h1>/);
  assert.match(text, /Record every stock movement/);
  assert.match(text, /href="https:\/\/vanteloq\.com\/resources\/how-to-track-inventory-small-business"/);
  assert.match(text, /"@type":"Article"/);
  assert.match(text, /"@type":"BreadcrumbList"/);
  assert.match(text, /Sources and further reading/);
});

test("category, sitemap and robots routes expose canonical crawl paths", async () => {
  const category = await fetchText("/resources/inventory");
  assert.equal(category.response.status, 200);
  assert.match(category.text, /<h1>Inventory<\/h1>/);

  const sitemap = await fetchText("/sitemap.xml");
  assert.equal(sitemap.response.status, 200);
  assert.match(sitemap.text, /https:\/\/vanteloq\.com\/resources\/how-to-track-inventory-small-business/);
  assert.match(sitemap.text, /https:\/\/vanteloq\.com\/resources\/what-should-small-business-dashboard-show/);
  assert.match(sitemap.text, /https:\/\/vanteloq\.com\/resources\/inventory/);
  assert.match(sitemap.text, /https:\/\/vanteloq\.com\/privacy/);
  assert.match(sitemap.text, /https:\/\/vanteloq\.com\/terms/);

  const robots = await fetchText("/robots.txt");
  assert.equal(robots.response.status, 200);
  assert.match(robots.text, /Disallow: \/api\//);
  assert.match(robots.text, /Sitemap: https:\/\/vanteloq\.com\/sitemap\.xml/);
});

test("legal pages are complete, crawlable, and use distinct metadata", async () => {
  const privacy = await fetchText("/privacy");
  assert.equal(privacy.response.status, 200);
  assert.match(privacy.text, /<title>Privacy Policy \| Vanteloq<\/title>/);
  assert.match(privacy.text, /Your information should have a clear purpose/);
  assert.match(privacy.text, /Personal Information Protection Act/);
  assert.match(privacy.text, /href="https:\/\/vanteloq\.com\/privacy"/);

  const terms = await fetchText("/terms");
  assert.equal(terms.response.status, 200);
  assert.match(terms.text, /<title>Terms of Service \| Vanteloq<\/title>/);
  assert.match(terms.text, /The rules for using Vanteloq/);
  assert.match(terms.text, /Governing law and disputes/);

  const cookies = await fetchText("/cookies");
  assert.equal(cookies.response.status, 200);
  assert.match(cookies.text, /<title>Cookie Notice \| Vanteloq<\/title>/);
  assert.match(cookies.text, /does not currently use advertising cookies/i);

  for (const html of [privacy.text, terms.text, cookies.text]) {
    assert.doesNotMatch(html, /\u2014/u, "legal pages should not contain em dashes");
  }
});
