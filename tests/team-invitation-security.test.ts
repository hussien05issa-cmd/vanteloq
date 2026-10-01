import test from "node:test";
import assert from "node:assert/strict";
import { deletedTeamIdentityRecoveryAllowed, invitationIdentityAllowed, invitationSessionAllowed } from "../server/team-invitation-security.ts";
const now = Date.parse("2026-09-04T12:00:00Z");
const row = { email: "employee@example.com", status: "pending", auth_user_id: "employee-id", accepted_at: null as string | null,
  lifecycle_operation: null as string | null, expires_at: "2026-09-11T12:00:00Z", vanteloq_access: true };

test("accepted console identities recover deleted product accounts only with explicit product approval", () => {
  const approved = { ...row, status: "accepted", accepted_at: "2026-09-23", console_access: true,
    acceptance_notice_version: "private-console-access-v1" };
  const allowed = (change = {}, status = "suspended", action: string | undefined = "team_access.deleted") =>
    deletedTeamIdentityRecoveryAllowed({ ...approved, ...change }, row.email, "employee-id", status, action);
  assert.equal(allowed(), true);
  for (const change of [{ vanteloq_access: false }, { console_access: false }, { accepted_at: null },
    { acceptance_notice_version: null }, { auth_user_id: "other-id" }, { status: "revoked" },
    { lifecycle_operation: "delete" }, { email: "other@example.com" }]) assert.equal(allowed(change), false);
  assert.equal(allowed({}, "active"), false);
  assert.equal(allowed({}, "suspended", "team_access.revoked"), false);
  assert.equal(allowed({}, "suspended", ""), false);
});

test("pending invites require correct identity, access, lifecycle, and expiry", () => {
  assert.equal(invitationIdentityAllowed(row, row.email, "employee-id", now), true);
  for (const change of [{ auth_user_id: "different" }, { vanteloq_access: false }, { lifecycle_operation: "delete" },
    { lifecycle_operation: "revoke" }, { status: "revoked" }, { expires_at: "2026-09-01" }, { expires_at: "invalid" }]) {
    assert.equal(invitationIdentityAllowed({ ...row, ...change }, row.email, "employee-id", now), false);
  }
  assert.equal(invitationIdentityAllowed(row, "other@example.com", "employee-id", now), false);
});
test("accepted console invitations can finish Vanteloq setup after their original expiry", () => {
  const accepted = { ...row, status: "accepted", accepted_at: "2026-08-25", expires_at: "2026-09-01" };
  assert.equal(invitationIdentityAllowed(accepted, row.email, "employee-id", now), true);
  assert.equal(invitationIdentityAllowed({ ...accepted, auth_user_id: null }, row.email, "employee-id", now), false);
  assert.equal(invitationIdentityAllowed({ ...accepted, accepted_at: null }, row.email, "employee-id", now), false);
});
test("all supported email and password sessions require verified MFA and recent authentication", () => {
  const token = (method: string, aal = "aal2", age = 0) => `test.${Buffer.from(JSON.stringify({ aal, amr: [{ method, timestamp: now / 1000 - age }] })).toString("base64url")}.test`;
  for (const method of ["password", "invite", "recovery", "otp"]) {
    assert.equal(invitationSessionAllowed(token(method), now), true);
    assert.equal(invitationSessionAllowed(token(method, "aal1"), now), false);
    assert.equal(invitationSessionAllowed(token(method, "aal2", 100_000), now), false);
  }
  assert.equal(invitationSessionAllowed(token("oauth"), now), false);
  assert.equal(invitationSessionAllowed("invalid", now), false);
});
