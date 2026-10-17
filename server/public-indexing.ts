/** Match only the root authentication entry modes recognized by app/page.tsx. */
export function authEntryRobots(url: URL): "noindex, follow" | null {
  if (url.pathname !== "/") return null;
  const query = url.searchParams;
  const modes = [query.get("start"), query.get("auth")];
  const isAuthEntry = modes.some(mode => mode === "signin" || mode === "signup")
    || query.get("recovery") === "1"
    || query.get("team_invite") === "1";
  // Marketing parameters must not remove the canonical homepage from search.
  return isAuthEntry ? "noindex, follow" : null;
}
