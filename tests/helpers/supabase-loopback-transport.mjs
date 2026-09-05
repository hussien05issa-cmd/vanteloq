// Test-only transport. The application sees an HTTPS Supabase origin, while
// the identity fixture listens on a registered local HTTP server.
const upstreamFetch = globalThis.fetch;
const servers = new Map();

globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  const localOrigin = servers.get(url.origin);
  if (!localOrigin) return upstreamFetch(input, init);
  if (url.pathname === "/rest/v1/team_access_invitations") {
    // These connector tests use ordinary customers. Invitation lifecycle and
    // failure cases are covered separately by team-invitation-flow.test.ts.
    return Response.json([]);
  }
  const destination = new URL(url.pathname + url.search, localOrigin);
  return upstreamFetch(new Request(destination, request));
};

export function registerSupabaseTestServer(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid test server port");
  const origin = `https://supabase-${port}.example.invalid`;
  servers.set(origin, `http://127.0.0.1:${port}`);
  return origin;
}
