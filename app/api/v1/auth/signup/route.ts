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
import { strongPasswordError } from "../../../../../shared/password-security";

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}$/;
const ACTIONS = new Set(["signup", "signin", "password-recovery"]);

function requiredText(value: unknown, label: string, minimum: number, maximum: number): string {
  if (typeof value !== "string") throw new ApiError(400, "INVALID_FIELD", `Enter a valid ${label}.`);
  const normalized = value.trim().normalize("NFC");
  if (normalized.length < minimum || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new ApiError(400, "INVALID_FIELD", `Enter a valid ${label}.`);
  }
  return normalized;
}

function passwordText(value: unknown): string {
  if (typeof value !== "string" || value.length < 12 || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new ApiError(400, "WEAK_PASSWORD", "Choose a password that meets every requirement.");
  }
  return value.normalize("NFC");
}

function configuration(request: Request) {
  const env = getRuntimeEnv();
  const siteKey = env.TURNSTILE_SITE_KEY?.trim() ?? "";
  const secretKey = env.TURNSTILE_SECRET_KEY?.trim() ?? "";
  const supabaseUrl = env.SUPABASE_URL?.trim().replace(/\/$/, "") ?? "";
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
  const allowedHostnames = new Set((env.TURNSTILE_ALLOWED_HOSTNAMES ?? "")
    .split(",").map(hostname => hostname.trim().toLowerCase()).filter(Boolean));
  const requestHostname = new URL(request.url).hostname.toLowerCase();
  const configured = Boolean(
    siteKey && secretKey && supabaseUrl.startsWith("https://") && publishableKey &&
    env.SUPABASE_CAPTCHA_ENABLED?.trim().toLowerCase() === "true" && allowedHostnames.has(requestHostname),
  );
  return { siteKey, supabaseUrl, publishableKey, configured };
}

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const config = configuration(request);
    if (!config.configured) return jsonResponse({ configured: false }, { status: 503 });
    const action = new URL(request.url).searchParams.get("action") ?? "signup";
    if (!ACTIONS.has(action)) throw new ApiError(400, "INVALID_ACTION", "The requested security check is not supported.");
    return jsonResponse({ configured: true, siteKey: config.siteKey, action });
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
    const password = passwordText(input.password);
    const passwordError = strongPasswordError(password);
    if (passwordError) throw new ApiError(400, "WEAK_PASSWORD", passwordError);
    const turnstileToken = requiredText(input.turnstileToken, "security response", 10, 2_048);

    const source = clientSource(request);
    await enforceRateLimit("signup:email", email, 5, 3_600);
    if (source !== "unknown") await enforceRateLimit("signup:source", source, 20, 3_600);

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
        body: JSON.stringify({
          email,
          password,
          data: { full_name: name },
          gotrue_meta_security: { captcha_token: turnstileToken },
        }),
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
