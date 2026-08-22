import assert from "node:assert/strict";
import test from "node:test";

type NavigationEntitlementsModule = {
  navigationEntitlement?: (
    view: string,
    features: readonly string[],
  ) => {
    allowed: boolean;
    requiredFeature: string | null;
    upgradeLabel: string | null;
  };
  navigationEntitlementViews?: readonly string[];
};

async function navigationModule(): Promise<NavigationEntitlementsModule> {
  return import("../domain/navigation-entitlements.ts").catch(() => ({}));
}

test("subscription navigation fails closed and labels every paid workspace view", async () => {
  const entitlements = await navigationModule();
  assert.equal(typeof entitlements.navigationEntitlement, "function");
  assert.deepEqual(entitlements.navigationEntitlementViews, [
    "Dashboard",
    "Intelligence",
    "Action Centre",
    "Business Brief",
    "Advisor",
    "BookLoQ",
    "Sales",
    "Profit",
    "Cash",
    "Bookkeeping",
    "Inventory",
    "Customers",
    "Marketing",
    "Communications",
    "Team",
    "Operations",
    "Suppliers",
    "Purchase Orders",
    "Documents",
    "Data Quality",
    "Locations",
    "Decision Journal",
    "Scenario Planner",
    "Reports",
    "Integrations",
    "Settings",
  ]);

  assert.deepEqual(entitlements.navigationEntitlement?.("Unknown", ["dashboard.core"]), {
    allowed: false,
    requiredFeature: null,
    upgradeLabel: "Unavailable",
  });
});

test("Starter, Growth, Pro, and BookLoQ features unlock only their intended views", async () => {
  const entitlements = await navigationModule();
  assert.equal(typeof entitlements.navigationEntitlement, "function");
  const access = entitlements.navigationEntitlement!;

  assert.deepEqual(access("Dashboard", ["dashboard.core"]), {
    allowed: true,
    requiredFeature: "dashboard.core",
    upgradeLabel: null,
  });
  assert.deepEqual(access("Inventory", ["inventory.basic"]), {
    allowed: false,
    requiredFeature: "inventory.lots",
    upgradeLabel: "Growth",
  });
  assert.deepEqual(access("Inventory", ["inventory.lots"]), {
    allowed: true,
    requiredFeature: "inventory.lots",
    upgradeLabel: null,
  });
  assert.deepEqual(access("Scenario Planner", ["forecasting.advanced"]), {
    allowed: false,
    requiredFeature: "forecasting.scenarios",
    upgradeLabel: "Pro",
  });
  assert.deepEqual(access("Scenario Planner", ["forecasting.scenarios"]), {
    allowed: true,
    requiredFeature: "forecasting.scenarios",
    upgradeLabel: null,
  });
  assert.deepEqual(access("BookLoQ", ["reporting.advanced"]), {
    allowed: false,
    requiredFeature: "bookloq",
    upgradeLabel: "BookLoQ add-on",
  });
  assert.deepEqual(access("BookLoQ", ["bookloq"]), {
    allowed: true,
    requiredFeature: "bookloq",
    upgradeLabel: null,
  });
});

test("nested BookLoQ views and advanced reports cannot bypass their paid boundaries", async () => {
  const entitlements = await navigationModule();
  assert.equal(typeof entitlements.navigationEntitlement, "function");
  const access = entitlements.navigationEntitlement!;

  for (const view of ["Profit", "Cash", "Bookkeeping"]) {
    assert.equal(access(view, []).allowed, false, view);
    assert.equal(access(view, ["bookloq"]).allowed, true, view);
  }
  assert.deepEqual(access("Reports", ["reporting.basic"]), {
    allowed: true,
    requiredFeature: "reporting.basic",
    upgradeLabel: null,
  });
});
