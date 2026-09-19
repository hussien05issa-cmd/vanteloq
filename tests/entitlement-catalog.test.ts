import assert from "node:assert/strict";
import test from "node:test";
import {
  ADDONS,
  ALL_NORMAL_PAID_FEATURES,
  FEATURE_KEYS,
  PLANS,
  PURCHASE_INTERVALS,
  VANTELOQ_PLAN_KEYS,
  isVanteloqPlanKey,
  planIncludesFeature,
} from "../server/entitlements/catalog.ts";

test("the central catalogue contains the exact approved CAD prices", () => {
  assert.deepEqual(
    {
      starter: [PLANS.starter.prices.month.amountCents, PLANS.starter.prices.year.amountCents],
      growth: [PLANS.growth.prices.month.amountCents, PLANS.growth.prices.year.amountCents],
      pro: [PLANS.pro.prices.month.amountCents, PLANS.pro.prices.year.amountCents],
      bookloqStandalone: PLANS.bookloq.prices.month.amountCents,
      bookloqAddon: [ADDONS.bookloq.prices.month.amountCents, ADDONS.bookloq.prices.year.amountCents],
    },
    {
      starter: [4_900, 49_000],
      growth: [9_900, 99_000],
      pro: [17_900, 179_000],
      bookloqStandalone: 5_900,
      bookloqAddon: [3_900, 39_000],
    },
  );
});

test("new purchases are monthly while legacy annual prices remain reconcilable", () => {
  assert.deepEqual(PURCHASE_INTERVALS, ["month"]);
  assert.equal(PLANS.starter.prices.year.interval, "year");
  assert.equal(ADDONS.bookloq.prices.year.interval, "year");
  assert.equal("year" in PLANS.bookloq.prices, false);
});

test("plan inheritance is monotonic without leaking Growth or Pro features", () => {
  for (const feature of PLANS.starter.features) assert.equal(planIncludesFeature("growth", feature), true);
  for (const feature of PLANS.growth.features) assert.equal(planIncludesFeature("pro", feature), true);

  assert.equal(planIncludesFeature("starter", "inventory.basic"), true);
  assert.equal(planIncludesFeature("starter", "inventory.expiry"), false);
  assert.equal(planIncludesFeature("starter", "growth.strategy"), false);
  assert.equal(planIncludesFeature("growth", "inventory.expiry"), true);
  assert.equal(planIncludesFeature("growth", "growth.strategy"), true);
  assert.equal(planIncludesFeature("growth", "forecasting.advanced"), false);
  assert.equal(planIncludesFeature("pro", "forecasting.advanced"), true);
  assert.equal(planIncludesFeature("pro", "permissions.advanced"), true);
});

test("BookLoQ remains an independent add-on for Vanteloq plans and a separate standalone plan", () => {
  for (const planKey of VANTELOQ_PLAN_KEYS) {
    const plan = PLANS[planKey];
    assert.equal(plan.features.includes("bookloq"), false);
    assert.equal(plan.features.includes("bookloq.financial_statements"), false);
  }
  assert.equal(ADDONS.bookloq.features.includes("bookloq"), true);
  assert.equal(ADDONS.bookloq.features.includes("bookloq.reconciliation"), true);
  assert.equal(PLANS.bookloq.features.includes("bookloq"), true);
  assert.equal(PLANS.bookloq.features.includes("bookloq.reconciliation"), true);
  for (const feature of ["analytics.sales.basic", "inventory.basic", "marketing.overview", "growth.strategy", "forecasting.advanced"] as const) {
    assert.equal(PLANS.bookloq.features.includes(feature), false, feature);
  }
  for (const feature of ["dashboard.core", "business.profile", "business.settings", "pos.reporting.core", "invoice.basic", "reporting.basic", "ai.basic", "permissions.standard", "multi_location.basic"] as const) {
    assert.equal(PLANS.bookloq.features.includes(feature), true, feature);
  }
});

test("the catalogue has stable unique feature and lookup keys", () => {
  assert.equal(new Set(FEATURE_KEYS).size, FEATURE_KEYS.length);
  for (const plan of Object.values(PLANS)) assert.equal(new Set(plan.features).size, plan.features.length);
  assert.equal(new Set(ADDONS.bookloq.features).size, ADDONS.bookloq.features.length);

  const lookupKeys = [
    ...Object.values(PLANS).flatMap((plan) => Object.values(plan.prices).map((value) => value.lookupKey)),
    ...Object.values(ADDONS).flatMap((addon) => Object.values(addon.prices).map((value) => value.lookupKey)),
  ];
  assert.equal(new Set(lookupKeys).size, lookupKeys.length);
  assert.ok(ALL_NORMAL_PAID_FEATURES.includes("bookloq"));
  assert.ok(ALL_NORMAL_PAID_FEATURES.includes("forecasting.advanced"));
  assert.deepEqual(VANTELOQ_PLAN_KEYS, ["starter", "growth", "pro"]);
  assert.equal(isVanteloqPlanKey("starter"), true);
  assert.equal(isVanteloqPlanKey("bookloq"), false);
});

test("limits are centralized and numerical AI quotas remain undisclosed until metering exists", () => {
  assert.deepEqual(
    [PLANS.starter.limits.users, PLANS.growth.limits.users, PLANS.pro.limits.users, PLANS.bookloq.limits.users],
    [3, 10, 25, 3],
  );
  assert.deepEqual(
    [PLANS.starter.limits.activeLocations, PLANS.growth.limits.activeLocations, PLANS.pro.limits.activeLocations, PLANS.bookloq.limits.activeLocations],
    [1, 3, 10, 1],
  );
  assert.deepEqual(
    [PLANS.starter.limits.ai.capability, PLANS.growth.limits.ai.capability, PLANS.pro.limits.ai.capability, PLANS.bookloq.limits.ai.capability],
    ["basic", "advanced", "pro", "basic"],
  );
  for (const plan of Object.values(PLANS)) {
    assert.equal(plan.limits.ai.requestsPerMonth, null);
    assert.equal(plan.limits.ai.meteringStatus, "not_launched");
  }
});
