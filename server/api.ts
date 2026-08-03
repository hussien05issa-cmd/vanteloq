import { getD1 } from "../db/index.ts";

const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@]{1,190}$/;
const JSON_CONTENT_TYPE = /^application\/json(?:\s*;|$)/i;

export type TrustedIdentity = {
  email: string;
  displayName: string;
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

export function optionalIdentity(request: Request): TrustedIdentity | null {
  const rawEmail = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase();
  if (!rawEmail || rawEmail.length > 254 || !EMAIL_PATTERN.test(rawEmail)) return null;

  let displayName = rawEmail;
  const encodedName = request.headers.get("oai-authenticated-user-full-name");
  if (
    encodedName &&
    request.headers.get("oai-authenticated-user-full-name-encoding") === "percent-encoded-utf-8"
  ) {
    try {
      const decoded = decodeURIComponent(encodedName).trim();
      if (decoded && decoded.length <= 120 && !/[\u0000-\u001f\u007f]/.test(decoded)) displayName = decoded;
    } catch {
      // The trusted email remains the safe display fallback.
    }
  }

  return { email: rawEmail, displayName };
}

export function requireIdentity(request: Request): TrustedIdentity {
  const identity = optionalIdentity(request);
  if (!identity) throw new ApiError(401, "AUTHENTICATION_REQUIRED", "Sign in to continue.");
  return identity;
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

export async function readJsonObject(request: Request, maximumBytes = 32_768): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!JSON_CONTENT_TYPE.test(contentType)) {
    throw new ApiError(415, "UNSUPPORTED_CONTENT_TYPE", "Send the request as application/json.");
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new ApiError(413, "REQUEST_TOO_LARGE", "The request is too large.");
  }

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > maximumBytes) {
    throw new ApiError(413, "REQUEST_TOO_LARGE", "The request is too large.");
  }

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
    response.headers.set("X-Request-Id", id);
    response.headers.set("Cache-Control", "no-store, max-age=0");
    return response;
  } catch (error) {
    const known = error instanceof ApiError;
    const status = known ? error.status : 500;
    const code = known ? error.code : "INTERNAL_ERROR";
    const message = known ? error.message : "The request could not be completed.";

    console.error(JSON.stringify({
      level: status >= 500 ? "error" : "warn",
      event: "api.request_failed",
      requestId: id,
      path: new URL(request.url).pathname,
      method: request.method,
      status,
      code,
    }));

    return jsonResponse({ error: { code, message }, requestId: id }, { status, headers: { "X-Request-Id": id } });
  }
}

export function clientSource(request: Request): string {
  return request.headers.get("cf-connecting-ip")?.trim() || "unknown";
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
