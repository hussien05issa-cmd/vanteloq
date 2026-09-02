import { getD1, getRuntimeEnv } from "../db/index.ts";
import {
  ACCOUNT_ACCEPTANCE_NOTICE_VERSION,
  PRIVACY_POLICY_VERSION,
  TERMS_OF_SERVICE_VERSION,
} from "../shared/legal-versions.ts";
import { ApiError, hashIdentifier, type TrustedIdentity } from "./api.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VANTELOQ_ROLES = new Set(["admin", "manager", "read_only"]);
const PRIVATE_CONSOLE_ACTIVATION_URL = "https://wqiwmpqnthshgyxpettl.supabase.co/functions/v1/private-console-activation";

type InvitationRow = {
  id: string;
  email: string;
  invited_by_user_id: string;
  invited_by_email: string;
  vanteloq_access: boolean;
  vanteloq_role: "admin" | "manager" | "read_only";
  console_access: boolean;
  console_role: "admin" | "viewer";
  console_scopes: string[];
  status: "pending" | "accepted";
  expires_at: string;
};

export type PendingTeamInvitation = {
  id: string;
  email: string;
  businessName: string;
  vanteloqRole: "admin" | "manager" | "read_only";
  consoleAccess: boolean;
  consoleRole: "admin" | "viewer";
  consoleScopes: string[];
  expiresAt: string;
};

function supabaseConfiguration(request: Request) {
  const env = getRuntimeEnv();
  const url = env.SUPABASE_URL?.trim().replace(/\/$/, "") ?? "";
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  if (!url.startsWith("https://") || !publishableKey || !authorization.startsWith("Bearer ")) {
    throw new ApiError(503, "INVITATIONS_UNAVAILABLE", "Team invitations are temporarily unavailable.");
  }
  return { url, publishableKey, authorization };
}

async function invitationRow(request: Request, identity: TrustedIdentity): Promise<InvitationRow | null> {
  const config = supabaseConfiguration(request);
  const query = new URLSearchParams({
    select: "id,email,invited_by_user_id,invited_by_email,vanteloq_access,vanteloq_role,console_access,console_role,console_scopes,status,expires_at",
    email: `eq.${identity.email}`,
    vanteloq_access: "eq.true",
    status: "eq.pending",
    limit: "1",
  });
  const response = await fetch(`${config.url}/rest/v1/team_access_invitations?${query}`, {
    headers: {
      apikey: config.publishableKey,
      authorization: config.authorization,
      accept: "application/json",
    },
    signal: AbortSignal.timeout(7_500),
  });
  if (!response.ok) throw new ApiError(503, "INVITATIONS_UNAVAILABLE", "Team invitations could not be checked safely.");
  const rows = await response.json() as InvitationRow[];
  const row = rows[0];
  if (!row) return null;
  if (
    !UUID_PATTERN.test(row.id)
    || !UUID_PATTERN.test(row.invited_by_user_id)
    || row.email !== identity.email
    || row.status !== "pending"
    || row.vanteloq_access !== true
    || !VANTELOQ_ROLES.has(row.vanteloq_role)
    || new Date(row.expires_at).getTime() <= Date.now()
  ) return null;
  return row;
}

async function inviterWorkspace(row: InvitationRow) {
  const owner = await getD1().prepare(`
    SELECT u.id AS owner_user_id, m.organization_id, w.business_name
    FROM users u
    JOIN memberships m ON m.user_id = u.id
    JOIN workspaces w ON w.id = m.organization_id
    JOIN internal_access ia ON ia.user_id = u.id AND ia.organization_id = m.organization_id
    WHERE u.auth_subject = ? AND u.email = ? AND u.status = 'active'
      AND u.auth_provider = 'supabase' AND m.status = 'active' AND m.role = 'owner'
      AND ia.active = 1 AND ia.access_level = 'founder'
    LIMIT 1
  `).bind(row.invited_by_user_id, row.invited_by_email).first<{
    owner_user_id: string;
    organization_id: string;
    business_name: string;
  }>();
  if (!owner) throw new ApiError(409, "INVITATION_INVALID", "The inviting workspace is no longer available.");
  return owner;
}

export async function pendingTeamInvitation(request: Request, identity: TrustedIdentity): Promise<PendingTeamInvitation | null> {
  const row = await invitationRow(request, identity);
  if (!row) return null;
  const owner = await inviterWorkspace(row);
  return {
    id: row.id,
    email: row.email,
    businessName: owner.business_name,
    vanteloqRole: row.vanteloq_role,
    consoleAccess: row.console_access,
    consoleRole: row.console_role,
    consoleScopes: row.console_scopes,
    expiresAt: row.expires_at,
  };
}

function acceptedLegalTerms(body: Record<string, unknown>) {
  if (
    body.legalAccepted !== true
    || body.termsVersion !== TERMS_OF_SERVICE_VERSION
    || body.privacyPolicyVersion !== PRIVACY_POLICY_VERSION
    || body.legalNoticeVersion !== ACCOUNT_ACCEPTANCE_NOTICE_VERSION
  ) {
    throw new ApiError(409, "LEGAL_ACCEPTANCE_REQUIRED", "Review and accept the current Terms of Service and Privacy Policy before joining the workspace.");
  }
}

function teamName(value: unknown, fallback: string) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > 120) return fallback.slice(0, 120);
  return name;
}

export async function acceptTeamInvitation(
  request: Request,
  identity: TrustedIdentity,
  body: Record<string, unknown>,
  requestId: string,
): Promise<{ businessName: string; role: string; consoleActivationUrl: string | null }> {
  acceptedLegalTerms(body);
  if (!identity.subject || identity.provider !== "supabase" || !identity.emailVerified) {
    throw new ApiError(401, "AUTHENTICATION_REQUIRED", "A verified Supabase account is required.");
  }
  const row = await invitationRow(request, identity);
  if (!row) throw new ApiError(404, "INVITATION_NOT_FOUND", "This invitation is missing, expired, or already used.");
  const owner = await inviterWorkspace(row);
  const displayName = teamName(body.displayName, identity.displayName || identity.email.split("@")[0]);
  const existingRows = await getD1().prepare(`
    SELECT id, email, auth_subject, auth_provider, status
    FROM users
    WHERE email = ? OR auth_subject = ?
    LIMIT 2
  `).bind(identity.email, identity.subject).all<{
    id: string;
    email: string;
    auth_subject: string | null;
    auth_provider: string | null;
    status: string;
  }>();
  const candidates = existingRows.results ?? [];
  const emailUser = candidates.find((candidate) => candidate.email === identity.email);
  const subjectUser = candidates.find((candidate) => candidate.auth_subject === identity.subject);
  if (subjectUser && subjectUser.email !== identity.email) throw new ApiError(409, "IDENTITY_CONFLICT", "This identity is already attached to another account.");
  if (emailUser?.auth_subject && emailUser.auth_subject !== identity.subject) throw new ApiError(409, "IDENTITY_CONFLICT", "This email is already attached to another identity.");
  const userHash = (await hashIdentifier(`team-user:${identity.subject}`)).slice(0, 32);
  const invitationHash = (await hashIdentifier(`team-invitation:${row.id}`)).slice(0, 32);
  const userId = emailUser?.id ?? `user-team-${userHash}`;
  const membershipId = `membership-team-${invitationHash}`;
  const memberId = `team-member-${invitationHash}`;
  const internalAccessId = `internal-team-${invitationHash}`;
  const auditId = `audit-team-accepted-${invitationHash}`;
  const legalId = `legal-team-${invitationHash}-${TERMS_OF_SERVICE_VERSION}`;
  const existingMembership = await getD1().prepare("SELECT organization_id FROM memberships WHERE user_id = ? LIMIT 1")
    .bind(userId).first<{ organization_id: string }>();
  if (existingMembership && existingMembership.organization_id !== owner.organization_id) {
    throw new ApiError(409, "MEMBERSHIP_CONFLICT", "This account already belongs to another Vanteloq workspace.");
  }
  const names = displayName.split(/\s+/).filter(Boolean);
  const firstName = names[0] ?? "Team";
  const lastName = names.slice(1).join(" ") || "Member";
  const now = Date.now();
  const sourceHash = await hashIdentifier(`team-acceptance-source:${request.headers.get("cf-connecting-ip") ?? "unknown"}`);
  const userAgentHash = await hashIdentifier(`team-acceptance-agent:${request.headers.get("user-agent") ?? "unknown"}`);
  const database = getD1();
  await database.batch([
    database.prepare(`
      INSERT INTO users (id, email, auth_subject, auth_provider, display_name, status, created_at, updated_at)
      VALUES (?, ?, ?, 'supabase', ?, 'active', ?, ?)
      ON CONFLICT(email) DO UPDATE SET
        auth_subject = excluded.auth_subject,
        auth_provider = 'supabase',
        display_name = excluded.display_name,
        status = 'active',
        updated_at = excluded.updated_at
      WHERE users.auth_subject IS NULL OR users.auth_subject = excluded.auth_subject
    `).bind(userId, identity.email, identity.subject, displayName, now, now),
    database.prepare(`
      INSERT INTO memberships (id, user_id, organization_id, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET role = excluded.role, status = 'active', updated_at = excluded.updated_at
      WHERE memberships.organization_id = excluded.organization_id
    `).bind(membershipId, userId, owner.organization_id, row.vanteloq_role, now, now),
    database.prepare(`
      INSERT INTO team_members (
        id, organization_id, user_id, role_id, first_name, last_name, preferred_name,
        email, mobile, employee_code, job_title, department, employment_type,
        start_date, end_date, manager_member_id, primary_location_id,
        permitted_locations_json, status, remote_login, require_mfa, pin_enabled,
        invitation_sent_at, invitation_expires_at, last_login_at, notes,
        created_by_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, '', ?, '', '', 'employee', NULL, NULL, NULL, NULL,
        '[]', 'active', 1, 1, 0, ?, ?, ?, 'Accepted through the owner controlled team invitation flow.', ?, ?, ?)
      ON CONFLICT(organization_id, email) DO UPDATE SET
        user_id = excluded.user_id,
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        preferred_name = excluded.preferred_name,
        status = 'active',
        remote_login = 1,
        require_mfa = 1,
        last_login_at = excluded.last_login_at,
        updated_at = excluded.updated_at
    `).bind(memberId, owner.organization_id, userId, firstName, lastName, displayName, identity.email, `INT-${invitationHash.slice(0, 8).toUpperCase()}`, now, new Date(row.expires_at).getTime(), now, owner.owner_user_id, now, now),
    database.prepare(`
      INSERT INTO internal_access (
        id, user_id, organization_id, access_level, reason, active, mfa_required,
        created_by_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, 'founder', ?, 1, 1, ?, ?, ?)
      ON CONFLICT(user_id, organization_id, access_level) DO UPDATE SET
        active = 1,
        mfa_required = 1,
        reason = excluded.reason,
        updated_at = excluded.updated_at
    `).bind(
      internalAccessId,
      userId,
      owner.organization_id,
      "Owner-approved internal team access created through a verified invitation.",
      owner.owner_user_id,
      now,
      now,
    ),
    database.prepare(`
      INSERT OR IGNORE INTO legal_acceptances (
        id, organization_id, user_id, terms_version, privacy_policy_version,
        notice_version, acceptance_source, source_hash, user_agent_hash,
        request_id, accepted_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'team_invitation', ?, ?, ?, ?, ?)
    `).bind(legalId, owner.organization_id, userId, TERMS_OF_SERVICE_VERSION, PRIVACY_POLICY_VERSION, ACCOUNT_ACCEPTANCE_NOTICE_VERSION, sourceHash, userAgentHash, requestId, now, now),
    database.prepare(`
      INSERT OR IGNORE INTO audit_events (
        id, organization_id, actor_user_id, action, resource_type, resource_id,
        outcome, request_id, source_hash, details_json, created_at
      ) VALUES (?, ?, ?, 'team_invitation.accepted', 'team_member', ?, 'success', ?, ?, ?, ?)
    `).bind(auditId, owner.organization_id, userId, memberId, requestId, sourceHash, JSON.stringify({ invitationId: row.id, role: row.vanteloq_role, mfaRequired: true, billingAccess: "internal_no_stripe" }), now),
  ]);

  const config = supabaseConfiguration(request);
  const acceptanceQuery = new URLSearchParams({ id: `eq.${row.id}`, status: "eq.pending" });
  const accepted = await fetch(`${config.url}/rest/v1/team_access_invitations?${acceptanceQuery}`, {
    method: "PATCH",
    headers: {
      apikey: config.publishableKey,
      authorization: config.authorization,
      accept: "application/json",
      "content-type": "application/json",
      prefer: "return=representation",
    },
    body: JSON.stringify({ status: "accepted", auth_user_id: identity.subject, accepted_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
    signal: AbortSignal.timeout(7_500),
  });
  const acceptedRows = accepted.ok ? await accepted.json() as Array<{ id?: unknown }> : [];
  if (!accepted.ok || acceptedRows[0]?.id !== row.id) throw new ApiError(503, "INVITATION_FINALIZATION_FAILED", "Your workspace access is safe, but the invitation could not be finalized. Try once more.");
  return {
    businessName: owner.business_name,
    role: row.vanteloq_role,
    consoleActivationUrl: row.console_access
      ? `${PRIVATE_CONSOLE_ACTIVATION_URL}?id=${encodeURIComponent(row.id)}`
      : null,
  };
}
