import { and, eq } from "drizzle-orm";
import { getDb, getRuntimeEnv } from "../../db";
import { integrationSecrets } from "../../db/schema";
import { ApiError } from "../api";
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
  newOAuthState,
  sha256Hex,
} from "./lightspeed";

export type MarketingProvider = "google" | "meta";
export type MarketingDataset = "google_analytics" | "google_search_console" | "google_business_profile" | "google_ads" | "meta_ads";

export type SelectedMarketingResource = {
  id: string;
  provider: MarketingProvider;
  dataset: MarketingDataset;
  externalResourceRef: string;
  scopeKind: "organization" | "location";
  localLocationId: string | null;
};

export type DiscoveredMarketingResource = {
  dataset: MarketingDataset;
  externalResourceRef: string;
  name: string;
  syncCapability: "metrics";
};

export type MarketingDiscoveryStatus = {
  dataset: MarketingDataset;
  status: "available" | "unavailable";
  message: string | null;
};

export const GOOGLE_MARKETING_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/business.manage",
] as const;

export const GOOGLE_ADS_SCOPE = "https://www.googleapis.com/auth/adwords" as const;

export function googleMarketingScopes() {
  return getRuntimeEnv().GOOGLE_ADS_DEVELOPER_TOKEN?.trim()
    ? [...GOOGLE_MARKETING_SCOPES, GOOGLE_ADS_SCOPE]
    : [...GOOGLE_MARKETING_SCOPES];
}

export const META_MARKETING_SCOPES = [
  "ads_read",
  "ads_management",
] as const;

const META_VERSION = /^v\d{1,2}\.\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

type ProviderConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  apiVersion: string;
};

export type MarketingMetricImport = {
  resourceSelectionId: string;
  metricDate: string;
  metricKey: string;
  valueMilli: number;
  sourceEventId: string;
};

export type MarketingSyncSnapshot = {
  metrics: MarketingMetricImport[];
  resourcesRead: number;
  warnings: string[];
  resourceResults: Array<{ resourceSelectionId: string; recordsRead: number; warningCodes: string[] }>;
};

export type MetaCampaign = {
  id: string;
  name: string;
  status: "ACTIVE" | "PAUSED" | "ARCHIVED" | "DELETED" | "UNKNOWN";
  effectiveStatus: string;
  objective: string | null;
  dailyBudgetMinor: number | null;
  lifetimeBudgetMinor: number | null;
  budgetRemainingMinor: number | null;
  updatedTime: string | null;
};

export type MetaCampaignDirectory = {
  accountRef: string;
  accountName: string;
  currency: string;
  currencyExponent: number;
  timezoneName: string;
  campaigns: MetaCampaign[];
};

type TokenResponse = {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scopes: string[];
};

function metaVersion() {
  const configured = getRuntimeEnv().META_GRAPH_API_VERSION?.trim() || "v25.0";
  return META_VERSION.test(configured) ? configured : "v25.0";
}

export function marketingReadiness(provider: MarketingProvider) {
  const env = getRuntimeEnv();
  const values = provider === "google"
    ? [
        ["GOOGLE_MARKETING_CLIENT_ID", env.GOOGLE_MARKETING_CLIENT_ID],
        ["GOOGLE_MARKETING_CLIENT_SECRET", env.GOOGLE_MARKETING_CLIENT_SECRET],
        ["GOOGLE_MARKETING_REDIRECT_URI", env.GOOGLE_MARKETING_REDIRECT_URI],
        ["INTEGRATION_ENCRYPTION_KEY", env.INTEGRATION_ENCRYPTION_KEY],
      ]
    : [
        ["META_MARKETING_APP_ID", env.META_MARKETING_APP_ID],
        ["META_MARKETING_APP_SECRET", env.META_MARKETING_APP_SECRET],
        ["META_MARKETING_REDIRECT_URI", env.META_MARKETING_REDIRECT_URI],
        ["INTEGRATION_ENCRYPTION_KEY", env.INTEGRATION_ENCRYPTION_KEY],
      ];
  const missingConfiguration = values.filter(([, value]) => !value?.trim()).map(([name]) => name);
  return {
    adapterBuilt: true,
    credentialsConfigured: missingConfiguration.length === 0,
    missingConfiguration,
    apiVersion: provider === "google" ? "Google APIs v1" : metaVersion(),
    scopes: provider === "google" ? googleMarketingScopes() : [...META_MARKETING_SCOPES],
    mode: "measurement" as const,
    resourceSelectionStatus: "required" as const,
    resourceSelectionRequired: true,
    syncEligible: false,
    dataPromotionEnabled: false,
    liveDataEligible: false,
    supportedDatasets: provider === "google"
      ? (env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim()
          ? ["google_analytics", "google_search_console", "google_business_profile", "google_ads"] as const
          : ["google_analytics", "google_search_console", "google_business_profile"] as const)
      : ["meta_ads"] as const,
  };
}

function config(provider: MarketingProvider): ProviderConfig {
  const env = getRuntimeEnv();
  const readiness = marketingReadiness(provider);
  if (!readiness.credentialsConfigured) {
    throw new ApiError(503, "MARKETING_CONFIGURATION_REQUIRED", `${provider === "google" ? "Google" : "Meta"} developer credentials must be configured before authorization can begin.`);
  }
  const current = provider === "google"
    ? {
        clientId: env.GOOGLE_MARKETING_CLIENT_ID!,
        clientSecret: env.GOOGLE_MARKETING_CLIENT_SECRET!,
        redirectUri: env.GOOGLE_MARKETING_REDIRECT_URI!,
        apiVersion: "Google APIs v1",
      }
    : {
        clientId: env.META_MARKETING_APP_ID!,
        clientSecret: env.META_MARKETING_APP_SECRET!,
        redirectUri: env.META_MARKETING_REDIRECT_URI!,
        apiVersion: metaVersion(),
      };
  let redirect: URL;
  try {
    redirect = new URL(current.redirectUri.trim());
  } catch {
    throw new ApiError(503, "MARKETING_REDIRECT_INVALID", "The configured marketing callback URL is invalid.");
  }
  if (redirect.protocol !== "https:" || redirect.username || redirect.password || redirect.hash) {
    throw new ApiError(503, "MARKETING_REDIRECT_INVALID", "The configured marketing callback URL must be a clean HTTPS URL.");
  }
  return { ...current, clientId: current.clientId.trim(), redirectUri: redirect.toString() };
}

export function newMarketingOAuthState() {
  return newOAuthState();
}

export function marketingStateHash(state: string) {
  return sha256Hex(state);
}

export function buildMarketingAuthorizationUrl(provider: MarketingProvider, state: string) {
  const current = config(provider);
  if (provider === "google") {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", current.clientId);
    url.searchParams.set("redirect_uri", current.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("scope", googleMarketingScopes().join(" "));
    url.searchParams.set("state", state);
    return url.toString();
  }
  const url = new URL(`https://www.facebook.com/${current.apiVersion}/dialog/oauth`);
  url.searchParams.set("client_id", current.clientId);
  url.searchParams.set("redirect_uri", current.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", META_MARKETING_SCOPES.join(","));
  url.searchParams.set("state", state);
  return url.toString();
}

async function providerJson<T>(url: string, init: RequestInit, code: string, message: string): Promise<T> {
  const response = await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(15_000) });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new ApiError(502, code, message);
  }
  return response.json() as Promise<T>;
}

export async function exchangeMarketingAuthorizationCode(provider: MarketingProvider, code: string): Promise<TokenResponse> {
  const current = config(provider);
  if (!code || code.length > 2_048) throw new ApiError(400, "MARKETING_CODE_INVALID", "The provider returned an invalid authorization code.");
  if (provider === "google") {
    const body = new URLSearchParams({
      code,
      client_id: current.clientId,
      client_secret: current.clientSecret,
      redirect_uri: current.redirectUri,
      grant_type: "authorization_code",
    });
    const token = await providerJson<{ access_token?: string; refresh_token?: string; expires_in?: number; scope?: string }>(
      "https://oauth2.googleapis.com/token",
      { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body },
      "GOOGLE_TOKEN_EXCHANGE_FAILED",
      "Google could not complete the authorization exchange.",
    );
    if (!token.access_token || !token.refresh_token) throw new ApiError(409, "GOOGLE_OFFLINE_ACCESS_REQUIRED", "Google did not return the continuing access required for scheduled measurement. Reconnect and approve access.");
    const scopes = [...new Set((token.scope ?? "").split(/\s+/).filter(Boolean))];
    const hasEmail = scopes.includes("email") || scopes.includes("https://www.googleapis.com/auth/userinfo.email");
    const hasMeasurement = googleMarketingScopes().some((scope) => scope.startsWith("https://") && scopes.includes(scope));
    if (!scopes.includes("openid") || !hasEmail || !hasMeasurement) {
      throw new ApiError(409, "GOOGLE_SCOPES_INCOMPLETE", "Approve account identification and at least one measurement service to connect Google.");
    }
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: new Date(Date.now() + Math.max(60, token.expires_in ?? 3_600) * 1_000),
      scopes,
    };
  }
  const url = new URL(`https://graph.facebook.com/${current.apiVersion}/oauth/access_token`);
  url.searchParams.set("client_id", current.clientId);
  url.searchParams.set("client_secret", current.clientSecret);
  url.searchParams.set("redirect_uri", current.redirectUri);
  url.searchParams.set("code", code);
  const token = await providerJson<{ access_token?: string; expires_in?: number }>(url.toString(), { headers: { Accept: "application/json" } }, "META_TOKEN_EXCHANGE_FAILED", "Meta could not complete the authorization exchange.");
  if (!token.access_token) throw new ApiError(502, "META_TOKEN_MISSING", "Meta did not return an access token.");
  const permissionsUrl = new URL(`https://graph.facebook.com/${current.apiVersion}/me/permissions`);
  permissionsUrl.searchParams.set("access_token", token.access_token);
  const permissionResult = await providerJson<{ data?: Array<{ permission?: string; status?: string }> }>(permissionsUrl.toString(), { headers: { Accept: "application/json" } }, "META_PERMISSION_CHECK_FAILED", "Meta permissions could not be verified.");
  const granted = (permissionResult.data ?? []).filter((row) => row.status === "granted" && row.permission).map((row) => row.permission!);
  const missing = META_MARKETING_SCOPES.filter((scope) => !granted.includes(scope));
  if (missing.length) throw new ApiError(409, "META_SCOPES_INCOMPLETE", "Meta did not grant every measurement permission required by this connection.");
  return {
    accessToken: token.access_token,
    refreshToken: "",
    expiresAt: new Date(Date.now() + Math.max(3_600, token.expires_in ?? 60 * 86_400) * 1_000),
    scopes: granted,
  };
}

export async function verifyMarketingIdentity(provider: MarketingProvider, accessToken: string) {
  const current = config(provider);
  if (provider === "google") {
    const identity = await providerJson<{ sub?: string; email?: string; name?: string }>(
      "https://openidconnect.googleapis.com/v1/userinfo",
      { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } },
      "GOOGLE_IDENTITY_FAILED",
      "The authorized Google account could not be verified.",
    );
    if (!identity.sub) throw new ApiError(502, "GOOGLE_IDENTITY_INVALID", "Google returned an invalid account identity.");
    return { id: identity.sub, name: identity.name || identity.email || "Google account" };
  }
  const url = new URL(`https://graph.facebook.com/${current.apiVersion}/me`);
  url.searchParams.set("fields", "id,name");
  url.searchParams.set("access_token", accessToken);
  const identity = await providerJson<{ id?: string; name?: string }>(url.toString(), { headers: { Accept: "application/json" } }, "META_IDENTITY_FAILED", "The authorized Meta account could not be verified.");
  if (!identity.id) throw new ApiError(502, "META_IDENTITY_INVALID", "Meta returned an invalid account identity.");
  return { id: identity.id, name: identity.name || "Meta account" };
}

export async function encryptedMarketingTokens(token: TokenResponse) {
  return {
    accessTokenCiphertext: await encryptIntegrationSecret(token.accessToken),
    refreshTokenCiphertext: await encryptIntegrationSecret(token.refreshToken),
    tokenExpiresAt: token.expiresAt,
  };
}

async function refreshGoogleToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: Date }> {
  const current = config("google");
  const body = new URLSearchParams({
    client_id: current.clientId,
    client_secret: current.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const token = await providerJson<{ access_token?: string; expires_in?: number }>(
    "https://oauth2.googleapis.com/token",
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body },
    "GOOGLE_TOKEN_REFRESH_FAILED",
    "Google access expired and could not be refreshed. Reconnect the account.",
  );
  if (!token.access_token) throw new ApiError(502, "GOOGLE_TOKEN_REFRESH_FAILED", "Google access expired and could not be refreshed. Reconnect the account.");
  return { accessToken: token.access_token, expiresAt: new Date(Date.now() + Math.max(60, token.expires_in ?? 3_600) * 1_000) };
}

export async function marketingAccessToken(organizationId: string, connectionId: string, provider: MarketingProvider) {
  const [secret] = await getDb().select().from(integrationSecrets).where(and(
    eq(integrationSecrets.organizationId, organizationId),
    eq(integrationSecrets.connectionId, connectionId),
    eq(integrationSecrets.provider, provider),
  )).limit(1);
  if (!secret) throw new ApiError(409, "MARKETING_REAUTHORIZATION_REQUIRED", "The provider credentials are unavailable. Reconnect the account.");
  if (secret.tokenExpiresAt.getTime() > Date.now() + 5 * 60_000) return decryptIntegrationSecret(secret.accessTokenCiphertext);
  if (provider === "meta") throw new ApiError(409, "META_REAUTHORIZATION_REQUIRED", "Meta access expired. Reconnect the account.");
  const refreshToken = await decryptIntegrationSecret(secret.refreshTokenCiphertext);
  if (!refreshToken) throw new ApiError(409, "GOOGLE_REAUTHORIZATION_REQUIRED", "Google continuing access is unavailable. Reconnect the account.");
  const refreshed = await refreshGoogleToken(refreshToken);
  await getDb().update(integrationSecrets).set({
    accessTokenCiphertext: await encryptIntegrationSecret(refreshed.accessToken),
    tokenExpiresAt: refreshed.expiresAt,
    updatedAt: new Date(),
  }).where(and(eq(integrationSecrets.id, secret.id), eq(integrationSecrets.organizationId, organizationId)));
  return refreshed.accessToken;
}

export async function storedMarketingAccessToken(organizationId: string, connectionId: string, provider: MarketingProvider) {
  const [secret] = await getDb().select({ accessTokenCiphertext: integrationSecrets.accessTokenCiphertext }).from(integrationSecrets).where(and(
    eq(integrationSecrets.organizationId, organizationId),
    eq(integrationSecrets.connectionId, connectionId),
    eq(integrationSecrets.provider, provider),
  )).limit(1);
  return secret ? decryptIntegrationSecret(secret.accessTokenCiphertext) : null;
}

function isoDate(value: unknown): string | null {
  if (typeof value === "string" && DATE.test(value)) return value;
  if (value && typeof value === "object") {
    const parts = value as { year?: unknown; month?: unknown; day?: unknown };
    const year = Number(parts.year);
    const month = Number(parts.month);
    const day = Number(parts.day);
    if (Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day)) {
      const formatted = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      return DATE.test(formatted) ? formatted : null;
    }
  }
  return null;
}

function dateWindow(days = 90) {
  const end = new Date();
  const start = new Date(end.getTime() - (days - 1) * 86_400_000);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function numberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

const DISCOVERY_RESOURCE_LIMIT = 500;
const DISCOVERY_PAGE_LIMIT = 10;

function assertDiscoveryCapacity(resources: readonly DiscoveredMarketingResource[]) {
  if (resources.length > DISCOVERY_RESOURCE_LIMIT) {
    throw new ApiError(409, "MARKETING_RESOURCE_DISCOVERY_LIMIT", `This provider account exposes more than ${DISCOVERY_RESOURCE_LIMIT} resources. Reduce its accessible resources before selecting data.`);
  }
}

async function discoverGoogleAnalyticsResources(accessToken: string) {
  const resources: DiscoveredMarketingResource[] = [];
  const seenPageTokens = new Set<string>();
  let pageToken: string | null = null;
  for (let page = 0; page < DISCOVERY_PAGE_LIMIT; page += 1) {
    const url = new URL("https://analyticsadmin.googleapis.com/v1beta/accountSummaries");
    url.searchParams.set("pageSize", "200");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const result = await providerJson<{
      accountSummaries?: Array<{ propertySummaries?: Array<{ property?: string; displayName?: string }> }>;
      nextPageToken?: string;
    }>(
      url.toString(),
      { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } },
      "GOOGLE_ANALYTICS_PROPERTIES_FAILED",
      "Google Analytics properties could not be loaded.",
    );
    resources.push(...(result.accountSummaries ?? []).flatMap((account) => account.propertySummaries ?? []).flatMap((property) => property.property ? [{
      dataset: "google_analytics" as const,
      externalResourceRef: property.property,
      name: property.displayName || property.property,
      syncCapability: "metrics" as const,
    }] : []));
    assertDiscoveryCapacity(resources);
    const nextPageToken = typeof result.nextPageToken === "string" ? result.nextPageToken.trim() : "";
    if (!nextPageToken) return resources;
    if (nextPageToken.length > 2_048 || seenPageTokens.has(nextPageToken)) {
      throw new ApiError(502, "GOOGLE_ANALYTICS_PAGINATION_INVALID", "Google Analytics returned an invalid resource page sequence.");
    }
    seenPageTokens.add(nextPageToken);
    pageToken = nextPageToken;
  }
  throw new ApiError(502, "GOOGLE_ANALYTICS_PAGINATION_LIMIT", "Google Analytics returned too many resource pages to verify safely.");
}

async function discoverGoogleBusinessProfileResources(accessToken: string) {
  const resources: DiscoveredMarketingResource[] = [];
  const accounts: Array<{ name?: string; accountName?: string }> = [];
  let accountPageToken = "";
  const seenAccountTokens = new Set<string>();
  for (let page = 0; page < DISCOVERY_PAGE_LIMIT; page += 1) {
    const accountUrl = new URL("https://mybusinessaccountmanagement.googleapis.com/v1/accounts");
    accountUrl.searchParams.set("pageSize", "20");
    if (accountPageToken) accountUrl.searchParams.set("pageToken", accountPageToken);
    const result = await providerJson<{ accounts?: Array<{ name?: string; accountName?: string }>; nextPageToken?: string }>(
      accountUrl.toString(),
      { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } },
      "GOOGLE_BUSINESS_ACCOUNTS_FAILED",
      "Google Business Profile accounts could not be loaded.",
    );
    accounts.push(...(result.accounts ?? []));
    const next = result.nextPageToken?.trim() ?? "";
    if (!next) {
      accountPageToken = "";
      break;
    }
    if (next.length > 2_048 || seenAccountTokens.has(next)) throw new ApiError(502, "GOOGLE_BUSINESS_ACCOUNT_PAGINATION_INVALID", "Google Business Profile returned an invalid account page sequence.");
    seenAccountTokens.add(next);
    accountPageToken = next;
  }
  if (accountPageToken) throw new ApiError(502, "GOOGLE_BUSINESS_ACCOUNT_PAGINATION_LIMIT", "Google Business Profile returned too many account pages to verify safely.");
  for (const account of accounts) {
    if (!/^accounts\/[A-Za-z0-9_-]+$/.test(account.name ?? "")) continue;
    let pageToken = "";
    const seen = new Set<string>();
    for (let page = 0; page < DISCOVERY_PAGE_LIMIT; page += 1) {
      const url = new URL(`https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations`);
      url.searchParams.set("readMask", "name,title,storeCode,metadata,websiteUri,phoneNumbers,regularHours,categories");
      url.searchParams.set("pageSize", "100");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const result = await providerJson<{ locations?: Array<{ name?: string; title?: string; storeCode?: string }>; nextPageToken?: string }>(
        url.toString(),
        { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } },
        "GOOGLE_BUSINESS_LOCATIONS_FAILED",
        "Google Business Profile locations could not be loaded.",
      );
      for (const location of result.locations ?? []) {
        const locationName = location.name ?? "";
        if (!/^locations\/[A-Za-z0-9_-]+$/.test(locationName)) continue;
        resources.push({
          dataset: "google_business_profile",
          externalResourceRef: `${account.name}/${locationName}`,
          name: `${location.title || locationName}${location.storeCode ? ` · ${location.storeCode}` : ""}`,
          syncCapability: "metrics",
        });
      }
      assertDiscoveryCapacity(resources);
      const next = result.nextPageToken?.trim() ?? "";
      if (!next) break;
      if (next.length > 2_048 || seen.has(next)) throw new ApiError(502, "GOOGLE_BUSINESS_PAGINATION_INVALID", "Google Business Profile returned an invalid location page sequence.");
      seen.add(next);
      pageToken = next;
    }
  }
  return resources;
}

function googleAdsVersion() {
  const configured = getRuntimeEnv().GOOGLE_ADS_API_VERSION?.trim() || "v25";
  return /^v\d{1,2}$/.test(configured) ? configured : "v25";
}

function googleAdsHeaders(accessToken: string) {
  const env = getRuntimeEnv();
  const developerToken = env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim();
  if (!developerToken) throw new ApiError(503, "GOOGLE_ADS_CONFIGURATION_REQUIRED", "Google Ads reporting requires a configured developer token.");
  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}`, "developer-token": developerToken, Accept: "application/json" };
  const loginCustomerId = env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/\D/g, "");
  if (loginCustomerId) headers["login-customer-id"] = loginCustomerId;
  return headers;
}

async function discoverGoogleAdsResources(accessToken: string) {
  if (!getRuntimeEnv().GOOGLE_ADS_DEVELOPER_TOKEN?.trim()) return [];
  const result = await providerJson<{ resourceNames?: string[] }>(
    `https://googleads.googleapis.com/${googleAdsVersion()}/customers:listAccessibleCustomers`,
    { headers: googleAdsHeaders(accessToken) },
    "GOOGLE_ADS_ACCOUNTS_FAILED",
    "Google Ads accounts could not be loaded.",
  );
  return (result.resourceNames ?? []).flatMap((resourceName) => /^customers\/\d+$/.test(resourceName) ? [{
    dataset: "google_ads" as const,
    externalResourceRef: resourceName,
    name: `Google Ads · ${resourceName.slice("customers/".length).replace(/(\d{3})(\d{3})(\d+)/, "$1-$2-$3")}`,
    syncCapability: "metrics" as const,
  }] : []);
}

export async function discoverGoogleMarketingResourceStatus(accessToken: string): Promise<{
  resources: DiscoveredMarketingResource[];
  datasets: MarketingDiscoveryStatus[];
}> {
  const tasks: Array<{ dataset: MarketingDataset; run: () => Promise<DiscoveredMarketingResource[]> }> = [
    { dataset: "google_search_console", run: async () => {
      const result = await providerJson<{ siteEntry?: Array<{ siteUrl?: string }> }>(
      "https://www.googleapis.com/webmasters/v3/sites",
      { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } },
      "GOOGLE_SEARCH_CONSOLE_FAILED",
      "Search Console resources could not be loaded.",
      );
      return (result.siteEntry ?? []).flatMap((site) => site.siteUrl ? [{
        dataset: "google_search_console" as const, externalResourceRef: site.siteUrl,
        name: site.siteUrl, syncCapability: "metrics" as const,
      }] : []);
    } },
    { dataset: "google_analytics", run: () => discoverGoogleAnalyticsResources(accessToken) },
    { dataset: "google_business_profile", run: () => discoverGoogleBusinessProfileResources(accessToken) },
  ];
  if (getRuntimeEnv().GOOGLE_ADS_DEVELOPER_TOKEN?.trim()) {
    tasks.push({ dataset: "google_ads", run: () => discoverGoogleAdsResources(accessToken) });
  }
  const outcomes = await Promise.allSettled(tasks.map((task) => task.run()));
  if (outcomes.every((result) => result.status === "rejected")) {
    throw new ApiError(502, "GOOGLE_DISCOVERY_UNAVAILABLE", "Google services could not be verified. Check the granted permissions and provider setup, then retry. Existing selections have not changed.");
  }
  const resources = outcomes.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  assertDiscoveryCapacity(resources);
  const datasets: MarketingDiscoveryStatus[] = outcomes.map((result, index) => ({
    dataset: tasks[index]!.dataset,
    status: result.status === "fulfilled" ? "available" : "unavailable",
    // Never return raw provider errors, access tokens, or request URLs.
    message: result.status === "fulfilled" ? null : "This service could not be verified. Check its permissions, API access, and quota, then retry. Other available services can still be selected.",
  }));
  return { resources, datasets };
}

export async function discoverGoogleMarketingResources(accessToken: string): Promise<DiscoveredMarketingResource[]> {
  return (await discoverGoogleMarketingResourceStatus(accessToken)).resources;
}

export async function discoverMetaMarketingResources(accessToken: string): Promise<DiscoveredMarketingResource[]> {
  const current = config("meta");
  const resources: DiscoveredMarketingResource[] = [];
  const seenCursors = new Set<string>();
  let after: string | null = null;
  for (let page = 0; page < DISCOVERY_PAGE_LIMIT; page += 1) {
    const url = new URL(`https://graph.facebook.com/${current.apiVersion}/me/adaccounts`);
    url.searchParams.set("fields", "id,name,account_status,currency");
    url.searchParams.set("limit", "100");
    url.searchParams.set("access_token", accessToken);
    if (after) url.searchParams.set("after", after);
    const accounts = await providerJson<{
      data?: Array<{ id?: string; name?: string; account_status?: number; currency?: string }>;
      paging?: { cursors?: { after?: string }; next?: string };
    }>(
      url.toString(),
      { headers: { Accept: "application/json" } },
      "META_AD_ACCOUNTS_FAILED",
      "Meta advertising accounts could not be loaded.",
    );
    resources.push(...(accounts.data ?? []).flatMap((account) => account.id && (account.account_status === undefined || account.account_status === 1) ? [{
      dataset: "meta_ads" as const,
      externalResourceRef: account.id,
      name: `${account.name || account.id}${account.currency ? ` · ${account.currency}` : ""}`,
      syncCapability: "metrics" as const,
    }] : []));
    assertDiscoveryCapacity(resources);
    const nextCursor = typeof accounts.paging?.cursors?.after === "string" ? accounts.paging.cursors.after.trim() : "";
    if (!accounts.paging?.next || !nextCursor) return resources;
    if (nextCursor.length > 2_048 || seenCursors.has(nextCursor)) {
      throw new ApiError(502, "META_AD_ACCOUNTS_PAGINATION_INVALID", "Meta returned an invalid advertising-account page sequence.");
    }
    seenCursors.add(nextCursor);
    after = nextCursor;
  }
  throw new ApiError(502, "META_AD_ACCOUNTS_PAGINATION_LIMIT", "Meta returned too many advertising-account pages to verify safely.");
}

async function metricCollector(provider: MarketingProvider) {
  const values = new Map<string, Omit<MarketingMetricImport, "sourceEventId">>();
  const add = (resourceSelectionId: string, metricDate: string | null, metricKey: string, value: unknown, aggregate = false) => {
    const numeric = numberValue(value);
    if (!metricDate || numeric === null) return;
    const key = `${resourceSelectionId}\u0000${metricDate}\u0000${metricKey}`;
    const valueMilli = Math.round(numeric * 1_000);
    const previous = values.get(key);
    values.set(key, { resourceSelectionId, metricDate, metricKey, valueMilli: aggregate ? (previous?.valueMilli ?? 0) + valueMilli : valueMilli });
  };
  const finish = async () => Promise.all([...values.values()].map(async (row) => ({
    ...row,
    sourceEventId: await sha256Hex(`${provider}|${row.resourceSelectionId}|${row.metricDate}|${row.metricKey}`),
  })));
  return { add, finish };
}

async function googleSearchMetrics(accessToken: string, selection: SelectedMarketingResource, add: Awaited<ReturnType<typeof metricCollector>>["add"]) {
  const { start, end } = dateWindow();
  const siteRef = selection.externalResourceRef;
  if (!siteRef || siteRef.length > 500) throw new ApiError(409, "GOOGLE_SEARCH_SELECTION_INVALID", "The selected Search Console resource is invalid.");
  const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteRef)}/searchAnalytics/query`;
  const report = await providerJson<{ rows?: Array<{ keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number }> }>(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ startDate: start, endDate: end, dimensions: ["date"], rowLimit: 1_000 }),
  }, "GOOGLE_SEARCH_CONSOLE_REPORT_FAILED", "The selected Search Console report could not be loaded.");
  for (const row of report.rows ?? []) {
    const date = isoDate(row.keys?.[0]);
    add(selection.id, date, "search_clicks", row.clicks);
    add(selection.id, date, "search_impressions", row.impressions);
    add(selection.id, date, "search_ctr", row.ctr);
    add(selection.id, date, "search_position", row.position);
  }
}

async function googleAnalyticsMetrics(accessToken: string, selection: SelectedMarketingResource, add: Awaited<ReturnType<typeof metricCollector>>["add"]) {
  const { start, end } = dateWindow();
  const propertyRef = selection.externalResourceRef;
  if (!/^properties\/\d+$/.test(propertyRef)) throw new ApiError(409, "GOOGLE_ANALYTICS_SELECTION_INVALID", "The selected Analytics property is invalid.");
  const report = await providerJson<{ rows?: Array<{ dimensionValues?: Array<{ value?: string }>; metricValues?: Array<{ value?: string }> }> }>(`https://analyticsdata.googleapis.com/v1beta/${propertyRef}:runReport`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      dateRanges: [{ startDate: start, endDate: end }],
      dimensions: [{ name: "date" }],
      metrics: [{ name: "sessions" }, { name: "engagedSessions" }, { name: "keyEvents" }, { name: "screenPageViews" }],
      limit: "1000",
    }),
  }, "GOOGLE_ANALYTICS_REPORT_FAILED", "The selected Google Analytics report could not be loaded.");
  for (const row of report.rows ?? []) {
    const rawDate = row.dimensionValues?.[0]?.value ?? "";
    const date = /^\d{8}$/.test(rawDate) ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}` : null;
    add(selection.id, date, "analytics_sessions", row.metricValues?.[0]?.value);
    add(selection.id, date, "analytics_engaged_sessions", row.metricValues?.[1]?.value);
    add(selection.id, date, "analytics_key_events", row.metricValues?.[2]?.value);
    add(selection.id, date, "analytics_page_views", row.metricValues?.[3]?.value);
  }
}

const GBP_METRICS = [
  "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
  "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
  "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
  "WEBSITE_CLICKS",
  "CALL_CLICKS",
  "BUSINESS_DIRECTION_REQUESTS",
  "BUSINESS_BOOKINGS",
  "BUSINESS_FOOD_ORDERS",
  "BUSINESS_CONVERSATIONS",
] as const;

const gbpMetricKeys: Record<string, string> = {
  BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: "gbp_search_desktop_impressions",
  BUSINESS_IMPRESSIONS_MOBILE_SEARCH: "gbp_search_mobile_impressions",
  BUSINESS_IMPRESSIONS_DESKTOP_MAPS: "gbp_maps_desktop_impressions",
  BUSINESS_IMPRESSIONS_MOBILE_MAPS: "gbp_maps_mobile_impressions",
  WEBSITE_CLICKS: "gbp_website_clicks",
  CALL_CLICKS: "gbp_call_clicks",
  BUSINESS_DIRECTION_REQUESTS: "gbp_direction_requests",
  BUSINESS_BOOKINGS: "gbp_bookings",
  BUSINESS_FOOD_ORDERS: "gbp_food_orders",
  BUSINESS_CONVERSATIONS: "gbp_conversations",
};

function businessProfileLocationId(parent: string) {
  const match = /^accounts\/[A-Za-z0-9_-]+\/locations\/([A-Za-z0-9_-]+)$/.exec(parent);
  if (!match) throw new ApiError(409, "GOOGLE_BUSINESS_SELECTION_INVALID", "The selected Business Profile location is invalid.");
  return `locations/${match[1]}`;
}

async function googleBusinessProfileMetrics(accessToken: string, selection: SelectedMarketingResource, add: Awaited<ReturnType<typeof metricCollector>>["add"]) {
  const { start, end } = dateWindow();
  const url = new URL(`https://businessprofileperformance.googleapis.com/v1/${businessProfileLocationId(selection.externalResourceRef)}:fetchMultiDailyMetricsTimeSeries`);
  for (const metric of GBP_METRICS) url.searchParams.append("dailyMetrics", metric);
  const [startYear, startMonth, startDay] = start.split("-");
  const [endYear, endMonth, endDay] = end.split("-");
  url.searchParams.set("dailyRange.startDate.year", startYear);
  url.searchParams.set("dailyRange.startDate.month", String(Number(startMonth)));
  url.searchParams.set("dailyRange.startDate.day", String(Number(startDay)));
  url.searchParams.set("dailyRange.endDate.year", endYear);
  url.searchParams.set("dailyRange.endDate.month", String(Number(endMonth)));
  url.searchParams.set("dailyRange.endDate.day", String(Number(endDay)));
  const report = await providerJson<{ multiDailyMetricTimeSeries?: Array<{ dailyMetricTimeSeries?: Array<{ dailyMetric?: string; timeSeries?: { datedValues?: Array<{ date?: unknown; value?: string }> } }> }> }>(
    url.toString(),
    { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } },
    "GOOGLE_BUSINESS_PERFORMANCE_FAILED",
    "Google Business Profile performance could not be loaded.",
  );
  for (const group of report.multiDailyMetricTimeSeries ?? []) {
    for (const series of group.dailyMetricTimeSeries ?? []) {
      const metricKey = series.dailyMetric ? gbpMetricKeys[series.dailyMetric] : null;
      if (!metricKey) continue;
      for (const point of series.timeSeries?.datedValues ?? []) add(selection.id, isoDate(point.date), metricKey, point.value);
    }
  }
}

async function googleAdsMetrics(accessToken: string, selection: SelectedMarketingResource, add: Awaited<ReturnType<typeof metricCollector>>["add"]) {
  if (!/^customers\/\d+$/.test(selection.externalResourceRef)) throw new ApiError(409, "GOOGLE_ADS_SELECTION_INVALID", "The selected Google Ads account is invalid.");
  const { start, end } = dateWindow();
  const query = `SELECT segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM customer WHERE segments.date BETWEEN '${start}' AND '${end}' ORDER BY segments.date`;
  const result = await providerJson<Array<{ results?: Array<{ segments?: { date?: string }; metrics?: Record<string, string | number> }> }>>(
    `https://googleads.googleapis.com/${googleAdsVersion()}/${selection.externalResourceRef}/googleAds:searchStream`,
    { method: "POST", headers: { ...googleAdsHeaders(accessToken), "Content-Type": "application/json" }, body: JSON.stringify({ query }) },
    "GOOGLE_ADS_REPORT_FAILED",
    "The selected Google Ads report could not be loaded.",
  );
  for (const row of result.flatMap((batch) => batch.results ?? [])) {
    const date = isoDate(row.segments?.date);
    add(selection.id, date, "google_ads_impressions", row.metrics?.impressions);
    add(selection.id, date, "google_ads_clicks", row.metrics?.clicks);
    add(selection.id, date, "google_ads_spend", Number(row.metrics?.costMicros ?? 0) / 1_000_000);
    add(selection.id, date, "google_ads_conversions", row.metrics?.conversions);
    add(selection.id, date, "google_ads_conversion_value", row.metrics?.conversionsValue);
  }
}

export type GoogleBusinessReview = {
  name: string;
  reviewerName: string;
  starRating: string;
  comment: string;
  createTime: string;
  updateTime: string;
  reply: { comment: string; updateTime: string } | null;
};

export async function fetchGoogleBusinessReviews(accessToken: string, parent: string, pageToken = "") {
  businessProfileLocationId(parent);
  const url = new URL(`https://mybusiness.googleapis.com/v4/${parent}/reviews`);
  url.searchParams.set("pageSize", "50");
  url.searchParams.set("orderBy", "updateTime desc");
  if (pageToken) {
    if (pageToken.length > 2_048) throw new ApiError(400, "GOOGLE_REVIEW_PAGE_INVALID", "The review page token is invalid.");
    url.searchParams.set("pageToken", pageToken);
  }
  const result = await providerJson<{ reviews?: Array<{ name?: string; reviewer?: { displayName?: string }; starRating?: string; comment?: string; createTime?: string; updateTime?: string; reviewReply?: { comment?: string; updateTime?: string } }>; nextPageToken?: string }>(
    url.toString(),
    { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json", "Cache-Control": "no-store" } },
    "GOOGLE_REVIEWS_FAILED",
    "Google Business Profile reviews could not be loaded.",
  );
  const prefix = `${parent}/reviews/`;
  return {
    reviews: (result.reviews ?? []).flatMap((review): GoogleBusinessReview[] => review.name?.startsWith(prefix) ? [{
      name: review.name,
      reviewerName: review.reviewer?.displayName || "Google user",
      starRating: review.starRating || "STAR_RATING_UNSPECIFIED",
      comment: review.comment || "",
      createTime: review.createTime || "",
      updateTime: review.updateTime || "",
      reply: review.reviewReply ? { comment: review.reviewReply.comment || "", updateTime: review.reviewReply.updateTime || "" } : null,
    }] : []),
    nextPageToken: result.nextPageToken || null,
  };
}

export async function publishGoogleBusinessReviewReply(accessToken: string, reviewName: string, comment: string) {
  if (!/^accounts\/[A-Za-z0-9_-]+\/locations\/[A-Za-z0-9_-]+\/reviews\/[A-Za-z0-9_-]+$/.test(reviewName)) throw new ApiError(400, "GOOGLE_REVIEW_INVALID", "The selected Google review is invalid.");
  return providerJson<{ comment?: string; updateTime?: string }>(
    `https://mybusiness.googleapis.com/v4/${reviewName}/reply`,
    { method: "PUT", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ comment }) },
    "GOOGLE_REVIEW_REPLY_FAILED",
    "Google could not publish the review reply.",
  );
}

export async function syncGoogleMarketing(accessToken: string, selections: readonly SelectedMarketingResource[]): Promise<MarketingSyncSnapshot> {
  const collector = await metricCollector("google");
  const warnings: string[] = [];
  let resourcesRead = 0;
  const resourceResults: MarketingSyncSnapshot["resourceResults"] = [];
  const supported = selections.filter((selection) => selection.provider === "google" && ["google_search_console", "google_analytics", "google_business_profile", "google_ads"].includes(selection.dataset));
  if (!supported.length) throw new ApiError(409, "MARKETING_RESOURCE_SELECTION_REQUIRED", "Choose at least one metrics-capable Google resource before synchronization.");
  for (const selection of supported) {
    const before = (await collector.finish()).length;
    const warningCodes: string[] = [];
    try {
      if (selection.dataset === "google_search_console") await googleSearchMetrics(accessToken, selection, collector.add);
      else if (selection.dataset === "google_analytics") await googleAnalyticsMetrics(accessToken, selection, collector.add);
      else if (selection.dataset === "google_business_profile") await googleBusinessProfileMetrics(accessToken, selection, collector.add);
      else await googleAdsMetrics(accessToken, selection, collector.add);
      resourcesRead += 1;
    } catch (error) {
      const code = error instanceof ApiError ? error.code : "GOOGLE_MARKETING_RESOURCE_FAILED";
      warningCodes.push(code);
      warnings.push(code);
    }
    const after = (await collector.finish()).length;
    resourceResults.push({ resourceSelectionId: selection.id, recordsRead: Math.max(0, after - before), warningCodes });
  }
  if (!resourcesRead) throw new ApiError(502, "GOOGLE_MARKETING_SYNC_FAILED", "Google did not return data for any selected resource.");
  return { metrics: await collector.finish(), resourcesRead, warnings, resourceResults };
}

const ZERO_DECIMAL_CURRENCIES = new Set(["BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"]);
const THREE_DECIMAL_CURRENCIES = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);

export function currencyExponent(currency: string) {
  const code = currency.trim().toUpperCase();
  return ZERO_DECIMAL_CURRENCIES.has(code) ? 0 : THREE_DECIMAL_CURRENCIES.has(code) ? 3 : 2;
}

function optionalProviderInteger(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export async function fetchMetaCampaignDirectory(accessToken: string, adAccountRef: string): Promise<MetaCampaignDirectory> {
  const current = config("meta");
  if (!/^act_\d+$/.test(adAccountRef)) throw new ApiError(400, "META_AD_SELECTION_INVALID", "Choose a valid selected Meta advertising account.");
  const accountUrl = new URL(`https://graph.facebook.com/${current.apiVersion}/${adAccountRef}`);
  accountUrl.searchParams.set("fields", "id,name,currency,timezone_name");
  accountUrl.searchParams.set("access_token", accessToken);
  const account = await providerJson<{ id?: string; name?: string; currency?: string; timezone_name?: string }>(
    accountUrl.toString(),
    { headers: { Accept: "application/json" } },
    "META_AD_ACCOUNT_FAILED",
    "The selected Meta advertising account could not be loaded.",
  );
  if (account.id !== adAccountRef || !account.currency) throw new ApiError(502, "META_AD_ACCOUNT_INVALID", "Meta returned an invalid advertising account response.");

  const campaignUrl = new URL(`https://graph.facebook.com/${current.apiVersion}/${adAccountRef}/campaigns`);
  campaignUrl.searchParams.set("fields", "id,name,status,effective_status,objective,daily_budget,lifetime_budget,budget_remaining,updated_time");
  campaignUrl.searchParams.set("limit", "100");
  campaignUrl.searchParams.set("access_token", accessToken);
  const campaignResult = await providerJson<{ data?: Array<Record<string, unknown>> }>(
    campaignUrl.toString(),
    { headers: { Accept: "application/json" } },
    "META_CAMPAIGNS_FAILED",
    "Meta campaigns could not be loaded.",
  );
  const allowedStatus = new Set(["ACTIVE", "PAUSED", "ARCHIVED", "DELETED"]);
  return {
    accountRef: adAccountRef,
    accountName: account.name?.trim() || adAccountRef,
    currency: account.currency.toUpperCase(),
    currencyExponent: currencyExponent(account.currency),
    timezoneName: account.timezone_name?.trim() || "Account timezone",
    campaigns: (campaignResult.data ?? []).slice(0, 100).flatMap((row) => {
      const id = typeof row.id === "string" ? row.id : "";
      const name = typeof row.name === "string" ? row.name.trim() : "";
      if (!/^\d+$/.test(id) || !name) return [];
      const rawStatus = typeof row.status === "string" ? row.status.toUpperCase() : "UNKNOWN";
      return [{
        id,
        name,
        status: allowedStatus.has(rawStatus) ? rawStatus as MetaCampaign["status"] : "UNKNOWN",
        effectiveStatus: typeof row.effective_status === "string" ? row.effective_status : rawStatus,
        objective: typeof row.objective === "string" ? row.objective : null,
        dailyBudgetMinor: optionalProviderInteger(row.daily_budget),
        lifetimeBudgetMinor: optionalProviderInteger(row.lifetime_budget),
        budgetRemainingMinor: optionalProviderInteger(row.budget_remaining),
        updatedTime: typeof row.updated_time === "string" ? row.updated_time : null,
      }];
    }),
  };
}

export async function updateMetaCampaign(input: {
  accessToken: string;
  adAccountRef: string;
  campaignId: string;
  expectedCampaignName: string;
  status?: "ACTIVE" | "PAUSED";
  dailyBudgetMinor?: number;
}) {
  const current = config("meta");
  if (!/^act_\d+$/.test(input.adAccountRef) || !/^\d+$/.test(input.campaignId)) throw new ApiError(400, "META_CAMPAIGN_INVALID", "Choose a valid campaign from the selected Meta advertising account.");
  const expectedName = input.expectedCampaignName.trim();
  if (!expectedName || expectedName.length > 400) throw new ApiError(400, "META_CAMPAIGN_CONFIRMATION_INVALID", "Confirm the exact campaign name before changing it.");
  const changes = Number(Boolean(input.status)) + Number(input.dailyBudgetMinor !== undefined);
  if (changes !== 1) throw new ApiError(400, "META_CAMPAIGN_CHANGE_INVALID", "Submit exactly one campaign status or daily-budget change.");
  if (input.dailyBudgetMinor !== undefined && (!Number.isSafeInteger(input.dailyBudgetMinor) || input.dailyBudgetMinor <= 0 || input.dailyBudgetMinor > 100_000_000_000)) {
    throw new ApiError(400, "META_CAMPAIGN_BUDGET_INVALID", "Enter a positive daily budget within the supported provider range.");
  }

  const verifyUrl = new URL(`https://graph.facebook.com/${current.apiVersion}/${input.campaignId}`);
  verifyUrl.searchParams.set("fields", "id,name,account_id,status,daily_budget");
  verifyUrl.searchParams.set("access_token", input.accessToken);
  const campaign = await providerJson<{ id?: string; name?: string; account_id?: string; status?: string; daily_budget?: string }>(
    verifyUrl.toString(),
    { headers: { Accept: "application/json" } },
    "META_CAMPAIGN_VERIFY_FAILED",
    "Meta could not verify the selected campaign before the change.",
  );
  if (campaign.id !== input.campaignId || campaign.account_id !== input.adAccountRef.slice(4) || campaign.name !== expectedName) {
    throw new ApiError(409, "META_CAMPAIGN_CHANGED", "The campaign identity changed. Refresh the campaign list before confirming again.");
  }
  if (input.dailyBudgetMinor !== undefined && campaign.daily_budget === undefined) {
    throw new ApiError(409, "META_CAMPAIGN_BUDGET_LEVEL_UNSUPPORTED", "This campaign does not expose a campaign-level daily budget. Change its ad-set budget in Meta Ads Manager.");
  }

  const updateUrl = new URL(`https://graph.facebook.com/${current.apiVersion}/${input.campaignId}`);
  updateUrl.searchParams.set("access_token", input.accessToken);
  const body = new URLSearchParams(input.status ? { status: input.status } : { daily_budget: String(input.dailyBudgetMinor) });
  const result = await providerJson<{ success?: boolean }>(
    updateUrl.toString(),
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body },
    "META_CAMPAIGN_UPDATE_FAILED",
    "Meta did not apply the confirmed campaign change.",
  );
  if (result.success !== true) throw new ApiError(502, "META_CAMPAIGN_UPDATE_UNCONFIRMED", "Meta did not confirm that the campaign change was applied.");
  return {
    campaignId: input.campaignId,
    campaignName: campaign.name,
    previousStatus: campaign.status ?? null,
    previousDailyBudgetMinor: optionalProviderInteger(campaign.daily_budget),
    status: input.status ?? null,
    dailyBudgetMinor: input.dailyBudgetMinor ?? null,
  };
}

export async function syncMetaMarketing(accessToken: string, selections: readonly SelectedMarketingResource[]): Promise<MarketingSyncSnapshot> {
  const current = config("meta");
  const collector = await metricCollector("meta");
  const { start, end } = dateWindow();
  let resourcesRead = 0;
  const warnings: string[] = [];
  const resourceResults: MarketingSyncSnapshot["resourceResults"] = [];
  const supported = selections.filter((selection) => selection.provider === "meta" && selection.dataset === "meta_ads");
  if (!supported.length) throw new ApiError(409, "MARKETING_RESOURCE_SELECTION_REQUIRED", "Choose at least one Meta advertising account before synchronization.");
  for (const selection of supported) {
    if (!/^act_\d+$/.test(selection.externalResourceRef)) throw new ApiError(409, "META_AD_SELECTION_INVALID", "The selected Meta advertising account is invalid.");
    const insights = new URL(`https://graph.facebook.com/${current.apiVersion}/${selection.externalResourceRef}/insights`);
    insights.searchParams.set("fields", "date_start,impressions,reach,clicks,inline_link_clicks,spend,ctr,cpc");
    insights.searchParams.set("level", "account");
    insights.searchParams.set("time_increment", "1");
    insights.searchParams.set("time_range", JSON.stringify({ since: start, until: end }));
    insights.searchParams.set("limit", "1000");
    insights.searchParams.set("access_token", accessToken);
    const warningCodes: string[] = [];
    let recordsRead = 0;
    try {
      const report = await providerJson<{ data?: Array<Record<string, string>> }>(insights.toString(), { headers: { Accept: "application/json" } }, "META_INSIGHTS_FAILED", "The selected Meta advertising insights could not be loaded.");
      resourcesRead += 1;
      recordsRead = report.data?.length ?? 0;
      for (const row of report.data ?? []) {
        const date = isoDate(row.date_start);
        collector.add(selection.id, date, "meta_impressions", row.impressions);
        collector.add(selection.id, date, "meta_reach", row.reach);
        collector.add(selection.id, date, "meta_clicks", row.clicks);
        collector.add(selection.id, date, "meta_link_clicks", row.inline_link_clicks);
        collector.add(selection.id, date, "meta_spend", row.spend);
        collector.add(selection.id, date, "meta_ctr", row.ctr);
        collector.add(selection.id, date, "meta_cpc", row.cpc);
      }
    } catch (error) {
      const code = error instanceof ApiError ? error.code : "META_INSIGHTS_FAILED";
      warningCodes.push(code);
      warnings.push(code);
    }
    resourceResults.push({ resourceSelectionId: selection.id, recordsRead, warningCodes });
  }
  if (!resourcesRead) throw new ApiError(502, "META_MARKETING_SYNC_FAILED", "Meta did not return data for any selected advertising account.");
  return { metrics: await collector.finish(), resourcesRead, warnings, resourceResults };
}

export async function revokeMarketingAccess(provider: MarketingProvider, accessToken: string) {
  if (provider === "google") {
    const url = new URL("https://oauth2.googleapis.com/revoke");
    url.searchParams.set("token", accessToken);
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(5_000) });
    await response.body?.cancel().catch(() => undefined);
    return response.ok;
  }
  const current = config("meta");
  const url = new URL(`https://graph.facebook.com/${current.apiVersion}/me/permissions`);
  url.searchParams.set("access_token", accessToken);
  const response = await fetch(url, { method: "DELETE", signal: AbortSignal.timeout(5_000) });
  await response.body?.cancel().catch(() => undefined);
  return response.ok;
}
