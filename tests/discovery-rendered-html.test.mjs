import assert from "node:assert/strict";
import test from "node:test";

const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("discovery-test", `${process.pid}-${Date.now()}`);
const { default: worker } = await import(workerUrl.href);
const env = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
const ctx = { waitUntil() {}, passThroughOnException() {} };
async function page(path) {
  const response = await worker.fetch(new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }), env, ctx);
  return { response, html: await response.text() };
}

test("discovery pages expose distinct crawlable content and correct canonical paths", async () => {
  const titles = new Set();
  for (const path of ["/advisory", "/solutions", "/solutions/dealerships", "/solutions/cafes", "/solutions/restaurants", "/integrations", "/integrations/square", "/integrations/lightspeed-r", "/tools", "/tools/cash-order-planner", "/tools/vehicle-holding-cost", "/about", "/about/editorial"]) {
    const { response, html } = await page(path);
    assert.equal(response.status, 200, path);
    assert.equal((html.match(/<h1\b/g) ?? []).length, 1, `${path} needs one clear H1`);
    assert.ok(html.includes(`href="https://vanteloq.com${path}"`), `${path} canonical missing`);
    assert.ok(html.includes('id="discovery-main"'), `${path} skip-link destination missing`);
    assert.ok(html.includes('aria-label="Colour theme"'), `${path} appearance control missing`);
    assert.doesNotMatch(html, /name="robots" content="noindex/, `${path} should be eligible for indexation`);
    assert.doesNotMatch(html, /aggregateRating|Supplement World|hussienissa@/i, `${path} must not imply customer results or expose owner details`);
    const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
    assert.ok(title, path);
    assert.ok(!titles.has(title), `${path} repeats another page title`);
    titles.add(title);
  }
});

test("connection pages preserve read permissions, series boundaries and review limits", async () => {
  const square = (await page("/integrations/square")).html;
  const lightspeed = (await page("/integrations/lightspeed-r")).html;
  assert.match(square, /INVENTORY_READ/);
  assert.match(square, /CUSTOMERS_READ/);
  assert.match(square, /Ambiguous or custom refunds/);
  assert.match(square, /https:\/\/squareup.com\/ca\/en\/legal\/general\/privacy/);
  assert.match(lightspeed, /employee:register_read/);
  assert.match(lightspeed, /employee:inventory_read/);
  assert.match(lightspeed, /X-Series and Lightspeed Restaurant use different connections/);
  assert.match(lightspeed, /not a promise of instant or continuous/);
  for (const html of [square, lightspeed]) {
    assert.match(html, /"@type":"BreadcrumbList"/);
    assert.match(html, /does not establish|do not establish/);
    assert.match(html, /Fictional merchandise-sales example/);
  }
});

test("empty resource categories remain navigable but are excluded from search eligibility", async () => {
  const sitemap = (await page("/sitemap.xml")).html;
  for (const topic of ["marketing", "ai", "pos"]) {
    const { response, html } = await page(`/resources/${topic}`);
    assert.equal(response.status, 200);
    assert.match(html, /name="robots" content="noindex, follow"/);
    assert.ok(!sitemap.includes(`<loc>https://vanteloq.com/resources/${topic}</loc>`));
  }
  for (const path of ["/advisory", "/solutions/dealerships", "/integrations/square", "/tools/cash-order-planner", "/about/editorial", "/book-demo"]) {
    assert.ok(sitemap.includes(`<loc>https://vanteloq.com${path}</loc>`), path);
  }
});

test("unknown industry and integration slugs cannot publish inherited or prototype records", async () => {
  for (const path of ["/solutions/unknown-sector", "/integrations/__proto__", "/integrations/constructor"]) {
    const { response, html } = await page(path);
    assert.equal(response.status, 404, path);
    assert.match(html, /content="noindex/);
  }
});
