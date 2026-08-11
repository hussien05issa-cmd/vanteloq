import { and, eq, isNull } from "drizzle-orm";
import { getD1, getDb } from "../../../../db";
import { integrationConnections, integrationSyncRuns } from "../../../../db/schema";
import { requireAccess } from "../../../../server/authorization";
import { ApiError, handleApi, jsonResponse, requireSameOrigin } from "../../../../server/api";
import { recordAudit } from "../../../../server/audit";
import { effectivePermissions, requirePermission } from "../../../../server/permissions";
import { integrationCatalog, preSyncControls } from "../../../integration-catalog";
import { lightspeedReadiness } from "../../../../server/integrations/lightspeed";
import { lightspeedRCheckpointReadyForApproval, lightspeedRReadiness } from "../../../../server/integrations/lightspeed-r";
import { stripeReadiness } from "../../../../server/integrations/stripe";
import { plaidReadiness } from "../../../../server/integrations/plaid";
import { buildProviderFeatureCoverage, type CanonicalCommerceCoverage } from "../../../../domain/provider-feature-coverage";
import { aggregateConnectionStatus } from "../../../../domain/integration-source";
import { requireOrganizationWideLocationAccess } from "../../../../server/location-access";

function maskedAccountRef(value: string | null | undefined) {
  if (!value) return null;
  const ending = value.slice(-4);
  return `•••• ${ending}`;
}

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, ["owner", "admin", "manager", "employee", "read_only"]);
    await requirePermission(context, "integrations.view");
    await requireOrganizationWideLocationAccess(context);
    const permissions = await effectivePermissions(context);
    const rows = await getDb()
      .select({
        id: integrationConnections.id,
        provider: integrationConnections.provider,
        status: integrationConnections.status,
        externalAccountRef: integrationConnections.externalAccountRef,
        externalAccountName: integrationConnections.externalAccountName,
        lastSuccessfulSyncAt: integrationConnections.lastSuccessfulSyncAt,
        lastErrorCode: integrationConnections.lastErrorCode,
        connectedAt: integrationConnections.connectedAt,
        dataPromotionStatus: integrationConnections.dataPromotionStatus,
        privacyDataDeletedAt: integrationConnections.privacyDataDeletedAt,
      })
      .from(integrationConnections)
      .where(eq(integrationConnections.organizationId, context.organizationId));
    const activeRows = rows.filter((row) => row.status !== "revoked" && row.status !== "not_connected");
    const byProvider = new Map<string, typeof activeRows>();
    for (const row of activeRows) byProvider.set(row.provider, [...(byProvider.get(row.provider) ?? []), row]);
    const database = getD1();
    const coverageRows = await Promise.all(integrationCatalog.map(async (provider) => {
      const connections = byProvider.get(provider.id) ?? [];
      const promoted = connections.some((connection) => connection.status === "connected" && connection.dataPromotionStatus === "approved");
      if (!promoted) {
        const coverage: CanonicalCommerceCoverage = { sales: false, payments: false, products: false, inventory: false, customers: false, suppliers: false, locations: false };
        return [provider.id, coverage] as const;
      }
      const facts = await database.prepare(`
        SELECT
          (SELECT COUNT(*) FROM commerce_sale_lines f JOIN integration_connections c ON c.id = f.connection_id AND c.organization_id = f.organization_id
             WHERE f.organization_id = ? AND f.provider = ? AND c.status = 'connected' AND c.data_promotion_status = 'approved') AS sales,
          (SELECT COUNT(*) FROM commerce_payments f JOIN integration_connections c ON c.id = f.connection_id AND c.organization_id = f.organization_id
             WHERE f.organization_id = ? AND f.provider = ? AND c.status = 'connected' AND c.data_promotion_status = 'approved') AS payments,
          (SELECT COUNT(*) FROM commerce_products f JOIN integration_connections c ON c.id = f.connection_id AND c.organization_id = f.organization_id
             WHERE f.organization_id = ? AND f.provider = ? AND f.archived = 0 AND c.status = 'connected' AND c.data_promotion_status = 'approved') AS products,
          (SELECT COUNT(*) FROM commerce_customers f JOIN integration_connections c ON c.id = f.connection_id AND c.organization_id = f.organization_id
             WHERE f.organization_id = ? AND f.provider = ? AND f.archived = 0 AND c.status = 'connected' AND c.data_promotion_status = 'approved') AS customers,
          (SELECT COUNT(*) FROM commerce_suppliers f JOIN integration_connections c ON c.id = f.connection_id AND c.organization_id = f.organization_id
             WHERE f.organization_id = ? AND f.provider = ? AND f.archived = 0 AND c.status = 'connected' AND c.data_promotion_status = 'approved') AS suppliers,
          (SELECT COUNT(*) FROM integration_location_mappings m JOIN integration_connections c ON c.id = m.connection_id AND c.organization_id = m.organization_id
             WHERE m.organization_id = ? AND m.provider = ? AND m.status = 'mapped' AND c.status = 'connected' AND c.data_promotion_status = 'approved') AS locations,
          (SELECT COUNT(*) FROM inventory_balances b
             WHERE b.organization_id = ? AND EXISTS (
               SELECT 1 FROM integration_location_mappings m
               JOIN integration_connections c ON c.id = m.connection_id AND c.organization_id = m.organization_id
               WHERE m.organization_id = b.organization_id AND m.provider = ? AND m.status = 'mapped'
                 AND c.status = 'connected' AND c.data_promotion_status = 'approved'
                 AND b.location_ref = m.provider || ':' || CASE WHEN c.source_namespace = 'legacy' THEN m.external_location_ref ELSE c.source_namespace || ':' || m.external_location_ref END
             )) AS inventory
      `).bind(
        context.organizationId, provider.id,
        context.organizationId, provider.id,
        context.organizationId, provider.id,
        context.organizationId, provider.id,
        context.organizationId, provider.id,
        context.organizationId, provider.id,
        context.organizationId, provider.id,
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
      return [provider.id, coverage] as const;
    }));
    const coverageByProvider = new Map(coverageRows);
    const syncEnabled = activeRows.some((row) => row.status === "connected");
    const dataPromotionEnabled = activeRows.some((row) => row.dataPromotionStatus === "approved");
    return jsonResponse({
      preSyncControls,
      syncEnabled,
      dataPromotionEnabled,
      canManage: permissions.includes("integrations.manage"),
      canManageBankConnections: permissions.includes("finance.connections"),
      integrations: integrationCatalog.map((provider) => {
        const canonicalCoverage = coverageByProvider.get(provider.id)!;
        const allProviderConnections = rows.filter((connection) => connection.provider === provider.id);
        const providerConnections = byProvider.get(provider.id) ?? [];
        const aggregate = aggregateConnectionStatus(providerConnections.map((connection) => ({
          ...connection,
          lastSuccessfulSyncAt: connection.lastSuccessfulSyncAt?.toISOString() ?? null,
        })));
        const canManageProvider = provider.id === "plaid"
          ? permissions.includes("finance.connections")
          : permissions.includes("integrations.manage");
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
        connections: providerConnections.map((connection) => ({
          id: connection.id,
          status: connection.status,
          maskedAccountRef: maskedAccountRef(connection.externalAccountRef),
          externalAccountName: connection.externalAccountName,
          lastSuccessfulSyncAt: connection.lastSuccessfulSyncAt?.toISOString() ?? null,
          lastErrorCode: connection.lastErrorCode,
          connectedAt: connection.connectedAt?.toISOString() ?? null,
          dataPromotionStatus: connection.dataPromotionStatus,
          privacyDataDeletedAt: connection.privacyDataDeletedAt?.toISOString() ?? null,
        })),
        privacyDataDeletedAt: allProviderConnections
          .map((connection) => connection.privacyDataDeletedAt)
          .filter((value): value is Date => Boolean(value))
          .sort((left, right) => right.getTime() - left.getTime())[0]?.toISOString() ?? null,
        providerReadiness: provider.id === "lightspeed"
          ? lightspeedReadiness()
          : provider.id === "lightspeed-r"
            ? lightspeedRReadiness()
            : provider.id === "stripe"
              ? stripeReadiness()
              : provider.id === "plaid"
                ? plaidReadiness()
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
    const context = await requireAccess(request, ["owner", "admin", "manager"]);
    await requireOrganizationWideLocationAccess(context);
    const permissions = await effectivePermissions(context);
    if (!permissions.includes("integrations.manage") && !permissions.includes("finance.connections")) {
      throw new ApiError(403, "PERMISSION_DENIED", "This account cannot approve integration data.");
    }
    const body = await request.json().catch(() => ({})) as {
      action?: unknown;
      connectionId?: unknown;
      confirmed?: unknown;
    };
    if (body.action !== "approve_data" || typeof body.connectionId !== "string" || body.confirmed !== true) {
      throw new ApiError(400, "INVALID_PROMOTION_REQUEST", "Confirm the reviewed provider account before making its data available.");
    }
    const [connection] = await getDb().select().from(integrationConnections).where(and(
      eq(integrationConnections.id, body.connectionId),
      eq(integrationConnections.organizationId, context.organizationId),
    )).limit(1);
    if (!connection || connection.status !== "connected") {
      throw new ApiError(404, "INTEGRATION_CONNECTION_NOT_FOUND", "The selected connected provider account is unavailable.");
    }
    if (connection.provider === "plaid") {
      await requirePermission(context, "finance.connections");
    } else if (connection.provider !== "plaid") {
      await requirePermission(context, "integrations.manage");
    }
    if (connection.dataPromotionStatus !== "staging") {
      throw new ApiError(409, "INTEGRATION_DATA_NOT_READY", "Sync and review this provider account before making its data available.");
    }
    if (!connection.lastSuccessfulSyncAt) {
      throw new ApiError(409, "INTEGRATION_SYNC_REQUIRED", "Complete a successful sync before making this data available.");
    }
    if (connection.syncLeaseOwner) {
      throw new ApiError(409, "INTEGRATION_SYNC_IN_PROGRESS", "Wait for the current sync to finish before approving this data.");
    }
    if (connection.lastErrorCode) {
      throw new ApiError(409, "INTEGRATION_SYNC_ERROR", "Resolve the latest sync error before approving this data.");
    }

    if (connection.provider === "lightspeed-r") {
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
        throw new ApiError(409, "INTEGRATION_SYNC_STALE", "The reviewed R-Series sync no longer matches this account. Sync and review it again.");
      }
      if (!lightspeedRCheckpointReadyForApproval(connection.lastSyncCursor)) {
        throw new ApiError(409, "INTEGRATION_BACKFILL_INCOMPLETE", "Continue the R-Series backfill before approving this data.");
      }
      const review = await getD1().prepare(`
        SELECT
          (SELECT COUNT(*) FROM integration_location_mappings
            WHERE organization_id = ? AND provider = ? AND connection_id = ? AND status = 'unmapped') AS unmapped,
          (SELECT COUNT(*) FROM integration_location_mappings
            WHERE organization_id = ? AND provider = ? AND connection_id = ?) AS locationCount
      `).bind(
        context.organizationId, connection.provider, connection.id,
        context.organizationId, connection.provider, connection.id,
      ).first<{ unmapped: number; locationCount: number }>();
      if (Number(review?.locationCount ?? 0) === 0) {
        throw new ApiError(409, "INTEGRATION_LOCATIONS_REQUIRED", "Discover and review the R-Series shops before making its data available.");
      }
      if (Number(review?.unmapped ?? 0) > 0) {
        throw new ApiError(409, "INTEGRATION_LOCATIONS_UNMAPPED", "Map or intentionally ignore every R-Series shop before making its data available.");
      }
    } else if (connection.provider !== "plaid") {
      throw new ApiError(409, "INTEGRATION_PROMOTION_UNAVAILABLE", "This provider remains staging-only until its reconciliation workflow is available.");
    }

    const approvedAt = new Date();
    const approved = await getDb().update(integrationConnections).set({
      dataPromotionStatus: connection.provider === "lightspeed-r" ? "staging" : "approved",
      promotionAuthorizedAt: connection.provider === "lightspeed-r" ? approvedAt : null,
      lastErrorCode: null,
      updatedAt: approvedAt,
    }).where(and(
      eq(integrationConnections.id, connection.id),
      eq(integrationConnections.organizationId, context.organizationId),
      eq(integrationConnections.provider, connection.provider),
      eq(integrationConnections.status, "connected"),
      eq(integrationConnections.dataPromotionStatus, "staging"),
      eq(integrationConnections.syncVersion, connection.syncVersion),
      eq(integrationConnections.lastSuccessfulSyncAt, connection.lastSuccessfulSyncAt),
      connection.lastSyncCursor === null
        ? isNull(integrationConnections.lastSyncCursor)
        : eq(integrationConnections.lastSyncCursor, connection.lastSyncCursor),
      isNull(integrationConnections.lastErrorCode),
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
      details: { provider: connection.provider, reviewedAt: approvedAt.toISOString() },
    });
    const publicationPending = connection.provider === "lightspeed-r";
    return jsonResponse({
      approved: true,
      connectionId: connection.id,
      provider: connection.provider,
      publicationPending,
      nextStep: publicationPending
        ? "Run one final R-Series sync to publish the reviewed data to dashboard features."
        : "Reviewed provider data is now available to dashboard features.",
    });
  });
}
