import { ApiError } from "./api";
import { requireBillingAccess, type AccessContext } from "./authorization";
import { isAuthorizedFounderContext } from "./internal-access";

// Verified against the owner's production Auth account on 2026-10-19.
// This grants a sample-only personal lab, never tenant administration or billing access.
const PERSONAL_ADMIN_SUBJECT = "58f1ed83-647a-4297-bcea-e3db7d864bc8";

export function isPersonalAdminContext(context: AccessContext): boolean {
  return isAuthorizedFounderContext(context)
    && context.identity.subject === PERSONAL_ADMIN_SUBJECT
    && context.identity.emailConfirmed === true
    && context.identity.assuranceLevel === "aal2"
    && Boolean(context.identity.sessionId);
}

export async function requirePersonalAdminAccess(request: Request): Promise<AccessContext> {
  // Existing membership resolution enforces active user/owner membership, exact
  // requested business, provider subject binding, MFA and the current session lease.
  const context = await requireBillingAccess(request, ["owner"], { bindLegacyIdentity: false, bootstrapInternalAccess: false });
  if (!isPersonalAdminContext(context)) throw new ApiError(403, "PERSONAL_ADMIN_UNAVAILABLE", "Personal admin is only available to the verified owner account.");
  return context;
}
