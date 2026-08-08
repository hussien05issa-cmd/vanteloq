import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema.ts";

export type VanteloqRuntimeEnv = {
  DB?: D1Database;
  BUCKET?: R2Bucket;
  LIGHTSPEED_CLIENT_ID?: string;
  LIGHTSPEED_CLIENT_SECRET?: string;
  LIGHTSPEED_REDIRECT_URI?: string;
  LIGHTSPEED_API_VERSION?: string;
  LIGHTSPEED_R_CLIENT_ID?: string;
  LIGHTSPEED_R_CLIENT_SECRET?: string;
  LIGHTSPEED_R_REDIRECT_URI?: string;
  INTEGRATION_ENCRYPTION_KEY?: string;
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_SCHEMA?: string;
  SUPABASE_BACKEND_MODE?: string;
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
