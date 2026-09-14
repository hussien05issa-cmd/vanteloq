import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { opportunityReviews, opportunityReviewEvents, users, workspaceTasks } from "../db/schema";
import { ApiError } from "./api";
import type { AccessContext } from "./authorization";
import { effectivePermissions } from "./permissions";
import { canReadReview, type OpportunityReview } from "../domain/opportunity-review";

// Leave room for tenant and type parameters within each bounded D1 query.
const idBatches = (ids: string[]) => Array.from({ length: Math.ceil(ids.length / 80) }, (_, index) => ids.slice(index * 80, (index + 1) * 80));

export async function requireReadableReview(context: AccessContext, id: string) {
  const [row] = await getDb().select().from(opportunityReviews).where(and(eq(opportunityReviews.id, id), eq(opportunityReviews.organizationId, context.organizationId))).limit(1);
  const permissions = await effectivePermissions(context);
  if (!row || !permissions.includes("insights.view") || !canReadReview(JSON.parse(row.requiredPermissionsJson), permissions)) throw new ApiError(404, "OPPORTUNITY_NOT_FOUND", "This saved opportunity is not available to your account.");
  return row;
}

export async function filterReadableOpportunityTasks<T extends { sourceRef: string | null }>(context: AccessContext, tasks: T[]) {
  const ids = tasks.flatMap(task => task.sourceRef?.startsWith("opportunity:") ? [task.sourceRef.slice(12)] : []);
  if (!ids.length) return tasks;
  const permissions = await effectivePermissions(context);
  const reviews = (await Promise.all(idBatches([...new Set(ids)]).map(batch => getDb().select({ id: opportunityReviews.id, required: opportunityReviews.requiredPermissionsJson }).from(opportunityReviews).where(and(eq(opportunityReviews.organizationId, context.organizationId), inArray(opportunityReviews.id, batch)))))).flat();
  const allowed = new Set(permissions.includes("insights.view") ? reviews.filter(row => canReadReview(JSON.parse(row.required), permissions)).map(row => row.id) : []);
  return tasks.filter(task => !task.sourceRef?.startsWith("opportunity:") || allowed.has(task.sourceRef.slice(12)));
}

export async function listOpportunityReviews(context: AccessContext, scopeKey: string, reviewId?: string) {
  const permissions = await effectivePermissions(context);
  const rows = (await getDb().select().from(opportunityReviews).where(and(eq(opportunityReviews.organizationId, context.organizationId), eq(opportunityReviews.scopeKey, scopeKey), reviewId ? eq(opportunityReviews.id, reviewId) : undefined)).orderBy(desc(opportunityReviews.updatedAt)).limit(reviewId ? 1 : 100))
    .filter(row => canReadReview(JSON.parse(row.requiredPermissionsJson), permissions));
  if (!rows.length) return [];
  const ids = rows.map(row => row.id);
  const [eventGroups, taskGroups] = await Promise.all([
    Promise.all(idBatches(ids).map(batch => getDb().select({ id: opportunityReviewEvents.id, reviewId: opportunityReviewEvents.reviewId, status: opportunityReviewEvents.status, note: opportunityReviewEvents.note, actor: users.displayName, at: opportunityReviewEvents.createdAt, version: opportunityReviewEvents.version }).from(opportunityReviewEvents)
      .innerJoin(users, eq(users.id, opportunityReviewEvents.actorUserId))
      .where(and(eq(opportunityReviewEvents.organizationId, context.organizationId), inArray(opportunityReviewEvents.reviewId, batch)))
      .orderBy(desc(opportunityReviewEvents.createdAt), desc(opportunityReviewEvents.version)).limit(2000))),
    permissions.includes("operations.tasks") ? Promise.all(idBatches(ids).map(batch => getDb().select().from(workspaceTasks).where(and(eq(workspaceTasks.organizationId, context.organizationId), eq(workspaceTasks.sourceType, "decision"), inArray(workspaceTasks.sourceRef, batch.map(id => `opportunity:${id}`)))))) : Promise.resolve([]),
  ]);
  const events = eventGroups.flat().sort((a, b) => b.at.getTime() - a.at.getTime() || b.version - a.version).slice(0, 2000);
  const tasks = taskGroups.flat();
  return rows.map((row): OpportunityReview => {
    const task = tasks.find(task => task.sourceRef === `opportunity:${row.id}`);
    return { id: row.id, ruleId: row.ruleId, scopeKey: row.scopeKey, scopeLabel: row.scopeLabel,
      period: { from: row.periodStart, to: row.periodEnd }, snapshot: JSON.parse(row.snapshotJson),
      status: row.status, snoozedUntil: row.snoozedUntil?.toISOString() ?? null, version: row.version,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
      events: events.filter(event => event.reviewId === row.id).map(event => ({ id: event.id, status: event.status as OpportunityReview["status"], note: event.note, actor: event.actor, at: event.at.toISOString() })),
      task: task ? { id: task.id, title: task.title, status: task.status, assignee: task.assignee, dueDate: task.dueDate } : null,
    };
  });
}
