import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGoogleResourceReadiness,
  buildLocalOpportunityModel,
  buildProfileHealthChecklist,
} from "../domain/local-growth-intelligence.ts";

test("Google readiness recognizes selected resources but never silently combines them", () => {
  const readiness = buildGoogleResourceReadiness({
    locationId: "north",
    analyticsPropertyRef: "properties/123",
    analyticsScopeRef: "organization",
    searchConsoleSiteRef: "sc-domain:vanteloq.ca",
    searchConsoleScopeRef: "north",
    businessProfileLocationRef: null,
  });
  assert.equal(readiness.status, "ready");
  assert.deepEqual(readiness.missing, []);
  assert.equal(readiness.canCombineMeasurements, false);
});

test("Google resource readiness identifies a missing selected dataset", () => {
  const missing = buildGoogleResourceReadiness({
    locationId: "north",
    analyticsPropertyRef: "properties/123",
    analyticsScopeRef: "north",
    searchConsoleSiteRef: null,
    searchConsoleScopeRef: null,
    businessProfileLocationRef: null,
  });
  assert.equal(missing.status, "selection_required");
  assert.deepEqual(missing.missing, ["Search Console site"]);
  assert.equal(missing.canCombineMeasurements, false);
});

test("nearby businesses remain candidates until the owner classifies them", () => {
  const model = buildLocalOpportunityModel({
    centre: { latitude: 53.5461, longitude: -113.4938 },
  });
  assert.equal(model.status, "provider_not_configured");
  assert.equal(model.candidates.length, 0);
  assert.match(model.source.attributionUrl, /openstreetmap\.org\/copyright/);
  assert.match(model.boundary, /owner classifies/i);
});

test("profile checklist is business-type aware and never promises ranking", () => {
  const checklist = buildProfileHealthChecklist({
    businessType: "retail",
    profile: {
      verified: true,
      hoursRecorded: false,
      websiteRecorded: true,
      phoneRecorded: true,
    },
  });
  assert.ok(checklist.items.some((item) => item.id === "retail-hours" && item.status === "action_required"));
  assert.ok(checklist.items.some((item) => item.id === "review-response"));
  assert.ok(checklist.items.some((item) => item.status === "review_in_google"));
  assert.equal("score" in checklist, false);
  assert.match(checklist.disclaimer, /does not guarantee/i);
  const normalized = buildProfileHealthChecklist({
    businessType: " Retail ",
    profile: { verified: false, hoursRecorded: false, websiteRecorded: false, phoneRecorded: false },
  });
  assert.ok(normalized.items.some((item) => item.id === "retail-hours"));
});
