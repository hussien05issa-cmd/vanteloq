import assert from "node:assert/strict";
import test from "node:test";
import { PLANS } from "../server/entitlements/catalog.ts";
import {
  resolveSubscriptionEntitlements,
  subscriptionGrantsAccess,
  type SubscriptionSnapshot,
} from "../server/entitlements/engine.ts";

function snapshot(overrides: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot {
  return {
    basePlan: "starter",
    status: "active",
    addons: [],
    trialEndsAt: null,
    currentPeriodEndsAt: null,
    cancelAtPeriodEnd: false,
    scheduledBasePlan: null,
    scheduledEffectiveAt: null,
    version: 1,
    ...overrides,
  };
}

test("only active and trialing subscription states grant normal paid access", () => {
  assert.equal(subscriptionGrantsAccess("active"), true);
  assert.equal(subscriptionGrantsAccess("trialing"), true);
  for (const status of ["incomplete", "incomplete_expired", "past_due", "canceled", "unpaid", "paused", null] as const) {
    assert.equal(subscriptionGrantsAccess(status), false);
  }
});

test("Starter, Growth and Pro resolve genuinely different server feature sets", () => {
  const starter = resolveSubscriptionEntitlements(snapshot({ basePlan: "starter" }));
  const growth = resolveSubscriptionEntitlements(snapshot({ basePlan: "growth" }));
  const pro = resolveSubscriptionEntitlements(snapshot({ basePlan: "pro" }));

  assert.equal(starter.features.includes("inventory.expiry"), false);
  assert.equal(growth.features.includes("inventory.expiry"), true);
  assert.equal(growth.features.includes("forecasting.advanced"), false);
  assert.equal(pro.features.includes("forecasting.advanced"), true);
  assert.equal(starter.limits?.users, 3);
  assert.equal(growth.limits?.users, 10);
  assert.equal(pro.limits?.users, 25);
});

test("a client-visible scheduled downgrade does not remove current Growth access early", () => {
  const effective = resolveSubscriptionEntitlements(snapshot({
    basePlan: "growth",
    scheduledBasePlan: "starter",
    scheduledEffectiveAt: new Date("2026-09-01T00:00:00Z"),
  }));
  assert.equal(effective.plan, "growth");
  assert.equal(effective.features.includes("inventory.expiry"), true);
  assert.equal(effective.scheduledBasePlan, "starter");
});

test("BookLoq unlocks only from the independent add-on state", () => {
  const withoutAddon = resolveSubscriptionEntitlements(snapshot({ basePlan: "pro", addons: [] }));
  const withAddon = resolveSubscriptionEntitlements(snapshot({ basePlan: "starter", addons: ["bookloq"] }));
  assert.equal(withoutAddon.features.includes("bookloq"), false);
  assert.equal(withAddon.features.includes("bookloq"), true);
  assert.equal(withAddon.features.includes("bookloq.reconciliation"), true);
  assert.equal(withAddon.features.includes("inventory.expiry"), false);
});

test("non-entitled billing states fail closed and retain no add-on leakage", () => {
  for (const status of ["incomplete", "past_due", "canceled", "unpaid", "paused"] as const) {
    const effective = resolveSubscriptionEntitlements(snapshot({ basePlan: "pro", status, addons: ["bookloq"] }));
    assert.equal(effective.accessType, "none");
    assert.equal(effective.plan, null);
    assert.deepEqual(effective.features, []);
    assert.deepEqual(effective.addons, []);
    assert.equal(effective.limits, null);
  }
});

test("resolved limits always come from the central plan catalogue", () => {
  for (const plan of ["starter", "growth", "pro"] as const) {
    const effective = resolveSubscriptionEntitlements(snapshot({ basePlan: plan }));
    assert.equal(effective.limits, PLANS[plan].limits);
  }
});

test("BookLoQ API entitlement fails closed without the independent add-on", async () => {
  const engine = await import("../server/entitlements/engine.ts") as Record<string, unknown>;
  assert.equal(typeof engine.requireAddonEntitlement, "function");
  const requireAddonEntitlement = engine.requireAddonEntitlement as (
    entitlements: ReturnType<typeof resolveSubscriptionEntitlements>,
    addon: "bookloq",
  ) => void;

  const withoutAddon = resolveSubscriptionEntitlements(snapshot({ basePlan: "pro", addons: [] }));
  assert.throws(() => requireAddonEntitlement(withoutAddon, "bookloq"), /not included/i);

  const withAddon = resolveSubscriptionEntitlements(snapshot({ basePlan: "starter", addons: ["bookloq"] }));
  assert.doesNotThrow(() => requireAddonEntitlement(withAddon, "bookloq"));
});
