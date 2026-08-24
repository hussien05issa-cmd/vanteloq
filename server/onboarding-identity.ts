import { ApiError, type TrustedIdentity } from "./api.ts";

type ExistingAccountStatus = "active" | "suspended" | null;
type ExistingAuthProvider = "supabase" | "sites" | null;

export type OnboardingIdentityDisposition = "create" | "reuse" | "rebind";

export function onboardingIdentityDisposition(input: {
  existingStatus: ExistingAccountStatus;
  existingAuthSubject: string | null;
  existingAuthProvider: ExistingAuthProvider;
  hasMembership: boolean;
  identity: TrustedIdentity;
}): OnboardingIdentityDisposition {
  if (input.existingStatus === "suspended") {
    throw new ApiError(403, "ACCOUNT_SUSPENDED", "This account cannot create a workspace.");
  }

  const subjectMismatch = input.identity.provider === "supabase"
    && Boolean(input.existingAuthSubject)
    && (
      input.existingAuthSubject !== input.identity.subject
      || input.existingAuthProvider !== "supabase"
    );

  const canRecoverSupabaseIdentity = input.identity.provider === "supabase"
    && Boolean(input.identity.subject)
    && input.identity.emailVerified
    && input.identity.assuranceLevel === "aal2";

  if (input.hasMembership) {
    if (subjectMismatch) {
      throw new ApiError(403, "IDENTITY_CONFLICT", "This verified identity does not match the existing Vanteloq account.");
    }
    throw new ApiError(409, "WORKSPACE_EXISTS", "This account already belongs to a workspace.");
  }

  if (subjectMismatch) {
    if (!canRecoverSupabaseIdentity) {
      throw new ApiError(403, "IDENTITY_CONFLICT", "This verified identity does not match the existing Vanteloq account.");
    }
    return "rebind";
  }

  return input.existingStatus ? "reuse" : "create";
}
