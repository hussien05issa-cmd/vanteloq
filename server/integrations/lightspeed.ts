import { and, eq } from "drizzle-orm";
import { getDb, getRuntimeEnv } from "../../db";
import {
  integrationConnections,
  integrationSecrets,
} from "../../db/schema";
import { ApiError } from "../api";

export const LIGHTSPEED_PROVIDER = "lightspeed";
export const LIGHTSPEED_SCOPES = ["outlets:read", "sales:read"] as const;
const DOMAIN_PREFIX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const API_VERSION = /^20\d{2}-(?:0[1-9]|1[0-2])$/;

export type LightspeedTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires?: number;
  expires_in?: number;
  domain_prefix?: string;
  scope?: string;
  token_type?: string;
};

export type NormalizedLightspeedSale = {
  externalSaleId: string;
  externalVersion: string;
  outletRef: string | null;
  soldAt: string | null;
  state: string;
  totalCents: number;
  taxCents: number;
  costCents: number;
  discountCents: number;
  lineCount: number;
  sourcePayloadHash: string;
};

type LightspeedConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  apiVersion: string;
  encryptionKey: string;
};

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

export function lightspeedReadiness() {
  const env = getRuntimeEnv();
  const clientId = env.LIGHTSPEED_X_CLIENT_ID || env.LIGHTSPEED_CLIENT_ID;
  const clientSecret = env.LIGHTSPEED_X_CLIENT_SECRET || env.LIGHTSPEED_CLIENT_SECRET;
  const redirectUri = env.LIGHTSPEED_X_REDIRECT_URI || env.LIGHTSPEED_REDIRECT_URI;
  const encryptionKey = env.LIGHTSPEED_X_TOKEN_ENCRYPTION_KEY || env.INTEGRATION_ENCRYPTION_KEY;
  const missing = [
    ["LIGHTSPEED_X_CLIENT_ID", clientId],
    ["LIGHTSPEED_X_CLIENT_SECRET", clientSecret],
    ["LIGHTSPEED_X_REDIRECT_URI", redirectUri],
    ["LIGHTSPEED_X_TOKEN_ENCRYPTION_KEY", encryptionKey],
  ].filter((entry) => !entry[1]).map((entry) => entry[0]);
  return {
    adapterBuilt: true,
    credentialsConfigured: missing.length === 0,
    missingConfiguration: missing,
    apiVersion: validApiVersion(env.LIGHTSPEED_X_API_VERSION || env.LIGHTSPEED_API_VERSION),
    scopes: [...LIGHTSPEED_SCOPES],
    mode: "read_only_staging" as const,
    dataPromotionEnabled: false,
  };
}

function config(): LightspeedConfig {
  const env = getRuntimeEnv();
  const readiness = lightspeedReadiness();
  if (!readiness.credentialsConfigured) {
    throw new ApiError(
      503,
      "LIGHTSPEED_CONFIGURATION_REQUIRED",
      "Lightspeed developer credentials must be configured before authorization can begin.",
    );
  }
  const redirectUri = (env.LIGHTSPEED_X_REDIRECT_URI || env.LIGHTSPEED_REDIRECT_URI)!.trim();
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    throw new ApiError(503, "LIGHTSPEED_REDIRECT_INVALID", "The configured Lightspeed callback URL is invalid.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) {
    throw new ApiError(503, "LIGHTSPEED_REDIRECT_INVALID", "The configured Lightspeed callback URL must be a clean HTTPS URL.");
  }
  return {
    clientId: (env.LIGHTSPEED_X_CLIENT_ID || env.LIGHTSPEED_CLIENT_ID)!.trim(),
    clientSecret: (env.LIGHTSPEED_X_CLIENT_SECRET || env.LIGHTSPEED_CLIENT_SECRET)!,
    redirectUri,
    apiVersion: readiness.apiVersion,
    encryptionKey: (env.LIGHTSPEED_X_TOKEN_ENCRYPTION_KEY || env.INTEGRATION_ENCRYPTION_KEY)!,
  };
}

function validApiVersion(value: string | undefined) {
  const version = value?.trim() || "2026-07";
  return API_VERSION.test(version) ? version : "2026-07";
}

export function validateDomainPrefix(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!DOMAIN_PREFIX.test(normalized)) {
    throw new ApiError(400, "LIGHTSPEED_DOMAIN_INVALID", "Lightspeed returned an invalid retailer domain.");
  }
  return normalized;
}

export function newOAuthState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return base64Url(bytes);
}

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", asArrayBuffer(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function buildLightspeedAuthorizationUrl(state: string): string {
  if (state.length < 8) throw new Error("OAuth state must contain at least eight characters.");
  const current = config();
  const url = new URL("https://secure.retail.lightspeed.app/connect");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", current.clientId);
  url.searchParams.set("redirect_uri", current.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", LIGHTSPEED_SCOPES.join(" "));
  return url.toString();
}

export async function exchangeAuthorizationCode(
  code: string,
  domainPrefix: string,
  fetcher: typeof fetch = fetch,
): Promise<LightspeedTokenResponse> {
  const current = config();
  return tokenRequest(
    validateDomainPrefix(domainPrefix),
    {
      code,
      client_id: current.clientId,
      client_secret: current.clientSecret,
      grant_type: "authorization_code",
      redirect_uri: current.redirectUri,
    },
    fetcher,
  );
}

async function tokenRequest(
  domainPrefix: string,
  fields: Record<string, string>,
  fetcher: typeof fetch,
): Promise<LightspeedTokenResponse> {
  const response = await fetcher(
    `https://${validateDomainPrefix(domainPrefix)}.retail.lightspeed.app/api/1.0/token`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Vanteloq-Lightspeed-Connector/1.0",
      },
      body: new URLSearchParams(fields),
      signal: AbortSignal.timeout(12_000),
    },
  );
  if (response.status === 429) {
    throw new ApiError(503, "LIGHTSPEED_RATE_LIMITED", "Lightspeed is rate-limiting authorization. Wait for the provider window to reset, then retry.");
  }
  if (!response.ok) {
    throw new ApiError(502, "LIGHTSPEED_TOKEN_EXCHANGE_FAILED", "Lightspeed did not accept the authorization request. Start a new connection attempt.");
  }
  const body = await response.json() as Partial<LightspeedTokenResponse>;
  if (
    typeof body.access_token !== "string" || !body.access_token ||
    typeof body.refresh_token !== "string" || !body.refresh_token
  ) {
    throw new ApiError(502, "LIGHTSPEED_TOKEN_RESPONSE_INVALID", "Lightspeed returned an incomplete token response.");
  }
  return body as LightspeedTokenResponse;
}

export function tokenExpiry(token: LightspeedTokenResponse): Date {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const absolute = Number(token.expires);
  const relative = Number(token.expires_in);
  const seconds = Number.isFinite(absolute) && absolute > nowSeconds
    ? absolute
    : nowSeconds + (Number.isFinite(relative) && relative > 0 ? relative : 86_400);
  return new Date(seconds * 1000);
}

async function encryptionCryptoKey(encoded: string): Promise<CryptoKey> {
  let raw: Uint8Array;
  try {
    raw = fromBase64(encoded);
  } catch {
    throw new ApiError(503, "INTEGRATION_ENCRYPTION_KEY_INVALID", "The integration encryption key is invalid.");
  }
  if (raw.byteLength !== 32) {
    throw new ApiError(503, "INTEGRATION_ENCRYPTION_KEY_INVALID", "The integration encryption key must decode to 32 bytes.");
  }
  return crypto.subtle.importKey("raw", asArrayBuffer(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptIntegrationSecret(value: string): Promise<string> {
  const current = config();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionCryptoKey(current.encryptionKey);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode("vanteloq:lightspeed:v1") },
    key,
    new TextEncoder().encode(value),
  );
  return `v1.${base64Url(iv)}.${base64Url(new Uint8Array(ciphertext))}`;
}

export async function decryptIntegrationSecret(value: string): Promise<string> {
  const [version, encodedIv, encodedCiphertext] = value.split(".");
  if (version !== "v1" || !encodedIv || !encodedCiphertext) {
    throw new ApiError(500, "INTEGRATION_SECRET_INVALID", "Stored integration credentials could not be read.");
  }
  try {
    const key = await encryptionCryptoKey(config().encryptionKey);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(encodedIv), additionalData: new TextEncoder().encode("vanteloq:lightspeed:v1") },
      key,
      fromBase64(encodedCiphertext),
    );
    return new TextDecoder().decode(plaintext);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, "INTEGRATION_SECRET_DECRYPTION_FAILED", "Stored integration credentials could not be decrypted.");
  }
}

export async function loadValidAccessToken(
  organizationId: string,
  connectionId: string,
  fetcher: typeof fetch = fetch,
): Promise<{ accessToken: string; domainPrefix: string; apiVersion: string }> {
  const db = getDb();
  const [row] = await db
    .select({
      domainPrefix: integrationConnections.domainPrefix,
      apiVersion: integrationConnections.apiVersion,
      accessTokenCiphertext: integrationSecrets.accessTokenCiphertext,
      refreshTokenCiphertext: integrationSecrets.refreshTokenCiphertext,
      tokenExpiresAt: integrationSecrets.tokenExpiresAt,
    })
    .from(integrationConnections)
    .innerJoin(
      integrationSecrets,
      and(
        eq(integrationSecrets.connectionId, integrationConnections.id),
        eq(integrationSecrets.organizationId, integrationConnections.organizationId),
        eq(integrationSecrets.provider, integrationConnections.provider),
      ),
    )
    .where(
      and(
        eq(integrationConnections.organizationId, organizationId),
        eq(integrationConnections.provider, LIGHTSPEED_PROVIDER),
        eq(integrationConnections.id, connectionId),
      ),
    )
    .limit(1);
  if (!row?.domainPrefix) {
    throw new ApiError(409, "LIGHTSPEED_NOT_CONNECTED", "Authorize Lightspeed before accessing retailer data.");
  }
  const domainPrefix = validateDomainPrefix(row.domainPrefix);
  if (row.tokenExpiresAt.getTime() > Date.now() + 30_000) {
    return {
      accessToken: await decryptIntegrationSecret(row.accessTokenCiphertext),
      domainPrefix,
      apiVersion: validApiVersion(row.apiVersion ?? undefined),
    };
  }

  const current = config();
  const refreshToken = await decryptIntegrationSecret(row.refreshTokenCiphertext);
  const token = await tokenRequest(
    domainPrefix,
    {
      refresh_token: refreshToken,
      client_id: current.clientId,
      client_secret: current.clientSecret,
      grant_type: "refresh_token",
    },
    fetcher,
  );
  await db
    .update(integrationSecrets)
    .set({
      accessTokenCiphertext: await encryptIntegrationSecret(token.access_token),
      refreshTokenCiphertext: await encryptIntegrationSecret(token.refresh_token),
      tokenExpiresAt: tokenExpiry(token),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(integrationSecrets.organizationId, organizationId),
        eq(integrationSecrets.provider, LIGHTSPEED_PROVIDER),
        eq(integrationSecrets.connectionId, connectionId),
      ),
    );
  return {
    accessToken: token.access_token,
    domainPrefix,
    apiVersion: validApiVersion(row.apiVersion ?? undefined),
  };
}

export async function fetchLightspeedCollection(
  organizationId: string,
  connectionId: string,
  resource: "outlets" | "sales",
  options: { after?: string | null; maxPages?: number; fetcher?: typeof fetch } = {},
): Promise<{ data: Record<string, unknown>[]; cursor: string | null; pages: number }> {
  const fetcher = options.fetcher ?? fetch;
  const authorization = await loadValidAccessToken(organizationId, connectionId, fetcher);
  const data: Record<string, unknown>[] = [];
  let after = options.after ?? null;
  let pages = 0;
  const maximum = Math.min(Math.max(options.maxPages ?? 1, 1), 10);
  while (pages < maximum) {
    const url = new URL(
      `https://${authorization.domainPrefix}.retail.lightspeed.app/api/${authorization.apiVersion}/${resource}`,
    );
    url.searchParams.set("page_size", "100");
    if (after) url.searchParams.set("after", after);
    const response = await providerFetch(url, authorization.accessToken, fetcher);
    const body = await response.json() as { data?: unknown; version?: { max?: unknown } };
    if (!Array.isArray(body.data)) {
      throw new ApiError(502, "LIGHTSPEED_RESPONSE_INVALID", `Lightspeed returned an invalid ${resource} response.`);
    }
    pages += 1;
    const page = body.data.filter(
      (item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item),
    );
    data.push(...page);
    const cursor = body.version?.max;
    if (!page.length || (typeof cursor !== "number" && typeof cursor !== "string")) break;
    const next = String(cursor);
    if (next === after) break;
    after = next;
  }
  return { data, cursor: after, pages };
}

async function providerFetch(url: URL, accessToken: string, fetcher: typeof fetch) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetcher(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "Vanteloq-Lightspeed-Connector/1.0",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) return response;
    if (response.status === 429) {
      throw new ApiError(503, "LIGHTSPEED_RATE_LIMITED", "Lightspeed reached its retailer rate limit. The staging cursor is preserved; retry after the provider window resets.");
    }
    if (response.status === 401 || response.status === 403) {
      throw new ApiError(409, "LIGHTSPEED_AUTHORIZATION_EXPIRED", "Lightspeed authorization is no longer valid. Reconnect the retailer account.");
    }
    if (![502, 503, 504].includes(response.status) || attempt === 1) {
      throw new ApiError(502, "LIGHTSPEED_PROVIDER_ERROR", "Lightspeed could not complete the read-only request. No staged data was promoted.");
    }
  }
  throw new ApiError(502, "LIGHTSPEED_PROVIDER_ERROR", "Lightspeed could not complete the read-only request.");
}

export async function normalizeLightspeedSale(
  sale: Record<string, unknown>,
): Promise<NormalizedLightspeedSale> {
  const externalSaleId = stringValue(sale.id);
  if (!externalSaleId) throw new Error("Sale ID is missing.");
  const metadata = objectValue(sale._metadata);
  const source = objectValue(sale.source);
  const totals = objectValue(sale.totals);
  const lines = Array.isArray(sale.line_items)
    ? sale.line_items.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item))
    : [];
  const externalVersion = stringValue(metadata.version) || stringValue(sale.version) || "0";
  const totalCents = firstMoney(
    totals.price,
    totals.total_price,
    totals.total,
    sale.total_price,
    sale.total,
    sale.total_incl,
  );
  const taxCents = firstMoney(totals.tax, totals.total_tax, sale.total_tax, sale.tax);
  const lineDiscountCents = lines.reduce((sum, line) => {
    const pricing = objectValue(line.pricing);
    const quantity = finiteNumber(line.quantity, 0);
    return sum + (moneyCents(pricing.discount_total) ?? Math.round(moneyNumber(pricing.discount) * quantity * 100));
  }, 0);
  const discountCents = firstMoneyOrNull(
    totals.discount,
    totals.total_discount,
    sale.total_discount,
    sale.discount,
  ) ?? lineDiscountCents;
  const costCents = lines.reduce((sum, line) => {
    const pricing = objectValue(line.pricing);
    const quantity = finiteNumber(line.quantity, 0);
    return sum + (moneyCents(pricing.cost_total) ?? Math.round(moneyNumber(pricing.cost) * quantity * 100));
  }, 0);
  const normalized = {
    externalSaleId,
    externalVersion,
    outletRef:
      stringValue(sale.outlet_id) ||
      stringValue(source.outlet_id) ||
      stringValue(source.register_id) ||
      null,
    soldAt: stringValue(sale.date) || stringValue(sale.created_at) || null,
    state: stringValue(sale.state) || "unknown",
    totalCents,
    taxCents,
    costCents,
    discountCents,
    lineCount: lines.length,
  };
  return {
    ...normalized,
    sourcePayloadHash: await sha256Hex(JSON.stringify(normalized)),
  };
}

export async function verifyLightspeedWebhookSignature(
  body: Uint8Array,
  header: string | null,
): Promise<{ valid: boolean; signatureHash: string }> {
  const signature = header
    ?.split(",")
    .map((part) => part.trim().split("="))
    .find(([key]) => key.toLowerCase() === "signature")?.[1] ?? "";
  const algorithm = header
    ?.split(",")
    .map((part) => part.trim().split("="))
    .find(([key]) => key.toLowerCase() === "algorithm")?.[1]?.toUpperCase() ?? "";
  if (!signature || algorithm !== "HMAC-SHA256") return { valid: false, signatureHash: await sha256Hex(signature) };
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(config().clientSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, asArrayBuffer(body)));
  const expectedHex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const expectedBase64 = base64(digest);
  const valid = constantTimeEqual(signature.toLowerCase(), expectedHex) || constantTimeEqual(signature, expectedBase64);
  return { valid, signatureHash: await sha256Hex(signature) };
}

function constantTimeEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let mismatch = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return mismatch === 0;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function finiteNumber(value: unknown, fallback: number) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function moneyNumber(value: unknown) {
  return finiteNumber(value, 0);
}

function firstMoney(...values: unknown[]) {
  return firstMoneyOrNull(...values) ?? 0;
}

function firstMoneyOrNull(...values: unknown[]) {
  for (const value of values) {
    const cents = moneyCents(value);
    if (cents !== null) return cents;
  }
  return null;
}

function moneyCents(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) : null;
}

function base64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64Url(bytes: Uint8Array) {
  return base64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
