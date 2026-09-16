import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { integrationConsents, integrationOAuthStates } from "../../../../../../db/schema";
import { recordAudit } from "../../../../../../server/audit";
import { requirePrivacyAccess } from "../../../../../../server/authorization";
import { enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../../../server/api";
import { requireOwnedIntegrationConnection } from "../../../../../../server/integrations/connection";
import { removeQuickBooksGrant, QUICKBOOKS_PROVIDER } from "../../../../../../server/integrations/quickbooks";
import { requirePermission } from "../../../../../../server/permissions";

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requirePrivacyAccess(request, ["owner", "admin"]);
    await requirePermission(context, "integrations.manage");
    await enforceRateLimit("quickbooks:disconnect", context.userId, 10, 3_600);
    const body = await readJsonObject(request);
    const connection = await requireOwnedIntegrationConnection(
      context.organizationId,
      QUICKBOOKS_PROVIDER,
      typeof body.connectionId === "string" ? body.connectionId : null,
    );
    const removal = await removeQuickBooksGrant(context.organizationId, connection.id);
    const now = new Date();
    await getDb().delete(integrationOAuthStates).where(and(
      eq(integrationOAuthStates.organizationId, context.organizationId),
      eq(integrationOAuthStates.provider, QUICKBOOKS_PROVIDER),
      eq(integrationOAuthStates.connectionId, connection.id),
    ));
    await getDb().update(integrationConsents).set({ status: "withdrawn", withdrawnAt: now, updatedAt: now }).where(and(
      eq(integrationConsents.organizationId, context.organizationId),
      eq(integrationConsents.provider, QUICKBOOKS_PROVIDER),
      eq(integrationConsents.status, "accepted"),
    ));
    await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
      action: "integration.disconnected", resourceType: "integration_connection", resourceId: connection.id,
      details: { provider: QUICKBOOKS_PROVIDER, ...removal, dataPromotionEnabled: false },
    });
    return jsonResponse({ disconnected: true, connectionId: connection.id, ...removal,
      message: removal.providerRevocationRequired
        ? "QuickBooks was removed from Vanteloq. Remove Vanteloq from your Intuit connected apps to finish revoking provider access."
        : "QuickBooks was disconnected and local credentials were deleted." });
  });
}
