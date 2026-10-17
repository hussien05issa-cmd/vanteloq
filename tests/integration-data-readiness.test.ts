import assert from "node:assert/strict";
import test from "node:test";
import { aggregateConnectionReadiness, buildConnectionDataReadiness, buildRecordedReportReadiness, recordedDateScopeCoverage, recordedReportCatalogItem, commerceFieldLabels, type CommerceFieldEvidence, type VerifiedReportScope } from "../domain/integration-data-readiness.ts";
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

const reportEvidence = {
  organizationId: "workspace-a", connectionIds: ["source-a"], locationIds: ["shop-a"], currency: "CAD", timeZone: "America/Edmonton",
  from: "2026-09-01", to: "2026-09-02", generatedAt: "2026-09-03T12:00:00Z", authority: "ready", sourceConflict: false, sourcesAvailable: true, recordCount: 2,
  dateCoverage: recordedDateScopeCoverage({ from: "2026-09-01", to: "2026-09-02", expectedScopes: ["source-a/shop-a"], records: [{ date: "2026-09-01", scope: "source-a/shop-a" }, { date: "2026-09-02", scope: "source-a/shop-a" }] }),
  providerLastSuccessfulSyncAt: ["2026-09-03T10:00:00Z"], latestRecordUpdatedAt: "2026-09-03T10:00:01Z",
};

test("recorded report disclosure never certifies populated periods or current syncs", () => {
  const evidence = buildRecordedReportReadiness(reportEvidence);
  assert.equal(evidence.ready, false); assert.equal(evidence.certification, "not_certified"); assert.equal(evidence.state, "recorded");
  assert.equal(evidence.coverage.dateScopes?.complete, true); assert.equal(evidence.coverage.databasePaginationComplete, true);
  assert.equal(evidence.coverage.providerPaginationComplete, null); assert.equal(evidence.reconciliation, "not_verified");
  assert.match(evidence.limitations.join(" "), /all stored matching records.*Provider history/);
  const redacted = buildRecordedReportReadiness({ ...reportEvidence, connectionIds: [] });
  assert.deepEqual(redacted.scope.connectionIds, []); assert.deepEqual(redacted.scope.locationIds, ["shop-a"]);
  const conflict = buildRecordedReportReadiness({ ...reportEvidence, sourceConflict: true });
  assert.equal(conflict.state, "source_conflict"); assert.equal(conflict.ready, false);
  assert.equal(buildRecordedReportReadiness({ ...reportEvidence, recordCount: 0 }).state, "missing");
});

test("recorded date coverage keeps each outlet separate and rejects missing, duplicate or foreign scopes", () => {
  const first = [{ date: "2026-09-01", scope: "a" }, { date: "2026-09-02", scope: "a" }];
  const scope = { from: "2026-09-01", to: "2026-09-02", expectedScopes: ["a", "b", "a"] };
  const partial = recordedDateScopeCoverage({ ...scope, records: [...first, { date: "2026-09-01", scope: "b" }] });
  assert.equal(partial.observedRecords, 3); assert.equal(partial.expectedRecords, 4); assert.equal(partial.complete, false);
  assert.equal(buildRecordedReportReadiness({ ...reportEvidence, dateCoverage: partial }).state, "partial");
  const complete = [...first, { date: "2026-09-01", scope: "b" }, { date: "2026-09-02", scope: "b" }];
  assert.equal(recordedDateScopeCoverage({ ...scope, records: complete }).complete, true);
  assert.equal(recordedDateScopeCoverage({ ...scope, records: [...complete, first[0]] }).complete, false);
  assert.equal(recordedDateScopeCoverage({ ...scope, records: [...complete, { date: "2026-09-01", scope: "foreign" }] }).unknownScopeRecords, 1);
  assert.equal(recordedDateScopeCoverage({ ...scope, from: "2026-02-30", records: complete }).complete, false);
});

test("report freshness uses the oldest source and fails closed for unknown or future source stamps", () => {
  const stale = buildRecordedReportReadiness({ ...reportEvidence, providerLastSuccessfulSyncAt: ["2026-09-03T11:00:00Z", "2026-09-01T10:00:00Z"] });
  assert.equal(stale.freshness.oldestSourceSyncAt, "2026-09-01T10:00:00.000Z"); assert.equal(stale.freshness.state, "stale"); assert.equal(stale.state, "stale");
  for (const timestamps of [[], [null], ["invalid"], ["2026-09-03T13:00:00Z"], ["2026-09-03T11:00:00Z", null]]) {
    const result = buildRecordedReportReadiness({ ...reportEvidence, providerLastSuccessfulSyncAt: timestamps });
    assert.equal(result.freshness.state, "unknown"); assert.equal(result.freshness.oldestSourceSyncAt, null); assert.equal(result.ready, false);
  }
});

test("catalogue row presence enables only an uncertified recorded view, never a Ready claim", () => {
  const catalog = buildProviderReportCatalog({ provider: "square", connectionId: "a", coverage: { sales: true, payments: true, products: true, inventory: true, customers: true, suppliers: true, locations: true } });
  const result = catalog.providerReports.map(item => recordedReportCatalogItem(item));
  assert.equal(result.some(item => item.status === "ready" as string), false);
  assert.equal(result.find(item => item.presentation === "sales")?.recordedDataAvailable, true);
  assert.equal(result.filter(item => item.implementationStatus === "planned").some(item => item.recordedDataAvailable), false);
  assert.equal(recordedReportCatalogItem(catalog.providerReports[0], true).recordedDataAvailable, false);
  assert.match(result[0].readinessReason, /not been verified/);
});
