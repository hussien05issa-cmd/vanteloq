type Plan = {
  stage: string; scope: "account" | "workspace"; subject: string; organizationName: string;
  memberSubjects: string[]; remote: { organizationId: string | null } | null;
};
type Options = { url: string; serviceKey: string; fetcher?: typeof fetch };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLAN_URL = "https://vanteloq.com/api/v1/account/deletion/plan";

// Authorization is a 256-bit, purpose-limited capability for a confirmed job.
// It is verified against the canonical application's persisted plan, not trusted
// from the caller. No service key or arbitrary user/org target is accepted.
export function deletionHandler(options: Options) {
  const fetcher = options.fetcher ?? fetch;
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
  async function rest(path: string, method = "GET") {
    const response = await fetcher(`${options.url}${path}`, {
      method, headers: { apikey: options.serviceKey, authorization: `Bearer ${options.serviceKey}`, "content-type": "application/json", prefer: "return=representation" },
      signal: AbortSignal.timeout(8_000),
    });
    if (response.status === 404 && path.startsWith("/auth/")) return null;
    if (!response.ok) throw new Error("Identity operation unavailable");
    return response.status === 204 ? null : await response.json();
  }
  const rows = async (table: string, query: Record<string, string>) => {
    const body = await rest(`/rest/v1/${table}?${new URLSearchParams(query)}`);
    if (!Array.isArray(body)) throw new Error("Invalid identity records");
    return body as Array<Record<string, string>>;
  };
  async function prepare(plan: Plan) {
    const memberships = await rows("memberships", { select: "organization_id,role", user_id: `eq.${plan.subject}`, limit: "2" });
    const owned = await rows("organizations", { select: "id,name,created_by", created_by: `eq.${plan.subject}`, limit: "2" });
    if (plan.scope === "workspace") {
      if (owned.length > 1 || memberships.some((m) => m.organization_id !== owned[0]?.id)) throw new Error("Ambiguous workspace mapping");
      if (!owned.length) return { organizationId: null };
      const organization = owned[0];
      if (organization.name !== plan.organizationName || !UUID.test(organization.id)) throw new Error("Workspace mapping needs review");
      const members = await rows("memberships", { select: "user_id", organization_id: `eq.${organization.id}`, limit: "1001" });
      if (members.length > 1000 || members.some((m) => !plan.memberSubjects.includes(m.user_id))) throw new Error("Workspace members do not match");
      return { organizationId: organization.id };
    }
    if (owned.length || memberships.length > 1) throw new Error("Account scope needs review");
    if (!memberships.length) return { organizationId: null };
    const org = (await rows("organizations", { select: "id,name", id: `eq.${memberships[0].organization_id}`, limit: "1" }))[0];
    if (!org || !UUID.test(org.id) || org.name !== plan.organizationName) throw new Error("Account workspace does not match");
    return { organizationId: org.id };
  }
  async function cleanup(plan: Plan) {
    if (!plan.remote || (plan.remote.organizationId !== null && !UUID.test(plan.remote.organizationId))) throw new Error("Missing approved target");
    const orgId = plan.remote.organizationId;
    if (orgId) {
      if (plan.scope === "workspace") {
        const org = (await rows("organizations", { select: "id,created_by", id: `eq.${orgId}`, limit: "1" }))[0];
        if (org && org.created_by !== plan.subject) throw new Error("Ownership changed");
        const members = await rows("memberships", { select: "user_id", organization_id: `eq.${orgId}`, limit: "1001" });
        if (members.length > 1000 || members.some((m) => !plan.memberSubjects.includes(m.user_id))) throw new Error("Membership changed");
        await rest(`/rest/v1/organizations?${new URLSearchParams({ id: `eq.${orgId}`, created_by: `eq.${plan.subject}` })}`, "DELETE");
        if ((await rows("organizations", { select: "id", id: `eq.${orgId}`, limit: "1" })).length) throw new Error("Workspace deletion is not confirmed");
      } else {
        await rest(`/rest/v1/memberships?${new URLSearchParams({ organization_id: `eq.${orgId}`, user_id: `eq.${plan.subject}` })}`, "DELETE");
        if ((await rows("memberships", { select: "user_id", organization_id: `eq.${orgId}`, user_id: `eq.${plan.subject}`, limit: "1" })).length) throw new Error("Membership deletion is not confirmed");
      }
    }
    const userResponse = await rest(`/auth/v1/admin/users/${plan.subject}`);
    const user = userResponse?.user ?? userResponse;
    if (!user) return { identityRetained: false };
    if (user.id !== plan.subject || typeof user.email !== "string") throw new Error("Identity mismatch");
    // Match email grants case-insensitively, without allowing pattern characters.
    if (!/^[a-z0-9_.!#$&+\-/=?^`{|}~@]+$/i.test(user.email)) throw new Error("Email grant matching needs review");
    const emailPattern = user.email.replaceAll("_", "\\_");
    // Preserve any identity referenced by the private console, even if its grant
    // is currently revoked, or by a second business. Never modify console tables.
    const checks = await Promise.all([
      rows("management_console_access", { select: "id", user_id: `eq.${plan.subject}`, limit: "1" }),
      rows("management_console_access", { select: "id", email: `ilike.${emailPattern}`, limit: "1" }),
      rows("team_access_invitations", { select: "id", auth_user_id: `eq.${plan.subject}`, limit: "1" }),
      rows("team_access_invitations", { select: "id", email: `ilike.${emailPattern}`, limit: "1" }),
      rows("team_access_invitations", { select: "id", invited_by_user_id: `eq.${plan.subject}`, limit: "1" }),
      rows("memberships", { select: "user_id", user_id: `eq.${plan.subject}`, limit: "1" }),
      rows("organizations", { select: "id", created_by: `eq.${plan.subject}`, limit: "1" }),
    ]);
    if (checks.some((records) => records.length > 0)) return { identityRetained: true };
    // This is the requesting person only. Workspace members' identities are never deleted.
    await rest(`/auth/v1/admin/users/${plan.subject}`, "DELETE");
    if (await rest(`/auth/v1/admin/users/${plan.subject}`)) throw new Error("Identity deletion is not confirmed");
    return { identityRetained: false };
  }
  return async (request: Request) => {
    if (request.method !== "POST") return reply({ ok: false }, 405);
    let input: Record<string, unknown>;
    try {
      if (!request.headers.get("content-type")?.startsWith("application/json")) return reply({ ok: false }, 415);
      const reader = request.body?.getReader();
      if (!reader) return reply({ ok: false }, 400);
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > 1024) { await reader.cancel(); return reply({ ok: false }, 413); }
        chunks.push(next.value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      input = JSON.parse(new TextDecoder().decode(bytes));
      if (!UUID.test(String(input.jobId)) || !/^[a-f0-9]{64}$/.test(String(input.token)) || !["prepare", "cleanup"].includes(String(input.action))) return reply({ ok: false }, 403);
      const proof = await fetcher(PLAN_URL, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId: input.jobId, token: input.token }), signal: AbortSignal.timeout(8_000), redirect: "error" });
      if (!proof.ok) return reply({ ok: false }, 403);
      const plan: Plan = await proof.json();
      if (!UUID.test(plan.subject) || !["account", "workspace"].includes(plan.scope) || !Array.isArray(plan.memberSubjects)) return reply({ ok: false }, 403);
      if (input.action === "prepare" && plan.stage === "checking") return reply({ ok: true, ...await prepare(plan) });
      if (input.action === "cleanup" && plan.stage === "local_deleted") return reply({ ok: true, ...await cleanup(plan) });
      return reply({ ok: false }, 409);
    } catch {
      // Do not log capabilities, payroll data, emails or provider responses.
      return reply({ ok: false, code: "DELETION_REVIEW_OR_RETRY_REQUIRED" }, 503);
    }
  };
}
