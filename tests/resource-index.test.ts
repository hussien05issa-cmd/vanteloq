import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ResourceArticleBrowser from "../app/resource-article-browser";
import { RESOURCE_ARTICLES, getReadingTime } from "../app/resources/content";
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
