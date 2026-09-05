import { ApiError } from "../api";

function cookieName(provider: string) {
  if (!/^[a-z0-9_-]{1,40}$/.test(provider)) throw new Error("Invalid OAuth provider");
  return `__Host-vanteloq-oauth-${provider}`;
}

export function oauthBrowserCookie(provider: string, state: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(state)) throw new Error("Invalid OAuth state");
  return `${cookieName(provider)}=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
}

export function requireOAuthBrowser(request: Request, provider: string, state: string) {
  const prefix = `${cookieName(provider)}=`;
  const cookies = (request.headers.get("cookie") ?? "").split(";").map((part) => part.trim())
    .filter((part) => part.startsWith(prefix));
  if (!/^[A-Za-z0-9_-]{43}$/.test(state) || cookies.length !== 1 || cookies[0].slice(prefix.length) !== state) {
    throw new ApiError(400, "OAUTH_BROWSER_BINDING_INVALID",
      "Return to the browser that started this connection, or start a new connection there.");
  }
}
