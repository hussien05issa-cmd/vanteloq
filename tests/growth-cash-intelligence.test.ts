import assert from "node:assert/strict";
import test from "node:test";
import { calculateCashFlowIntelligence } from "../domain/cash-flow-intelligence.ts";
import { buildGrowthIntelligence } from "../domain/growth-intelligence.ts";

test("growth attribution joins a verified journey to POS revenue", () => {
  const result = buildGrowthIntelligence({
    touchpoints: [
      { id: "1", occurredAt: "2026-08-01T10:00:00Z", source: "Google Maps", stage: "discovery", journeyRef: "j1" },
      { id: "2", occurredAt: "2026-08-01T10:02:00Z", source: "Google Maps", stage: "website", journeyRef: "j1" },
      { id: "3", occurredAt: "2026-08-01T10:05:00Z", source: "Google Maps", stage: "phone_call", journeyRef: "j1" },
      { id: "4", occurredAt: "2026-08-01T11:00:00Z", source: "Google Maps", stage: "customer", journeyRef: "j1" },
    ],
    transactions: [{ id: "t1", occurredAt: "2026-08-01T11:01:00Z", journeyRef: "j1", revenueCents: 9840, grossProfitCents: 4300 }],
    searchVisibility: [],
  });
  assert.equal(result.status, "available");
  assert.deepEqual(result.channels[0], { source: "Google Maps", leads: 1, customers: 1, transactions: 1, revenueCents: 9840, grossProfitCents: 4300 });
});

test("growth intelligence refuses to invent attribution", () => {
  assert.equal(buildGrowthIntelligence({ touchpoints: [], transactions: [], searchVisibility: [] }).status, "unavailable");
});

test("cash intelligence protects confirmed obligations and excludes probable income from capacity", () => {
  const result = calculateCashFlowIntelligence({ openingCashCents: 4_218_400, safetyThresholdCents: 1_200_000, asOf: "2026-08-01", items: [
    { id: "supplier", label: "supplier invoice", dueDate: "2026-08-10", amountCents: 1_800_000, direction: "out", certainty: "confirmed", category: "supplier" },
    { id: "payroll", label: "payroll", dueDate: "2026-08-14", amountCents: 1_240_000, direction: "out", certainty: "confirmed", category: "payroll" },
    { id: "invoice", label: "customer invoice", dueDate: "2026-08-12", amountCents: 900_000, direction: "in", certainty: "probable" },
  ] });
  assert.equal(result.status, "available");
  assert.equal(result.purchasingCapacityCents, 0);
  assert.match(result.warning ?? "", /before payroll/);
});
