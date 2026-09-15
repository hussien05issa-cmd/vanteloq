import type { VanteloqRuntimeEnv } from "../db/index.ts";
import { DocumentProviderError } from "./document-errors.ts";

export type AzureScanOperation = { blobName: string; etag: string; submittedAt: number; size: number; sha256: string };
const CONTAINER = "document-scans";
const encoder = new TextEncoder();
const extensions: Record<string, string> = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export function scannerConfiguration(env: VanteloqRuntimeEnv) {
  try {
    const url = new URL(env.AZURE_DOCUMENT_SCAN_ENDPOINT || "");
    if (url.protocol !== "https:" || !/^[a-z0-9]{3,24}\.blob\.core\.windows\.net$/.test(url.hostname) || url.port || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return false;
    return Boolean(env.AZURE_DOCUMENT_SCAN_KEY && /^[A-Za-z0-9+/]{86}==$/.test(env.AZURE_DOCUMENT_SCAN_KEY));
  } catch { return false; }
}

/** Azure Shared Key requests stay on one server-configured, dedicated storage account. */
export async function storageAuthorization(url: URL, method: string, headers: Headers, accountKey: string, length = 0) {
  const account = url.hostname.split(".")[0];
  const canonicalHeaders = Array.from(headers.entries()).filter(([name]) => name.startsWith("x-ms-")).sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => `${name}:${value.trim()}\n`).join("");
  const queries = Array.from(new Set(Array.from(url.searchParams.keys(), key => key.toLowerCase()))).sort().map(key => `\n${key}:${url.searchParams.getAll(key).sort().join(",")}`).join("");
  const stringToSign = [method, headers.get("Content-Encoding") || "", headers.get("Content-Language") || "", length ? String(length) : "", headers.get("Content-MD5") || "", headers.get("Content-Type") || "", "", headers.get("If-Modified-Since") || "", headers.get("If-Match") || "", headers.get("If-None-Match") || "", headers.get("If-Unmodified-Since") || "", headers.get("Range") || ""].join("\n") + `\n${canonicalHeaders}/${account}${url.pathname}${queries}`;
  const key = await crypto.subtle.importKey("raw", Uint8Array.from(atob(accountKey), char => char.charCodeAt(0)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(stringToSign)));
  return `SharedKey ${account}:${btoa(String.fromCharCode(...signature))}`;
}

function operationUrl(env: VanteloqRuntimeEnv, operation: Pick<AzureScanOperation, "blobName">) {
  if (!scannerConfiguration(env)) throw new DocumentProviderError("PROVIDER_NOT_CONFIGURED");
  if (!/^scan\/[a-f0-9-]{36}\.(pdf|png|jpg|webp)$/.test(operation.blobName)) throw new DocumentProviderError("SCAN_REFERENCE_INVALID");
  return new URL(`/${CONTAINER}/${operation.blobName}`, env.AZURE_DOCUMENT_SCAN_ENDPOINT);
}

async function request(env: VanteloqRuntimeEnv, url: URL, method: string, options: { headers?: Record<string, string>; bytes?: Uint8Array; missingOkay?: boolean } = {}, transport: typeof fetch = fetch) {
  const headers = new Headers({ "x-ms-version": "2023-11-03", "x-ms-date": new Date().toUTCString(), ...options.headers });
  const bytes = options.bytes;
  if (bytes) headers.set("Content-Length", String(bytes.byteLength));
  headers.set("Authorization", await storageAuthorization(url, method, headers, env.AZURE_DOCUMENT_SCAN_KEY!, bytes?.byteLength));
  try {
    // Workers supports manual redirects. Non-success responses below reject every
    // redirect without sending the signed request or document to another URL.
    const response = await transport(url.toString(), { method, headers, body: bytes ? new Uint8Array(bytes) : undefined, redirect: "manual", signal: AbortSignal.timeout(25_000) });
    if (response.ok || (options.missingOkay && response.status === 404)) return response;
    const serviceCode = response.headers.get("x-ms-error-code") || "Unknown";
    console.error("DOCUMENT_STORAGE_REQUEST_FAILED", { method, status: response.status, serviceCode: /^[A-Za-z]{1,80}$/.test(serviceCode) ? serviceCode : "Unknown" });
    throw new DocumentProviderError(response.status === 401 || response.status === 403 ? "PROVIDER_ACCESS_DENIED" : response.status === 429 || response.status === 503 ? "PROVIDER_RATE_LIMIT" : response.status === 412 ? "DOCUMENT_CHANGED" : "PROVIDER_UNAVAILABLE");
  } catch (error) {
    if (error instanceof DocumentProviderError) throw error;
    throw new DocumentProviderError("PROVIDER_UNAVAILABLE");
  }
}

export async function beginAzureScan(env: VanteloqRuntimeEnv, bytes: Uint8Array, contentType: string, sha256: string, transport?: typeof fetch) {
  if (!extensions[contentType] || !/^[a-f0-9]{64}$/.test(sha256) || !bytes.length || bytes.length > 10 * 1024 * 1024) throw new DocumentProviderError("DOCUMENT_FORMAT_UNSUPPORTED");
  const operation: AzureScanOperation = { blobName: `scan/${crypto.randomUUID()}.${extensions[contentType]}`, etag: "", submittedAt: Date.now(), size: bytes.length, sha256 };
  const response = await request(env, operationUrl(env, operation), "PUT", { bytes, headers: { "Content-Type": contentType, "x-ms-blob-type": "BlockBlob", "x-ms-meta-sha256": sha256, "If-None-Match": "*" } }, transport);
  const etag = response.headers.get("etag");
  if (response.status !== 201 || !etag || !/^"[A-Za-z0-9x-]{1,100}"$/.test(etag)) throw new DocumentProviderError("SCAN_RESULT_UNKNOWN");
  return { ...operation, etag };
}

const decodeXml = (value: string) => value.replace(/&(?:amp|lt|gt|quot|apos);/g, entity => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" })[entity]!);
export function parseScannerTags(xml: string) {
  if (xml.length > 32_000 || /<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(xml) || !/<Tags(?:\s[^>]*)?>/.test(xml)) throw new DocumentProviderError("SCAN_RESULT_UNKNOWN");
  const tags: Record<string, string> = {};
  for (const entry of xml.matchAll(/<Tag>\s*<Key>([^<]*)<\/Key>\s*<Value>([^<]*)<\/Value>\s*<\/Tag>/g)) {
    const key = decodeXml(entry[1]).toLowerCase(), value = decodeXml(entry[2]);
    if (Object.hasOwn(tags, key)) throw new DocumentProviderError("SCAN_RESULT_UNKNOWN");
    tags[key] = value;
  }
  return tags;
}

export async function pollAzureScan(env: VanteloqRuntimeEnv, operation: AzureScanOperation, transport?: typeof fetch): Promise<"clean" | "blocked" | null> {
  const url = operationUrl(env, operation);
  if (!operation.etag || !Number.isSafeInteger(operation.submittedAt) || !Number.isSafeInteger(operation.size) || operation.size < 1 || !/^[a-f0-9]{64}$/.test(operation.sha256)) throw new DocumentProviderError("SCAN_REFERENCE_INVALID");
  if (Date.now() - operation.submittedAt > 10 * 60_000 || operation.submittedAt > Date.now() + 60_000) throw new DocumentProviderError("SCAN_TIMED_OUT");
  const assertIdentity = (response: Response) => {
    if (response.headers.get("etag") !== operation.etag || response.headers.get("x-ms-meta-sha256") !== operation.sha256 || Number(response.headers.get("content-length")) !== operation.size) throw new DocumentProviderError("DOCUMENT_CHANGED");
  };
  assertIdentity(await request(env, url, "HEAD", { headers: { "If-Match": operation.etag } }, transport));
  const tagsUrl = new URL(url); tagsUrl.searchParams.set("comp", "tags");
  const response = await request(env, tagsUrl, "GET", {}, transport);
  const tags = parseScannerTags(await response.text());
  const result = tags["malware scanning scan result"];
  if (!result) return null;
  const scanTime = Date.parse(tags["malware scanning scan time utc"] || "");
  if (!Number.isFinite(scanTime) || scanTime < operation.submittedAt - 60_000 || scanTime > Date.now() + 60_000) throw new DocumentProviderError("SCAN_RESULT_UNKNOWN");
  // Tags do not change the blob ETag. Recheck the bytes' identity after reading the verdict.
  assertIdentity(await request(env, url, "HEAD", { headers: { "If-Match": operation.etag } }, transport));
  if (result === "No threats found") return "clean";
  if (result === "Malicious") return "blocked";
  throw new DocumentProviderError("SCAN_NOT_COMPLETED");
}

export async function deleteAzureScan(env: VanteloqRuntimeEnv, operation: AzureScanOperation, transport?: typeof fetch) {
  if (!operation.etag) throw new DocumentProviderError("SCAN_REFERENCE_INVALID");
  await request(env, operationUrl(env, operation), "DELETE", { headers: { "If-Match": operation.etag }, missingOkay: true }, transport);
}
