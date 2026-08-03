import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { memberships, users, workspaces } from "../db/schema";
import { ApiError, requireIdentity, type TrustedIdentity } from "./api";

export type Role = "owner" | "admin" | "manager" | "employee" | "read_only" | "integration";

export type AccessContext = {
  identity: TrustedIdentity;
  userId: string;
  organizationId: string;
  role: Role;
  organization: typeof workspaces.$inferSelect;
};

export async function findAccessContext(identity: TrustedIdentity): Promise<AccessContext | null> {
  const [row] = await getDb()
    .select({
      userId: users.id,
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
  return {
    identity,
    userId: row.userId,
    organizationId: row.organizationId,
    role: row.role,
    organization: row.organization,
  };
}

export async function requireAccess(
  request: Request,
  allowedRoles: readonly Role[],
): Promise<AccessContext> {
  const identity = requireIdentity(request);
  const context = await findAccessContext(identity);
  if (!context) throw new ApiError(403, "MEMBERSHIP_REQUIRED", "This account does not have access to a workspace.");
  if (!allowedRoles.includes(context.role)) {
    throw new ApiError(403, "INSUFFICIENT_PERMISSION", "You do not have permission to perform this action.");
  }
  return context;
}

