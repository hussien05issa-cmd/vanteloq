import { getD1 } from "../db/index.ts";
import { ApiError, type TrustedIdentity } from "./api.ts";
import { findAccessContext } from "./authorization.ts";
import { FOUNDER_BOOTSTRAP_EMAIL } from "./internal-access.ts";

const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@]{1,190}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type TeamAccessOperation = "revoke" | "delete";

export async function manageTeamAccess(
  identity: TrustedIdentity,
  input: { email: string; authUserId: string | null; operation: TeamAccessOperation },
  requestId: string,
) {
  const context = await findAccessContext(identity);
  if (!context || context.role !== "owner" || identity.email !== FOUNDER_BOOTSTRAP_EMAIL || identity.subject !== context.authSubject) {
    throw new ApiError(403, "OWNER_REQUIRED", "Only the verified Vanteloq owner can manage internal employee access.");
  }

  const email = input.email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email) || email === FOUNDER_BOOTSTRAP_EMAIL) {
    throw new ApiError(400, "TEAM_MEMBER_INVALID", "Choose a valid employee account that is not the owner.");
  }
  if (input.authUserId !== null && !UUID_PATTERN.test(input.authUserId)) {
    throw new ApiError(400, "AUTH_USER_INVALID", "The employee identity could not be matched safely.");
  }
  if (input.operation !== "revoke" && input.operation !== "delete") {
    throw new ApiError(400, "OPERATION_INVALID", "Choose a supported employee access operation.");
  }

  const database = getD1();
  const employee = await database.prepare(`
    SELECT u.id AS user_id, u.auth_subject, m.organization_id
    FROM users u
    LEFT JOIN memberships m ON m.user_id = u.id
    WHERE u.email = ?
    LIMIT 1
  `).bind(email).first<{ user_id: string; auth_subject: string | null; organization_id: string | null }>();

  if (!employee) return { synchronized: true, affected: false };
  if (employee.organization_id && employee.organization_id !== context.organizationId) {
    throw new ApiError(409, "WORKSPACE_MISMATCH", "This employee account belongs to a different Vanteloq workspace.");
  }
  if (input.authUserId && employee.auth_subject && employee.auth_subject !== input.authUserId) {
    throw new ApiError(409, "IDENTITY_MISMATCH", "The employee identity no longer matches this access grant.");
  }

  const now = Date.now();
  const teamStatus = input.operation === "delete" ? "archived" : "suspended";
  const auditId = `audit-team-access-${crypto.randomUUID()}`;
  const sourceHash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`team-access:${requestId}:${identity.subject ?? "unknown"}`),
  );
  const sourceHashHex = Array.from(new Uint8Array(sourceHash), (byte) => byte.toString(16).padStart(2, "0")).join("");

  await database.batch([
    database.prepare("UPDATE internal_access SET active = 0, updated_at = ? WHERE user_id = ?")
      .bind(now, employee.user_id),
    database.prepare("UPDATE memberships SET status = 'suspended', updated_at = ? WHERE user_id = ?")
      .bind(now, employee.user_id),
    database.prepare("UPDATE team_members SET status = ?, remote_login = 0, updated_at = ? WHERE user_id = ? OR email = ?")
      .bind(teamStatus, now, employee.user_id, email),
    database.prepare("UPDATE users SET status = 'suspended', updated_at = ? WHERE id = ?")
      .bind(now, employee.user_id),
    database.prepare(`
      INSERT INTO audit_events (
        id, organization_id, actor_user_id, action, resource_type, resource_id,
        outcome, request_id, source_hash, details_json, created_at
      ) VALUES (?, ?, ?, ?, 'team_member', ?, 'success', ?, ?, ?, ?)
    `).bind(
      auditId,
      context.organizationId,
      context.userId,
      input.operation === "delete" ? "team_access.deleted" : "team_access.revoked",
      employee.user_id,
      requestId,
      sourceHashHex,
      JSON.stringify({ email, authUserId: input.authUserId, source: "lexedge_private_console" }),
      now,
    ),
  ]);

  return { synchronized: true, affected: true };
}
