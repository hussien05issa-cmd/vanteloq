import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Home from "../app/page";
import PublicFooter from "../app/public-footer";

const homepage = renderToStaticMarkup(createElement(Home));
const header = homepage.slice(homepage.indexOf('<header class="public-nav"'), homepage.indexOf('</header>', homepage.indexOf('<header class="public-nav"')));
const sharedNavigation = readFileSync(new URL("../app/public-page-nav.tsx", import.meta.url), "utf8");
const sharedFooter = readFileSync(new URL("../app/public-footer.tsx", import.meta.url), "utf8");

test("the mobile disclosure identifies both navigation and account destinations without an expanded initial state", () => {
  assert.match(header, /class="public-nav-menu"/);
  assert.match(header, /aria-label="Open navigation menu"/);
  assert.match(header, /aria-expanded="false"/);
  assert.match(header, /aria-controls="public-navigation public-account-actions"/);
  assert.match(header, /id="public-navigation" aria-label="Main navigation"/);
  assert.match(header, /id="public-account-actions"/);
});

test("the header prioritizes product, pricing and account actions while secondary destinations remain on the page", () => {
  for (const href of ["/how-it-works", "/workspace", "/advisory", "/pricing", "/book-demo"]) assert.ok(header.includes(`href="${href}"`), href);
  for (const label of ["Sign in", "Build your dashboard"]) assert.ok(header.includes(label), label);
  for (const label of ["Instagram", "YouTube", "TikTok", "Facebook"]) assert.ok(homepage.includes(label), label);
  assert.ok(homepage.includes('href="/demo"'));
  assert.doesNotMatch(header, /public-nav-socials/);
  assert.match(header, /data-public-event="pricing_view"/);
  assert.match(header, /data-public-event="signup_start"/);
  assert.doesNotMatch(header, /Business analytics by LexEdge Consulting/);
});

test("shared public navigation promotes Workspace and Advisory while keeping connections in Resources", () => {
  assert.match(sharedNavigation, /href="\/workspace"/);
  assert.match(sharedNavigation, /path === "\/workspace" \? "page"/);
  assert.match(sharedNavigation, /href="\/advisory"/);
  assert.match(sharedNavigation, /path === "\/advisory" \? "page"/);
  assert.match(sharedNavigation, /href="\/#connections"/);
  assert.match(sharedNavigation, />Connections & integrations</);
  assert.match(sharedNavigation, /data-public-event=\{primaryAction \? undefined : "signup_start"\}/);
  assert.doesNotMatch(sharedNavigation, /demo_booking_start/);
});

test("shared public shell logos pin deterministic SVG fragment prefixes", () => {
  assert.match(sharedNavigation, /svgIdPrefix="public-navigation-vanteloq"/);
  assert.match(sharedFooter, /svgIdPrefix="public-footer-vanteloq"/);
});

test("public polish preserves the source principle and business overview heading", () => {
  assert.match(homepage, /<span class="sr-only">A number without a source is a rumour\.<\/span>/);
  assert.match(homepage, /<h1 id="home-title">Your business, <em>at a glance\.<\/em><\/h1>/);
  assert.doesNotMatch(homepage, /Retail\. Dealerships\. Cafés\. Restaurants\./);
});

test("both public footers identify Vanteloq Inc. and use the supplied parent artwork", () => {
  const footer = renderToStaticMarkup(createElement(PublicFooter));
  assert.doesNotMatch(footer, /Motion:/);
  assert.doesNotMatch(homepage, /Motion (?:on|off)|Reduced motion/);
  assert.match(footer, /href="\/workspace"/);
  for (const html of [homepage, footer]) {
    assert.match(html, /Vanteloq Inc\./);
    assert.match(html, /aria-label="Vanteloq logo"/);
    assert.match(html, /href="\/brand\/glass-2026-10-12\/vanteloq\.jpg"/);
    assert.match(html, /href="\/advisory"/);
    assert.doesNotMatch(html, /lexedge/i);
  }
});
