import { and, eq } from "drizzle-orm";
import { getDb, getRuntimeEnv } from "../../db";
import { integrationSecrets } from "../../db/schema";
import { ApiError } from "../api";

export const SQUARE_PROVIDER = "square";
export const SQUARE_API_VERSION = "2026-07-15";
export const SQUARE_READ_SCOPES = [
  "MERCHANT_PROFILE_READ",
  "ORDERS_READ",
  "PAYMENTS_READ",
  "CUSTOMERS_READ",
  "ITEMS_READ",
  "INVENTORY_READ",
] as const;

type SquareEnvironment = "sandbox" | "production";
type SquareConfig = {
  applicationId: string;
  applicationSecret: string;
  redirectUri: string;
  encryptionKey: string;
  environment: SquareEnvironment;
  authOrigin: string;
  apiOrigin: string;
  webhookSignatureKey: string | null;
  webhookUrl: string | null;
};

export type SquareToken = {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  merchantId: string;
};

export function buildSquareCustomerSearchBody(cursor?: string) {
  return {
    limit: 100,
    cursor: cursor || undefined,
    query: { sort: { field: "CREATED_AT", order: "ASC" } },
  } as const;
}

function environmentFrom(value?: string): SquareEnvironment {
  return value?.trim().toLowerCase() === "production" ? "production" : "sandbox";
}

function origins(environment: SquareEnvironment) {
  return environment === "production"
    ? { authOrigin: "https://connect.squareup.com", apiOrigin: "https://connect.squareup.com" }
    : { authOrigin: "https://connect.squareupsandbox.com", apiOrigin: "https://connect.squareupsandbox.com" };
}

export function squareReadiness() {
  const env = getRuntimeEnv();
  const environment = environmentFrom(env.SQUARE_ENV);
  const missingConfiguration = [
    ["SQUARE_APPLICATION_ID", env.SQUARE_APPLICATION_ID],
    ["SQUARE_APPLICATION_SECRET", env.SQUARE_APPLICATION_SECRET],
    ["SQUARE_REDIRECT_URI", env.SQUARE_REDIRECT_URI],
    ["INTEGRATION_ENCRYPTION_KEY", env.INTEGRATION_ENCRYPTION_KEY],
  ].filter(([, value]) => !value?.trim()).map(([name]) => name);
  return {
    adapterBuilt: true,
    credentialsConfigured: missingConfiguration.length === 0,
    missingConfiguration,
    environment,
    permissions: [...SQUARE_READ_SCOPES],
    mode: "read_only_staged_sync" as const,
    webhookConfigured: Boolean(env.SQUARE_WEBHOOK_SIGNATURE_KEY?.trim() && env.SQUARE_WEBHOOK_URL?.trim()),
    dataPromotionEnabled: false,
  };
}

function config(): SquareConfig {
  const env = getRuntimeEnv();
  const readiness = squareReadiness();
  if (!readiness.credentialsConfigured) {
    throw new ApiError(503, "SQUARE_CONFIGURATION_REQUIRED", "Square developer credentials must be configured before authorization can begin.");
  }
  const redirectUri = env.SQUARE_REDIRECT_URI!.trim();
  let parsed: URL;
  try { parsed = new URL(redirectUri); } catch { throw new ApiError(503, "SQUARE_REDIRECT_INVALID", "The configured Square callback URL is invalid."); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) {
    throw new ApiError(503, "SQUARE_REDIRECT_INVALID", "The Square callback must be a clean HTTPS URL.");
  }
  const environment = readiness.environment;
  return {
    applicationId: env.SQUARE_APPLICATION_ID!.trim(),
    applicationSecret: env.SQUARE_APPLICATION_SECRET!,
    redirectUri,
    encryptionKey: env.INTEGRATION_ENCRYPTION_KEY!,
    environment,
    ...origins(environment),
    webhookSignatureKey: env.SQUARE_WEBHOOK_SIGNATURE_KEY?.trim() || null,
    webhookUrl: env.SQUARE_WEBHOOK_URL?.trim() || null,
  };
}

export function newSquareState() {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function squareSha256(value: string | Uint8Array) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function buildSquareAuthorizationUrl(state: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(state)) throw new ApiError(400, "SQUARE_STATE_INVALID", "The Square authorization state is invalid.");
  const current = config();
  const url = new URL("/oauth2/authorize", current.authOrigin);
  url.searchParams.set("client_id", current.applicationId);
  url.searchParams.set("redirect_uri", current.redirectUri);
  url.searchParams.set("scope", SQUARE_READ_SCOPES.join(" "));
  url.searchParams.set("session", "false");
  url.searchParams.set("state", state);
  return url.toString();
}

function parseExpiresAt(value: unknown) {
  const date = typeof value === "string" ? new Date(value) : new Date(Date.now() + 25 * 24 * 60 * 60_000);
  return Number.isNaN(date.getTime()) ? new Date(Date.now() + 25 * 24 * 60 * 60_000) : date;
}

async function tokenRequest(body: Record<string, string>, fetcher: typeof fetch) {
  const current = config();
  const response = await fetcher(new URL("/oauth2/token", current.apiOrigin), {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "Square-Version": SQUARE_API_VERSION },
    body: JSON.stringify({ client_id: current.applicationId, client_secret: current.applicationSecret, ...body }),
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 429) throw new ApiError(503, "SQUARE_RATE_LIMITED", "Square is rate-limiting authorization. Wait, then retry.");
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new ApiError(502, "SQUARE_TOKEN_EXCHANGE_FAILED", "Square did not accept the authorization request. Start a new connection attempt.");
  const accessToken = textValue(payload.access_token);
  const refreshToken = textValue(payload.refresh_token);
  const merchantId = textValue(payload.merchant_id);
  if (!accessToken || !refreshToken || !merchantId) throw new ApiError(502, "SQUARE_TOKEN_RESPONSE_INVALID", "Square returned an incomplete OAuth token response.");
  return { accessToken, refreshToken, merchantId, expiresAt: parseExpiresAt(payload.expires_at) } satisfies SquareToken;
}

export function exchangeSquareCode(code: string, fetcher: typeof fetch = fetch) {
  if (!code || code.length > 4096) throw new ApiError(400, "SQUARE_CODE_INVALID", "Square returned an invalid authorization code.");
  return tokenRequest({ grant_type: "authorization_code", code, redirect_uri: config().redirectUri }, fetcher);
}

export function refreshSquareToken(refreshToken: string, fetcher: typeof fetch = fetch) {
  if (!refreshToken) throw new ApiError(409, "SQUARE_REFRESH_TOKEN_MISSING", "Reconnect Square before synchronizing data.");
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken }, fetcher);
}

async function cryptoKey(encoded: string) {
  let raw: Uint8Array;
  try { raw = fromBase64(encoded); } catch { throw new ApiError(503, "INTEGRATION_ENCRYPTION_KEY_INVALID", "The integration encryption key is invalid."); }
  if (raw.byteLength !== 32) throw new ApiError(503, "INTEGRATION_ENCRYPTION_KEY_INVALID", "The integration encryption key must decode to 32 bytes.");
  return crypto.subtle.importKey("raw", toArrayBuffer(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptSecret(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode("vanteloq:square:v1") },
    await cryptoKey(config().encryptionKey),
    new TextEncoder().encode(value),
  );
  return `v1.${base64Url(iv)}.${base64Url(new Uint8Array(ciphertext))}`;
}

async function decryptSecret(value: string) {
  const [version, encodedIv, encodedCiphertext] = value.split(".");
  if (version !== "v1" || !encodedIv || !encodedCiphertext) throw new ApiError(500, "INTEGRATION_SECRET_INVALID", "Stored Square credentials could not be read.");
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(encodedIv), additionalData: new TextEncoder().encode("vanteloq:square:v1") },
      await cryptoKey(config().encryptionKey),
      toArrayBuffer(fromBase64(encodedCiphertext)),
    );
    return new TextDecoder().decode(plaintext);
  } catch { throw new ApiError(500, "INTEGRATION_SECRET_DECRYPTION_FAILED", "Stored Square credentials could not be decrypted."); }
}

export async function saveSquareTokens(organizationId: string, connectionId: string, token: SquareToken) {
  const now = new Date();
  const access = await encryptSecret(token.accessToken);
  const refresh = await encryptSecret(token.refreshToken);
  await getDb().insert(integrationSecrets).values({
    id: crypto.randomUUID(), organizationId, provider: SQUARE_PROVIDER, connectionId,
    accessTokenCiphertext: access, refreshTokenCiphertext: refresh,
    tokenExpiresAt: token.expiresAt, createdAt: now, updatedAt: now,
  }).onConflictDoUpdate({
    target: integrationSecrets.connectionId,
    set: { accessTokenCiphertext: access, refreshTokenCiphertext: refresh, tokenExpiresAt: token.expiresAt, updatedAt: now },
  });
}

async function accessToken(organizationId: string, connectionId: string, fetcher: typeof fetch) {
  const [row] = await getDb().select({ access: integrationSecrets.accessTokenCiphertext, refresh: integrationSecrets.refreshTokenCiphertext, expires: integrationSecrets.tokenExpiresAt })
    .from(integrationSecrets).where(and(eq(integrationSecrets.organizationId, organizationId), eq(integrationSecrets.provider, SQUARE_PROVIDER), eq(integrationSecrets.connectionId, connectionId))).limit(1);
  if (!row) throw new ApiError(409, "SQUARE_NOT_CONNECTED", "Authorize a Square seller before accessing its data.");
  if (row.expires.getTime() > Date.now() + 5 * 60_000) return decryptSecret(row.access);
  const token = await refreshSquareToken(await decryptSecret(row.refresh), fetcher);
  await saveSquareTokens(organizationId, connectionId, token);
  return token.accessToken;
}

export async function squareRequest(
  organizationId: string,
  connectionId: string,
  path: string,
  options: { method?: "GET" | "POST"; body?: unknown } = {},
  fetcher: typeof fetch = fetch,
) {
  const current = config();
  if (!path.startsWith("/v2/") || path.includes("..")) throw new ApiError(400, "SQUARE_RESOURCE_INVALID", "The requested Square resource is invalid.");
  const response = await fetcher(new URL(path, current.apiOrigin), {
    method: options.method ?? "GET",
    headers: { Accept: "application/json", Authorization: `Bearer ${await accessToken(organizationId, connectionId, fetcher)}`, "Content-Type": "application/json", "Square-Version": SQUARE_API_VERSION },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 429) throw new ApiError(503, "SQUARE_RATE_LIMITED", "Square reached its API rate limit. The sync checkpoint is preserved; retry later.");
  if (response.status === 401 || response.status === 403) throw new ApiError(409, "SQUARE_AUTHORIZATION_EXPIRED", "Square authorization is no longer valid. Reconnect the seller.");
  if (!response.ok) throw new ApiError(502, "SQUARE_PROVIDER_ERROR", "Square could not complete the read-only request. No staged data was promoted.");
  return response.json() as Promise<Record<string, unknown>>;
}

export async function fetchSquareMerchant(organizationId: string, connectionId: string) {
  const body = await squareRequest(organizationId, connectionId, "/v2/merchants/me");
  const merchant = record(body.merchant);
  if (!textValue(merchant.id)) throw new ApiError(502, "SQUARE_MERCHANT_INVALID", "Square returned an incomplete seller profile.");
  return merchant;
}

export async function fetchSquareLocations(organizationId: string, connectionId: string) {
  const body = await squareRequest(organizationId, connectionId, "/v2/locations");
  return records(body.locations);
}

export async function revokeSquareToken(organizationId: string, connectionId: string, fetcher: typeof fetch = fetch) {
  const current = config();
  let token: string | null = null;
  try { token = await accessToken(organizationId, connectionId, fetcher); } catch { return false; }
  const response = await fetcher(new URL("/oauth2/revoke", current.apiOrigin), {
    method: "POST",
    headers: { Authorization: `Client ${current.applicationSecret}`, "Content-Type": "application/json", "Square-Version": SQUARE_API_VERSION },
    body: JSON.stringify({ client_id: current.applicationId, access_token: token }),
    signal: AbortSignal.timeout(12_000),
  });
  return response.ok;
}

export async function verifySquareWebhook(rawBody: string, signature: string | null) {
  const env = getRuntimeEnv();
  const webhookSignatureKey = env.SQUARE_WEBHOOK_SIGNATURE_KEY?.trim();
  const webhookUrl = env.SQUARE_WEBHOOK_URL?.trim();
  if (!webhookSignatureKey || !webhookUrl || !signature) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(webhookSignatureKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${webhookUrl}${rawBody}`)));
  return constantTimeEqual(base64(digest), signature);
}

function textValue(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }
export function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
export function records(value: unknown): Record<string, unknown>[] { return Array.isArray(value) ? value.map(record).filter((row) => Object.keys(row).length > 0) : []; }
function base64Url(bytes: Uint8Array) { return base64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, ""); }
function base64(bytes: Uint8Array) { let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }
function fromBase64(value: string) { const normalized = value.replaceAll("-", "+").replaceAll("_", "/"); const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")); return Uint8Array.from(binary, (character) => character.charCodeAt(0)); }
function toArrayBuffer(value: Uint8Array) { return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer; }
function constantTimeEqual(left: string, right: string) { if (left.length !== right.length) return false; let difference = 0; for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index); return difference === 0; }
