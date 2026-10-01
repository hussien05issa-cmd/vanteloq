type Invitation = {
  email: string; status: string; auth_user_id: string | null; accepted_at: string | null;
  lifecycle_operation: string | null; expires_at: string; vanteloq_access: boolean;
};

export function invitationIdentityAllowed(row: Invitation, email: string, subject: string | null, now = Date.now()) {
  if (!subject || row.email !== email || !row.vanteloq_access || row.lifecycle_operation) return false;
  if (row.auth_user_id && row.auth_user_id !== subject) return false;
  if (row.status === "pending") return Number.isFinite(Date.parse(row.expires_at)) && Date.parse(row.expires_at) > now;
  return row.status === "accepted" && row.auth_user_id === subject && Boolean(row.accepted_at);
}

// Console acceptance must not force an employee to discard a working sign-in.
// Recovery still requires a current product grant and a deleted (not merely
// revoked) identity in the inviting owner's workspace.
export function deletedTeamIdentityRecoveryAllowed(
  row: Invitation & { console_access: boolean; acceptance_notice_version: string | null },
  email: string,
  subject: string | null,
  existingStatus: string,
  latestAccessAction: string | undefined,
) {
  if (!invitationIdentityAllowed(row, email, subject) || row.auth_user_id !== subject) return false;
  const recoverableInvitation = row.status === "pending" || (
    row.status === "accepted" && row.console_access
    && row.acceptance_notice_version === "private-console-access-v1"
  );
  return recoverableInvitation && existingStatus === "suspended" && latestAccessAction === "team_access.deleted";
}

export function invitationSessionAllowed(token: string, now = Date.now()) {
  try {
    const part = token.split(".")[1];
    const claims = JSON.parse(atob(part.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(part.length / 4) * 4, "=")));
    return claims.aal === "aal2" && Array.isArray(claims.amr) && claims.amr.some((entry: { method: string; timestamp: number }) => {
      const maxAge = entry.method === "password" ? 43_200 : 3_600;
      const age = now / 1000 - entry.timestamp;
      return ["password", "invite", "recovery", "otp"].includes(entry.method) && Number.isFinite(age) && age >= -60 && age <= maxAge;
    });
  } catch { return false; }
}
