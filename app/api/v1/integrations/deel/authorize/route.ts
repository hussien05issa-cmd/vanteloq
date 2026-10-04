import { requireProviderPrivacy } from "../../../../../../server/integrations/provider-privacy";
import { and, eq, or } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { integrationConnections, integrationConsents, integrationOAuthStates } from "../../../../../../db/schema";
import { recordAudit } from "../../../../../../server/audit";
import { requireIntegrationAccess, integrationGrantId } from "../../../../../../server/integrations/free-selection";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../../../server/api";
import {
  buildDeelAuthorizationUrl, DEEL_API_VERSION, DEEL_DATA_CATEGORIES, DEEL_NOTICE_VERSION,
  DEEL_PROCESSING_PURPOSES, DEEL_PROVIDER, DEEL_READ_SCOPES, deelStateHash, newDeelState,
} from "../../../../../../server/integrations/deel";
import { oauthBrowserCookie } from "../../../../../../server/integrations/oauth-browser";
import { requireIntegrationRollout } from "../../../../../../server/integrations/rollout-access";
import { requirePermission } from "../../../../../../server/permissions";
import { PRIVACY_POLICY_VERSION } from "../../../../../../shared/legal-versions";

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireIntegrationAccess(request, ["owner", "admin"], "deel", true);
    await requirePermission(context, "integrations.manage");
    await requirePermission(context, "payroll.totals");
    await requireIntegrationRollout(context, DEEL_PROVIDER);
    await enforceRateLimit("deel:authorize", context.userId, 10, 3_600);
    await requireProviderPrivacy(request, context, "deel", requestId);
    const input = await readJsonObject(request);
    if (input.confirmedAggregatePayrollOnly !== true) {
      throw new ApiError(409, "DEEL_CONSENT_REQUIRED", "Confirm the finalized aggregate payroll notice before connecting Deel.");
    }
    const [active] = await getDb().select({ id: integrationConnections.id }).from(integrationConnections).where(and(
      eq(integrationConnections.organizationId, context.organizationId),
      eq(integrationConnections.provider, DEEL_PROVIDER),
      or(eq(integrationConnections.status, "connected"), eq(integrationConnections.status, "pending")),
    )).limit(1);
    if (active) throw new ApiError(409, "DEEL_ALREADY_CONNECTED", "This workspace already has an active Deel connection.");

    const state = newDeelState();
    // Validate provider credentials and production approval before persisting
    // a connection, consent record, or one-time state.
    const authorizationUrl = buildDeelAuthorizationUrl(state);
    const connectionId = crypto.randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60_000);
    await getDb().insert(integrationConnections).values({
      freeGrantId: await integrationGrantId(context, "deel"),
      id: connectionId, organizationId: context.organizationId, provider: DEEL_PROVIDER,
      sourceNamespace: connectionId, status: "pending", externalAccountRef: null,
      externalAccountName: "New Deel organization", domainPrefix: null,
      apiVersion: DEEL_API_VERSION, scopesJson: JSON.stringify(DEEL_READ_SCOPES),
      dataPromotionStatus: "blocked", connectedAt: null, lastSuccessfulSyncAt: null,
      lastSyncCursor: null, lastErrorCode: null, createdAt: now, updatedAt: now,
    });
    await getDb().insert(integrationConsents).values({
      id: crypto.randomUUID(), organizationId: context.organizationId, actorUserId: context.userId,
      provider: DEEL_PROVIDER, status: "accepted", noticeVersion: DEEL_NOTICE_VERSION,
      privacyPolicyVersion: PRIVACY_POLICY_VERSION,
      dataCategoriesJson: JSON.stringify(DEEL_DATA_CATEGORIES),
      purposesJson: JSON.stringify(DEEL_PROCESSING_PURPOSES), consentSource: "in_app",
      acceptedAt: now, withdrawnAt: null, createdAt: now, updatedAt: now,
    });
    await getDb().insert(integrationOAuthStates).values({
      stateHash: await deelStateHash(state), organizationId: context.organizationId,
      actorUserId: context.userId, provider: DEEL_PROVIDER, connectionId,
      initiatorAuthSubject: context.authSubject, initiatorAuthProvider: context.authProvider,
      initiatorAssuranceLevel: context.identity.assuranceLevel,
      expiresAt, consumedAt: null, createdAt: now,
    });
    await recordAudit({
      request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
      action: "integration.authorization_started", resourceType: "integration_connection", resourceId: connectionId,
      details: { provider: DEEL_PROVIDER, mode: "aggregate_finalized_payroll_staging", employeeRecordsStored: false, expiresInSeconds: 600 },
    });
    return jsonResponse({
      authorizationUrl, connectionId,
      expiresAt: expiresAt.toISOString(), scopes: [...DEEL_READ_SCOPES],
      mode: "aggregate_finalized_payroll_staging", dataPromotionEnabled: false,
    }, { headers: { "Set-Cookie": oauthBrowserCookie(DEEL_PROVIDER, state) } });
  });
}
