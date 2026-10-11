import test from "node:test";
import assert from "node:assert/strict";
import { businessContextHeaders, requestedBusinessContext } from "../domain/business-context";
import { defaultIndustryConfiguration, validateIndustryConfiguration } from "../domain/industry-templates";

test("business scope is captured separately for each tab and rejects retargeting", () => {
  const a = businessContextHeaders(undefined, "https://vanteloq.com/?workspace=org-a");
  const b = businessContextHeaders(undefined, "https://vanteloq.com/?workspace=org-b");
  assert.equal(a.get("X-Vanteloq-Workspace"), "org-a");
  assert.equal(b.get("X-Vanteloq-Workspace"), "org-b");
  assert.throws(() => businessContextHeaders(a, "https://vanteloq.com/?workspace=org-b"), /different business/);
  assert.throws(() => requestedBusinessContext(new Request("https://vanteloq.com/api/v1/foodservice?workspace=org-b", { headers: a })), /does not match/);
  assert.equal(requestedBusinessContext(new Request("https://vanteloq.com/api/v1/foodservice", { headers: a })), "org-a");
  assert.equal(requestedBusinessContext(new Request("https://vanteloq.com/api/v1/foodservice")), null);
  assert.throws(() => businessContextHeaders(undefined, "https://vanteloq.com/?workspace=%20"), /valid business/);
});
test("mixed product businesses add recipe costing without acquiring vehicle fields or changing defaults", () => {
  const retail = defaultIndustryConfiguration("health");
  const mixed = validateIndustryConfiguration({ ...retail, capabilities: [...retail.capabilities, "food_costing"] });
  assert.equal(mixed.templateId, "health");
  assert.deepEqual(retail.capabilities, ["products", "lots"]);
  assert.ok(mixed.capabilities.includes("food_costing"));
  assert.ok(!mixed.capabilities.includes("vehicles"));
  assert.throws(() => validateIndustryConfiguration({ ...retail, capabilities: [...retail.capabilities, "dealership_operations"] }), /supported tools/);
});
