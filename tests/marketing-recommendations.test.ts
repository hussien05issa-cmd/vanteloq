import assert from "node:assert/strict";
import test from "node:test";
import { buildMarketingRecommendations } from "../domain/marketing-recommendations.ts";

test("local service recommendations are tailored to the business and lead goal", () => {
  const result = buildMarketingRecommendations({
    businessModel: "Mobile auto detailing",
    primaryOffer: "Interior and exterior detailing",
    targetAudience: "Vehicle owners",
    serviceArea: "Calgary",
    primaryGoal: "leads",
    websiteUrl: "https://example.com",
    googleProfileStatus: "verified",
    hasAttributionData: false,
    hasSearchData: false,
  });
  assert.ok(result.some((item) => item.title.includes("Calgary")));
  assert.ok(result.some((item) => item.action.includes("Interior and exterior detailing")));
  assert.ok(result.every((item) => !/guarantee|keyword stuffing/i.test(item.action)));
});

test("missing measurement data produces an explicit instrumentation recommendation", () => {
  const result = buildMarketingRecommendations({
    businessModel: "Retail store",
    primaryOffer: "Specialty goods",
    targetAudience: "Local shoppers",
    serviceArea: "Edmonton",
    primaryGoal: "sales",
    websiteUrl: "",
    googleProfileStatus: "not_set",
    hasAttributionData: false,
    hasSearchData: false,
  });
  assert.ok(result.some((item) => item.category === "measurement"));
  assert.ok(result.some((item) => item.evidenceNeeded.length > 0));
});
