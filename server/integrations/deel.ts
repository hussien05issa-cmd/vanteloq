import { and, eq } from "drizzle-orm";
import { getD1, getDb, getRuntimeEnv } from "../../db";
import { integrationConnections, integrationSecrets } from "../../db/schema";
import { acquireIntegrationSyncLease, releaseIntegrationSyncLease, sqliteTimestampSeconds, type IntegrationSyncLease } from "./connection";
import { ApiError } from "../api";

export const DEEL_PROVIDER = "deel";
export const DEEL_API_VERSION = "2026-01-01";
export const DEEL_READ_SCOPES = ["organizations:read", "accounting:read", "legal-entity:read", "payslips:read"] as const;
export const DEEL_NOTICE_VERSION = "deel-aggregate-finalized-payroll-v1";
export const DEEL_DATA_CATEGORIES = [
  "legal entity name and country",
  "finalized payroll cycle dates and type",
  "currency-level payroll category totals",
] as const;
export const DEEL_PROCESSING_PURPOSES = [
  "stage finalized payroll evidence for owner review",
  "support BookLoQ reconciliation without worker-level records",
] as const;

const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET_AAD = "vanteloq:deel:v1";
const ACCESS_TOKEN_SKEW_MS = 5 * 60_000;
const THIRTY_DAYS_SECONDS = 2_592_000;
const CATEGORY_GROUPS = ["ADDITIONS", "DEDUCTIONS", "BENEFITS", "INFOS", "CONTRIBUTIONS", "TOTALS"] as const;
type DeelCategoryGroup = typeof CATEGORY_GROUPS[number];
type DeelEnvironment = "sandbox" | "production";

type DeelConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  environment: DeelEnvironment;
  authorizationUrl: string;
  tokenUrl: string;
  apiOrigin: string;
  encryptionKey: string;
};

export type DeelToken = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  scopes: string[];
};

export type DeelOrganization = { id: string; name: string };
export type DeelLegalEntity = { id: string; name: string; country: string | null };
export type DeelPayrollCycle = {
  id: string;
  type: "REGULAR" | "OFFCYCLE";
  dateStart: string;
  dateEnd: string;
  legalEntityId: string;
  payrollGroupId: string | null;
};
export type DeelPayrollCurrencySummary = {
  currency: string;
  categoryTotalsCents: Record<DeelCategoryGroup, number>;
  sourceCreatedAt: string | null;
  sourceUpdatedAt: string | null;
};

function environmentFrom(value: string | undefined): DeelEnvironment {
  return value?.trim().toLowerCase() === "production" ? "production" : "sandbox";
}

function endpoints(environment: DeelEnvironment) {
  return environment === "production"
    ? {
      authorizationUrl: "https://app.deel.com/oauth2/authorize",
      tokenUrl: "https://app.deel.com/oauth2/tokens",
      apiOrigin: "https://api.letsdeel.com",
    }
    : {
      authorizationUrl: "https://app-sandbox.letsdeel.com/oauth/authorize",
      tokenUrl: "https://app-sandbox.letsdeel.com/oauth/token",
      apiOrigin: "https://api-staging.letsdeel.com",
    };
}

export function deelReadiness() {
  const env = getRuntimeEnv();
  const environment = environmentFrom(env.DEEL_ENV);
  const missingConfiguration = [
    ["DEEL_CLIENT_ID", env.DEEL_CLIENT_ID],
    ["DEEL_CLIENT_SECRET", env.DEEL_CLIENT_SECRET],
    ["DEEL_REDIRECT_URI", env.DEEL_REDIRECT_URI],
    ["INTEGRATION_ENCRYPTION_KEY", env.INTEGRATION_ENCRYPTION_KEY],
  ].filter((entry) => !entry[1]?.trim()).map((entry) => entry[0]);
  const productionApproved = environment === "sandbox" || env.DEEL_PARTNER_APPROVED?.trim().toLowerCase() === "true";
  return {
    adapterBuilt: true,
    credentialsConfigured: missingConfiguration.length === 0,
    missingConfiguration,
    environment,
    apiVersion: DEEL_API_VERSION,
    scopes: [...DEEL_READ_SCOPES],
    mode: "aggregate_finalized_payroll_staging" as const,
    productionApproved,
    publicAvailability: "coming_soon" as const,
    dataPromotionEnabled: false,
    employeeRecordsStored: false,
  };
}

function config(): DeelConfig {
  const env = getRuntimeEnv();
  const readiness = deelReadiness();
  if (!readiness.credentialsConfigured) {
    throw new ApiError(503, "DEEL_CONFIGURATION_REQUIRED", "Deel developer credentials must be configured before authorization can begin.");
  }
  if (!readiness.productionApproved) {
    throw new ApiError(503, "DEEL_PRODUCTION_APPROVAL_REQUIRED", "Deel production access remains unavailable until Deel approves the Vanteloq partner application.");
  }
  let redirect: URL;
  try { redirect = new URL(env.DEEL_REDIRECT_URI!.trim()); }
  catch { throw new ApiError(503, "DEEL_REDIRECT_INVALID", "The configured Deel callback URL is invalid."); }
  if (redirect.protocol !== "https:" || redirect.username || redirect.password || redirect.hash || redirect.search) {
    throw new ApiError(503, "DEEL_REDIRECT_INVALID", "The configured Deel callback URL must be a clean HTTPS URL.");
  }
  return {
    clientId: env.DEEL_CLIENT_ID!.trim(),
    clientSecret: env.DEEL_CLIENT_SECRET!,
    redirectUri: redirect.toString(),
    environment: readiness.environment,
    encryptionKey: env.INTEGRATION_ENCRYPTION_KEY!.trim(),
    ...endpoints(readiness.environment),
  };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64Url(bytes: Uint8Array): string {
  return base64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0));
}

async function cryptoKey(encoded: string) {
  let raw: Uint8Array;
  try { raw = fromBase64(encoded); }
  catch { throw new ApiError(503, "INTEGRATION_ENCRYPTION_KEY_INVALID", "The integration encryption key is invalid."); }
  if (raw.byteLength !== 32) throw new ApiError(503, "INTEGRATION_ENCRYPTION_KEY_INVALID", "The integration encryption key must decode to 32 bytes.");
  return crypto.subtle.importKey("raw", toArrayBuffer(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export function newDeelState(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function deelStateHash(state: string): Promise<string> {
  if (!STATE_PATTERN.test(state)) throw new Error("Invalid Deel OAuth state");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(state));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function buildDeelAuthorizationUrl(state: string): string {
  if (!STATE_PATTERN.test(state)) throw new Error("Invalid Deel OAuth state");
  const current = config();
  const url = new URL(current.authorizationUrl);
  url.searchParams.set("client_id", current.clientId);
  url.searchParams.set("redirect_uri", current.redirectUri);
  url.searchParams.set("scope", DEEL_READ_SCOPES.join(" "));
  url.searchParams.set("state", state);
  return url.toString();
}

function cleanScopes(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return [...new Set(value.split(/[\s,]+/).map((scope) => scope.trim()).filter(Boolean))].sort();
}

async function tokenRequest(fields: Record<string, string>, fetcher: typeof fetch): Promise<DeelToken> {
  const current = config();
  const credentials = base64(new TextEncoder().encode(`${current.clientId}:${current.clientSecret}`));
  const response = await fetcher(current.tokenUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(fields),
    redirect: "manual",
    signal: AbortSignal.timeout(12_000),
  });
  if (response.status >= 300 && response.status < 400) throw new ApiError(502, "DEEL_REDIRECT_REJECTED", "Deel redirected an authorization request. Start a new connection attempt.");
  if (response.status === 429) throw new ApiError(503, "DEEL_RATE_LIMITED", "Deel is rate-limiting authorization. Wait, then retry.");
  if (!response.ok) throw new ApiError(502, "DEEL_TOKEN_EXCHANGE_FAILED", "Deel did not accept the authorization request. Start a new connection attempt.");
  const body = await response.json() as Record<string, unknown>;
  const accessToken = typeof body.access_token === "string" ? body.access_token : "";
  const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : "";
  const tokenType = typeof body.token_type === "string" ? body.token_type.toLowerCase() : "";
  const expiresIn = Number(body.expires_in);
  const scopes = cleanScopes(body.scope);
  if (!accessToken || !refreshToken || tokenType !== "bearer" || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new ApiError(502, "DEEL_TOKEN_RESPONSE_INVALID", "Deel returned an incomplete OAuth token response.");
  }
  if (DEEL_READ_SCOPES.some((scope) => !scopes.includes(scope))) {
    throw new ApiError(409, "DEEL_SCOPES_INCOMPLETE", "Deel did not grant every read-only payroll scope requested by Vanteloq.");
  }
  return {
    accessToken,
    refreshToken,
    accessTokenExpiresAt: new Date(Date.now() + Math.min(expiresIn, THIRTY_DAYS_SECONDS) * 1000),
    scopes,
  };
}

export function exchangeDeelCode(code: string, fetcher: typeof fetch = fetch) {
  if (!code || code.length > 4_096) throw new ApiError(400, "DEEL_CODE_INVALID", "Deel returned an invalid authorization code.");
  return tokenRequest({ grant_type: "authorization_code", code, redirect_uri: config().redirectUri }, fetcher);
}

export function refreshDeelToken(refreshToken: string, fetcher: typeof fetch = fetch) {
  if (!refreshToken) throw new ApiError(409, "DEEL_REFRESH_TOKEN_MISSING", "Reconnect Deel before synchronizing payroll evidence.");
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken, redirect_uri: config().redirectUri }, fetcher);
}

export async function encryptDeelSecret(value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(SECRET_AAD) },
    await cryptoKey(config().encryptionKey),
    new TextEncoder().encode(value),
  );
  return `v1.${base64Url(iv)}.${base64Url(new Uint8Array(ciphertext))}`;
}

export async function decryptDeelSecret(value: string): Promise<string> {
  const [version, encodedIv, encodedCiphertext] = value.split(".");
  if (version !== "v1" || !encodedIv || !encodedCiphertext) throw new ApiError(500, "DEEL_SECRET_INVALID", "Stored Deel credentials could not be read.");
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toArrayBuffer(fromBase64(encodedIv)), additionalData: new TextEncoder().encode(SECRET_AAD) },
      await cryptoKey(config().encryptionKey),
      toArrayBuffer(fromBase64(encodedCiphertext)),
    );
    return new TextDecoder().decode(plaintext);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, "DEEL_SECRET_DECRYPTION_FAILED", "Stored Deel credentials could not be decrypted.");
  }
}


export function deelLeaseGuard(lease: IntegrationSyncLease, sourceNamespace: string, status: "pending" | "connected" = "connected", prefix = "") {
  if (lease.provider !== DEEL_PROVIDER || !sourceNamespace) throw new ApiError(409, "DEEL_GRANT_CHANGED", "The Deel connection changed. Start again from Integrations.");
  return {
    sql: `${prefix}id = ? AND ${prefix}organization_id = ? AND ${prefix}provider = ? AND ${prefix}status = ? AND ${prefix}source_namespace = ?
      AND ${prefix}sync_lease_owner = ? AND ${prefix}sync_version = ? AND ${prefix}sync_lease_expires_at > ?`,
    bindings: [lease.connectionId, lease.organizationId, DEEL_PROVIDER, status, sourceNamespace, lease.owner, lease.version, sqliteTimestampSeconds()],
  };
}

export async function acquireDeelGrantLease(organizationId: string, connectionId: string, ttlMs = 60_000) {
  const lease = await acquireIntegrationSyncLease(organizationId, DEEL_PROVIDER, connectionId, ttlMs);
  if (!lease) throw new ApiError(409, "DEEL_CONNECTION_BUSY", "Deel is updating this connection. Try again shortly.");
  return lease;
}

async function connectedDeelSecret(organizationId: string, connectionId: string, lease?: IntegrationSyncLease) {
  if (lease && (lease.organizationId !== organizationId || lease.connectionId !== connectionId || lease.provider !== DEEL_PROVIDER)) {
    throw new ApiError(409, "DEEL_GRANT_CHANGED", "The Deel connection changed. Start again from Integrations.");
  }
  const [row] = await getDb().select({
    access: integrationSecrets.accessTokenCiphertext, refresh: integrationSecrets.refreshTokenCiphertext,
    expires: integrationSecrets.tokenExpiresAt, sourceNamespace: integrationConnections.sourceNamespace,
    leaseOwner: integrationConnections.syncLeaseOwner, version: integrationConnections.syncVersion,
    leaseExpires: integrationConnections.syncLeaseExpiresAt,
  }).from(integrationSecrets).innerJoin(integrationConnections, and(
    eq(integrationConnections.id, integrationSecrets.connectionId),
    eq(integrationConnections.organizationId, integrationSecrets.organizationId),
    eq(integrationConnections.provider, integrationSecrets.provider),
  )).where(and(eq(integrationSecrets.organizationId, organizationId), eq(integrationSecrets.provider, DEEL_PROVIDER),
    eq(integrationSecrets.connectionId, connectionId), eq(integrationConnections.status, "connected"))).limit(1);
  if (!row) throw new ApiError(409, "DEEL_NOT_CONNECTED", "Authorize Deel before accessing finalized payroll evidence.");
  if (lease && (row.leaseOwner !== lease.owner || row.version !== lease.version || !row.leaseExpires || row.leaseExpires.getTime() <= Date.now())) {
    throw new ApiError(409, "DEEL_GRANT_CHANGED", "The Deel connection changed. Start again from Integrations.");
  }
  return row;
}

// A sync caller passes its existing lease. Standalone refresh acquires its own
// lease and re-reads the secret before consuming the single-use refresh token.
export async function deelAccessToken(organizationId: string, connectionId: string, fetcher: typeof fetch = fetch, existingLease?: IntegrationSyncLease): Promise<string> {
  let row = await connectedDeelSecret(organizationId, connectionId, existingLease);
  if (row.expires.getTime() > Date.now() + ACCESS_TOKEN_SKEW_MS) return decryptDeelSecret(row.access);
  const lease = existingLease ?? await acquireDeelGrantLease(organizationId, connectionId);
  try {
    row = await connectedDeelSecret(organizationId, connectionId, lease);
    if (row.expires.getTime() > Date.now() + ACCESS_TOKEN_SKEW_MS) return decryptDeelSecret(row.access);
    let token: DeelToken;
    try { token = await refreshDeelToken(await decryptDeelSecret(row.refresh), fetcher); }
    catch (error) {
      // After an unsuccessful exchange we cannot know whether Deel consumed
      // the refresh token. Never automatically send that same token again.
      const guard = deelLeaseGuard(lease, row.sourceNamespace, "connected", "c.");
      const directGuard = deelLeaseGuard(lease, row.sourceNamespace);
      await getD1().batch([
        getD1().prepare(`DELETE FROM integration_secrets WHERE organization_id = ? AND provider = ? AND connection_id = ?
          AND access_token_ciphertext = ? AND refresh_token_ciphertext = ?
          AND EXISTS (SELECT 1 FROM integration_connections c WHERE ${guard.sql})`)
          .bind(organizationId, DEEL_PROVIDER, connectionId, row.access, row.refresh, ...guard.bindings),
        getD1().prepare(`UPDATE integration_connections SET status = 'error', data_promotion_status = 'blocked',
          connected_at = NULL, last_error_code = 'DEEL_REFRESH_RECONNECT_REQUIRED', sync_version = sync_version + 1,
          sync_lease_owner = NULL, sync_lease_expires_at = NULL, updated_at = ? WHERE ${directGuard.sql}
          AND NOT EXISTS (SELECT 1 FROM integration_secrets s WHERE s.connection_id = integration_connections.id
            AND s.organization_id = integration_connections.organization_id AND s.provider = integration_connections.provider)`)
          .bind(sqliteTimestampSeconds(), ...directGuard.bindings),
      ]);
      throw new ApiError(409, "DEEL_REFRESH_RECONNECT_REQUIRED", "The Deel token exchange could not be confirmed. Reconnect Deel before synchronizing again.");
    }
    const access = await encryptDeelSecret(token.accessToken), refresh = await encryptDeelSecret(token.refreshToken);
    const guard = deelLeaseGuard(lease, row.sourceNamespace, "connected", "c.");
    const result = await getD1().prepare(`UPDATE integration_secrets SET access_token_ciphertext = ?, refresh_token_ciphertext = ?, token_expires_at = ?, updated_at = ?
      WHERE organization_id = ? AND provider = ? AND connection_id = ? AND access_token_ciphertext = ? AND refresh_token_ciphertext = ?
      AND EXISTS (SELECT 1 FROM integration_connections c WHERE ${guard.sql})`)
      .bind(access, refresh, sqliteTimestampSeconds(token.accessTokenExpiresAt.getTime()), sqliteTimestampSeconds(),
        organizationId, DEEL_PROVIDER, connectionId, row.access, row.refresh, ...guard.bindings).run();
    if (Number(result.meta.changes ?? 0) !== 1) throw new ApiError(409, "DEEL_GRANT_CHANGED", "Deel was disconnected or reconnected during this request. Start again from Integrations.");
    return token.accessToken;
  } finally {
    if (!existingLease) await releaseIntegrationSyncLease(lease);
  }
}

// Verification uses the in-memory code exchange result. No pending secret or
// legal-entity mapping becomes visible until atomic, fenced activation succeeds.
export async function activateDeelGrant(lease: IntegrationSyncLease, sourceNamespace: string, token: DeelToken,
  organization: DeelOrganization, entities: DeelLegalEntity[], localLocationId: string | null) {
  const guard = deelLeaseGuard(lease, sourceNamespace, "pending");
  const access = await encryptDeelSecret(token.accessToken), refresh = await encryptDeelSecret(token.refreshToken);
  const now = sqliteTimestampSeconds(), database = getD1();
  const statements = [database.prepare(`INSERT INTO integration_secrets
    (id, organization_id, provider, connection_id, access_token_ciphertext, refresh_token_ciphertext, token_expires_at, created_at, updated_at)
    SELECT ?, organization_id, provider, id, ?, ?, ?, ?, ? FROM integration_connections WHERE ${guard.sql}
    ON CONFLICT(connection_id) DO UPDATE SET access_token_ciphertext = excluded.access_token_ciphertext,
      refresh_token_ciphertext = excluded.refresh_token_ciphertext, token_expires_at = excluded.token_expires_at, updated_at = excluded.updated_at
    WHERE integration_secrets.organization_id = excluded.organization_id AND integration_secrets.provider = excluded.provider`)
    .bind(crypto.randomUUID(), access, refresh, sqliteTimestampSeconds(token.accessTokenExpiresAt.getTime()), now, now, ...guard.bindings)];
  for (const entity of entities) {
    statements.push(database.prepare(`INSERT INTO integration_location_mappings
      (id, organization_id, provider, connection_id, external_location_ref, external_name, local_location_id, status, last_seen_at, created_at, updated_at)
      SELECT ?, organization_id, provider, id, ?, ?, ?, ?, ?, ?, ? FROM integration_connections WHERE ${guard.sql}
      ON CONFLICT(organization_id, provider, connection_id, external_location_ref) DO UPDATE SET
        external_name = excluded.external_name, local_location_id = excluded.local_location_id, status = excluded.status,
        last_seen_at = excluded.last_seen_at, updated_at = excluded.updated_at`)
      .bind(crypto.randomUUID(), entity.id, entity.country ? `${entity.name} (${entity.country})` : entity.name,
        localLocationId, localLocationId ? "mapped" : "unmapped", now, now, now, ...guard.bindings));
  }
  statements.push(database.prepare(`UPDATE integration_connections SET status = 'connected', external_account_ref = ?, external_account_name = ?,
    api_version = ?, scopes_json = ?, data_promotion_status = 'staging', connected_at = ?, last_error_code = NULL, updated_at = ?
    WHERE ${guard.sql} AND EXISTS (SELECT 1 FROM integration_secrets s WHERE s.connection_id = integration_connections.id
      AND s.organization_id = integration_connections.organization_id AND s.provider = integration_connections.provider
      AND s.access_token_ciphertext = ? AND s.refresh_token_ciphertext = ?)`)
    .bind(organization.id, organization.name, DEEL_API_VERSION, JSON.stringify(token.scopes), now, now, ...guard.bindings, access, refresh));
  const results = await database.batch(statements);
  if (results.some(result => Number(result.meta.changes ?? 0) !== 1)) throw new ApiError(409, "DEEL_GRANT_CHANGED", "The Deel authorization changed before it could be saved. Start a new connection attempt.");
}

export async function failDeelAuthorization(lease: IntegrationSyncLease, sourceNamespace: string, errorCode: string) {
  const guard = deelLeaseGuard(lease, sourceNamespace, "pending");
  const nested = deelLeaseGuard(lease, sourceNamespace, "pending", "c.");
  const database = getD1();
  await database.batch([
    ...["integration_secrets", "integration_location_mappings"].map(table => database.prepare(`DELETE FROM ${table}
      WHERE organization_id = ? AND provider = ? AND connection_id = ? AND EXISTS (SELECT 1 FROM integration_connections c WHERE ${nested.sql})`)
      .bind(lease.organizationId, DEEL_PROVIDER, lease.connectionId, ...nested.bindings)),
    database.prepare(`UPDATE integration_connections SET status = 'error', data_promotion_status = 'blocked', connected_at = NULL,
      last_error_code = ?, updated_at = ? WHERE ${guard.sql}`).bind(errorCode, sqliteTimestampSeconds(), ...guard.bindings),
  ]);
}

export async function removeDeelLocalGrant(organizationId: string, connectionId: string, sourceNamespace: string) {
  const database = getD1(), now = sqliteTimestampSeconds();
  const revokedGuard = `EXISTS (SELECT 1 FROM integration_connections c WHERE c.id = ? AND c.organization_id = ?
    AND c.provider = ? AND c.source_namespace = ? AND c.status = 'revoked')`;
  const results = await database.batch([
    database.prepare(`UPDATE integration_connections SET status = 'revoked', external_account_ref = NULL, external_account_name = NULL,
      domain_prefix = NULL, scopes_json = '[]', data_promotion_status = 'blocked', connected_at = NULL,
      last_successful_sync_at = NULL, last_sync_cursor = NULL, last_error_code = NULL, privacy_data_deleted_at = ?,
      sync_version = sync_version + 1, sync_lease_owner = NULL, sync_lease_expires_at = NULL, updated_at = ?
      WHERE id = ? AND organization_id = ? AND provider = ? AND source_namespace = ?`)
      .bind(now, now, connectionId, organizationId, DEEL_PROVIDER, sourceNamespace),
    ...["integration_secrets", "integration_oauth_states", "retail_measurements", "integration_location_mappings"].map(table => database.prepare(`DELETE FROM ${table}
      WHERE organization_id = ? AND provider = ? AND connection_id = ? AND ${revokedGuard}`)
      .bind(organizationId, DEEL_PROVIDER, connectionId, connectionId, organizationId, DEEL_PROVIDER, sourceNamespace)),
    database.prepare(`UPDATE integration_consents SET status = 'withdrawn', withdrawn_at = ?, updated_at = ?
      WHERE organization_id = ? AND provider = ? AND status = 'accepted' AND ${revokedGuard}`)
      .bind(now, now, organizationId, DEEL_PROVIDER, connectionId, organizationId, DEEL_PROVIDER, sourceNamespace),
  ]);
  if (Number(results[0].meta.changes ?? 0) !== 1) throw new ApiError(409, "DEEL_GRANT_CHANGED", "The Deel connection changed before removal. Try again from Integrations.");
  return { stagedAggregatesDeleted: Number(results[3].meta.changes ?? 0) };
}

export async function stageDeelMeasurement(lease: IntegrationSyncLease, sourceNamespace: string, row: {
  outletRef: string; reference: string; periodFrom: string; periodTo: string; valuesJson: string; updatedByUserId: string | null;
}) {
  const guard = deelLeaseGuard(lease, sourceNamespace);
  const result = await getD1().prepare(`INSERT INTO retail_measurements
    (id, organization_id, connection_id, provider, outlet_ref, kind, reference, period_from, period_to, source_label, values_json, updated_by_user_id, version, updated_at)
    SELECT ?, organization_id, id, provider, ?, 'labour', ?, ?, ?, 'Deel finalized payroll-cycle aggregate', ?, ?, 1, ?
    FROM integration_connections WHERE ${guard.sql}
    ON CONFLICT(organization_id, connection_id, outlet_ref, kind, reference, period_from, period_to) DO UPDATE SET
      values_json = excluded.values_json, source_label = excluded.source_label, updated_by_user_id = excluded.updated_by_user_id,
      version = retail_measurements.version + 1, updated_at = excluded.updated_at`)
    .bind(crypto.randomUUID(), row.outletRef, row.reference, row.periodFrom, row.periodTo, row.valuesJson, row.updatedByUserId, Date.now(), ...guard.bindings).run();
  if (Number(result.meta.changes ?? 0) !== 1) throw new ApiError(409, "DEEL_GRANT_CHANGED", "The Deel synchronization was superseded before evidence could be staged.");
}

async function providerGet(url: URL, accessToken: string, fetcher: typeof fetch): Promise<Response> {
  const current = config();
  if (url.origin !== current.apiOrigin || (!url.pathname.startsWith("/rest/") && url.pathname !== "/rest")) {
    throw new ApiError(502, "DEEL_RESOURCE_INVALID", "Deel returned an unsafe resource URL.");
  }
  const response = await fetcher(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "x-client-id": current.clientId,
      "X-Version": DEEL_API_VERSION,
    },
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status >= 300 && response.status < 400) throw new ApiError(502, "DEEL_REDIRECT_REJECTED", "Deel redirected a payroll request. No redirected resource was accessed.");
  if (response.status === 429) throw new ApiError(503, "DEEL_RATE_LIMITED", "Deel reached its organization rate limit. Retry the synchronization after waiting.");
  if (response.status === 401 || response.status === 403) throw new ApiError(409, "DEEL_AUTHORIZATION_EXPIRED", "Deel authorization is no longer valid or lacks an approved scope. Reconnect after access is approved.");
  if (!response.ok) throw new ApiError(502, "DEEL_PROVIDER_ERROR", "Deel could not complete the read-only payroll request. No partial payroll evidence was staged.");
  return response;
}

async function tokenGet(
  accessToken: string,
  path: string,
  query: Record<string, string | number | boolean | null | undefined>,
  fetcher: typeof fetch,
) {
  if (!path.startsWith("/rest/") || path.includes("..")) throw new ApiError(400, "DEEL_RESOURCE_INVALID", "The requested Deel resource is invalid.");
  const url = new URL(path, config().apiOrigin);
  for (const [key, value] of Object.entries(query)) if (value != null) url.searchParams.set(key, String(value));
  return providerGet(url, accessToken, fetcher);
}

function cleanUuid(value: unknown, code: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new ApiError(502, code, "Deel returned an invalid identifier.");
  return value;
}

function cleanText(value: unknown, fallback: string, max = 160): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value.trim().replace(/[\u0000-\u001f\u007f]/g, "");
  return cleaned ? cleaned.slice(0, max) : fallback;
}

function cleanDate(value: unknown, code: string): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new ApiError(502, code, "Deel returned an invalid payroll date.");
  return value;
}

export async function fetchDeelOrganization(organizationId: string, connectionId: string, fetcher: typeof fetch = fetch): Promise<DeelOrganization> {
  return fetchDeelOrganizationWithToken(await deelAccessToken(organizationId, connectionId, fetcher), fetcher);
}

export async function fetchDeelOrganizationWithToken(accessToken: string, fetcher: typeof fetch = fetch): Promise<DeelOrganization> {
  const response = await tokenGet(accessToken, "/rest/organizations", {}, fetcher);
  const body = await response.json() as { data?: unknown };
  const rows = Array.isArray(body.data) ? body.data : [];
  if (rows.length !== 1 || !rows[0] || typeof rows[0] !== "object") throw new ApiError(502, "DEEL_ORGANIZATION_INVALID", "Deel returned an ambiguous organization response.");
  const row = rows[0] as Record<string, unknown>;
  const id = cleanUuid(row.id, "DEEL_ORGANIZATION_INVALID");
  return { id, name: cleanText(row.name, `Deel organization ${id}`) };
}

export async function fetchDeelLegalEntities(organizationId: string, connectionId: string, fetcher: typeof fetch = fetch): Promise<DeelLegalEntity[]> {
  return fetchDeelLegalEntitiesWithToken(await deelAccessToken(organizationId, connectionId, fetcher), fetcher);
}

export async function fetchDeelLegalEntitiesWithToken(accessToken: string, fetcher: typeof fetch = fetch): Promise<DeelLegalEntity[]> {
  const entities: DeelLegalEntity[] = [];
  let cursor: string | null = null;
  const seen = new Set<string>();
  for (let page = 0; page < 100; page += 1) {
    const response = await tokenGet(accessToken, "/rest/legal-entities", {
      limit: 100, global_payroll: true, include_archived: false, cursor,
    }, fetcher);
    const body = await response.json() as { data?: unknown; page?: { cursor?: unknown } };
    if (!Array.isArray(body.data)) throw new ApiError(502, "DEEL_LEGAL_ENTITIES_INVALID", "Deel returned an invalid legal-entity page.");
    for (const raw of body.data) {
      if (!raw || typeof raw !== "object") throw new ApiError(502, "DEEL_LEGAL_ENTITY_INVALID", "Deel returned an invalid legal entity.");
      const row = raw as Record<string, unknown>;
      const id = cleanUuid(row.id, "DEEL_LEGAL_ENTITY_INVALID");
      if (seen.has(id)) continue;
      seen.add(id);
      const country = typeof row.country === "string" && /^[A-Z]{2}$/.test(row.country) ? row.country : null;
      entities.push({ id, name: cleanText(row.name, `Legal entity ${id}`), country });
    }
    const next = typeof body.page?.cursor === "string" && body.page.cursor ? body.page.cursor : null;
    if (!next) return entities;
    if (next === cursor) throw new ApiError(502, "DEEL_PAGINATION_INVALID", "Deel repeated a legal-entity cursor.");
    cursor = next;
  }
  throw new ApiError(502, "DEEL_PAGINATION_LIMIT", "Deel returned too many legal-entity pages to process safely.");
}

export async function fetchFinalizedDeelPayrollCycles(
  organizationId: string,
  connectionId: string,
  legalEntityId: string,
  dateStart: string,
  dateEnd: string,
  fetcher: typeof fetch = fetch,
): Promise<DeelPayrollCycle[]> {
  const accessToken = await deelAccessToken(organizationId, connectionId, fetcher);
  return fetchFinalizedDeelPayrollCyclesWithToken(accessToken, legalEntityId, dateStart, dateEnd, fetcher);
}

export async function fetchFinalizedDeelPayrollCyclesWithToken(
  accessToken: string,
  legalEntityId: string,
  dateStart: string,
  dateEnd: string,
  fetcher: typeof fetch = fetch,
): Promise<DeelPayrollCycle[]> {
  cleanUuid(legalEntityId, "DEEL_LEGAL_ENTITY_INVALID");
  const cycles: DeelPayrollCycle[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 100; page += 1) {
    const response = await tokenGet(accessToken, `/rest/legal-entities/${encodeURIComponent(legalEntityId)}/payroll-events`, {
      date_start: dateStart, date_end: dateEnd, limit: 100, cursor,
    }, fetcher);
    const body = await response.json() as { data?: unknown; has_more?: unknown; next_cursor?: unknown };
    if (!Array.isArray(body.data)) throw new ApiError(502, "DEEL_PAYROLL_CYCLES_INVALID", "Deel returned an invalid payroll-cycle page.");
    for (const raw of body.data) {
      if (!raw || typeof raw !== "object") throw new ApiError(502, "DEEL_PAYROLL_CYCLE_INVALID", "Deel returned an invalid payroll cycle.");
      const row = raw as Record<string, unknown>;
      if (row.has_g2n_report !== true) continue;
      const returnedLegalEntityId = cleanUuid(row.legal_entity_id, "DEEL_PAYROLL_CYCLE_INVALID");
      if (returnedLegalEntityId !== legalEntityId) throw new ApiError(502, "DEEL_LEGAL_ENTITY_MISMATCH", "Deel returned a payroll cycle for a different legal entity.");
      const type = row.type === "REGULAR" || row.type === "OFFCYCLE" ? row.type : null;
      if (!type) throw new ApiError(502, "DEEL_PAYROLL_CYCLE_INVALID", "Deel returned an unsupported payroll-cycle type.");
      cycles.push({
        id: cleanUuid(row.id, "DEEL_PAYROLL_CYCLE_INVALID"),
        type,
        dateStart: cleanDate(row.date_start, "DEEL_PAYROLL_CYCLE_INVALID"),
        dateEnd: cleanDate(row.date_end, "DEEL_PAYROLL_CYCLE_INVALID"),
        legalEntityId,
        payrollGroupId: typeof row.payroll_group_id === "string" && UUID_PATTERN.test(row.payroll_group_id) ? row.payroll_group_id : null,
      });
    }
    if (body.has_more !== true) return cycles;
    const next = typeof body.next_cursor === "string" && body.next_cursor ? body.next_cursor : null;
    if (!next || next === cursor) throw new ApiError(502, "DEEL_PAGINATION_INVALID", "Deel omitted or repeated the next payroll-cycle cursor.");
    cursor = next;
  }
  throw new ApiError(502, "DEEL_PAGINATION_LIMIT", "Deel returned too many payroll-cycle pages to process safely.");
}

export function deelMoneyToCents(value: unknown): number {
  if (typeof value !== "number" && typeof value !== "string") throw new ApiError(502, "DEEL_MONEY_INVALID", "Deel returned an invalid payroll amount.");
  const normalized = String(value).trim();
  const match = /^(-?)(\d{1,13})(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) throw new ApiError(502, "DEEL_MONEY_PRECISION_UNSUPPORTED", "Deel returned a payroll amount that cannot be converted to cents without rounding.");
  const cents = Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0"));
  const signed = match[1] ? -cents : cents;
  if (!Number.isSafeInteger(signed)) throw new ApiError(502, "DEEL_MONEY_INVALID", "Deel returned a payroll amount outside the supported range.");
  return signed;
}

export async function fetchDeelGrossToNetSummary(
  organizationId: string,
  connectionId: string,
  cycleId: string,
  fetcher: typeof fetch = fetch,
): Promise<DeelPayrollCurrencySummary[]> {
  const accessToken = await deelAccessToken(organizationId, connectionId, fetcher);
  return fetchDeelGrossToNetSummaryWithToken(accessToken, cycleId, fetcher);
}

export async function fetchDeelGrossToNetSummaryWithToken(
  accessToken: string,
  cycleId: string,
  fetcher: typeof fetch = fetch,
): Promise<DeelPayrollCurrencySummary[]> {
  cleanUuid(cycleId, "DEEL_PAYROLL_CYCLE_INVALID");
  const totals = new Map<string, Record<DeelCategoryGroup, number>>();
  let sourceCreatedAt: string | null = null;
  let sourceUpdatedAt: string | null = null;
  let cursor: string | null = null;
  for (let page = 0; page < 1_000; page += 1) {
    const response = await tokenGet(accessToken, `/rest/reports/payroll/cycles/${encodeURIComponent(cycleId)}/gross-to-net`, {
      limit: 100, cursor,
    }, fetcher);
    const body = await response.json() as { data?: unknown; has_more?: unknown; next_cursor?: unknown; created_at?: unknown; updated_at?: unknown };
    if (!Array.isArray(body.data)) throw new ApiError(502, "DEEL_G2N_INVALID", "Deel returned an invalid gross-to-net page.");
    if (typeof body.created_at === "string" && !Number.isNaN(Date.parse(body.created_at))) sourceCreatedAt = body.created_at;
    if (typeof body.updated_at === "string" && !Number.isNaN(Date.parse(body.updated_at))) sourceUpdatedAt = body.updated_at;
    for (const raw of body.data) {
      if (!raw || typeof raw !== "object") throw new ApiError(502, "DEEL_G2N_INVALID", "Deel returned an invalid gross-to-net record.");
      const row = raw as Record<string, unknown>;
      const currency = typeof row.currency === "string" ? row.currency.trim().toUpperCase() : "";
      if (!/^[A-Z]{3}$/.test(currency)) throw new ApiError(502, "DEEL_CURRENCY_INVALID", "Deel returned an invalid payroll currency.");
      const current = totals.get(currency) ?? Object.fromEntries(CATEGORY_GROUPS.map((group) => [group, 0])) as Record<DeelCategoryGroup, number>;
      if (!Array.isArray(row.items)) throw new ApiError(502, "DEEL_G2N_INVALID", "Deel returned a gross-to-net record without item evidence.");
      for (const rawItem of row.items) {
        if (!rawItem || typeof rawItem !== "object") throw new ApiError(502, "DEEL_G2N_INVALID", "Deel returned an invalid gross-to-net item.");
        const item = rawItem as Record<string, unknown>;
        const group = typeof item.category_group === "string" && CATEGORY_GROUPS.includes(item.category_group as DeelCategoryGroup)
          ? item.category_group as DeelCategoryGroup : null;
        if (!group) throw new ApiError(502, "DEEL_CATEGORY_GROUP_INVALID", "Deel returned an unsupported payroll category group.");
        current[group] += deelMoneyToCents(item.value);
        if (!Number.isSafeInteger(current[group])) throw new ApiError(502, "DEEL_MONEY_INVALID", "Deel payroll totals exceeded the supported range.");
      }
      totals.set(currency, current);
      // contract_oid, item labels/categories/subcategories and payment_data are intentionally discarded here.
    }
    if (body.has_more !== true) {
      return [...totals.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([currency, categoryTotalsCents]) => ({
        currency, categoryTotalsCents, sourceCreatedAt, sourceUpdatedAt,
      }));
    }
    const next = typeof body.next_cursor === "string" && body.next_cursor ? body.next_cursor : null;
    if (!next || next === cursor) throw new ApiError(502, "DEEL_PAGINATION_INVALID", "Deel omitted or repeated the next gross-to-net cursor.");
    cursor = next;
  }
  throw new ApiError(502, "DEEL_PAGINATION_LIMIT", "Deel returned too many gross-to-net pages to process safely.");
}
