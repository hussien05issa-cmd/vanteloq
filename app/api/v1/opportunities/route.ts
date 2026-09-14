import { and, eq } from "drizzle-orm";
import { getD1, getDb } from "../../../../db";
import { opportunityReviews, opportunityReviewEvents } from "../../../../db/schema";
import { requireAccess } from "../../../../server/authorization";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../server/api";
import { effectivePermissions, requirePermission } from "../../../../server/permissions";
import { authorizedLocationScope, requireOrganizationWideLocationAccess } from "../../../../server/location-access";
import { listOpportunityReviews, requireReadableReview } from "../../../../server/opportunity-reviews";
import { evidencePermissions, validateReviewChange } from "../../../../domain/opportunity-review";
import { idempotencyKey } from "../../../../server/validation";
import { loadCommandCentre } from "../command-centre/route";

const readers = ["owner", "admin", "manager", "employee", "read_only"] as const;
const writers = ["owner", "admin", "manager", "employee"] as const;

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, readers, "dashboard.core");
    await requirePermission(context, "insights.view");
    await enforceRateLimit("opportunities:read", context.userId, 120, 60);
    const scope = await authorizedLocationScope(context, new URL(request.url).searchParams.get("location"));
    // Notes and linked tasks use the existing organization-wide operations model.
    // Location-limited accounts retain live, permission-filtered findings only.
    if (!scope.organizationWide) return jsonResponse({ reviews: [], canReview: false, historyAvailable: false });
    return jsonResponse({ reviews: await listOpportunityReviews(context, scope.selectedLocationId ?? "all"), canReview: (await effectivePermissions(context)).includes("insights.create_task"), historyAvailable: true });
  });
}

export async function POST(request: Request) {
  return handleApi(request, async () => {
    requireSameOrigin(request);
    const context = await requireAccess(request, writers, "dashboard.core");
    await requirePermission(context, "insights.view");
    await requirePermission(context, "insights.create_task");
    await requireOrganizationWideLocationAccess(context);
    await enforceRateLimit("opportunities:capture", context.userId, 40, 60);
    const key = idempotencyKey(request);
    const input = await readJsonObject(request);
    if (Object.keys(input).some(key => !["decisionId", "from", "to"].includes(key)) || typeof input.decisionId !== "string" || input.decisionId.length > 120) throw new ApiError(400, "INVALID_OPPORTUNITY", "Choose a current finding.");
    const result = await loadCommandCentre(request);
    const decision = result.operatingSystem.decisions.find(decision => decision.id === input.decisionId);
    const period = result.commandCentre.periodComparisons?.thirtyDays;
    if (!decision || !period || period.periodStart !== input.from || period.periodEnd !== input.to) throw new ApiError(409, "OPPORTUNITY_CHANGED", "The available finding or reporting period changed. Refresh before saving.");
    const scopeKey = result.organization.selectedLocation?.id ?? "all";
    const id = crypto.randomUUID(), now = new Date();
    const captured = evidencePermissions.filter(permission => result.organization.permissions.includes(permission));
    const db = getDb();
    await db.batch([
      db.insert(opportunityReviews).values({ id, organizationId: context.organizationId, scopeKey, scopeLabel: result.organization.scopeLabel,
        ruleId: decision.id, periodStart: period.periodStart, periodEnd: period.periodEnd, snapshotJson: JSON.stringify(decision), requiredPermissionsJson: JSON.stringify(captured),
        status: "reviewed", version: 1, mutationKey: key, createdByUserId: context.userId, createdAt: now, updatedAt: now }).onConflictDoNothing(),
      // The event is inserted only if this capture created the record. Repeated
      // captures of the same scope/rule/period return the existing review below.
      db.insert(opportunityReviewEvents).select(db.select({ id: opportunityReviews.id, reviewId: opportunityReviews.id, organizationId: opportunityReviews.organizationId, version: opportunityReviews.version, status: opportunityReviews.status,
        note: opportunityReviews.scopeLabel, actorUserId: opportunityReviews.createdByUserId, createdAt: opportunityReviews.createdAt }).from(opportunityReviews).where(eq(opportunityReviews.id, id))),
    ]);
    const [saved] = await db.select().from(opportunityReviews).where(and(eq(opportunityReviews.organizationId, context.organizationId), eq(opportunityReviews.scopeKey, scopeKey), eq(opportunityReviews.ruleId, decision.id), eq(opportunityReviews.periodStart, period.periodStart), eq(opportunityReviews.periodEnd, period.periodEnd))).limit(1);
    await requireReadableReview(context, saved.id);
    return jsonResponse({ review: (await listOpportunityReviews(context, scopeKey, saved.id))[0], replayed: saved.id !== id });
  });
}

export async function PATCH(request: Request) {
  return handleApi(request, async () => {
    requireSameOrigin(request);
    const context = await requireAccess(request, writers, "dashboard.core");
    await requirePermission(context, "insights.view");
    await requirePermission(context, "insights.create_task");
    await requireOrganizationWideLocationAccess(context);
    await enforceRateLimit("opportunities:update", context.userId, 60, 60);
    const key = idempotencyKey(request);
    let input;
    try { input = validateReviewChange(await readJsonObject(request)); }
    catch (error) { throw new ApiError(400, "INVALID_REVIEW", error instanceof Error ? error.message : "Check the review fields."); }
    const before = await requireReadableReview(context, input.id);
    // Replays are recognized even after another editor made a later update.
    const [replay] = await getDb().select().from(opportunityReviewEvents).where(and(eq(opportunityReviewEvents.id, key), eq(opportunityReviewEvents.reviewId, input.id), eq(opportunityReviewEvents.organizationId, context.organizationId))).limit(1);
    if (!replay) {
      if (before.version !== input.version) throw new ApiError(409, "REVIEW_CONFLICT", "Another person updated this review. Refresh to see their changes before saving.");
      const now = Math.floor(Date.now() / 1000), d1 = getD1();
      // D1 batch is atomic. The guarded event insert records only the update
      // that actually won the version check, not a stale concurrent request.
      const results = await d1.batch([
        d1.prepare("UPDATE opportunity_reviews SET status=?, snoozed_until=?, version=version+1, mutation_key=?, updated_at=? WHERE id=? AND organization_id=? AND version=?")
          .bind(input.status, input.snoozedUntil ? Math.floor(Date.parse(input.snoozedUntil) / 1000) : null, key, now, input.id, context.organizationId, input.version),
        d1.prepare("INSERT INTO opportunity_review_events (id,review_id,organization_id,version,status,note,actor_user_id,created_at) SELECT ?,id,organization_id,version,status,?,?,? FROM opportunity_reviews WHERE id=? AND organization_id=? AND version=? AND mutation_key=? ON CONFLICT(id) DO NOTHING")
          .bind(key, input.note, context.userId, now, input.id, context.organizationId, input.version + 1, key),
      ]);
      if (!results[0].meta.changes) {
        const completed = await d1.prepare("SELECT id FROM opportunity_review_events WHERE id=? AND review_id=? AND organization_id=?").bind(key, input.id, context.organizationId).first();
        if (!completed) throw new ApiError(409, "REVIEW_CONFLICT", "Another person updated this review. Refresh before saving.");
      }
    }
    return jsonResponse({ review: (await listOpportunityReviews(context, before.scopeKey, input.id))[0], replayed: Boolean(replay) });
  });
}
