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
export type MarketingDataset = "google_analytics" | "google_search_console" | "meta_ads";

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

export const GOOGLE_MARKETING_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/analytics.readonly",
] as const;

export const META_MARKETING_SCOPES = [
  "ads_read",
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
    scopes: provider === "google" ? [...GOOGLE_MARKETING_SCOPES] : [...META_MARKETING_SCOPES],
    mode: "measurement" as const,
    resourceSelectionStatus: "required" as const,
    resourceSelectionRequired: true,
    syncEligible: false,
    dataPromotionEnabled: false,
    liveDataEligible: false,
    supportedDatasets: provider === "google"
      ? ["google_analytics", "google_search_console"] as const
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
    url.searchParams.set("scope", GOOGLE_MARKETING_SCOPES.join(" "));
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
  const response = await fetch(url, init);
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
    const missing = GOOGLE_MARKETING_SCOPES.filter((scope) => !scopes.includes(scope));
    if (missing.length) throw new ApiError(409, "GOOGLE_SCOPES_INCOMPLETE", "Google did not grant every measurement permission required by this connection.");
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

export async function discoverGoogleMarketingResources(accessToken: string): Promise<DiscoveredMarketingResource[]> {
  const [searchResult, analyticsResources] = await Promise.all([
    providerJson<{ siteEntry?: Array<{ siteUrl?: string }> }>(
      "https://www.googleapis.com/webmasters/v3/sites",
      { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } },
      "GOOGLE_SEARCH_CONSOLE_FAILED",
      "Search Console resources could not be loaded.",
    ),
    discoverGoogleAnalyticsResources(accessToken),
  ]);
  const searchResources = (searchResult.siteEntry ?? []).flatMap((site) => site.siteUrl ? [{
    dataset: "google_search_console" as const,
    externalResourceRef: site.siteUrl,
    name: site.siteUrl,
    syncCapability: "metrics" as const,
  }] : []);
  const resources = [...searchResources, ...analyticsResources];
  assertDiscoveryCapacity(resources);
  return resources;
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

export async function syncGoogleMarketing(accessToken: string, selections: readonly SelectedMarketingResource[]): Promise<MarketingSyncSnapshot> {
  const collector = await metricCollector("google");
  const warnings: string[] = [];
  let resourcesRead = 0;
  const resourceResults: MarketingSyncSnapshot["resourceResults"] = [];
  const supported = selections.filter((selection) => selection.provider === "google" && ["google_search_console", "google_analytics"].includes(selection.dataset));
  if (!supported.length) throw new ApiError(409, "MARKETING_RESOURCE_SELECTION_REQUIRED", "Choose at least one metrics-capable Google resource before synchronization.");
  for (const selection of supported) {
    const before = (await collector.finish()).length;
    const warningCodes: string[] = [];
    try {
      if (selection.dataset === "google_search_console") await googleSearchMetrics(accessToken, selection, collector.add);
      else await googleAnalyticsMetrics(accessToken, selection, collector.add);
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
