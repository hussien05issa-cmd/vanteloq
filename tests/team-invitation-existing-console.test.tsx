import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import TeamInvitationFlow from "../app/team-invitation-flow";

const invitation = { id: "test", email: "employee@example.invalid", businessName: "Owner workspace", vanteloqRole: "read_only" as const,
  consoleAccess: true, consoleRole: "viewer" as const, consoleScopes: ["lexedge", "vanteloq"], expiresAt: "2026-09-30" };

test("existing console users join Vanteloq without resetting shared credentials", () => {
  const html = renderToStaticMarkup(<TeamInvitationFlow invitation={{ ...invitation, consoleSetupComplete: true }} initialName="Employee" complete={() => {}}/>);
  assert.match(html, /Join your Vanteloq workspace/);
  assert.match(html, /Accept invitation and enter Vanteloq/);
  assert.doesNotMatch(html, /Create a Password|Confirm Password|type="password"/);
  assert.match(html, /Terms of Service/);
});

test("new invitations still require password setup", () => {
  const html = renderToStaticMarkup(<TeamInvitationFlow invitation={invitation} initialName="Employee" complete={() => {}}/>);
  assert.match(html, /Create a Password/);
  assert.match(html, /Confirm Password/);
  assert.match(html, /Accept and continue to the private console/);
});
