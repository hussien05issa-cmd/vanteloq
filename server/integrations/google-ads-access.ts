import { getRuntimeEnv } from "../../db";
import { ApiError } from "../api";

const CUSTOMER = /^customers\/\d{1,20}$/;
const MAX_ACCOUNTS = 500;
type AdsAccount = { resourceRef: string; name: string; loginCustomerId: string | null; testAccount: boolean };
type ClientRow = { customerClient?: { clientCustomer?: string; manager?: boolean; testAccount?: boolean; descriptiveName?: string } };

export function googleAdsVersion() {
  const version = getRuntimeEnv().GOOGLE_ADS_API_VERSION?.trim() || "v25";
  if (!/^v\d{1,2}$/.test(version)) throw new ApiError(409, "GOOGLE_ADS_VERSION_INVALID", "Google Ads API configuration needs attention.");
  return version;
}

export function googleAdsHeaders(accessToken: string, loginCustomerId: string | null = null) {
  const developerToken = getRuntimeEnv().GOOGLE_ADS_DEVELOPER_TOKEN?.trim();
  if (!developerToken) throw new ApiError(503, "GOOGLE_ADS_CONFIGURATION_REQUIRED", "Google Ads reporting requires a configured developer token.");
  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}`, "developer-token": developerToken, Accept: "application/json" };
  // Never apply a platform-wide manager to a subscriber's independently authorized account.
  if (loginCustomerId && /^\d{1,20}$/.test(loginCustomerId)) headers["login-customer-id"] = loginCustomerId;
  return headers;
}

function directoryError() {
  return new ApiError(502, "GOOGLE_ADS_DIRECTORY_UNAVAILABLE", "Google Ads accounts could not be fully verified. Check account access, API approval and provider limits, then retry. Existing selections are unchanged.");
}

type DirectoryPhase = "list" | "identity" | "hierarchy";
type DirectoryReason = "transport" | "redirect_rejected" | "body_missing" | "body_read" | "body_limit" | "json_invalid" | "provider_rejected" | "roots_invalid" | "identity_invalid" | "rows_invalid" | "reference_invalid" | "page_invalid" | "request_limit" | "account_limit";
const PROVIDER_STATUSES = new Set(["INVALID_ARGUMENT", "UNAUTHENTICATED", "PERMISSION_DENIED", "RESOURCE_EXHAUSTED", "NOT_FOUND", "FAILED_PRECONDITION", "INTERNAL", "UNAVAILABLE", "DEADLINE_EXCEEDED", "UNKNOWN", "UNIMPLEMENTED"]);

// Server-only, bounded diagnostics. Never accept request URLs, IDs, headers, tokens,
// account labels, provider messages or arbitrary error objects as log fields.
function logDirectoryFailure(phase: DirectoryPhase, reason: DirectoryReason, httpStatus: number | null = null, providerStatus: string | null = null, setupCode: string | null = null) {
  try {
    console.warn("[ads-directory-diagnostic]", JSON.stringify({
      phase, reason,
      httpStatus: Number.isInteger(httpStatus) && httpStatus! >= 100 && httpStatus! <= 599 ? httpStatus : null,
      providerStatus: providerStatus && PROVIDER_STATUSES.has(providerStatus) ? providerStatus : null,
      setupCode: setupCode && Object.hasOwn(GOOGLE_ADS_SETUP_MESSAGES, setupCode) ? setupCode : null,
    }));
  } catch { /* Diagnostics must never alter account discovery or its safe errors. */ }
}

function invalidDirectory(phase: DirectoryPhase, reason: DirectoryReason) {
  logDirectoryFailure(phase, reason);
  return directoryError();
}

export const GOOGLE_ADS_SETUP_MESSAGES: Record<string, string> = {
  GOOGLE_ADS_TOKEN_PROJECT_REQUIRED: "Google has not authorized this app's Cloud project to use its Ads developer token. Vanteloq must resolve the token and project approval before customers can use Ads reporting.",
  GOOGLE_ADS_TOKEN_APPROVAL_REQUIRED: "The Google Ads developer token is not approved for this account type. Vanteloq must complete Google's production API approval; customer account consent alone is not enough.",
  GOOGLE_ADS_TOKEN_INVALID: "Google rejected Vanteloq's Ads developer token. The platform owner must verify the secure Google Ads setup.",
  GOOGLE_ADS_CUSTOMER_UNAVAILABLE: "This Google Ads account is inactive or has not completed its Google setup. Existing resource selections are unchanged.",
  GOOGLE_ADS_USER_PERMISSION_REQUIRED: "This Google user does not have the required Ads account access. Check the account's Google Ads permissions before reconnecting.",
  GOOGLE_ADS_SCOPE_REQUIRED: "Google Ads permission was not granted. Reconnect Google and explicitly allow Ads reporting.",
};

function safeProviderFailure(body: unknown) {
  const aliases: Record<string, string> = {
    DEVELOPER_TOKEN_PROHIBITED: "GOOGLE_ADS_TOKEN_PROJECT_REQUIRED",
    DEVELOPER_TOKEN_NOT_APPROVED: "GOOGLE_ADS_TOKEN_APPROVAL_REQUIRED",
    DEVELOPER_TOKEN_INVALID: "GOOGLE_ADS_TOKEN_INVALID",
    DEVELOPER_TOKEN_NOT_ON_ALLOWLIST: "GOOGLE_ADS_TOKEN_APPROVAL_REQUIRED",
    CUSTOMER_NOT_ENABLED: "GOOGLE_ADS_CUSTOMER_UNAVAILABLE",
    USER_PERMISSION_DENIED: "GOOGLE_ADS_USER_PERMISSION_REQUIRED",
    ACCESS_TOKEN_SCOPE_INSUFFICIENT: "GOOGLE_ADS_SCOPE_REQUIRED",
  };
  const data = body as { error?: { details?: Array<{ errors?: Array<{ errorCode?: Record<string, unknown> }> }> } } | null;
  if (Array.isArray(data?.error?.details)) for (const detail of data.error.details) {
    if (!Array.isArray(detail?.errors)) continue;
    for (const entry of detail.errors) for (const value of Object.values(entry?.errorCode ?? {})) {
      if (typeof value !== "string" || !Object.hasOwn(aliases, value)) continue;
      const code = aliases[value];
      return new ApiError(502, code, GOOGLE_ADS_SETUP_MESSAGES[code]);
    }
  }
  return directoryError();
}

async function directoryJson<T>(phase: DirectoryPhase, path: string, token: string, signal: AbortSignal, body?: unknown, manager: string | null = null): Promise<T> {
  let reason: DirectoryReason = "transport";
  let httpStatus: number | null = null;
  let providerStatus: string | null = null;
  try {
    const response = await fetch(`https://googleads.googleapis.com/${googleAdsVersion()}/${path}`, {
      method: body === undefined ? "GET" : "POST", redirect: "manual", cache: "no-store", signal,
      headers: { ...googleAdsHeaders(token, manager), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    httpStatus = response.status;
    // Workers does not support redirect: "error". Fail closed explicitly so
    // neither OAuth nor developer credentials can reach a redirect destination.
    if (response.status >= 300 && response.status < 400) {
      reason = "redirect_rejected";
      await response.body?.cancel().catch(() => undefined);
      throw directoryError();
    }
    reason = "body_missing";
    const reader = response.body?.getReader();
    if (!reader) throw directoryError();
    const decoder = new TextDecoder();
    let bytes = 0, text = "";
    try {
      for (;;) {
        reason = "body_read";
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 2_000_000) { reason = "body_limit"; throw directoryError(); }
        text += decoder.decode(chunk.value, { stream: true });
      }
      reason = "json_invalid";
      const body: unknown = JSON.parse(text + decoder.decode());
      if (!response.ok) {
        reason = "provider_rejected";
        const status = (body as { error?: { status?: unknown } } | null)?.error?.status;
        providerStatus = typeof status === "string" && PROVIDER_STATUSES.has(status) ? status : null;
        throw safeProviderFailure(body);
      }
      return body as T;
    } finally { await reader.cancel().catch(() => undefined); }
  } catch (error) {
    logDirectoryFailure(phase, reason, httpStatus, providerStatus, error instanceof ApiError ? error.code : null);
    if (error instanceof ApiError && Object.hasOwn(GOOGLE_ADS_SETUP_MESSAGES, error.code)) throw error;
    throw directoryError();
  }
}

/** Request-local discovery only: no tokens, manager routes or customer data are cached across users. */
export async function discoverGoogleAdsAccounts(token: string): Promise<AdsAccount[]> {
  googleAdsHeaders(token); // Fail before networking when configuration is absent.
  const signal = AbortSignal.timeout(30_000);
  const accessible = await directoryJson<{ resourceNames?: string[] }>("list", "customers:listAccessibleCustomers", token, signal);
  if (!accessible || (accessible.resourceNames !== undefined && !Array.isArray(accessible.resourceNames))) throw invalidDirectory("list", "roots_invalid");
  const roots = [...new Set(accessible.resourceNames ?? [])];
  if (roots.length > 25 || roots.some((ref) => typeof ref !== "string" || !CUSTOMER.test(ref))) throw invalidDirectory("list", "roots_invalid");
  const direct = new Set(roots);
  const accounts = new Map<string, AdsAccount>();
  function addAccount(ref: string, label: unknown, testAccount: boolean, root: string) {
    const id = ref.slice("customers/".length).replace(/(\d{3})(\d{3})(\d+)/, "$1-$2-$3");
    const name = typeof label === "string" ? label.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 160).trim() : "";
    if (!accounts.has(ref)) accounts.set(ref, {
      resourceRef: ref,
      name: `${name || "Google Ads"} · ${id}${testAccount ? " · Test account" : ""}`,
      loginCustomerId: direct.has(ref) ? null : root.slice("customers/".length),
      testAccount,
    });
    if (accounts.size > MAX_ACCOUNTS) throw invalidDirectory("hierarchy", "account_limit");
  }
  let requests = 0;
  for (const root of roots) {
    if (++requests > 60) throw invalidDirectory("identity", "request_limit");
    const identity = await directoryJson<{ results?: Array<{ customer?: { resourceName?: string; manager?: boolean; testAccount?: boolean; descriptiveName?: string } }> }>("identity", `${root}/googleAds:search`, token, signal, {
      query: "SELECT customer.resource_name, customer.manager, customer.descriptive_name, customer.test_account FROM customer LIMIT 1",
    });
    const customer = identity?.results?.[0]?.customer;
    if (customer?.resourceName !== root) throw invalidDirectory("identity", "identity_invalid");
    if (customer.manager !== true) {
      addAccount(root, customer.descriptiveName, customer.testAccount === true, root);
      continue;
    }
    let pageToken = "";
    const seen = new Set<string>();
    do {
      if (++requests > 60) throw invalidDirectory("hierarchy", "request_limit");
      // CustomerClient includes this customer plus directly and indirectly linked descendants.
      const page = await directoryJson<{ results?: ClientRow[]; nextPageToken?: string }>("hierarchy", `${root}/googleAds:search`, token, signal, {
        query: "SELECT customer_client.client_customer, customer_client.manager, customer_client.descriptive_name, customer_client.test_account FROM customer_client LIMIT 501",
        ...(pageToken ? { pageToken } : {}),
      }, root.slice("customers/".length));
      if (!page || (page.results !== undefined && (!Array.isArray(page.results) || page.results.length > MAX_ACCOUNTS))) throw invalidDirectory("hierarchy", "rows_invalid");
      for (const row of page.results ?? []) {
        const client = row?.customerClient;
        const ref = client?.clientCustomer;
        if (typeof ref !== "string" || !CUSTOMER.test(ref)) throw invalidDirectory("hierarchy", "reference_invalid");
        if (client?.manager === true) continue; // Managers cannot supply serving metrics.
        addAccount(ref, client?.descriptiveName, client?.testAccount === true, root);
      }
      const next = page.nextPageToken ?? "";
      if (typeof next !== "string" || next.length > 2_048 || (next && seen.has(next))) throw invalidDirectory("hierarchy", "page_invalid");
      if (next) seen.add(next);
      pageToken = next;
    } while (pageToken);
  }
  return [...accounts.values()];
}

export async function resolveGoogleAdsAccount(token: string, resourceRef: string) {
  if (!CUSTOMER.test(resourceRef)) throw new ApiError(409, "GOOGLE_ADS_SELECTION_INVALID", "The selected Google Ads account is invalid.");
  const account = (await discoverGoogleAdsAccounts(token)).find((entry) => entry.resourceRef === resourceRef);
  if (!account) throw new ApiError(409, "GOOGLE_ADS_ACCOUNT_UNAVAILABLE", "The selected advertising account is not accessible. Choose an available client account in Integrations.");
  return account;
}
