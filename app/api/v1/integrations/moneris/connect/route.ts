import { requireIntegrationRollout } from "../../../../../../server/integrations/rollout-access";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { integrationConnections, integrationConsents } from "../../../../../../db/schema";
import { recordAudit } from "../../../../../../server/audit";
import { requireAccess } from "../../../../../../server/authorization";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../../../server/api";
import { MONERIS_API_VERSION, MONERIS_PROVIDER, requestMonerisAccessToken, resolveMonerisEnvironment, saveMonerisCredentials, validateMonerisCredentialInput } from "../../../../../../server/integrations/moneris";
import { requirePermission } from "../../../../../../server/permissions";

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, ["owner", "admin"], "pos.reporting.core");
    await requirePermission(context, "integrations.manage");
    await requireIntegrationRollout(context, "moneris");
    await enforceRateLimit("moneris:connect", context.userId, 6, 3_600);
    const body = await readJsonObject(request);
    if (body.accepted !== true) throw new ApiError(400, "MONERIS_CONSENT_REQUIRED", "Confirm the read-only payment-data notice before connecting Moneris.");
    const credentials = validateMonerisCredentialInput(body);
    const name = typeof body.accountName === "string" && body.accountName.trim()
      ? body.accountName.trim().slice(0, 120)
      : `Moneris ${credentials.environment === "production" ? "merchant" : "sandbox"}`;
    const now = new Date();
    const [existing] = await getDb().select({ id: integrationConnections.id, sourceNamespace: integrationConnections.sourceNamespace, legacyEnvironment: integrationConnections.domainPrefix }).from(integrationConnections).where(and(
      eq(integrationConnections.organizationId, context.organizationId),
      eq(integrationConnections.provider, MONERIS_PROVIDER),
      eq(integrationConnections.externalAccountRef, credentials.merchantId),
    )).limit(1);
    if (existing && resolveMonerisEnvironment(credentials.merchantId, existing.sourceNamespace, existing.legacyEnvironment) !== credentials.environment) {
      throw new ApiError(409, "MONERIS_ENVIRONMENT_CONFLICT", "This merchant ID already belongs to another Moneris environment. Use the production merchant ID supplied by Moneris so test records stay separate.");
    }
    await requestMonerisAccessToken(credentials);
    const connectionId = existing?.id ?? crypto.randomUUID();
    if (existing) {
      await getDb().update(integrationConnections).set({
        sourceNamespace: `${credentials.environment}:${credentials.merchantId}`,
        status: "connected", externalAccountName: name, domainPrefix: null,
        apiVersion: MONERIS_API_VERSION, scopesJson: JSON.stringify([credentials.scope]),
        dataPromotionStatus: "staging", connectedAt: now, lastErrorCode: null, updatedAt: now,
      }).where(and(eq(integrationConnections.id, connectionId), eq(integrationConnections.organizationId, context.organizationId)));
    } else {
      await getDb().insert(integrationConnections).values({
        id: connectionId, organizationId: context.organizationId, provider: MONERIS_PROVIDER,
        sourceNamespace: `${credentials.environment}:${credentials.merchantId}`, status: "connected",
        externalAccountRef: credentials.merchantId, externalAccountName: name,
        domainPrefix: null, apiVersion: MONERIS_API_VERSION,
        scopesJson: JSON.stringify([credentials.scope]), dataPromotionStatus: "staging",
        connectedAt: now, lastSuccessfulSyncAt: null, lastSyncCursor: null, lastErrorCode: null,
        createdAt: now, updatedAt: now,
      });
    }
    await saveMonerisCredentials(context.organizationId, connectionId, credentials);
    await getDb().insert(integrationConsents).values({
      id: crypto.randomUUID(), organizationId: context.organizationId, actorUserId: context.userId,
      provider: MONERIS_PROVIDER, status: "accepted", noticeVersion: "moneris-payments-v1",
      privacyPolicyVersion: "2026-08-14", dataCategoriesJson: JSON.stringify(["payment amount", "currency", "status", "timestamps", "settlement references"]),
      purposesJson: JSON.stringify(["payment reconciliation", "cash-flow analysis", "BookLoQ reporting"]),
      consentSource: "in_app", acceptedAt: now, withdrawnAt: null, createdAt: now, updatedAt: now,
    });
    await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
      action: "integration.connected", resourceType: "integration_connection", resourceId: connectionId,
      details: { provider: MONERIS_PROVIDER, environment: credentials.environment, readOnly: true, rawCardDataStored: false, scope: credentials.scope },
    });
    return jsonResponse({ connected: true, connectionId, accountName: name, environment: credentials.environment, nextStep: "Moneris is connected. Sync a reviewed payment sample before enabling reconciliation reports." });
  });
}
