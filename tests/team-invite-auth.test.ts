import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { clearTeamInviteCallback, parseTeamInviteCallback } from "../shared/team-invite-auth.ts";

test("an invitation token opens the explicit acceptance step instead of the public home page", () => {
  assert.deepEqual(
    parseTeamInviteCallback("https://vanteloq.com/?team_invite=1&token_hash=secure-token&type=invite"),
    { tokenHash: "secure-token", type: "invite" },
  );
});

test("non-invitation and malformed links never enter the invitation flow", () => {
  assert.equal(parseTeamInviteCallback("https://vanteloq.com/"), null);
  assert.equal(parseTeamInviteCallback("https://vanteloq.com/?team_invite=1&type=invite"), null);
  assert.deepEqual(
    parseTeamInviteCallback("https://vanteloq.com/?team_invite=1&token_hash=secure-token&type=recovery"),
    { tokenHash: "secure-token", type: "recovery" },
  );
  assert.equal(parseTeamInviteCallback("https://vanteloq.com/?team_invite=1&token_hash=secure-token&type=magiclink"), null);
});

test("a verified invitation removes the one time token from browser history", () => {
  assert.equal(
    clearTeamInviteCallback("https://vanteloq.com/?team_invite=1&token_hash=secure-token&type=invite&utm_source=email#fragment"),
    "/?utm_source=email",
  );
});

test("the invitation email opens a review page without consuming the Supabase confirmation URL", async () => {
  const template = await readFile(new URL("../supabase/templates/invite.html", import.meta.url), "utf8");
  const rendered = template
    .replaceAll("{{ .RedirectTo }}", "https://vanteloq.com/?team_invite=1")
    .replaceAll("{{ .TokenHash }}", "secure-token")
    .replaceAll("{{ .ConfirmationURL }}", "https://project.supabase.co/auth/v1/verify?token=consumable");
  const hrefs = [...rendered.matchAll(/href="([^"]+)"[^>]*>Review secure invitation<\/a>/g)]
    .map((match) => match[1]?.replaceAll("&amp;", "&"));

  assert.ok(hrefs.includes("https://vanteloq.com/?team_invite=1&token_hash=secure-token&type=invite"));
  assert.doesNotMatch(hrefs.join(" "), /supabase\.co\/auth\/v1\/verify/);
});
