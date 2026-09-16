import { and, eq } from "drizzle-orm";
import { getD1, getDb, getRuntimeEnv } from "../../db";
import { integrationConnections, integrationSecrets } from "../../db/schema";
import { ApiError } from "../api";
import { acquireIntegrationSyncLease, releaseIntegrationSyncLease, sqliteTimestampSeconds, type IntegrationSyncLease } from "./connection";

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
  if (!environment) missingConfiguration.push("QUICKBOOKS_ENV");
  return {
    adapterBuilt: true,
    credentialsConfigured: missingConfiguration.length === 0,
    missingConfiguration,
    apiVersion: QUICKBOOKS_API_VERSION,
    scopes: [...QUICKBOOKS_SCOPES],
    mode: !environment ? "configuration_required" as const : environment === "production" ? "production_read_only_staging" as const : "sandbox_read_only_staging" as const,
    environment,
    companyVerificationEnabled: true,
    ledgerImportEnabled: false,
    dataPromotionEnabled: false,
  };
}

function normalizeEnvironment(value: string | undefined): QuickBooksEnvironment | null {
  const environment = value?.trim().toLowerCase();
  return environment === "sandbox" || environment === "production" ? environment : null;
}

function config(): QuickBooksConfig {
  const env = getRuntimeEnv();
  const readiness = quickBooksReadiness();
  if (!readiness.environment) throw new ApiError(503, "QUICKBOOKS_ENVIRONMENT_INVALID", "Set the QuickBooks environment explicitly to sandbox or production before connecting.");
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

// A fresh namespace identifies each authorization generation. It contains no
// credentials and does not use domainPrefix, whose uniqueness is cross-tenant.
export async function newQuickBooksGrantNamespace(grantId = crypto.randomUUID()) {
  const current = config();
  return `quickbooks:v1:${current.environment}:${await quickBooksStateHash(current.clientId)}:${grantId}`;
}

async function boundConfig(sourceNamespace: string) {
  const match = /^quickbooks:v1:(sandbox|production):([A-Za-z0-9_-]{43}):([0-9a-f-]{36})$/.exec(sourceNamespace);
  if (!match) throw new ApiError(409, "QUICKBOOKS_GRANT_RECONNECT_REQUIRED", "Reconnect QuickBooks to confirm the company environment and application. Existing accounting access remains disabled.");
  const current = config();
  if (match[1] !== current.environment || match[2] !== await quickBooksStateHash(current.clientId)) {
    throw new ApiError(409, "QUICKBOOKS_GRANT_RECONNECT_REQUIRED", "QuickBooks configuration changed. Reconnect this company before using its authorization.");
  }
  return current;
}

export async function requireQuickBooksGrantBinding(sourceNamespace: string) {
  const current = await boundConfig(sourceNamespace);
  return { environment: current.environment };
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

export async function exchangeQuickBooksAuthorizationCode(code: string, sourceNamespace: string, fetcher: typeof fetch = fetch) {
  if (!code || code.length > 2_048) throw new ApiError(400, "QUICKBOOKS_CALLBACK_INVALID", "QuickBooks returned an invalid authorization code.");
  const current = await boundConfig(sourceNamespace);
  return requestToken(new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: current.redirectUri,
  }), current, fetcher);
}

async function refreshQuickBooksAuthorization(refreshToken: string, current: QuickBooksConfig, fetcher: typeof fetch) {
  if (!refreshToken || refreshToken.length > 4_096) throw new ApiError(409, "QUICKBOOKS_REFRESH_TOKEN_MISSING", "Reconnect QuickBooks before accessing accounting data.");
  return requestToken(new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  }), current, fetcher);
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
    redirect: "error",
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

export async function verifyQuickBooksCompany(realmId: string, accessToken: string, sourceNamespace: string, fetcher: typeof fetch = fetch): Promise<QuickBooksCompany> {
  if (!REALM_ID.test(realmId)) throw new ApiError(400, "QUICKBOOKS_REALM_INVALID", "QuickBooks returned an invalid company identifier.");
  if (!accessToken) throw new ApiError(400, "QUICKBOOKS_ACCESS_TOKEN_INVALID", "QuickBooks authorization is incomplete.");
  const current = await boundConfig(sourceNamespace);
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
    redirect: "error",
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

function requireMatchingLease(organizationId: string, connectionId: string, lease: IntegrationSyncLease) {
  if (lease.organizationId !== organizationId || lease.connectionId !== connectionId || lease.provider !== QUICKBOOKS_PROVIDER) {
    throw new ApiError(409, "QUICKBOOKS_GRANT_CHANGED", "The QuickBooks authorization changed. Try again from Integrations.");
  }
}

export async function acquireQuickBooksGrantLease(organizationId: string, connectionId: string) {
  const lease = await acquireIntegrationSyncLease(organizationId, QUICKBOOKS_PROVIDER, connectionId, 60_000);
  if (!lease) throw new ApiError(409, "QUICKBOOKS_CONNECTION_BUSY", "QuickBooks is updating this connection. Try again shortly.");
  return lease;
}

// Initial saves are insert-select, never an unconditional upsert. The same
// generation must still be pending/connected and own the unexpired lease. Token
// persistence and activation share a D1 transaction, so reconnect never exposes
// an old secret under new metadata, even if the process stops between steps.
export async function saveQuickBooksTokens(organizationId: string, connectionId: string, token: QuickBooksToken, sourceNamespace: string, lease: IntegrationSyncLease,
  authorizationAttempt?: { lease: IntegrationSyncLease; sourceNamespace: string }) {
  requireMatchingLease(organizationId, connectionId, lease);
  await requireQuickBooksGrantBinding(sourceNamespace);
  if (authorizationAttempt) {
    requireMatchingLease(organizationId, authorizationAttempt.lease.connectionId, authorizationAttempt.lease);
    await requireQuickBooksGrantBinding(authorizationAttempt.sourceNamespace);
  }
  const access = await encryptQuickBooksSecret(token.accessToken);
  const refresh = await encryptQuickBooksSecret(token.refreshToken);
  const now = sqliteTimestampSeconds();
  const attemptGuard = authorizationAttempt ? ` AND EXISTS (SELECT 1 FROM integration_connections p WHERE p.id = ?
    AND p.organization_id = ? AND p.provider = ? AND p.status = 'pending' AND p.source_namespace = ?
    AND p.sync_lease_owner = ? AND p.sync_version = ? AND p.sync_lease_expires_at > ?)` : "";
  const guard = `id = ? AND organization_id = ? AND provider = ? AND status IN ('pending', 'connected') AND source_namespace = ?
      AND sync_lease_owner = ? AND sync_version = ? AND sync_lease_expires_at > ?${attemptGuard}`;
  const bindings = [connectionId, organizationId, QUICKBOOKS_PROVIDER, sourceNamespace, lease.owner, lease.version, now,
    ...(authorizationAttempt ? [authorizationAttempt.lease.connectionId, organizationId, QUICKBOOKS_PROVIDER, authorizationAttempt.sourceNamespace,
      authorizationAttempt.lease.owner, authorizationAttempt.lease.version, now] : [])];
  const results = await getD1().batch([getD1().prepare(`
    INSERT INTO integration_secrets (id, organization_id, provider, connection_id, access_token_ciphertext, refresh_token_ciphertext, token_expires_at, created_at, updated_at)
    SELECT ?, organization_id, provider, id, ?, ?, ?, ?, ? FROM integration_connections
    WHERE ${guard}
    ON CONFLICT(connection_id) DO UPDATE SET access_token_ciphertext = excluded.access_token_ciphertext,
      refresh_token_ciphertext = excluded.refresh_token_ciphertext, token_expires_at = excluded.token_expires_at, updated_at = excluded.updated_at
    WHERE integration_secrets.organization_id = excluded.organization_id AND integration_secrets.provider = excluded.provider
  `).bind(crypto.randomUUID(), access, refresh, sqliteTimestampSeconds(token.accessTokenExpiresAt.getTime()), now, now,
    ...bindings),
    getD1().prepare(`UPDATE integration_connections SET status = 'connected', updated_at = ? WHERE ${guard}
      AND EXISTS (SELECT 1 FROM integration_secrets s WHERE s.connection_id = integration_connections.id
        AND s.organization_id = integration_connections.organization_id AND s.provider = integration_connections.provider
        AND s.access_token_ciphertext = ? AND s.refresh_token_ciphertext = ?)`)
      .bind(now, ...bindings, access, refresh),
  ]);
  if (results.some(result => Number(result.meta.changes ?? 0) !== 1)) throw new ApiError(409, "QUICKBOOKS_GRANT_CHANGED", "The QuickBooks authorization changed before it could be saved. Reconnect the company.");
}

async function connectedQuickBooksSecret(organizationId: string, connectionId: string) {
  const [row] = await getDb().select({
    access: integrationSecrets.accessTokenCiphertext,
    refresh: integrationSecrets.refreshTokenCiphertext,
    expiresAt: integrationSecrets.tokenExpiresAt,
    sourceNamespace: integrationConnections.sourceNamespace,
    realmId: integrationConnections.externalAccountRef,
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
  if (!row.realmId || !REALM_ID.test(row.realmId)) throw new ApiError(409, "QUICKBOOKS_GRANT_RECONNECT_REQUIRED", "Reconnect QuickBooks to confirm its company identifier.");
  return row;
}

export async function quickBooksAccessToken(organizationId: string, connectionId: string, fetcher: typeof fetch = fetch) {
  let row = await connectedQuickBooksSecret(organizationId, connectionId);
  await requireQuickBooksGrantBinding(row.sourceNamespace);
  if (row.expiresAt.getTime() > Date.now() + 5 * 60_000) return decryptQuickBooksSecret(row.access);
  const lease = await acquireQuickBooksGrantLease(organizationId, connectionId);
  try {
    // A prior refresher may have completed after the first read.
    row = await connectedQuickBooksSecret(organizationId, connectionId);
    const current = await boundConfig(row.sourceNamespace);
    if (row.expiresAt.getTime() > Date.now() + 5 * 60_000) return decryptQuickBooksSecret(row.access);
    const refreshed = await refreshQuickBooksAuthorization(await decryptQuickBooksSecret(row.refresh), current, fetcher);
    const access = await encryptQuickBooksSecret(refreshed.accessToken);
    const refresh = await encryptQuickBooksSecret(refreshed.refreshToken);
    const now = sqliteTimestampSeconds();
    const result = await getD1().prepare(`
      UPDATE integration_secrets SET access_token_ciphertext = ?, refresh_token_ciphertext = ?, token_expires_at = ?, updated_at = ?
      WHERE organization_id = ? AND provider = ? AND connection_id = ? AND access_token_ciphertext = ? AND refresh_token_ciphertext = ?
        AND EXISTS (SELECT 1 FROM integration_connections c WHERE c.id = integration_secrets.connection_id
          AND c.organization_id = integration_secrets.organization_id AND c.provider = integration_secrets.provider
          AND c.status = 'connected' AND c.source_namespace = ? AND c.sync_lease_owner = ? AND c.sync_version = ? AND c.sync_lease_expires_at > ?)
    `).bind(access, refresh, sqliteTimestampSeconds(refreshed.accessTokenExpiresAt.getTime()), now,
      organizationId, QUICKBOOKS_PROVIDER, connectionId, row.access, row.refresh, row.sourceNamespace, lease.owner, lease.version, now).run();
    if (Number(result.meta.changes ?? 0) !== 1) throw new ApiError(409, "QUICKBOOKS_GRANT_CHANGED", "QuickBooks was disconnected or reconnected during this request. Try again from Integrations.");
    return refreshed.accessToken;
  } finally {
    await releaseIntegrationSyncLease(lease);
  }
}

export async function revokeQuickBooksAuthorization(token: string, sourceNamespace: string, fetcher: typeof fetch = fetch) {
  if (!token) return false;
  const current = await boundConfig(sourceNamespace);
  const response = await fetcher(REVOCATION_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${btoa(`${current.clientId}:${current.clientSecret}`)}`,
      "Content-Type": "application/json",
      "User-Agent": "Vanteloq-QuickBooks-Connector/1.0",
    },
    body: JSON.stringify({ token }),
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  return response.ok;
}

export async function removeQuickBooksGrant(organizationId: string, connectionId: string, fetcher: typeof fetch = fetch) {
  const lease = await acquireQuickBooksGrantLease(organizationId, connectionId);
  try {
    const [connection] = await getDb().select().from(integrationConnections).where(and(
      eq(integrationConnections.id, connectionId), eq(integrationConnections.organizationId, organizationId), eq(integrationConnections.provider, QUICKBOOKS_PROVIDER),
    )).limit(1);
    if (!connection) throw new ApiError(404, "QUICKBOOKS_NOT_CONNECTED", "The selected QuickBooks connection is unavailable.");
    const [secret] = await getDb().select({ refresh: integrationSecrets.refreshTokenCiphertext }).from(integrationSecrets).where(and(
      eq(integrationSecrets.organizationId, organizationId), eq(integrationSecrets.provider, QUICKBOOKS_PROVIDER), eq(integrationSecrets.connectionId, connectionId),
    )).limit(1);
    let providerAuthorizationRevoked = false;
    if (secret) {
      // Old unbound grants and changed app configuration cannot safely use the
      // current client credentials. Local withdrawal must still remain possible.
      try {
        await requireQuickBooksGrantBinding(connection.sourceNamespace);
        providerAuthorizationRevoked = await revokeQuickBooksAuthorization(await decryptQuickBooksSecret(secret.refresh), connection.sourceNamespace, fetcher);
      } catch { /* Report unconfirmed remote revocation without retaining local access. */ }
    }
    const now = sqliteTimestampSeconds();
    const guard = `id = ? AND organization_id = ? AND provider = ? AND source_namespace = ? AND sync_lease_owner = ? AND sync_version = ? AND sync_lease_expires_at > ?`;
    const bindings = [connectionId, organizationId, QUICKBOOKS_PROVIDER, connection.sourceNamespace, lease.owner, lease.version, now];
    const results = await getD1().batch([
      getD1().prepare(`DELETE FROM integration_secrets WHERE organization_id = ? AND provider = ? AND connection_id = ?
        AND EXISTS (SELECT 1 FROM integration_connections WHERE ${guard})`).bind(organizationId, QUICKBOOKS_PROVIDER, connectionId, ...bindings),
      getD1().prepare(`UPDATE integration_connections SET status = 'revoked', external_account_ref = NULL, domain_prefix = NULL,
        scopes_json = '[]', data_promotion_status = 'blocked', promotion_authorized_at = NULL, connected_at = NULL,
        last_successful_sync_at = NULL, last_sync_cursor = NULL, last_error_code = NULL, updated_at = ?
        WHERE ${guard}`).bind(now, ...bindings),
    ]);
    if (Number(results[1].meta.changes ?? 0) !== 1) throw new ApiError(409, "QUICKBOOKS_GRANT_CHANGED", "The QuickBooks connection changed during removal. Try again.");
    return { providerAuthorizationRevoked, localCredentialsDeleted: true,
      providerRevocationRequired: !providerAuthorizationRevoked && Boolean(secret || connection.externalAccountRef) };
  } finally {
    await releaseIntegrationSyncLease(lease);
  }
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
