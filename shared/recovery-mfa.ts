type AssuranceLevel = string | null;
type AuthError = { message?: string; status?: number } | null;

type AssuranceResult = {
  data: { currentLevel: AssuranceLevel; nextLevel: AssuranceLevel } | null;
  error: AuthError;
};

type FactorResult = {
  data: { totp: Array<{ id: string; status?: string }> } | null;
  error: AuthError;
};

type ChallengeResult = {
  data: unknown;
  error: AuthError;
};

export type RecoveryMfaState =
  | { status: "ready" }
  | { status: "challenge_required"; factorId: string }
  | { status: "error"; message: string };

type RecoveryMfaVerificationResult =
  | { status: "ready" }
  | { status: "error"; message: string };

export async function inspectRecoveryMfa(mfa: {
  getAuthenticatorAssuranceLevel: () => Promise<AssuranceResult>;
  listFactors: () => Promise<FactorResult>;
}): Promise<RecoveryMfaState> {
  const assurance = await mfa.getAuthenticatorAssuranceLevel();
  if (assurance.error || !assurance.data) {
    return { status: "error", message: "Vanteloq could not verify this recovery session's security level." };
  }
  if (assurance.data.currentLevel === "aal2" || assurance.data.nextLevel !== "aal2") {
    return { status: "ready" };
  }

  const factors = await mfa.listFactors();
  if (factors.error || !factors.data) {
    return { status: "error", message: "Vanteloq could not load your authenticator." };
  }
  const verifiedTotp = factors.data.totp.find((factor) => factor.status === "verified");
  if (!verifiedTotp) {
    return { status: "error", message: "No verified authenticator is available for this account." };
  }
  return { status: "challenge_required", factorId: verifiedTotp.id };
}

export async function verifyRecoveryMfa(mfa: {
  challengeAndVerify: (input: { factorId: string; code: string }) => Promise<ChallengeResult>;
  getAuthenticatorAssuranceLevel: () => Promise<AssuranceResult>;
}, factorId: string, code: string): Promise<RecoveryMfaVerificationResult> {
  if (!factorId || !/^\d{6}$/.test(code)) {
    return { status: "error", message: "Enter the current six-digit code from your authenticator app." };
  }

  const verification = await mfa.challengeAndVerify({ factorId, code });
  if (verification.error) {
    return {
      status: "error",
      message: verification.error.status === 429
        ? "Too many verification attempts. Wait before trying again."
        : "That code was not accepted. Wait for a new code and try again.",
    };
  }

  const assurance = await mfa.getAuthenticatorAssuranceLevel();
  if (assurance.error || !assurance.data || assurance.data.currentLevel !== "aal2") {
    return { status: "error", message: "The authenticator was accepted, but the secured recovery session could not be confirmed." };
  }
  return { status: "ready" };
}
