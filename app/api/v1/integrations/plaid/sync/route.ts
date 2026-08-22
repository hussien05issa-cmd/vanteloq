import { requireAccess } from "../../../../../../server/authorization";
import { recordAudit } from "../../../../../../server/audit";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, requireSameOrigin } from "../../../../../../server/api";
import { PLAID_PROVIDER, plaidReadiness, syncPlaidTransactions } from "../../../../../../server/integrations/plaid";
import { requirePermission } from "../../../../../../server/permissions";
import { requireAddon } from "../../../../../../server/entitlements/engine";
import { requireOrganizationWideLocationAccess } from "../../../../../../server/location-access";

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, ["owner", "admin", "manager"], "bookloq.reconciliation");
    await requireAddon(context, "bookloq");
    await requirePermission(context, "finance.connections");
    await requireOrganizationWideLocationAccess(context);
    await enforceRateLimit("plaid:sync", context.organizationId, 20, 3_600);
    try {
      const sync = await syncPlaidTransactions(context.organizationId);
      await recordAudit({
        request,
        requestId,
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "integration.synchronized",
        resourceType: "integration",
        resourceId: PLAID_PROVIDER,
        details: {
          provider: PLAID_PROVIDER,
          mode: plaidReadiness().mode,
          accountsImported: sync.accountsImported,
          added: sync.added,
          modified: sync.modified,
          removed: sync.removed,
          pages: sync.pages,
          dataPromotionStatus: sync.dataPromotionStatus,
        },
      });
      return jsonResponse({
        sync,
        bankBalancesAvailable: false,
        transactionReviewRequired: true,
      });
    } catch (error) {
      await recordAudit({
        request,
        requestId,
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "integration.synchronized",
        resourceType: "integration",
        resourceId: PLAID_PROVIDER,
        outcome: "failure",
        details: {
          provider: PLAID_PROVIDER,
          mode: plaidReadiness().mode,
          errorCode: error instanceof ApiError ? error.code : "PLAID_SYNC_FAILED",
        },
      });
      throw error;
    }
  });
}
