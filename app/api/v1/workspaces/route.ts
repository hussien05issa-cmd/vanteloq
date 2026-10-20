import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { getDb } from "../../../../db";
import { memberships, users, workspaces } from "../../../../db/schema";
import { BUSINESS_CONTEXT_HEADER, requestedBusinessContext } from "../../../../domain/business-context";
import { findAccessContext } from "../../../../server/authorization";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, requireAal2, requireIdentity } from "../../../../server/api";
import { liveTeamMembershipAllowed } from "../../../../server/team-invitations";

/** Membership metadata only. Each business still authorizes its own API requests. */
export async function GET(request: Request) {
  return handleApi(request, async () => {
    const identity = await requireIdentity(request);
    requireAal2(identity);
    await enforceRateLimit("workspaces:read", identity.subject!, 30, 60);
    let requested: string | null;
    try { requested = requestedBusinessContext(request); }
    catch (error) { throw new ApiError(400, "WORKSPACE_CONTEXT_INVALID", error instanceof Error ? error.message : "Choose a valid business."); }
    const rows = await getDb().select({
      id: workspaces.id, name: workspaces.businessName, industry: workspaces.industry,
      role: memberships.role, setupComplete: workspaces.setupComplete, userId: users.id,
    }).from(users).innerJoin(memberships, eq(memberships.userId, users.id))
      .innerJoin(workspaces, eq(workspaces.id, memberships.organizationId))
      .where(and(
        or(and(eq(users.authSubject, identity.subject!), eq(users.authProvider, "supabase")),
          and(eq(users.email, identity.email), isNull(users.authSubject),
            sql`NOT EXISTS (SELECT 1 FROM users canonical WHERE canonical.auth_subject=${identity.subject!} AND canonical.auth_provider='supabase')`)),
        eq(users.status, "active"), eq(memberships.status, "active"),
        sql`NOT EXISTS (SELECT 1 FROM account_deletion_jobs deleting WHERE deleting.stage IN ('confirmed','local_deleted')
          AND (deleting.user_id=${users.id} OR (deleting.scope='workspace' AND deleting.organization_id=${workspaces.id})))`,
      )).orderBy(asc(workspaces.businessName), asc(workspaces.id)).limit(101);
    if (rows.length > 100) throw new ApiError(413, "WORKSPACE_LIST_LIMIT", "Your business list exceeds the safe limit. Contact support to review your memberships.");
    const authorized = [];
    for (const row of rows) {
      if (await liveTeamMembershipAllowed(request, identity, row.userId, row.id, row.role)) authorized.push(row);
    }
    if (requested && !authorized.some((row) => row.id === requested)) {
      throw new ApiError(403, "WORKSPACE_NOT_AVAILABLE", "This business is not available to your account. Open an authorized workspace.");
    }
    const currentWorkspaceId = requested ?? (authorized.length === 1 ? authorized[0].id : null);
    if (currentWorkspaceId) {
      const url = new URL(request.url);
      url.searchParams.set("workspace", currentWorkspaceId);
      const headers = new Headers(request.headers);
      headers.set(BUSINESS_CONTEXT_HEADER, currentWorkspaceId);
      const context = await findAccessContext(identity, new Request(url, { headers }));
      if (!context) throw new ApiError(403, "WORKSPACE_NOT_AVAILABLE", "This business is not available to your account. Open an authorized workspace.");
    }
    return jsonResponse({ workspaces: authorized.map((row) => ({
      id: row.id, name: row.name, industry: row.industry, role: row.role, setupComplete: row.setupComplete,
    })), currentWorkspaceId });
  });
}
