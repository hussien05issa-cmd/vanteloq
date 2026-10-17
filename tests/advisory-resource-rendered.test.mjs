import assert from "node:assert/strict";
import test from "node:test";

const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("advisory-resource-test", `${process.pid}-${Date.now()}`);
const { default: worker } = await import(workerUrl.href);
const env = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
const ctx = { waitUntil() {}, passThroughOnException() {} };
const origin = "https://vanteloq.com";
const fetchPage = (path) => worker.fetch(new Request(`${origin}${path}`, { headers: { accept: "text/html" } }), env, ctx);

const migratedSlugs = [
  "calculate-break-even-point",
  "customer-acquisition-cost-and-lifetime-value",
  "marketing-strategy-that-drives-growth",
  "how-much-should-a-business-spend-on-marketing",
  "improve-website-conversion-rate",
  "marketing-channels-that-are-working",
  "business-systems-before-scaling",
  "repeatable-sales-process",
  "retail-inventory-turnover-sell-through-gmroi",
  "retail-standard-operating-procedures",
  "customer-journey-audit-for-small-business",
  "vanteloq-retail-analytics-how-it-works",
  "vanteloq-ai-business-data-and-privacy",
  "bookloq-accounting-and-cash-flow-planning",
  "retail-founder-perspective-business-intelligence",
];

test("migrated resources render once in the Vanteloq sitemap", async () => {
  const response = await fetchPage("/sitemap.xml");
  const xml = await response.text();
  assert.equal(response.status, 200);
  for (const slug of migratedSlugs) {
    const url = `${origin}/resources/${slug}`;
    assert.equal(xml.split(`<loc>${url}</loc>`).length - 1, 1, slug);
  }
});

test("representative migrated guides render self-canonicals and current brand paths", async () => {
  for (const slug of [
    "calculate-break-even-point",
    "vanteloq-ai-business-data-and-privacy",
    "retail-founder-perspective-business-intelligence",
  ]) {
    const response = await fetchPage(`/resources/${slug}`);
    const html = await response.text();
    assert.equal(response.status, 200, slug);
    assert.match(html, new RegExp(`<link rel="canonical" href="${origin}/resources/${slug}"`), slug);
    assert.match(html, /"@type":"Article"/, slug);
    assert.match(html, /href="\/advisory#contact">Talk to an Advisor/, slug);
    assert.match(html, /href="\/how-it-works"[^>]*>Explore Workspace/, slug);
    assert.doesNotMatch(html, /VantaTalk/i, slug);
    assert.doesNotMatch(html, /Vanteloq is Lexedge/i, slug);
  }
});

test("founder resource exposes Hussien Issa as a person author", async () => {
  const response = await fetchPage("/resources/retail-founder-perspective-business-intelligence");
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /Written by<\/dt><dd><a href="\/advisory#team">Hussien Issa<\/a>/);
  assert.match(html, /"@type":"Person","name":"Hussien Issa"/);
  assert.match(html, /started a retail business with his brother and helped scale it/i);
});
