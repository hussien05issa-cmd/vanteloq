import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { integrationConnections, integrationLocationMappings, integrationOAuthStates, integrationSecrets } from "../../../../../../db/schema";
import { recordAudit } from "../../../../../../server/audit";
import { requireAccess } from "../../../../../../server/authorization";
import { ApiError, handleApi } from "../../../../../../server/api";
import {
  exchangeLightspeedRCode, fetchLightspeedRAccount, fetchLightspeedRCollection,
  LIGHTSPEED_R_PROVIDER, LIGHTSPEED_R_SCOPES, lightspeedRReadiness,
  lightspeedRSha256, saveLightspeedRTokens,
} from "../../../../../../server/integrations/lightspeed-r";
import { requirePermission } from "../../../../../../server/permissions";

function returnUrl(request: Request, status: "connected" | "declined" | "failed") {
  const url = new URL(request.url);
  return new URL(`/?integration=lightspeed-r&connection=${status}`, url.origin).toString();
}

export async function GET(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    const url = new URL(request.url);
    if (url.searchParams.get("error")) return Response.redirect(returnUrl(request, "declined"), 303);
    const code = url.searchParams.get("code")?.trim() ?? "";
    const state = url.searchParams.get("state")?.trim() ?? "";
    if (!code || code.length > 512 || !state || state.length > 512) throw new ApiError(400, "LIGHTSPEED_R_CALLBACK_INVALID", "R-Series returned an incomplete callback.");
    const context = await requireAccess(request, ["owner", "admin"]);
    await requirePermission(context, "integrations.manage");
    const stateHash = await lightspeedRSha256(state);
    const now = new Date();
    const [stored] = await getDb().select().from(integrationOAuthStates).where(and(
      eq(integrationOAuthStates.stateHash, stateHash),
      eq(integrationOAuthStates.provider, LIGHTSPEED_R_PROVIDER),
      eq(integrationOAuthStates.organizationId, context.organizationId),
      eq(integrationOAuthStates.actorUserId, context.userId),
      isNull(integrationOAuthStates.consumedAt), gt(integrationOAuthStates.expiresAt, now),
    )).limit(1);
    if (!stored) throw new ApiError(400, "LIGHTSPEED_R_STATE_INVALID", "The R-Series authorization attempt expired or was already used. Start again.");
    await getDb().update(integrationOAuthStates).set({ consumedAt: now }).where(eq(integrationOAuthStates.stateHash, stateHash));

    try {
      const token = await exchangeLightspeedRCode(code);
      await saveLightspeedRTokens(context.organizationId, token);
      const account = await fetchLightspeedRAccount(context.organizationId);
      const readiness = lightspeedRReadiness();
      await getDb().insert(integrationConnections).values({
        id: crypto.randomUUID(), organizationId: context.organizationId, provider: LIGHTSPEED_R_PROVIDER,
        status: "pending", externalAccountRef: account.accountId, domainPrefix: null,
        apiVersion: readiness.apiVersion, scopesJson: JSON.stringify(LIGHTSPEED_R_SCOPES),
        dataPromotionStatus: "blocked", connectedAt: null, lastSuccessfulSyncAt: null,
        lastSyncCursor: null, lastErrorCode: null, createdAt: now, updatedAt: now,
      }).onConflictDoUpdate({
        target: [integrationConnections.organizationId, integrationConnections.provider],
        set: { status: "pending", externalAccountRef: account.accountId, apiVersion: readiness.apiVersion,
          scopesJson: JSON.stringify(LIGHTSPEED_R_SCOPES), dataPromotionStatus: "blocked",
          connectedAt: null, lastErrorCode: null, updatedAt: now },
      });
      const shops = await fetchLightspeedRCollection(context.organizationId, account.accountId, "Shop", { maxPages: 10 });
      for (const shop of shops.data) {
        const ref = typeof shop.shopID === "string" || typeof shop.shopID === "number" ? String(shop.shopID) : "";
        if (!ref) continue;
        const name = typeof shop.name === "string" && shop.name.trim() ? shop.name.trim().slice(0, 160) : "R-Series shop";
        await getDb().insert(integrationLocationMappings).values({
          id: crypto.randomUUID(), organizationId: context.organizationId, provider: LIGHTSPEED_R_PROVIDER,
          externalLocationRef: ref, externalName: name, localLocationId: null, status: "unmapped",
          lastSeenAt: now, createdAt: now, updatedAt: now,
        }).onConflictDoUpdate({
          target: [integrationLocationMappings.organizationId, integrationLocationMappings.provider, integrationLocationMappings.externalLocationRef],
          set: { externalName: name, lastSeenAt: now, updatedAt: now },
        });
      }
      await getDb().update(integrationConnections).set({ status: "connected", connectedAt: now, updatedAt: now }).where(and(
        eq(integrationConnections.organizationId, context.organizationId), eq(integrationConnections.provider, LIGHTSPEED_R_PROVIDER),
      ));
      await recordAudit({
        request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
        action: "integration.connected", resourceType: "integration", resourceId: LIGHTSPEED_R_PROVIDER,
        details: { provider: LIGHTSPEED_R_PROVIDER, accountRef: account.accountId, shopsDiscovered: shops.data.length, dataPromotionEnabled: false },
      });
      return Response.redirect(returnUrl(request, "connected"), 303);
    } catch (error) {
      const errorCode = error instanceof ApiError ? error.code : "LIGHTSPEED_R_CONNECTION_FAILED";
      await getDb().delete(integrationSecrets).where(and(eq(integrationSecrets.organizationId, context.organizationId), eq(integrationSecrets.provider, LIGHTSPEED_R_PROVIDER)));
      await getDb().update(integrationConnections).set({ status: "error", dataPromotionStatus: "blocked", connectedAt: null, lastErrorCode: errorCode, updatedAt: new Date() }).where(and(
        eq(integrationConnections.organizationId, context.organizationId), eq(integrationConnections.provider, LIGHTSPEED_R_PROVIDER),
      ));
      await recordAudit({
        request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
        action: "integration.connection_failed", resourceType: "integration", resourceId: LIGHTSPEED_R_PROVIDER,
        details: { provider: LIGHTSPEED_R_PROVIDER, errorCode, dataPromotionEnabled: false },
      });
      return Response.redirect(returnUrl(request, "failed"), 303);
    }
  });
}
