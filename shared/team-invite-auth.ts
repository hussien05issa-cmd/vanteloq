export type TeamInviteCallback = {
  tokenHash: string;
  type: "invite" | "recovery" | "magiclink";
};

export function parseTeamInviteCallback(url: string): TeamInviteCallback | null {
  const current = new URL(url);
  if (current.searchParams.get("team_invite") !== "1") return null;
  const tokenHash = current.searchParams.get("token_hash")?.trim() ?? "";
  const type = current.searchParams.get("type");
  if (!tokenHash || (type !== "invite" && type !== "recovery" && type !== "magiclink")) return null;
  return { tokenHash, type };
}

export function clearTeamInviteCallback(url: string): string {
  const current = new URL(url);
  current.searchParams.delete("team_invite");
  current.searchParams.delete("token_hash");
  current.searchParams.delete("type");
  current.hash = "";
  return `${current.pathname}${current.search}`;
}
