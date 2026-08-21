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
  const token = value.replace(/\D/g, "").slice(0, 6);
  if (!/^\d{6}$/.test(token)) {
    throw new Error("Enter the six-digit verification code from your email.");
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
