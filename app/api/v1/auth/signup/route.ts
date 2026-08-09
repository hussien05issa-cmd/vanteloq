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
const ACTION = "signup";

function requiredText(value: unknown, label: string, minimum: number, maximum: number): string {
  if (typeof value !== "string") throw new ApiError(400, "INVALID_FIELD", `Enter a valid ${label}.`);
  const normalized = value.trim().normalize("NFC");
  if (normalized.length < minimum || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new ApiError(400, "INVALID_FIELD", `Enter a valid ${label}.`);
  }
  return normalized;
}

function configuration(request: Request) {
  const env = getRuntimeEnv();
  const siteKey = env.TURNSTILE_SITE_KEY?.trim() ?? "";
  const secretKey = env.TURNSTILE_SECRET_KEY?.trim() ?? "";
  const supabaseUrl = env.SUPABASE_URL?.trim().replace(/\/$/, "") ?? "";
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
  const expectedAction = env.TURNSTILE_EXPECTED_ACTION?.trim() || ACTION;
  const allowedHostnames = new Set((env.TURNSTILE_ALLOWED_HOSTNAMES ?? "")
    .split(",").map(hostname => hostname.trim().toLowerCase()).filter(Boolean));
  const requestHostname = new URL(request.url).hostname.toLowerCase();
  const configured = Boolean(
    siteKey && secretKey && supabaseUrl.startsWith("https://") && publishableKey &&
    expectedAction === ACTION && allowedHostnames.has(requestHostname),
  );
  return { siteKey, secretKey, supabaseUrl, publishableKey, expectedAction, allowedHostnames, requestHostname, configured };
}

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const config = configuration(request);
    if (!config.configured) return jsonResponse({ configured: false }, { status: 503 });
    return jsonResponse({ configured: true, siteKey: config.siteKey, action: ACTION });
  });
}

export async function POST(request: Request) {
  return handleApi(request, async () => {
    requireSameOrigin(request);
    const config = configuration(request);
    if (!config.configured) throw new ApiError(503, "SIGNUP_UNAVAILABLE", "Secure signup is temporarily unavailable.");

    const input = await readJsonObject(request, 4_096);
    const unknown = Object.keys(input).filter(key => !["name", "email", "password", "turnstileToken"].includes(key));
    if (unknown.length) throw new ApiError(400, "UNKNOWN_FIELD", `Unexpected field: ${unknown[0]}.`);
    const name = requiredText(input.name, "full name", 2, 120);
    const email = requiredText(input.email, "email address", 3, 254).toLowerCase();
    if (!EMAIL.test(email)) throw new ApiError(400, "INVALID_FIELD", "Enter a valid email address.");
    const password = requiredText(input.password, "password", 8, 256);
    const turnstileToken = requiredText(input.turnstileToken, "security response", 10, 2_048);

    const source = clientSource(request);
    await enforceRateLimit("signup:email", email, 5, 3_600);
    if (source !== "unknown") await enforceRateLimit("signup:source", source, 20, 3_600);

    const verificationBody = new URLSearchParams({
      secret: config.secretKey,
      response: turnstileToken,
      idempotency_key: crypto.randomUUID(),
    });
    if (source !== "unknown") verificationBody.set("remoteip", source);

    let verification: { success?: unknown; action?: unknown; hostname?: unknown };
    try {
      const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: verificationBody,
        signal: AbortSignal.timeout(7_500),
      });
      if (!response.ok) throw new Error("Turnstile verification failed");
      verification = await response.json() as typeof verification;
    } catch {
      throw new ApiError(503, "SECURITY_CHECK_UNAVAILABLE", "The security check is temporarily unavailable.");
    }

    const hostname = typeof verification.hostname === "string" ? verification.hostname.toLowerCase() : "";
    if (
      verification.success !== true ||
      verification.action !== config.expectedAction ||
      hostname !== config.requestHostname ||
      !config.allowedHostnames.has(hostname)
    ) {
      throw new ApiError(400, "SECURITY_CHECK_FAILED", "The security check expired or could not be verified. Please retry.");
    }

    let signupResponse: Response;
    try {
      signupResponse = await fetch(`${config.supabaseUrl}/auth/v1/signup?redirect_to=${encodeURIComponent(new URL("/", request.url).toString())}`, {
        method: "POST",
        headers: {
          apikey: config.publishableKey,
          authorization: `Bearer ${config.publishableKey}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ email, password, data: { full_name: name } }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ApiError(503, "ACCOUNT_SERVICE_UNAVAILABLE", "Account creation is temporarily unavailable.");
    }

    const signup = await signupResponse.json().catch(() => ({})) as {
      access_token?: unknown;
      refresh_token?: unknown;
      user?: { id?: unknown };
    };
    if (!signupResponse.ok) {
      const status = signupResponse.status === 429 ? 429 : 400;
      throw new ApiError(
        status,
        status === 429 ? "SIGNUP_RATE_LIMITED" : "SIGNUP_REJECTED",
        status === 429
          ? "Too many signup attempts. Please try again later."
          : "Account creation could not be completed. Check your details and try again.",
      );
    }

    const accessToken = typeof signup.access_token === "string" ? signup.access_token : null;
    const refreshToken = typeof signup.refresh_token === "string" ? signup.refresh_token : null;
    return jsonResponse({
      created: typeof signup.user?.id === "string",
      confirmationRequired: !(accessToken && refreshToken),
      session: accessToken && refreshToken ? { accessToken, refreshToken } : null,
    }, { status: 201 });
  });
}
