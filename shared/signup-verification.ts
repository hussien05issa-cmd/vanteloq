type VerificationError = {
  status?: number;
  message?: string;
} | null;

type VerificationClient<TSession> = {
  auth: {
    verifyOtp(input: {
      email: string;
      token: string;
      type: "email";
    }): Promise<{
      data: { session: TSession | null };
      error: VerificationError;
    }>;
  };
};

export const MINIMUM_EMAIL_VERIFICATION_CODE_LENGTH = 6;
export const MAXIMUM_EMAIL_VERIFICATION_CODE_LENGTH = 10;

export function normalizeEmailVerificationCode(value: string) {
  return value.replace(/\D/g, "");
}

export function isCompleteEmailVerificationCode(value: string) {
  const token = normalizeEmailVerificationCode(value);
  return token.length >= MINIMUM_EMAIL_VERIFICATION_CODE_LENGTH
    && token.length <= MAXIMUM_EMAIL_VERIFICATION_CODE_LENGTH;
}

function verificationFailure(error: VerificationError) {
  if (error?.status === 429) {
    return "Too many verification attempts. Wait a moment, then request a new code.";
  }
  if (/expired/i.test(error?.message ?? "")) {
    return "That verification code has expired. Request a new code and try again.";
  }
  return "That verification code was not accepted. Check the newest email and try again.";
}

export async function verifySignupCode<TSession>(
  client: VerificationClient<TSession>,
  email: string,
  value: string,
): Promise<TSession> {
  const token = normalizeEmailVerificationCode(value);
  if (!isCompleteEmailVerificationCode(token)) {
    throw new Error("Enter the verification code from your email (6 to 10 digits).");
  }

  const result = await client.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token,
    type: "email",
  });
  if (result.error) throw new Error(verificationFailure(result.error));
  if (!result.data.session) {
    throw new Error("Your email was verified, but the secure session could not be opened. Sign in to continue.");
  }
  return result.data.session;
}
