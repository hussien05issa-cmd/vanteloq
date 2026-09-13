import { and, eq } from "drizzle-orm";
import { getD1, getDb, getRuntimeEnv } from "../../db";
import { integrationSyncSchedules, internalAccess, memberships, users, workspaces } from "../../db/schema";
import { ApiError, readRequestBytes } from "../api";
import { recordAudit } from "../audit";
import { internalAccessEnabled } from "../internal-access";
import { resolveInternalEntitlements, resolveSubscriptionEntitlements, subscriptionSnapshot, requireFeatureEntitlement, requireTenantServiceAccess } from "../entitlements/engine";
import { dispatchScheduledSync } from "./sync-dispatch";
import { isScheduledPosProvider, nextSyncAt, shouldPauseSync, syncHasMore, syncRetryDelay } from "./sync-policy";
import { verifySyncSignature } from "./sync-signature";
import type { SyncContext } from "./sync/types";

export const SYNC_AUTHORIZATION_VERSION = "owner-background-sync-v1";
type Schedule = typeof integrationSyncSchedules.$inferSelect;
const seconds = () => Math.floor(Date.now() / 1000);

export async function scheduledSyncContext(schedule: Schedule): Promise<SyncContext> {
  const [actor] = await getDb().select({ user: users, membership: memberships, organization: workspaces })
    .from(users).innerJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.organizationId, schedule.organizationId)))
    .innerJoin(workspaces, eq(workspaces.id, memberships.organizationId))
    .where(eq(users.id, schedule.authorizedByUserId)).limit(1);
  if (!actor || actor.user.status !== "active" || actor.membership.status !== "active"
    || actor.membership.role !== "owner" || actor.user.authProvider !== "supabase"
    || !schedule.authorizedSubject || actor.user.authSubject !== schedule.authorizedSubject
    || schedule.authorizationVersion !== SYNC_AUTHORIZATION_VERSION) {
    throw new ApiError(403, "SYNC_AUTHORIZATION_WITHDRAWN", "The owner's authorization must be renewed.");
  }
  const deleting = await getD1().prepare("SELECT id FROM account_deletion_jobs WHERE stage IN ('confirmed','local_deleted') AND (user_id=? OR (scope='workspace' AND organization_id=?)) LIMIT 1")
    .bind(actor.user.id, schedule.organizationId).first();
  if (deleting) throw new ApiError(409, "DELETION_IN_PROGRESS", "The account is being deleted.");
  const consent = await getD1().prepare("SELECT status FROM integration_consents WHERE organization_id=? AND provider=? ORDER BY accepted_at DESC, created_at DESC LIMIT 1")
    .bind(schedule.organizationId, schedule.provider).first<{status:string}>();
  if (consent?.status !== "accepted") throw new ApiError(403, "INTEGRATION_CONSENT_REQUIRED", "Integration consent must be renewed.");
  const connection = await getD1().prepare("SELECT id FROM integration_connections WHERE id=? AND organization_id=? AND provider=? AND status='connected' AND privacy_data_deleted_at IS NULL")
    .bind(schedule.connectionId, schedule.organizationId, schedule.provider).first();
  if (!connection) throw new ApiError(403, "SYNC_AUTHORIZATION_WITHDRAWN", "The connection is no longer authorized.");

  // The signed scheduler is a service principal. It never fabricates a user session
  // or an MFA claim. Its grant was issued by a verified owner at the HTTP boundary.
  const [internal] = internalAccessEnabled() ? await getDb().select().from(internalAccess).where(and(
    eq(internalAccess.userId, actor.user.id), eq(internalAccess.organizationId, schedule.organizationId),
    eq(internalAccess.active, true), eq(internalAccess.accessLevel, "founder"),
  )).limit(1) : [];
  const entitlements = internal
    ? resolveInternalEntitlements({ accessLevel: internal.accessLevel, mfaRequired: internal.mfaRequired })
    : resolveSubscriptionEntitlements(await subscriptionSnapshot(schedule.organizationId));
  requireTenantServiceAccess(entitlements);
  requireFeatureEntitlement(entitlements, "pos.reporting.core");
  return { userId: actor.user.id, organizationId: schedule.organizationId, organization: actor.organization };
}

async function runDueSchedule(schedule: Schedule, request: Request, requestId: string) {
  const now = seconds();
  const owner = crypto.randomUUID();
  const cycleStart = schedule.cycleStartedAt ? Math.floor(schedule.cycleStartedAt.getTime() / 1000) : now;
  const claimed = await getD1().prepare(`
    UPDATE integration_sync_schedules SET lease_owner=?, lease_expires_at=?, last_started_at=?,
      last_status='running', updated_at=?, cycle_started_at=COALESCE(cycle_started_at,?)
    WHERE connection_id=? AND organization_id=? AND generation=? AND enabled=1 AND next_run_at<=?
      AND (lease_owner IS NULL OR lease_expires_at<=?)
  `).bind(owner, now + 600, now, now, cycleStart, schedule.connectionId, schedule.organizationId, schedule.generation, now, now).run();
  if (Number(claimed.meta.changes ?? 0) !== 1) return "coalesced";
  let status = "completed";
  let code: string | null = null;
  let failures = 0;
  let pause = false;
  let nextRun = now + schedule.intervalSeconds;
  try {
    const context = await scheduledSyncContext(schedule);
    if (!isScheduledPosProvider(schedule.provider)) throw new ApiError(400, "SYNC_AUTHORIZATION_WITHDRAWN", "Unsupported background provider.");
    const response = await dispatchScheduledSync(schedule.provider, schedule.connectionId, request, requestId, context);
    if (!response.ok) throw new ApiError(response.status, "POS_SYNC_FAILED", "Provider synchronization failed.");
    const result = await response.json() as Record<string, unknown>;
    if (result.skipped === true) throw new ApiError(503, "POS_SYNC_SKIPPED", "The provider did not start its sync.");
    if (result.retryRequired === true) throw new ApiError(502, "POS_RECORD_REVIEW_REQUIRED", "Some provider records could not be normalized. The saved cursor is preserved.");
    status = result.coalesced === true ? "waiting" : syncHasMore(result) ? "backfilling" : "completed";
    nextRun = nextSyncAt(seconds(), result, schedule.intervalSeconds);
    // Webhooks are refresh hints. A successful complete pull covers only events
    // received before this pull began, never events that arrived during the pull.
    if (status === "completed") await getD1().prepare(`UPDATE integration_webhook_events SET status='processed', processed_at=?
      WHERE organization_id=? AND provider=? AND connection_id=? AND status='queued' AND received_at<?`)
      .bind(seconds(), schedule.organizationId, schedule.provider, schedule.connectionId, cycleStart).run();
  } catch (error) {
    code = error instanceof ApiError ? error.code : "POS_SYNC_FAILED";
    failures = schedule.consecutiveFailures + 1;
    pause = shouldPauseSync(code);
    status = pause ? "attention" : "retrying";
    nextRun = seconds() + syncRetryDelay(failures);
  }
  const finished = seconds();
  await getD1().prepare(`UPDATE integration_sync_schedules SET last_status=?, last_error_code=?,
    consecutive_failures=?, enabled=CASE WHEN ? THEN 0 ELSE enabled END, next_run_at=?, last_finished_at=?,
    lease_owner=NULL, lease_expires_at=NULL, cycle_started_at=CASE WHEN ?='completed' THEN NULL ELSE cycle_started_at END, updated_at=?
    WHERE connection_id=? AND organization_id=? AND lease_owner=? AND generation=?`)
    .bind(status, code, failures, pause ? 1 : 0, nextRun, finished, status, finished,
      schedule.connectionId, schedule.organizationId, owner, schedule.generation).run();
  await recordAudit({ request, requestId, organizationId: schedule.organizationId, actorUserId: schedule.authorizedByUserId,
    action: "integration.automatic_sync", resourceType: "integration_connection", resourceId: schedule.connectionId,
    outcome: code ? "failure" : "success", details: { provider: schedule.provider, status, errorCode: code, nextRunAt: nextRun } });
  return status;
}

export async function runScheduledSyncTick(request: Request, requestId: string) {
  const body = new TextDecoder().decode(await readRequestBytes(request, 128));
  const nonce = request.headers.get("x-vanteloq-sync-nonce");
  await verifySyncSignature(getRuntimeEnv().POS_SYNC_SECRET, request.headers.get("x-vanteloq-sync-timestamp"), nonce,
    request.headers.get("x-vanteloq-sync-signature"), body);
  if (body !== "{}") throw new ApiError(400, "SYNC_BODY_INVALID", "The scheduler does not accept account selection.");
  const now = seconds();
  const receipt = await getD1().prepare("INSERT OR IGNORE INTO integration_sync_ticks(id,created_at) VALUES (?,?)").bind(nonce, now).run();
  if (Number(receipt.meta.changes ?? 0) !== 1) throw new ApiError(409, "SYNC_REPLAY_REJECTED", "This scheduler tick was already accepted.");
  await getD1().prepare("DELETE FROM integration_sync_ticks WHERE created_at<?").bind(now - 86400).run();
  const due = await getD1().prepare(`SELECT connection_id FROM integration_sync_schedules
    WHERE enabled=1 AND next_run_at<=? AND (lease_owner IS NULL OR lease_expires_at<=?)
    ORDER BY next_run_at, COALESCE(last_started_at,0), connection_id LIMIT 3`).bind(now, now).all<{connection_id:string}>();
  // Bounded concurrency, oldest-due fairness and independent per-connection leases.
  // A failure in one merchant must not cancel another merchant's saved job.
  const jobs = due.results ?? [];
  const statuses = await Promise.allSettled(jobs.map(async ({ connection_id }) => {
    const [schedule] = await getDb().select().from(integrationSyncSchedules).where(eq(integrationSyncSchedules.connectionId, connection_id));
    return schedule ? runDueSchedule(schedule, request, requestId) : "coalesced";
  }));
  const counts: Record<string, number> = {};
  for (const item of statuses) {
    const status = item.status === "fulfilled" ? item.value : "retrying";
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return { accepted: true, processed: jobs.length, counts };
}
