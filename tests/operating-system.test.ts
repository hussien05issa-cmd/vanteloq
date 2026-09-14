import assert from "node:assert/strict";
import test from "node:test";
import { buildOperatingSystem } from "../server/operating-system.ts";

const base = {
  ready: true,
  currency: "CAD",
  source: { rowCount: 60, freshness: "current", latestBusinessDate: "2026-08-08" },
  balances: { cashBalanceCents: 4_200_000, accountsPayableCents: 1_800_000, inventoryValueCents: 7_000_000 },
  insights: [{ id: "sales-trend", severity: "attention" as const, title: "Sales declined", whatHappened: "Sales fell 8%.", recommendedAction: "Review basket mix.", financialImpact: "$4,000 lower sales.", confidence: "medium" as const, evidence: ["60 verified days"], missingInformation: ["Line items"] }],
  dataQuality: { status: "usable", missingDimensions: ["Line items"] },
};

test("the operating system ranks decisions and labels cash capacity as preliminary", () => {
  const result = buildOperatingSystem(base);
  assert.equal(result.status, "operational");
  assert.equal(result.preliminaryPurchasingCapacityCents, 2_400_000);
  assert.match(result.purchasingCapacityLabel, /Preliminary only/);
  assert.equal(result.decisions[0].sourceRef, "sales-trend");
  assert.equal(result.decisions[0].approval, "owner_review");
});

test("the operating system escalates a verified cash commitment gap", () => {
  const result = buildOperatingSystem({ ...base, balances: { ...base.balances, cashBalanceCents: 900_000, accountsPayableCents: 1_800_000 } });
  assert.equal(result.decisions[0].id, "decision:cash-commitment-gap");
  assert.equal(result.decisions[0].priority, "critical");
  assert.ok(result.decisions[0].missing.includes("Payroll commitments"));
});

test("an empty workspace produces no fabricated decision", () => {
  const result = buildOperatingSystem({ ...base, ready: false, balances: null, insights: [] });
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.decisions, []);
  assert.equal(result.preliminaryPurchasingCapacityCents, null);
});

test("absent inventory balances and partial sales coverage remain unavailable or limited", () => {
  const result = buildOperatingSystem({ ...base, balances: null, dataQuality: { status: "limited", missingDimensions: [] } });
  assert.equal(result.pillars.find(pillar => pillar.id === "inventory")?.state, "needs_source");
  assert.equal(result.pillars.find(pillar => pillar.id === "sales")?.state, "limited");
});
