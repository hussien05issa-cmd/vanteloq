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
  for (const slug of ["how-to-analyze-business-data-for-growth", "small-business-bookkeeping-system", "small-business-cash-flow-management-guide"]) {
    const article = getArticle(slug);
    assert.ok(article, `${slug} is missing`);
    assert.ok(article.hero, `${slug} needs its generated editorial hero`);
  }
});

test("data analytics guide answers small business search intent with research depth", () => {
  const article = getArticle("data-analytics-for-small-business");
  assert.ok(article, "data analytics guide is missing");
  assert.equal(article.title, "Data Analytics for Small Business: A Practical Guide");
  assert.equal(article.category, "analytics");
  assert.match(article.description.toLowerCase(), /data analytics/);
  assert.match(article.quickAnswer.toLowerCase(), /small business/);
  assert.ok(article.sections.length >= 8, "data analytics guide needs a complete implementation path");
  assert.ok(article.sources.length >= 5, "data analytics guide needs a broad research base");
  assert.ok(article.related.length >= 3, "data analytics guide needs useful internal links");
  assert.equal(article.hero?.src, "/brand/vanteloq-command-ledger.webp");

  const articleWords = [
    article.dek,
    article.quickAnswer,
    ...article.sections.flatMap((section) => [
      section.heading,
      ...(section.paragraphs ?? []),
      ...(section.bullets ?? []),
      ...(section.numbered ?? []),
      section.formula?.example ?? "",
      section.callout?.body ?? "",
      ...(section.table?.rows.flat() ?? []),
    ]),
  ].join(" ").trim().split(/\s+/).length;
  assert.ok(articleWords >= 1_600, `data analytics guide is too brief at ${articleWords} words`);
});

test("resource catalogue preserves one canonical route namespace", () => {
  const categories = new Set(RESOURCE_CATEGORIES.map((category) => category.slug));
  for (const article of RESOURCE_ARTICLES) {
    assert.ok(!categories.has(article.slug as never), `${article.slug} collides with a category route`);
  }
});

test("homepage links the published catalogue through the shared article browser", () => {
  const homepage = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const browser = readFileSync(new URL("../app/resource-article-browser.tsx", import.meta.url), "utf8");
  assert.ok(homepage.includes("<ResourceArticleBrowser articles={RESOURCE_ARTICLE_SUMMARIES}"));
  assert.ok(browser.includes("getCategory(article.category)"));
  assert.ok(browser.includes("getReadingTime(article)"));
});
