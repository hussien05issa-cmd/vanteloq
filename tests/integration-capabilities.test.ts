import assert from "node:assert/strict";
import test from "node:test";
import { buildIntegrationCapabilities, type IntegrationCapabilityInput } from "../domain/integration-capabilities.ts";
import { connectorHealth } from "../domain/connector-guidance.ts";
import { buildProviderReportCatalog } from "../domain/provider-report-contracts.ts";

const coverage = { sales: true, payments: true, products: true, inventory: true, customers: true, suppliers: true, locations: true };
const base: IntegrationCapabilityInput = { id: "square", name: "Square", category: "Point of sale", status: "connected", availability: "credentials_required", dataPromotionStatus: "approved", lastSuccessfulSyncAt: new Date(Date.now() - 60_000).toISOString(), providerReadiness: { credentialsConfigured: true, mode: "production", liveDataEligible: true }, canonicalCoverage: coverage };
const capability = (id: string, patch: Partial<IntegrationCapabilityInput> = {}) => buildIntegrationCapabilities({ ...base, id, ...patch });

test("capabilities compose implemented report contracts rather than offering planned reports", () => {
  const result = capability("square");
  const expected = buildProviderReportCatalog({ provider: "square", connectionId: "test", coverage }).providerReports.filter(report => report.implementationStatus === "available");
  assert.deepEqual(result.reports.map(report => report.id), expected.map(report => report.id));
  assert.equal(result.reports.every(report => report.ready), false, "record class booleans cannot prove report completeness");
  assert.equal(result.reports.some(report => report.id.includes("product_performance")), false);
});

test("record coverage and approval are both required for reports", () => {
  const missing = capability("square", { canonicalCoverage: { ...coverage, payments: false } });
  const payment = missing.reports.find(report => report.id === "square_payment_performance")!;
  assert.equal(payment.ready, false);
  assert.deepEqual(payment.missingRecords, ["payments"]);
  for (const patch of [{ dataPromotionStatus: "staging" }, { lastSuccessfulSyncAt: null }, { status: "error" }, { reportingEnvironment: "sandbox" as const }]) {
    assert.equal(capability("square", patch).reports.some(report => report.ready), false);
  }
});

test("an unreviewed sibling account does not gain reporting eligibility from the aggregate", () => {
  const result = capability("square", { connections: [base, { ...base, dataPromotionStatus: "staging" }] });
  assert.equal(result.reportingEligibility, "review_required");
  assert.equal(result.reports.some(report => report.ready), false);
});

test("payment-only adapters do not advertise sales, inventory or accounting reports", () => {
  for (const id of ["stripe", "moneris"]) {
    const result = capability(id);
    assert.equal(result.direction, "inbound");
    assert.equal(result.reportingEligibility, "review_only");
    assert.deepEqual(result.reports, []);
    assert.equal(result.records.some(record => ["sales", "inventory", "bank_transactions"].includes(record.id)), false);
  }
  assert.deepEqual(capability("moneris").records.map(record => record.id), ["payments"]);
  assert.match(capability("moneris").limitations.join(" "), /settlement reconciliation is incomplete/);
  assert.match(capability("stripe").limitations.join(" "), /separate from paying for a Vanteloq subscription/);
});

test("the POS record list does not promise suppliers for adapters that do not import them", () => {
  for (const id of ["square", "clover", "shopify", "shopify-pos"]) assert.equal(capability(id).records.some(record => record.id === "suppliers"), false, id);
  for (const id of ["lightspeed-r", "lightspeed"]) assert.equal(capability(id).records.some(record => record.id === "suppliers"), true, id);
  assert.equal(capability("square").actions.some(action => action.direction === "outbound"), false);
});

test("staged production evidence is not mislabeled as sandbox credentials", () => {
  const staged = { ...base, dataPromotionStatus: "staging", providerReadiness: { credentialsConfigured: true, mode: "read_only_staging" } };
  assert.equal(connectorHealth(staged).state, "review_required");
  assert.equal(connectorHealth({ ...staged, providerReadiness: { ...staged.providerReadiness, mode: "sandbox_read_only_staging" } }).state, "test_only");
});

test("QuickBooks company authorization is not ledger coverage", () => {
  const result = capability("quickbooks");
  assert.equal(result.scope, "identity_only");
  assert.equal(result.reportingEligibility, "not_applicable");
  assert.deepEqual(result.records.map(record => record.id), ["company_identity"]);
  assert.deepEqual(result.reports, []);
  assert.equal(result.actions.some(action => action.id === "import_records"), false);
});

test("Deel describes finalized aggregate evidence without offering payroll execution", () => {
  const result = capability("deel");
  assert.equal(result.reportingEligibility, "review_only");
  assert.deepEqual(result.reports, []);
  assert.equal(result.actions.every(action => action.direction !== "outbound"), true);
  assert.match(result.limitations.join(" "), /does not run payroll/);
  assert.match(result.limitations.join(" "), /Employee records, banking details and payslip files are not imported/);
});

test("Slack is outbound-only and each supported message requires confirmation", () => {
  const result = capability("slack");
  assert.equal(result.direction, "outbound");
  assert.equal(result.reportingEligibility, "not_applicable");
  assert.equal(result.freshness.model, "not_applicable");
  assert.deepEqual(result.records.map(record => record.id), ["channel"]);
  assert.deepEqual(result.actions.map(action => action.id), ["send_test", "share_workspace"]);
  assert.equal(result.actions.every(action => action.direction === "outbound" && action.confirmationRequired), true);
  assert.match(result.limitations.join(" "), /Automatic alerts and incoming Slack activity are not enabled/);
});

test("marketing capabilities separate optional Ads access and confirmed provider changes", () => {
  assert.equal(capability("google").records.some(record => record.id === "ad_metrics"), false);
  const google = capability("google", { providerReadiness: { ...base.providerReadiness!, supportedDatasets: ["google_ads"] } });
  assert.equal(google.records.some(record => record.id === "ad_metrics"), true);
  for (const id of ["google", "meta"]) {
    const result = capability(id);
    assert.equal(result.actions.filter(action => action.direction === "outbound").every(action => action.confirmationRequired), true);
    assert.deepEqual(result.reports, [], "marketing measurements must not masquerade as commerce sales reports");
  }
  assert.match(capability("meta").limitations.join(" "), /organic insights are not imported/);
});

test("freshness does not invent background jobs for connections without a schedule", () => {
  assert.equal(capability("square").freshness.model, "on_demand");
  const automaticSync = { configured: true, healthy: true, enabled: false, status: "off", lastErrorCode: null, intervalMinutes: 15 };
  const result = capability("square", { automaticSync });
  assert.equal(result.freshness.model, "scheduled_or_manual");
  assert.match(result.freshness.detail, /enable the available/);
  assert.equal(capability("slack", { automaticSync }).freshness.model, "not_applicable");
});

test("unimplemented and unknown catalog entries fail closed even with fabricated coverage", () => {
  for (const id of ["xero", "doordash", "uber-eats", "future-provider"]) {
    const result = capability(id);
    assert.equal(result.scope, "unimplemented");
    assert.equal(result.publiclyAvailable, false);
    assert.equal(result.reportingEligibility, "unavailable");
    assert.deepEqual(result.actions, []);
    assert.deepEqual(result.records, []);
    assert.deepEqual(result.reports, []);
  }
  assert.equal(capability("square", { providerReadiness: null }).publiclyAvailable, false);
});
