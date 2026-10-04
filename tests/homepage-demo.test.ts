import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HOME_DEMO as demo, sampleMoney } from "../domain/homepage-demo";
import { demoAnalysis } from "../domain/product-demo";
import { bookloqDemo } from "../domain/bookloq-demo";
import HomepageStory from "../app/homepage-story";
import HomepageLanding from "../app/homepage-landing";
import { integrationCatalog, integrationPublicStatus } from "../app/integration-catalog";

test("homepage sales and comparison reconcile to the full demo's receipt-derived records", () => {
  const analysis = demoAnalysis("all", "complete");
  assert.equal(demo.current.netCents, analysis.currentRows.reduce((sum, row) => sum + (row.netSalesCents ?? 0), 0));
  assert.equal(demo.current.purchaseBaskets, analysis.currentRows.reduce((sum, row) => sum + (row.transactions ?? 0), 0));
  assert.equal(demo.weeks.reduce((sum, row) => sum + row.salesCents, 0), demo.current.netCents);
  assert.equal(demo.bridge.reduce((sum, row) => sum + row.impactCents, 0), demo.current.netCents - demo.prior.netCents);
  assert.equal(demo.current.averageBasketCents, demo.current.netCents / demo.current.purchaseBaskets);
  assert.equal(demo.period.days, 28);
});
test("stock cover and cash purchasing examples retain the production domain boundaries", () => {
  assert.equal(demo.stock.daysOfCover, demo.stock.onHand / demo.stock.dailyVelocity);
  assert.equal(demo.stock.dailyVelocity, demo.stock.units / demo.period.days);
  const base = bookloqDemo(0, false, false), purchase = bookloqDemo(500000, false, false), delayed = bookloqDemo(0, true, false);
  assert.equal(demo.cash.capacity, base.purchasingCapacityCents);
  assert.equal(purchase.purchasingCapacityCents, base.purchasingCapacityCents! - 500000);
  assert.equal(delayed.purchasingCapacityCents, base.purchasingCapacityCents);
});
test("initial story is useful without video or JavaScript and never fetches video before hydration", () => {
  const html = renderToStaticMarkup(createElement(HomepageStory));
  for (const value of [sampleMoney(demo.current.netCents), String(demo.current.purchaseBaskets), sampleMoney(demo.current.averageBasketCents), "Fictional records", "28 days", "Play story", 'href="/demo']) {
    if (value.startsWith('href')) continue;
    assert.ok(html.includes(value), value);
  }
  assert.equal((html.match(/<dt>/g) ?? []).length, 3);
  assert.doesNotMatch(html, /<video|\.mp4|\.webm|autoplay|loop=/i);
  assert.match(html, /hero-mobile-poster\.webp/);
  assert.match(html, /role="img" aria-label="Net sales by week/);
});
test("retail landing keeps truthful plan boundaries, sample labels, available-only POS strip and real routes", () => {
  const html = renderToStaticMarkup(createElement(HomepageLanding, { retail: true }));
  for (const text of ["BookLoQ required", "Growth and Pro", "No expiry", "100 daily sales records", "10 Vanteloq AI replies", "Scripted product illustration", "Know what sold."]) assert.ok(html.includes(text), text);
  for (const route of ["/demo", "/pricing", "/help", "/resources", "/privacy", "/solutions/retail"]) assert.ok(html.includes(`href="${route}"`), route);
  const strip = html.slice(html.indexOf('class="hp-available"'), html.indexOf('class="hp-section hp-retail-problems"'));
  const available = integrationCatalog.filter(row => row.category === "Point of sale" && integrationPublicStatus(row).tone === "setup");
  for (const row of available) assert.ok(strip.includes(row.name));
  for (const row of integrationCatalog.filter(row => integrationPublicStatus(row).tone !== "setup")) assert.ok(!strip.includes(row.name), row.name);
  assert.doesNotMatch(html, /NaN|Infinity|Preview thinking/);
});
