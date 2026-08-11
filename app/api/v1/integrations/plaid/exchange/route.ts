import { requireAccess } from "../../../../../../server/authorization";
import { recordAudit } from "../../../../../../server/audit";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../../../server/api";
import { getDb } from "../../../../../../db";
import { integrationConnections } from "../../../../../../db/schema";
import { and, eq } from "drizzle-orm";
import { exchangePlaidPublicToken, plaidRequiresUserRepair, PLAID_PROVIDER, plaidReadiness, syncPlaidTransactions } from "../../../../../../server/integrations/plaid";
import { requirePermission } from "../../../../../../server/permissions";
import { requireAddon } from "../../../../../../server/entitlements/engine";
import { requireOrganizationWideLocationAccess } from "../../../../../../server/location-access";
import { requireFreshPlaidConsent } from "../../../../../../server/privacy";

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, ["owner", "admin", "manager"]);
    await requireAddon(context, "bookloq");
    await requirePermission(context, "finance.connections");
    await requireOrganizationWideLocationAccess(context);
    await enforceRateLimit("plaid:exchange", context.userId, 6, 3_600);
    const input = await readJsonObject(request, 16_000);
    const publicToken = typeof input.publicToken === "string" ? input.publicToken.trim() : "";
    const consentRecordId = typeof input.consentRecordId === "string" ? input.consentRecordId.trim() : "";
    if (!publicToken || publicToken.length > 500 || !consentRecordId || consentRecordId.length > 100) {
      throw new ApiError(400, "PLAID_CONSENT_REQUIRED", "Confirm the disclosed read-only banking purpose before connecting.");
    }
    await requireFreshPlaidConsent({ consentRecordId, organizationId: context.organizationId, actorUserId: context.userId });
    let connection: Awaited<ReturnType<typeof exchangePlaidPublicToken>> | null = null;
    try {
      connection = await exchangePlaidPublicToken(context.organizationId, publicToken);
      let sync: Awaited<ReturnType<typeof syncPlaidTransactions>> | null = null;
      let syncWarning: string | null = null;
      try {
        sync = await syncPlaidTransactions(context.organizationId);
      } catch (error) {
        const errorCode = error instanceof ApiError ? error.code : "PLAID_INITIAL_SYNC_FAILED";
        syncWarning = "The institution is connected, but its first bank-feed sync needs to be retried.";
        await getDb().update(integrationConnections).set({
          status: plaidRequiresUserRepair(errorCode) ? "error" : "connected",
          lastErrorCode: errorCode,
          dataPromotionStatus: "staging",
          updatedAt: new Date(),
        }).where(and(
          eq(integrationConnections.id, connection.connectionId),
          eq(integrationConnections.organizationId, context.organizationId),
          eq(integrationConnections.provider, PLAID_PROVIDER),
        ));
      }
      await recordAudit({
        request,
        requestId,
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "integration.connected",
        resourceType: "integration",
        resourceId: PLAID_PROVIDER,
        details: {
          provider: PLAID_PROVIDER,
          mode: plaidReadiness().mode,
          institutionName: connection.institutionName,
          initialSyncCompleted: Boolean(sync),
          accountsImported: sync?.accountsImported ?? 0,
          recordsImported: (sync?.added ?? 0) + (sync?.modified ?? 0),
          dataPromotionStatus: "staging",
          consentRecordId,
        },
      });
      return jsonResponse({
        connected: true,
        institutionName: connection.institutionName,
        accountsImported: sync?.accountsImported ?? 0,
        sync,
        syncWarning,
        bankBalancesAvailable: false,
        transactionReviewRequired: true,
      });
    } catch (error) {
      await recordAudit({
        request,
        requestId,
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "integration.connected",
        resourceType: "integration",
        resourceId: PLAID_PROVIDER,
        outcome: "failure",
        details: {
          provider: PLAID_PROVIDER,
          mode: plaidReadiness().mode,
          errorCode: error instanceof ApiError ? error.code : "PLAID_CONNECTION_FAILED",
        },
      });
      throw error;
    }
  });
}
