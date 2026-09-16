import { getD1, getRuntimeEnv } from "../db/index.ts";
import { ApiError, clientSource, enforceRateLimit, hashIdentifier, type TrustedIdentity } from "./api.ts";
import { MARKETING_NOTICE_VERSION, MARKETING_PURPOSE, MARKETING_WITHDRAWAL, type MarketingConfig, type MarketingPreference, type MarketingStatus } from "../shared/communications.ts";

const DAY = 86_400;
const cookieName = (request: Request) => new URL(request.url).protocol === "https:" ? "__Host-vanteloq_marketing_intent" : "vanteloq_marketing_intent";
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;
const nowSeconds = () => Math.floor(Date.now() / 1_000);
type PreferenceRow = { email_hash: string; subject_hash: string | null; status: Exclude<MarketingStatus, "not_chosen">; current_event_id: string; updated_at: number };
type IntentRow = { token_hash: string; email_hash: string; selected: number; notice_json: string; created_at: number; source_hash: string | null; user_agent_hash: string | null };

function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
}

function encryptionMaterial() {
  try {
    const raw = Uint8Array.from(atob(getRuntimeEnv().INTEGRATION_ENCRYPTION_KEY?.trim() ?? ""), value => value.charCodeAt(0));
    if (raw.byteLength !== 32) throw new Error("Invalid key length");
    return raw;
  } catch { throw new ApiError(503, "EMAIL_PREFERENCES_UNAVAILABLE", "Email preferences are temporarily unavailable. Please try again."); }
}

async function sealEmail(email: string) {
  const raw = encryptionMaterial();
  const key = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode("vanteloq:marketing-email:v1") }, key, new TextEncoder().encode(email));
  const encode = (value: Uint8Array) => btoa(String.fromCharCode(...value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return `v1.${encode(iv)}.${encode(new Uint8Array(ciphertext))}`;
}

function verifiedEmail(identity: TrustedIdentity) {
  if (identity.provider !== "supabase" || !identity.subject || !identity.emailVerified) {
    throw new ApiError(401, "VERIFIED_EMAIL_REQUIRED", "Verify your email before saving this preference.");
  }
  return identity.email.trim().toLowerCase();
}

// Purpose-separated keyed hashes resist guessing email addresses from retained
// suppression records. Keep the existing encryption key stable during rotation,
// or migrate both ciphertext and these lookup hashes before removing its old value.
async function privateHash(kind: string, value: string) {
  const key = await crypto.subtle.importKey("raw", encryptionMaterial(), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`vanteloq-communications-v1:${kind}:${value}`));
  return Array.from(new Uint8Array(signed), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function marketingConfig(): Promise<MarketingConfig> {
  const env = getRuntimeEnv();
  const postalAddress = env.NEWSLETTER_SENDER_POSTAL_ADDRESS?.trim().replace(/\s+/g, " ") || null;
  const validAddress = Boolean(postalAddress && postalAddress.length >= 12 && postalAddress.length <= 400 && !/[<>\u0000-\u001f]|example|placeholder|to be confirmed/i.test(postalAddress));
  let validKey = false;
  try { validKey = encryptionMaterial().byteLength === 32; } catch { /* Public readiness never exposes secret configuration details. */ }
  const base = {
    noticeVersion: MARKETING_NOTICE_VERSION,
    senderName: "LexEdge Consulting, operating as Vanteloq",
    postalAddress: validAddress ? postalAddress : null,
    contactUrl: "https://vanteloq.com/contact",
    purpose: MARKETING_PURPOSE,
    withdrawal: MARKETING_WITHDRAWAL,
  };
  return {
    ...base,
    available: env.NEWSLETTER_ENROLLMENT_ENABLED === "true" && Boolean(env.DB && validKey && validAddress),
    noticeHash: validAddress ? await hashIdentifier(JSON.stringify(base)) : null,
  };
}

async function checkedNotice(input: Record<string, unknown>) {
  const config = await marketingConfig();
  if (!config.available) throw new ApiError(503, "NEWSLETTER_UNAVAILABLE", "Email updates are not available yet. You can continue without subscribing.");
  if (input.noticeVersion !== config.noticeVersion || input.noticeHash !== config.noticeHash) {
    throw new ApiError(409, "MARKETING_NOTICE_CHANGED", "The email notice changed. Refresh it before saving your choice.");
  }
  return JSON.stringify(config);
}

async function evidence(request: Request) {
  const source = clientSource(request);
  const agent = request.headers.get("user-agent")?.slice(0, 512);
  return {
    sourceHash: source === "unknown" ? null : await privateHash("source", source),
    userAgentHash: agent ? await privateHash("agent", agent) : null,
  };
}

export function marketingIntentCookie(request: Request, token: string | null) {
  return `${cookieName(request)}=${token ?? ""}; Path=/; Max-Age=${token ? 7 * DAY : 0}; HttpOnly; SameSite=Lax${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}

function readIntentToken(request: Request) {
  const name = cookieName(request);
  const value = request.headers.get("cookie")?.split(";").map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.slice(name.length + 1) ?? "";
  return TOKEN_PATTERN.test(value) ? value : null;
}

export async function saveMarketingIntent(request: Request, input: Record<string, unknown>) {
  if (Object.keys(input).some(key => !["email", "selected", "noticeVersion", "noticeHash"].includes(key)) || typeof input.email !== "string" || typeof input.selected !== "boolean") {
    throw new ApiError(400, "INVALID_MARKETING_CHOICE", "Choose whether to receive email updates.");
  }
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw new ApiError(400, "INVALID_EMAIL", "Enter a valid email address.");
  const notice = await checkedNotice(input);
  const source = clientSource(request);
  await enforceRateLimit("marketing-intent:source", source, 15, 3_600);
  const emailHash = await privateHash("email", email);
  await enforceRateLimit("marketing-intent:email", emailHash, 6, 3_600);
  const token = randomToken();
  const tokenHash = await hashIdentifier(`marketing-intent:${token}`);
  const previous = readIntentToken(request);
  const requestEvidence = await evidence(request);
  const now = nowSeconds();
  const db = getD1();
  await db.batch([
    db.prepare("DELETE FROM marketing_email_intents WHERE expires_at <= ?").bind(now),
    ...(previous ? [db.prepare("DELETE FROM marketing_email_intents WHERE token_hash = ?").bind(await hashIdentifier(`marketing-intent:${previous}`))] : []),
    db.prepare("INSERT INTO marketing_email_intents (token_hash, email_hash, selected, notice_json, created_at, expires_at, source_hash, user_agent_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(tokenHash, emailHash, input.selected ? 1 : 0, notice, now, now + 7 * DAY, requestEvidence.sourceHash, requestEvidence.userAgentHash),
  ]);
  return token;
}

async function currentRow(emailHash: string) {
  return getD1().prepare("SELECT email_hash, subject_hash, status, current_event_id, updated_at FROM marketing_email_preferences WHERE email_hash = ?").bind(emailHash).first<PreferenceRow>();
}

async function retirePreviousEmail(identity: TrustedIdentity) {
  const emailHash = await privateHash("email", verifiedEmail(identity));
  const subjectHash = await privateHash("subject", identity.subject!);
  const eventPrefix = `email-change:${crypto.randomUUID()}:`;
  const now = nowSeconds();
  const db = getD1();
  await db.batch([
    db.prepare("INSERT INTO marketing_email_events (id, email_hash, subject_hash, action, source, notice_json, occurred_at, intent_at, source_hash, user_agent_hash) SELECT ? || email_hash, email_hash, subject_hash, 'unsubscribed', 'verified_email_change', '{}', ?, NULL, NULL, NULL FROM marketing_email_preferences WHERE subject_hash = ? AND email_hash <> ? AND status = 'subscribed'").bind(eventPrefix, now, subjectHash, emailHash),
    db.prepare("UPDATE marketing_email_preferences SET status = 'unsubscribed', email_encrypted = NULL, current_event_id = ? || email_hash, updated_at = ? WHERE subject_hash = ? AND email_hash <> ? AND status = 'subscribed'").bind(eventPrefix, now, subjectHash, emailHash),
  ]);
}

export async function readMarketingPreference(identity: TrustedIdentity): Promise<MarketingPreference> {
  const emailHash = await privateHash("email", verifiedEmail(identity));
  const row = await currentRow(emailHash);
  const subjectHash = await privateHash("subject", identity.subject!);
  // The verified owner can opt out an address even if an older identity owned its
  // consent. A consent grant from an older account is never inherited as active.
  const owned = row?.subject_hash === subjectHash;
  const status = row?.status === "subscribed" && !owned ? "not_chosen" : row?.status ?? "not_chosen";
  return { status, chosen: status !== "not_chosen", subscribed: status === "subscribed", revision: row?.current_event_id ?? null, updatedAt: row?.updated_at ?? null, config: await marketingConfig() };
}

export async function claimMarketingIntent(request: Request, identity: TrustedIdentity) {
  const email = verifiedEmail(identity);
  await retirePreviousEmail(identity);
  const emailHash = await privateHash("email", email);
  const subjectHash = await privateHash("subject", identity.subject!);
  const token = readIntentToken(request);
  if (!token) return readMarketingPreference(identity);
  const tokenHash = await hashIdentifier(`marketing-intent:${token}`);
  const now = nowSeconds();
  const db = getD1();
  const draft = await db.prepare("SELECT * FROM marketing_email_intents WHERE token_hash = ? AND email_hash = ? AND expires_at > ?").bind(tokenHash, emailHash, now).first<IntentRow>();
  if (!draft) return readMarketingPreference(identity);
  const config = await marketingConfig();
  const priorNotice = JSON.parse(draft.notice_json) as MarketingConfig;
  if (!config.available || config.noticeHash !== priorNotice.noticeHash) {
    await db.prepare("DELETE FROM marketing_email_intents WHERE token_hash = ?").bind(tokenHash).run();
    return readMarketingPreference(identity);
  }
  const eventId = crypto.randomUUID();
  const status = draft.selected === 1 ? "subscribed" : "declined";
  const encryptedEmail = draft.selected === 1 ? await sealEmail(email) : null;
  // A draft never overwrites an existing opt-out or a later Settings decision.
  // D1 batch atomically creates the first choice and its matching evidence.
  await db.batch([
    db.prepare("INSERT INTO marketing_email_preferences (email_hash, subject_hash, email_encrypted, status, current_event_id, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(email_hash) DO NOTHING")
      .bind(emailHash, subjectHash, encryptedEmail, status, eventId, now),
    db.prepare("INSERT INTO marketing_email_events (id, email_hash, subject_hash, action, source, notice_json, occurred_at, intent_at, source_hash, user_agent_hash) SELECT ?, ?, ?, ?, 'signup_verified', ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM marketing_email_preferences WHERE email_hash = ? AND current_event_id = ?)")
      .bind(eventId, emailHash, subjectHash, status, draft.notice_json, now, draft.created_at, draft.source_hash, draft.user_agent_hash, emailHash, eventId),
    db.prepare("DELETE FROM marketing_email_intents WHERE token_hash = ?").bind(tokenHash),
  ]);
  return readMarketingPreference(identity);
}

export async function setMarketingPreference(request: Request, identity: TrustedIdentity, input: Record<string, unknown>) {
  if (Object.keys(input).some(key => !["selected", "noticeVersion", "noticeHash", "revision", "source"].includes(key)) || typeof input.selected !== "boolean" || !(input.revision === null || typeof input.revision === "string") || !["onboarding", "settings"].includes(String(input.source))) {
    throw new ApiError(400, "INVALID_MARKETING_CHOICE", "Choose whether to receive email updates.");
  }
  const email = verifiedEmail(identity);
  await retirePreviousEmail(identity);
  const emailHash = await privateHash("email", email);
  const subjectHash = await privateHash("subject", identity.subject!);
  await enforceRateLimit("marketing-choice:user", subjectHash, 30, 3_600);
  const existing = await currentRow(emailHash);
  if ((existing?.current_event_id ?? null) !== input.revision) throw new ApiError(409, "PREFERENCE_CHANGED", "Your preference changed in another session. Refresh it before saving.");
  if (input.selected && existing?.status === "suppressed") throw new ApiError(409, "EMAIL_SUPPRESSED", "Email delivery is paused for this address. Contact support to review it.");
  const notice = input.selected ? await checkedNotice(input) : JSON.stringify(await marketingConfig());
  const eventId = crypto.randomUUID();
  const status = input.selected ? "subscribed" : existing?.status === "suppressed" ? "suppressed" : "unsubscribed";
  const encryptedEmail = input.selected ? await sealEmail(email) : null;
  const proof = await evidence(request);
  const now = nowSeconds();
  const db = getD1();
  const write = existing
    ? db.prepare("UPDATE marketing_email_preferences SET subject_hash = ?, email_encrypted = ?, status = ?, current_event_id = ?, updated_at = ? WHERE email_hash = ? AND current_event_id = ?").bind(subjectHash, encryptedEmail, status, eventId, now, emailHash, input.revision)
    : db.prepare("INSERT INTO marketing_email_preferences (email_hash, subject_hash, email_encrypted, status, current_event_id, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(email_hash) DO NOTHING").bind(emailHash, subjectHash, encryptedEmail, status, eventId, now);
  await db.batch([
    write,
    db.prepare("INSERT INTO marketing_email_events (id, email_hash, subject_hash, action, source, notice_json, occurred_at, intent_at, source_hash, user_agent_hash) SELECT ?, ?, ?, ?, ?, ?, ?, NULL, ?, ? WHERE EXISTS (SELECT 1 FROM marketing_email_preferences WHERE email_hash = ? AND current_event_id = ?)")
      .bind(eventId, emailHash, subjectHash, status, input.source, notice, now, proof.sourceHash, proof.userAgentHash, emailHash, eventId),
  ]);
  if ((await currentRow(emailHash))?.current_event_id !== eventId) throw new ApiError(409, "PREFERENCE_CHANGED", "Your preference changed in another session. Refresh it before saving.");
  return readMarketingPreference(identity);
}

// This is the only eligibility contract prepared for future dispatch. It takes a
// currently verified identity, never an arbitrary imported address or tenant list.
// No marketing send or recipient export is implemented by this feature.
export async function marketingEmailEligible(identity: TrustedIdentity) {
  if (!(await marketingConfig()).available) return false;
  await retirePreviousEmail(identity);
  const emailHash = await privateHash("email", verifiedEmail(identity));
  const subjectHash = await privateHash("subject", identity.subject!);
  const row = await currentRow(emailHash);
  return row?.status === "subscribed" && row.subject_hash === subjectHash;
}

export async function issueMarketingUnsubscribeToken(identity: TrustedIdentity) {
  if (!await marketingEmailEligible(identity)) throw new ApiError(409, "EMAIL_NOT_SUBSCRIBED", "This address is not subscribed to email updates.");
  const token = randomToken();
  const emailHash = await privateHash("email", verifiedEmail(identity));
  const now = nowSeconds();
  await getD1().prepare("INSERT INTO marketing_email_unsubscribe_tokens (token_hash, email_hash, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await hashIdentifier(`marketing-unsubscribe:${token}`), emailHash, now, now + 400 * DAY).run();
  return token;
}

export async function unsubscribeMarketingEmail(token: unknown) {
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) throw new ApiError(400, "UNSUBSCRIBE_LINK_INVALID", "This unsubscribe link is incomplete. Use a link from a recent email or our contact form.");
  const now = nowSeconds();
  const db = getD1();
  const tokenHash = await hashIdentifier(`marketing-unsubscribe:${token}`);
  const receipt = await db.prepare("SELECT email_hash FROM marketing_email_unsubscribe_tokens WHERE token_hash = ? AND expires_at > ?").bind(tokenHash, now).first<{ email_hash: string }>();
  if (!receipt) throw new ApiError(400, "UNSUBSCRIBE_LINK_INVALID", "This unsubscribe link has expired. Use a link from a recent email or our contact form.");
  const existing = await currentRow(receipt.email_hash);
  if (!existing) return;
  const eventId = crypto.randomUUID();
  await db.batch([
    // Advance the revision even when already off, so an in-flight stale grant
    // cannot re-enable delivery after this withdrawal. Repeated POSTs stay off.
    db.prepare("UPDATE marketing_email_preferences SET status = CASE WHEN status = 'suppressed' THEN 'suppressed' ELSE 'unsubscribed' END, email_encrypted = NULL, current_event_id = ?, updated_at = ? WHERE email_hash = ?").bind(eventId, now, receipt.email_hash),
    db.prepare("INSERT INTO marketing_email_events (id, email_hash, subject_hash, action, source, notice_json, occurred_at, intent_at, source_hash, user_agent_hash) SELECT ?, email_hash, subject_hash, status, 'email_link', '{}', ?, NULL, NULL, NULL FROM marketing_email_preferences WHERE email_hash = ? AND current_event_id = ?").bind(eventId, now, receipt.email_hash, eventId),
    db.prepare("DELETE FROM marketing_email_intents WHERE email_hash = ?").bind(receipt.email_hash),
  ]);
}

// Only call after an authenticated provider complaint/bounce event or a reviewed
// support request. No public caller can suppress a guessed arbitrary address.
export async function suppressMarketingEmail(email: string, reason: "complaint" | "bounce" | "support_request") {
  const emailHash = await privateHash("email", email.trim().toLowerCase());
  const eventId = crypto.randomUUID();
  const now = nowSeconds();
  const db = getD1();
  await db.batch([
    db.prepare("INSERT INTO marketing_email_preferences (email_hash, subject_hash, email_encrypted, status, current_event_id, updated_at) VALUES (?, NULL, NULL, 'suppressed', ?, ?) ON CONFLICT(email_hash) DO UPDATE SET email_encrypted = NULL, status = 'suppressed', current_event_id = excluded.current_event_id, updated_at = excluded.updated_at").bind(emailHash, eventId, now),
    db.prepare("INSERT INTO marketing_email_events (id, email_hash, subject_hash, action, source, notice_json, occurred_at, intent_at, source_hash, user_agent_hash) VALUES (?, ?, NULL, 'suppressed', ?, '{}', ?, NULL, NULL, NULL)").bind(eventId, emailHash, reason, now),
    db.prepare("DELETE FROM marketing_email_intents WHERE email_hash = ?").bind(emailHash),
  ]);
}

export async function eraseMarketingProfileForSubject(subject: string) {
  const subjectHash = await privateHash("subject", subject);
  const now = nowSeconds();
  const db = getD1();
  // Keep only keyed address suppression and minimal unlinked consent proof. The
  // clear email, identity association, device evidence and pending drafts go.
  await db.batch([
    db.prepare("DELETE FROM marketing_email_intents WHERE email_hash IN (SELECT email_hash FROM marketing_email_preferences WHERE subject_hash = ?)").bind(subjectHash),
    db.prepare("INSERT INTO marketing_email_events (id, email_hash, subject_hash, action, source, notice_json, occurred_at, intent_at, source_hash, user_agent_hash) SELECT 'deletion:' || email_hash || ':' || ?, email_hash, NULL, 'unsubscribed', 'account_deletion', '{}', ?, NULL, NULL, NULL FROM marketing_email_preferences WHERE subject_hash = ?").bind(now, now, subjectHash),
    db.prepare("UPDATE marketing_email_events SET subject_hash = NULL, source_hash = NULL, user_agent_hash = NULL WHERE subject_hash = ?").bind(subjectHash),
    db.prepare("UPDATE marketing_email_preferences SET status = CASE WHEN status = 'suppressed' THEN 'suppressed' ELSE 'unsubscribed' END, email_encrypted = NULL, current_event_id = 'deletion:' || email_hash || ':' || ?, subject_hash = NULL, updated_at = ? WHERE subject_hash = ?").bind(now, now, subjectHash),
  ]);
}
