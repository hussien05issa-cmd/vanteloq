import { oauthBrowserCookie } from "../../../../../../server/integrations/oauth-browser";
import { getDb } from "../../../../../../db";
import { integrationConnections, integrationOAuthStates } from "../../../../../../db/schema";
import { recordAudit } from "../../../../../../server/audit";
import { requireAccess } from "../../../../../../server/authorization";
import { enforceRateLimit, handleApi, jsonResponse, requireSameOrigin } from "../../../../../../server/api";
import {
  buildStripeAuthorizationUrl,
  newStripeOAuthState,
  sha256Hex,
  STRIPE_PROVIDER,
} from "../../../../../../server/integrations/stripe";
import { requirePermission } from "../../../../../../server/permissions";

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, ["owner", "admin"], "pos.reporting.core");
    await requirePermission(context, "integrations.manage");
    await enforceRateLimit("stripe:authorize", context.userId, 10, 3_600);
    const state = newStripeOAuthState();
    const authorizationUrl = buildStripeAuthorizationUrl(state);
    const connectionId = crypto.randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60_000);
    await getDb().insert(integrationConnections).values({
      id: connectionId,
      organizationId: context.organizationId,
      provider: STRIPE_PROVIDER,
      sourceNamespace: connectionId,
      status: "pending",
      externalAccountRef: null,
      externalAccountName: "New Stripe account",
      domainPrefix: null,
      apiVersion: null,
      scopesJson: "[]",
      dataPromotionStatus: "blocked",
      connectedAt: null,
      lastSuccessfulSyncAt: null,
      lastSyncCursor: null,
      lastErrorCode: null,
      createdAt: now,
      updatedAt: now,
    });
    await getDb().insert(integrationOAuthStates).values({
      stateHash: await sha256Hex(state),
      organizationId: context.organizationId,
      actorUserId: context.userId,
      provider: STRIPE_PROVIDER,
      connectionId,
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
      resourceId: STRIPE_PROVIDER,
      details: { provider: STRIPE_PROVIDER, connectionId, mode: "read_only_staging", expiresInSeconds: 600 },
    });
    return jsonResponse({
      authorizationUrl,
      expiresAt: expiresAt.toISOString(),
      connectionId,
      mode: "read_only_staging",
      dataPromotionEnabled: false,
    }, { headers: { "Set-Cookie": oauthBrowserCookie("stripe", state) } });
  });
}
