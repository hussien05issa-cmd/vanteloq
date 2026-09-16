import { getRuntimeEnv } from "../../db";
import { ApiError } from "../api";

/** Anchor expiry to the request start, never extend an undocumented lifetime. */
export function metaTokenExpiry(expiresIn: unknown, requestedAtMs: number): Date {
  if (typeof expiresIn !== "number" || !Number.isSafeInteger(expiresIn) || expiresIn <= 0
    || !Number.isSafeInteger(requestedAtMs) || requestedAtMs < 0) {
    throw new ApiError(502, "META_TOKEN_EXPIRY_INVALID", "Meta did not provide a valid access expiry. Reconnect the account.");
  }
  const expiresAtMs = requestedAtMs + expiresIn * 1_000;
  if (!Number.isSafeInteger(expiresAtMs) || !Number.isFinite(new Date(expiresAtMs).getTime())) {
    throw new ApiError(502, "META_TOKEN_EXPIRY_INVALID", "Meta did not provide a valid access expiry. Reconnect the account.");
  }
  return new Date(expiresAtMs);
}

export async function metaAppSecretProof(accessToken: string): Promise<string> {
  const appSecret = getRuntimeEnv().META_MARKETING_APP_SECRET;
  if (!appSecret?.trim()) throw new ApiError(503, "META_CONFIGURATION_REQUIRED", "Meta configuration needs attention before this account can be accessed.");
  if (!accessToken.trim()) throw new ApiError(409, "META_REAUTHORIZATION_REQUIRED", "Reconnect Meta before requesting account data.");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(accessToken));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Used only for Meta. The caller rejects all non-success responses, including 3xx. */
export async function prepareMetaGraphRequest(input: string | URL, init: RequestInit = {}): Promise<{ url: string; init: RequestInit }> {
  const url = new URL(input);
  if (url.origin !== "https://graph.facebook.com" || url.username || url.password || url.hash
    || !/^\/v\d{1,2}\.\d\//.test(url.pathname)) {
    throw new ApiError(502, "META_REQUEST_INVALID", "The Meta request destination is invalid.");
  }
  const headers = new Headers(init.headers);
  const authorization = headers.get("Authorization");
  const headerToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  const queryToken = url.searchParams.get("access_token");
  if ((authorization && !headerToken) || (headerToken && queryToken && headerToken !== queryToken)) {
    throw new ApiError(502, "META_REQUEST_INVALID", "The Meta request authorization is invalid.");
  }
  const accessToken = headerToken || queryToken;
  url.searchParams.delete("access_token");
  url.searchParams.delete("appsecret_proof");
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
    url.searchParams.set("appsecret_proof", await metaAppSecretProof(accessToken));
  } else if (!/^\/v\d{1,2}\.\d\/oauth\/access_token$/.test(url.pathname)) {
    throw new ApiError(409, "META_REAUTHORIZATION_REQUIRED", "Reconnect Meta before requesting account data.");
  }
  // workerd supports manual, not error. Callers must reject 3xx; never follow Location.
  return { url: url.toString(), init: { ...init, headers, redirect: "manual", cache: "no-store" } };
}
