import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  RESOURCE_ARTICLES,
  RESOURCE_CATEGORIES,
  getArticle,
  getReadingTime,
} from "../app/resources/content.ts";

test("resource catalogue uses unique, stable and internally valid records", () => {
  assert.equal(new Set(RESOURCE_ARTICLES.map((article) => article.slug)).size, RESOURCE_ARTICLES.length);
  assert.equal(new Set(RESOURCE_ARTICLES.map((article) => article.seoTitle)).size, RESOURCE_ARTICLES.length);
  assert.equal(new Set(RESOURCE_ARTICLES.map((article) => article.description)).size, RESOURCE_ARTICLES.length);

  const categorySlugs = new Set(RESOURCE_CATEGORIES.map((category) => category.slug));
  for (const article of RESOURCE_ARTICLES) {
    assert.match(article.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(article.seoTitle.length <= 70, `${article.slug} SEO title is too long`);
    assert.ok(article.description.length >= 120 && article.description.length <= 165, `${article.slug} description should be search-result ready`);
    assert.ok(categorySlugs.has(article.category), `${article.slug} has an unknown category`);
    assert.ok(getReadingTime(article) >= 3, `${article.slug} is too thin to publish`);
    assert.ok(article.sections.length >= 5, `${article.slug} needs enough structure to answer the query`);
    assert.ok(article.sources.length >= 2, `${article.slug} needs credible further reading`);
    for (const source of article.sources) assert.match(source.url, /^https:\/\//);
    for (const related of article.related) assert.ok(getArticle(related), `${article.slug} links to missing related article ${related}`);
    assert.doesNotMatch(JSON.stringify(article), /\u2014/, `${article.slug} contains an em dash`);
    assert.ok(article.hero, `${article.slug} needs its generated editorial hero`);
    assert.match(article.hero.src, /^\/brand\/[a-z0-9-]+\.(?:png|webp)$/);
    assert.ok(article.hero.alt.length >= 40, `${article.slug} hero needs useful alternative text`);
    assert.ok(article.hero.width >= 1200 && article.hero.height >= 600, `${article.slug} hero is too small for social sharing`);
    assert.ok(existsSync(new URL(`../public${article.hero.src}`, import.meta.url)), `${article.slug} hero file is missing`);
  }
});

test("requested analytics and bookkeeping guides are published with article heroes", () => {
  for (const slug of ["how-to-analyze-business-data-for-growth", "small-business-bookkeeping-system"]) {
    const article = getArticle(slug);
    assert.ok(article, `${slug} is missing`);
    assert.ok(article.hero, `${slug} needs its generated editorial hero`);
  }
});

test("resource catalogue preserves one canonical route namespace", () => {
  const categories = new Set(RESOURCE_CATEGORIES.map((category) => category.slug));
  for (const article of RESOURCE_ARTICLES) {
    assert.ok(!categories.has(article.slug as never), `${article.slug} collides with a category route`);
  }
});

test("homepage resource cards are rendered from the published catalogue", () => {
  const homepage = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(homepage, /RESOURCE_ARTICLES\.map\(\(article\)/);
  assert.match(homepage, /getCategory\(article\.category\)/);
  assert.match(homepage, /getReadingTime\(article\)/);
  assert.doesNotMatch(homepage, /(?:INVENTORY|FINANCE|ANALYTICS) · \d+ MIN/);
});
