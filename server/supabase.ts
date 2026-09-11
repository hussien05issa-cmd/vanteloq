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

export async function bootstrapSupabaseOrganization(
  request: Request,
  name: string,
  createdBy: string | null,
): Promise<string | null> {
  const env = getRuntimeEnv();
  if (env.SUPABASE_AUTH_MODE !== "public") return null;
  const url = safeUrl(clean(env.SUPABASE_URL));
  const publishableKey = clean(env.SUPABASE_PUBLISHABLE_KEY);
  const authorization = request.headers.get("authorization")?.trim();
  if (!url || !publishableKey || !authorization?.startsWith("Bearer ") || !createdBy) {
    throw new Error("Supabase organization bootstrap is not configured.");
  }
  const headers = { apikey: publishableKey, authorization, accept: "application/json" };
  const existingResponse = await fetch(
    `${url}/rest/v1/memberships?select=organization_id&status=eq.active&limit=1`,
    { headers, signal: AbortSignal.timeout(7_500) },
  );
  if (!existingResponse.ok) throw new Error("Supabase membership lookup failed.");
  const existing = await existingResponse.json() as Array<{ organization_id?: unknown }>;
  if (typeof existing[0]?.organization_id === "string") return existing[0].organization_id;

  const slugBase = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "workspace";
  const response = await fetch(`${url}/rest/v1/organizations?select=id`, {
    method: "POST",
    headers: {
      ...headers,
      "content-type": "application/json",
      prefer: "return=representation",
    },
    body: JSON.stringify({
      name,
      slug: `${slugBase}-${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`,
      created_by: createdBy,
    }),
    signal: AbortSignal.timeout(7_500),
  });
  if (!response.ok) throw new Error("Supabase organization bootstrap failed.");
  const organizations = await response.json() as Array<{ id?: unknown }>;
  return typeof organizations[0]?.id === "string" ? organizations[0].id : null;
}
