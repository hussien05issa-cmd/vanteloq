import { and, eq } from "drizzle-orm";
import { businessDateForTimestamp } from "../../domain/intraday-sales";
import { getDb, getRuntimeEnv } from "../../db";
import { integrationSecrets } from "../../db/schema";
import { ApiError } from "../api";
import { cloverLineDiscountCents, cloverLineNetSalesCents, cloverLineQuantityMilli, cloverOrderReportingState, cloverPaymentDisposition } from "./clover-reporting";

export const CLOVER_PROVIDER = "clover";
export const CLOVER_READ_PERMISSIONS = ["merchant", "orders", "payments", "inventory", "customers"] as const;
const USER_AGENT = "Vanteloq-Clover-Connector/1.0";
const SECRET_AAD = "vanteloq:clover:v1";

type CloverEnvironment = "sandbox" | "production";
type CloverConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  encryptionKey: string;
  environment: CloverEnvironment;
  authOrigin: string;
  apiOrigin: string;
  webhookAuth: string | null;
};

export type CloverToken = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date | null;
};

export type CloverPaymentCategory = "cash" | "card" | "gift_card" | "store_credit" | "other";

export type NormalizedCloverSale = {
  externalSaleId: string;
  externalVersion: string;
  outletRef: string;
  soldAt: string | null;
  state: string;
  totalCents: number;
  taxCents: number;
  costCents: number;
  discountCents: number;
  lineCount: number;
  quantityMilli?: number | null;
  sourcePayloadHash: string;
};

export type NormalizedCloverSaleLine = {
  externalSaleId: string;
  externalLineId: string;
  productRef: string | null;
  customerRef: string | null;
  outletRef: string;
  soldAt: string | null;
  sku: string | null;
  productName: string | null;
  quantityMilli: number;
  netSalesCents: number;
  costCents: number;
  discountCents: number;
  sourcePayloadHash: string;
};

export type NormalizedCloverProduct = {
  externalProductId: string;
  sku: string;
  name: string;
  categoryRef: string | null;
  supplierRef: null;
  defaultCostCents: number | null;
  defaultPriceCents: number | null;
  archived: boolean;
  sourceUpdatedAt: string | null;
  sourcePayloadHash: string;
};

export type NormalizedCloverInventoryBalance = {
  externalItemId: string;
  outletRef: string;
  sku: string;
  name: string;
  onHandQuantity: number;
  reorderPoint: number;
};

export type NormalizedCloverCustomer = {
  externalCustomerId: string;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  archived: boolean;
  sourceUpdatedAt: string | null;
  sourcePayloadHash: string;
};

export type NormalizedCloverPayment = {
  externalPaymentId: string;
  externalSaleId: string;
  paymentTypeRef: string | null;
  paymentTypeName: string;
  category: CloverPaymentCategory;
  amountCents: number;
  paidAt: string | null;
  outletRef: string;
  sourcePayloadHash: string;
};

export type CloverDailyMetric = {
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

function environmentFrom(value: string | undefined): CloverEnvironment {
  return value?.trim().toLowerCase() === "production" ? "production" : "sandbox";
}

function origins(environment: CloverEnvironment) {
  return environment === "production"
    ? { authOrigin: "https://www.clover.com", apiOrigin: "https://api.clover.com" }
    : { authOrigin: "https://sandbox.dev.clover.com", apiOrigin: "https://apisandbox.dev.clover.com" };
}

export function cloverReadiness() {
  const env = getRuntimeEnv();
  const environment = environmentFrom(env.CLOVER_ENV);
  const missing = [
    ["CLOVER_CLIENT_ID", env.CLOVER_CLIENT_ID],
    ["CLOVER_CLIENT_SECRET", env.CLOVER_CLIENT_SECRET],
    ["CLOVER_REDIRECT_URI", env.CLOVER_REDIRECT_URI],
    ["INTEGRATION_ENCRYPTION_KEY", env.INTEGRATION_ENCRYPTION_KEY],
  ].filter(([, value]) => !value?.trim()).map(([name]) => name);
  return {
    adapterBuilt: true,
    credentialsConfigured: missing.length === 0,
    missingConfiguration: missing,
    environment,
    permissions: [...CLOVER_READ_PERMISSIONS],
    mode: "read_only_staged_sync" as const,
    webhookConfigured: Boolean(env.CLOVER_WEBHOOK_AUTH?.trim()),
    dataPromotionEnabled: false,
  };
}

function config(): CloverConfig {
  const env = getRuntimeEnv();
  const readiness = cloverReadiness();
  if (!readiness.credentialsConfigured) {
    throw new ApiError(503, "CLOVER_CONFIGURATION_REQUIRED", "Clover developer credentials must be configured before authorization can begin.");
  }
  const redirectUri = env.CLOVER_REDIRECT_URI!.trim();
  let parsed: URL;
  try { parsed = new URL(redirectUri); } catch {
    throw new ApiError(503, "CLOVER_REDIRECT_INVALID", "The configured Clover callback URL is invalid.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) {
    throw new ApiError(503, "CLOVER_REDIRECT_INVALID", "The Clover callback must be a clean HTTPS URL.");
  }
  const environment = readiness.environment;
  return {
    clientId: env.CLOVER_CLIENT_ID!.trim(),
    clientSecret: env.CLOVER_CLIENT_SECRET!,
    redirectUri,
    encryptionKey: env.INTEGRATION_ENCRYPTION_KEY!,
    environment,
    ...origins(environment),
    webhookAuth: env.CLOVER_WEBHOOK_AUTH?.trim() || null,
  };
}

export function newCloverState() {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function cloverSha256(value: string | Uint8Array) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function buildCloverAuthorizationUrl(state: string) {
  if (state.length < 8 || state.length > 512) throw new Error("OAuth state must contain between eight and 512 characters.");
  const current = config();
  const url = new URL("/oauth/v2/authorize", current.authOrigin);
  url.searchParams.set("client_id", current.clientId);
  url.searchParams.set("redirect_uri", current.redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

function expiration(value: unknown, fallbackSeconds: number) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    const milliseconds = numeric > 10_000_000_000 ? numeric : numeric * 1000;
    const result = new Date(milliseconds);
    if (!Number.isNaN(result.getTime())) return result;
  }
  return new Date(Date.now() + fallbackSeconds * 1000);
}

async function tokenRequest(path: "/oauth/v2/token" | "/oauth/v2/refresh", fields: Record<string, string>, fetcher: typeof fetch) {
  const current = config();
  const response = await fetcher(new URL(path, current.apiOrigin), {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify(fields),
    signal: AbortSignal.timeout(12_000),
  });
  if (response.status === 429) throw new ApiError(503, "CLOVER_RATE_LIMITED", "Clover is rate-limiting authorization. Wait, then retry.");
  if (!response.ok) throw new ApiError(502, "CLOVER_TOKEN_EXCHANGE_FAILED", "Clover did not accept the authorization request. Start a new connection attempt.");
  const body = await response.json() as Record<string, unknown>;
  const accessToken = stringValue(body.access_token);
  const refreshToken = stringValue(body.refresh_token);
  if (!accessToken || !refreshToken) throw new ApiError(502, "CLOVER_TOKEN_RESPONSE_INVALID", "Clover returned an incomplete OAuth token response.");
  return {
    accessToken,
    refreshToken,
    accessTokenExpiresAt: expiration(body.access_token_expiration, 1_800),
    refreshTokenExpiresAt: body.refresh_token_expiration == null ? null : expiration(body.refresh_token_expiration, 2_592_000),
  } satisfies CloverToken;
}

export function exchangeCloverCode(code: string, fetcher: typeof fetch = fetch) {
  if (!code || code.length > 4096) throw new ApiError(400, "CLOVER_CODE_INVALID", "Clover returned an invalid authorization code.");
  const current = config();
  return tokenRequest("/oauth/v2/token", { client_id: current.clientId, client_secret: current.clientSecret, code }, fetcher);
}

export function refreshCloverToken(refreshToken: string, fetcher: typeof fetch = fetch) {
  if (!refreshToken) throw new ApiError(409, "CLOVER_REFRESH_TOKEN_MISSING", "Reconnect Clover before synchronizing data.");
  return tokenRequest("/oauth/v2/refresh", { client_id: config().clientId, refresh_token: refreshToken }, fetcher);
}

async function cryptoKey(encoded: string) {
  let raw: Uint8Array;
  try { raw = fromBase64(encoded); } catch { throw new ApiError(503, "INTEGRATION_ENCRYPTION_KEY_INVALID", "The integration encryption key is invalid."); }
  if (raw.byteLength !== 32) throw new ApiError(503, "INTEGRATION_ENCRYPTION_KEY_INVALID", "The integration encryption key must decode to 32 bytes.");
  return crypto.subtle.importKey("raw", toArrayBuffer(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptCloverSecret(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(SECRET_AAD) },
    await cryptoKey(config().encryptionKey),
    new TextEncoder().encode(value),
  );
  return `v1.${base64Url(iv)}.${base64Url(new Uint8Array(ciphertext))}`;
}

export async function decryptCloverSecret(value: string) {
  const [version, encodedIv, encodedCiphertext] = value.split(".");
  if (version !== "v1" || !encodedIv || !encodedCiphertext) throw new ApiError(500, "INTEGRATION_SECRET_INVALID", "Stored Clover credentials could not be read.");
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(encodedIv), additionalData: new TextEncoder().encode(SECRET_AAD) },
      await cryptoKey(config().encryptionKey),
      toArrayBuffer(fromBase64(encodedCiphertext)),
    );
    return new TextDecoder().decode(plaintext);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, "INTEGRATION_SECRET_DECRYPTION_FAILED", "Stored Clover credentials could not be decrypted.");
  }
}

export async function saveCloverTokens(organizationId: string, connectionId: string, token: CloverToken) {
  const now = new Date();
  const access = await encryptCloverSecret(token.accessToken);
  const refresh = await encryptCloverSecret(token.refreshToken);
  await getDb().insert(integrationSecrets).values({
    id: crypto.randomUUID(), organizationId, provider: CLOVER_PROVIDER, connectionId,
    accessTokenCiphertext: access, refreshTokenCiphertext: refresh,
    tokenExpiresAt: token.accessTokenExpiresAt, createdAt: now, updatedAt: now,
  }).onConflictDoUpdate({
    target: integrationSecrets.connectionId,
    set: { accessTokenCiphertext: access, refreshTokenCiphertext: refresh, tokenExpiresAt: token.accessTokenExpiresAt, updatedAt: now },
  });
}

async function loadAccessToken(organizationId: string, connectionId: string, fetcher: typeof fetch) {
  const [row] = await getDb().select({
    access: integrationSecrets.accessTokenCiphertext,
    refresh: integrationSecrets.refreshTokenCiphertext,
    expires: integrationSecrets.tokenExpiresAt,
  }).from(integrationSecrets).where(and(
    eq(integrationSecrets.organizationId, organizationId),
    eq(integrationSecrets.provider, CLOVER_PROVIDER),
    eq(integrationSecrets.connectionId, connectionId),
  )).limit(1);
  if (!row) throw new ApiError(409, "CLOVER_NOT_CONNECTED", "Authorize a Clover merchant before accessing its data.");
  if (row.expires.getTime() > Date.now() + 60_000) return decryptCloverSecret(row.access);
  const token = await refreshCloverToken(await decryptCloverSecret(row.refresh), fetcher);
  await saveCloverTokens(organizationId, connectionId, token);
  return token.accessToken;
}

async function providerGet(url: URL, accessToken: string, fetcher: typeof fetch) {
  if (url.origin !== config().apiOrigin) throw new ApiError(502, "CLOVER_PAGINATION_INVALID", "Clover returned an unsafe pagination URL.");
  const response = await fetcher(url, {
    headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}`, "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 429) throw new ApiError(503, "CLOVER_RATE_LIMITED", "Clover reached its merchant rate limit. The staging cursor is preserved; retry later.");
  if (response.status === 401 || response.status === 403) throw new ApiError(409, "CLOVER_AUTHORIZATION_EXPIRED", "Clover authorization is no longer valid. Reconnect the merchant.");
  if (!response.ok) throw new ApiError(502, "CLOVER_PROVIDER_ERROR", "Clover could not complete the read-only request. No staged data was promoted.");
  return response;
}

export async function fetchCloverMerchant(organizationId: string, connectionId: string, merchantId: string, fetcher: typeof fetch = fetch) {
  validateMerchantId(merchantId);
  const token = await loadAccessToken(organizationId, connectionId, fetcher);
  const response = await providerGet(new URL(`/v3/merchants/${encodeURIComponent(merchantId)}?expand=address`, config().apiOrigin), token, fetcher);
  const body = await response.json() as Record<string, unknown>;
  if (stringValue(body.id) !== merchantId) throw new ApiError(502, "CLOVER_MERCHANT_MISMATCH", "Clover returned a different merchant than the authorized account.");
  return body;
}

export async function fetchCloverCollection(
  merchantId: string,
  accessToken: string,
  path: string,
  query: Record<string, string | number | null | undefined> = {},
  fetcher: typeof fetch = fetch,
) {
  validateMerchantId(merchantId);
  const expectedPrefix = `/v3/merchants/${merchantId}/`;
  if (!path.startsWith(expectedPrefix) || path.includes("..")) throw new ApiError(400, "CLOVER_RESOURCE_INVALID", "The requested Clover resource is invalid.");
  const url = new URL(path, config().apiOrigin);
  for (const [key, value] of Object.entries(query)) if (value != null) url.searchParams.set(key, String(value));
  const response = await providerGet(url, accessToken, fetcher);
  const body = await response.json() as Record<string, unknown>;
  return { elements: records(body.elements), href: limitedText(body.href, 2048) };
}

export async function fetchCloverConnectionCollection(
  organizationId: string,
  connectionId: string,
  merchantId: string,
  resource: "orders" | "payments" | "items" | "customers",
  query: Record<string, string | number | null | undefined> = {},
  fetcher: typeof fetch = fetch,
) {
  const token = await loadAccessToken(organizationId, connectionId, fetcher);
  return fetchCloverCollection(merchantId, token, `/v3/merchants/${merchantId}/${resource}`, query, fetcher);
}

export async function normalizeCloverOrder(merchantId: string, order: Record<string, unknown>) {
  validateMerchantId(merchantId);
  const externalSaleId = limitedText(order.id, 120);
  if (!externalSaleId) throw new Error("Clover order ID is missing.");
  const soldAt = timestamp(order.clientCreatedTime ?? order.createdTime);
  const customerRef = limitedText(firstRecord(objectValue(order.customers).elements).id, 120);
  const lineItems = records(objectValue(order.lineItems).elements);
  const state = cloverOrderReportingState(order);
  const lines = await Promise.all(lineItems.map(async (line, index) => {
    const quantityMilli = cloverLineQuantityMilli(line);
    const discounts = cloverLineDiscountCents(line);
    const item = objectValue(line.item);
    const normalized = {
      externalSaleId,
      externalLineId: limitedText(line.id, 120) || `${externalSaleId}:${index}`,
      productRef: limitedText(item.id, 120),
      customerRef,
      outletRef: merchantId,
      soldAt: timestamp(line.orderClientCreatedTime ?? line.createdTime) ?? soldAt,
      sku: limitedText(line.itemCode, 160),
      productName: limitedText(line.name, 240),
      quantityMilli,
      netSalesCents: cloverLineNetSalesCents(line, quantityMilli, discounts),
      costCents: 0,
      discountCents: discounts,
    };
    return { ...normalized, sourcePayloadHash: await cloverSha256(JSON.stringify(normalized)) } satisfies NormalizedCloverSaleLine;
  }));
  const saleBase = {
    externalSaleId,
    externalVersion: stringValue(order.modifiedTime ?? order.createdTime) || "0",
    outletRef: merchantId,
    soldAt,
    state,
    totalCents: cents(order.total),
    taxCents: cents(order.taxAmount ?? order.tax),
    costCents: lines.reduce((sum, line) => sum + line.costCents, 0),
    discountCents: lines.reduce((sum, line) => sum + line.discountCents, 0),
    lineCount: lines.length,
    quantityMilli: lines.reduce((sum, line) => sum + line.quantityMilli, 0),
  };
  return {
    sale: { ...saleBase, sourcePayloadHash: await cloverSha256(JSON.stringify(saleBase)) } satisfies NormalizedCloverSale,
    lines,
  };
}

export async function normalizeCloverInventoryItem(merchantId: string, item: Record<string, unknown>) {
  validateMerchantId(merchantId);
  const externalProductId = limitedText(item.id, 120);
  if (!externalProductId) throw new Error("Clover item ID is missing.");
  const sku = limitedText(item.sku ?? item.code, 160) || externalProductId;
  const name = limitedText(item.name, 240) || `Clover item ${externalProductId}`;
  const categories = records(objectValue(item.categories).elements);
  const productBase = {
    externalProductId,
    sku,
    name,
    categoryRef: limitedText(categories[0]?.id, 120),
    supplierRef: null,
    defaultCostCents: item.cost == null ? null : cents(item.cost),
    defaultPriceCents: item.price == null ? null : cents(item.price),
    archived: item.hidden === true || item.available === false,
    sourceUpdatedAt: timestamp(item.modifiedTime),
  };
  const stock = objectValue(item.itemStock);
  const quantity = finiteNumber(stock.quantity ?? item.quantity);
  return {
    product: { ...productBase, sourcePayloadHash: await cloverSha256(JSON.stringify(productBase)) } satisfies NormalizedCloverProduct,
    balance: {
      externalItemId: externalProductId,
      outletRef: merchantId,
      sku,
      name,
      onHandQuantity: Math.round(quantity ?? 0),
      reorderPoint: Math.max(0, Math.round(finiteNumber(stock.reorderPoint) ?? 0)),
    } satisfies NormalizedCloverInventoryBalance,
  };
}

export async function normalizeCloverCustomer(customer: Record<string, unknown>): Promise<NormalizedCloverCustomer> {
  const externalCustomerId = limitedText(customer.id, 120);
  if (!externalCustomerId) throw new Error("Clover customer ID is missing.");
  const firstName = limitedText(customer.firstName, 120);
  const lastName = limitedText(customer.lastName, 120);
  const email = limitedText(firstRecord(objectValue(customer.emailAddresses).elements).emailAddress, 254);
  const phone = limitedText(firstRecord(objectValue(customer.phoneNumbers).elements).phoneNumber, 64);
  const normalized = {
    externalCustomerId,
    displayName: [firstName, lastName].filter(Boolean).join(" ") || `Customer ${externalCustomerId}`,
    firstName,
    lastName,
    email,
    phone,
    archived: false,
    sourceUpdatedAt: timestamp(customer.modifiedTime),
  };
  return { ...normalized, sourcePayloadHash: await cloverSha256(JSON.stringify(normalized)) };
}

function paymentCategory(name: string): CloverPaymentCategory {
  const normalized = name.toLowerCase();
  if (/\bcash\b/.test(normalized)) return "cash";
  if (/gift|voucher/.test(normalized)) return "gift_card";
  if (/store\s*credit|account\s*credit/.test(normalized)) return "store_credit";
  if (/card|visa|mastercard|master card|amex|debit|interac|discover/.test(normalized)) return "card";
  return "other";
}

export async function normalizeCloverPayments(merchantId: string, values: Record<string, unknown>[]) {
  validateMerchantId(merchantId);
  const posted = values.filter((payment) => cloverPaymentDisposition(payment) === "posted");
  return Promise.all(posted.map(async (payment, index) => {
    const externalSaleId = limitedText(objectValue(payment.order).id, 120);
    if (!externalSaleId) throw new Error("Clover payment order ID is missing.");
    const tender = objectValue(payment.tender);
    const paymentTypeName = limitedText(tender.label, 120) || "Other";
    const normalized = {
      externalPaymentId: limitedText(payment.id, 120) || `${externalSaleId}:${index}`,
      externalSaleId,
      paymentTypeRef: limitedText(tender.id, 120),
      paymentTypeName,
      category: paymentCategory(paymentTypeName),
      amountCents: cents(payment.amount),
      paidAt: timestamp(payment.createdTime),
      outletRef: merchantId,
    };
    return { ...normalized, sourcePayloadHash: await cloverSha256(JSON.stringify(normalized)) } satisfies NormalizedCloverPayment;
  }));
}

export function buildCloverDailyMetrics(
  sales: NormalizedCloverSale[],
  namespace = "legacy",
  timeZone = "UTC",
): CloverDailyMetric[] {
  const grouped = new Map<string, CloverDailyMetric>();
  for (const sale of sales) {
    if (!sale.soldAt || sale.state !== "completed") continue;
    const quantityMilli = sale.quantityMilli;
    if (typeof quantityMilli !== "number" || !Number.isSafeInteger(quantityMilli) || quantityMilli < 0) {
      throw new ApiError(409, "CLOVER_QUANTITY_EVIDENCE_REQUIRED", "Clover sale quantities need complete source lines before reporting.");
    }
    const businessDate = businessDateForTimestamp(sale.soldAt, timeZone);
    if (!businessDate) continue;
    const scopedMerchant = namespace === "legacy" ? sale.outletRef : `${namespace}:${sale.outletRef}`;
    const locationRef = `${CLOVER_PROVIDER}:${scopedMerchant}`;
    const key = `${businessDate}:${locationRef}`;
    const row = grouped.get(key) ?? {
      businessDate, locationRef, grossSalesCents: 0, netSalesCents: 0,
      costOfGoodsCents: 0, transactionCount: 0, unitsSold: 0,
      refundsCents: 0, discountsCents: 0,
    };
    const netSalesCents = Math.max(0, sale.totalCents - sale.taxCents);
    row.grossSalesCents += Math.max(0, netSalesCents + sale.discountCents);
    row.netSalesCents += netSalesCents;
    row.costOfGoodsCents += Math.max(0, sale.costCents);
    row.transactionCount += 1;
    const dailyQuantityMilli = Math.round(row.unitsSold * 1000) + quantityMilli;
    if (!Number.isSafeInteger(dailyQuantityMilli)) {
      throw new ApiError(409, "CLOVER_QUANTITY_EVIDENCE_REQUIRED", "Clover daily quantity exceeds supported precision.");
    }
    row.unitsSold = dailyQuantityMilli / 1000;
    row.discountsCents += Math.max(0, sale.discountCents);
    grouped.set(key, row);
  }
  return [...grouped.values()].sort((left, right) =>
    left.businessDate.localeCompare(right.businessDate) || left.locationRef.localeCompare(right.locationRef));
}

export function verifyCloverWebhookAuth(value: string | null) {
  const expected = getRuntimeEnv().CLOVER_WEBHOOK_AUTH?.trim();
  return Boolean(expected && value && constantTimeTextEqual(value, expected));
}

function constantTimeTextEqual(value: string, expected: string) {
  const left = new TextEncoder().encode(expected);
  const right = new TextEncoder().encode(value);
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left[index] ^ right[index];
  return mismatch === 0;
}

export function verifyCloverWebhookAppId(value: unknown) {
  const expected = getRuntimeEnv().CLOVER_CLIENT_ID?.trim() ?? "";
  return Boolean(expected && typeof value === "string" && constantTimeTextEqual(value, expected));
}

function validateMerchantId(value: string) {
  if (!/^[A-Za-z0-9_-]{4,128}$/.test(value)) throw new ApiError(400, "CLOVER_MERCHANT_INVALID", "The Clover merchant identifier is invalid.");
}
function records(value: unknown): Record<string, unknown>[] { return Array.isArray(value) ? value.filter(isRecord) : isRecord(value) ? [value] : []; }
function firstRecord(value: unknown) { return records(value)[0] ?? {}; }
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function objectValue(value: unknown): Record<string, unknown> { return isRecord(value) ? value : {}; }
function stringValue(value: unknown) { return typeof value === "string" || typeof value === "number" ? String(value) : ""; }
function limitedText(value: unknown, maximum: number) { const text = stringValue(value).trim(); return text ? text.slice(0, maximum) : null; }
function finiteNumber(value: unknown) { const result = typeof value === "number" ? value : Number(value); return Number.isFinite(result) ? result : null; }
function finiteInteger(value: unknown) { const result = finiteNumber(value); return result == null ? null : Math.round(result); }
function cents(value: unknown) { return finiteInteger(value) ?? 0; }
function timestamp(value: unknown) { const numeric = finiteNumber(value); if (numeric == null || numeric <= 0) return null; const date = new Date(numeric > 10_000_000_000 ? numeric : numeric * 1000); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
function toArrayBuffer(bytes: Uint8Array) { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer; }
function base64(bytes: Uint8Array) { let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }
function base64Url(bytes: Uint8Array) { return base64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""); }
function fromBase64(value: string) { const normalized = value.replaceAll("-", "+").replaceAll("_", "/"); const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")); return Uint8Array.from(binary, (character) => character.charCodeAt(0)); }
