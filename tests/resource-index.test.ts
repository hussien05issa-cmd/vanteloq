import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ResourceArticleBrowser from "../app/resource-article-browser";
import { RESOURCE_ARTICLES, getArticle, getReadingTime } from "../app/resources/content";
import { RESOURCE_ARTICLE_SUMMARIES } from "../app/resources/article-index";

test("lightweight homepage listings stay aligned with the published articles", () => {
  assert.deepEqual(RESOURCE_ARTICLE_SUMMARIES, RESOURCE_ARTICLES.map(article => ({
    slug: article.slug,
    title: article.title,
    description: article.description,
    category: article.category,
    readingTime: getReadingTime(article),
  })), "Update article-index.ts when published article metadata or reading time changes.");
});

test("lightweight listings preserve every resource card and reading time", () => {
  const original = renderToStaticMarkup(createElement(ResourceArticleBrowser, { articles: RESOURCE_ARTICLES }));
  const summary = renderToStaticMarkup(createElement(ResourceArticleBrowser, { articles: RESOURCE_ARTICLE_SUMMARIES }));
  assert.equal(summary, original);
});

test("BookLoQ comparison metadata stays aligned and the public copy keeps the verified boundary", () => {
  const article = getArticle("bookloq-vs-traditional-accounting-software");
  assert.ok(article, "BookLoQ comparison article is missing");
  const summary = RESOURCE_ARTICLE_SUMMARIES.find((item) => item.slug === article.slug);
  assert.deepEqual(summary, {
    slug: article.slug,
    title: article.title,
    description: article.description,
    category: article.category,
    readingTime: getReadingTime(article),
  });

  const publicCopy = JSON.stringify({
    title: article.title,
    description: article.description,
    dek: article.dek,
    quickAnswer: article.quickAnswer,
    sections: article.sections,
  });
  assert.match(publicCopy, /QuickBooks connectivity remains sandbox-only/);
  assert.doesNotMatch(publicCopy, /transaction reconciliation/i);
  assert.doesNotMatch(publicCopy, /\b(?:Xero|Zoho|FreshBooks|Wave|Sage|Digits|Puzzle|A2X|Dext|Ramp|Fathom)\b/i);
  assert.doesNotMatch(publicCopy, /\b(?:BookLoQ is faster|BookLoQ is more accurate|BookLoQ is the best|BookLoQ is better than)\b/i);

  const chart = article.sections.find((section) => section.id === "comparison-chart");
  assert.ok(chart?.table, "BookLoQ comparison chart is missing");
  assert.deepEqual(chart.table.headers, [
    "Capability",
    "BookLoQ today",
    "General accounting software",
    "Commerce settlement tools",
    "Reporting and planning tools",
  ]);
  assert.equal(chart.table.rows.length, 8);
  assert.match(JSON.stringify(chart.table.rows), /13-week forecast/);
  assert.match(JSON.stringify(chart.table.rows), /does not file returns, move money or certify completeness/i);
});
