import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { integrationConnections, integrationLocationMappings, integrationSyncRuns } from "../../../../../../db/schema";
import { requireIntegrationAccess } from "../../../../../../server/integrations/free-selection";
import { handleApi, jsonResponse } from "../../../../../../server/api";
import { DEEL_PROVIDER, deelReadiness } from "../../../../../../server/integrations/deel";
import { requireIntegrationRollout } from "../../../../../../server/integrations/rollout-access";
import { requirePermission } from "../../../../../../server/permissions";

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireIntegrationAccess(request, ["owner", "admin", "manager"], "deel", false);
    await requirePermission(context, "payroll.totals");
    await requireIntegrationRollout(context, DEEL_PROVIDER);
    const connections = await getDb().select({
      id: integrationConnections.id, status: integrationConnections.status,
      accountName: integrationConnections.externalAccountName,
      dataPromotionStatus: integrationConnections.dataPromotionStatus,
      connectedAt: integrationConnections.connectedAt,
      lastSuccessfulSyncAt: integrationConnections.lastSuccessfulSyncAt,
      lastErrorCode: integrationConnections.lastErrorCode,
    }).from(integrationConnections).where(and(
      eq(integrationConnections.organizationId, context.organizationId), eq(integrationConnections.provider, DEEL_PROVIDER),
    ));
    const mappings = await getDb().select({
      connectionId: integrationLocationMappings.connectionId,
      legalEntityRef: integrationLocationMappings.externalLocationRef,
      legalEntityName: integrationLocationMappings.externalName,
      locationId: integrationLocationMappings.localLocationId,
      status: integrationLocationMappings.status,
    }).from(integrationLocationMappings).where(and(
      eq(integrationLocationMappings.organizationId, context.organizationId), eq(integrationLocationMappings.provider, DEEL_PROVIDER),
    ));
    const [latestRun] = await getDb().select({
      status: integrationSyncRuns.status, recordsRead: integrationSyncRuns.recordsRead,
      recordsStaged: integrationSyncRuns.recordsStaged, warningCount: integrationSyncRuns.warningCount,
      errorCode: integrationSyncRuns.errorCode, startedAt: integrationSyncRuns.startedAt,
      completedAt: integrationSyncRuns.completedAt,
    }).from(integrationSyncRuns).where(and(
      eq(integrationSyncRuns.organizationId, context.organizationId), eq(integrationSyncRuns.provider, DEEL_PROVIDER),
    )).orderBy(desc(integrationSyncRuns.startedAt)).limit(1);
    return jsonResponse({
      provider: DEEL_PROVIDER, availability: "coming_soon", readiness: deelReadiness(),
      connections, legalEntityMappings: mappings, latestRun: latestRun ?? null,
      dataBoundary: {
        includes: ["payroll cycle dates for available reports", "legal entity name and country", "currency-level category totals"],
        excludes: ["employee names", "bank details", "payslips", "contract identifiers", "individual compensation"],
        employeeRecordsStored: false, dataPromotionEnabled: false, payrollStatusVerified: false,
      },
    });
  });
}
