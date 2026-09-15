import { getD1 } from "../db";
import { ApiError, hashIdentifier } from "./api";
import type { AccessContext } from "./authorization";
import { SESSION_IDLE_MS, SESSION_MAX_MS } from "../shared/session-policy";

export async function sessionLeaseId(context: AccessContext): Promise<string> {
  const { identity } = context;
  if (!identity.subject || !identity.sessionId) throw new ApiError(401, "SESSION_EXPIRED", "Please sign in again to start a secure session.");
  return hashIdentifier(`workspace-session:${identity.subject}:${identity.sessionId}:${context.organizationId}`);
}

// One atomic upsert prevents parallel requests from reviving an expired lease.
// Supabase token refresh keeps session_id stable, so it cannot reset this clock.
export async function requireActiveWorkspaceSession(context: AccessContext, now = Date.now(), recordActivity = false) {
  const id = await sessionLeaseId(context);
  const row = await getD1().prepare(`INSERT INTO workspace_sessions
    (id, user_id, organization_id, started_at, last_seen_at, expires_at, revoked)
    VALUES (?, ?, ?, ?, ?, ?, 0)
    ON CONFLICT(id) DO UPDATE SET last_seen_at = CASE WHEN ? = 1
      THEN MAX(workspace_sessions.last_seen_at, excluded.last_seen_at) ELSE workspace_sessions.last_seen_at END
    WHERE workspace_sessions.revoked = 0 AND workspace_sessions.expires_at > ? AND workspace_sessions.last_seen_at > ?
    RETURNING expires_at AS expiresAt, last_seen_at AS lastSeenAt`)
    .bind(id, context.userId, context.organizationId, now, now, now + SESSION_MAX_MS, recordActivity ? 1 : 0, now, now - SESSION_IDLE_MS)
    .first<{ expiresAt: number; lastSeenAt: number }>();
  if (!row) throw new ApiError(401, "SESSION_EXPIRED", "Your session has expired. Sign in again to continue.");
  return row;
}
