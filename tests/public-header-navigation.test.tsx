import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Home from "../app/page";
import PublicFooter from "../app/public-footer";

const homepage = renderToStaticMarkup(createElement(Home));
const header = homepage.slice(homepage.indexOf('<header class="public-nav"'), homepage.indexOf('</header>', homepage.indexOf('<header class="public-nav"')));

test("the mobile disclosure identifies both navigation and account destinations without an expanded initial state", () => {
  assert.match(header, /class="public-nav-menu"/);
  assert.match(header, /aria-label="Open navigation menu"/);
  assert.match(header, /aria-expanded="false"/);
  assert.match(header, /aria-controls="public-navigation public-account-actions"/);
  assert.match(header, /id="public-navigation" aria-label="Main navigation"/);
  assert.match(header, /id="public-account-actions"/);
});

test("all public navigation, social destinations and account actions remain reachable in the header", () => {
  for (const href of ["/how-it-works", "#connections", "/demo", "/pricing", "/help", "/book-demo", "#social"]) assert.ok(header.includes(`href="${href}"`), href);
  for (const label of ["Sign in", "Create a workspace", "Instagram", "YouTube", "TikTok", "Facebook"]) assert.ok(header.includes(label), label);
  assert.match(header, /data-public-event="pricing_view"/);
  assert.match(header, /data-public-event="signup_start"/);
  assert.doesNotMatch(header, /Business analytics by LexEdge Consulting/);
});

test("public polish preserves the source principle and business overview heading", () => {
  assert.match(homepage, /<span class="sr-only">A number without a source is a rumour\.<\/span>/);
  assert.match(homepage, /<h1 id="home-title">Your business, <em>at a glance\.<\/em><\/h1>/);
  assert.match(homepage, /Retail\. Dealerships\. Cafés\. Restaurants\./);
});

test("both public footers display the supplied LexEdge artwork through the shared full-logo component", () => {
  const footer = renderToStaticMarkup(createElement(PublicFooter));
  for (const html of [homepage, footer]) {
    assert.match(html, /product-brand-artwork lexedge full/);
    assert.match(html, /aria-label="LexEdge Consulting logo"/);
    assert.match(html, /href="\/brand\/origin-metal-2026\/lexedge\.jpg"/);
    assert.doesNotMatch(html, /lexedge-consulting-logo-web\.png/);
  }
});
