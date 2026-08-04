import { ApiError } from "./api";

const encoder = new TextEncoder();
const weakPins = new Set(["000000", "111111", "123456", "654321", "121212", "112233", "12345678", "87654321"]);

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

export function validateTemporaryPin(value: unknown): string {
  if (typeof value !== "string" || !/^\d{6,8}$/.test(value) || weakPins.has(value)) {
    throw new ApiError(400, "WEAK_PIN", "Use a unique six-to-eight digit PIN that is not common or sequential.");
  }
  const ascending = "01234567890123456789".includes(value);
  const descending = "98765432109876543210".includes(value);
  if (ascending || descending || new Set(value).size === 1) {
    throw new ApiError(400, "WEAK_PIN", "Use a unique six-to-eight digit PIN that is not common or sequential.");
  }
  return value;
}

export async function hashPin(pin: string, salt = crypto.getRandomValues(new Uint8Array(16)), iterations = 210_000) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return { saltHex: hex(salt), hashHex: hex(new Uint8Array(derived)), iterations };
}
