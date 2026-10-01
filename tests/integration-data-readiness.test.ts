import assert from "node:assert/strict";
import test from "node:test";
import { aggregateConnectionReadiness, buildConnectionDataReadiness, commerceFieldLabels, type CommerceFieldEvidence, type VerifiedReportScope } from "../domain/integration-data-readiness.ts";
import { buildProviderReportCatalog } from "../domain/provider-report-contracts.ts";
import { buildIntegrationCapabilities } from "../domain/integration-capabilities.ts";

const fields: CommerceFieldEvidence = Object.fromEntries(Object.keys(commerceFieldLabels).map(key => [key, { records: 2, populated: 2 }]));
const base = { connectionId: "account-a", commerceImplemented: true, authorised: true, approved: true, stale: false, fields };
const period = { from: "2026-09-01", to: "2026-09-30" };
const proof: VerifiedReportScope = { ...period, connectionId: "account-a", locationRefs: ["owned-location"], currency: "CAD", paginationComplete: true, reconciliationPassed: true, calculationVersion: "v1", normalizationVersion: "v1", verifiedMetricIds: ["sales_performance", "payment_mix"] };
const metric = (result: ReturnType<typeof buildConnectionDataReadiness>, id: string) => result.metrics.find(item => item.id === id)!;

test("all populated fields and date bounds still do not establish period completeness", () => {
  const result = buildConnectionDataReadiness({ ...base, observedPeriod: period });
  assert.equal(result.fields.every(field => field.state === "supported"), true);
  assert.equal(result.metrics.some(metric => metric.ready), false);
  assert.equal(result.periodVerified, false);
  assert.equal(metric(result, "gross_profit").state, "partial");
  assert.match(metric(result, "payment_mix").reason, /completeness and reconciliation/);
});

test("unknown, incomplete and empty field evidence remain distinct", () => {
  const result = buildConnectionDataReadiness({ ...base, fields: { ...fields, "lines.cost": { records: 2, populated: 1 }, "lines.customer": { records: 2, populated: 0 }, "products.cost": { records: 0, populated: 0 }, "payments.date": undefined } });
  assert.equal(result.fields.find(field => field.id === "lines.cost")?.state, "partial");
  assert.equal(result.fields.find(field => field.id === "lines.customer")?.state, "missing");
  assert.equal(result.fields.find(field => field.id === "products.cost")?.state, "missing");
  assert.equal(result.fields.find(field => field.id === "payments.date")?.records, null);
  assert.equal(metric(result, "customer_intelligence").state, "missing");
  assert.equal(metric(result, "gross_profit").ready, false);
  const corrupt = buildConnectionDataReadiness({ ...base, fields: { "lines.cost": { records: 1, populated: 2 } } });
  assert.equal(corrupt.fields.find(field => field.id === "lines.cost")?.populated, null);
});

test("only the exact account, period and metric proof supports a report", () => {
  const verified = buildConnectionDataReadiness({ ...base, requestedPeriod: period, verifiedScope: proof });
  assert.equal(metric(verified, "sales_performance").ready, true);
  assert.equal(metric(verified, "payment_mix").ready, true);
  assert.equal(metric(verified, "reorder_intelligence").ready, false, "sales reconciliation does not prove purchasing or cash constraints");
  for (const patch of [{ connectionId: "other" }, { to: "2026-10-01" }, { from: "2026-02-31" }, { paginationComplete: false }, { reconciliationPassed: false }, { currency: "" }, { locationRefs: [] }, { normalizationVersion: "" }]) {
    const result = buildConnectionDataReadiness({ ...base, requestedPeriod: period, verifiedScope: { ...proof, ...patch } });
    assert.equal(result.metrics.some(metric => metric.ready), false, JSON.stringify(patch));
  }
  const coverage = { sales: true, payments: true, products: true, inventory: true, customers: true, suppliers: true, locations: true };
  const catalog = buildProviderReportCatalog({ provider: "square", connectionId: "account-a", coverage, dataReadiness: verified });
  assert.equal(catalog.providerReports.filter(report => report.status === "ready").length, 2);
  assert.equal(catalog.providerReports.filter(report => report.implementationStatus === "planned").some(report => report.status === "ready"), false);
  assert.equal(buildProviderReportCatalog({ provider: "square", connectionId: "other", coverage, dataReadiness: verified }).providerReports.some(report => report.status === "ready"), false);
});

test("permission denial, revoked access, unimplemented adapters and stale accounts fail closed", () => {
  const denied = buildConnectionDataReadiness({ ...base, fields: { ...fields, "lines.cost": { records: 2, populated: 2, authorised: false } }, requestedPeriod: period, verifiedScope: proof });
  const cost = denied.fields.find(field => field.id === "lines.cost")!;
  assert.deepEqual([cost.state, cost.records, cost.populated], ["not_authorised", null, null]);
  assert.equal(metric(denied, "gross_profit").state, "not_authorised");
  for (const [patch, expected] of [[{ authorised: false }, "not_authorised"], [{ commerceImplemented: false }, "not_applicable"], [{ stale: true }, "stale"], [{ approved: false }, "partial"]] as const) {
    const result = buildConnectionDataReadiness({ ...base, ...patch, requestedPeriod: period, verifiedScope: proof });
    assert.equal(metric(result, "sales_performance").state, expected);
    assert.equal(result.metrics.some(metric => metric.ready), false);
    assert.equal(result.periodVerified, false);
    if (expected === "not_authorised" || expected === "not_applicable") assert.equal(result.fields.every(field => field.records === null && field.populated === null), true);
  }
});

test("account aggregation never joins complementary evidence", () => {
  const sales = buildConnectionDataReadiness({ ...base, fields: { ...fields, "payments.amount": { records: 0, populated: 0 } }, requestedPeriod: period, verifiedScope: proof });
  const payments = buildConnectionDataReadiness({ ...base, connectionId: "account-b", fields: { ...fields, "sales.net": { records: 0, populated: 0 } }, requestedPeriod: period, verifiedScope: { ...proof, connectionId: "account-b" } });
  const aggregate = aggregateConnectionReadiness([sales, payments]);
  assert.equal(aggregate.find(metric => metric.id === "payment_mix")?.ready, false);
  assert.deepEqual(aggregate.find(metric => metric.id === "sales_performance")?.readyConnectionIds, ["account-a"]);
  const result = buildIntegrationCapabilities({ id: "square", name: "Square", category: "Point of sale", availability: "credentials_required", status: "connected", dataPromotionStatus: "approved", lastSuccessfulSyncAt: new Date().toISOString(), providerReadiness: { credentialsConfigured: true, mode: "production", liveDataEligible: true },
    connections: [sales, payments].map(dataReadiness => ({ id: dataReadiness.connectionId, status: "connected", dataPromotionStatus: "approved", lastSuccessfulSyncAt: new Date().toISOString(), dataReadiness })) });
  assert.equal(result.reports.find(report => report.id === "square_payment_performance")?.ready, false);
  assert.deepEqual(result.reports.find(report => report.id === "square_sales_performance")?.readyConnectionIds, ["account-a"]);
});
