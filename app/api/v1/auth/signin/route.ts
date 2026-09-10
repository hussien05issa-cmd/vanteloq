import { getRuntimeEnv } from "../../../../../db";
import {
  ApiError,
  clientSource,
  enforceRateLimit,
  handleApi,
  jsonResponse,
  readJsonObject,
  requireSameOrigin,
} from "../../../../../server/api";

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}$/;

function text(value: unknown, label: string, maximum: number) {
  if (typeof value !== "string") throw new ApiError(400, "INVALID_FIELD", `Enter a valid ${label}.`);
  const normalized = value.trim().normalize("NFC");
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new ApiError(400, "INVALID_FIELD", `Enter a valid ${label}.`);
  }
  return normalized;
}

function passwordText(value: unknown) {
  if (typeof value !== "string" || value.length < 1 || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new ApiError(400, "INVALID_FIELD", "Enter a valid password.");
  }
  // Passwords must reach the identity provider exactly as entered at signup/reset.
  return value;
}

export async function POST(request: Request) {
  return handleApi(request, async () => {
    requireSameOrigin(request);
    const env = getRuntimeEnv();
    const supabaseUrl = env.SUPABASE_URL?.trim().replace(/\/$/, "") ?? "";
    const publishableKey = env.SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
    if (!supabaseUrl.startsWith("https://") || !publishableKey || env.SUPABASE_CAPTCHA_ENABLED?.trim().toLowerCase() !== "true") {
      throw new ApiError(503, "SIGNIN_UNAVAILABLE", "Secure sign-in is temporarily unavailable.");
    }

    const input = await readJsonObject(request, 4_096);
    const unknown = Object.keys(input).filter((key) => !["email", "password", "turnstileToken"].includes(key));
    if (unknown.length) throw new ApiError(400, "UNKNOWN_FIELD", `Unexpected field: ${unknown[0]}.`);
    const email = text(input.email, "email address", 254).toLowerCase();
    const password = passwordText(input.password);
    const turnstileToken = text(input.turnstileToken, "security response", 2_048);
    if (!EMAIL.test(email) || turnstileToken.length < 10) throw new ApiError(400, "INVALID_FIELD", "Enter valid sign-in details.");

    const source = clientSource(request);
    await enforceRateLimit("signin:account-source", `${email}:${source}`, 5, 15 * 60);
    if (source !== "unknown") await enforceRateLimit("signin:source", source, 15, 15 * 60);

    let response: Response;
    try {
      response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: {
          apikey: publishableKey,
          authorization: `Bearer ${publishableKey}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          email,
          password,
          gotrue_meta_security: { captcha_token: turnstileToken },
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ApiError(503, "ACCOUNT_SERVICE_UNAVAILABLE", "Sign-in is temporarily unavailable.");
    }

    const payload = await response.json().catch(() => ({})) as {
      access_token?: unknown;
      refresh_token?: unknown;
      error_code?: unknown;
      code?: unknown;
    };
    if (!response.ok) {
      if (response.status === 429) throw new ApiError(429, "SIGNIN_RATE_LIMITED", "Too many sign-in attempts. Wait fifteen minutes before trying again.");
      const providerCode = typeof payload.error_code === "string" ? payload.error_code : typeof payload.code === "string" ? payload.code : "";
      if (response.status >= 500) {
        throw new ApiError(503, "ACCOUNT_SERVICE_UNAVAILABLE", "Sign-in is temporarily unavailable. Try again shortly.");
      }
      if (providerCode === "captcha_failed") {
        throw new ApiError(400, "SECURITY_VERIFICATION_FAILED", "The security check expired or could not be verified. Complete a fresh security check and try again.");
      }
      if (providerCode === "email_not_confirmed") {
        throw new ApiError(403, "EMAIL_NOT_CONFIRMED", "Verify your email before signing in.");
      }
      if (providerCode === "invalid_credentials" || providerCode === "user_banned") {
        throw new ApiError(400, "INVALID_CREDENTIALS", "The email or password is incorrect.");
      }
      throw new ApiError(503, "ACCOUNT_SERVICE_UNAVAILABLE", "Sign-in could not be completed. Try again shortly.");
    }

    if (typeof payload.access_token !== "string" || typeof payload.refresh_token !== "string") {
      throw new ApiError(502, "SESSION_RESPONSE_INVALID", "The account service returned an incomplete session.");
    }
    return jsonResponse({ session: { accessToken: payload.access_token, refreshToken: payload.refresh_token } });
  });
}
