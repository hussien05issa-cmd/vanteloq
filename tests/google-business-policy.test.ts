import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path: string) => readFile(new URL(path, root), "utf8");

test("Business Profile review content is fetched on demand but never persisted or aggregated", async () => {
  const [schema, marketing, routes, api, growth, migration] = await Promise.all([
    source("db/schema.ts"),
    source("server/integrations/marketing.ts"),
    source("server/integrations/marketing-routes.ts"),
    source("server/api.ts"),
    source("app/api/v1/growth/route.ts"),
    source("drizzle/0027_fuzzy_jean_grey.sql"),
  ]);
  assert.doesNotMatch(schema, /export const marketingReviews/);
  assert.match(marketing, /mybusiness\.googleapis\.com\/v4/);
  assert.match(marketing, /"Cache-Control": "no-store"/);
  assert.doesNotMatch(routes, /INSERT INTO marketing_reviews|snapshot\.reviews/);
  assert.match(routes, /confirmPublish !== true/);
  assert.match(api, /headers\.set\("Cache-Control", "no-store, max-age=0"\)/);
  assert.doesNotMatch(growth, /reviewInsights|aggregate Google review/i);
  assert.match(migration, /DROP TABLE `marketing_reviews`/);
});

test("Google authorization requests the shipped measurement and Business Profile scope", async () => {
  const marketing = await readFile(new URL("../server/integrations/marketing.ts", import.meta.url), "utf8");
  assert.match(marketing, /business\.manage/);
  assert.match(marketing, /webmasters\.readonly/);
  assert.match(marketing, /analytics\.readonly/);
  assert.match(marketing, /GOOGLE_ADS_DEVELOPER_TOKEN/);
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
