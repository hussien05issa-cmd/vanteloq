import assert from "node:assert/strict";
import test from "node:test";
import { dashboardPreferencePreset, normalizeDashboardPreferences } from "../domain/dashboard-preferences.ts";

test("dashboard presets focus each operating role without losing available metrics", () => {
  const finance = dashboardPreferencePreset("finance");
  assert.equal(finance.widgets.find(item => item.id === "cash_flow")?.visible, true);
  assert.equal(finance.widgets.find(item => item.id === "units_sold")?.visible, false);
  assert.equal(new Set(finance.widgets.map(item => item.id)).size, 11);
  const inventory = dashboardPreferencePreset("inventory");
  assert.equal(inventory.widgets[0].id, "inventory_value");
  assert.equal(inventory.sections.financialDetail, false);
});

test("dashboard preference normalization rejects unknown, duplicate and unsafe values", () => {
  const normalized = normalizeDashboardPreferences({
    profile: "sales",
    defaultPeriod: "90d",
    comparison: "target",
    widgets: [
      { id: "net_revenue", visible: true, size: "wide" },
      { id: "net_revenue", visible: false },
      { id: "invented_metric", visible: true },
      { id: "transactions", visible: false, size: "huge" },
    ],
    sections: { needsAttention: false, financialDetail: true },
    targets: { net_revenue: 45000, gross_margin: Number.POSITIVE_INFINITY, transactions: 1250 },
  });
  assert.equal(normalized.profile, "sales");
  assert.equal(normalized.defaultPeriod, "90d");
  assert.equal(normalized.widgets[0].id, "net_revenue");
  assert.equal(normalized.widgets[0].size, "wide");
  assert.equal(normalized.widgets[1].id, "transactions");
  assert.equal(normalized.widgets[1].visible, false);
  assert.equal(normalized.widgets[1].size, "standard");
  assert.equal(new Set(normalized.widgets.map(item => item.id)).size, 11);
  assert.deepEqual(normalized.targets, { net_revenue: 45000, transactions: 1250 });
  assert.equal(normalized.sections.needsAttention, false);
});
