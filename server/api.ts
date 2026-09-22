import { getD1, getRuntimeEnv } from "../db/index.ts";
import { isRecentMfa, latestMfaTime } from "../shared/recent-mfa.ts";
import { trustedTlsEdgeClientIp } from "./transport-security.ts";

const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@]{1,190}$/;
const JSON_CONTENT_TYPE = /^application\/json(?:\s*;|$)/i;

export type TrustedIdentity = {
  email: string;
  displayName: string;
  subject: string | null;
  provider: "supabase" | "sites";
  emailVerified: boolean;
  assuranceLevel: "aal1" | "aal2" | null;
  sessionId: string | null;
  mfaVerifiedAt?: number | null;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function requestId(request: Request): string {
  const edgeId = request.headers.get("cf-ray")?.trim();
  return edgeId && edgeId.length <= 64 ? edgeId : crypto.randomUUID();
}

function verifiedJwtSession(token: string): { assuranceLevel: "aal1" | "aal2" | null; sessionId: string | null; mfaVerifiedAt?: number | null } {
  try {
    const payloadPart = token.split(".")[1];
    if (!payloadPart) return { assuranceLevel: null, sessionId: null };
    const normalized = payloadPart.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(payloadPart.length / 4) * 4, "=");
    const payload = JSON.parse(atob(normalized)) as { aal?: unknown; session_id?: unknown; amr?: unknown };
    const assuranceLevel = payload.aal === "aal1" || payload.aal === "aal2" ? payload.aal : null;
    const sessionId = typeof payload.session_id === "string" && payload.session_id.length <= 200 ? payload.session_id : null;
    return { assuranceLevel, sessionId, mfaVerifiedAt: latestMfaTime(payload.amr) };
  } catch {
    return { assuranceLevel: null, sessionId: null };
  }
}

export async function optionalIdentity(request: Request): Promise<TrustedIdentity | null> {
  const env = getRuntimeEnv();
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const token = /^Bearer\s+([^\s]+)$/i.exec(authorization)?.[1];
  const url = env.SUPABASE_URL?.trim().replace(/\/$/, "");
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY?.trim();

  if (token && url && publishableKey) {
    try {
      const response = await fetch(`${url}/auth/v1/user`, {
        headers: {
          apikey: publishableKey,
          authorization: `Bearer ${token}`,
          accept: "application/json",
        },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return null;
      const user = await response.json() as {
        id?: unknown;
        email?: unknown;
        email_confirmed_at?: unknown;
        confirmed_at?: unknown;
        user_metadata?: Record<string, unknown>;
      };
      const email = typeof user.email === "string" ? user.email.trim().toLowerCase() : "";
      const subject = typeof user.id === "string" ? user.id : "";
      const emailVerified = typeof user.email_confirmed_at === "string" || typeof user.confirmed_at === "string";
      if (!subject || !EMAIL_PATTERN.test(email) || !emailVerified) return null;
      const metadataName = user.user_metadata?.full_name;
      const displayName = typeof metadataName === "string" && metadataName.trim().length <= 120
        ? metadataName.trim()
        : email;
      const session = verifiedJwtSession(token);
      return { email, displayName, subject, provider: "supabase", emailVerified, ...session };
    } catch {
      return null;
    }
  }

  // The public Worker boundary cannot prove legacy Sites identity headers were
  // added by a trusted proxy. Protected identity therefore comes exclusively
  // from the Supabase session verified above.
  return null;
}

export async function requireIdentity(request: Request): Promise<TrustedIdentity> {
  const identity = await optionalIdentity(request);
  if (!identity) throw new ApiError(401, "AUTHENTICATION_REQUIRED", "Sign in to continue.");
  return identity;
}

export function requireAal2(identity: TrustedIdentity): void {
  if (identity.provider !== "supabase" || identity.assuranceLevel !== "aal2") {
    throw new ApiError(403, "MFA_REQUIRED", "Complete multi-factor authentication to continue.");
  }
}

export function requireRecentMfa(identity: TrustedIdentity): void {
  requireAal2(identity);
  if (!isRecentMfa(identity.mfaVerifiedAt)) {
    throw new ApiError(403, "RECENT_MFA_REQUIRED", "Verify a current authenticator code before this permanent action.");
  }
}

export function requireSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) throw new ApiError(403, "ORIGIN_REQUIRED", "The request origin could not be verified.");

  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(request.url).origin;
  } catch {
    throw new ApiError(403, "ORIGIN_INVALID", "The request origin could not be verified.");
  }

  if (origin !== expectedOrigin) throw new ApiError(403, "ORIGIN_MISMATCH", "Cross-site requests are not allowed.");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new ApiError(403, "CROSS_SITE_REQUEST", "Cross-site requests are not allowed.");
  }
}

export async function readRequestBytes(
  request: Request,
  maximumBytes: number,
  code = "REQUEST_TOO_LARGE",
  message = "The request is too large.",
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) throw new Error("Invalid request size limit");
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maximumBytes) throw new ApiError(413, code, message);
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) {
        void reader.cancel().catch(() => undefined);
        throw new ApiError(413, code, message);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function readJsonObject(request: Request, maximumBytes = 32_768): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!JSON_CONTENT_TYPE.test(contentType)) {
    throw new ApiError(415, "UNSUPPORTED_CONTENT_TYPE", "Send the request as application/json.");
  }

  const body = new TextDecoder().decode(await readRequestBytes(request, maximumBytes));

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new ApiError(400, "INVALID_JSON", "The request body is not valid JSON.");
  }

  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new ApiError(400, "INVALID_BODY", "The request body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

export function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store, max-age=0");
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export async function handleApi(
  request: Request,
  handler: (context: { requestId: string }) => Promise<Response>,
): Promise<Response> {
  const id = requestId(request);
  try {
    const response = await handler({ requestId: id });
    // Response.redirect() and some platform responses expose immutable headers.
    // Clone the response metadata before applying Vanteloq's API headers so a
    // valid OAuth redirect cannot be converted into a server error.
    const headers = new Headers(response.headers);
    headers.set("X-Request-Id", id);
    headers.set("Cache-Control", "no-store, max-age=0");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (error) {
    const known = error instanceof ApiError;
    const status = known ? error.status : 500;
    const code = known ? error.code : "INTERNAL_ERROR";
    const message = known ? error.message : "The request could not be completed.";
    // Classify operational failures without recording SQL, credentials or user data.
    const failureText = [error, error instanceof Error ? error.cause : null]
      .map(value => value instanceof Error ? value.message : "").join(" ");
    const failureKind = known ? "application" :
      /too many sql variables/i.test(failureText) ? "database_parameter_limit" :
      /no such table|no such column/i.test(failureText) ? "database_schema" :
      /foreign key|unique constraint|not null constraint/i.test(failureText) ? "database_constraint" :
      /database.*locked|database.*busy|overloaded|too many requests/i.test(failureText) ? "database_busy" :
      /timeout|timed out|deadline|reset/i.test(failureText) ? "upstream_timeout" :
      /D1_|SQLITE_/i.test(failureText) ? "database_error" :
      /fetch failed|network|connection/i.test(failureText) ? "network_error" :
      error instanceof TypeError ? "type_error" : "unexpected";

    console.error(JSON.stringify({
      level: status >= 500 ? "error" : "warn",
      event: "api.request_failed",
      requestId: id,
      path: new URL(request.url).pathname,
      method: request.method,
      status,
      code,
      failureKind,
    }));

    return jsonResponse({ error: { code, message }, requestId: id }, { status, headers: { "X-Request-Id": id } });
  }
}

export function clientSource(request: Request): string {
  return trustedTlsEdgeClientIp(request) ?? (request.headers.get("cf-connecting-ip")?.trim() || "unknown");
}

export async function hashIdentifier(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function enforceRateLimit(
  scope: string,
  actor: string,
  maximum: number,
  windowSeconds: number,
): Promise<void> {
  const actorHash = await hashIdentifier(actor);
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / windowSeconds) * windowSeconds;
  const bucketKey = `${scope}:${actorHash}:${windowStart}`;
  const result = await getD1()
    .prepare(`
      INSERT INTO rate_limit_buckets
        (bucket_key, scope, actor_hash, window_start, request_count, expires_at)
      VALUES (?, ?, ?, ?, 1, ?)
      ON CONFLICT(bucket_key) DO UPDATE SET request_count = request_count + 1
      RETURNING request_count
    `)
    .bind(bucketKey, scope, actorHash, windowStart, windowStart + windowSeconds * 2)
    .first<{ request_count: number }>();

  if (!result || result.request_count > maximum) {
    throw new ApiError(429, "RATE_LIMITED", "Too many requests. Please try again later.");
  }
}
