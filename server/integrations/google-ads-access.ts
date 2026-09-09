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

async function directoryJson<T>(path: string, token: string, signal: AbortSignal, body?: unknown, manager: string | null = null): Promise<T> {
  try {
    const response = await fetch(`https://googleads.googleapis.com/${googleAdsVersion()}/${path}`, {
      method: body === undefined ? "GET" : "POST", redirect: "error", cache: "no-store", signal,
      headers: { ...googleAdsHeaders(token, manager), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) { await response.body?.cancel(); throw directoryError(); }
    const reader = response.body?.getReader();
    if (!reader) throw directoryError();
    const decoder = new TextDecoder();
    let bytes = 0, text = "";
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 2_000_000) throw directoryError();
        text += decoder.decode(chunk.value, { stream: true });
      }
      return JSON.parse(text + decoder.decode()) as T;
    } finally { await reader.cancel().catch(() => undefined); }
  } catch { throw directoryError(); }
}

/** Request-local discovery only: no tokens, manager routes or customer data are cached across users. */
export async function discoverGoogleAdsAccounts(token: string): Promise<AdsAccount[]> {
  googleAdsHeaders(token); // Fail before networking when configuration is absent.
  const signal = AbortSignal.timeout(30_000);
  const accessible = await directoryJson<{ resourceNames?: string[] }>("customers:listAccessibleCustomers", token, signal);
  if (accessible.resourceNames !== undefined && !Array.isArray(accessible.resourceNames)) throw directoryError();
  const roots = [...new Set(accessible.resourceNames ?? [])];
  if (roots.length > 25 || roots.some((ref) => typeof ref !== "string" || !CUSTOMER.test(ref))) throw directoryError();
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
    if (accounts.size > MAX_ACCOUNTS) throw directoryError();
  }
  let requests = 0;
  for (const root of roots) {
    if (++requests > 60) throw directoryError();
    const identity = await directoryJson<{ results?: Array<{ customer?: { resourceName?: string; manager?: boolean; testAccount?: boolean; descriptiveName?: string } }> }>(`${root}/googleAds:search`, token, signal, {
      query: "SELECT customer.resource_name, customer.manager, customer.descriptive_name, customer.test_account FROM customer LIMIT 1",
    });
    const customer = identity.results?.[0]?.customer;
    if (customer?.resourceName !== root) throw directoryError();
    if (customer.manager !== true) {
      addAccount(root, customer.descriptiveName, customer.testAccount === true, root);
      continue;
    }
    let pageToken = "";
    const seen = new Set<string>();
    do {
      if (++requests > 60) throw directoryError();
      // CustomerClient includes this customer plus directly and indirectly linked descendants.
      const page = await directoryJson<{ results?: ClientRow[]; nextPageToken?: string }>(`${root}/googleAds:search`, token, signal, {
        query: "SELECT customer_client.client_customer, customer_client.manager, customer_client.descriptive_name, customer_client.test_account FROM customer_client LIMIT 501",
        ...(pageToken ? { pageToken } : {}),
      }, root.slice("customers/".length));
      if (page.results !== undefined && (!Array.isArray(page.results) || page.results.length > MAX_ACCOUNTS)) throw directoryError();
      for (const row of page.results ?? []) {
        const client = row.customerClient;
        const ref = client?.clientCustomer;
        if (typeof ref !== "string" || !CUSTOMER.test(ref)) throw directoryError();
        if (client?.manager === true) continue; // Managers cannot supply serving metrics.
        addAccount(ref, client?.descriptiveName, client?.testAccount === true, root);
      }
      const next = page.nextPageToken ?? "";
      if (typeof next !== "string" || next.length > 2_048 || (next && seen.has(next))) throw directoryError();
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
