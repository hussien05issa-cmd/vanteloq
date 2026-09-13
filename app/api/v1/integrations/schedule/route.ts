import { and, eq } from "drizzle-orm";
import { getD1, getDb, getRuntimeEnv } from "../../../../../db";
import { integrationConsents, integrationSyncSchedules } from "../../../../../db/schema";
import { POS_SYNC_CONSENT_VERSION, POS_SYNC_PURPOSES, posSyncDataCategories } from "../../../../../domain/pos-sync-consent";
import { PRIVACY_POLICY_VERSION } from "../../../../../domain/privacy-controls";
import { ApiError, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../../server/api";
import { requireAccess } from "../../../../../server/authorization";
import { recordAudit } from "../../../../../server/audit";
import { requireOrganizationWideLocationAccess } from "../../../../../server/location-access";
import { requireOwnedIntegrationConnection } from "../../../../../server/integrations/connection";
import { isScheduledPosProvider } from "../../../../../server/integrations/sync-policy";
import { SYNC_AUTHORIZATION_VERSION } from "../../../../../server/integrations/sync-scheduler";
import { requirePermission } from "../../../../../server/permissions";

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, ["owner"], "pos.reporting.core");
    await requirePermission(context, "integrations.manage");
    await requireOrganizationWideLocationAccess(context);
    const input = await readJsonObject(request, 2048);
    if (typeof input.provider !== "string" || !isScheduledPosProvider(input.provider) || typeof input.connectionId !== "string"
      || typeof input.enabled !== "boolean") throw new ApiError(400, "SYNC_SETTING_INVALID", "Choose a connection and an automatic sync setting.");
    const connection = await requireOwnedIntegrationConnection(context.organizationId, input.provider, input.connectionId);
    const now = new Date();
    if (input.enabled) {
      if ((getRuntimeEnv().POS_SYNC_SECRET?.length ?? 0) < 32) throw new ApiError(503, "SYNC_SCHEDULER_UNAVAILABLE", "Background synchronization has not been activated.");
      if (input.authorizationVersion !== SYNC_AUTHORIZATION_VERSION || context.identity.provider !== "supabase" || !context.authSubject)
        throw new ApiError(400, "SYNC_AUTHORIZATION_REQUIRED", "Sign in as the owner and authorize automatic syncing.");
      if (connection.status !== "connected" || connection.privacyDataDeletedAt)
        throw new ApiError(409, "INTEGRATION_NOT_CONNECTED", "Reconnect the account before enabling automatic sync.");
      const consent = await getD1().prepare("SELECT status FROM integration_consents WHERE organization_id=? AND provider=? ORDER BY accepted_at DESC, created_at DESC LIMIT 1")
        .bind(context.organizationId, input.provider).first<{status:string}>();
      if (input.consentAccepted === true && input.consentNoticeVersion === POS_SYNC_CONSENT_VERSION) {
        await getDb().insert(integrationConsents).values({ id: crypto.randomUUID(), organizationId: context.organizationId,
          actorUserId: context.userId, provider: input.provider, status: "accepted", noticeVersion: POS_SYNC_CONSENT_VERSION,
          privacyPolicyVersion: PRIVACY_POLICY_VERSION, dataCategoriesJson: JSON.stringify(posSyncDataCategories(input.provider)),
          purposesJson: JSON.stringify(POS_SYNC_PURPOSES), consentSource: "in_app", acceptedAt: now, createdAt: now, updatedAt: now });
      } else if (consent?.status !== "accepted") throw new ApiError(403, "INTEGRATION_CONSENT_REQUIRED", "Review the automatic sync data notice and enable it again to authorize background imports.");
      const [existing] = await getDb().select().from(integrationSyncSchedules).where(eq(integrationSyncSchedules.connectionId, connection.id));
      await getDb().insert(integrationSyncSchedules).values({
        connectionId: connection.id, organizationId: context.organizationId, provider: input.provider, enabled: true,
        authorizedByUserId: context.userId, authorizedSubject: context.authSubject, authorizationVersion: SYNC_AUTHORIZATION_VERSION,
        authorizedAt: now, generation: (existing?.generation ?? 0) + 1, intervalSeconds: 900, nextRunAt: now,
        lastStatus: "queued", lastErrorCode: null, consecutiveFailures: 0, createdAt: now, updatedAt: now,
      }).onConflictDoUpdate({ target: integrationSyncSchedules.connectionId, set: {
        enabled: true, authorizedByUserId: context.userId, authorizedSubject: context.authSubject,
        authorizationVersion: SYNC_AUTHORIZATION_VERSION, authorizedAt: now, generation: (existing?.generation ?? 0) + 1,
        nextRunAt: now, lastStatus: "queued", lastErrorCode: null, consecutiveFailures: 0,
        leaseOwner: null, leaseExpiresAt: null, updatedAt: now,
      } });
    } else {
      // Pause prevents new jobs. An import already running may finish its current page.
      await getD1().prepare("UPDATE integration_sync_schedules SET enabled=0,generation=generation+1,last_status='paused',lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE connection_id=? AND organization_id=?")
        .bind(Math.floor(now.getTime()/1000), connection.id, context.organizationId).run();
    }
    await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
      action: input.enabled ? "integration.automatic_sync_enabled" : "integration.automatic_sync_paused",
      resourceType: "integration_connection", resourceId: connection.id,
      details: { provider: input.provider, authorizationVersion: SYNC_AUTHORIZATION_VERSION, intervalSeconds: 900 } });
    const [schedule] = await getDb().select({ enabled: integrationSyncSchedules.enabled, status: integrationSyncSchedules.lastStatus })
      .from(integrationSyncSchedules).where(and(eq(integrationSyncSchedules.connectionId, connection.id), eq(integrationSyncSchedules.organizationId, context.organizationId)));
    return jsonResponse({ schedule });
  });
}
