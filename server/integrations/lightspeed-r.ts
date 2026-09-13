import { and, eq } from "drizzle-orm";
import { getDb, getRuntimeEnv } from "../../db";
import { integrationSecrets } from "../../db/schema";
import { ApiError } from "../api";
import { businessDateForTimestamp, salesDay } from "../../domain/intraday-sales";

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

export type NormalizedLightspeedRProduct = {
  externalProductId: string;
  sku: string;
  name: string;
  categoryRef: string | null;
  categoryName?: string | null;
  supplierRef: string | null;
  defaultCostCents: number | null;
  defaultPriceCents: number | null;
  archived: boolean;
  sourceUpdatedAt: string | null;
  sourcePayloadHash: string;
};

export type NormalizedLightspeedRCustomer = {
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

export type NormalizedLightspeedRSupplier = {
  externalSupplierId: string;
  name: string;
  accountNumber: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  archived: boolean;
  sourceUpdatedAt: string | null;
  sourcePayloadHash: string;
};

export type NormalizedLightspeedRSaleLine = {
  externalSaleId: string;
  externalLineId: string;
  productRef: string | null;
  customerRef: string | null;
  outletRef: string | null;
  soldAt: string | null;
  sku: string | null;
  productName: string | null;
  quantityMilli: number;
  netSalesCents: number;
  costCents: number;
  discountCents: number;
  sourcePayloadHash: string;
};

export type LightspeedRPaymentCategory = "cash" | "card" | "gift_card" | "store_credit" | "other";

export type NormalizedLightspeedRPayment = {
  externalPaymentId: string;
  externalSaleId: string;
  paymentTypeRef: string | null;
  paymentTypeName: string;
  category: LightspeedRPaymentCategory;
  amountCents: number;
  paidAt: string | null;
  outletRef: string | null;
  sourcePayloadHash: string;
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
  grossProfitCents: number | null;
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
    grossProfitCents: number | null;
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
    dataPromotionEnabled: false,
  };
}

export function lightspeedRCheckpointReadyForApproval(value: string | null) {
  if (!value) return false;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (parsed.version !== 5 || typeof parsed.watermark !== "string" || Number.isNaN(Date.parse(parsed.watermark))) {
      return false;
    }
    const cursorKeys = ["salesCursor", "saleLinesCursor", "itemsCursor", "customersCursor", "suppliersCursor"];
    const completionKeys = ["salesComplete", "saleLinesComplete", "itemsComplete", "customersComplete", "suppliersComplete"];
    return cursorKeys.every((key) => parsed[key] === null)
      && completionKeys.every((key) => parsed[key] === false);
  } catch {
    return false;
  }
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

export async function saveLightspeedRTokens(organizationId: string, connectionId: string, token: LightspeedRTokenResponse) {
  const now = new Date();
  await getDb().insert(integrationSecrets).values({
    id: crypto.randomUUID(), organizationId, provider: LIGHTSPEED_R_PROVIDER, connectionId,
    accessTokenCiphertext: await encryptLightspeedRSecret(token.access_token),
    refreshTokenCiphertext: await encryptLightspeedRSecret(token.refresh_token),
    tokenExpiresAt: tokenExpiry(token), createdAt: now, updatedAt: now,
  }).onConflictDoUpdate({
    target: integrationSecrets.connectionId,
    set: {
      accessTokenCiphertext: await encryptLightspeedRSecret(token.access_token),
      refreshTokenCiphertext: await encryptLightspeedRSecret(token.refresh_token),
      tokenExpiresAt: tokenExpiry(token), updatedAt: now,
    },
  });
}

async function loadAccessToken(organizationId: string, connectionId: string, fetcher: typeof fetch) {
  const [row] = await getDb().select({
    access: integrationSecrets.accessTokenCiphertext,
    refresh: integrationSecrets.refreshTokenCiphertext,
    expires: integrationSecrets.tokenExpiresAt,
  }).from(integrationSecrets).where(and(
    eq(integrationSecrets.organizationId, organizationId),
    eq(integrationSecrets.provider, LIGHTSPEED_R_PROVIDER),
    eq(integrationSecrets.connectionId, connectionId),
  )).limit(1);
  if (!row) throw new ApiError(409, "LIGHTSPEED_R_NOT_CONNECTED", "Authorize an R-Series account before accessing its data.");
  if (row.expires.getTime() > Date.now() + 30_000) return decryptLightspeedRSecret(row.access);
  const current = config();
  const token = await tokenRequest({
    client_id: current.clientId, client_secret: current.clientSecret,
    grant_type: "refresh_token", refresh_token: await decryptLightspeedRSecret(row.refresh),
  }, fetcher);
  await saveLightspeedRTokens(organizationId, connectionId, token);
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

export async function fetchLightspeedRAccount(organizationId: string, connectionId: string, fetcher: typeof fetch = fetch) {
  const token = await loadAccessToken(organizationId, connectionId, fetcher);
  const response = await providerGet(new URL("/API/V3/Account.json", API_ORIGIN), token, fetcher);
  const body = await response.json() as Record<string, unknown>;
  const account = firstRecord(body.Account);
  const accountId = stringValue(account.accountID);
  if (!accountId || !/^\d+$/.test(accountId)) throw new ApiError(502, "LIGHTSPEED_R_ACCOUNT_INVALID", "R-Series returned an invalid account identifier.");
  return { accountId, name: stringValue(account.name) || "R-Series account" };
}

export async function fetchLightspeedRCollection(
  organizationId: string,
  connectionId: string,
  accountId: string,
  resource: "Shop" | "Sale" | "SaleLine" | "SalePayment" | "PaymentType" | "Item" | "Customer" | "Vendor" | "Order" | "OrderLine",
  options: {
    maxPages?: number;
    fetcher?: typeof fetch;
    modifiedSince?: string | null;
    cursor?: string | null;
    loadRelations?: string[];
  } = {},
) {
  if (!/^\d+$/.test(accountId)) throw new ApiError(400, "LIGHTSPEED_R_ACCOUNT_INVALID", "The R-Series account identifier is invalid.");
  const fetcher = options.fetcher ?? fetch;
  const token = await loadAccessToken(organizationId, connectionId, fetcher);
  const basePath = `/API/V3/Account/${accountId}/${resource}.json`;
  let url = new URL(basePath, API_ORIGIN);
  if (options.cursor) {
    try { url = new URL(options.cursor); } catch {
      throw new ApiError(502, "LIGHTSPEED_R_PAGINATION_INVALID", "The saved R-Series pagination cursor is invalid.");
    }
  } else {
    url.searchParams.set("limit", "100");
    if (options.modifiedSince) url.searchParams.set("timeStamp", `>,${options.modifiedSince}`);
    if (resource === "Item") url.searchParams.set("archived", "false");
    if (options.loadRelations?.length) {
      url.searchParams.set("load_relations", JSON.stringify(options.loadRelations));
    }
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

function limitedText(value: unknown, maximum: number) {
  const text = stringValue(value).trim();
  return text ? text.slice(0, maximum) : null;
}

function firstPrice(item: Record<string, unknown>) {
  const prices = records(objectValue(item.Prices).ItemPrice);
  const preferred = prices.find((price) => stringValue(price.useType).toLowerCase() === "default") ?? prices[0];
  return preferred ? money(preferred.amount) : null;
}

export async function normalizeLightspeedRProduct(item: Record<string, unknown>): Promise<NormalizedLightspeedRProduct> {
  const externalProductId = stringValue(item.itemID);
  if (!externalProductId) throw new Error("Item ID is missing.");
  const normalized = {
    externalProductId,
    sku: (limitedText(item.customSku, 160) || limitedText(item.upc, 160) || limitedText(item.ean, 160) || externalProductId),
    name: limitedText(item.description, 240) || `R-Series item ${externalProductId}`,
    categoryRef: limitedText(item.categoryID, 120),
    categoryName: limitedText(objectValue(item.Category).fullPathName, 240) || limitedText(objectValue(item.Category).name, 240),
    supplierRef: limitedText(item.defaultVendorID, 120),
    defaultCostCents: item.defaultCost == null ? null : money(item.defaultCost),
    defaultPriceCents: firstPrice(item),
    archived: truthy(item.archived),
    sourceUpdatedAt: limitedText(item.timeStamp ?? item.updatetime, 80),
  };
  return { ...normalized, sourcePayloadHash: await lightspeedRSha256(JSON.stringify(normalized)) };
}

export async function normalizeLightspeedRCustomer(customer: Record<string, unknown>): Promise<NormalizedLightspeedRCustomer> {
  const externalCustomerId = stringValue(customer.customerID);
  if (!externalCustomerId) throw new Error("Customer ID is missing.");
  const contact = objectValue(customer.Contact);
  const firstName = limitedText(customer.firstName, 120);
  const lastName = limitedText(customer.lastName, 120);
  const normalized = {
    externalCustomerId,
    displayName: limitedText(customer.company, 240) || [firstName, lastName].filter(Boolean).join(" ") || `Customer ${externalCustomerId}`,
    firstName,
    lastName,
    email: limitedText(contact.email ?? customer.email, 254),
    phone: limitedText(contact.phone ?? customer.phone, 64),
    archived: truthy(customer.archived),
    sourceUpdatedAt: limitedText(customer.timeStamp ?? customer.updatetime, 80),
  };
  return { ...normalized, sourcePayloadHash: await lightspeedRSha256(JSON.stringify(normalized)) };
}

export async function normalizeLightspeedRSupplier(vendor: Record<string, unknown>): Promise<NormalizedLightspeedRSupplier> {
  const externalSupplierId = stringValue(vendor.vendorID);
  if (!externalSupplierId) throw new Error("Vendor ID is missing.");
  const contact = objectValue(vendor.Contact);
  const firstName = limitedText(contact.firstName ?? vendor.firstName, 120);
  const lastName = limitedText(contact.lastName ?? vendor.lastName, 120);
  const normalized = {
    externalSupplierId,
    name: limitedText(vendor.name, 240) || `Supplier ${externalSupplierId}`,
    accountNumber: limitedText(vendor.accountNumber, 120),
    contactName: [firstName, lastName].filter(Boolean).join(" ") || null,
    email: limitedText(contact.email ?? vendor.email, 254),
    phone: limitedText(contact.phone ?? vendor.phone, 64),
    archived: truthy(vendor.archived),
    sourceUpdatedAt: limitedText(vendor.timeStamp ?? vendor.updatetime, 80),
  };
  return { ...normalized, sourcePayloadHash: await lightspeedRSha256(JSON.stringify(normalized)) };
}

// R-Series calcSubtotal is BEFORE line and transaction discounts. calcTotal
// includes tax. Keep both ingestion paths on the same pre-tax net definition.
// Reference: https://developers.lightspeedhq.com/retail/endpoints/SaleLine/
function saleLineEconomics(line: Record<string, unknown>, quantity: number) {
  const discount = line.calcLineDiscount != null || line.calcTransactionDiscount != null
    ? (finiteNumber(line.calcLineDiscount) ?? 0) + (finiteNumber(line.calcTransactionDiscount) ?? 0)
    : finiteNumber(line.calcDiscount) ?? 0;
  const subtotal = line.calcSubtotal == null ? null : finiteNumber(line.calcSubtotal);
  const total = line.calcTotal == null ? null : finiteNumber(line.calcTotal);
  const net = subtotal != null ? subtotal - discount : total != null
    ? total - (finiteNumber(line.calcTax1) ?? 0) - (finiteNumber(line.calcTax2) ?? 0)
    : (finiteNumber(line.unitPrice) ?? 0) * quantity - discount;
  return {
    netSalesCents: money(net),
    costCents: money(line.calcFIFOCost ?? line.calcAvgCost ?? Number(line.fifoCost ?? line.avgCost ?? 0) * quantity),
    discountCents: Math.abs(money(discount)),
  };
}

export async function normalizeLightspeedRSaleLines(sale: Record<string, unknown>): Promise<NormalizedLightspeedRSaleLine[]> {
  const externalSaleId = stringValue(sale.saleID);
  if (!externalSaleId) throw new Error("Sale ID is missing.");
  const outletRef = limitedText(sale.shopID, 120);
  const customerRef = limitedText(sale.customerID, 120);
  const soldAt = limitedText(sale.completeTime ?? sale.timeStamp, 80);
  const lines = records(objectValue(sale.SaleLines).SaleLine);
  return Promise.all(lines.map(async (line, index) => {
    const externalLineId = stringValue(line.saleLineID) || `${externalSaleId}:${index}`;
    const quantity = finiteNumber(line.unitQuantity ?? line.quantity) ?? 0;
    const item = objectValue(line.Item);
    const normalized = {
      externalSaleId,
      externalLineId,
      productRef: limitedText(line.itemID ?? item.itemID, 120),
      customerRef,
      outletRef,
      soldAt,
      sku: limitedText(line.customSku ?? line.upc ?? item.customSku ?? item.upc, 160),
      productName: limitedText(line.description ?? item.description, 240),
      quantityMilli: Math.round(quantity * 1000),
      ...saleLineEconomics(line, quantity),
    };
    return { ...normalized, sourcePayloadHash: await lightspeedRSha256(JSON.stringify(normalized)) };
  }));
}

export async function normalizeLightspeedRSaleLine(line: Record<string, unknown>): Promise<NormalizedLightspeedRSaleLine> {
  const externalSaleId = stringValue(line.saleID);
  const externalLineId = stringValue(line.saleLineID);
  if (!externalSaleId || !externalLineId) throw new Error("Sale line identifiers are missing.");
  const quantity = finiteNumber(line.unitQuantity ?? line.quantity) ?? 0;
  const item = objectValue(line.Item);
  const normalized = {
    externalSaleId,
    externalLineId,
    productRef: limitedText(line.itemID ?? item.itemID, 120),
    customerRef: limitedText(line.customerID, 120),
    outletRef: limitedText(line.shopID, 120),
    soldAt: limitedText(line.createTime ?? line.timeStamp, 80),
    sku: limitedText(line.customSku ?? line.upc ?? item.customSku ?? item.upc, 160),
    productName: limitedText(line.description ?? item.description, 240),
    quantityMilli: Math.round(quantity * 1000),
    ...saleLineEconomics(line, quantity),
  };
  return { ...normalized, sourcePayloadHash: await lightspeedRSha256(JSON.stringify(normalized)) };
}

function paymentCategory(name: string): LightspeedRPaymentCategory {
  const normalized = name.toLowerCase();
  if (/\bcash\b/.test(normalized)) return "cash";
  if (/gift|voucher/.test(normalized)) return "gift_card";
  if (/store\s*credit|account\s*credit|credit\s*account/.test(normalized)) return "store_credit";
  if (/card|visa|mastercard|master card|amex|debit|interac|discover/.test(normalized)) return "card";
  return "other";
}

export function lightspeedRPaymentTypeMap(paymentTypes: Record<string, unknown>[]) {
  const result = new Map<string, string>();
  for (const type of paymentTypes) {
    const id = limitedText(type.paymentTypeID, 120);
    const name = limitedText(type.name ?? type.description, 120);
    if (id && name) result.set(id, name);
  }
  return result;
}

export async function normalizeLightspeedRPayments(
  sale: Record<string, unknown>,
  paymentTypes: ReadonlyMap<string, string> = new Map(),
): Promise<NormalizedLightspeedRPayment[]> {
  const externalSaleId = stringValue(sale.saleID);
  if (!externalSaleId) throw new Error("Sale ID is missing.");
  const payments = records(objectValue(sale.SalePayments ?? sale.Payments).SalePayment);
  return Promise.all(payments.map(async (payment, index) => {
    const externalPaymentId = stringValue(payment.salePaymentID ?? payment.paymentID) || `${externalSaleId}:${index}`;
    const paymentTypeRef = limitedText(payment.paymentTypeID, 120);
    const paymentTypeName = (
      limitedText(paymentTypeRef ? paymentTypes.get(paymentTypeRef) : null, 120) ||
      limitedText(payment.paymentTypeName ?? payment.name, 120) ||
      "Other"
    );
    const normalized = {
      externalPaymentId,
      externalSaleId,
      paymentTypeRef,
      paymentTypeName,
      category: paymentCategory(paymentTypeName),
      amountCents: money(payment.amount),
      paidAt: limitedText(payment.createTime ?? payment.paymentTime ?? payment.timeStamp ?? sale.completeTime, 80),
      outletRef: limitedText(payment.shopID ?? sale.shopID, 120),
    };
    return { ...normalized, sourcePayloadHash: await lightspeedRSha256(JSON.stringify(normalized)) };
  }));
}

export function buildLightspeedRDailyMetrics(
  sales: Array<Pick<NormalizedLightspeedRSale, "externalSaleId" | "outletRef" | "soldAt" | "state" | "totalCents" | "taxCents" | "costCents" | "discountCents" | "lineCount">>,
  timeZone = "UTC",
): LightspeedRDailyMetric[] {
  const totals = new Map<string, LightspeedRDailyMetric & { positiveNetCents: number; returnedCostCents: number }>();
  for (const sale of sales) {
    if (sale.state !== "completed" || !sale.outletRef || !sale.soldAt) continue;
    const businessDate = businessDateForTimestamp(sale.soldAt, timeZone);
    if (!businessDate) continue;
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

export function buildLightspeedRLiveSalesSnapshot(
  sales: LightspeedRLiveSale[], timeZone: string, now = new Date(),
): LightspeedRLiveSalesSnapshot {
  return salesDay(sales, timeZone, now);
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
