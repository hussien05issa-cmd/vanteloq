export const PAYROLL_SOURCE_BOUNDARY = "Deel provides staged, currency-level payroll-report aggregates for review. Report availability does not verify payroll finality, approval, wages, deductions owed or payment. These records do not post journals, taxes, payroll liabilities or cash movements. Retained reports do not record their source environment, so sandbox or production provenance is unverified. No individual compensation or employee records are shown.";

export type BookloqPayrollSource = {
  provider: "deel";
  status: "restricted" | "unavailable" | "not_connected" | "needs_review" | "staged";
  configuredEnvironment: "sandbox" | "production" | null;
  recordEnvironment: "unverified";
  connections: {
    id: string; accountName: string; status: string; promotionStatus: string;
    lastSuccessfulSyncAt: number | null; mappedLocationCount: number; reportCount: number;
    latestReportPeriod: { start: string; end: string } | null;
    lastImportedAt: number | null; reviewReasons: string[];
  }[];
  boundary: string;
};

export type PayrollSourceRow = {
  id: string; accountName: string | null; status: string; promotionStatus: string;
  lastSuccessfulSyncAt: number | null; mappedLocationCount: number;
  lastErrorCode: string | null; syncLeaseOwner: string | null;
  latestSyncStatus: string | null; latestWarningCount: number | null;
  reportId: string | null; periodFrom: string | null; periodTo: string | null;
  importedAtMs: number | null;
};

export function bookloqPayrollSourceAllowed(permissions: readonly string[], role: string) {
  return ["owner", "admin", "manager"].includes(role)
    && ["payroll.totals", "integrations.view"].every(permission => permissions.includes(permission));
}

const validDate = (value: string | null): value is string => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const seconds = (value: number | null) => Number.isSafeInteger(value) && Number(value) > 0 ? value : null;

export function emptyBookloqPayrollSource(status: BookloqPayrollSource["status"], reason?: string): BookloqPayrollSource {
  return { provider: "deel", status, configuredEnvironment: null, recordEnvironment: "unverified", connections: [],
    boundary: reason ? `${reason} ${PAYROLL_SOURCE_BOUNDARY}` : PAYROLL_SOURCE_BOUNDARY };
}

export function buildBookloqPayrollSource(rows: readonly PayrollSourceRow[], configuredEnvironment: "sandbox" | "production"): BookloqPayrollSource {
  const result = emptyBookloqPayrollSource("not_connected");
  result.configuredEnvironment = configuredEnvironment;
  const groups = new Map<string, PayrollSourceRow[]>();
  for (const row of rows) { const group = groups.get(row.id) ?? []; group.push(row); groups.set(row.id, group); }
  for (const [id, group] of groups) {
    const first = group[0], reasons = new Set<string>();
    if (first.status !== "connected") reasons.add("Connection requires attention in Integrations.");
    if (!["staging", "approved"].includes(first.promotionStatus)) reasons.add("Source access is blocked.");
    if (first.lastErrorCode || first.latestSyncStatus === "failed") reasons.add("The latest synchronization needs review.");
    if (first.syncLeaseOwner || first.latestSyncStatus === "running") reasons.add("Synchronization is in progress. Review after it completes.");
    if (first.latestWarningCount) reasons.add("The latest synchronization reported incomplete evidence.");
    if (!first.mappedLocationCount) reasons.add("Map a legal entity to a business location in Integrations.");
    const reports = [...new Map(group.filter(row => row.reportId).map(row => [row.reportId, row])).values()];
    const invalid = reports.some(row => !validDate(row.periodFrom) || !validDate(row.periodTo) || row.periodFrom > row.periodTo || !seconds(row.importedAtMs));
    if (invalid) reasons.add("Retained report dates could not be verified. Review the source.");
    const usable = invalid ? [] : reports;
    const latest = [...usable].sort((a, b) => b.periodTo!.localeCompare(a.periodTo!) || b.periodFrom!.localeCompare(a.periodFrom!))[0];
    if (!usable.length) reasons.add("No available report aggregates were found for this connection and location scope.");
    result.connections.push({ id, accountName: first.accountName || "Deel organization", status: first.status,
      promotionStatus: first.promotionStatus, lastSuccessfulSyncAt: seconds(first.lastSuccessfulSyncAt),
      mappedLocationCount: first.mappedLocationCount, reportCount: usable.length,
      latestReportPeriod: latest ? { start: latest.periodFrom!, end: latest.periodTo! } : null,
      lastImportedAt: usable.length ? Math.floor(Math.max(...usable.map(row => row.importedAtMs!)) / 1000) : null,
      reviewReasons: [...reasons] });
  }
  if (result.connections.length) result.status = result.connections.some(connection => connection.reviewReasons.length) ? "needs_review" : "staged";
  return result;
}
