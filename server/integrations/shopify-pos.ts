import { and, eq } from "drizzle-orm";
import { getDb, getRuntimeEnv } from "../../db";
import { integrationSecrets } from "../../db/schema";
import { ApiError } from "../api";

export const SHOPIFY_POS_PROVIDER = "shopify-pos";
export const SHOPIFY_API_VERSION = "2026-07";
export const SHOPIFY_POS_READ_SCOPES = ["read_all_orders", "read_orders", "read_products", "read_inventory", "read_locations", "read_customers"] as const;
const SECRET_AAD = "vanteloq:shopify-pos:v1";

function env() { return getRuntimeEnv(); }
export function shopifyPosReadiness() {
  const runtime = env();
  const missingConfiguration = [
    ["SHOPIFY_CLIENT_ID", runtime.SHOPIFY_CLIENT_ID],
    ["SHOPIFY_CLIENT_SECRET", runtime.SHOPIFY_CLIENT_SECRET],
    ["SHOPIFY_REDIRECT_URI", runtime.SHOPIFY_REDIRECT_URI],
    ["SHOPIFY_WEBHOOK_URL", runtime.SHOPIFY_WEBHOOK_URL],
    ["INTEGRATION_ENCRYPTION_KEY", runtime.INTEGRATION_ENCRYPTION_KEY],
  ].filter(([, value]) => !value?.trim()).map(([key]) => key);
  return { adapterBuilt: true, credentialsConfigured: missingConfiguration.length === 0, missingConfiguration, apiVersion: SHOPIFY_API_VERSION, permissions: [...SHOPIFY_POS_READ_SCOPES], mode: "read_only_staged_sync" as const, webhookConfigured: Boolean(runtime.SHOPIFY_WEBHOOK_URL?.trim()), dataPromotionEnabled: false };
}

function config() {
  const runtime = env();
  const readiness = shopifyPosReadiness();
  if (!readiness.credentialsConfigured) throw new ApiError(503, "SHOPIFY_CONFIGURATION_REQUIRED", "Shopify developer credentials must be configured before authorization can begin.");
  let redirect: URL;
  try { redirect = new URL(runtime.SHOPIFY_REDIRECT_URI!.trim()); } catch { throw new ApiError(503, "SHOPIFY_REDIRECT_INVALID", "The Shopify callback URL is invalid."); }
  if (redirect.protocol !== "https:" || redirect.username || redirect.password || redirect.hash) throw new ApiError(503, "SHOPIFY_REDIRECT_INVALID", "The Shopify callback must be a clean HTTPS URL.");
  return { clientId: runtime.SHOPIFY_CLIENT_ID!.trim(), clientSecret: runtime.SHOPIFY_CLIENT_SECRET!, redirectUri: redirect.toString(), encryptionKey: runtime.INTEGRATION_ENCRYPTION_KEY! };
}

export function normalizeShopDomain(value: string) {
  const candidate = value.trim().toLowerCase().replace(/^https?:\/\//u, "").replace(/\/$/u, "");
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]\.myshopify\.com$/u.test(candidate)) throw new ApiError(400, "SHOPIFY_SHOP_INVALID", "Enter the store's permanent .myshopify.com domain.");
  return candidate;
}
export function newShopifyState() { return base64Url(crypto.getRandomValues(new Uint8Array(32))); }
export async function shopifySha256(value: string | Uint8Array) { const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value; return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes)))); }

export function buildShopifyAuthorizationUrl(shop: string, state: string) {
  const domain = normalizeShopDomain(shop);
  if (!/^[A-Za-z0-9_-]{43}$/u.test(state)) throw new ApiError(400, "SHOPIFY_STATE_INVALID", "The Shopify authorization state is invalid.");
  const current = config();
  const url = new URL(`https://${domain}/admin/oauth/authorize`);
  url.searchParams.set("client_id", current.clientId);
  url.searchParams.set("scope", SHOPIFY_POS_READ_SCOPES.join(","));
  url.searchParams.set("redirect_uri", current.redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

export async function verifyShopifyCallback(url: URL) {
  const supplied = url.searchParams.get("hmac") ?? "";
  if (!/^[a-f0-9]{64}$/iu.test(supplied)) return false;
  const message = [...url.searchParams.entries()].filter(([key]) => key !== "hmac" && key !== "signature").sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("&");
  return constantTimeEqual(await hmacHex(config().clientSecret, message), supplied.toLowerCase());
}

export async function exchangeShopifyCode(shop: string, code: string, fetcher: typeof fetch = fetch) {
  const domain = normalizeShopDomain(shop);
  if (!code || code.length > 4096) throw new ApiError(400, "SHOPIFY_CODE_INVALID", "Shopify returned an invalid authorization code.");
  const current = config();
  const response = await fetcher(`https://${domain}/admin/oauth/access_token`, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ client_id: current.clientId, client_secret: current.clientSecret, code }), signal: AbortSignal.timeout(15_000) });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  const accessToken = text(payload.access_token);
  if (!response.ok || !accessToken) throw new ApiError(502, "SHOPIFY_TOKEN_EXCHANGE_FAILED", "Shopify did not accept the authorization request. Start a new connection attempt.");
  const scopes = text(payload.scope)?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
  return { accessToken, scopes };
}

async function cryptoKey(encoded: string) { let raw: Uint8Array; try { raw = fromBase64(encoded); } catch { throw new ApiError(503, "INTEGRATION_ENCRYPTION_KEY_INVALID", "The integration encryption key is invalid."); } if (raw.byteLength !== 32) throw new ApiError(503, "INTEGRATION_ENCRYPTION_KEY_INVALID", "The integration encryption key must decode to 32 bytes."); return crypto.subtle.importKey("raw", toArrayBuffer(raw), "AES-GCM", false, ["encrypt", "decrypt"]); }
async function encrypt(value: string) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(SECRET_AAD) }, await cryptoKey(config().encryptionKey), new TextEncoder().encode(value)); return `v1.${base64Url(iv)}.${base64Url(new Uint8Array(ciphertext))}`; }
async function decrypt(value: string) { const [version, iv, ciphertext] = value.split("."); if (version !== "v1" || !iv || !ciphertext) throw new ApiError(500, "INTEGRATION_SECRET_INVALID", "Stored Shopify credentials could not be read."); try { const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(iv), additionalData: new TextEncoder().encode(SECRET_AAD) }, await cryptoKey(config().encryptionKey), toArrayBuffer(fromBase64(ciphertext))); return new TextDecoder().decode(plaintext); } catch { throw new ApiError(500, "INTEGRATION_SECRET_DECRYPTION_FAILED", "Stored Shopify credentials could not be decrypted."); } }

export async function saveShopifyToken(organizationId: string, connectionId: string, accessToken: string) {
  const now = new Date();
  const encrypted = await encrypt(accessToken);
  await getDb().insert(integrationSecrets).values({ id: crypto.randomUUID(), organizationId, provider: SHOPIFY_POS_PROVIDER, connectionId, accessTokenCiphertext: encrypted, refreshTokenCiphertext: encrypted, tokenExpiresAt: new Date("2099-01-01T00:00:00.000Z"), createdAt: now, updatedAt: now }).onConflictDoUpdate({ target: integrationSecrets.connectionId, set: { accessTokenCiphertext: encrypted, refreshTokenCiphertext: encrypted, tokenExpiresAt: new Date("2099-01-01T00:00:00.000Z"), updatedAt: now } });
}
async function accessToken(organizationId: string, connectionId: string) { const [row] = await getDb().select({ value: integrationSecrets.accessTokenCiphertext }).from(integrationSecrets).where(and(eq(integrationSecrets.organizationId, organizationId), eq(integrationSecrets.provider, SHOPIFY_POS_PROVIDER), eq(integrationSecrets.connectionId, connectionId))).limit(1); if (!row) throw new ApiError(409, "SHOPIFY_NOT_CONNECTED", "Authorize a Shopify store before accessing its data."); return decrypt(row.value); }

export async function shopifyGraphql<T>(organizationId: string, connectionId: string, shop: string, query: string, variables: Record<string, unknown> = {}, fetcher: typeof fetch = fetch): Promise<T> {
  const domain = normalizeShopDomain(shop);
  const response = await fetcher(`https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", "X-Shopify-Access-Token": await accessToken(organizationId, connectionId) }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(25_000) });
  if (response.status === 429) throw new ApiError(503, "SHOPIFY_RATE_LIMITED", "Shopify is rate-limiting this store. The sync checkpoint is preserved; retry shortly.");
  if (response.status === 401 || response.status === 403) throw new ApiError(409, "SHOPIFY_AUTHORIZATION_EXPIRED", "Shopify authorization is no longer valid. Reconnect the store.");
  const payload = await response.json().catch(() => ({})) as { data?: T; errors?: Array<{ message?: string }> };
  if (!response.ok || !payload.data || payload.errors?.length) throw new ApiError(502, "SHOPIFY_PROVIDER_ERROR", "Shopify could not complete the read-only request. No staged data was promoted.");
  return payload.data;
}

export async function fetchShopifyIdentity(organizationId: string, connectionId: string, shop: string) {
  return shopifyGraphql<{ shop: { id: string; name: string; myshopifyDomain: string } }>(organizationId, connectionId, shop, `query VanteloqShop { shop { id name myshopifyDomain } }`);
}
export async function fetchShopifyLocations(organizationId: string, connectionId: string, shop: string) {
  const data = await shopifyGraphql<{ locations: { nodes: Array<{ id: string; name: string; isActive: boolean }> } }>(organizationId, connectionId, shop, `query VanteloqLocations { locations(first: 100) { nodes { id name isActive } } }`);
  return data.locations.nodes.filter((location) => location.isActive);
}

export async function verifyShopifyWebhook(bytes: Uint8Array, signature: string | null) {
  if (!signature) return false;
  const digest = await hmacBytes(config().clientSecret, bytes);
  return constantTimeEqual(base64(digest), signature);
}

function text(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function base64Url(bytes: Uint8Array) { return base64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, ""); }
function base64(bytes: Uint8Array) { let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }
function fromBase64(value: string) { const normalized = value.replaceAll("-", "+").replaceAll("_", "/"); const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")); return Uint8Array.from(binary, (character) => character.charCodeAt(0)); }
function toArrayBuffer(value: Uint8Array) { return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer; }
function hex(bytes: Uint8Array) { return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
async function hmacBytes(secret: string, value: string | Uint8Array) { const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value; return new Uint8Array(await crypto.subtle.sign("HMAC", key, toArrayBuffer(bytes))); }
async function hmacHex(secret: string, value: string) { return hex(await hmacBytes(secret, value)); }
function constantTimeEqual(left: string, right: string) { if (left.length !== right.length) return false; let different = 0; for (let index = 0; index < left.length; index += 1) different |= left.charCodeAt(index) ^ right.charCodeAt(index); return different === 0; }
