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
