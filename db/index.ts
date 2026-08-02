import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

type VanteloqRuntime = typeof globalThis & { __vanteloqEnv?: { DB?: D1Database } };
export function getDb() { const binding = (globalThis as VanteloqRuntime).__vanteloqEnv?.DB; if (!binding) throw new Error("The Vanteloq database is unavailable."); return drizzle(binding, { schema }); }
