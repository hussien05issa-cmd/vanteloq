import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema.ts";

type VanteloqRuntime = typeof globalThis & { __vanteloqEnv?: { DB?: D1Database; BUCKET?: R2Bucket } };
export function getD1() {
  const binding = (globalThis as VanteloqRuntime).__vanteloqEnv?.DB;
  if (!binding) throw new Error("The Vanteloq database is unavailable.");
  return binding;
}

export function getDb() {
  return drizzle(getD1(), { schema });
}

export function getR2() {
  const binding = (globalThis as VanteloqRuntime).__vanteloqEnv?.BUCKET;
  if (!binding) throw new Error("The Vanteloq file store is unavailable.");
  return binding;
}
