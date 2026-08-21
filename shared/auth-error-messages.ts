import { MINIMUM_PASSWORD_LENGTH } from "./password-security.ts";

export type SignupProviderError = {
  code?: string | null;
  message?: string | null;
  status?: number;
};

const DEFAULT_SIGNUP_ERROR = "Account creation could not be completed. Check your details and try again.";

export function signupErrorMessage(error: SignupProviderError): string {
  if (error.status === 429) {
    return "Too many account-creation attempts. Wait a moment and try again.";
  }

  const providerDetail = `${error.code ?? ""} ${error.message ?? ""}`;
  const minimumLength = providerDetail.match(/password should be at least\s+(\d+)\s+characters?/i);
  if (minimumLength && Number(minimumLength[1]) > MINIMUM_PASSWORD_LENGTH) {
    return "Account security settings are temporarily out of sync. Please try again shortly.";
  }

  if (/captcha|security check/i.test(providerDetail)) {
    return "The security check expired or could not be verified. Complete a fresh security check and try again.";
  }

  if (/invalid[^\n]*email|email[^\n]*invalid/i.test(providerDetail)) {
    return "Enter a valid email address.";
  }

  return DEFAULT_SIGNUP_ERROR;
}
