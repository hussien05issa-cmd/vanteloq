import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { memberships, users, workspaces } from "../db/schema";
import { ApiError, requireAal2, requireIdentity, type TrustedIdentity } from "./api";
import { getTenantEntitlements, requireTenantServiceAccess } from "./entitlements/engine";
import { bootstrapFounderInternalAccess } from "./internal-access";

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

export async function findAccessContext(identity: TrustedIdentity): Promise<AccessContext | null> {
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
): Promise<AccessContext> {
  const identity = await requireIdentity(request);
  const context = await findAccessContext(identity);
  if (!context) throw new ApiError(403, "MEMBERSHIP_REQUIRED", "This account does not have access to a workspace.");
  requireAal2(identity);
  if (!allowedRoles.includes(context.role)) {
    throw new ApiError(403, "INSUFFICIENT_PERMISSION", "You do not have permission to perform this action.");
  }
  return context;
}

export async function requireAccess(
  request: Request,
  allowedRoles: readonly Role[],
): Promise<AccessContext> {
  const context = await requireWorkspaceMembership(request, allowedRoles);
  requireTenantServiceAccess(await getTenantEntitlements(context));
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
  return requireWorkspaceMembership(request, allowedRoles);
}
