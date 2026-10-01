import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import {
  integrationConnections, integrationLocationMappings, integrationOAuthStates, integrationSecrets,
  memberships, organizationLocations, users, workspaces,
} from "../../../../../../db/schema";
import { recordAudit } from "../../../../../../server/audit";
import type { AccessContext } from "../../../../../../server/authorization";
import { ApiError, handleApi } from "../../../../../../server/api";
import { requireFeature } from "../../../../../../server/entitlements/engine";
import {
  DEEL_API_VERSION, DEEL_PROVIDER, DEEL_READ_SCOPES, deelStateHash, exchangeDeelCode,
  fetchDeelLegalEntities, fetchDeelOrganization, saveDeelTokens,
} from "../../../../../../server/integrations/deel";
import { requireOAuthBrowser } from "../../../../../../server/integrations/oauth-browser";
import { requirePermission } from "../../../../../../server/permissions";

function returnToVanteloq(request: Request, status: "connected" | "declined" | "failed") {
  return new Response(null, { status: 303, headers: {
    Location: new URL(`/?integration=deel&connection=${status}`, new URL(request.url).origin).toString(),
    "Set-Cookie": "__Host-vanteloq-oauth-deel=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
  } });
}

async function callbackActor(initiation: typeof integrationOAuthStates.$inferSelect): Promise<AccessContext> {
  const [actor] = await getDb().select({
    userId: users.id, email: users.email, displayName: users.displayName,
    authSubject: users.authSubject, authProvider: users.authProvider,
    role: memberships.role, organizationId: memberships.organizationId, organization: workspaces,
  }).from(users).innerJoin(memberships, and(
    eq(memberships.userId, users.id), eq(memberships.organizationId, initiation.organizationId),
  )).innerJoin(workspaces, eq(workspaces.id, memberships.organizationId)).where(and(
    eq(users.id, initiation.actorUserId), eq(users.status, "active"), eq(memberships.status, "active"),
  )).limit(1);
  if (!actor || (actor.role !== "owner" && actor.role !== "admin")) {
    throw new ApiError(403, "DEEL_INITIATOR_INELIGIBLE", "The account that started this connection can no longer manage integrations.");
  }
  if (!initiation.initiatorAuthSubject || initiation.initiatorAuthSubject !== actor.authSubject
    || initiation.initiatorAuthProvider !== actor.authProvider) {
    throw new ApiError(403, "DEEL_INITIATOR_SESSION_INVALID", "Start a new Deel connection from your signed-in workspace.");
  }
  const context: AccessContext = {
    identity: {
      email: actor.email, displayName: actor.displayName, subject: actor.authSubject,
      provider: actor.authProvider ?? "sites", emailVerified: true,
      assuranceLevel: initiation.initiatorAssuranceLevel === "aal2" ? "aal2" : initiation.initiatorAssuranceLevel === "aal1" ? "aal1" : null,
      sessionId: null,
    },
    userId: actor.userId, organizationId: actor.organizationId, role: actor.role,
    authSubject: actor.authSubject, authProvider: actor.authProvider, organization: actor.organization,
  };
  await requireFeature(context, "bookloq.reconciliation");
  await requirePermission(context, "integrations.manage");
  await requirePermission(context, "payroll.totals");
  return context;
}

export async function GET(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    const url = new URL(request.url);
    const state = url.searchParams.get("state")?.trim() ?? "";
    const code = url.searchParams.get("code")?.trim() ?? "";
    const providerError = url.searchParams.get("error")?.trim() ?? "";
    requireOAuthBrowser(request, DEEL_PROVIDER, state);
    if (!/^[A-Za-z0-9_-]{43}$/.test(state) || (!providerError && (!code || code.length > 4_096))) {
      throw new ApiError(400, "DEEL_CALLBACK_INVALID", "Deel returned an incomplete callback. Start the connection again.");
    }
    const now = new Date();
    const stateHash = await deelStateHash(state);
    const [stored] = await getDb().select().from(integrationOAuthStates).where(and(
      eq(integrationOAuthStates.stateHash, stateHash), eq(integrationOAuthStates.provider, DEEL_PROVIDER),
      isNull(integrationOAuthStates.consumedAt), gt(integrationOAuthStates.expiresAt, now),
    )).limit(1);
    if (!stored) throw new ApiError(400, "DEEL_STATE_INVALID", "The Deel connection attempt expired or was already used.");
    const context = await callbackActor(stored);
    const [consumed] = await getDb().update(integrationOAuthStates).set({ consumedAt: now }).where(and(
      eq(integrationOAuthStates.stateHash, stateHash), eq(integrationOAuthStates.provider, DEEL_PROVIDER),
      isNull(integrationOAuthStates.consumedAt), gt(integrationOAuthStates.expiresAt, now),
    )).returning({ stateHash: integrationOAuthStates.stateHash });
    if (!consumed) throw new ApiError(400, "DEEL_STATE_INVALID", "The Deel connection attempt expired or was already used.");
    const connectionId = stored.connectionId;
    const [pending] = await getDb().select({ id: integrationConnections.id }).from(integrationConnections).where(and(
      eq(integrationConnections.id, connectionId), eq(integrationConnections.organizationId, context.organizationId),
      eq(integrationConnections.provider, DEEL_PROVIDER), eq(integrationConnections.status, "pending"),
    )).limit(1);
    if (!pending) throw new ApiError(409, "DEEL_CONNECTION_MISSING", "The Deel connection attempt is no longer available.");
    if (providerError) {
      await getDb().delete(integrationConnections).where(and(eq(integrationConnections.id, connectionId), eq(integrationConnections.status, "pending")));
      await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
        action: "integration.authorization_declined", resourceType: "integration_connection", resourceId: connectionId,
        details: { provider: DEEL_PROVIDER },
      });
      return returnToVanteloq(request, "declined");
    }

    let connected = false;
    try {
      const token = await exchangeDeelCode(code);
      await saveDeelTokens(context.organizationId, connectionId, token);
      const organization = await fetchDeelOrganization(context.organizationId, connectionId);
      const [assigned] = await getDb().select({ id: integrationConnections.id, organizationId: integrationConnections.organizationId }).from(integrationConnections).where(and(
        eq(integrationConnections.provider, DEEL_PROVIDER), eq(integrationConnections.externalAccountRef, organization.id),
        eq(integrationConnections.status, "connected"),
      )).limit(1);
      if (assigned && assigned.id !== connectionId) throw new ApiError(409, "DEEL_ORGANIZATION_UNAVAILABLE", "This Deel organization is already connected to a Vanteloq workspace.");
      const entities = await fetchDeelLegalEntities(context.organizationId, connectionId);
      const localLocations = await getDb().select({ id: organizationLocations.id }).from(organizationLocations).where(and(
        eq(organizationLocations.organizationId, context.organizationId), eq(organizationLocations.status, "active"),
      ));
      const autoLocationId = localLocations.length === 1 ? localLocations[0].id : null;
      for (const entity of entities) {
        await getDb().insert(integrationLocationMappings).values({
          id: crypto.randomUUID(), organizationId: context.organizationId, provider: DEEL_PROVIDER,
          connectionId, externalLocationRef: entity.id,
          externalName: entity.country ? `${entity.name} (${entity.country})` : entity.name,
          localLocationId: autoLocationId, status: autoLocationId ? "mapped" : "unmapped",
          lastSeenAt: now, createdAt: now, updatedAt: now,
        }).onConflictDoUpdate({
          target: [integrationLocationMappings.organizationId, integrationLocationMappings.provider, integrationLocationMappings.connectionId, integrationLocationMappings.externalLocationRef],
          set: {
            externalName: entity.country ? `${entity.name} (${entity.country})` : entity.name,
            localLocationId: autoLocationId, status: autoLocationId ? "mapped" : "unmapped", lastSeenAt: now, updatedAt: now,
          },
        });
      }
      const [updated] = await getDb().update(integrationConnections).set({
        status: "connected", externalAccountRef: organization.id, externalAccountName: organization.name,
        apiVersion: DEEL_API_VERSION, scopesJson: JSON.stringify(token.scopes), dataPromotionStatus: "staging",
        connectedAt: now, lastErrorCode: null, updatedAt: now,
      }).where(and(
        eq(integrationConnections.id, connectionId), eq(integrationConnections.organizationId, context.organizationId),
        eq(integrationConnections.provider, DEEL_PROVIDER), eq(integrationConnections.status, "pending"),
      )).returning({ id: integrationConnections.id });
      if (!updated) throw new ApiError(409, "DEEL_CONNECTION_MISSING", "The Deel connection attempt changed before it could complete.");
      connected = true;
      await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
        action: "integration.connected", resourceType: "integration_connection", resourceId: connectionId,
        details: { provider: DEEL_PROVIDER, organizationId: organization.id, legalEntityCount: entities.length,
          locationAutoMapped: Boolean(autoLocationId), employeeRecordsStored: false, dataPromotionEnabled: false },
      });
      return returnToVanteloq(request, "connected");
    } catch (error) {
      if (connected) throw error;
      const errorCode = error instanceof ApiError ? error.code : "DEEL_CONNECTION_FAILED";
      await getDb().delete(integrationSecrets).where(and(eq(integrationSecrets.organizationId, context.organizationId), eq(integrationSecrets.provider, DEEL_PROVIDER), eq(integrationSecrets.connectionId, connectionId)));
      await getDb().delete(integrationLocationMappings).where(and(eq(integrationLocationMappings.organizationId, context.organizationId), eq(integrationLocationMappings.provider, DEEL_PROVIDER), eq(integrationLocationMappings.connectionId, connectionId)));
      await getDb().update(integrationConnections).set({ status: "error", dataPromotionStatus: "blocked", connectedAt: null, lastErrorCode: errorCode, updatedAt: new Date() }).where(and(
        eq(integrationConnections.id, connectionId), eq(integrationConnections.organizationId, context.organizationId), eq(integrationConnections.provider, DEEL_PROVIDER),
      ));
      await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
        action: "integration.connection_failed", resourceType: "integration_connection", resourceId: connectionId,
        details: { provider: DEEL_PROVIDER, errorCode },
      });
      return returnToVanteloq(request, "failed");
    }
  });
}
