import { getRuntimeEnv } from "../../../../../db";
import { ApiError, handleApi, jsonResponse } from "../../../../../server/api";

const ACTIONS = new Set(["signup", "signin", "password-recovery"]);

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
