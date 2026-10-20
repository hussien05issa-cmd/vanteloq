import assert from "node:assert/strict";
import test from "node:test";
import sitemap from "../app/sitemap";
import { absoluteUrl } from "../app/seo";
import { getArticle } from "../app/resources/content";

export const MIGRATED_ADVISORY_RESOURCE_SLUGS = [
  "calculate-break-even-point",
  "customer-acquisition-cost-and-lifetime-value",
  "marketing-strategy-that-drives-growth",
  "how-much-should-a-business-spend-on-marketing",
  "improve-website-conversion-rate",
  "marketing-channels-that-are-working",
  "business-systems-before-scaling",
  "repeatable-sales-process",
  "retail-inventory-turnover-sell-through-gmroi",
  "retail-standard-operating-procedures",
  "customer-journey-audit-for-small-business",
  "vanteloq-retail-analytics-how-it-works",
  "vanteloq-ai-business-data-and-privacy",
  "bookloq-accounting-and-cash-flow-planning",
  "retail-founder-perspective-business-intelligence",
] as const;

test("retiring Journal articles have complete Vanteloq canonical resources", () => {
  const urls = sitemap().map((entry) => entry.url);
  for (const slug of MIGRATED_ADVISORY_RESOURCE_SLUGS) {
    const article = getArticle(slug);
    assert.ok(article, `${slug} is missing`);
    assert.equal(article.updated, "2026-10-13", slug);
    assert.equal(urls.filter((url) => url === absoluteUrl(`/resources/${slug}`)).length, 1, slug);
    const publicCopy = JSON.stringify(article);
    assert.doesNotMatch(publicCopy, /VantaTalk/i, slug);
    assert.doesNotMatch(publicCopy, /owned (?:and|&) operated by Lexedge/i, slug);
    assert.doesNotMatch(publicCopy, /Vanteloq is Lexedge/i, slug);
    assert.doesNotMatch(publicCopy, /lexedgeconsulting\.com/i, slug);
  }
});

test("founder story preserves verified authorship and the new brand hierarchy", () => {
  const article = getArticle("retail-founder-perspective-business-intelligence");
  assert.ok(article);
  assert.equal(article.author, "Hussien Issa");
  assert.match(article.quickAnswer, /started a retail business with his brother and helped scale it/i);
  assert.match(article.quickAnswer, /conceived and developed Vanteloq/i);
  assert.match(JSON.stringify(article), /Vanteloq Advisory/);
  assert.match(JSON.stringify(article), /Vanteloq Workspace/);
});

test("folded Journal material remains in the stronger Vanteloq guides", () => {
  const checks = [
    ["how-to-analyze-business-data-for-growth", /outcome metrics/i, /fact|observation/i, /decision rhythm/i],
    ["what-should-small-business-dashboard-show", /leading/i, /lagging/i, /guardrail/i],
    ["small-business-cash-flow-management-guide", /confirmed/i, /planning case/i, /variance/i],
  ] as const;
  for (const [slug, ...patterns] of checks) {
    const article = getArticle(slug);
    assert.ok(article, slug);
    assert.equal(article.updated, "2026-10-13", slug);
    const copy = JSON.stringify(article);
    for (const pattern of patterns) assert.match(copy, pattern, slug);
  }
});
