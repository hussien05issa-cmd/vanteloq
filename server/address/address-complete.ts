import { getRuntimeEnv, type VanteloqRuntimeEnv } from "../../db/index.ts";
import { ApiError } from "../api.ts";

const ADDRESS_COMPLETE_ORIGIN = "https://ws1.postescanada-canadapost.ca";
const FIND_PATH = "/AddressComplete/Interactive/Find/v2.10/json3.ws";
const RETRIEVE_PATH = "/AddressComplete/Interactive/Retrieve/v2.11/json3.ws";
const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const COUNTRY_PATTERN = /^[A-Z]{2}$/;
const PROOF_LIFETIME_SECONDS = 30 * 60;

export type AddressCompleteSuggestion = {
  id: string;
  text: string;
  description: string;
  next: "Find" | "Retrieve";
};

export type VerifiedBusinessAddress = {
  providerId: string;
  address: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
  validationStatus: "validated";
};

type ProviderRow = Record<string, unknown>;

function cleanString(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function providerKey(explicit?: string): string {
  const value = (explicit ?? getRuntimeEnv().ADDRESSCOMPLETE_API_KEY ?? "").trim();
  if (!KEY_PATTERN.test(value)) {
    throw new ApiError(503, "ADDRESS_VERIFICATION_CONFIGURATION_REQUIRED", "Address verification is not configured yet.");
  }
  return value;
}

export function addressCompleteReadiness(env: Pick<VanteloqRuntimeEnv, "ADDRESSCOMPLETE_API_KEY"> = getRuntimeEnv()) {
  const key = env.ADDRESSCOMPLETE_API_KEY?.trim() ?? "";
  return {
    configured: KEY_PATTERN.test(key),
    provider: "canada_post_addresscomplete" as const,
  };
}

async function providerRows(url: URL, fetcher: typeof fetch): Promise<ProviderRow[]> {
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "GET",
      headers: { Accept: "application/json", "User-Agent": "Vanteloq-Address-Verification/1.0" },
      signal: AbortSignal.timeout(7_500),
    });
  } catch {
    throw new ApiError(503, "ADDRESS_VERIFICATION_UNAVAILABLE", "Address verification is temporarily unavailable.");
  }
  if (!response.ok) {
    throw new ApiError(502, "ADDRESS_VERIFICATION_PROVIDER_ERROR", "The address provider could not complete the request.");
  }
  const body = await response.json().catch(() => null) as { Items?: unknown } | null;
  const rows = Array.isArray(body?.Items)
    ? body.Items.filter((row): row is ProviderRow => Boolean(row) && !Array.isArray(row) && typeof row === "object")
    : [];
  if (rows.some((row) => cleanString(row.Error, 32))) {
    throw new ApiError(502, "ADDRESS_VERIFICATION_PROVIDER_ERROR", "The address provider could not complete the request.");
  }
  return rows;
}

export async function findAddressCompleteSuggestions(input: {
  search: string;
  country: string;
  lastId?: string;
  key?: string;
  fetcher?: typeof fetch;
}): Promise<AddressCompleteSuggestion[]> {
  const search = input.search.trim().slice(0, 180);
  const country = input.country.trim().toUpperCase();
  const lastId = input.lastId?.trim().slice(0, 512) ?? "";
  if ((!search && !lastId) || (search && search.length < 3) || !COUNTRY_PATTERN.test(country)) {
    throw new ApiError(400, "ADDRESS_SEARCH_INVALID", "Enter at least three address characters and select a valid country.");
  }
  const url = new URL(FIND_PATH, ADDRESS_COMPLETE_ORIGIN);
  url.search = new URLSearchParams({
    Key: providerKey(input.key),
    SearchTerm: search,
    Country: country,
    LanguagePreference: "en",
    MaxSuggestions: "7",
    ...(lastId ? { LastId: lastId } : {}),
  }).toString();
  const rows = await providerRows(url, input.fetcher ?? fetch);
  return rows.flatMap((row) => {
    const id = cleanString(row.Id, 512);
    const text = cleanString(row.Text, 240);
    const description = cleanString(row.Description, 240);
    const next: AddressCompleteSuggestion["next"] | null = row.Next === "Find" || row.Next === "Retrieve" ? row.Next : null;
    return id && text && next ? [{ id, text, description, next }] : [];
  }).slice(0, 7);
}

export async function retrieveAddressCompleteAddress(input: {
  id: string;
  key?: string;
  fetcher?: typeof fetch;
}): Promise<VerifiedBusinessAddress> {
  const id = input.id.trim();
  if (!id || id.length > 512 || /[\u0000-\u001f\u007f]/.test(id)) {
    throw new ApiError(400, "ADDRESS_REFERENCE_INVALID", "Select a valid address suggestion.");
  }
  const url = new URL(RETRIEVE_PATH, ADDRESS_COMPLETE_ORIGIN);
  url.search = new URLSearchParams({ Key: providerKey(input.key), Id: id }).toString();
  const row = (await providerRows(url, input.fetcher ?? fetch))[0];
  if (!row) {
    throw new ApiError(422, "ADDRESS_NOT_VERIFIED", "The selected address could not be verified.");
  }
  if (cleanString(row.DataLevel, 32) !== "Premise") {
    throw new ApiError(422, "ADDRESS_NOT_PREMISE_VERIFIED", "Select a complete street address, including the building number.");
  }
  const line1 = cleanString(row.Line1, 180);
  const line2 = cleanString(row.Line2, 120);
  const city = cleanString(row.City, 100);
  const province = cleanString(row.ProvinceCode, 80).toUpperCase();
  const postalCode = cleanString(row.PostalCode, 20).toUpperCase();
  const country = cleanString(row.CountryIso2, 2).toUpperCase();
  const providerId = cleanString(row.Id, 512) || id;
  if (!line1 || !city || !province || !postalCode || !COUNTRY_PATTERN.test(country)) {
    throw new ApiError(422, "ADDRESS_NOT_VERIFIED", "The selected address does not contain all required business location fields.");
  }
  return {
    providerId,
    address: [line1, line2].filter(Boolean).join(", "),
    city,
    province,
    postalCode,
    country,
    validationStatus: "validated",
  };
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function proofKey(key?: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`vanteloq:addresscomplete:proof:v1:${providerKey(key)}`),
  );
  return crypto.subtle.importKey("raw", material, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function createAddressVerificationToken(
  address: VerifiedBusinessAddress,
  key?: string,
  now = Date.now(),
): Promise<string> {
  const payload = new TextEncoder().encode(JSON.stringify({
    v: 1,
    exp: Math.floor(now / 1_000) + PROOF_LIFETIME_SECONDS,
    address,
  }));
  const body = encodeBase64Url(payload);
  const signature = await crypto.subtle.sign("HMAC", await proofKey(key), new TextEncoder().encode(body));
  return `${body}.${encodeBase64Url(new Uint8Array(signature))}`;
}

export async function verifyAddressVerificationToken(
  token: string,
  key?: string,
  now = Date.now(),
): Promise<VerifiedBusinessAddress> {
  if (!token || token.length > 8_192) {
    throw new ApiError(409, "ADDRESS_VERIFICATION_REQUIRED", "Select an address verified by Canada Post AddressComplete.");
  }
  try {
    const [body, signature, extra] = token.split(".");
    if (!body || !signature || extra) throw new Error("Malformed proof");
    const bodyBytes = decodeBase64Url(body);
    const signatureBytes = decodeBase64Url(signature);
    if (encodeBase64Url(bodyBytes) !== body || encodeBase64Url(signatureBytes) !== signature) {
      throw new Error("Non-canonical proof");
    }
    const valid = await crypto.subtle.verify(
      "HMAC",
      await proofKey(key),
      new Uint8Array(signatureBytes).buffer,
      new TextEncoder().encode(body),
    );
    if (!valid) throw new Error("Invalid proof");
    const parsed = JSON.parse(new TextDecoder().decode(bodyBytes)) as { v?: unknown; exp?: unknown; address?: unknown };
    if (parsed.v !== 1 || typeof parsed.exp !== "number" || parsed.exp < Math.floor(now / 1_000) || parsed.exp > Math.floor(now / 1_000) + PROOF_LIFETIME_SECONDS) {
      throw new Error("Expired proof");
    }
    const address = parsed.address as Partial<VerifiedBusinessAddress> | undefined;
    if (
      !address
      || address.validationStatus !== "validated"
      || typeof address.providerId !== "string"
      || typeof address.address !== "string"
      || typeof address.city !== "string"
      || typeof address.province !== "string"
      || typeof address.postalCode !== "string"
      || typeof address.country !== "string"
      || !address.providerId || !address.address || !address.city || !address.province || !address.postalCode
      || !COUNTRY_PATTERN.test(address.country)
    ) throw new Error("Incomplete proof");
    return address as VerifiedBusinessAddress;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(409, "ADDRESS_VERIFICATION_REQUIRED", "Select an address verified by Canada Post AddressComplete.");
  }
}
