export const DOCUMENT_EMAIL_NOTICE_VERSION = "document-email-cloudflare-2026-09-16";
export const DOCUMENT_EMAIL_NOTICE = "Enable a private forwarding address for this workspace. Vanteloq stores supported attachments in quarantine and records the sender address as unverified. Cloudflare processes delivery; Vanteloq does not keep the email body. Originals remain until deleted under the document retention rules. Forward only documents you are authorized to share. Scan and Read needs separate approval; email never posts accounting entries or sends documents to AI.";
export const DOCUMENT_EMAIL_DOMAIN = "documents.vanteloq.com";
export const DOCUMENT_EMAIL_PATH = "/api/v1/documents/email/deliver";
export const DOCUMENT_EMAIL_ENDPOINT = `https://vanteloq.com${DOCUMENT_EMAIL_PATH}`;
export const DOCUMENT_EMAIL_MAX_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_EMAIL_MAX_FILES = 5;
export const DOCUMENT_EMAIL_MAX_BODY = 14 * 1024 * 1024 + 65536;
export const DOCUMENT_EMAIL_MAX_RAW = 15 * 1024 * 1024;

export function documentFileType(bytes: Uint8Array, declared: string) {
  if (bytes[0] === 37 && bytes[1] === 80 && bytes[2] === 68 && bytes[3] === 70 && declared === "application/pdf") return { type: "application/pdf", extension: "pdf" };
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && ["image/jpeg", "image/jpg"].includes(declared)) return { type: "image/jpeg", extension: "jpg" };
  if ([137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v) && declared === "image/png") return { type: "image/png", extension: "png" };
  const prefix = new TextDecoder().decode(bytes.slice(0,12));
  if (prefix.startsWith("RIFF") && prefix.slice(8,12) === "WEBP" && declared === "image/webp") return { type: "image/webp", extension: "webp" };
  return null;
}
export function documentFileName(value: string) {
  return value.normalize("NFC").replace(/[\u0000-\u001f\u007f/\\]/g,"_").slice(0,160) || "document";
}
export async function documentDigest(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2,"0")).join("");
}
export async function emailSignature(secret: string, timestamp: string, deliveryId: string, digest: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const result = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`v1\nPOST\n${DOCUMENT_EMAIL_PATH}\n${timestamp}\n${deliveryId}\n${digest}`));
  return Array.from(new Uint8Array(result), value => value.toString(16).padStart(2,"0")).join("");
}
