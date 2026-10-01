import { ApiError, hashIdentifier } from "./api.ts";
import type { AdvisorCurrentTurn } from "../domain/advisor-personalization.ts";
import type { VanteloqRuntimeEnv } from "../db/index.ts";
const encoder = new TextEncoder();
type Claims = { v: 1; expires: number; binding: string; digest: string; files: boolean; conversationId: string | null; at: string };
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
function decode(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("encoding");
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), c => c.charCodeAt(0));
}
async function key(env: VanteloqRuntimeEnv) {
  let raw: Uint8Array;
  try { raw = Uint8Array.from(atob(env.INTEGRATION_ENCRYPTION_KEY ?? ""), c => c.charCodeAt(0)); } catch { throw new Error("key unavailable"); }
  if (raw.length !== 32) throw new Error("key unavailable");
  const master = await crypto.subtle.importKey("raw", new Uint8Array(raw).buffer, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({name:"HKDF",hash:"SHA-256",salt:encoder.encode("vanteloq-advisor-v1"),info:encoder.encode("current-conversation-proof")}, master, {name:"HMAC",hash:"SHA-256",length:256}, false, ["sign","verify"]);
}
export async function currentChatBinding(actor: unknown, stamp: string, scope: unknown) {
  return hashIdentifier(JSON.stringify({actor,stamp,scope}));
}
export async function signAdvisorTurn(env: VanteloqRuntimeEnv, binding: string, question: string, answer: string, files: boolean, conversationId: string | null, now = Date.now()) {
  const claims: Claims = {v:1,expires:now+30*60_000,binding,digest:await hashIdentifier(JSON.stringify([question,answer])),files,conversationId,at:new Date(now).toISOString()};
  const payload = encode(encoder.encode(JSON.stringify(claims)));
  try { return payload + "." + encode(new Uint8Array(await crypto.subtle.sign("HMAC",await key(env),encoder.encode(payload)))); }
  catch { return null; } // A missing signing key disables ephemeral continuation, never authorization.
}
export async function verifyAdvisorTurns(env: VanteloqRuntimeEnv, binding: string, input: unknown, exists: (id: string) => Promise<boolean>, now = Date.now()) {
  const fail = () => new ApiError(409,"ADVISOR_CHAT_EXPIRED","This chat context has expired or your access changed. Start a new chat to use your current records.");
  if (input === undefined || input === null) return {messages:[] as Array<{role:string;content:string}>,files:false};
  if (!Array.isArray(input) || input.length>6 || encoder.encode(JSON.stringify(input)).length>23_000) throw fail();
  const messages: Array<{role:string;content:string}> = []; let files = false;
  for (const item of input) {
    try {
      const t = item as AdvisorCurrentTurn;
      if (!t || typeof t.question!=="string" || typeof t.answer!=="string" || typeof t.proof!=="string" || t.proof.length>2048) throw fail();
      const parts=t.proof.split("."); if(parts.length!==2) throw fail();
      if (!await crypto.subtle.verify("HMAC",await key(env),decode(parts[1]),encoder.encode(parts[0]))) throw fail();
      const c=JSON.parse(new TextDecoder().decode(decode(parts[0]))) as Claims;
      if(c.v!==1 || c.expires<=now || c.expires>now+30*60_000 || c.binding!==binding || c.digest!==await hashIdentifier(JSON.stringify([t.question,t.answer]))) throw fail();
      if(c.conversationId && !await exists(c.conversationId)) throw fail();
      files ||= c.files;
      messages.push({role:"user",content:t.question},{role:"assistant",content:`Earlier reply (${c.at}; historical, not current evidence${c.files ? "; includes an attachment summary, original file not available" : ""}):\n${t.answer}`});
    } catch { throw fail(); }
  }
  return {messages:messages.slice(-6),files};
}
