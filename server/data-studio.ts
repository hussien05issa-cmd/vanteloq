import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { getD1, getDb, getRuntimeEnv } from "../db";
import { dailyBusinessMetrics } from "../db/schema";
import { ApiError } from "./api";
import { requireAccess } from "./authorization";
import { effectivePermissions, requirePermission, type PermissionKey } from "./permissions";
import { authorizedLocationDataScope } from "./location-access";
import { commerceSourceAuthority } from "./integrations/source-authority";
import { authoritativeDailySalesScope } from "./integrations/daily-sales-scope";
import { approvedFactSource } from "./integrations/trusted-data";
import { getTenantEntitlements } from "./entitlements/engine";
import { canReadCompleteBookLoQLedger } from "./bookloq-ledger-view";
import { loadBookloqDatedReport } from "./bookloq-reports";
import { isLedgerCashAccount, ledgerIntelligence } from "../domain/executive-metrics";
import { businessClock } from "../domain/intraday-sales";
import { STUDIO_MAX_RECORDS, STUDIO_MAX_RESULT_BYTES, STUDIO_VERSION,
  studioHash, studioRecordedUtc, studioSalesSummary, validateStudioScope, type StudioScope, type StudioExecutiveReview, type StudioSalesRow } from "../domain/data-studio";

const readers = ["owner", "admin", "manager", "employee", "read_only"] as const;

export async function studioPolicy(request: Request, scope: StudioScope, exporting: boolean) {
  if (getRuntimeEnv().DATA_STUDIO_ENABLED === "false") throw new ApiError(503, "STUDIO_PAUSED", "Data Studio is temporarily paused. Your existing reports remain available.");
  const context = await requireAccess(request, readers, exporting ? "reporting.exports" : "reporting.basic");
  const clock = businessClock(new Date(), context.organization.timezone);
  if (!clock || !/^[A-Z]{3}$/.test(context.organization.currency)) throw new ApiError(409, "STUDIO_SETTINGS_REVIEW", "Review the business currency and time zone in Settings before preparing a workbook.");
  validateStudioScope(scope, clock.date);
  await requirePermission(context, "reports.operational");
  await requirePermission(context, "metrics.revenue");
  if (exporting) await requirePermission(context, "reports.export");
  const permissions = await effectivePermissions(context);
  const location = await authorizedLocationDataScope(context, scope.location);
  const localLocationIds = location.locationIds ?? location.locations.map(row => row.id);
  const authority = await commerceSourceAuthority({ organizationId: context.organizationId, localLocationIds, factFamily: "sales" });
  if (scope.connection && (!permissions.includes("integrations.view") || !authority.candidates.some(row => row.connectionId === scope.connection && row.availability === "ready"))) throw new ApiError(403, "STUDIO_SOURCE_UNAVAILABLE", "Choose an approved reporting source mapped to a location you can access.");
  const entitlements = await getTenantEntitlements(context);
  const fingerprint = await studioHash({ user: context.userId, organization: context.organizationId, role: context.role,
    permissions: [...permissions].sort(), locations: [...localLocationIds].sort(),
    locationRefs: location.locationRefs === null ? null : [...location.locationRefs].sort(),
    currency: context.organization.currency, timeZone: context.organization.timezone,
    features: [...entitlements.features].sort(), addon: [...entitlements.addons].sort(),
    authority: { status: authority.status, selections: authority.selections.map(({ connectionId, localLocationId, metricLocationRef, channel }) => ({ connectionId, localLocationId, metricLocationRef, channel })),
      conflicts: authority.conflicts.map(({ localLocationId, channel, expectedVersion }) => ({ localLocationId, channel, expectedVersion })),
      candidates: authority.candidates.map(({ connectionId, localLocationId, metricLocationRef, availability }) => ({ connectionId, localLocationId, metricLocationRef, availability })) } });
  return { context, permissions, location, localLocationIds, authority, entitlements, fingerprint };
}
export type StudioPolicy = Awaited<ReturnType<typeof studioPolicy>>;

/** This input is trusted server policy, never submitted tenant or SQL authority.
 * One bounded read transaction captures every accepted row. There is no paging. */
export async function studioDailyRows(input: {
  organizationId: string; scope: StudioScope; permissions: readonly PermissionKey[];
  localLocationIds: readonly string[]; locationRefs: readonly string[] | null;
  authority: Awaited<ReturnType<typeof commerceSourceAuthority>>;
}): Promise<StudioSalesRow[]> {
  const { permissions, authority, scope } = input;
  const canProfit = permissions.includes("metrics.profit"), canRefunds = permissions.includes("sales.refunds"), canSources = permissions.includes("integrations.view");
  // Raw D1 batch results do not use Drizzle's row mapper. Alias every key explicitly.
  const columns = { id: sql<string>`CAST(${dailyBusinessMetrics.id} AS TEXT)`.as("id"), businessDate: sql`${dailyBusinessMetrics.businessDate}`.as("businessDate"), locationRef: sql`${dailyBusinessMetrics.locationRef}`.as("locationRef"),
    netSalesCents: sql`${dailyBusinessMetrics.netSalesCents}`.as("netSalesCents"), transactionCount: sql`${dailyBusinessMetrics.transactionCount}`.as("transactionCount"), unitsSold: sql`${dailyBusinessMetrics.unitsSold}`.as("unitsSold"),
    sourceConnectionId: sql`${dailyBusinessMetrics.sourceConnectionId}`.as("sourceConnectionId"), sourceProvider: sql`${dailyBusinessMetrics.sourceProvider}`.as("sourceProvider"),
    updatedAt: sql`${dailyBusinessMetrics.updatedAt}`.as("updatedAt"),
    ...(canProfit ? { costOfGoodsCents: sql`${dailyBusinessMetrics.costOfGoodsCents}`.as("costOfGoodsCents") } : {}),
    ...(canRefunds ? { discountsCents: sql`${dailyBusinessMetrics.discountsCents}`.as("discountsCents"), refundsCents: sql`${dailyBusinessMetrics.refundsCents}`.as("refundsCents") } : {}),
    ...(canSources ? { sourceImportId: sql`${dailyBusinessMetrics.sourceImportId}`.as("sourceImportId") } : {}) };
  const filters = [eq(dailyBusinessMetrics.organizationId, input.organizationId),
    gte(dailyBusinessMetrics.businessDate, scope.from), lte(dailyBusinessMetrics.businessDate, scope.to),
    approvedFactSource(dailyBusinessMetrics.organizationId, dailyBusinessMetrics.sourceProvider, dailyBusinessMetrics.sourceConnectionId),
    authoritativeDailySalesScope({ authority, localLocationIds: input.localLocationIds, locationRestricted: input.locationRefs !== null, requestedConnectionId: scope.connection }),
    ...(input.locationRefs === null ? [] : [inArray(dailyBusinessMetrics.locationRef, [...input.locationRefs])])];
  const compiled = getDb().select(columns).from(dailyBusinessMetrics).where(and(...filters))
    .orderBy(asc(dailyBusinessMetrics.businessDate), asc(dailyBusinessMetrics.id)).limit(STUDIO_MAX_RECORDS + 1).toSQL();
  const [result] = await getD1().batch([getD1().prepare(compiled.sql).bind(...compiled.params)]);
  const rows = result.results as Array<Record<string, unknown>>;
  if (rows.length > STUDIO_MAX_RECORDS) throw new ApiError(409, "STUDIO_SCOPE_TOO_LARGE", `This scope exceeds ${STUDIO_MAX_RECORDS.toLocaleString("en-CA")} recorded daily rows. Choose a shorter period or one location. No partial report was exported.`);
  return rows.map(row => {
    const connection = row.sourceConnectionId === null ? null : String(row.sourceConnectionId);
    const provider = row.sourceProvider === null ? "manual" : String(row.sourceProvider);
    const costKnown = !connection && (provider === "manual" || provider === "");
    return { id: String(row.id), businessDate: String(row.businessDate), locationRef: String(row.locationRef),
      sourceKind: connection ? "provider_summary" as const : "owner_summary" as const,
      netSalesCents: Number(row.netSalesCents), transactionCount: Number(row.transactionCount), unitsSold: Number(row.unitsSold),
      ...(canProfit ? { costOfGoodsCents: costKnown ? Number(row.costOfGoodsCents) : null } : {}),
      ...(canRefunds ? { discountsCents: Number(row.discountsCents), refundsCents: Number(row.refundsCents) } : {}),
      ...(canSources ? { sourceProvider: provider, sourceConnectionId: connection, sourceImportId: row.sourceImportId === null ? null : String(row.sourceImportId) } : {}),
      updatedUtc: studioRecordedUtc(Number(row.updatedAt)) };
  });
}

export async function executiveReview(policy: StudioPolicy, scope: StudioScope): Promise<StudioExecutiveReview> {
  const { context, permissions, location, authority, localLocationIds, entitlements } = policy;
  if (location.locations.some(row => localLocationIds.includes(row.id) && row.currency !== context.organization.currency)) throw new ApiError(409, "STUDIO_CURRENCY_REVIEW", "Selected locations use different currencies. Select one currency-aligned location. No conversion or combined total is performed.");
  const blocked = !scope.connection && authority.status === "conflict";
  const needsData = scope.connection ? authority.candidates.some(row => row.connectionId === scope.connection && row.availability !== "ready") : authority.status === "needs_data";
  const rows = blocked || needsData ? [] : await studioDailyRows({ organizationId: context.organizationId, scope, permissions, localLocationIds, locationRefs: location.locationRefs, authority });
  const extractionUtc = new Date().toISOString();
  let summary = rows.length ? studioSalesSummary(rows) : null;
  if (summary && !permissions.includes("metrics.profit")) summary = { ...summary, costOfGoodsCents: null, grossProfitCents: null, grossMargin: null };
  const salesReason = blocked ? "Resolve overlapping source authority before analysing consolidated totals." : needsData ? "At least one selected source needs approved records." : rows.length ? null : "No accepted sales records were found for this scope. Missing days are unknown, not zero sales.";
  const permittedLedger = location.organizationWide && !scope.location && !scope.connection && canReadCompleteBookLoQLedger(permissions)
    && entitlements.addons.includes("bookloq") && entitlements.features.includes("bookloq.financial_statements") && permissions.includes("finance.export");
  let ledger: StudioExecutiveReview["ledger"];
  let inventory: StudioExecutiveReview["inventory"] = { state: permittedLedger ? "unavailable" : "restricted", reason: permittedLedger ? "No dated posted inventory balance is available." : "Posted financial sections are outside this report's permitted scope." };
  let cash: StudioExecutiveReview["cash"] = { state: permittedLedger ? "unavailable" : "restricted", reason: permittedLedger ? "No dated posted cash balance is available. A bank connection or bank CSV is not automatically a posted cash-flow statement." : "Posted financial sections are outside this report's permitted scope." };
  if (permittedLedger) {
    try {
      const report = await loadBookloqDatedReport(getD1(), { organizationId: context.organizationId, currency: context.organization.currency,
        timeZone: context.organization.timezone, contactIdentity: false, individualDetails: false,
        query: { from: scope.from, to: scope.to, report: "pnl", accountId: null, after: null, format: "json" } });
      if (report.coverage.closingLineCount > 0) {
        const closing = ledgerIntelligence(report.accounts.map(row => ({ ...row, debitCents: row.closingDebitCents, creditCents: row.closingCreditCents })));
        ledger = { generatedUtc: report.metadata.generatedAt, lastPostedUtc: report.metadata.lastPostedAt, dataMode: report.metadata.dataMode,
          revisionHash: await studioHash({ accounts: report.accounts, coverage: report.coverage, metadata: { ...report.metadata, generatedAt: undefined } }),
          from: scope.from, to: scope.to, calculationVersion: report.metadata.calculationVersion, boundary: report.metadata.boundary,
          foreignCurrencyEntriesExcluded: report.metadata.foreignEntryCount,
          revenueCents: report.profitAndLoss.revenueCents, grossProfitCents: report.profitAndLoss.grossProfitCents,
          operatingProfitCents: report.profitAndLoss.operatingProfitCents, netEarningsCents: report.profitAndLoss.netProfitCents,
          assetsCents: report.balanceSheet.assetCents, liabilitiesCents: report.balanceSheet.liabilityCents,
          equityCents: report.balanceSheet.equityCents, balanceDifferenceCents: report.balanceSheet.differenceCents };
        const hasBalance = (keys: string[]) => report.accounts.some(row => row.accountType === "asset" && keys.includes(row.systemKey ?? row.accountSubtype) && row.closingLineCount > 0);
        const modeNote = report.metadata.dataMode === "demonstration" ? "Demonstration accounting data. " : "";
        if (report.accounts.some(row => isLedgerCashAccount(row) && row.closingLineCount > 0)) cash = { state: "recorded", reason: `${modeNote}Posted ledger cash balance through the as-of date. Bank reconciliation and complete opening balances require review. This is not a cash-flow statement or forecast.`, ledgerCents: closing.cashCents };
        if (hasBalance(["inventory", "inventory_asset"])) inventory = { state: "recorded", reason: `${modeNote}Posted ledger inventory balance through the as-of date. This is not current stock quantity, a valuation audit or certified physical inventory.`, ledgerCents: closing.inventoryCents };
      }
    } catch (error) {
      if (!(error instanceof ApiError) || ![403, 409].includes(error.status)) throw error;
      cash = { state: "unavailable", reason: error.message }; inventory = { state: "unavailable", reason: error.message };
    }
  }
  const margin: StudioExecutiveReview["margin"] = !permissions.includes("metrics.profit") ? { state: "restricted", reason: "Margin is outside your reporting access." }
    : summary?.grossProfitCents !== null && summary?.grossProfitCents !== undefined ? { state: "recorded", reason: "Uses recorded owner-reviewed summary costs. Provider daily totals alone do not establish attributable sale costs." }
    : { state: "unavailable", reason: "Every included sale summary needs a known recorded cost before profit and margin can be shown." };
  const snapshotHash = await studioHash({ version: STUDIO_VERSION, organizationId: context.organizationId, currency: context.organization.currency, timeZone: context.organization.timezone, scope, policy: policy.fingerprint, rows, ledger: ledger ? { ...ledger, generatedUtc: undefined } : null });
  const report: StudioExecutiveReview = { version: STUDIO_VERSION,
    metadata: { organizationId: context.organizationId, currency: context.organization.currency, timeZone: context.organization.timezone,
      from: scope.from, to: scope.to, locationIds: [...localLocationIds], generatedUtc: new Date().toISOString(), extractionUtc,
      specificationHash: await studioHash({ version: STUDIO_VERSION, template: "executive_review", scope, policy: policy.fingerprint }), snapshotHash,
      consistency: "component_read_transactions", calculationVersion: "studio-recorded-daily-v1", dataMode: "stored_records",
      rowCount: rows.length, limit: STUDIO_MAX_RECORDS, truncated: false, canExport: entitlements.features.includes("reporting.exports") && permissions.includes("reports.export"), sourceAuthority: scope.connection ? "approved_provider_scope" : "canonical_selected_sources", providerHistoryCertified: false,
      recordedDayCount: new Set(rows.map(row => row.businessDate)).size, calendarDayCount: (Date.parse(scope.to) - Date.parse(scope.from)) / 86400000 + 1,
      latestRecordUpdateUtc: rows.map(row => row.updatedUtc!).sort().at(-1) ?? null },
    sales: { state: rows.length ? "recorded" : "unavailable", reason: salesReason, rows, summary }, margin, inventory, cash,
    ...(ledger ? { ledger } : {}), limitations: [
      "Includes every accepted stored daily row in the bounded scope. Stored-record extraction is not certification of complete provider history, closed days or reconciled books.",
      "Each component is captured in its own read transaction; the sales and posted-ledger timestamps identify separate extraction boundaries.",
      "Operational sales and posted accrual statements use different evidence. They must not be added together or treated as interchangeable.",
      "No currency conversion, projected cash, inventory assumptions or accounting postings are performed.",
      ...(salesReason ? [salesReason] : []), ...(margin.reason ? [margin.reason] : []) ] };
  if (new TextEncoder().encode(JSON.stringify(report)).byteLength > STUDIO_MAX_RESULT_BYTES) throw new ApiError(409, "STUDIO_RESULT_TOO_LARGE", "This report exceeds the tested result size. Narrow the scope. No partial export was created.");
  return report;
}

export async function revalidateStudioPolicy(request: Request, scope: StudioScope, exporting: boolean, expected: string) {
  if ((await studioPolicy(request, scope, exporting)).fingerprint !== expected) throw new ApiError(409, "STUDIO_SCOPE_CHANGED", "Your access, source approval or reporting scope changed. Run the analysis again before exporting. Your chosen filters have been kept.");
}
