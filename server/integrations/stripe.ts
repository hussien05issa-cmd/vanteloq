import { and, eq } from "drizzle-orm";
import { getDb, getRuntimeEnv } from "../../db";
import { integrationConnections } from "../../db/schema";
import { ApiError } from "../api";

export const STRIPE_PROVIDER = "stripe";
const STRIPE_CONNECT_ORIGIN = "https://connect.stripe.com";
const STRIPE_API_ORIGIN = "https://api.stripe.com";
const ACCOUNT_ID = /^acct_[A-Za-z0-9]{8,64}$/;
const API_VERSION = /^20\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])\.[a-z]+$/;
const CURRENCY = /^[a-z]{3}$/;

type StripeConfig = {
  clientId: string;
  secretKey: string;
  redirectUri: string;
  webhookSecret: string;
  apiVersion: string | null;
};

export type StripeOAuthResponse = {
  stripe_user_id: string;
  scope?: string;
  livemode?: boolean;
  token_type?: string;
};

export type NormalizedStripeFinancialRecord = {
  externalRecordId: string;
  recordType: "balance_transaction" | "payout";
  category: string;
  sourceRef: string | null;
  occurredAt: string;
  availableAt: string | null;
  currency: string;
  grossCents: number;
  feeCents: number;
  netCents: number;
  state: string;
  livemode: boolean;
  sourcePayloadHash: string;
};

type StripeListResponse = {
  data?: unknown;
  has_more?: unknown;
};

export function stripeReadiness() {
  const env = getRuntimeEnv();
  const missing = [
    ["STRIPE_CLIENT_ID", env.STRIPE_CLIENT_ID],
    ["STRIPE_SECRET_KEY", env.STRIPE_SECRET_KEY],
    ["STRIPE_REDIRECT_URI", env.STRIPE_REDIRECT_URI],
    ["STRIPE_WEBHOOK_SECRET", env.STRIPE_WEBHOOK_SECRET],
  ].filter((entry) => !entry[1]).map((entry) => entry[0]);
  return {
    adapterBuilt: true,
    credentialsConfigured: missing.length === 0,
    missingConfiguration: missing,
    apiVersion: validApiVersion(env.STRIPE_API_VERSION) ?? "account_default",
    scopes: ["read_only"],
    mode: "read_only_staging" as const,
    dataPromotionEnabled: false,
  };
}

function config(): StripeConfig {
  const env = getRuntimeEnv();
  const readiness = stripeReadiness();
  if (!readiness.credentialsConfigured) {
    throw new ApiError(
      503,
      "STRIPE_CONFIGURATION_REQUIRED",
      "Stripe Connect credentials and a webhook signing secret must be configured before authorization can begin.",
    );
  }
  const clientId = env.STRIPE_CLIENT_ID!.trim();
  if (!clientId.startsWith("ca_") || clientId.length > 128) {
    throw new ApiError(503, "STRIPE_CLIENT_ID_INVALID", "The configured Stripe Connect client ID is invalid.");
  }
  const secretKey = env.STRIPE_SECRET_KEY!;
  if (!secretKey.startsWith("sk_") || secretKey.length > 256) {
    throw new ApiError(503, "STRIPE_SECRET_KEY_INVALID", "The configured Stripe platform secret key is invalid.");
  }
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET!;
  if (!webhookSecret.startsWith("whsec_") || webhookSecret.length > 256) {
    throw new ApiError(503, "STRIPE_WEBHOOK_SECRET_INVALID", "The configured Stripe webhook signing secret is invalid.");
  }
  const redirectUri = cleanHttpsUrl(env.STRIPE_REDIRECT_URI!, "STRIPE_REDIRECT_INVALID");
  return {
    clientId,
    secretKey,
    redirectUri,
    webhookSecret,
    apiVersion: validApiVersion(env.STRIPE_API_VERSION),
  };
}

function cleanHttpsUrl(value: string, code: string) {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new ApiError(503, code, "The configured Stripe callback URL is invalid.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) {
    throw new ApiError(503, code, "The configured Stripe callback URL must be a clean HTTPS URL.");
  }
  return parsed.toString();
}

function validApiVersion(value: string | undefined): string | null {
  const version = value?.trim();
  if (!version) return null;
  if (!API_VERSION.test(version)) {
    throw new ApiError(503, "STRIPE_API_VERSION_INVALID", "The configured Stripe API version is invalid.");
  }
  return version;
}

export function newStripeOAuthState() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return base64Url(bytes);
}

export function buildStripeAuthorizationUrl(state: string): string {
  if (state.length < 32 || state.length > 512) throw new Error("OAuth state must contain sufficient entropy.");
  const current = config();
  const url = new URL("/oauth/authorize", STRIPE_CONNECT_ORIGIN);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", current.clientId);
  url.searchParams.set("redirect_uri", current.redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeStripeAuthorizationCode(
  code: string,
  fetcher: typeof fetch = fetch,
): Promise<StripeOAuthResponse> {
  if (!code || code.length > 512) {
    throw new ApiError(400, "STRIPE_CALLBACK_INVALID", "Stripe returned an invalid authorization code.");
  }
  const current = config();
  const response = await fetcher(`${STRIPE_CONNECT_ORIGIN}/oauth/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${btoa(`${current.secretKey}:`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Vanteloq-Stripe-Connector/1.0",
    },
    body: new URLSearchParams({ code, grant_type: "authorization_code" }),
    signal: AbortSignal.timeout(12_000),
  });
  if (response.status === 429) {
    throw new ApiError(503, "STRIPE_RATE_LIMITED", "Stripe is rate-limiting authorization. Wait briefly, then start a new connection attempt.");
  }
  if (!response.ok) {
    throw new ApiError(502, "STRIPE_TOKEN_EXCHANGE_FAILED", "Stripe did not accept the authorization request. Start a new connection attempt.");
  }
  const body = await response.json() as Partial<StripeOAuthResponse>;
  if (typeof body.stripe_user_id !== "string" || !ACCOUNT_ID.test(body.stripe_user_id)) {
    throw new ApiError(502, "STRIPE_TOKEN_RESPONSE_INVALID", "Stripe returned an incomplete account authorization response.");
  }
  if (body.scope !== "read_only") {
    throw new ApiError(403, "STRIPE_SCOPE_NOT_READ_ONLY", "Stripe did not return the required read-only authorization. No account was connected.");
  }
  return body as StripeOAuthResponse;
}

export async function verifyStripeAccount(
  accountId: string,
  fetcher: typeof fetch = fetch,
): Promise<{ id: string; livemode: boolean }> {
  const body = await stripeRequest(accountId, "/v1/account", new URLSearchParams(), fetcher);
  const id = stringValue(body.id);
  if (id !== accountId) {
    throw new ApiError(502, "STRIPE_ACCOUNT_MISMATCH", "Stripe returned a different connected account than the one authorized.");
  }
  return { id, livemode: Boolean(body.livemode) };
}

export async function fetchStripeFinancialCollection(
  organizationId: string,
  resource: "balance_transactions" | "payouts",
  options: { after?: string | null; maxPages?: number; fetcher?: typeof fetch } = {},
): Promise<{ data: Record<string, unknown>[]; cursor: string | null; pages: number }> {
  const [connection] = await getDb().select({
    accountId: integrationConnections.externalAccountRef,
  }).from(integrationConnections).where(and(
    eq(integrationConnections.organizationId, organizationId),
    eq(integrationConnections.provider, STRIPE_PROVIDER),
    eq(integrationConnections.status, "connected"),
  )).limit(1);
  if (!connection?.accountId || !ACCOUNT_ID.test(connection.accountId)) {
    throw new ApiError(409, "STRIPE_NOT_CONNECTED", "Authorize and verify Stripe before accessing financial data.");
  }
  const fetcher = options.fetcher ?? fetch;
  const maximum = Math.min(Math.max(options.maxPages ?? 1, 1), 10);
  const data: Record<string, unknown>[] = [];
  let cursor = options.after ?? null;
  let pages = 0;
  while (pages < maximum) {
    const query = new URLSearchParams({ limit: "100" });
    if (cursor) query.set("starting_after", cursor);
    const body = await stripeRequest(connection.accountId, `/v1/${resource}`, query, fetcher) as StripeListResponse;
    if (!Array.isArray(body.data)) {
      throw new ApiError(502, "STRIPE_RESPONSE_INVALID", `Stripe returned an invalid ${resource} response.`);
    }
    const page = body.data.filter(isObject);
    data.push(...page);
    pages += 1;
    const lastId = page.length ? stringValue(page[page.length - 1].id) : "";
    if (body.has_more !== true || !lastId || lastId === cursor) break;
    cursor = lastId;
  }
  return { data, cursor, pages };
}

async function stripeRequest(
  accountId: string,
  path: string,
  query: URLSearchParams,
  fetcher: typeof fetch,
): Promise<Record<string, unknown>> {
  if (!ACCOUNT_ID.test(accountId)) throw new ApiError(400, "STRIPE_ACCOUNT_INVALID", "The Stripe account identifier is invalid.");
  const current = config();
  const url = new URL(path, STRIPE_API_ORIGIN);
  url.search = query.toString();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Basic ${btoa(`${current.secretKey}:`)}`,
      "Stripe-Account": accountId,
      "User-Agent": "Vanteloq-Stripe-Connector/1.0",
    };
    if (current.apiVersion) headers["Stripe-Version"] = current.apiVersion;
    const response = await fetcher(url, { headers, signal: AbortSignal.timeout(15_000) });
    if (response.ok) return await response.json() as Record<string, unknown>;
    if (response.status === 429) {
      throw new ApiError(503, "STRIPE_RATE_LIMITED", "Stripe reached its API rate limit. The staging cursor was preserved; retry after the provider window resets.");
    }
    if (response.status === 401 || response.status === 403) {
      throw new ApiError(409, "STRIPE_AUTHORIZATION_EXPIRED", "Stripe authorization is no longer valid. Reconnect the account.");
    }
    if (![500, 502, 503, 504].includes(response.status) || attempt === 1) {
      throw new ApiError(502, "STRIPE_PROVIDER_ERROR", "Stripe could not complete the read-only request. No staged data was promoted.");
    }
  }
  throw new ApiError(502, "STRIPE_PROVIDER_ERROR", "Stripe could not complete the read-only request.");
}

export async function normalizeStripeBalanceTransaction(
  input: Record<string, unknown>,
): Promise<NormalizedStripeFinancialRecord> {
  const externalRecordId = requiredId(input.id, "txn_");
  const currency = requiredCurrency(input.currency);
  const amount = requiredInteger(input.amount, "amount");
  const fee = requiredInteger(input.fee, "fee");
  const net = requiredInteger(input.net, "net");
  const occurredAt = unixIso(input.created, "created");
  const availableAt = unixIso(input.available_on, "available_on");
  const normalized = {
    externalRecordId,
    recordType: "balance_transaction" as const,
    category: stringValue(input.reporting_category) || stringValue(input.type) || "unknown",
    sourceRef: nullableId(input.source),
    occurredAt,
    availableAt,
    currency,
    grossCents: amount,
    feeCents: fee,
    netCents: net,
    state: stringValue(input.status) || "unknown",
    livemode: Boolean(input.livemode),
  };
  return { ...normalized, sourcePayloadHash: await sha256Hex(JSON.stringify(normalized)) };
}

export async function normalizeStripePayout(
  input: Record<string, unknown>,
): Promise<NormalizedStripeFinancialRecord> {
  const externalRecordId = requiredId(input.id, "po_");
  const amount = requiredInteger(input.amount, "amount");
  const normalized = {
    externalRecordId,
    recordType: "payout" as const,
    category: "payout",
    sourceRef: nullableId(input.balance_transaction),
    occurredAt: unixIso(input.created, "created"),
    availableAt: unixIso(input.arrival_date, "arrival_date"),
    currency: requiredCurrency(input.currency),
    grossCents: amount,
    feeCents: 0,
    netCents: amount,
    state: stringValue(input.status) || "unknown",
    livemode: Boolean(input.livemode),
  };
  return { ...normalized, sourcePayloadHash: await sha256Hex(JSON.stringify(normalized)) };
}

export async function verifyStripeWebhookSignature(
  body: Uint8Array,
  header: string | null,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<{ valid: boolean; signatureHash: string; timestamp: number | null }> {
  const parts = (header ?? "").split(",").map((part) => part.trim().split("=", 2));
  const timestampText = parts.find(([key]) => key === "t")?.[1] ?? "";
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value).filter(Boolean);
  const timestamp = /^\d{10}$/.test(timestampText) ? Number(timestampText) : null;
  const signatureHash = await sha256Hex(signatures.join(","));
  if (timestamp === null || !signatures.length || Math.abs(nowSeconds - timestamp) > 300) {
    return { valid: false, signatureHash, timestamp };
  }
  const signed = concatBytes(new TextEncoder().encode(`${timestamp}.`), body);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(config().webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, asArrayBuffer(signed)));
  const expected = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return {
    valid: signatures.some((signature) => constantTimeEqual(signature.toLowerCase(), expected)),
    signatureHash,
    timestamp,
  };
}

export async function revokeStripeConnection(accountId: string, fetcher: typeof fetch = fetch) {
  if (!ACCOUNT_ID.test(accountId)) return false;
  const current = config();
  const response = await fetcher(`${STRIPE_CONNECT_ORIGIN}/oauth/deauthorize`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${btoa(`${current.secretKey}:`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Vanteloq-Stripe-Connector/1.0",
    },
    body: new URLSearchParams({ client_id: current.clientId, stripe_user_id: accountId }),
    signal: AbortSignal.timeout(12_000),
  });
  return response.ok;
}

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", asArrayBuffer(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function requiredId(value: unknown, prefix: string) {
  const id = stringValue(value);
  if (!id.startsWith(prefix) || id.length > 128) throw new Error(`Stripe ${prefix} identifier is invalid.`);
  return id;
}

function nullableId(value: unknown) {
  const id = stringValue(value);
  return id && id.length <= 128 ? id : null;
}

function requiredCurrency(value: unknown) {
  const currency = stringValue(value).toLowerCase();
  if (!CURRENCY.test(currency)) throw new Error("Stripe currency is invalid.");
  return currency;
}

function requiredInteger(value: unknown, field: string) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number)) throw new Error(`Stripe ${field} is invalid.`);
  return number;
}

function unixIso(value: unknown, field: string) {
  const seconds = requiredInteger(value, field);
  if (seconds < 0 || seconds > 4_102_444_800) throw new Error(`Stripe ${field} is outside the supported range.`);
  return new Date(seconds * 1000).toISOString();
}

function stringValue(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function concatBytes(left: Uint8Array, right: Uint8Array) {
  const combined = new Uint8Array(left.byteLength + right.byteLength);
  combined.set(left, 0);
  combined.set(right, left.byteLength);
  return combined;
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

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
