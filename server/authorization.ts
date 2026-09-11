import { and, eq } from "drizzle-orm";
import { getDb, getD1 } from "../db";
import { memberships, users, workspaces } from "../db/schema";
import { ApiError, requireAal2, requireIdentity, type TrustedIdentity } from "./api";
import type { FeatureKey } from "./entitlements/catalog";
import { getTenantEntitlements, requireFeatureEntitlement, requireTenantServiceAccess } from "./entitlements/engine";
import { bootstrapFounderInternalAccess } from "./internal-access";
import { liveTeamMembershipAllowed } from "./team-invitations";

export type Role = "owner" | "admin" | "manager" | "employee" | "read_only" | "integration";

export type AccessContext = {
  identity: TrustedIdentity;
  userId: string;
  organizationId: string;
  role: Role;
  authSubject: string | null;
  authProvider: "supabase" | "sites" | null;
  organization: typeof workspaces.$inferSelect;
};

export async function findAccessContext(identity: TrustedIdentity, request?: Request): Promise<AccessContext | null> {
  const [row] = await getDb()
    .select({
      userId: users.id,
      authSubject: users.authSubject,
      authProvider: users.authProvider,
      userStatus: users.status,
      membershipStatus: memberships.status,
      role: memberships.role,
      organizationId: workspaces.id,
      organization: workspaces,
    })
    .from(users)
    .innerJoin(memberships, eq(memberships.userId, users.id))
    .innerJoin(workspaces, eq(workspaces.id, memberships.organizationId))
    .where(and(eq(users.email, identity.email), eq(users.status, "active"), eq(memberships.status, "active")))
    .limit(1);

  if (!row) return null;
  if (!await liveTeamMembershipAllowed(request, identity, row.userId, row.organizationId, row.role)) return null;
  if (identity.provider === "supabase") {
    if (!identity.subject || !identity.emailVerified) return null;
    if (row.authSubject && (row.authSubject !== identity.subject || row.authProvider !== "supabase")) return null;
    if (!row.authSubject) {
      try {
        await getDb().update(users).set({
          authSubject: identity.subject,
          authProvider: "supabase",
          updatedAt: new Date(),
        }).where(and(eq(users.id, row.userId), eq(users.email, identity.email)));
      } catch {
        return null;
      }
      row.authSubject = identity.subject;
      row.authProvider = "supabase";
    }
  }
  const context: AccessContext = {
    identity,
    userId: row.userId,
    organizationId: row.organizationId,
    role: row.role,
    authSubject: row.authSubject,
    authProvider: row.authProvider,
    organization: row.organization,
  };
  await bootstrapFounderInternalAccess(context);
  return context;
}

async function requireWorkspaceMembership(
  request: Request,
  allowedRoles: readonly Role[],
  allowDeletion = false,
): Promise<AccessContext> {
  const identity = await requireIdentity(request);
  const context = await findAccessContext(identity, request);
  if (!context) throw new ApiError(403, "MEMBERSHIP_REQUIRED", "This account does not have access to a workspace.");
  requireAal2(identity);
  if (!allowedRoles.includes(context.role)) {
    throw new ApiError(403, "INSUFFICIENT_PERMISSION", "You do not have permission to perform this action.");
  }
  if (!allowDeletion) {
    const deleting = await getD1().prepare("SELECT id FROM account_deletion_jobs WHERE stage IN ('confirmed', 'local_deleted') AND (user_id = ? OR (scope = 'workspace' AND organization_id = ?)) LIMIT 1")
      .bind(context.userId, context.organizationId).first();
    if (deleting) throw new ApiError(409, "DELETION_IN_PROGRESS", "This account or workspace is being deleted. Resume the saved deletion session.");
  }
  return context;
}

export async function requireAccess(
  request: Request,
  allowedRoles: readonly Role[],
  requiredFeature: FeatureKey,
): Promise<AccessContext> {
  const context = await requireWorkspaceMembership(request, allowedRoles);
  const entitlements = await getTenantEntitlements(context);
  requireTenantServiceAccess(entitlements);
  requireFeatureEntitlement(entitlements, requiredFeature);
  return context;
}

export async function requireBillingAccess(
  request: Request,
  allowedRoles: readonly Role[],
): Promise<AccessContext> {
  return requireWorkspaceMembership(request, allowedRoles);
}

export async function requirePrivacyAccess(
  request: Request,
  allowedRoles: readonly Role[],
): Promise<AccessContext> {
  return requireWorkspaceMembership(request, allowedRoles, true);
}
