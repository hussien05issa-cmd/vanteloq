import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { managementConsoleAccess, users } from "../db/schema";
import { ApiError, requireAal2, requireIdentity, type TrustedIdentity } from "./api";
import { FOUNDER_BOOTSTRAP_EMAIL } from "./internal-access";

export const MANAGEMENT_COMPANIES = ["lexedge", "vanteloq"] as const;
export type ManagementCompany = (typeof MANAGEMENT_COMPANIES)[number];
export type ManagementConsoleRole = "owner" | "admin" | "viewer";

export type ManagementConsoleContext = {
  identity: TrustedIdentity;
  userId: string;
  role: ManagementConsoleRole;
  scopes: readonly ManagementCompany[];
  accessId: string | null;
};

function parseScopes(value: string): ManagementCompany[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((item): item is ManagementCompany =>
      typeof item === "string" && MANAGEMENT_COMPANIES.includes(item as ManagementCompany),
    ))];
  } catch {
    return [];
  }
}

async function verifiedConsoleUser(identity: TrustedIdentity) {
  const [user] = await getDb().select().from(users).where(and(
    eq(users.email, identity.email),
    eq(users.status, "active"),
  )).limit(1);
  if (!user || !identity.subject || identity.provider !== "supabase") return null;
  if (user.authSubject && (user.authSubject !== identity.subject || user.authProvider !== "supabase")) return null;
  if (!user.authSubject) {
    try {
      await getDb().update(users).set({
        authSubject: identity.subject,
        authProvider: "supabase",
        updatedAt: new Date(),
      }).where(and(eq(users.id, user.id), eq(users.email, identity.email)));
    } catch {
      return null;
    }
  }
  return user;
}

export async function requireManagementConsoleAccess(request: Request): Promise<ManagementConsoleContext> {
  const identity = await requireIdentity(request);
  requireAal2(identity);
  const user = await verifiedConsoleUser(identity);
  if (!user) throw new ApiError(403, "CONSOLE_ACCESS_REQUIRED", "This verified account does not have access to the management console.");

  if (identity.email === FOUNDER_BOOTSTRAP_EMAIL) {
    return {
      identity,
      userId: user.id,
      role: "owner",
      scopes: MANAGEMENT_COMPANIES,
      accessId: null,
    };
  }

  const [grant] = await getDb().select().from(managementConsoleAccess).where(and(
    eq(managementConsoleAccess.email, identity.email),
    eq(managementConsoleAccess.active, true),
  )).limit(1);
  if (!grant) throw new ApiError(403, "CONSOLE_ACCESS_REQUIRED", "The owner has not granted this account access to the management console.");
  if (grant.mfaRequired && identity.assuranceLevel !== "aal2") {
    throw new ApiError(403, "MFA_REQUIRED", "Complete multi-factor authentication to continue.");
  }
  if (grant.userId && grant.userId !== user.id) {
    throw new ApiError(403, "CONSOLE_IDENTITY_MISMATCH", "This access grant belongs to a different verified account.");
  }
  const scopes = parseScopes(grant.scopesJson);
  if (!scopes.length) throw new ApiError(403, "CONSOLE_SCOPE_REQUIRED", "This account does not have an active company scope.");

  await getDb().update(managementConsoleAccess).set({
    userId: user.id,
    lastAccessedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(managementConsoleAccess.id, grant.id));

  return { identity, userId: user.id, role: grant.role, scopes, accessId: grant.id };
}

export function requireManagementWrite(context: ManagementConsoleContext): void {
  if (context.role === "viewer") {
    throw new ApiError(403, "CONSOLE_WRITE_FORBIDDEN", "This console account has view-only access.");
  }
}

export function requireManagementOwner(context: ManagementConsoleContext): void {
  if (context.role !== "owner") {
    throw new ApiError(403, "CONSOLE_OWNER_REQUIRED", "Only the console owner can manage private access.");
  }
}

export function requireManagementScope(context: ManagementConsoleContext, company: ManagementCompany): void {
  if (!context.scopes.includes(company)) {
    throw new ApiError(403, "CONSOLE_SCOPE_FORBIDDEN", "This account is not authorized for the selected company.");
  }
}
