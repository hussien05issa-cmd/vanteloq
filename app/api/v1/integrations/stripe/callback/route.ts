import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { integrationConnections, integrationOAuthStates } from "../../../../../../db/schema";
import { recordAudit } from "../../../../../../server/audit";
import { requireAccess } from "../../../../../../server/authorization";
import { ApiError, handleApi } from "../../../../../../server/api";
import {
  exchangeStripeAuthorizationCode,
  sha256Hex,
  STRIPE_PROVIDER,
  stripeReadiness,
  verifyStripeAccount,
} from "../../../../../../server/integrations/stripe";
import { requirePermission } from "../../../../../../server/permissions";

function returnUrl(request: Request, status: "connected" | "declined" | "failed") {
  return new URL(`/?integration=stripe&connection=${status}`, new URL(request.url).origin).toString();
}

export async function GET(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    const url = new URL(request.url);
    if (url.searchParams.get("error")) return Response.redirect(returnUrl(request, "declined"), 303);
    const code = url.searchParams.get("code")?.trim() ?? "";
    const state = url.searchParams.get("state")?.trim() ?? "";
    if (!code || code.length > 512 || !state || state.length > 512) {
      throw new ApiError(400, "STRIPE_CALLBACK_INVALID", "Stripe returned an incomplete callback.");
    }
    const context = await requireAccess(request, ["owner", "admin"]);
    await requirePermission(context, "integrations.manage");
    const stateHash = await sha256Hex(state);
    const now = new Date();
    const [storedState] = await getDb().select().from(integrationOAuthStates).where(and(
      eq(integrationOAuthStates.stateHash, stateHash),
      eq(integrationOAuthStates.provider, STRIPE_PROVIDER),
      eq(integrationOAuthStates.organizationId, context.organizationId),
      eq(integrationOAuthStates.actorUserId, context.userId),
      isNull(integrationOAuthStates.consumedAt),
      gt(integrationOAuthStates.expiresAt, now),
    )).limit(1);
    if (!storedState) {
      throw new ApiError(400, "STRIPE_STATE_INVALID", "The Stripe authorization attempt expired or was already used. Start again.");
    }
    await getDb().update(integrationOAuthStates).set({ consumedAt: now }).where(eq(integrationOAuthStates.stateHash, stateHash));

    try {
      const authorization = await exchangeStripeAuthorizationCode(code);
      const account = await verifyStripeAccount(authorization.stripe_user_id);
      const readiness = stripeReadiness();
      await getDb().insert(integrationConnections).values({
        id: crypto.randomUUID(),
        organizationId: context.organizationId,
        provider: STRIPE_PROVIDER,
        status: "connected",
        externalAccountRef: account.id,
        domainPrefix: null,
        apiVersion: readiness.apiVersion,
        scopesJson: JSON.stringify([authorization.scope]),
        dataPromotionStatus: "blocked",
        connectedAt: now,
        lastSuccessfulSyncAt: null,
        lastSyncCursor: null,
        lastErrorCode: null,
        createdAt: now,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: [integrationConnections.organizationId, integrationConnections.provider],
        set: {
          status: "connected",
          externalAccountRef: account.id,
          domainPrefix: null,
          apiVersion: readiness.apiVersion,
          scopesJson: JSON.stringify([authorization.scope]),
          dataPromotionStatus: "blocked",
          connectedAt: now,
          lastSuccessfulSyncAt: null,
          lastSyncCursor: null,
          lastErrorCode: null,
          updatedAt: now,
        },
      });
      await recordAudit({
        request,
        requestId,
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "integration.connected",
        resourceType: "integration",
        resourceId: STRIPE_PROVIDER,
        details: {
          provider: STRIPE_PROVIDER,
          mode: "read_only_staging",
          livemode: account.livemode,
          dataPromotionEnabled: false,
        },
      });
      return Response.redirect(returnUrl(request, "connected"), 303);
    } catch (error) {
      const errorCode = error instanceof ApiError ? error.code : "STRIPE_CONNECTION_FAILED";
      await getDb().update(integrationConnections).set({
        status: "error",
        dataPromotionStatus: "blocked",
        connectedAt: null,
        lastErrorCode: errorCode,
        updatedAt: new Date(),
      }).where(and(
        eq(integrationConnections.organizationId, context.organizationId),
        eq(integrationConnections.provider, STRIPE_PROVIDER),
      ));
      await recordAudit({
        request,
        requestId,
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "integration.connection_failed",
        resourceType: "integration",
        resourceId: STRIPE_PROVIDER,
        details: { provider: STRIPE_PROVIDER, errorCode, dataPromotionEnabled: false },
      });
      return Response.redirect(returnUrl(request, "failed"), 303);
    }
  });
}
