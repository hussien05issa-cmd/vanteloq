import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema.ts";

export type VanteloqRuntimeEnv = {
  DB?: D1Database;
  BUCKET?: R2Bucket;
  LIGHTSPEED_CLIENT_ID?: string;
  LIGHTSPEED_CLIENT_SECRET?: string;
  LIGHTSPEED_REDIRECT_URI?: string;
  LIGHTSPEED_API_VERSION?: string;
  LIGHTSPEED_X_CLIENT_ID?: string;
  LIGHTSPEED_X_CLIENT_SECRET?: string;
  LIGHTSPEED_X_REDIRECT_URI?: string;
  LIGHTSPEED_X_API_VERSION?: string;
  LIGHTSPEED_X_TOKEN_ENCRYPTION_KEY?: string;
  LIGHTSPEED_R_CLIENT_ID?: string;
  LIGHTSPEED_R_CLIENT_SECRET?: string;
  LIGHTSPEED_R_REDIRECT_URI?: string;
  STRIPE_CLIENT_ID?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_REDIRECT_URI?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_BILLING_WEBHOOK_SECRET?: string;
  STRIPE_API_VERSION?: string;
  PLAID_CLIENT_ID?: string;
  PLAID_SECRET?: string;
  PLAID_ENV?: string;
  PLAID_WEBHOOK_URL?: string;
  PLAID_REDIRECT_URI?: string;
  GOOGLE_MARKETING_CLIENT_ID?: string;
  GOOGLE_MARKETING_CLIENT_SECRET?: string;
  GOOGLE_MARKETING_REDIRECT_URI?: string;
  META_MARKETING_APP_ID?: string;
  META_MARKETING_APP_SECRET?: string;
  META_MARKETING_REDIRECT_URI?: string;
  META_GRAPH_API_VERSION?: string;
  INTEGRATION_ENCRYPTION_KEY?: string;
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_AUTH_MODE?: string;
  SUPABASE_SCHEMA?: string;
  SUPABASE_BACKEND_MODE?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_EXPECTED_ACTION?: string;
  TURNSTILE_ALLOWED_HOSTNAMES?: string;
  SUPABASE_CAPTCHA_ENABLED?: string;
  BOOKLOQ_DEMO_ENABLED?: string;
};

type VanteloqRuntime = typeof globalThis & { __vanteloqEnv?: VanteloqRuntimeEnv };

export function getRuntimeEnv(): VanteloqRuntimeEnv {
  return (globalThis as VanteloqRuntime).__vanteloqEnv ?? {};
}

export function getD1() {
  const binding = getRuntimeEnv().DB;
  if (!binding) throw new Error("The Vanteloq database is unavailable.");
  return binding;
}

export function getDb() {
  return drizzle(getD1(), { schema });
}

export function getR2() {
  const binding = getRuntimeEnv().BUCKET;
  if (!binding) throw new Error("The Vanteloq file store is unavailable.");
  return binding;
}
