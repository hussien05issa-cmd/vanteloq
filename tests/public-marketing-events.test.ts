import assert from "node:assert/strict";
import test from "node:test";
import { publicMarketingEvent } from "../shared/public-marketing-events.ts";

test("public interactions retain only fixed properties relevant to their event", () => {
  assert.deepEqual(publicMarketingEvent({
    publicEvent: "story_step_selected",
    publicSection: "story",
    publicStep: "comparison",
    publicIndustry: "retail",
    publicPlan: "free",
    publicProvider: "square",
    value: "private form value",
    account: "private account",
  }), { name: "story_step_selected", properties: { section: "story", step: "comparison" } });
  assert.deepEqual(publicMarketingEvent({
    publicEvent: "hero_play", publicSection: "hero", publicStep: "sales",
  }), { name: "hero_play", properties: { section: "hero" } });
});

test("unknown values, input text and URL-shaped properties never leave the allowlist", () => {
  const result = publicMarketingEvent({
    publicEvent: "industry_selected",
    publicSection: "/?email=private",
    publicIndustry: "Private shop name",
    publicPlan: "private-account",
    publicProvider: "https://private.example",
    publicStep: "4800",
  });
  assert.deepEqual(result, { name: "industry_selected", properties: {} });
  assert.equal(publicMarketingEvent({ publicEvent: "inquiry_sent" }), null);
  assert.equal(publicMarketingEvent({ publicEvent: "signup_completed" }), null);
  assert.equal(publicMarketingEvent({ publicEvent: "__proto__" }), null);
  assert.equal(publicMarketingEvent({ publicEvent: "private_record_opened" }), null);
});

test("fixed plan, provider and industry identifiers retain useful public context", () => {
  assert.deepEqual(publicMarketingEvent({
    publicEvent: "plan_selected", publicSection: "pricing", publicPlan: "free",
  }), { name: "plan_selected", properties: { section: "pricing", plan: "free" } });
  assert.deepEqual(publicMarketingEvent({
    publicEvent: "compatibility_checked", publicSection: "connections", publicProvider: "lightspeed_r",
  }), { name: "compatibility_checked", properties: { section: "connections", provider: "lightspeed_r" } });
  assert.deepEqual(publicMarketingEvent({
    publicEvent: "industry_selected", publicSection: "industries", publicIndustry: "multi_location",
  }), { name: "industry_selected", properties: { section: "industries", industry: "multi_location" } });
});

