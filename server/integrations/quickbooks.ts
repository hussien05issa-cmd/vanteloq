import { and, eq } from "drizzle-orm";
import { getDb, getRuntimeEnv } from "../../db";
import { integrationConnections, integrationSecrets } from "../../db/schema";
import { ApiError } from "../api";

export const QUICKBOOKS_PROVIDER = "quickbooks";
export const QUICKBOOKS_API_VERSION = "QuickBooks Online Accounting API v3";
export const QUICKBOOKS_SCOPES = ["com.intuit.quickbooks.accounting"] as const;
export const QUICKBOOKS_CONSENT_NOTICE_VERSION = "quickbooks-accounting-read-v1";

const AUTHORIZATION_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const REVOCATION_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
const REALM_ID = /^\d{1,32}$/;

type QuickBooksEnvironment = "sandbox" | "production";

type QuickBooksConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  environment: QuickBooksEnvironment;
  encryptionKey: string;
};

export type QuickBooksToken = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date | null;
  scopes: string[];
};

export type QuickBooksCompany = {
  realmId: string;
  name: string;
  country: string | null;
};

export function quickBooksReadiness() {
  const env = getRuntimeEnv();
  const missingConfiguration = [
    ["QUICKBOOKS_CLIENT_ID", env.QUICKBOOKS_CLIENT_ID],
    ["QUICKBOOKS_CLIENT_SECRET", env.QUICKBOOKS_CLIENT_SECRET],
    ["QUICKBOOKS_REDIRECT_URI", env.QUICKBOOKS_REDIRECT_URI],
    ["INTEGRATION_ENCRYPTION_KEY", env.INTEGRATION_ENCRYPTION_KEY],
  ].filter(([, value]) => !value?.trim()).map(([name]) => name);
  const environment = normalizeEnvironment(env.QUICKBOOKS_ENV);
  return {
    adapterBuilt: true,
    credentialsConfigured: missingConfiguration.length === 0,
    missingConfiguration,
    apiVersion: QUICKBOOKS_API_VERSION,
    scopes: [...QUICKBOOKS_SCOPES],
    mode: environment === "production" ? "production_read_only_staging" as const : "sandbox_read_only_staging" as const,
    environment,
    companyVerificationEnabled: true,
    ledgerImportEnabled: false,
    dataPromotionEnabled: false,
  };
}

function normalizeEnvironment(value: string | undefined): QuickBooksEnvironment {
  return value?.trim().toLowerCase() === "production" ? "production" : "sandbox";
}

function config(): QuickBooksConfig {
  const env = getRuntimeEnv();
  const readiness = quickBooksReadiness();
  if (!readiness.credentialsConfigured) {
    throw new ApiError(503, "QUICKBOOKS_CONFIGURATION_REQUIRED", "QuickBooks developer credentials, an approved callback, and encrypted token storage must be configured before authorization can begin.");
  }
  const clientId = env.QUICKBOOKS_CLIENT_ID!.trim();
  if (!/^[A-Za-z0-9_-]{20,160}$/.test(clientId)) {
    throw new ApiError(503, "QUICKBOOKS_CLIENT_ID_INVALID", "The configured QuickBooks client ID is invalid.");
  }
  const clientSecret = env.QUICKBOOKS_CLIENT_SECRET!.trim();
  if (clientSecret.length < 20 || clientSecret.length > 512 || /\s/.test(clientSecret)) {
    throw new ApiError(503, "QUICKBOOKS_CLIENT_SECRET_INVALID", "The configured QuickBooks client secret is invalid.");
  }
  let redirect: URL;
  try {
    redirect = new URL(env.QUICKBOOKS_REDIRECT_URI!.trim());
  } catch {
    throw new ApiError(503, "QUICKBOOKS_REDIRECT_INVALID", "The configured QuickBooks callback URL is invalid.");
  }
  if (redirect.protocol !== "https:" || redirect.username || redirect.password || redirect.hash || redirect.search) {
    throw new ApiError(503, "QUICKBOOKS_REDIRECT_INVALID", "The QuickBooks callback must be a clean HTTPS URL.");
  }
  return {
    clientId,
    clientSecret,
    redirectUri: redirect.toString(),
    environment: readiness.environment,
    encryptionKey: env.INTEGRATION_ENCRYPTION_KEY!.trim(),
  };
}

export function newQuickBooksOAuthState() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return base64Url(bytes);
}

export async function quickBooksStateHash(state: string) {
  const digest = await crypto.subtle.digest("SHA-256", asArrayBuffer(new TextEncoder().encode(state)));
  return base64Url(new Uint8Array(digest));
}

export function buildQuickBooksAuthorizationUrl(state: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(state)) throw new Error("OAuth state must contain sufficient entropy.");
  const current = config();
  const url = new URL(AUTHORIZATION_URL);
  url.searchParams.set("client_id", current.clientId);
  url.searchParams.set("redirect_uri", current.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", QUICKBOOKS_SCOPES.join(" "));
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeQuickBooksAuthorizationCode(code: string, fetcher: typeof fetch = fetch) {
  if (!code || code.length > 2_048) throw new ApiError(400, "QUICKBOOKS_CALLBACK_INVALID", "QuickBooks returned an invalid authorization code.");
  const current = config();
  return requestToken(new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: current.redirectUri,
  }), current, fetcher);
}

async function refreshQuickBooksAuthorization(refreshToken: string, fetcher: typeof fetch) {
  if (!refreshToken || refreshToken.length > 4_096) throw new ApiError(409, "QUICKBOOKS_REFRESH_TOKEN_MISSING", "Reconnect QuickBooks before accessing accounting data.");
  return requestToken(new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  }), config(), fetcher);
}

async function requestToken(body: URLSearchParams, current: QuickBooksConfig, fetcher: typeof fetch): Promise<QuickBooksToken> {
  const response = await fetcher(TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${btoa(`${current.clientId}:${current.clientSecret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Vanteloq-QuickBooks-Connector/1.0",
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (response.status === 429) throw new ApiError(503, "QUICKBOOKS_RATE_LIMITED", "QuickBooks is rate limiting authorization. Wait briefly, then try again.");
  if (!response.ok) throw new ApiError(502, "QUICKBOOKS_TOKEN_EXCHANGE_FAILED", "QuickBooks did not accept the authorization request. Start a new connection attempt.");
  const accessToken = text(payload.access_token);
  const refreshToken = text(payload.refresh_token);
  const expiresIn = positiveInteger(payload.expires_in);
  const refreshExpiresIn = positiveInteger(payload.x_refresh_token_expires_in);
  // Intuit's documented token response omits scope. OAuth 2.0 section 5.1
  // allows omission when the granted scope matches the requested scope. This
  // connector requests accounting only; an explicit different or empty scope
  // still fails, and the callback verifies company access before saving tokens.
  const scopes = payload.scope === undefined
    ? [...QUICKBOOKS_SCOPES]
    : text(payload.scope).split(/\s+/).filter(Boolean);
  if (!accessToken || !refreshToken || !expiresIn || !scopes.includes(QUICKBOOKS_SCOPES[0])) {
    throw new ApiError(502, "QUICKBOOKS_TOKEN_RESPONSE_INVALID", "QuickBooks returned an incomplete accounting authorization response.");
  }
  return {
    accessToken,
    refreshToken,
    accessTokenExpiresAt: new Date(Date.now() + expiresIn * 1_000),
    refreshTokenExpiresAt: refreshExpiresIn ? new Date(Date.now() + refreshExpiresIn * 1_000) : null,
    scopes,
  };
}

export async function verifyQuickBooksCompany(realmId: string, accessToken: string, fetcher: typeof fetch = fetch): Promise<QuickBooksCompany> {
  if (!REALM_ID.test(realmId)) throw new ApiError(400, "QUICKBOOKS_REALM_INVALID", "QuickBooks returned an invalid company identifier.");
  if (!accessToken) throw new ApiError(400, "QUICKBOOKS_ACCESS_TOKEN_INVALID", "QuickBooks authorization is incomplete.");
  const current = config();
  const origin = current.environment === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
  const url = new URL(`/v3/company/${realmId}/companyinfo/${realmId}`, origin);
  const response = await fetcher(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "Vanteloq-QuickBooks-Connector/1.0",
    },
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (response.status === 401 || response.status === 403) throw new ApiError(409, "QUICKBOOKS_AUTHORIZATION_EXPIRED", "QuickBooks authorization is no longer valid. Reconnect the company.");
  if (!response.ok) throw new ApiError(502, "QUICKBOOKS_COMPANY_VERIFICATION_FAILED", "QuickBooks could not verify the selected company. No accounting data was enabled.");
  const companyInfo = object(payload.CompanyInfo);
  // CompanyInfo.Id identifies the object (commonly "1"), not the OAuth realm.
  // Company access is verified by Intuit against the token and realm in this
  // fixed-host request; never compare an entity ID with the realm identifier.
  const name = text(companyInfo.CompanyName) || text(companyInfo.LegalName);
  if (!text(companyInfo.Id) || !name) throw new ApiError(502, "QUICKBOOKS_COMPANY_RESPONSE_INVALID", "QuickBooks returned an incomplete company response.");
  return { realmId, name: name.slice(0, 160), country: text(companyInfo.Country).slice(0, 2).toUpperCase() || null };
}

export async function saveQuickBooksTokens(organizationId: string, connectionId: string, token: QuickBooksToken) {
  const now = new Date();
  const encrypted = {
    accessTokenCiphertext: await encryptQuickBooksSecret(token.accessToken),
    refreshTokenCiphertext: await encryptQuickBooksSecret(token.refreshToken),
    tokenExpiresAt: token.accessTokenExpiresAt,
  };
  await getDb().insert(integrationSecrets).values({
    id: crypto.randomUUID(), organizationId, provider: QUICKBOOKS_PROVIDER, connectionId,
    ...encrypted, createdAt: now, updatedAt: now,
  }).onConflictDoUpdate({
    target: integrationSecrets.connectionId,
    set: { provider: QUICKBOOKS_PROVIDER, ...encrypted, updatedAt: now },
  });
}

export async function quickBooksAccessToken(organizationId: string, connectionId: string, fetcher: typeof fetch = fetch) {
  const [row] = await getDb().select({
    access: integrationSecrets.accessTokenCiphertext,
    refresh: integrationSecrets.refreshTokenCiphertext,
    expiresAt: integrationSecrets.tokenExpiresAt,
  }).from(integrationSecrets).innerJoin(integrationConnections, and(
    eq(integrationConnections.id, integrationSecrets.connectionId),
    eq(integrationConnections.organizationId, integrationSecrets.organizationId),
    eq(integrationConnections.provider, integrationSecrets.provider),
  )).where(and(
    eq(integrationSecrets.organizationId, organizationId),
    eq(integrationSecrets.provider, QUICKBOOKS_PROVIDER),
    eq(integrationSecrets.connectionId, connectionId),
    eq(integrationConnections.status, "connected"),
  )).limit(1);
  if (!row) throw new ApiError(409, "QUICKBOOKS_NOT_CONNECTED", "Authorize a QuickBooks company before accessing accounting data.");
  if (row.expiresAt.getTime() > Date.now() + 5 * 60_000) return decryptQuickBooksSecret(row.access);
  const refreshed = await refreshQuickBooksAuthorization(await decryptQuickBooksSecret(row.refresh), fetcher);
  await saveQuickBooksTokens(organizationId, connectionId, refreshed);
  return refreshed.accessToken;
}

export async function revokeQuickBooksAuthorization(token: string, fetcher: typeof fetch = fetch) {
  if (!token) return false;
  const current = config();
  const response = await fetcher(REVOCATION_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${btoa(`${current.clientId}:${current.clientSecret}`)}`,
      "Content-Type": "application/json",
      "User-Agent": "Vanteloq-QuickBooks-Connector/1.0",
    },
    body: JSON.stringify({ token }),
    signal: AbortSignal.timeout(15_000),
  });
  return response.ok;
}

export async function storedQuickBooksRefreshToken(organizationId: string, connectionId: string) {
  const [secret] = await getDb().select({ refresh: integrationSecrets.refreshTokenCiphertext }).from(integrationSecrets).where(and(
    eq(integrationSecrets.organizationId, organizationId),
    eq(integrationSecrets.provider, QUICKBOOKS_PROVIDER),
    eq(integrationSecrets.connectionId, connectionId),
  )).limit(1);
  return secret ? decryptQuickBooksSecret(secret.refresh) : null;
}

function positiveInteger(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function encryptionKey() {
  const encoded = config().encryptionKey;
  let raw: Uint8Array;
  try {
    raw = fromBase64(encoded);
  } catch {
    throw new ApiError(503, "INTEGRATION_ENCRYPTION_KEY_INVALID", "The integration encryption key is invalid.");
  }
  if (raw.byteLength !== 32) throw new ApiError(503, "INTEGRATION_ENCRYPTION_KEY_INVALID", "The integration encryption key must decode to 32 bytes.");
  return crypto.subtle.importKey("raw", asArrayBuffer(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptQuickBooksSecret(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode("vanteloq:quickbooks:v1") },
    await encryptionKey(),
    new TextEncoder().encode(value),
  );
  return `v1.${base64Url(iv)}.${base64Url(new Uint8Array(ciphertext))}`;
}

async function decryptQuickBooksSecret(value: string) {
  const [version, encodedIv, encodedCiphertext] = value.split(".");
  if (version !== "v1" || !encodedIv || !encodedCiphertext) throw new ApiError(500, "INTEGRATION_SECRET_INVALID", "Stored QuickBooks credentials could not be read.");
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(encodedIv), additionalData: new TextEncoder().encode("vanteloq:quickbooks:v1") },
      await encryptionKey(),
      asArrayBuffer(fromBase64(encodedCiphertext)),
    );
    return new TextDecoder().decode(plaintext);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, "INTEGRATION_SECRET_DECRYPTION_FAILED", "Stored QuickBooks credentials could not be decrypted.");
  }
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
