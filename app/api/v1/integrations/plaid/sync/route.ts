import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { bankAccounts, integrationConnections } from "../../../../../../db/schema";
import { requireAccess } from "../../../../../../server/authorization";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, requireSameOrigin } from "../../../../../../server/api";
import { recordAudit } from "../../../../../../server/audit";
import { plaidRequiresUserRepair, syncPlaidTransactions } from "../../../../../../server/integrations/plaid";
import { requirePermission } from "../../../../../../server/permissions";

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, ["owner", "admin", "manager"]);
    await requirePermission(context, "finance.connections");
    await enforceRateLimit("plaid:sync", context.organizationId, 20, 3_600);
    let sync: Awaited<ReturnType<typeof syncPlaidTransactions>>;
    try {
      sync = await syncPlaidTransactions(context.organizationId);
    } catch (error) {
      if (error instanceof ApiError && plaidRequiresUserRepair(error.code)) {
        const now = new Date();
        await getDb().update(integrationConnections).set({ status: "error", lastErrorCode: error.code, updatedAt: now }).where(and(
          eq(integrationConnections.organizationId, context.organizationId),
          eq(integrationConnections.provider, "plaid"),
        ));
        await getDb().update(bankAccounts).set({ connectionStatus: "error", updatedAt: now }).where(and(
          eq(bankAccounts.organizationId, context.organizationId),
          eq(bankAccounts.provider, "plaid"),
        ));
      }
      throw error;
    }
    await recordAudit({
      request,
      requestId,
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "integration.synchronized",
      resourceType: "integration",
      resourceId: "plaid",
      details: { provider: "plaid", ...sync, dataPromotionStatus: "staging" },
    });
    return jsonResponse({ sync, reviewRequired: true });
  });
}
