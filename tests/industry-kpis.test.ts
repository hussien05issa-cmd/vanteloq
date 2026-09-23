import assert from "node:assert/strict";
import test from "node:test";
import { dashboardPreferencePreset } from "../domain/dashboard-preferences.ts";
import { applyIndustryKpis, industryKpiRecommendation } from "../domain/industry-kpis.ts";

test("industry recommendations use existing source-aware dashboard metrics", () => {
  const retail = industryKpiRecommendation("Retail");
  assert.equal(retail.industry, "Retail");
  assert.deepEqual(retail.recommended.slice(0, 4).map(item => item.key), ["net_revenue", "gross_profit", "gross_margin", "inventory_value"]);
  assert.ok(retail.nextMeasures.some(item => item.name === "Inventory Turnover"));

  const services = industryKpiRecommendation("Professional Services");
  assert.equal(services.recommended.some(item => item.key === "inventory_value"), false);
  assert.ok(services.nextMeasures.some(item => item.name === "Receivables Age"));
});

test("applying recommendations preserves user periods, comparisons and targets", () => {
  const current = dashboardPreferencePreset("finance");
  current.defaultPeriod = "qtd";
  current.comparison = "target";
  current.targets = { net_revenue: 100_000 };
  const applied = applyIndustryKpis(current, "Health & Wellness");

  assert.equal(applied.defaultPeriod, "qtd");
  assert.equal(applied.comparison, "target");
  assert.deepEqual(applied.targets, { net_revenue: 100_000 });
  assert.equal(applied.widgets[0].id, "net_revenue");
  assert.equal(applied.widgets[1].id, "gross_profit");
  assert.equal(applied.widgets.filter(item => item.visible).length, 6);
  assert.equal(new Set(applied.widgets.map(item => item.id)).size, 11);
});

test("unknown business types receive a cautious general starting view", () => {
  const guide = industryKpiRecommendation("Custom studio");
  assert.equal(guide.industry, "Your Business");
  assert.match(guide.summary, /recurring decision/i);
});
