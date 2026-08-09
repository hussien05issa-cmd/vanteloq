import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import {
  integrationConnections,
  integrationLocationMappings,
  integrationOAuthStates,
  integrationSecrets,
  memberships,
  users,
  workspaces,
} from "../../../../../../db/schema";
import { recordAudit } from "../../../../../../server/audit";
import type { AccessContext } from "../../../../../../server/authorization";
import { ApiError, handleApi } from "../../../../../../server/api";
import {
  encryptIntegrationSecret,
  exchangeAuthorizationCode,
  fetchLightspeedCollection,
  LIGHTSPEED_PROVIDER,
  LIGHTSPEED_SCOPES,
  lightspeedReadiness,
  sha256Hex,
  tokenExpiry,
  validateDomainPrefix,
} from "../../../../../../server/integrations/lightspeed";
import { requirePermission } from "../../../../../../server/permissions";

function returnUrl(request: Request, status: "connected" | "declined" | "failed") {
  const url = new URL(request.url);
  return new URL(`/?integration=lightspeed&connection=${status}`, url.origin).toString();
}

export async function GET(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    const url = new URL(request.url);
    if (url.searchParams.get("error")) {
      return Response.redirect(returnUrl(request, "declined"), 303);
    }
    const code = url.searchParams.get("code")?.trim() ?? "";
    const state = url.searchParams.get("state")?.trim() ?? "";
    const domainPrefix = validateDomainPrefix(url.searchParams.get("domain_prefix") ?? "");
    if (!code || code.length > 512 || !/^[A-Za-z0-9_-]{43}$/.test(state)) {
      throw new ApiError(400, "LIGHTSPEED_CALLBACK_INVALID", "Lightspeed returned an incomplete callback.");
    }
    const stateHash = await sha256Hex(state);
    const now = new Date();
    const [storedState] = await getDb()
      .select()
      .from(integrationOAuthStates)
      .where(
        and(
          eq(integrationOAuthStates.stateHash, stateHash),
          eq(integrationOAuthStates.provider, LIGHTSPEED_PROVIDER),
          isNull(integrationOAuthStates.consumedAt),
          gt(integrationOAuthStates.expiresAt, now),
        ),
      )
      .limit(1);
    if (!storedState) {
      throw new ApiError(400, "LIGHTSPEED_STATE_INVALID", "The Lightspeed authorization attempt expired or was already used. Start again.");
    }

    // OAuth callbacks can return without the application's session cookie in
    // privacy-restricted browsers. The unguessable, one-time state identifies
    // the exact initiating actor and workspace; re-check that actor's current
    // membership and permission before consuming the state or storing tokens.
    const [actor] = await getDb()
      .select({
        userId: users.id,
        email: users.email,
        displayName: users.displayName,
        authSubject: users.authSubject,
        authProvider: users.authProvider,
        role: memberships.role,
        organizationId: memberships.organizationId,
        organization: workspaces,
      })
      .from(users)
      .innerJoin(
        memberships,
        and(
          eq(memberships.userId, users.id),
          eq(memberships.organizationId, storedState.organizationId),
        ),
      )
      .innerJoin(workspaces, eq(workspaces.id, memberships.organizationId))
      .where(and(
        eq(users.id, storedState.actorUserId),
        eq(users.status, "active"),
        eq(memberships.status, "active"),
      ))
      .limit(1);
    if (!actor || (actor.role !== "owner" && actor.role !== "admin")) {
      throw new ApiError(403, "LIGHTSPEED_INITIATOR_INELIGIBLE", "The account that started this connection can no longer manage integrations.");
    }
    const context: AccessContext = {
      identity: {
        email: actor.email,
        displayName: actor.displayName,
        subject: actor.authSubject,
        provider: actor.authProvider ?? "sites",
        emailVerified: true,
        assuranceLevel: null,
        sessionId: null,
      },
      userId: actor.userId,
      organizationId: actor.organizationId,
      role: actor.role,
      authSubject: actor.authSubject,
      authProvider: actor.authProvider,
      organization: actor.organization,
    };
    await requirePermission(context, "integrations.manage");

    const [consumedState] = await getDb()
      .update(integrationOAuthStates)
      .set({ consumedAt: now })
      .where(and(
        eq(integrationOAuthStates.stateHash, stateHash),
        eq(integrationOAuthStates.provider, LIGHTSPEED_PROVIDER),
        isNull(integrationOAuthStates.consumedAt),
        gt(integrationOAuthStates.expiresAt, now),
      ))
      .returning({ stateHash: integrationOAuthStates.stateHash });
    if (!consumedState) {
      throw new ApiError(400, "LIGHTSPEED_STATE_INVALID", "The Lightspeed authorization attempt expired or was already used. Start again.");
    }

    try {
    const token = await exchangeAuthorizationCode(code, domainPrefix);
    const grantedScopes = (token.scope ?? "").split(/\s+/).filter(Boolean);
    const missingScopes = LIGHTSPEED_SCOPES.filter((scope) => !grantedScopes.includes(scope));
    if (missingScopes.length) {
      throw new ApiError(409, "LIGHTSPEED_SCOPES_INCOMPLETE", "Lightspeed did not grant every read-only scope required by the pilot.");
    }
    const connectionId = crypto.randomUUID();
    const secretId = crypto.randomUUID();
    const readiness = lightspeedReadiness();
    await getDb()
      .insert(integrationConnections)
      .values({
        id: connectionId,
        organizationId: context.organizationId,
        provider: LIGHTSPEED_PROVIDER,
        status: "pending",
        externalAccountRef: domainPrefix,
        domainPrefix,
        apiVersion: readiness.apiVersion,
        scopesJson: JSON.stringify(grantedScopes),
        dataPromotionStatus: "blocked",
        connectedAt: null,
        lastSuccessfulSyncAt: null,
        lastSyncCursor: null,
        lastErrorCode: null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [integrationConnections.organizationId, integrationConnections.provider],
        set: {
          status: "pending",
          externalAccountRef: domainPrefix,
          domainPrefix,
          apiVersion: readiness.apiVersion,
          scopesJson: JSON.stringify(grantedScopes),
          dataPromotionStatus: "blocked",
          connectedAt: null,
          lastErrorCode: null,
          updatedAt: now,
        },
      });
    await getDb()
      .insert(integrationSecrets)
      .values({
        id: secretId,
        organizationId: context.organizationId,
        provider: LIGHTSPEED_PROVIDER,
        accessTokenCiphertext: await encryptIntegrationSecret(token.access_token),
        refreshTokenCiphertext: await encryptIntegrationSecret(token.refresh_token),
        tokenExpiresAt: tokenExpiry(token),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [integrationSecrets.organizationId, integrationSecrets.provider],
        set: {
          accessTokenCiphertext: await encryptIntegrationSecret(token.access_token),
          refreshTokenCiphertext: await encryptIntegrationSecret(token.refresh_token),
          tokenExpiresAt: tokenExpiry(token),
          updatedAt: now,
        },
      });

    // A successful token exchange is not enough to display Connected. Verify a
    // real read against the granted outlet scope and stage the location map.
    const outlets = await fetchLightspeedCollection(context.organizationId, "outlets", { maxPages: 10 });
    for (const outlet of outlets.data) {
      const externalLocationRef = typeof outlet.id === "string" ? outlet.id : "";
      if (!externalLocationRef) continue;
      const externalName = typeof outlet.name === "string" && outlet.name.trim()
        ? outlet.name.trim().slice(0, 160)
        : "Lightspeed outlet";
      await getDb().insert(integrationLocationMappings).values({
        id: crypto.randomUUID(),
        organizationId: context.organizationId,
        provider: LIGHTSPEED_PROVIDER,
        externalLocationRef,
        externalName,
        localLocationId: null,
        status: "unmapped",
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: [
          integrationLocationMappings.organizationId,
          integrationLocationMappings.provider,
          integrationLocationMappings.externalLocationRef,
        ],
        set: { externalName, lastSeenAt: now, updatedAt: now },
      });
    }
    await getDb().update(integrationConnections).set({
      status: "connected",
      connectedAt: now,
      lastErrorCode: null,
      updatedAt: now,
    }).where(and(
      eq(integrationConnections.organizationId, context.organizationId),
      eq(integrationConnections.provider, LIGHTSPEED_PROVIDER),
    ));
    await recordAudit({
      request,
      requestId,
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "integration.connected",
      resourceType: "integration",
      resourceId: LIGHTSPEED_PROVIDER,
      details: {
        provider: LIGHTSPEED_PROVIDER,
        mode: "read_only_staging",
        outletsDiscovered: outlets.data.length,
        grantedScopeCount: grantedScopes.length,
        dataPromotionEnabled: false,
      },
    });
    return Response.redirect(returnUrl(request, "connected"), 303);
    } catch (error) {
      const errorCode = error instanceof ApiError ? error.code : "LIGHTSPEED_CONNECTION_FAILED";
      // Do not retain a usable provider token when outlet verification fails.
      // A future attempt must restart the one-time authorization flow.
      await getDb().delete(integrationSecrets).where(and(
        eq(integrationSecrets.organizationId, context.organizationId),
        eq(integrationSecrets.provider, LIGHTSPEED_PROVIDER),
      ));
      await getDb().update(integrationConnections).set({
        status: "error",
        dataPromotionStatus: "blocked",
        connectedAt: null,
        lastErrorCode: errorCode,
        updatedAt: new Date(),
      }).where(and(
        eq(integrationConnections.organizationId, context.organizationId),
        eq(integrationConnections.provider, LIGHTSPEED_PROVIDER),
      ));
      await recordAudit({
        request,
        requestId,
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "integration.connection_failed",
        resourceType: "integration",
        resourceId: LIGHTSPEED_PROVIDER,
        details: { provider: LIGHTSPEED_PROVIDER, errorCode, dataPromotionEnabled: false },
      });
      return Response.redirect(returnUrl(request, "failed"), 303);
    }
  });
}
