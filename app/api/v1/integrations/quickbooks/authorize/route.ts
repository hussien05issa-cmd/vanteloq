import { requireIntegrationRollout } from "../../../../../../server/integrations/rollout-access";
import { oauthBrowserCookie } from "../../../../../../server/integrations/oauth-browser";
import { getDb } from "../../../../../../db";
import { integrationConnections, integrationOAuthStates } from "../../../../../../db/schema";
import { PRIVACY_POLICY_VERSION, QUICKBOOKS_CONSENT_NOTICE_VERSION } from "../../../../../../domain/privacy-controls";
import { recordAudit } from "../../../../../../server/audit";
import { requireAccess } from "../../../../../../server/authorization";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../../../server/api";
import { requireFeature } from "../../../../../../server/entitlements/engine";
import {
  buildQuickBooksAuthorizationUrl,
  newQuickBooksOAuthState,
  newQuickBooksGrantNamespace,
  quickBooksReadiness,
  quickBooksStateHash,
  QUICKBOOKS_PROVIDER,
} from "../../../../../../server/integrations/quickbooks";
import { requirePermission } from "../../../../../../server/permissions";
import { recordQuickBooksConsent } from "../../../../../../server/privacy";

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, ["owner", "admin"], "bookloq.reconciliation");
    await requireFeature(context, "bookloq.reconciliation");
    await requirePermission(context, "integrations.manage");
    await requireIntegrationRollout(context, "quickbooks");
    await enforceRateLimit("quickbooks:authorize", context.userId, 10, 3_600);
    const body = await readJsonObject(request);
    if (body.consentAcknowledged !== true) {
      throw new ApiError(400, "QUICKBOOKS_CONSENT_REQUIRED", "Review and accept the QuickBooks read only data notice before connecting.");
    }
    await recordQuickBooksConsent({
      organizationId: context.organizationId,
      actorUserId: context.userId,
      noticeVersion: typeof body.noticeVersion === "string" ? body.noticeVersion : "",
      privacyPolicyVersion: typeof body.privacyPolicyVersion === "string" ? body.privacyPolicyVersion : "",
    });
    const state = newQuickBooksOAuthState();
    const connectionId = crypto.randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60_000);
    const readiness = quickBooksReadiness();
    await getDb().insert(integrationConnections).values({
      id: connectionId,
      organizationId: context.organizationId,
      provider: QUICKBOOKS_PROVIDER,
      sourceNamespace: await newQuickBooksGrantNamespace(connectionId),
      status: "pending",
      externalAccountRef: null,
      externalAccountName: "New QuickBooks company",
      domainPrefix: null,
      apiVersion: readiness.apiVersion,
      scopesJson: "[]",
      dataPromotionStatus: "blocked",
      createdAt: now,
      updatedAt: now,
    });
    await getDb().insert(integrationOAuthStates).values({
      stateHash: await quickBooksStateHash(state),
      organizationId: context.organizationId,
      actorUserId: context.userId,
      provider: QUICKBOOKS_PROVIDER,
      connectionId,
      initiatorAuthSubject: context.identity.subject,
      initiatorAuthProvider: context.identity.provider,
      initiatorAssuranceLevel: context.identity.assuranceLevel,
      expiresAt,
      consumedAt: null,
      createdAt: now,
    });
    await recordAudit({
      request,
      requestId,
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "integration.authorization_started",
      resourceType: "integration",
      resourceId: connectionId,
      details: {
        provider: QUICKBOOKS_PROVIDER,
        connectionId,
        environment: readiness.environment,
        mode: readiness.mode,
        noticeVersion: QUICKBOOKS_CONSENT_NOTICE_VERSION,
        privacyPolicyVersion: PRIVACY_POLICY_VERSION,
        expiresInSeconds: 600,
      },
    });
    return jsonResponse({
      authorizationUrl: buildQuickBooksAuthorizationUrl(state),
      expiresAt: expiresAt.toISOString(),
      connectionId,
      environment: readiness.environment,
      mode: readiness.mode,
      dataPromotionEnabled: false,
    }, { headers: { "Set-Cookie": oauthBrowserCookie("quickbooks", state) } });
  });
}
