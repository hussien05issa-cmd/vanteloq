import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import sitemap from "../app/sitemap";
import { absoluteUrl, DEFAULT_SOCIAL_IMAGE, organizationJsonLd } from "../app/seo";
import { SOCIAL_PROFILES } from "../app/social-profiles";
import { RESOURCE_ARTICLES, RESOURCE_CATEGORIES, getArticlesByCategory, getReadingTime } from "../app/resources/content";
import { RESOURCE_ARTICLE_SUMMARIES } from "../app/resources/article-index";
import ResourcesPage from "../app/resources/page";
import ResourceSegmentPage, { generateMetadata } from "../app/resources/[segment]/page";
import AboutPage, { metadata as aboutMetadata } from "../app/about/page";
import EditorialPage, { metadata as editorialMetadata } from "../app/about/editorial/page";

test("organization identity and public profiles describe the actual operator", () => {
  assert.equal(organizationJsonLd.name, "Vanteloq");
  assert.equal(organizationJsonLd.legalName, "Vanteloq Inc.");
  assert.equal(organizationJsonLd.alternateName, "Vanteloq");
  assert.equal(organizationJsonLd.email, "support@vanteloq.com");
  assert.equal(DEFAULT_SOCIAL_IMAGE, "/brand/glass-2026-10-12/vanteloq.jpg");
  assert.equal(organizationJsonLd.logo, absoluteUrl(DEFAULT_SOCIAL_IMAGE));
  assert.deepEqual(organizationJsonLd.sameAs, Object.values(SOCIAL_PROFILES).map(profile => profile.href));
  for (const key of ["aggregateRating", "review", "award", "certification"]) assert.equal(key in organizationJsonLd, false);
});

test("lightweight resource summaries cover the complete published catalogue", () => {
  assert.deepEqual(RESOURCE_ARTICLE_SUMMARIES, RESOURCE_ARTICLES.map(article => ({
    slug: article.slug,
    title: article.title,
    description: article.description,
    category: article.category,
    readingTime: getReadingTime(article),
  })));
  const indexSource = readFileSync(new URL("../app/resources/article-index.ts", import.meta.url), "utf8");
  assert.doesNotMatch(indexSource, /from\s+["']\.\/content["']/);
});

test("empty resource topics are noindexed and absent from the hub and sitemap", async () => {
  const hub = renderToStaticMarkup(createElement(ResourcesPage));
  const urls = new Set(sitemap().map(entry => entry.url));
  for (const category of RESOURCE_CATEGORIES) {
    const populated = getArticlesByCategory(category.slug).length > 0;
    const metadata = await generateMetadata({ params: Promise.resolve({ segment: category.slug }) });
    assert.equal(typeof metadata.robots === "object" ? metadata.robots?.index : undefined, populated);
    assert.equal(urls.has(absoluteUrl(`/resources/${category.slug}`)), populated, category.slug);
    assert.equal(hub.includes(`href="/resources/${category.slug}"`), populated, category.slug);
  }
});

test("sitemap dates come from article records or known new page content", () => {
  const entries = sitemap();
  const byUrl = new Map(entries.map(entry => [entry.url, entry]));
  assert.equal(byUrl.size, entries.length, "Canonical routes must appear once.");
  for (const article of RESOURCE_ARTICLES) {
    assert.equal(byUrl.get(absoluteUrl(`/resources/${article.slug}`))?.lastModified, article.updated);
  }
  for (const path of ["/", "/help", "/pricing", "/contact", "/demo", "/book-demo", "/resources", "/solutions/retail", "/how-it-works", "/legal", "/privacy", "/features/financial-review"]) {
    assert.ok(byUrl.has(absoluteUrl(path)), path);
    assert.equal(byUrl.get(absoluteUrl(path))?.lastModified, undefined, `No established content date for ${path}.`);
  }
  assert.equal(byUrl.get(absoluteUrl("/advisory"))?.lastModified, "2026-10-16");
  assert.equal(byUrl.get(absoluteUrl("/advisory"))?.priority, 0.85);
  assert.deepEqual(byUrl.get(absoluteUrl("/advisory"))?.images, [absoluteUrl("/brand/advisory/vanteloq-advisory-signal-path-1280.webp")]);
  for (const path of ["/solutions", "/solutions/dealerships", "/solutions/cafes", "/solutions/restaurants", "/integrations", "/integrations/square", "/integrations/lightspeed-r", "/tools", "/tools/cash-order-planner", "/tools/vehicle-holding-cost", "/about", "/about/editorial"]) {
    assert.equal(byUrl.get(absoluteUrl(path))?.lastModified, "2026-10-11", path);
  }
});

test("resource bylines link to the editorial method in HTML and metadata", async () => {
  const article = RESOURCE_ARTICLES[0];
  const authorUrl = absoluteUrl("/about/editorial");
  const metadata = await generateMetadata({ params: Promise.resolve({ segment: article.slug }) });
  assert.deepEqual(metadata.authors, [{ name: article.author, url: authorUrl }]);
  const html = renderToStaticMarkup(await ResourceSegmentPage({ params: Promise.resolve({ segment: article.slug }) }));
  assert.match(html, /<a[^>]+href="\/about\/editorial"[^>]*>Vanteloq Editorial Team<\/a>/);
  const jsonLd = Array.from(html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g), match => JSON.parse(match[1]));
  assert.deepEqual(jsonLd.find(item => item["@type"] === "Article")?.author, {
    "@type": "Organization",
    name: article.author,
    url: authorUrl,
  });
});

test("credibility pages disclose the operator and give readers a usable correction route", () => {
  assert.equal(aboutMetadata.alternates?.canonical, "/about");
  assert.equal(editorialMetadata.alternates?.canonical, "/about/editorial");
  for (const Page of [AboutPage, EditorialPage]) {
    const html = renderToStaticMarkup(createElement(Page));
    assert.equal(Array.from(html.matchAll(/<h1(?:\s|>)/g)).length, 1);
    assert.match(html, /<main id="discovery-main"/);
    assert.match(html, /Vanteloq Inc\./);
    assert.doesNotMatch(html, /2855706|LexEdge/i);
    assert.match(html, /href="mailto:support@vanteloq\.com"/);
    assert.match(html, /href="\/contact"/);
    assert.match(html, /<time dateTime="2026-10-11">/);
  }
  const editorial = renderToStaticMarkup(createElement(EditorialPage));
  assert.match(editorial, /AI-assisted writing and editing/);
  assert.match(editorial, /does not certify independent professional review/);
});

test("sector guides connect readers with the relevant workflow and planning tool", async () => {
  const destinations = [
    ["dealership-inventory-aging-carrying-costs", "/solutions/dealerships", "/tools/vehicle-holding-cost"],
    ["cafe-recipe-cost-margin-food-waste", "/solutions/cafes", "/solutions/restaurants"],
    ["retail-inventory-turnover-cash-flow", "/solutions/retail", "/tools/cash-order-planner"],
  ];
  for (const [slug, ...paths] of destinations) {
    const html = renderToStaticMarkup(await ResourceSegmentPage({ params: Promise.resolve({ segment: slug }) }));
    for (const path of paths) assert.ok(html.includes(`href="${path}"`), `${slug} needs ${path}`);
  }
});
