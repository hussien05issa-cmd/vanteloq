import { and, eq, gt, isNull, or } from "drizzle-orm";
import { getD1, getDb } from "../../../../db";
import { integrationConnections, integrationSyncRuns, marketingResourceSelections } from "../../../../db/schema";
import { requireAccess } from "../../../../server/authorization";
import { ApiError, handleApi, jsonResponse, requireSameOrigin } from "../../../../server/api";
import { recordAudit } from "../../../../server/audit";
import { effectivePermissions, requirePermission } from "../../../../server/permissions";
import { integrationCatalog, preSyncControls } from "../../../integration-catalog";
import { lightspeedReadiness } from "../../../../server/integrations/lightspeed";
import { lightspeedRReadiness } from "../../../../server/integrations/lightspeed-r";
import { cloverReadiness } from "../../../../server/integrations/clover";
import { squareReadiness } from "../../../../server/integrations/square";
import { stripeReadiness } from "../../../../server/integrations/stripe";
import { plaidReadiness } from "../../../../server/integrations/plaid";
import { marketingReadiness } from "../../../../server/integrations/marketing";
import { monerisReadiness, MONERIS_PROVIDER } from "../../../../server/integrations/moneris";
import { quickBooksReadiness, QUICKBOOKS_PROVIDER } from "../../../../server/integrations/quickbooks";
import { shopifyPosReadiness, shopifyReadiness, SHOPIFY_POS_PROVIDER, SHOPIFY_PROVIDER } from "../../../../server/integrations/shopify-pos";
import { buildProviderFeatureCoverage, type CanonicalCommerceCoverage } from "../../../../domain/provider-feature-coverage";
import { aggregateConnectionStatus } from "../../../../domain/integration-source";
import { requireOrganizationWideLocationAccess } from "../../../../server/location-access";
import { buildProviderReportCatalog } from "../../../../domain/provider-report-contracts";
import { integrationProviderFeature } from "../../../../domain/paid-feature-routing";
import { requireFeature } from "../../../../server/entitlements/engine";
import { noActiveIntegrationLease } from "../../../../server/integrations/trusted-data";

function maskedAccountRef(value: string | null | undefined) {
  if (!value) return null;
  const ending = value.slice(-4);
  return `•••• ${ending}`;
}

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, ["owner", "admin", "manager", "employee", "read_only"], "business.settings");
    await requirePermission(context, "integrations.view");
    await requireOrganizationWideLocationAccess(context);
    const permissions = await effectivePermissions(context);
    const rows = await getDb()
      .select({
        id: integrationConnections.id,
        provider: integrationConnections.provider,
        sourceNamespace: integrationConnections.sourceNamespace,
        status: integrationConnections.status,
        externalAccountRef: integrationConnections.externalAccountRef,
        externalAccountName: integrationConnections.externalAccountName,
        lastSuccessfulSyncAt: integrationConnections.lastSuccessfulSyncAt,
        lastErrorCode: integrationConnections.lastErrorCode,
        connectedAt: integrationConnections.connectedAt,
        dataPromotionStatus: integrationConnections.dataPromotionStatus,
        privacyDataDeletedAt: integrationConnections.privacyDataDeletedAt,
        syncLeaseOwner: integrationConnections.syncLeaseOwner,
        syncLeaseExpiresAt: integrationConnections.syncLeaseExpiresAt,
        updatedAt: integrationConnections.updatedAt,
        resourceSelectionVersion: integrationConnections.resourceSelectionVersion,
      })
      .from(integrationConnections)
      .where(eq(integrationConnections.organizationId, context.organizationId));
    const [marketingSelections, completedMarketingSamples, marketingMetricCounts] = await Promise.all([
      getDb().select({
        id: marketingResourceSelections.id,
        connectionId: marketingResourceSelections.connectionId,
        provider: marketingResourceSelections.provider,
        dataset: marketingResourceSelections.dataset,
        externalResourceRef: marketingResourceSelections.externalResourceRef,
        externalResourceName: marketingResourceSelections.externalResourceName,
        scopeKind: marketingResourceSelections.scopeKind,
        localLocationId: marketingResourceSelections.localLocationId,
      }).from(marketingResourceSelections).where(eq(marketingResourceSelections.organizationId, context.organizationId)),
      getDb().select({
        id: integrationSyncRuns.id,
        connectionId: integrationSyncRuns.connectionId,
        provider: integrationSyncRuns.provider,
        resourceSelectionVersion: integrationSyncRuns.resourceSelectionVersion,
        completedAt: integrationSyncRuns.completedAt,
        recordsRead: integrationSyncRuns.recordsRead,
        recordsStaged: integrationSyncRuns.recordsStaged,
        warningCount: integrationSyncRuns.warningCount,
      }).from(integrationSyncRuns).where(and(
        eq(integrationSyncRuns.organizationId, context.organizationId),
        eq(integrationSyncRuns.mode, "sample"),
        eq(integrationSyncRuns.status, "completed"),
        eq(integrationSyncRuns.warningCount, 0),
        gt(integrationSyncRuns.recordsStaged, 0),
        isNull(integrationSyncRuns.errorCode),
      )),
      getD1().prepare(`
        SELECT metric.resource_selection_id selectionId, COUNT(*) recordsRead
        FROM marketing_daily_metrics metric
        INNER JOIN marketing_resource_selections selection ON selection.id = metric.resource_selection_id
        WHERE selection.organization_id = ?
        GROUP BY metric.resource_selection_id
      `).bind(context.organizationId).all<{ selectionId: string; recordsRead: number }>(),
    ]);
    const marketingMetricCountBySelection = new Map((marketingMetricCounts.results ?? []).map((row) => [row.selectionId, Number(row.recordsRead)]));
    const selectionsByConnection = new Map<string, typeof marketingSelections>();
    for (const selection of marketingSelections) {
      selectionsByConnection.set(selection.connectionId, [...(selectionsByConnection.get(selection.connectionId) ?? []), selection]);
    }
    const matchingSample = (connection: typeof rows[number]) => {
      const selections = selectionsByConnection.get(connection.id) ?? [];
      const activeLease = Boolean(connection.syncLeaseOwner && connection.syncLeaseExpiresAt && connection.syncLeaseExpiresAt.getTime() > Date.now());
      if (connection.lastErrorCode || activeLease || !selections.length || selections.some((selection) => (marketingMetricCountBySelection.get(selection.id) ?? 0) === 0)) return undefined;
      const currentMetricCount = selections.reduce((sum, selection) => sum + (marketingMetricCountBySelection.get(selection.id) ?? 0), 0);
      return completedMarketingSamples
        .filter((run) =>
          run.connectionId === connection.id
          && run.provider === connection.provider
          && run.resourceSelectionVersion === connection.resourceSelectionVersion
          && run.recordsStaged === currentMetricCount
          && Boolean(run.completedAt && connection.lastSuccessfulSyncAt && run.completedAt.getTime() === connection.lastSuccessfulSyncAt.getTime()),
        )
        .sort((left, right) => (right.completedAt?.getTime() ?? 0) - (left.completedAt?.getTime() ?? 0))[0];
    };
    const activeRows = rows.filter((row) => row.status !== "revoked" && row.status !== "not_connected").map(row => ({
      ...row,
      // Old approvals do not establish that a payment account is production.
      dataPromotionStatus: row.provider === MONERIS_PROVIDER && !row.sourceNamespace?.startsWith("production:") ? "staging" : row.dataPromotionStatus,
    }));
    const byProvider = new Map<string, typeof activeRows>();
    for (const row of activeRows) byProvider.set(row.provider, [...(byProvider.get(row.provider) ?? []), row]);
    const database = getD1();
    const emptyCoverage = (): CanonicalCommerceCoverage => ({ sales: false, payments: false, products: false, inventory: false, customers: false, suppliers: false, locations: false });
    const connectionCoverageRows = await Promise.all(activeRows.map(async (connection) => {
      const syncActive = Boolean(connection.syncLeaseOwner && connection.syncLeaseExpiresAt && connection.syncLeaseExpiresAt.getTime() > Date.now());
      if (connection.status !== "connected" || connection.dataPromotionStatus !== "approved" || syncActive) {
        return [connection.id, emptyCoverage()] as const;
      }
      const facts = await database.prepare(`
        SELECT
          (SELECT COUNT(*) FROM daily_business_metrics WHERE organization_id = ? AND source_connection_id = ?) AS sales,
          (SELECT COUNT(*) FROM commerce_payments WHERE organization_id = ? AND connection_id = ? AND paid_at IS NOT NULL AND amount_cents > 0) AS payments,
          (SELECT COUNT(*) FROM commerce_products WHERE organization_id = ? AND connection_id = ? AND archived = 0) AS products,
          (SELECT COUNT(*) FROM commerce_customers WHERE organization_id = ? AND connection_id = ? AND archived = 0) AS customers,
          (SELECT COUNT(*) FROM commerce_suppliers WHERE organization_id = ? AND connection_id = ? AND archived = 0) AS suppliers,
          (SELECT COUNT(*) FROM integration_location_mappings WHERE organization_id = ? AND connection_id = ? AND status = 'mapped') AS locations,
          (SELECT COUNT(*) FROM inventory_balances WHERE organization_id = ? AND source_connection_id = ?) AS inventory
      `).bind(
        context.organizationId, connection.id,
        context.organizationId, connection.id,
        context.organizationId, connection.id,
        context.organizationId, connection.id,
        context.organizationId, connection.id,
        context.organizationId, connection.id,
        context.organizationId, connection.id,
      ).first<Record<keyof CanonicalCommerceCoverage, number>>();
      const coverage: CanonicalCommerceCoverage = {
        sales: Number(facts?.sales ?? 0) > 0,
        payments: Number(facts?.payments ?? 0) > 0,
        products: Number(facts?.products ?? 0) > 0,
        inventory: Number(facts?.inventory ?? 0) > 0,
        customers: Number(facts?.customers ?? 0) > 0,
        suppliers: Number(facts?.suppliers ?? 0) > 0,
        locations: Number(facts?.locations ?? 0) > 0,
      };
      return [connection.id, coverage] as const;
    }));
    const coverageByConnection = new Map(connectionCoverageRows);
    const syncEnabled = activeRows.some((row) => row.status === "connected");
    const dataPromotionEnabled = activeRows.some((row) => row.dataPromotionStatus === "approved");
    return jsonResponse({
      preSyncControls,
      syncEnabled,
      dataPromotionEnabled,
      canManage: permissions.includes("integrations.manage"),
      canManageBankConnections: permissions.includes("finance.connections"),
      integrations: integrationCatalog.map((provider) => {
        const allProviderConnections = rows.filter((connection) => connection.provider === provider.id);
        const providerConnections = byProvider.get(provider.id) ?? [];
        const canonicalCoverage = providerConnections.reduce((union, connection) => {
          const coverage = coverageByConnection.get(connection.id) ?? emptyCoverage();
          for (const key of Object.keys(union) as Array<keyof CanonicalCommerceCoverage>) union[key] ||= coverage[key];
          return union;
        }, emptyCoverage());
        const aggregate = aggregateConnectionStatus(providerConnections.map((connection) => ({
          ...connection,
          lastSuccessfulSyncAt: connection.lastSuccessfulSyncAt?.toISOString() ?? null,
        })));
        const canManageProvider = provider.id === "plaid"
          ? permissions.includes("finance.connections")
          : permissions.includes("integrations.manage");
        const marketingBase = provider.id === "google" || provider.id === "meta" ? marketingReadiness(provider.id) : null;
        const marketingSyncEligible = Boolean(marketingBase && providerConnections.some((connection) => (selectionsByConnection.get(connection.id)?.length ?? 0) > 0));
        const marketingLiveEligible = Boolean(marketingBase && providerConnections.some((connection) => connection.dataPromotionStatus === "approved" && (selectionsByConnection.get(connection.id)?.length ?? 0) > 0));
        return ({
        ...provider,
        canManage: canManageProvider,
        status: providerConnections.length
          ? aggregate.status
          : allProviderConnections.some((connection) => connection.status === "revoked")
            ? "revoked"
            : aggregate.status,
        maskedAccountRef: providerConnections.length === 1 ? maskedAccountRef(providerConnections[0]?.externalAccountRef) : null,
        externalAccountName: providerConnections.length === 1 ? providerConnections[0]?.externalAccountName ?? null : providerConnections.length ? `${providerConnections.length} provider accounts` : null,
        lastSuccessfulSyncAt: aggregate.lastSuccessfulSyncAt,
        lastErrorCode: aggregate.lastErrorCode,
        connectedAt: providerConnections.map((connection) => connection.connectedAt).filter((value): value is Date => Boolean(value)).sort((left, right) => right.getTime() - left.getTime())[0]?.toISOString() ?? null,
        dataPromotionStatus: aggregate.dataPromotionStatus,
        connectionCount: providerConnections.length,
        connections: providerConnections.map((connection) => {
          const selections = selectionsByConnection.get(connection.id) ?? [];
          const sample = matchingSample(connection);
          return ({
          id: connection.id,
          status: connection.status,
          maskedAccountRef: maskedAccountRef(connection.externalAccountRef),
          externalAccountName: connection.externalAccountName,
          lastSuccessfulSyncAt: connection.lastSuccessfulSyncAt?.toISOString() ?? null,
          lastErrorCode: connection.lastErrorCode,
          connectedAt: connection.connectedAt?.toISOString() ?? null,
          dataPromotionStatus: connection.dataPromotionStatus,
          reportingEnvironment: provider.id === MONERIS_PROVIDER ? connection.sourceNamespace?.startsWith("production:") ? "production" : connection.sourceNamespace?.startsWith("sandbox:") ? "sandbox" : "unverified" : null,
          syncActive: Boolean(connection.syncLeaseOwner && connection.syncLeaseExpiresAt && connection.syncLeaseExpiresAt.getTime() > Date.now()),
          resourceSelectionVersion: connection.resourceSelectionVersion,
          resourceSelections: selections.map((selection) => ({
            id: selection.id,
            dataset: selection.dataset,
            externalResourceRef: selection.externalResourceRef,
            name: selection.externalResourceName,
            scopeKind: selection.scopeKind,
            localLocationId: selection.localLocationId,
          })),
          syncEligible: selections.length > 0,
          sampleReady: Boolean(sample),
          sampleRunId: sample?.id ?? null,
          sampleSummary: sample ? {
            runId: sample.id,
            selectionVersion: sample.resourceSelectionVersion,
            completedAt: sample.completedAt?.toISOString() ?? null,
            recordsRead: sample.recordsRead,
            recordsStaged: sample.recordsStaged,
            warningCount: sample.warningCount,
            warnings: [] as string[],
            resourceResults: selections.map((selection) => ({
              resourceSelectionId: selection.id,
              recordsRead: marketingMetricCountBySelection.get(selection.id) ?? 0,
              warningCodes: [] as string[],
            })),
          } : null,
          privacyDataDeletedAt: connection.privacyDataDeletedAt?.toISOString() ?? null,
          canonicalCoverage: coverageByConnection.get(connection.id) ?? emptyCoverage(),
          featureCoverage: buildProviderFeatureCoverage(provider.id, coverageByConnection.get(connection.id) ?? emptyCoverage()),
          reportCatalog: buildProviderReportCatalog({ provider: provider.id, connectionId: connection.id, coverage: coverageByConnection.get(connection.id) ?? emptyCoverage() }),
        });}),
        privacyDataDeletedAt: allProviderConnections
          .map((connection) => connection.privacyDataDeletedAt)
          .filter((value): value is Date => Boolean(value))
          .sort((left, right) => right.getTime() - left.getTime())[0]?.toISOString() ?? null,
        providerReadiness: provider.id === "lightspeed"
          ? lightspeedReadiness()
          : provider.id === "lightspeed-r"
            ? lightspeedRReadiness()
            : provider.id === "clover"
              ? cloverReadiness()
            : provider.id === SHOPIFY_PROVIDER
              ? shopifyReadiness(SHOPIFY_PROVIDER)
            : provider.id === SHOPIFY_POS_PROVIDER
              ? shopifyPosReadiness()
            : provider.id === "square"
              ? squareReadiness()
            : provider.id === "stripe"
              ? stripeReadiness()
            : provider.id === QUICKBOOKS_PROVIDER
              ? quickBooksReadiness()
            : provider.id === MONERIS_PROVIDER
              ? { ...monerisReadiness(), ...(providerConnections.length > 0 && !providerConnections.some(connection => connection.sourceNamespace?.startsWith("production:")) ? { mode: "sandbox_or_unverified", liveDataEligible: false } : {}) }
              : provider.id === "plaid"
                ? plaidReadiness()
                : provider.id === "google" || provider.id === "meta"
                  ? {
                      ...marketingBase!,
                      resourceSelectionStatus: marketingSyncEligible ? "selected" : "required",
                      syncEligible: marketingSyncEligible,
                      dataPromotionEnabled: marketingLiveEligible,
                      liveDataEligible: marketingLiveEligible,
                    }
              : null,
        canonicalCoverage,
        featureCoverage: buildProviderFeatureCoverage(provider.id, canonicalCoverage),
      });}),
    });
  });
}

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, ["owner", "admin", "manager"], "business.settings");
    await requireOrganizationWideLocationAccess(context);
    const permissions = await effectivePermissions(context);
    if (!permissions.includes("integrations.manage") && !permissions.includes("finance.connections")) {
      throw new ApiError(403, "PERMISSION_DENIED", "This account cannot approve integration data.");
    }
    const body = await request.json().catch(() => ({})) as {
      action?: unknown;
      connectionId?: unknown;
      confirmed?: unknown;
      sampleRunId?: unknown;
      expectedSelectionVersion?: unknown;
    };
    if (!["approve_data", "exclude_data"].includes(String(body.action)) || typeof body.connectionId !== "string" || body.confirmed !== true) {
      throw new ApiError(400, "INVALID_PROMOTION_REQUEST", "Confirm the reviewed provider account before making its data available.");
    }
    const [connection] = await getDb().select().from(integrationConnections).where(and(
      eq(integrationConnections.id, body.connectionId),
      eq(integrationConnections.organizationId, context.organizationId),
    )).limit(1);
    if (!connection || connection.status !== "connected") {
      throw new ApiError(404, "INTEGRATION_CONNECTION_NOT_FOUND", "The selected connected provider account is unavailable.");
    }
    const requiredFeature = integrationProviderFeature(connection.provider);
    if (!requiredFeature) throw new ApiError(400, "INTEGRATION_PROVIDER_UNAVAILABLE", "This provider does not have an enabled subscription feature.");
    await requireFeature(context, requiredFeature);
    if (connection.provider === "plaid") {
      await requirePermission(context, "finance.connections");
    } else {
      await requirePermission(context, "integrations.manage");
    }
    const isMarketingProvider = connection.provider === "google" || connection.provider === "meta";
    if (isMarketingProvider) {
      if (context.role !== "owner" && context.role !== "admin") {
        throw new ApiError(403, "INSUFFICIENT_PERMISSION", "Only an owner or admin can approve marketing measurements.");
      }
      await requirePermission(context, "marketing.manage");
    }
    if (body.action === "exclude_data") {
      const excluded = await getDb().update(integrationConnections).set({
        dataPromotionStatus: "staging",
        promotionAuthorizedAt: null,
        updatedAt: new Date(),
      }).where(and(
        eq(integrationConnections.id, connection.id),
        eq(integrationConnections.organizationId, context.organizationId),
        eq(integrationConnections.status, "connected"),
        eq(integrationConnections.syncVersion, connection.syncVersion),
        noActiveIntegrationLease(integrationConnections.syncLeaseOwner, integrationConnections.syncLeaseExpiresAt),
      )).returning({ id: integrationConnections.id });
      if (!excluded.length) {
        throw new ApiError(409, "INTEGRATION_DATA_CHANGED", "Wait for any current sync to finish, then refresh and try again.");
      }
      await recordAudit({
        request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
        action: "integration.data_promotion_excluded", resourceType: "integration_connection",
        resourceId: connection.id, details: { provider: connection.provider },
      });
      return jsonResponse({
        excluded: true, connectionId: connection.id, recordsRetained: true,
        nextStep: "This account is excluded from business reporting. Its connection and records are retained. Review and approve its data to include it again.",
      });
    }
    if (connection.provider === MONERIS_PROVIDER && !connection.sourceNamespace?.startsWith("production:")) {
      throw new ApiError(409, "MONERIS_PRODUCTION_REQUIRED", "Sandbox or unverified Moneris records cannot be approved for business reporting. Connect and review a production merchant account.");
    }
    if (connection.dataPromotionStatus !== "staging") {
      throw new ApiError(409, "INTEGRATION_DATA_NOT_READY", "Sync and review this provider account before making its data available.");
    }
    if (!connection.lastSuccessfulSyncAt) {
      throw new ApiError(409, "INTEGRATION_SYNC_REQUIRED", "Complete a successful sync before making this data available.");
    }
    if (connection.syncLeaseOwner) {
      const activeLease = Boolean(connection.syncLeaseExpiresAt && connection.syncLeaseExpiresAt.getTime() > Date.now());
      if (activeLease) {
        throw new ApiError(409, "INTEGRATION_SYNC_IN_PROGRESS", "Wait for the current sync to finish before approving this data.");
      }
      const clearedLease = await getDb().update(integrationConnections).set({
        syncLeaseOwner: null,
        syncLeaseExpiresAt: null,
        updatedAt: new Date(),
      }).where(and(
        eq(integrationConnections.id, connection.id),
        eq(integrationConnections.organizationId, context.organizationId),
        eq(integrationConnections.provider, connection.provider),
        eq(integrationConnections.syncLeaseOwner, connection.syncLeaseOwner),
        connection.syncLeaseExpiresAt
          ? eq(integrationConnections.syncLeaseExpiresAt, connection.syncLeaseExpiresAt)
          : isNull(integrationConnections.syncLeaseExpiresAt),
      )).returning({ id: integrationConnections.id });
      if (!clearedLease.length) {
        throw new ApiError(409, "INTEGRATION_DATA_CHANGED", "The provider account changed while it was being reviewed. Refresh and try again.");
      }
      connection.syncLeaseOwner = null;
      connection.syncLeaseExpiresAt = null;
    }
    const nonBlockingCoverageWarning = (
      connection.provider === "lightspeed-r"
      && connection.lastErrorCode === "LIGHTSPEED_R_PARTIAL_COVERAGE"
    ) || (
      connection.provider === "square"
      && connection.lastErrorCode === "SQUARE_PRODUCT_COST_UNAVAILABLE"
    );
    if (connection.lastErrorCode && !nonBlockingCoverageWarning) {
      throw new ApiError(409, "INTEGRATION_SYNC_ERROR", "Resolve the latest sync error before approving this data.");
    }

    let reviewedMarketingRunId: string | null = null;
    const isReviewedCommerceImport = connection.provider === "lightspeed-r" || connection.provider === "clover" || connection.provider === "square" || connection.provider === SHOPIFY_PROVIDER || connection.provider === SHOPIFY_POS_PROVIDER;
    const commerceProviderLabel = connection.provider === "clover" ? "Clover" : connection.provider === "square" ? "Square" : connection.provider === SHOPIFY_PROVIDER ? "Shopify e-commerce" : connection.provider === SHOPIFY_POS_PROVIDER ? "Shopify POS" : "R-Series";
    const commerceLocationLabel = connection.provider === "clover" ? "Clover merchant location" : connection.provider === "square" ? "Square locations" : connection.provider === SHOPIFY_PROVIDER ? "Shopify online-store channel" : connection.provider === SHOPIFY_POS_PROVIDER ? "Shopify POS locations" : "R-Series shops";
    const commerceLocationSingular = connection.provider === "clover" ? "Clover merchant location" : connection.provider === "square" ? "Square location" : connection.provider === SHOPIFY_PROVIDER ? "Shopify online-store channel" : connection.provider === SHOPIFY_POS_PROVIDER ? "Shopify POS location" : "R-Series shop";
    if (isReviewedCommerceImport) {
      const [reviewedRun] = await getDb().select().from(integrationSyncRuns).where(and(
        eq(integrationSyncRuns.organizationId, context.organizationId),
        eq(integrationSyncRuns.provider, connection.provider),
        eq(integrationSyncRuns.connectionId, connection.id),
        eq(integrationSyncRuns.mode, "incremental"),
        eq(integrationSyncRuns.status, "completed"),
        isNull(integrationSyncRuns.errorCode),
        eq(integrationSyncRuns.warningCount, 0),
        eq(integrationSyncRuns.completedAt, connection.lastSuccessfulSyncAt),
        connection.lastSyncCursor === null
          ? isNull(integrationSyncRuns.cursorAfter)
          : eq(integrationSyncRuns.cursorAfter, connection.lastSyncCursor),
      )).limit(1);
      if (!reviewedRun) {
        throw new ApiError(409, "INTEGRATION_SYNC_STALE", `The reviewed ${commerceProviderLabel} sync no longer matches this account. Sync and review it again.`);
      }
      const review = await getD1().prepare(`
        SELECT
          (SELECT COUNT(*) FROM integration_location_mappings
            WHERE organization_id = ? AND provider = ? AND connection_id = ? AND status = 'unmapped') AS unmapped,
          (SELECT COUNT(*) FROM integration_location_mappings
            WHERE organization_id = ? AND provider = ? AND connection_id = ?) AS locationCount,
          (SELECT COUNT(*) FROM integration_staged_sales
            WHERE organization_id = ? AND provider = ? AND connection_id = ?) AS stagedSaleCount
      `).bind(
        context.organizationId, connection.provider, connection.id,
        context.organizationId, connection.provider, connection.id,
        context.organizationId, connection.provider, connection.id,
      ).first<{ unmapped: number; locationCount: number; stagedSaleCount: number }>();
      if (Number(review?.stagedSaleCount ?? 0) === 0) {
        throw new ApiError(409, "INTEGRATION_SALES_REQUIRED", `Sync at least one verified ${commerceProviderLabel} sale before making dashboard results available.`);
      }
      if (Number(review?.locationCount ?? 0) === 0) {
        throw new ApiError(409, "INTEGRATION_LOCATIONS_REQUIRED", `Discover and review the ${commerceLocationLabel} before making its data available.`);
      }
      if (Number(review?.unmapped ?? 0) > 0) {
        throw new ApiError(409, "INTEGRATION_LOCATIONS_UNMAPPED", `Map or intentionally ignore every ${commerceLocationSingular} before making its data available.`);
      }
    } else if (isMarketingProvider) {
      if (typeof body.sampleRunId !== "string" || !Number.isInteger(body.expectedSelectionVersion)) {
        throw new ApiError(400, "MARKETING_SAMPLE_REVIEW_REQUIRED", "Review the current warning-free sample before approving marketing measurements.");
      }
      if (body.expectedSelectionVersion !== connection.resourceSelectionVersion) {
        throw new ApiError(409, "MARKETING_SELECTION_CHANGED", "The selected marketing resources changed. Run and review a new sample.");
      }
      const [reviewedRun] = await getDb().select({ id: integrationSyncRuns.id, recordsStaged: integrationSyncRuns.recordsStaged }).from(integrationSyncRuns).where(and(
        eq(integrationSyncRuns.id, body.sampleRunId),
        eq(integrationSyncRuns.organizationId, context.organizationId),
        eq(integrationSyncRuns.provider, connection.provider),
        eq(integrationSyncRuns.connectionId, connection.id),
        eq(integrationSyncRuns.mode, "sample"),
        eq(integrationSyncRuns.status, "completed"),
        eq(integrationSyncRuns.warningCount, 0),
        isNull(integrationSyncRuns.errorCode),
        eq(integrationSyncRuns.resourceSelectionVersion, connection.resourceSelectionVersion),
        eq(integrationSyncRuns.completedAt, connection.lastSuccessfulSyncAt),
      )).limit(1);
      if (!reviewedRun) {
        throw new ApiError(409, "MARKETING_SAMPLE_STALE", "The reviewed sample no longer matches this account and resource selection. Run and review a new sample.");
      }
      const proof = await getD1().prepare(`
        SELECT
          COUNT(*) selectedCount,
          SUM(CASE WHEN EXISTS (
            SELECT 1 FROM marketing_daily_metrics metric
            WHERE metric.resource_selection_id = selection.id
          ) THEN 1 ELSE 0 END) provenCount,
          (SELECT COUNT(*) FROM marketing_daily_metrics metric
            INNER JOIN marketing_resource_selections current_selection
              ON current_selection.id = metric.resource_selection_id
            WHERE current_selection.organization_id = ?
              AND current_selection.connection_id = ?
              AND current_selection.provider = ?) currentMetricCount
        FROM marketing_resource_selections selection
        WHERE selection.organization_id = ? AND selection.connection_id = ? AND selection.provider = ?
      `).bind(
        context.organizationId, connection.id, connection.provider,
        context.organizationId, connection.id, connection.provider,
      ).first<{ selectedCount: number; provenCount: number; currentMetricCount: number }>();
      const selectedCount = Number(proof?.selectedCount ?? 0);
      if (
        selectedCount === 0
        || Number(proof?.provenCount ?? 0) !== selectedCount
        || Number(proof?.currentMetricCount ?? 0) !== reviewedRun.recordsStaged
        || reviewedRun.recordsStaged <= 0
      ) {
        throw new ApiError(409, "MARKETING_SAMPLE_INCOMPLETE", "Every selected resource must have current evidence from this exact sample before approval.");
      }
      reviewedMarketingRunId = reviewedRun.id;
    } else if (connection.provider === MONERIS_PROVIDER) {
      const proof = await getD1().prepare(`
        SELECT COUNT(*) paymentCount, COALESCE(SUM(amount_cents), 0) amountCents
        FROM commerce_payments
        WHERE organization_id = ? AND provider = ? AND connection_id = ?
          AND paid_at IS NOT NULL AND amount_cents >= 0
      `).bind(context.organizationId, MONERIS_PROVIDER, connection.id).first<{ paymentCount: number; amountCents: number }>();
      if (Number(proof?.paymentCount ?? 0) === 0) {
        throw new ApiError(409, "MONERIS_PAYMENTS_REQUIRED", "Sync and review at least one successful Moneris payment before approving reconciliation data.");
      }
    } else if (connection.provider !== "plaid") {
      throw new ApiError(409, "INTEGRATION_PROMOTION_UNAVAILABLE", "This provider remains staging-only until its reconciliation workflow is available.");
    }

    const approvedAt = new Date();
    const approved = await getDb().update(integrationConnections).set({
      dataPromotionStatus: isReviewedCommerceImport ? "staging" : "approved",
      promotionAuthorizedAt: isReviewedCommerceImport ? approvedAt : null,
      lastErrorCode: null,
      updatedAt: approvedAt,
    }).where(and(
      eq(integrationConnections.id, connection.id),
      eq(integrationConnections.organizationId, context.organizationId),
      eq(integrationConnections.provider, connection.provider),
      eq(integrationConnections.status, "connected"),
      eq(integrationConnections.dataPromotionStatus, "staging"),
      eq(integrationConnections.syncVersion, connection.syncVersion),
      eq(integrationConnections.resourceSelectionVersion, connection.resourceSelectionVersion),
      eq(integrationConnections.lastSuccessfulSyncAt, connection.lastSuccessfulSyncAt),
      connection.lastSyncCursor === null
        ? isNull(integrationConnections.lastSyncCursor)
        : eq(integrationConnections.lastSyncCursor, connection.lastSyncCursor),
      nonBlockingCoverageWarning
        ? or(isNull(integrationConnections.lastErrorCode), eq(integrationConnections.lastErrorCode, connection.lastErrorCode!))
        : isNull(integrationConnections.lastErrorCode),
      isNull(integrationConnections.syncLeaseOwner),
    )).returning({ id: integrationConnections.id });
    if (!approved.length) {
      throw new ApiError(409, "INTEGRATION_DATA_CHANGED", "The provider account changed while it was being approved. Review it again.");
    }
    await recordAudit({
      request,
      requestId,
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "integration.data_promotion_approved",
      resourceType: "integration_connection",
      resourceId: connection.id,
      details: {
        provider: connection.provider,
        reviewedAt: approvedAt.toISOString(),
        sampleRunId: reviewedMarketingRunId,
        resourceSelectionVersion: isMarketingProvider ? connection.resourceSelectionVersion : null,
      },
    });
    const publicationPending = isReviewedCommerceImport;
    return jsonResponse({
      approved: true,
      connectionId: connection.id,
      provider: connection.provider,
      publicationPending,
      nextStep: publicationPending
        ? `Run one final ${commerceProviderLabel} sync to publish the reviewed data to dashboard features.`
        : "Reviewed provider data is now available to dashboard features.",
    });
  });
}
