import { ApiError } from "../api";
const encoder = new TextEncoder();
export async function verifySyncSignature(secret: string | undefined, timestamp: string | null, nonce: string | null, signature: string | null, body: string, now = Date.now()) {
  if (!secret || secret.length < 32) throw new ApiError(503, "SYNC_SCHEDULER_UNAVAILABLE", "Background synchronization is unavailable.");
  if (!timestamp || !/^\d{10}$/.test(timestamp) || !nonce || !/^[a-f0-9-]{36}$/.test(nonce)
    || !signature || !/^[a-f0-9]{64}$/.test(signature) || Math.abs(now / 1000 - Number(timestamp)) > 90) {
    throw new ApiError(401, "SYNC_SIGNATURE_INVALID", "Invalid scheduler signature.");
  }
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const bytes = Uint8Array.from(signature.match(/../g)!, hex => parseInt(hex, 16));
  if (!await crypto.subtle.verify("HMAC", key, bytes, encoder.encode(timestamp + "." + nonce + "." + body))) {
    throw new ApiError(401, "SYNC_SIGNATURE_INVALID", "Invalid scheduler signature.");
  }
}

