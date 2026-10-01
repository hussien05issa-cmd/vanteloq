import { getD1 } from "../db";
import { PRIVACY_POLICY_VERSION, TERMS_OF_SERVICE_VERSION } from "../shared/legal-versions";
import { ApiError } from "./api";

export async function hasCurrentLegalAcceptance(userId: string, database = getD1()) {
  return Boolean(await database.prepare(`SELECT id FROM legal_acceptances
    WHERE user_id = ? AND terms_version = ? AND privacy_policy_version = ? LIMIT 1`)
    .bind(userId, TERMS_OF_SERVICE_VERSION, PRIVACY_POLICY_VERSION).first());
}

/** Required for a new purchase, never for opening the cancellation portal. */
export async function requireCurrentCheckoutAcceptance(userId: string, database = getD1()) {
  if (!await hasCurrentLegalAcceptance(userId, database)) {
    throw new ApiError(409, "LEGAL_ACCEPTANCE_REQUIRED", "Review and accept the current Terms of Service and Privacy Policy before checkout.");
  }
}
