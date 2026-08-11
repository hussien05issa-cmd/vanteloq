import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path: string) => readFile(new URL(path, root), "utf8");

test("Business Profile content is not persisted or aggregated", async () => {
  const [schema, marketing, routes, growth, migration] = await Promise.all([
    source("db/schema.ts"),
    source("server/integrations/marketing.ts"),
    source("server/integrations/marketing-routes.ts"),
    source("app/api/v1/growth/route.ts"),
    source("drizzle/0027_fuzzy_jean_grey.sql"),
  ]);
  assert.doesNotMatch(schema, /export const marketingReviews/);
  assert.doesNotMatch(marketing, /mybusiness\.googleapis\.com\/v4|Google Business Profile reviews|ratingValue/);
  assert.doesNotMatch(routes, /INSERT INTO marketing_reviews|snapshot\.reviews/);
  assert.doesNotMatch(growth, /reviewInsights|aggregate Google review/i);
  assert.match(migration, /DROP TABLE `marketing_reviews`/);
});

test("Google authorization requests only the shipped Search Console and Analytics scopes", async () => {
  const marketing = await readFile(new URL("../server/integrations/marketing.ts", import.meta.url), "utf8");
  assert.doesNotMatch(marketing, /business\.manage/);
  assert.match(marketing, /webmasters\.readonly/);
  assert.match(marketing, /analytics\.readonly/);
});

test("marketing synchronization fails closed until resource selection exists", async () => {
  const [marketing, routes] = await Promise.all([
    source("server/integrations/marketing.ts"),
    source("server/integrations/marketing-routes.ts"),
  ]);
  assert.match(marketing, /resourceSelectionRequired: true/);
  assert.match(marketing, /syncEligible: false/);
  assert.match(routes, /MARKETING_RESOURCE_SELECTION_REQUIRED/);
  assert.match(routes, /dataPromotionStatus: "staging"/);
});
