import { getRuntimeEnv, type VanteloqRuntimeEnv } from "../db/index.ts";

export type SupabaseBackendMode = "off" | "shadow";
export type SupabaseBackendStatus =
  | "disabled"
  | "misconfigured"
  | "ready"
  | "unreachable";

type SupabaseConfiguration = {
  mode: SupabaseBackendMode;
  url: string | null;
  secretKey: string | null;
  schema: string;
};

export type SupabaseBackendReadiness = {
  mode: SupabaseBackendMode;
  configured: boolean;
  status: SupabaseBackendStatus;
  schemaVersion: number | null;
  checkedAt: string;
};

function clean(value: string | undefined): string | null {
  const result = value?.trim();
  return result ? result : null;
}

function safeUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function supabaseConfiguration(
  env: VanteloqRuntimeEnv = getRuntimeEnv(),
): SupabaseConfiguration {
  const requestedMode = clean(env.SUPABASE_BACKEND_MODE);
  const mode: SupabaseBackendMode = requestedMode === "shadow" ? "shadow" : "off";
  const schemaCandidate = clean(env.SUPABASE_SCHEMA) ?? "public";
  const schema = /^[a-z_][a-z0-9_]*$/.test(schemaCandidate)
    ? schemaCandidate
    : "public";
  return {
    mode,
    url: safeUrl(clean(env.SUPABASE_URL)),
    secretKey: clean(env.SUPABASE_SECRET_KEY),
    schema,
  };
}

export async function probeSupabaseBackend(
  env: VanteloqRuntimeEnv = getRuntimeEnv(),
  fetcher: typeof fetch = fetch,
): Promise<SupabaseBackendReadiness> {
  const config = supabaseConfiguration(env);
  const checkedAt = new Date().toISOString();
  if (config.mode === "off") {
    return { mode: config.mode, configured: false, status: "disabled", schemaVersion: null, checkedAt };
  }
  if (!config.url || !config.secretKey) {
    return { mode: config.mode, configured: false, status: "misconfigured", schemaVersion: null, checkedAt };
  }

  try {
    const response = await fetcher(
      `${config.url}/rest/v1/vanteloq_backend_status?select=service,schema_version&service=eq.vanteloq&limit=1`,
      {
        method: "GET",
        headers: {
          apikey: config.secretKey,
          authorization: `Bearer ${config.secretKey}`,
          accept: "application/json",
          "accept-profile": config.schema,
          "user-agent": "vanteloq-backend-readiness/1",
        },
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!response.ok) throw new Error("Supabase readiness request failed");
    const rows = (await response.json()) as Array<{ service?: unknown; schema_version?: unknown }>;
    const row = rows[0];
    const schemaVersion = typeof row?.schema_version === "number" ? row.schema_version : null;
    if (row?.service !== "vanteloq" || schemaVersion === null)
      throw new Error("Supabase readiness contract is incomplete");
    return { mode: config.mode, configured: true, status: "ready", schemaVersion, checkedAt };
  } catch {
    return { mode: config.mode, configured: true, status: "unreachable", schemaVersion: null, checkedAt };
  }
}
