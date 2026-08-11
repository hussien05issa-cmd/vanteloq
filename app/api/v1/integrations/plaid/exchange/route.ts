import { requireAccess } from "../../../../../../server/authorization";
import { recordAudit } from "../../../../../../server/audit";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../../../server/api";
import { exchangePlaidPublicToken, PLAID_PROVIDER, plaidReadiness, syncPlaidTransactions } from "../../../../../../server/integrations/plaid";
import { requirePermission } from "../../../../../../server/permissions";
import { requireAddon } from "../../../../../../server/entitlements/engine";
import { requireOrganizationWideLocationAccess } from "../../../../../../server/location-access";

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
    if (!publicToken || publicToken.length > 500 || input.consentAcknowledged !== true) {
      throw new ApiError(400, "PLAID_CONSENT_REQUIRED", "Confirm the disclosed read-only banking purpose before connecting.");
    }
    let connected = false;
    try {
      const connection = await exchangePlaidPublicToken(context.organizationId, publicToken);
      connected = true;
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
          accountsImported: connection.accountsImported,
          dataPromotionEnabled: plaidReadiness().liveDataEligible,
        },
      });
      const sync = await syncPlaidTransactions(context.organizationId);
      await recordAudit({
        request,
        requestId,
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "integration.data_imported",
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
          dataPromotionEnabled: plaidReadiness().liveDataEligible,
        },
      });
      return jsonResponse({ connected: true, accountsImported: connection.accountsImported, sync });
    } catch (error) {
      await recordAudit({
        request,
        requestId,
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: connected ? "integration.data_imported" : "integration.connected",
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
