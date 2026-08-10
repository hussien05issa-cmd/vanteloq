import assert from "node:assert/strict";
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
  }
});

test("resource catalogue preserves one canonical route namespace", () => {
  const categories = new Set(RESOURCE_CATEGORIES.map((category) => category.slug));
  for (const article of RESOURCE_ARTICLES) {
    assert.ok(!categories.has(article.slug as never), `${article.slug} collides with a category route`);
  }
});
