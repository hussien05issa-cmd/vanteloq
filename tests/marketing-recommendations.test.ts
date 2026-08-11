import assert from "node:assert/strict";
import test from "node:test";
import { buildMarketingRecommendations } from "../domain/marketing-recommendations.ts";

const readyCoverage = {
  customers: { status: "ready" as const, freshness: "Current through 2026-08-10", evidence: ["24 customer records"], missingInputs: [] },
  inventory: { status: "ready" as const, freshness: "Updated 2026-08-10", evidence: ["18 location inventory balances"], missingInputs: [] },
  margin: { status: "ready" as const, freshness: "Current through 2026-08-09", evidence: ["Net sales and cost of goods recorded"], missingInputs: [] },
  cashReadiness: { status: "ready" as const, freshness: "Updated 2026-08-10", evidence: ["Cash balance and safety threshold recorded"], missingInputs: [] },
  location: { status: "ready" as const, freshness: "Updated 2026-08-08", evidence: ["Validated location matches inventory scope"], missingInputs: [] },
};

const marketingEvidence = {
  status: "ready" as const,
  freshness: "Current through 2026-08-10",
  evidence: ["12 owner-imported search observations", "8 matched journey records"],
  missingInputs: [],
};

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
    asOfDate: "2026-08-11",
    operatingCoverage: readyCoverage,
    marketingEvidence,
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
    asOfDate: "2026-08-11",
    operatingCoverage: {
      customers: { status: "missing", freshness: "No customer source date", evidence: [], missingInputs: ["Customer outcomes"] },
      inventory: { status: "missing", freshness: "No inventory source date", evidence: [], missingInputs: ["Location inventory"] },
      margin: { status: "missing", freshness: "No margin source date", evidence: [], missingInputs: ["Product cost and margin"] },
      cashReadiness: { status: "missing", freshness: "No cash source date", evidence: [], missingInputs: ["Cash balance", "Cash safety threshold"] },
      location: { status: "missing", freshness: "No location source date", evidence: [], missingInputs: ["Validated operating location"] },
    },
    marketingEvidence: { status: "missing", freshness: "No marketing source date", evidence: [], missingInputs: ["Search observations", "Matched journeys"] },
  });
  assert.ok(result.some((item) => item.category === "measurement"));
  assert.ok(result.some((item) => item.evidenceNeeded.length > 0));
});

test("growth advice protects margin and inventory before recommending a promotion", () => {
  const result = buildMarketingRecommendations({
    businessModel: "Retail store",
    primaryOffer: "Seasonal collection",
    targetAudience: "Local shoppers",
    serviceArea: "Edmonton",
    primaryGoal: "sales",
    websiteUrl: "https://example.com",
    googleProfileStatus: "verified",
    hasAttributionData: true,
    hasSearchData: true,
    asOfDate: "2026-08-11",
    operatingCoverage: readyCoverage,
    marketingEvidence,
  });

  const guardrail = result.find((item) => item.id === "commercial-guardrail");
  assert.ok(guardrail);
  assert.match(guardrail.action, /margin/i);
  assert.match(guardrail.action, /inventory/i);
  assert.ok(guardrail.evidenceNeeded.includes("location-level inventory"));
  assert.equal(guardrail.confidence, "high");
  assert.equal(guardrail.actionOwner, "Business owner");
  assert.equal(guardrail.actionDueDate, "2026-08-25");
  assert.match(guardrail.reviewMethod, /post-discount margin/i);
  assert.equal(guardrail.sourceFreshness, "Current through 2026-08-10");
  assert.deepEqual(guardrail.missingInputs, []);
  assert.deepEqual(guardrail.operatingCoverage.map((item) => item.key), ["inventory", "margin", "cashReadiness", "location"]);
});

test("promotion advice is blocked and reports every material operating gap", () => {
  const result = buildMarketingRecommendations({
    businessModel: "Retail store",
    primaryOffer: "Seasonal collection",
    targetAudience: "Local shoppers",
    serviceArea: "Edmonton",
    primaryGoal: "sales",
    websiteUrl: "https://example.com",
    googleProfileStatus: "verified",
    hasAttributionData: true,
    hasSearchData: true,
    asOfDate: "2026-08-11",
    operatingCoverage: {
      ...readyCoverage,
      inventory: { status: "stale", freshness: "Last updated 2026-06-01", evidence: ["18 location inventory balances"], missingInputs: ["Current inventory balance"] },
      cashReadiness: { status: "limited", freshness: "Updated 2026-08-10", evidence: ["Cash balance recorded"], missingInputs: ["Cash safety threshold"] },
      location: { status: "limited", freshness: "Updated 2026-08-08", evidence: ["One active location"], missingInputs: ["Verified inventory to location mapping"] },
    },
    marketingEvidence,
  });

  const guardrail = result.find((item) => item.id === "commercial-guardrail");
  assert.ok(guardrail);
  assert.equal(guardrail.confidence, "blocked");
  assert.match(guardrail.action, /Do not launch/i);
  assert.deepEqual(guardrail.missingInputs, ["Current inventory balance", "Cash safety threshold", "Verified inventory to location mapping"]);
  assert.ok(guardrail.evidence.includes("Cash balance recorded"));
});

test("every recommendation is a reviewable evidence packet", () => {
  const result = buildMarketingRecommendations({
    businessModel: "Mobile auto detailing",
    primaryOffer: "Interior detailing",
    targetAudience: "Vehicle owners",
    serviceArea: "Calgary",
    primaryGoal: "leads",
    websiteUrl: "https://example.com",
    googleProfileStatus: "claimed",
    hasAttributionData: false,
    hasSearchData: true,
    asOfDate: "2026-08-11",
    operatingCoverage: readyCoverage,
    marketingEvidence,
  });

  assert.ok(result.length > 0);
  assert.ok(result.every((item) => item.evidence.length > 0));
  assert.ok(result.every((item) => item.confidenceReason.length > 0));
  assert.ok(result.every((item) => item.actionOwner.length > 0));
  assert.ok(result.every((item) => /^2026-\d{2}-\d{2}$/.test(item.actionDueDate)));
  assert.ok(result.every((item) => item.reviewMethod.length > 0));
  assert.ok(result.every((item) => item.sourceFreshness.length > 0));
});
