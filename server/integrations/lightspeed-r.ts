import { and, eq } from "drizzle-orm";
import { getDb, getRuntimeEnv } from "../../db";
import { integrationSecrets } from "../../db/schema";
import { ApiError } from "../api";

export const LIGHTSPEED_R_PROVIDER = "lightspeed-r";
export const LIGHTSPEED_R_SCOPES = ["employee:register_read", "employee:inventory_read"] as const;
const API_ORIGIN = "https://api.lightspeedapp.com";
const AUTH_ORIGIN = "https://cloud.lightspeedapp.com";

export type LightspeedRTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
};

export type NormalizedLightspeedRSale = {
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

export type NormalizedLightspeedRInventoryBalance = {
  externalItemId: string;
  outletRef: string;
  sku: string;
  name: string;
  onHandQuantity: number;
  reorderPoint: number;
};

export type LightspeedRDailyMetric = {
  businessDate: string;
  locationRef: string;
  grossSalesCents: number;
  netSalesCents: number;
  costOfGoodsCents: number;
  transactionCount: number;
  unitsSold: number;
  refundsCents: number;
  discountsCents: number;
};

export type LightspeedRLiveSale = Pick<
  NormalizedLightspeedRSale,
  | "externalSaleId"
  | "outletRef"
  | "soldAt"
  | "state"
  | "totalCents"
  | "taxCents"
  | "costCents"
  | "discountCents"
  | "lineCount"
>;

export type LightspeedRLiveSalesSnapshot = {
  businessDate: string;
  netSalesCents: number;
  grossProfitCents: number;
  averageTransactionCents: number | null;
  transactionCount: number;
  unitsSold: number;
  refundsCents: number;
  discountsCents: number;
  lastSaleAt: string | null;
  hourly: Array<{
    hour: number;
    label: string;
    netSalesCents: number;
    grossProfitCents: number;
    transactionCount: number;
  }>;
};

type Config = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  encryptionKey: string;
};

export function lightspeedRReadiness() {
  const env = getRuntimeEnv();
  const missing = [
    ["LIGHTSPEED_R_CLIENT_ID", env.LIGHTSPEED_R_CLIENT_ID],
    ["LIGHTSPEED_R_CLIENT_SECRET", env.LIGHTSPEED_R_CLIENT_SECRET],
    ["LIGHTSPEED_R_REDIRECT_URI", env.LIGHTSPEED_R_REDIRECT_URI],
    ["INTEGRATION_ENCRYPTION_KEY", env.INTEGRATION_ENCRYPTION_KEY],
  ].filter((entry) => !entry[1]).map((entry) => entry[0]);
  return {
    adapterBuilt: true,
    credentialsConfigured: missing.length === 0,
    missingConfiguration: missing,
    apiVersion: "V3",
    scopes: [...LIGHTSPEED_R_SCOPES],
    mode: "read_only_live_sync" as const,
    dataPromotionEnabled: true,
  };
}

function config(): Config {
  const env = getRuntimeEnv();
  const readiness = lightspeedRReadiness();
  if (!readiness.credentialsConfigured) {
    throw new ApiError(503, "LIGHTSPEED_R_CONFIGURATION_REQUIRED", "R-Series developer credentials must be configured before authorization can begin.");
  }
  const redirectUri = env.LIGHTSPEED_R_REDIRECT_URI!.trim();
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    throw new ApiError(503, "LIGHTSPEED_R_REDIRECT_INVALID", "The configured R-Series callback URL is invalid.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) {
    throw new ApiError(503, "LIGHTSPEED_R_REDIRECT_INVALID", "The R-Series callback must be a clean HTTPS URL.");
  }
  return {
    clientId: env.LIGHTSPEED_R_CLIENT_ID!.trim(),
    clientSecret: env.LIGHTSPEED_R_CLIENT_SECRET!,
    redirectUri,
    encryptionKey: env.INTEGRATION_ENCRYPTION_KEY!,
  };
}

export function newLightspeedRState() {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function lightspeedRSha256(value: string | Uint8Array) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function buildLightspeedRAuthorizationUrl(state: string) {
  if (state.length < 8) throw new Error("OAuth state must contain at least eight characters.");
  const current = config();
  const url = new URL("/auth/oauth/authorize", AUTH_ORIGIN);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", current.clientId);
  url.searchParams.set("scope", LIGHTSPEED_R_SCOPES.join(" "));
  url.searchParams.set("state", state);
  return url.toString();
}

async function tokenRequest(fields: Record<string, string>, fetcher: typeof fetch) {
  const response = await fetcher(new URL("/auth/oauth/token", AUTH_ORIGIN), {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "Vanteloq-R-Series-Connector/1.0" },
    body: JSON.stringify(fields),
    signal: AbortSignal.timeout(12_000),
  });
  if (response.status === 429) throw new ApiError(503, "LIGHTSPEED_R_RATE_LIMITED", "R-Series is rate-limiting authorization. Wait, then retry.");
  if (!response.ok) throw new ApiError(502, "LIGHTSPEED_R_TOKEN_EXCHANGE_FAILED", "R-Series did not accept the authorization request. Start a new connection attempt.");
  const body = await response.json() as Partial<LightspeedRTokenResponse>;
  if (!body.access_token || !body.refresh_token) throw new ApiError(502, "LIGHTSPEED_R_TOKEN_RESPONSE_INVALID", "R-Series returned an incomplete token response.");
  return body as LightspeedRTokenResponse;
}

export function exchangeLightspeedRCode(code: string, fetcher: typeof fetch = fetch) {
  const current = config();
  return tokenRequest({ client_id: current.clientId, client_secret: current.clientSecret, grant_type: "authorization_code", code }, fetcher);
}

function tokenExpiry(token: LightspeedRTokenResponse) {
  const seconds = Number(token.expires_in);
  return new Date(Date.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds : 3600) * 1000);
}

async function cryptoKey(encoded: string) {
  let raw: Uint8Array;
  try { raw = fromBase64(encoded); } catch { throw new ApiError(503, "INTEGRATION_ENCRYPTION_KEY_INVALID", "The integration encryption key is invalid."); }
  if (raw.byteLength !== 32) throw new ApiError(503, "INTEGRATION_ENCRYPTION_KEY_INVALID", "The integration encryption key must decode to 32 bytes.");
  return crypto.subtle.importKey("raw", toArrayBuffer(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptLightspeedRSecret(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode("vanteloq:lightspeed-r:v1") },
    await cryptoKey(config().encryptionKey),
    new TextEncoder().encode(value),
  );
  return `v1.${base64Url(iv)}.${base64Url(new Uint8Array(ciphertext))}`;
}

export async function decryptLightspeedRSecret(value: string) {
  const [version, encodedIv, encodedCiphertext] = value.split(".");
  if (version !== "v1" || !encodedIv || !encodedCiphertext) throw new ApiError(500, "INTEGRATION_SECRET_INVALID", "Stored R-Series credentials could not be read.");
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(encodedIv), additionalData: new TextEncoder().encode("vanteloq:lightspeed-r:v1") },
      await cryptoKey(config().encryptionKey),
      toArrayBuffer(fromBase64(encodedCiphertext)),
    );
    return new TextDecoder().decode(plaintext);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, "INTEGRATION_SECRET_DECRYPTION_FAILED", "Stored R-Series credentials could not be decrypted.");
  }
}

export async function saveLightspeedRTokens(organizationId: string, token: LightspeedRTokenResponse) {
  const now = new Date();
  await getDb().insert(integrationSecrets).values({
    id: crypto.randomUUID(), organizationId, provider: LIGHTSPEED_R_PROVIDER,
    accessTokenCiphertext: await encryptLightspeedRSecret(token.access_token),
    refreshTokenCiphertext: await encryptLightspeedRSecret(token.refresh_token),
    tokenExpiresAt: tokenExpiry(token), createdAt: now, updatedAt: now,
  }).onConflictDoUpdate({
    target: [integrationSecrets.organizationId, integrationSecrets.provider],
    set: {
      accessTokenCiphertext: await encryptLightspeedRSecret(token.access_token),
      refreshTokenCiphertext: await encryptLightspeedRSecret(token.refresh_token),
      tokenExpiresAt: tokenExpiry(token), updatedAt: now,
    },
  });
}

async function loadAccessToken(organizationId: string, fetcher: typeof fetch) {
  const [row] = await getDb().select({
    access: integrationSecrets.accessTokenCiphertext,
    refresh: integrationSecrets.refreshTokenCiphertext,
    expires: integrationSecrets.tokenExpiresAt,
  }).from(integrationSecrets).where(and(
    eq(integrationSecrets.organizationId, organizationId),
    eq(integrationSecrets.provider, LIGHTSPEED_R_PROVIDER),
  )).limit(1);
  if (!row) throw new ApiError(409, "LIGHTSPEED_R_NOT_CONNECTED", "Authorize an R-Series account before accessing its data.");
  if (row.expires.getTime() > Date.now() + 30_000) return decryptLightspeedRSecret(row.access);
  const current = config();
  const token = await tokenRequest({
    client_id: current.clientId, client_secret: current.clientSecret,
    grant_type: "refresh_token", refresh_token: await decryptLightspeedRSecret(row.refresh),
  }, fetcher);
  await saveLightspeedRTokens(organizationId, token);
  return token.access_token;
}

async function providerGet(url: URL, accessToken: string, fetcher: typeof fetch) {
  if (url.origin !== API_ORIGIN) throw new ApiError(502, "LIGHTSPEED_R_PAGINATION_INVALID", "R-Series returned an unsafe pagination URL.");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetcher(url, {
      headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}`, "User-Agent": "Vanteloq-R-Series-Connector/1.0" },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) return response;
    if (response.status === 429) throw new ApiError(503, "LIGHTSPEED_R_RATE_LIMITED", "R-Series reached its account rate limit. The staging cursor is preserved; retry later.");
    if (response.status === 401 || response.status === 403) throw new ApiError(409, "LIGHTSPEED_R_AUTHORIZATION_EXPIRED", "R-Series authorization is no longer valid. Reconnect the account.");
    if (![502, 503, 504].includes(response.status) || attempt === 1) throw new ApiError(502, "LIGHTSPEED_R_PROVIDER_ERROR", "R-Series could not complete the read-only request. No staged data was promoted.");
  }
  throw new ApiError(502, "LIGHTSPEED_R_PROVIDER_ERROR", "R-Series could not complete the read-only request.");
}

export async function fetchLightspeedRAccount(organizationId: string, fetcher: typeof fetch = fetch) {
  const token = await loadAccessToken(organizationId, fetcher);
  const response = await providerGet(new URL("/API/V3/Account.json", API_ORIGIN), token, fetcher);
  const body = await response.json() as Record<string, unknown>;
  const account = firstRecord(body.Account);
  const accountId = stringValue(account.accountID);
  if (!accountId || !/^\d+$/.test(accountId)) throw new ApiError(502, "LIGHTSPEED_R_ACCOUNT_INVALID", "R-Series returned an invalid account identifier.");
  return { accountId, name: stringValue(account.name) || "R-Series account" };
}

export async function fetchLightspeedRCollection(
  organizationId: string,
  accountId: string,
  resource: "Shop" | "Sale" | "Item",
  options: {
    maxPages?: number;
    fetcher?: typeof fetch;
    modifiedSince?: string | null;
    cursor?: string | null;
  } = {},
) {
  if (!/^\d+$/.test(accountId)) throw new ApiError(400, "LIGHTSPEED_R_ACCOUNT_INVALID", "The R-Series account identifier is invalid.");
  const fetcher = options.fetcher ?? fetch;
  const token = await loadAccessToken(organizationId, fetcher);
  const basePath = `/API/V3/Account/${accountId}/${resource}.json`;
  let url = new URL(basePath, API_ORIGIN);
  if (options.cursor) {
    try { url = new URL(options.cursor); } catch {
      throw new ApiError(502, "LIGHTSPEED_R_PAGINATION_INVALID", "The saved R-Series pagination cursor is invalid.");
    }
  } else {
    url.searchParams.set("limit", "100");
    if (options.modifiedSince) url.searchParams.set("timeStamp", `>,${options.modifiedSince}`);
  }
  const data: Record<string, unknown>[] = [];
  let pages = 0;
  const maximum = Math.min(Math.max(options.maxPages ?? 1, 1), 10);
  let cursor: string | null = null;
  while (pages < maximum) {
    if (url.origin !== API_ORIGIN || url.pathname !== basePath) {
      throw new ApiError(502, "LIGHTSPEED_R_PAGINATION_INVALID", "R-Series returned an unsafe pagination URL.");
    }
    const response = await providerGet(url, token, fetcher);
    const body = await response.json() as Record<string, unknown>;
    data.push(...records(body[resource]));
    pages += 1;
    const attributes = objectValue(body["@attributes"]);
    const next = stringValue(attributes.next);
    if (!next) {
      cursor = null;
      break;
    }
    url = new URL(next, API_ORIGIN);
    cursor = url.toString();
  }
  return { data, pages, cursor };
}

export async function normalizeLightspeedRSale(sale: Record<string, unknown>): Promise<NormalizedLightspeedRSale> {
  const externalSaleId = stringValue(sale.saleID);
  if (!externalSaleId) throw new Error("Sale ID is missing.");
  const lines = records(objectValue(sale.SaleLines).SaleLine);
  const completed = truthy(sale.completed);
  const voided = truthy(sale.voided);
  const normalized = {
    externalSaleId,
    externalVersion: stringValue(sale.timeStamp) || stringValue(sale.updatetime) || "0",
    outletRef: stringValue(sale.shopID) || null,
    soldAt: stringValue(sale.completeTime) || stringValue(sale.timeStamp) || null,
    state: voided ? "voided" : completed ? "completed" : "open",
    totalCents: money(sale.total ?? sale.calcTotal),
    taxCents: money(sale.taxTotal) || money(Number(sale.calcTax1 || 0) + Number(sale.calcTax2 || 0)),
    costCents: money(sale.calcFIFOCost ?? sale.calcAvgCost),
    discountCents: money(sale.calcDiscount),
    lineCount: lines.length,
  };
  return { ...normalized, sourcePayloadHash: await lightspeedRSha256(JSON.stringify(normalized)) };
}

export function normalizeLightspeedRInventoryItem(
  item: Record<string, unknown>,
): NormalizedLightspeedRInventoryBalance[] {
  const externalItemId = stringValue(item.itemID);
  if (!externalItemId) throw new Error("Item ID is missing.");
  const sku = (
    stringValue(item.customSku) ||
    stringValue(item.upc) ||
    stringValue(item.ean) ||
    externalItemId
  ).trim().slice(0, 160);
  const name = (stringValue(item.description) || `R-Series item ${externalItemId}`).trim().slice(0, 240);
  const container = objectValue(item.ItemShops ?? item.Shops);
  const shops = records(container.ItemShop ?? container.Shop);
  const embedded = shops.length ? shops : stringValue(item.shopID) ? [item] : [];
  return embedded.map((shop) => {
    const outletRef = stringValue(shop.shopID);
    const quantity = finiteNumber(shop.qoh ?? shop.quantityOnHand ?? shop.onHand);
    const reorder = finiteNumber(shop.reorderPoint);
    if (!outletRef || quantity === null) throw new Error("Item shop inventory is incomplete.");
    return {
      externalItemId,
      outletRef,
      sku,
      name,
      onHandQuantity: Math.round(quantity),
      reorderPoint: Math.max(0, Math.round(reorder ?? 0)),
    };
  });
}

export function buildLightspeedRDailyMetrics(
  sales: Array<Pick<NormalizedLightspeedRSale, "externalSaleId" | "outletRef" | "soldAt" | "state" | "totalCents" | "taxCents" | "costCents" | "discountCents" | "lineCount">>,
): LightspeedRDailyMetric[] {
  const totals = new Map<string, LightspeedRDailyMetric & { positiveNetCents: number; returnedCostCents: number }>();
  for (const sale of sales) {
    if (sale.state !== "completed" || !sale.outletRef || !sale.soldAt) continue;
    const businessDate = sale.soldAt.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) continue;
    const locationRef = `${LIGHTSPEED_R_PROVIDER}:${sale.outletRef}`;
    const key = `${businessDate}\u0000${locationRef}`;
    const row = totals.get(key) ?? {
      businessDate,
      locationRef,
      grossSalesCents: 0,
      netSalesCents: 0,
      costOfGoodsCents: 0,
      transactionCount: 0,
      unitsSold: 0,
      refundsCents: 0,
      discountsCents: 0,
      positiveNetCents: 0,
      returnedCostCents: 0,
    };
    const preTaxCents = sale.totalCents - sale.taxCents;
    if (preTaxCents < 0) {
      row.refundsCents += Math.abs(preTaxCents);
      row.returnedCostCents += Math.abs(sale.costCents);
    } else {
      const discountCents = Math.abs(sale.discountCents);
      row.positiveNetCents += preTaxCents;
      row.grossSalesCents += preTaxCents + discountCents;
      row.costOfGoodsCents += Math.max(0, sale.costCents);
      row.discountsCents += discountCents;
      row.transactionCount += 1;
      row.unitsSold += Math.max(0, sale.lineCount);
    }
    totals.set(key, row);
  }
  return [...totals.values()].map(({ positiveNetCents, returnedCostCents, ...row }) => ({
    ...row,
    netSalesCents: Math.max(0, positiveNetCents - row.refundsCents),
    costOfGoodsCents: Math.max(0, row.costOfGoodsCents - returnedCostCents),
  })).sort((left, right) => left.businessDate.localeCompare(right.businessDate) || left.locationRef.localeCompare(right.locationRef));
}

function localDateParts(value: string | Date, timeZone: string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  const hour = Number(get("hour"));
  if (!year || !month || !day || !Number.isInteger(hour)) return null;
  return { businessDate: `${year}-${month}-${day}`, hour };
}

function saleLocalParts(value: string, timeZone: string) {
  // Lightspeed may return a local timestamp without an offset. Preserve those
  // wall-clock values instead of incorrectly treating them as UTC.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) {
    return { businessDate: value.slice(0, 10), hour: Number(value.slice(11, 13)) };
  }
  return localDateParts(value, timeZone);
}

export function buildLightspeedRLiveSalesSnapshot(
  sales: LightspeedRLiveSale[],
  timeZone: string,
  now = new Date(),
): LightspeedRLiveSalesSnapshot {
  const today = localDateParts(now, timeZone)?.businessDate ?? now.toISOString().slice(0, 10);
  const hourly = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: new Intl.DateTimeFormat("en-CA", {
      hour: "numeric",
      hour12: true,
      timeZone: "UTC",
    }).format(new Date(Date.UTC(2020, 0, 1, hour))),
    netSalesCents: 0,
    grossProfitCents: 0,
    transactionCount: 0,
  }));
  let positiveNetCents = 0;
  let refundsCents = 0;
  let costOfGoodsCents = 0;
  let returnedCostCents = 0;
  let discountsCents = 0;
  let transactionCount = 0;
  let unitsSold = 0;
  let lastSaleAt: string | null = null;

  for (const sale of sales) {
    if (sale.state !== "completed" || !sale.soldAt) continue;
    const local = saleLocalParts(sale.soldAt, timeZone);
    if (!local || local.businessDate !== today || local.hour < 0 || local.hour > 23) continue;
    const preTaxCents = sale.totalCents - sale.taxCents;
    if (preTaxCents < 0) {
      refundsCents += Math.abs(preTaxCents);
      returnedCostCents += Math.abs(sale.costCents);
      hourly[local.hour].netSalesCents -= Math.abs(preTaxCents);
      hourly[local.hour].grossProfitCents -= Math.max(0, Math.abs(preTaxCents) - Math.abs(sale.costCents));
    } else {
      positiveNetCents += preTaxCents;
      costOfGoodsCents += Math.max(0, sale.costCents);
      discountsCents += Math.abs(sale.discountCents);
      transactionCount += 1;
      unitsSold += Math.max(0, sale.lineCount);
      hourly[local.hour].netSalesCents += preTaxCents;
      hourly[local.hour].grossProfitCents += Math.max(0, preTaxCents - Math.max(0, sale.costCents));
      hourly[local.hour].transactionCount += 1;
    }
    if (!lastSaleAt || sale.soldAt > lastSaleAt) lastSaleAt = sale.soldAt;
  }

  const netSalesCents = Math.max(0, positiveNetCents - refundsCents);
  const grossProfitCents = Math.max(0, netSalesCents - Math.max(0, costOfGoodsCents - returnedCostCents));
  return {
    businessDate: today,
    netSalesCents,
    grossProfitCents,
    averageTransactionCents: transactionCount ? Math.round(netSalesCents / transactionCount) : null,
    transactionCount,
    unitsSold,
    refundsCents,
    discountsCents,
    lastSaleAt,
    hourly,
  };
}

function records(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  return isRecord(value) ? [value] : [];
}
function firstRecord(value: unknown) { return records(value)[0] ?? {}; }
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function objectValue(value: unknown): Record<string, unknown> { return isRecord(value) ? value : {}; }
function stringValue(value: unknown) { return typeof value === "string" || typeof value === "number" ? String(value) : ""; }
function truthy(value: unknown) { return value === true || value === "true" || value === 1 || value === "1"; }
function money(value: unknown) { const number = typeof value === "number" ? value : Number(value); return Number.isFinite(number) ? Math.round(number * 100) : 0; }
function finiteNumber(value: unknown) { const number = typeof value === "number" ? value : Number(value); return Number.isFinite(number) ? number : null; }
function toArrayBuffer(bytes: Uint8Array) { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer; }
function base64(bytes: Uint8Array) { let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }
function base64Url(bytes: Uint8Array) { return base64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""); }
function fromBase64(value: string) { const normalized = value.replaceAll("-", "+").replaceAll("_", "/"); const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")); return Uint8Array.from(binary, (character) => character.charCodeAt(0)); }
