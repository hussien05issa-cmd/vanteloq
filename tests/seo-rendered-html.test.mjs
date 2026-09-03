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
  for (const slug of [
    "how-to-track-inventory-small-business",
    "how-to-calculate-gross-margin-small-business",
    "what-should-small-business-dashboard-show",
    "how-to-analyze-business-data-for-growth",
    "data-analytics-for-small-business",
    "small-business-bookkeeping-system",
  ]) assert.match(text, new RegExp(`href="/resources/${slug}"`));
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
  assert.match(text, /vanteloq-command-ledger\.webp/);
  assert.match(text, /resource-card-image/);
  assert.match(text, /inventory-tracking-editorial-v2\.webp/);
  assert.match(text, /gross-margin-editorial-v2\.webp/);
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

test("new analytics and bookkeeping guides render their metadata, heroes, and schemas", async () => {
  const guides = [
    {
      path: "/resources/how-to-analyze-business-data-for-growth",
      title: "How to Analyze Business Data for Sustainable Growth",
      hero: "scaling-decision-editorial-hero.webp",
      alt: "An editorial still life with a payment terminal, product blocks, customer markers, coins and translucent planning panels.",
    },
    {
      path: "/resources/data-analytics-for-small-business",
      title: "Data Analytics for Small Business: A Practical Guide",
      hero: "vanteloq-command-ledger.webp",
      alt: "Vanteloq command centre showing sales, margin, cash, inventory, purchasing and accountable business decisions in one operating view.",
    },
    {
      path: "/resources/small-business-bookkeeping-system",
      title: "A Practical Bookkeeping System for a Small Business",
      hero: "bookkeeping-month-end-editorial.webp",
      alt: "An editorial bookkeeping still life with source documents, a card reader, a secure connection marker, review tabs and a bound ledger.",
    },
  ];

  for (const guide of guides) {
    const { response, text } = await fetchText(guide.path);
    assert.equal(response.status, 200);
    assert.match(text, new RegExp(`<h1>${guide.title}<\\/h1>`));
    assert.ok(text.includes(guide.hero), `${guide.path} should render its editorial hero`);
    assert.ok(text.includes(guide.alt), `${guide.path} should render descriptive hero text`);
    assert.match(text, new RegExp(`"image":"https://vanteloq\\.com/brand/${guide.hero.replace(".", "\\.")}"`));
    const sectionIds = [...text.matchAll(/<section id="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(new Set(sectionIds).size, sectionIds.length, `${guide.path} section ids should be unique`);
    assert.doesNotMatch(text, /\u2014/u);
  }
});

test("category, sitemap and robots routes expose canonical crawl paths", async () => {
  const category = await fetchText("/resources/inventory");
  assert.equal(category.response.status, 200);
  assert.match(category.text, /<h1>Inventory<\/h1>/);

  const sitemap = await fetchText("/sitemap.xml");
  assert.equal(sitemap.response.status, 200);
  assert.match(sitemap.text, /https:\/\/vanteloq\.com\/resources\/how-to-track-inventory-small-business/);
  assert.match(sitemap.text, /https:\/\/vanteloq\.com\/resources\/what-should-small-business-dashboard-show/);
  assert.match(sitemap.text, /https:\/\/vanteloq\.com\/resources\/how-to-analyze-business-data-for-growth/);
  assert.match(sitemap.text, /https:\/\/vanteloq\.com\/resources\/data-analytics-for-small-business/);
  assert.match(sitemap.text, /https:\/\/vanteloq\.com\/resources\/small-business-bookkeeping-system/);
  assert.match(sitemap.text, /https:\/\/vanteloq\.com\/resources\/inventory/);
  assert.match(sitemap.text, /https:\/\/vanteloq\.com\/privacy/);
  assert.match(sitemap.text, /https:\/\/vanteloq\.com\/terms/);

  const robots = await fetchText("/robots.txt");
  assert.equal(robots.response.status, 200);
  assert.match(robots.text, /Disallow: \/api\//);
  assert.match(robots.text, /Sitemap: https:\/\/vanteloq\.com\/sitemap\.xml/);
  assert.doesNotMatch(robots.text, /^Host:/m);
});

test("unknown routes expose one unambiguous noindex directive", async () => {
  const missing = await fetchText("/this-page-does-not-exist");
  assert.equal(missing.response.status, 404);
  assert.equal((missing.text.match(/name="robots"/g) ?? []).length, 1);
  assert.match(missing.text, /content="noindex/);
  assert.doesNotMatch(missing.text, /content="index, follow"/);
  assert.match(missing.text, /<title>Page not found \| Vanteloq<\/title>/);
  assert.match(missing.text, /<meta property="og:title" content="Page not found \| Vanteloq"\/>/);
  assert.doesNotMatch(missing.text, /<link[^>]+rel="canonical"/);
});

test("resource category metadata uses title capitalization", async () => {
  const analytics = await fetchText("/resources/analytics");
  const ai = await fetchText("/resources/ai");
  const pos = await fetchText("/resources/pos");
  assert.match(analytics.text, /<title>Business Analytics Guides for Small Businesses \| Vanteloq<\/title>/);
  assert.match(ai.text, /<title>AI for Business Guides for Small Businesses \| Vanteloq<\/title>/);
  assert.match(pos.text, /<title>POS Data Guides for Small Businesses \| Vanteloq<\/title>/);
});

test("legal pages are complete, crawlable, and use distinct metadata", async () => {
  const privacy = await fetchText("/privacy");
  assert.equal(privacy.response.status, 200);
  assert.match(privacy.text, /<title>Privacy Policy \| Vanteloq<\/title>/);
  assert.match(privacy.text, /Your information should have a clear purpose/);
  assert.match(privacy.text, /Personal Information Protection Act/);
  assert.match(privacy.text, /read-only data products/);
  assert.match(privacy.text, /applicable CASL exception/);
  assert.match(privacy.text, /href="https:\/\/vanteloq\.com\/privacy"/);

  const terms = await fetchText("/terms");
  assert.equal(terms.response.status, 200);
  assert.match(terms.text, /<title>Terms of Service \| Vanteloq<\/title>/);
  assert.match(terms.text, /The rules for using Vanteloq/);
  assert.match(terms.text, /Governing law and disputes/);
  assert.match(terms.text, /Vanteloq and BookLoQ do not replace/);

  const cookies = await fetchText("/cookies");
  assert.equal(cookies.response.status, 200);
  assert.match(cookies.text, /<title>Cookie Notice \| Vanteloq<\/title>/);
  assert.match(cookies.text, /does not currently use advertising cookies/i);

  for (const html of [privacy.text, terms.text, cookies.text]) {
    assert.doesNotMatch(html, /\u2014/u, "legal pages should not contain em dashes");
  }
});
