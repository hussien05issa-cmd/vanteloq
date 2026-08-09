import { and, eq } from "drizzle-orm";
import { getD1, getDb } from "../db/index.ts";
import { internalAccess } from "../db/schema.ts";
import type { AccessContext } from "./authorization.ts";

export const FOUNDER_BOOTSTRAP_EMAIL = "hussienissa@lexedgeconsulting.com";
export type InternalAccessLevel = "founder";

export type InternalAccessGrant = {
  readonly accessLevel: InternalAccessLevel;
  readonly mfaRequired: boolean;
};

export function isAuthorizedFounderContext(context: AccessContext): boolean {
  return context.role === "owner"
    && context.identity.provider === "supabase"
    && context.identity.emailVerified
    && context.identity.email === FOUNDER_BOOTSTRAP_EMAIL
    && typeof context.identity.subject === "string"
    && context.identity.subject.length > 0
    && context.authProvider === "supabase"
    && context.authSubject === context.identity.subject;
}

export async function bootstrapFounderInternalAccess(context: AccessContext): Promise<void> {
  if (!isAuthorizedFounderContext(context)) return;
  const now = Date.now();
  const accessId = `internal-founder-${context.userId}`;
  const auditId = `audit-internal-founder-granted-${context.userId}`;
  const reason = "Permanent founder access for the verified Vanteloq owner account.";
  const database = getD1();

  // Keep the grant's active/revoked state intact while making MFA mandatory for
  // both new and previously bootstrapped founder grants.
  await database.batch([
    database.prepare(`INSERT INTO internal_access
      (id, user_id, organization_id, access_level, reason, active, mfa_required,
       created_by_user_id, created_at, updated_at)
      VALUES (?, ?, ?, 'founder', ?, 1, 1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        mfa_required = 1,
        updated_at = excluded.updated_at`)
      .bind(accessId, context.userId, context.organizationId, reason, context.userId, now, now),
    database.prepare(`INSERT OR IGNORE INTO audit_events
      (id, organization_id, actor_user_id, action, resource_type, resource_id,
       outcome, request_id, source_hash, details_json, created_at)
      VALUES (?, ?, ?, 'internal_access.granted', 'internal_access', ?, 'success',
       'system-founder-bootstrap', NULL, ?, ?)`)
      .bind(auditId, context.organizationId, context.userId, accessId, JSON.stringify({ accessLevel: "founder", mfaRequired: true, verification: "supabase_aal2", source: "verified_founder_bootstrap" }), now),
  ]);
}

export async function getInternalAccessGrant(context: AccessContext): Promise<InternalAccessGrant | null> {
  if (!isAuthorizedFounderContext(context)) return null;
  const [row] = await getDb().select({
    accessLevel: internalAccess.accessLevel,
    mfaRequired: internalAccess.mfaRequired,
  }).from(internalAccess).where(and(
    eq(internalAccess.userId, context.userId),
    eq(internalAccess.organizationId, context.organizationId),
    eq(internalAccess.active, true),
  )).limit(1);
  return row ?? null;
}
