import { getRuntimeEnv } from "../../../../../db";
import { jsonResponse } from "../../../../../server/api";

export async function GET() {
  const env = getRuntimeEnv();
  const url = env.SUPABASE_URL?.trim();
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey || env.SUPABASE_AUTH_MODE !== "public") {
    return jsonResponse({ error: { code: "AUTH_NOT_CONFIGURED", message: "Account service is unavailable." } }, { status: 503 });
  }
  return jsonResponse({ url, publishableKey });
}
