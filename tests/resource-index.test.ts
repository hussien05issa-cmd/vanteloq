import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ResourceArticleBrowser from "../app/resource-article-browser";
import { getArticle, getReadingTime } from "../app/resources/content";
import { RESOURCE_ARTICLE_SUMMARIES } from "../app/resources/article-index";

test("lightweight homepage listings stay aligned with the published articles", () => {
  assert.deepEqual(RESOURCE_ARTICLE_SUMMARIES, RESOURCE_ARTICLE_SUMMARIES.map(summary => getArticle(summary.slug)!).map(article => ({
    slug: article.slug,
    title: article.title,
    description: article.description,
    category: article.category,
    readingTime: getReadingTime(article),
  })), "Update article-index.ts when published article metadata or reading time changes.");
});

test("lightweight listings preserve every resource card and reading time", () => {
  const original = renderToStaticMarkup(createElement(ResourceArticleBrowser, { articles: RESOURCE_ARTICLE_SUMMARIES.map(summary => getArticle(summary.slug)!) }));
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

test("Advisory and Workspace guidance is consolidated under the current Vanteloq brand", () => {
  const article = getArticle("business-consulting-vs-business-software");
  assert.ok(article, "Advisory and Workspace comparison article is missing");
  assert.equal(article.title, "Do You Need Vanteloq Advisory, Workspace or Both?");
  assert.equal(article.seoTitle, "Business Advisory vs. Business Software: How to Choose | Vanteloq");
  assert.equal(article.author, "Vanteloq Editorial Team");
  assert.equal(article.published, "2026-09-16");
  assert.equal(article.updated, "2026-10-13");
  assert.equal(article.category, "operations");
  assert.ok(article.related.every(slug => getArticle(slug)), "Every related resource must be published");

  const publicCopy = JSON.stringify(article);
  assert.match(publicCopy, /Vanteloq Inc\. provides two related offers/);
  assert.match(publicCopy, /Vanteloq Advisory/);
  assert.match(publicCopy, /Vanteloq Workspace/);
  assert.doesNotMatch(publicCopy, /Lexedge|VantaTalk/);
});

test("the Advisory comparison article keeps VantaTalk separate and offers both next paths", async () => {
  const guide = await readFile(new URL("../app/professor-guide.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/resources/[segment]/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(guide, /VantaTalk/);
  assert.match(guide, /Vanteloq guide/);
  assert.match(route, /article\.slug === "business-consulting-vs-business-software"/);
  assert.match(route, /href="\/advisory#contact">Talk to an Advisor/);
  assert.match(route, /href="\/how-it-works">Explore Workspace/);
});
