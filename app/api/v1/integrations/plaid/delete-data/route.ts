import { requirePrivacyAccess } from "../../../../../../server/authorization";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../../../server/api";
import { recordAudit } from "../../../../../../server/audit";
import { deletePlaidConsumerData } from "../../../../../../server/integrations/plaid";
import { requirePermission } from "../../../../../../server/permissions";
import { withdrawPlaidConsents } from "../../../../../../server/privacy";
import { requireOrganizationWideLocationAccess } from "../../../../../../server/location-access";

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requirePrivacyAccess(request, ["owner"]);
    await requirePermission(context, "finance.connections");
    await requireOrganizationWideLocationAccess(context);
    await enforceRateLimit("plaid:delete-data", context.userId, 3, 86_400);
    const input = await readJsonObject(request, 1_000);
    if (input.confirmation !== "DELETE PLAID DATA") {
      throw new ApiError(400, "PLAID_DELETE_CONFIRMATION_REQUIRED", "Type DELETE PLAID DATA to confirm this request.");
    }
    const result = await deletePlaidConsumerData(context.organizationId);
    await withdrawPlaidConsents(context.organizationId, context.userId);
    await recordAudit({
      request,
      requestId,
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "privacy.plaid_data_deleted",
      resourceType: "integration",
      resourceId: "plaid",
      details: { ...result, consentWithdrawn: true, retainedAccountingFieldsDeidentified: true },
    });
    return jsonResponse({
      deleted: true,
      ...result,
      retainedRecordRule: "Only approved, reconciled, or posted accounting fields remain, with provider identifiers and descriptions removed.",
    });
  });
}
