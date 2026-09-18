import { getD1, getRuntimeEnv } from "../db/index.ts";
import { ApiError, hashIdentifier, requireAal2, type TrustedIdentity } from "./api.ts";
import type { AccessContext } from "./authorization.ts";
import { isPlanKey, type PlanKey } from "./entitlements/catalog.ts";
import { ACCOUNT_ACCEPTANCE_NOTICE_VERSION, PRIVACY_POLICY_VERSION, TERMS_OF_SERVICE_VERSION } from "../shared/legal-versions.ts";

export type ComplimentaryOffer = { id: string; email: string; plan: PlanKey; bookloq: boolean; expiresAt: string | null };
export type ComplimentaryDetails = Omit<ComplimentaryOffer, "email">;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Operator-managed server configuration, never client metadata or a public email allowlist.
export function configuredOffers(raw = getRuntimeEnv().VANTELOQ_COMPLIMENTARY_INVITATIONS, now = Date.now()): ComplimentaryOffer[] {
  if (!raw) return [];
  try {
    const rows: unknown = JSON.parse(raw);
    if (!Array.isArray(rows) || rows.length > 100) return [];
    const ids = new Set<string>(), emails = new Set<string>();
    const offers: ComplimentaryOffer[] = [];
    for (const row of rows) {
      if (!row || typeof row !== "object" || !uuid.test(row.id) || typeof row.email !== "string"
        || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email) || row.email.length > 254
        || !isPlanKey(row.plan) || typeof row.bookloq !== "boolean"
        || (row.expiresAt !== null && (typeof row.expiresAt !== "string" || !Number.isFinite(Date.parse(row.expiresAt))))) return [];
      const email = row.email.trim().toLowerCase();
      if (ids.has(row.id) || emails.has(email)) return [];
      ids.add(row.id); emails.add(email);
      if (row.expiresAt !== null && Date.parse(row.expiresAt) <= now) continue;
      offers.push({ id: row.id, email, plan: row.plan, bookloq: row.bookloq, expiresAt: row.expiresAt });
    }
    return offers;
  } catch { return []; }
}

export function offerForIdentity(identity: TrustedIdentity): ComplimentaryOffer | null {
  if (identity.provider !== "supabase" || !identity.emailVerified || !identity.subject) return null;
  return configuredOffers().find(row => row.email === identity.email.toLowerCase()) ?? null;
}

export async function pendingComplimentaryOffer(identity: TrustedIdentity): Promise<ComplimentaryDetails | null> {
  const offer = offerForIdentity(identity);
  if (!offer) return null;
  const claimed = await getD1().prepare("SELECT grant_id FROM complimentary_access WHERE grant_id = ?").bind(offer.id).first();
  if (claimed) return null;
  return { id: offer.id, plan: offer.plan, bookloq: offer.bookloq, expiresAt: offer.expiresAt };
}

export async function complimentaryGrantForOwner(input: { userId: string; organizationId: string; authSubject: string | null; email: string }): Promise<ComplimentaryOffer | null> {
  if (!input.authSubject) return null;
  const offer = configuredOffers().find(row => row.email === input.email.toLowerCase());
  if (!offer) return null;
  const row = await getD1().prepare("SELECT grant_id FROM complimentary_access WHERE grant_id = ? AND user_id = ? AND organization_id = ? AND auth_subject_hash = ? AND active = 1")
    .bind(offer.id, input.userId, input.organizationId, await hashIdentifier(`complimentary-subject:${input.authSubject}`)).first();
  return row ? offer : null;
}

export async function getComplimentaryGrant(context: AccessContext) {
  if (context.role !== "owner" || context.authProvider !== "supabase"
    || context.authSubject !== context.identity.subject || !context.identity.emailVerified) return null;
  requireAal2(context.identity);
  return complimentaryGrantForOwner({ userId: context.userId, organizationId: context.organizationId, authSubject: context.authSubject, email: context.identity.email });
}

export function complimentarySetupInput(body: Record<string, unknown>, identity: TrustedIdentity, offer: ComplimentaryDetails) {
  requireAal2(identity);
  if (body.complimentaryId !== offer.id) throw new ApiError(403, "INVITATION_INVALID", "This invitation is not available for this account.");
  if (body.legalAccepted !== true || body.termsVersion !== TERMS_OF_SERVICE_VERSION
    || body.privacyPolicyVersion !== PRIVACY_POLICY_VERSION || body.legalNoticeVersion !== ACCOUNT_ACCEPTANCE_NOTICE_VERSION) {
    throw new ApiError(409, "LEGAL_ACCEPTANCE_REQUIRED", "Review and accept the current terms before opening your workspace.");
  }
  const timezone = typeof body.timezone === "string" ? body.timezone : "UTC";
  try { new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(); }
  catch { throw new ApiError(400, "INVALID_TIMEZONE", "Choose a valid time zone."); }
  const ownerName = identity.displayName.trim().slice(0, 120) || "Account owner";
  return {
    ownerName, businessName: "My workspace", legalName: "", businessEmail: identity.email,
    phone: "", website: "", industry: "Other", country: "CA", province: "", city: "", address: "", postalCode: "",
    addressVerificationToken: "", timezone, currency: "CAD", fiscalYearStart: "January", taxNumber: "",
    hoursJson: "[]", sourceMode: "connect_later" as const, selectedPos: "", emailNotifications: false,
    legalAccepted: true as const, termsVersion: TERMS_OF_SERVICE_VERSION, privacyPolicyVersion: PRIVACY_POLICY_VERSION,
    legalNoticeVersion: ACCOUNT_ACCEPTANCE_NOTICE_VERSION,
  };
}
