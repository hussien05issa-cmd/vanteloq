import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { getDb } from "../db";
import { memberships, teamMembers, users, workspaceTasks } from "../db/schema";
import { taskInCollaborationScope } from "../domain/collaboration";
import { ApiError } from "./api";
import type { AccessContext } from "./authorization";
import { authorizedLocationScope } from "./location-access";
import { effectivePermissions } from "./permissions";
import { requireReadableReview } from "./opportunity-reviews";

export const collaborationReaders = ["owner", "admin", "manager", "employee", "read_only"] as const;
export const collaborationWriters = ["owner", "admin", "manager", "employee"] as const;

export async function collaborationScope(context: AccessContext, locationId: string | null = null) {
  return authorizedLocationScope(context, locationId);
}
export function taskScopeWhere(scope: Awaited<ReturnType<typeof collaborationScope>>) {
  if (scope.locationIds === null) return undefined;
  const located = scope.locationIds.length ? inArray(workspaceTasks.locationId, scope.locationIds) : sql`0`;
  return scope.organizationWide && !scope.selectedLocationId ? or(isNull(workspaceTasks.locationId), located) : located;
}
export async function requireCollaborationTask(context: AccessContext, id: number) {
  const [task] = await getDb().select().from(workspaceTasks).where(and(eq(workspaceTasks.id, id), eq(workspaceTasks.organizationId, context.organizationId))).limit(1);
  if (!task || !taskInCollaborationScope(task, await collaborationScope(context))) throw new ApiError(404, "TASK_NOT_AVAILABLE", "This task is not available in your current workspace.");
  if (task.sourceRef?.startsWith("opportunity:")) await requireReadableReview(context, task.sourceRef.slice(12));
  return task;
}
export async function requireCollaborationChannel(context: AccessContext, locationId: string | null, taskId: number | null) {
  if (taskId !== null) {
    const task = await requireCollaborationTask(context, taskId);
    if (locationId !== null && locationId !== task.locationId) throw new ApiError(400, "TASK_CHANNEL_MISMATCH", "Use this task’s own discussion channel.");
    return { locationId: task.locationId, taskId: task.id, taskTitle: task.title };
  }
  const scope = await collaborationScope(context, locationId);
  if (locationId === null && !scope.organizationWide) throw new ApiError(403, "CHANNEL_SCOPE_REQUIRED", "Choose one of your location channels.");
  return { locationId, taskId: null, taskTitle: null };
}
export async function collaborationMember(context: AccessContext, userId: string, locationId: string | null, sourceRef: string | null = null) {
  const [member] = await getDb().select({ id: users.id, name: users.displayName, role: memberships.role, authSubject: users.authSubject })
    .from(users).innerJoin(memberships, eq(users.id, memberships.userId))
    .where(and(eq(users.id, userId), eq(users.status, "active"), eq(memberships.organizationId, context.organizationId), eq(memberships.status, "active"))).limit(1);
  if (!member || member.role === "integration" || member.role === "read_only" || !member.authSubject) throw new ApiError(400, "ASSIGNEE_UNAVAILABLE", "Choose an active workspace member with task access.");
  const [profile] = await getDb().select({ status: teamMembers.status, remoteLogin: teamMembers.remoteLogin }).from(teamMembers)
    .where(and(eq(teamMembers.organizationId, context.organizationId), eq(teamMembers.userId, userId))).limit(1);
  if ((profile && (profile.status !== "active" || !profile.remoteLogin)) || (!profile && member.role !== "owner" && member.role !== "admin")) throw new ApiError(400, "ASSIGNEE_UNAVAILABLE", "Choose an active workspace member with task access.");
  const candidate: AccessContext = { ...context, userId, role: member.role };
  if (!(await effectivePermissions(candidate)).includes("operations.tasks") || !taskInCollaborationScope({ locationId }, await collaborationScope(candidate))) throw new ApiError(400, "ASSIGNEE_SCOPE_DENIED", "That team member cannot access this task’s location.");
  if (sourceRef?.startsWith("opportunity:")) await requireReadableReview(candidate, sourceRef.slice(12));
  return { id: member.id, name: member.name || "Team member" };
}
export async function collaborationMembers(context: AccessContext, locationId: string | null, sourceRef: string | null = null) {
  const candidates = await getDb().select({ id: users.id }).from(users).innerJoin(memberships, eq(users.id, memberships.userId))
    .where(and(eq(memberships.organizationId, context.organizationId), eq(memberships.status, "active"), eq(users.status, "active"))).limit(100);
  const members = [];
  for (let start = 0; start < candidates.length; start += 8) {
    const batch = await Promise.all(candidates.slice(start, start + 8).map(async candidate => {
      try { return await collaborationMember(context, candidate.id, locationId, sourceRef); }
      catch (error) { if (!(error instanceof ApiError)) throw error; return null; }
    }));
    members.push(...batch.filter((member): member is {id:string;name:string} => member !== null));
  }
  return members.sort((a, b) => a.name.localeCompare(b.name));
}
export async function collaborationCapabilities(context: AccessContext) {
  const permissions = await effectivePermissions(context);
  return { canManage: context.role !== "read_only" && permissions.includes("operations.manage"), canPost: context.role !== "read_only" && context.role !== "integration", userId: context.userId };
}
