/** Availability of a field is distinct from a verified reporting period. */
export type DataReadinessState = "supported" | "missing" | "partial" | "stale" | "not_authorised" | "not_applicable";
export const dataReadinessStateLabels: Record<DataReadinessState, string> = { supported: "Present", missing: "Missing data", partial: "Needs review", stale: "Update overdue", not_authorised: "Permission required", not_applicable: "Not applicable" };
export type FieldObservation = { records: number; populated: number; authorised?: boolean };
export type CommerceFieldKey = "sales.net" | "sales.date" | "lines.net" | "lines.date" | "lines.quantity" | "lines.cost" | "lines.customer" | "lines.product" | "payments.amount" | "payments.date" | "payments.sale" | "payments.type" | "products.identity" | "products.cost" | "inventory.quantity" | "inventory.updated" | "customers.identity" | "suppliers.identity" | "locations.mapping";
export type CommerceFieldEvidence = Partial<Record<CommerceFieldKey, FieldObservation>>;
export type VerifiedReportScope = { connectionId: string; from: string; to: string; locationRefs: readonly string[]; currency: string; paginationComplete: boolean; reconciliationPassed: boolean; calculationVersion: string; normalizationVersion: string; verifiedMetricIds: readonly string[] };
export const commerceFieldLabels: Record<CommerceFieldKey, string> = {
  "sales.net": "Net sales", "sales.date": "Business dates", "lines.net": "Line net sales", "lines.date": "Line sale dates", "lines.quantity": "Line quantities", "lines.cost": "Known line costs", "lines.customer": "Customer references on sale lines", "lines.product": "Product references on sale lines",
  "payments.amount": "Payment amounts", "payments.date": "Payment dates", "payments.sale": "Sale references on payments", "payments.type": "Source tender names", "products.identity": "Product references", "products.cost": "Known product costs", "inventory.quantity": "Stock quantities", "inventory.updated": "Stock record update dates", "customers.identity": "Customer references", "suppliers.identity": "Supplier references", "locations.mapping": "Mapped locations",
};
const dependencies: readonly { id: string; label: string; fields: readonly CommerceFieldKey[]; requiredEvidence: readonly string[] }[] = [
  { id: "sales_performance", label: "Sales performance", fields: ["sales.net", "sales.date", "locations.mapping"], requiredEvidence: [] },
  { id: "payment_mix", label: "Payment mix", fields: ["sales.net", "payments.amount", "payments.date", "payments.sale", "payments.type", "locations.mapping"], requiredEvidence: ["Sale-to-payment reconciliation for the selected period"] },
  { id: "gross_profit", label: "Gross profit", fields: ["lines.net", "lines.quantity", "lines.cost", "lines.date", "locations.mapping"], requiredEvidence: ["Attributable costs for every included sale and return"] },
  { id: "inventory_health", label: "Inventory health", fields: ["products.identity", "inventory.quantity", "inventory.updated", "lines.quantity", "lines.date", "lines.product", "locations.mapping"], requiredEvidence: ["Dated stock and complete demand history for the selected location"] },
  { id: "reorder_intelligence", label: "Reorder planning", fields: ["products.identity", "inventory.quantity", "inventory.updated", "lines.quantity", "lines.date", "lines.product", "suppliers.identity"], requiredEvidence: ["Reviewed receipts, reservations, lead times and purchase commitments", "Verified cash constraints when used"] },
  { id: "customer_intelligence", label: "Customer activity", fields: ["customers.identity", "lines.customer", "lines.date"], requiredEvidence: ["Stable customer matching and the required observation history"] },
  { id: "supplier_performance", label: "Supplier coverage", fields: ["products.identity", "suppliers.identity", "inventory.quantity"], requiredEvidence: ["Reviewed product-to-supplier links"] },
  { id: "location_comparison", label: "Location comparison", fields: ["locations.mapping", "sales.net", "sales.date", "inventory.quantity"], requiredEvidence: ["Compatible periods, currency and source authority across selected locations"] },
];
const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

export function buildConnectionDataReadiness(input: {
  connectionId: string; commerceImplemented: boolean; authorised: boolean; approved: boolean; stale: boolean;
  fields?: CommerceFieldEvidence; observedPeriod?: { from: string | null; to: string | null };
  requestedPeriod?: { from: string; to: string } | null; verifiedScope?: VerifiedReportScope | null;
}) {
  const fields = Object.entries(commerceFieldLabels).map(([id, label]) => {
    const observation = input.fields?.[id as CommerceFieldKey];
    const permitted = input.commerceImplemented && input.authorised && observation?.authorised !== false;
    const valid = observation && Number.isSafeInteger(observation.records) && Number.isSafeInteger(observation.populated) && observation.records >= 0 && observation.populated >= 0 && observation.populated <= observation.records;
    const records = valid && permitted ? observation.records : null;
    const populated = valid && permitted ? observation.populated : null;
    const state: DataReadinessState = !input.commerceImplemented ? "not_applicable" : !permitted ? "not_authorised" : !input.approved ? "partial" : input.stale ? "stale" : records === null ? "partial" : records === 0 || populated === 0 ? "missing" : populated === records ? "supported" : "partial";
    return { id: id as CommerceFieldKey, label, state, records, populated, scope: "observed_imported_records" as const };
  });
  const proof = input.verifiedScope;
  const periodVerified = Boolean(input.commerceImplemented && input.authorised && input.approved && !input.stale && input.requestedPeriod && proof && proof.connectionId === input.connectionId && proof.from === input.requestedPeriod.from && proof.to === input.requestedPeriod.to
    && isDate(proof.from) && isDate(proof.to) && proof.from <= proof.to
    && proof.locationRefs.length && proof.locationRefs.every(ref => ref.trim().length > 0) && /^[A-Z]{3}$/.test(proof.currency) && proof.paginationComplete && proof.reconciliationPassed && proof.calculationVersion && proof.normalizationVersion);
  const metrics = dependencies.map(contract => {
    const required = contract.fields.map(id => fields.find(field => field.id === id)!);
    const missingFields = required.filter(field => field.state !== "supported").map(field => field.id);
    const state: DataReadinessState = !input.commerceImplemented ? "not_applicable" : !input.authorised || required.some(field => field.state === "not_authorised") ? "not_authorised"
      : input.stale ? "stale" : required.some(field => field.state === "missing") ? "missing" : input.approved && !missingFields.length && periodVerified && proof?.verifiedMetricIds.includes(contract.id) ? "supported" : "partial";
    return { ...contract, state, missingFields, ready: state === "supported", reason: state === "not_applicable" ? "This adapter does not supply canonical commerce reports."
      : state === "not_authorised" ? "The connection or your permissions do not authorize the required evidence."
      : state === "stale" ? "Refresh this account before relying on current results."
      : state === "missing" ? "Required fields are absent from this account's imported records."
      : !input.approved ? "Import and review this account's records first."
      : !periodVerified ? "Record presence is known; a report must verify its dates, locations, currency, completeness and reconciliation."
      : missingFields.length ? "Some required imported fields remain incomplete." : state !== "supported" ? "The metric's specific dependencies still require report validation." : "Verified for the explicit report scope." };
  });
  return { connectionId: input.connectionId, fields, metrics, observedPeriod: input.commerceImplemented && input.authorised && input.fields?.["sales.date"]?.authorised !== false ? input.observedPeriod ?? { from: null, to: null } : { from: null, to: null },
    requestedPeriod: input.requestedPeriod ?? null, periodVerified, verifiedScope: periodVerified ? proof : null,
    boundary: "Observed record counts and date bounds do not prove a complete reporting period. No values are inferred from missing fields. Accounts are assessed separately." };
}
export type ConnectionDataReadiness = ReturnType<typeof buildConnectionDataReadiness>;

export function aggregateConnectionReadiness(connections: readonly ConnectionDataReadiness[]) {
  return dependencies.map(contract => {
    const scopes = connections.map(connection => ({ connectionId: connection.connectionId, ...connection.metrics.find(metric => metric.id === contract.id)! }));
    const readyConnectionIds = scopes.filter(scope => scope.ready).map(scope => scope.connectionId);
    const state: DataReadinessState = readyConnectionIds.length ? "supported" : !scopes.length ? "missing"
      : scopes.every(scope => scope.state === "not_applicable") ? "not_applicable" : scopes.every(scope => scope.state === "not_authorised") ? "not_authorised"
      : scopes.every(scope => scope.state === "stale") ? "stale" : scopes.every(scope => scope.state === "missing") ? "missing" : "partial";
    return { ...contract, state, ready: readyConnectionIds.length > 0, readyConnectionIds, connections: scopes,
      reason: readyConnectionIds.length ? "Ready only in the listed verified account scopes; this does not authorize combining them." : "Review each account's fields and report scope. Evidence from different accounts is never combined to satisfy a dependency." };
  });
}

/** Coverage of recorded dates, not attestation that a provider returned every transaction. */
export function recordedDateScopeCoverage(input: { from: string | null; to: string | null; expectedScopes: readonly string[]; records: readonly { date: string; scope: string }[] }) {
  const expectedScopes = new Set(input.expectedScopes);
  const validPeriod = input.from !== null && input.to !== null && isDate(input.from) && isDate(input.to) && input.from <= input.to;
  const days = validPeriod ? (Date.parse(input.to!) - Date.parse(input.from!)) / 86_400_000 + 1 : 0;
  const inPeriod = input.records.filter(row => validPeriod && isDate(row.date) && row.date >= input.from! && row.date <= input.to!);
  const expectedObservations = inPeriod.filter(row => expectedScopes.has(row.scope));
  const observations = new Set(expectedObservations.map(row => JSON.stringify([row.date, row.scope])));
  const duplicateRecords = expectedObservations.length - observations.size;
  const unknownScopeRecords = inPeriod.filter(row => !expectedScopes.has(row.scope)).length;
  const expectedRecords = days * expectedScopes.size;
  return { observedRecords: observations.size, expectedRecords, expectedDays: days, expectedScopes: expectedScopes.size, unknownScopeRecords, duplicateRecords,
    complete: expectedRecords > 0 && observations.size === expectedRecords && unknownScopeRecords === 0 && duplicateRecords === 0,
    rate: expectedRecords > 0 ? observations.size / expectedRecords : null };
}

/** Reports can expose recorded facts before independent completeness and reconciliation
 * proof exists. This shared disclosure deliberately cannot certify from row counts. */
export function buildRecordedReportReadiness(input: {
  organizationId: string; connectionIds: readonly string[]; locationIds: readonly string[];
  currency: string; timeZone: string; from: string | null; to: string | null; generatedAt: string;
  authority: string; sourceConflict: boolean; sourcesAvailable: boolean; recordCount: number;
  dateCoverage: ReturnType<typeof recordedDateScopeCoverage> | null;
  providerLastSuccessfulSyncAt: readonly (string | null)[]; latestRecordUpdatedAt: string | null;
  limitations?: readonly string[];
}) {
  const checked = Date.parse(input.generatedAt);
  const syncs = input.providerLastSuccessfulSyncAt.map(value => value === null ? NaN : Date.parse(value));
  const knownSyncs = Number.isFinite(checked) && syncs.length > 0 && syncs.every(value => Number.isFinite(value) && value <= checked + 300_000);
  const oldestSourceSyncAt = knownSyncs ? new Date(Math.min(...syncs)).toISOString() : null;
  const freshnessState = !knownSyncs ? "unknown" : checked - Math.min(...syncs) > 36 * 3_600_000 ? "stale" : "current";
  const limitations = [...(input.limitations ?? [])];
  if (input.sourceConflict) limitations.push("Overlapping source authority must be resolved before consolidated totals are used.");
  if (!input.sourcesAvailable) limitations.push("At least one selected source has no available approved evidence.");
  if (input.dateCoverage && !input.dateCoverage.complete) limitations.push("Recorded dates do not cover every selected source scope. Missing dates are unknown, not verified closures or zero activity.");
  if (!input.dateCoverage) limitations.push("Payment activity does not establish complete daily sales or a reconciled collection period.");
  if (freshnessState === "stale") limitations.push("At least one selected provider has not completed a successful sync in the last 36 hours.");
  if (freshnessState === "unknown") limitations.push("Provider sync freshness is unavailable; record update timestamps are not provider completeness evidence.");
  limitations.push("Complete database pagination only means all stored matching records were read. Provider history coverage, late-arriving records and reconciliation are not certified.");
  return {
    ready: false as const, certification: "not_certified" as const,
    state: input.sourceConflict ? "source_conflict" : !input.recordCount ? "missing" : !input.sourcesAvailable || input.dateCoverage && !input.dateCoverage.complete ? "partial" : freshnessState === "stale" ? "stale" : "recorded",
    scope: { organizationId: input.organizationId, connectionIds: [...input.connectionIds], locationIds: [...input.locationIds], currency: input.currency, timeZone: input.timeZone, from: input.from, to: input.to },
    authority: input.authority,
    coverage: { databasePaginationComplete: true, providerPaginationComplete: null, dateScopes: input.dateCoverage },
    freshness: { state: freshnessState, oldestSourceSyncAt, latestRecordUpdatedAt: input.latestRecordUpdatedAt, checkedAt: input.generatedAt, thresholdHours: 36 },
    calculationVersion: "recorded-report-evidence-v1", normalizationVersion: null, reconciliation: "not_verified" as const,
    limitations,
  };
}

/** Existing catalogue coverage only establishes that a recorded view can open. */
export function recordedReportCatalogItem<T extends { status: "ready" | "needs_data"; implementationStatus: "available" | "planned"; dataNeeded: readonly string[] }>(item: T, sourceConflict = false) {
  return { ...item, status: "needs_data" as const,
    recordedDataAvailable: !sourceConflict && item.implementationStatus === "available" && item.status === "ready",
    readinessReason: sourceConflict ? "Resolve source authority before opening this consolidated view." : "Recorded facts may be inspected; complete period and metric reconciliation have not been verified.",
    dataNeeded: [...item.dataNeeded, ...(item.implementationStatus === "available" ? [sourceConflict ? "source authority selection" : "verified period and metric reconciliation"] : [])],
  };
}
