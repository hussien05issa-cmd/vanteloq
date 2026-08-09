import { getDb } from "../../../../../../db";
import { integrationOAuthStates } from "../../../../../../db/schema";
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
    const context = await requireAccess(request, ["owner", "admin"]);
    await requirePermission(context, "integrations.manage");
    await enforceRateLimit("stripe:authorize", context.userId, 10, 3_600);
    const state = newStripeOAuthState();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60_000);
    await getDb().insert(integrationOAuthStates).values({
      stateHash: await sha256Hex(state),
      organizationId: context.organizationId,
      actorUserId: context.userId,
      provider: STRIPE_PROVIDER,
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
      details: { provider: STRIPE_PROVIDER, mode: "read_only_staging", expiresInSeconds: 600 },
    });
    return jsonResponse({
      authorizationUrl: buildStripeAuthorizationUrl(state),
      expiresAt: expiresAt.toISOString(),
      mode: "read_only_staging",
      dataPromotionEnabled: false,
    });
  });
}
