import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { calculateScenario, type ScenarioInputs } from "../domain/scenario-model";
import { bookloqPositionMessage, formatBookloqMoney } from "../domain/bookloq-presentation";
import { connectorNextStep, filterConnectors } from "../domain/connector-guidance";
import ScenarioPlanner from "../app/scenario-planner";

const baseline: ScenarioInputs = { sales: 10000, margin: 40, fixed: 1500, labour: 1000, aov: 50, salesChange: 10, marginChange: 2, costChange: 100 };
test("scenario totals distinguish percentage points, profit and gross profit", () => {
  const result = calculateScenario(baseline);
  assert.equal(result.projectedSales, 11000);
  assert.equal(result.projectedMargin, 42);
  assert.equal(result.grossProfit, 4620);
  assert.equal(result.profit, 2020);
  assert.equal(result.baselineProfit, 1500);
  assert.equal(result.profitChange, 520);
  assert.equal(result.transactions, 124);
});
test("zero margin does not claim a zero-sales break-even with positive costs", () => {
  const result = calculateScenario({ ...baseline, margin: 0, marginChange: 0 });
  assert.equal(result.breakEven, null);
  assert.equal(result.transactions, null);
  assert.equal(result.profit, -2600);
});
test("unknown average transaction does not produce a fictitious transaction target", () => {
  assert.equal(calculateScenario({ ...baseline, aov: 0 }).transactions, null);
});
test("valid cost savings and zero-cost zero-margin scenarios remain expressible", () => {
  assert.equal(calculateScenario({ ...baseline, costChange: -500 }).projectedFixed, 2000);
  assert.equal(calculateScenario({ ...baseline, margin: 0, marginChange: 0, fixed: 0, labour: 0, costChange: 0 }).breakEven, 0);
});
test("invalid assumptions fail instead of silently clamping or returning infinity", () => {
  for (const changed of [{ margin: 110 }, { marginChange: 70 }, { salesChange: -101 }, { sales: -1 }, { fixed: -1 }, { costChange: -3000 }, { aov: -1 }, { sales: Infinity }, { sales: NaN }, { sales: Number.MAX_VALUE }]) {
    assert.throws(() => calculateScenario({ ...baseline, ...changed }));
  }
});
test("starting scenario renders empty inputs instead of invented financial figures", () => {
  const html = renderToStaticMarkup(createElement(ScenarioPlanner, { source: null, currency: "USD" }));
  assert.match(html, /Build your scenario/);
  assert.match(html, /Net sales \(USD\)/);
  assert.doesNotMatch(html, /value="80000"|value="12000"|PROJECTED MONTHLY/);
  assert.match(html, /scenario-sales-hint/);
  assert.doesNotMatch(html, /Use source totals/);
});
test("BookLoQ formats the requested currency and preserves unavailable values", () => {
  assert.match(formatBookloqMoney(12345, "USD"), /US\$123\.45/);
  assert.match(formatBookloqMoney(12345, "EUR"), /€123\.45/);
  assert.equal(formatBookloqMoney(null, "CAD"), "Not available");
  assert.equal(formatBookloqMoney(NaN, "CAD"), "Not available");
  assert.equal(formatBookloqMoney(0, "CAD"), "$0.00");
  assert.equal(formatBookloqMoney(-0, "CAD"), "$0.00");
});
test("financial position distinguishes empty, partial, demonstration and alert states", () => {
  const input = { currentCashCents: null, revenueCents: null };
  assert.match(bookloqPositionMessage(input).title, /Build your/);
  assert.match(bookloqPositionMessage({ ...input, revenueCents: 0 }).title, /incomplete/);
  assert.match(bookloqPositionMessage({ currentCashCents: 0, revenueCents: 0 }).title, /Review/);
  assert.match(bookloqPositionMessage({ ...input, dataMode: "demonstration" }).title, /demonstration/);
  assert.equal(bookloqPositionMessage({ ...input, alert: { title: "Overdue bill", explanation: "Review it." } }).title, "Overdue bill");
});
const provider = { name: "Stripe", category: "Payments", availability: "credentials_required", status: "connected", dataPromotionStatus: "approved", lastSuccessfulSyncAt: "2026-09-04T12:00:00Z", providerReadiness: { credentialsConfigured: true, mode: "production", liveDataEligible: true } };
test("connector guidance does not confuse entitlement, credentials, authorization and approval", () => {
  assert.equal(connectorNextStep(provider, false, true).stage, "Plan access");
  assert.equal(connectorNextStep(provider, true, false).stage, "Owner action");
  assert.equal(connectorNextStep({ ...provider, providerReadiness: null }, true, true).stage, "Check status");
  assert.equal(connectorNextStep({ ...provider, providerReadiness: { ...provider.providerReadiness, credentialsConfigured: false } }, true, true).stage, "Provider setup");
  assert.equal(connectorNextStep({ ...provider, status: "not_connected" }, true, true).stage, "Authorize account");
  assert.equal(connectorNextStep({ ...provider, status: "error" }, true, true).stage, "Repair connection");
  assert.equal(connectorNextStep({ ...provider, lastSuccessfulSyncAt: null }, true, true).stage, "Import and review");
  assert.equal(connectorNextStep({ ...provider, dataPromotionStatus: "staging" }, true, true).stage, "Review source data");
  assert.equal(connectorNextStep(provider, true, true).stage, "Monitor freshness");
});
test("sandbox and unavailable connectors never advertise live results", () => {
  assert.equal(connectorNextStep({ ...provider, providerReadiness: { ...provider.providerReadiness, mode: "sandbox" } }, true, true).stage, "Test data only");
  assert.equal(connectorNextStep({ ...provider, availability: "coming_soon" }, true, true).stage, "Unavailable");
  assert.equal(connectorNextStep({ ...provider, lastSuccessfulSyncAt: null, providerReadiness: { ...provider.providerReadiness, mode: "sandbox" } }, true, true).stage, "Test data only");
  const verificationOnly = connectorNextStep({ ...provider, name: "QuickBooks", lastSuccessfulSyncAt: null, providerReadiness: { ...provider.providerReadiness, mode: "sandbox_read_only_staging", ledgerImportEnabled: false } }, true, true);
  assert.equal(verificationOnly.stage, "Company verification only");
  assert.match(verificationOnly.detail, /does not populate BookLoQ/);
});
test("provider search combines trimmed case-insensitive query and category", () => {
  const rows = [provider, { name: "Plaid", category: "Banking" }];
  assert.deepEqual(filterConnectors(rows, " STRI ", "All categories"), [provider]);
  assert.equal(filterConnectors(rows, "stripe", "Banking").length, 0);
  assert.equal(filterConnectors(rows, "", "All categories").length, 2);
});
