import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { integrationConsents } from "../db/schema";
import {
  GEMINI_CONSENT_NOTICE_VERSION,
  GEMINI_DATA_CATEGORIES,
  GEMINI_PROCESSING_PURPOSES,
  PLAID_CONSENT_MAX_AGE_MS,
  PLAID_CONSENT_NOTICE_VERSION,
  PLAID_DATA_CATEGORIES,
  PLAID_PROCESSING_PURPOSES,
  PRIVACY_POLICY_VERSION,
} from "../domain/privacy-controls";
import { ApiError } from "./api";

export async function recordGeminiConsent(input: {
  organizationId: string;
  actorUserId: string;
  noticeVersion: string;
  privacyPolicyVersion: string;
}) {
  if (
    input.noticeVersion !== GEMINI_CONSENT_NOTICE_VERSION
    || input.privacyPolicyVersion !== PRIVACY_POLICY_VERSION
  ) {
    throw new ApiError(409, "GEMINI_CONSENT_NOTICE_STALE", "The Gemini data-use notice changed. Review it again before asking a question.");
  }

  const [existing] = await getDb().select({
    id: integrationConsents.id,
    acceptedAt: integrationConsents.acceptedAt,
  }).from(integrationConsents).where(and(
    eq(integrationConsents.organizationId, input.organizationId),
    eq(integrationConsents.actorUserId, input.actorUserId),
    eq(integrationConsents.provider, "google_gemini"),
    eq(integrationConsents.status, "accepted"),
    eq(integrationConsents.noticeVersion, GEMINI_CONSENT_NOTICE_VERSION),
    eq(integrationConsents.privacyPolicyVersion, PRIVACY_POLICY_VERSION),
  )).limit(1);
  if (existing) return existing;

  const now = new Date();
  const id = crypto.randomUUID();
  await getDb().insert(integrationConsents).values({
    id,
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    provider: "google_gemini",
    status: "accepted",
    noticeVersion: GEMINI_CONSENT_NOTICE_VERSION,
    privacyPolicyVersion: PRIVACY_POLICY_VERSION,
    dataCategoriesJson: JSON.stringify(GEMINI_DATA_CATEGORIES),
    purposesJson: JSON.stringify(GEMINI_PROCESSING_PURPOSES),
    consentSource: "in_app",
    acceptedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  return { id, acceptedAt: now };
}

export async function recordPlaidConsent(input: {
  organizationId: string;
  actorUserId: string;
  noticeVersion: string;
  privacyPolicyVersion: string;
}) {
  if (
    input.noticeVersion !== PLAID_CONSENT_NOTICE_VERSION
    || input.privacyPolicyVersion !== PRIVACY_POLICY_VERSION
  ) {
    throw new ApiError(409, "PLAID_CONSENT_NOTICE_STALE", "The financial-data notice changed. Review it again before connecting.");
  }
  const now = new Date();
  const id = crypto.randomUUID();
  await getDb().insert(integrationConsents).values({
    id,
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    provider: "plaid",
    status: "accepted",
    noticeVersion: PLAID_CONSENT_NOTICE_VERSION,
    privacyPolicyVersion: PRIVACY_POLICY_VERSION,
    dataCategoriesJson: JSON.stringify(PLAID_DATA_CATEGORIES),
    purposesJson: JSON.stringify(PLAID_PROCESSING_PURPOSES),
    consentSource: "in_app",
    acceptedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  return { id, acceptedAt: now };
}
export async function requireFreshPlaidConsent(input: {
  consentRecordId: string;
  organizationId: string;
  actorUserId: string;
}) {
  const [record] = await getDb().select({
    id: integrationConsents.id,
    status: integrationConsents.status,
    noticeVersion: integrationConsents.noticeVersion,
    privacyPolicyVersion: integrationConsents.privacyPolicyVersion,
    acceptedAt: integrationConsents.acceptedAt,
  }).from(integrationConsents).where(and(
    eq(integrationConsents.id, input.consentRecordId),
    eq(integrationConsents.organizationId, input.organizationId),
    eq(integrationConsents.actorUserId, input.actorUserId),
    eq(integrationConsents.provider, "plaid"),
  )).limit(1);

  const acceptedAt = record?.acceptedAt?.getTime() ?? 0;
  const age = Date.now() - acceptedAt;
  if (
    !record
    || record.status !== "accepted"
    || record.noticeVersion !== PLAID_CONSENT_NOTICE_VERSION
    || record.privacyPolicyVersion !== PRIVACY_POLICY_VERSION
    || age < 0
    || age > PLAID_CONSENT_MAX_AGE_MS
  ) {
    throw new ApiError(409, "PLAID_CONSENT_EXPIRED", "The financial-data authorization expired. Review the notice and try again.");
  }
  return record;
}

export async function withdrawPlaidConsents(organizationId: string, actorUserId: string) {
  const now = new Date();
  await getDb().update(integrationConsents).set({
    status: "withdrawn",
    withdrawnAt: now,
    updatedAt: now,
  }).where(and(
    eq(integrationConsents.organizationId, organizationId),
    eq(integrationConsents.provider, "plaid"),
    eq(integrationConsents.status, "accepted"),
  ));
  return { withdrawnAt: now, withdrawnByUserId: actorUserId };
}
