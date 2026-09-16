import { getD1, getRuntimeEnv } from "../db";
import { ApiError, hashIdentifier } from "./api";
import { eraseMarketingProfileForSubject } from "./communications";
import { terminateStripeBilling } from "./billing/stripe";
import { encryptIntegrationSecret, decryptIntegrationSecret } from "./integrations/lightspeed";

export type DeletionPlan = {
  subject: string;
  organizationName: string;
  memberSubjects: string[];
  exclusiveUserIds: string[];
  subscriptionId: string | null;
  customerId: string | null;
  remote?: { organizationId: string | null };
};
export type DeletionJob = {
  id: string; account_hash: string; organization_id: string; user_id: string;
  scope: "account" | "workspace"; token_hash: string; plan_encrypted: string;
  stage: "checking" | "confirmed" | "local_deleted" | "completed";
  result_json: string; lease_until: number; expires_at: number;
};
export const DELETION_JOB_TTL = 30 * 24 * 60 * 60;
const RECEIPT_TTL = 2 * 365 * 24 * 60 * 60;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[a-f0-9]{64}$/;

export function deletionReadiness() {
  const env = getRuntimeEnv();
  return env.VANTELOQ_DELETION_ENABLED === "true" && Boolean(env.DB && env.BUCKET && env.SUPABASE_URL && env.INTEGRATION_ENCRYPTION_KEY);
}

export async function sealDeletionPlan(plan: DeletionPlan) {
  return encryptIntegrationSecret(JSON.stringify({ purpose: "vanteloq-deletion-v1", plan }));
}
export async function openDeletionPlan(job: DeletionJob): Promise<DeletionPlan> {
  const value = JSON.parse(await decryptIntegrationSecret(job.plan_encrypted));
  if (value.purpose !== "vanteloq-deletion-v1" || !ID.test(value.plan?.subject ?? "")) {
    throw new ApiError(503, "DELETION_PLAN_INVALID", "The protected deletion plan needs support review.");
  }
  return value.plan;
}

export async function authorizeDeletionJob(id: unknown, token: unknown): Promise<DeletionJob> {
  if (typeof id !== "string" || !ID.test(id) || typeof token !== "string" || !TOKEN.test(token)) {
    throw new ApiError(403, "DELETION_KEY_INVALID", "This deletion session could not be verified.");
  }
  const tokenHash = await hashIdentifier(`deletion-key:${id}:${token}`);
  const job = await getD1().prepare("SELECT * FROM account_deletion_jobs WHERE id = ? AND token_hash = ? AND expires_at > ?")
    .bind(id, tokenHash, Math.floor(Date.now() / 1_000)).first<DeletionJob>();
  if (!job) throw new ApiError(403, "DELETION_KEY_INVALID", "This deletion session has expired or could not be verified. Contact the Privacy Officer with your receipt number.");
  return job;
}

async function identityBridge(job: DeletionJob, token: string, action: "prepare" | "cleanup") {
  const base = new URL(getRuntimeEnv().SUPABASE_URL ?? "");
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) throw new Error("Invalid identity service");
  const response = await fetch(`${base.origin}/functions/v1/vanteloq-account-deletion`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobId: job.id, token, action }), signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok !== true) {
    throw new ApiError(503, "DELETION_IDENTITY_PENDING", action === "prepare"
      ? "Identity ownership could not be verified safely. No workspace data has been deleted. Contact the Privacy Officer if retrying does not resolve this."
      : "Vanteloq records were removed, but identity cleanup is still pending. Retry this saved deletion session; completion has not been confirmed.");
  }
  return body as { ok: true; organizationId?: string | null; identityRetained?: boolean };
}

async function deleteWorkspaceObjects(organizationId: string, renewLease: () => Promise<void>) {
  const bucket = getRuntimeEnv().BUCKET;
  if (!bucket) throw new ApiError(503, "DELETION_STORAGE_UNAVAILABLE", "File deletion could not be verified. Please retry.");
  // Re-list from the start after deletion. A cursor can skip objects in a mutating list.
  for (let page = 0; page < 100; page++) {
    await renewLease();
    const result = await bucket.list({ prefix: `${organizationId}/`, limit: 1_000 });
    if (!result.objects.length) return;
    await renewLease();
    await bucket.delete(result.objects.map((item) => item.key));
  }
  throw new ApiError(503, "DELETION_FILES_PENDING", "More files remain to be removed. Continue this deletion session.");
}

async function eraseLocal(job: DeletionJob, plan: DeletionPlan) {
  const db = getD1();
  const now = Math.floor(Date.now() / 1_000);
  const organizationHash = await hashIdentifier(`vanteloq-workspace:${job.organization_id}`);
  const alias = `deleted+${job.account_hash.slice(0, 24)}@invalid.vanteloq`;
  const statements = job.scope === "workspace" ? [
    db.prepare("DELETE FROM tasks WHERE organization_id = ?").bind(job.organization_id),
    db.prepare("DELETE FROM audit_events WHERE organization_id = ?").bind(job.organization_id),
    db.prepare("DELETE FROM workspaces WHERE id = ?").bind(job.organization_id),
    ...plan.exclusiveUserIds.map((id) => db.prepare("DELETE FROM users WHERE id = ? AND NOT EXISTS (SELECT 1 FROM memberships WHERE user_id = ?)").bind(id, id)),
  ] : [
    db.prepare("DELETE FROM assistant_messages WHERE user_id = ?").bind(job.user_id),
    db.prepare("DELETE FROM assistant_conversations WHERE user_id = ?").bind(job.user_id),
    db.prepare("DELETE FROM legal_acceptances WHERE user_id = ?").bind(job.user_id),
    db.prepare("DELETE FROM account_preferences WHERE user_id = ?").bind(job.user_id),
    db.prepare("DELETE FROM memberships WHERE user_id = ? AND organization_id = ?").bind(job.user_id, job.organization_id),
    db.prepare(`UPDATE team_members SET user_id = NULL, first_name = 'Deleted', last_name = 'User', preferred_name = '', email = ?, mobile = '', employee_code = ?, job_title = '', department = '', status = 'archived', remote_login = 0, require_mfa = 0, pin_enabled = 0, notes = '', updated_at = ? WHERE user_id = ? AND organization_id = ?`)
      .bind(alias, `deleted-${job.account_hash.slice(0, 16)}`, now, job.user_id, job.organization_id),
    db.prepare("UPDATE audit_events SET actor_user_id = NULL, source_hash = NULL, details_json = '{}' WHERE actor_user_id = ? AND organization_id = ?").bind(job.user_id, job.organization_id),
    db.prepare("UPDATE users SET email = ?, display_name = 'Deleted user', status = 'suspended', auth_subject = NULL, auth_provider = NULL, updated_at = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM memberships WHERE user_id = ?)").bind(alias, now, job.user_id, job.user_id),
  ];
  await db.batch([
    ...statements,
    db.prepare(`INSERT INTO account_deletion_receipts (id, account_hash, organization_hash, scope, result, retained_categories_json, provider_outcomes_json, completed_at, expires_at)
      VALUES (?, ?, ?, ?, 'auth_cleanup_pending', ?, '{}', ?, ?) ON CONFLICT(id) DO NOTHING`)
      .bind(job.id, job.account_hash, organizationHash, job.scope, JSON.stringify(["Independent provider records and legally required accounting records", "Shared identities needed by another service or workspace", "Pseudonymous deletion receipt for 24 months", "Minimal keyed email suppression and unlinked consent evidence"]), now, now + RECEIPT_TTL),
    db.prepare("UPDATE account_deletion_jobs SET stage = 'local_deleted' WHERE id = ?").bind(job.id),
  ]);
}

export async function advanceDeletion(job: DeletionJob, token: string) {
  if (job.stage === "completed") return { deleted: true, receiptId: job.id, ...JSON.parse(job.result_json) };
  if (!deletionReadiness()) throw new ApiError(503, "DELETION_PAUSED", "Deletion processing is temporarily paused. Your confirmed request is preserved.");
  const db = getD1();
  const now = Math.floor(Date.now() / 1_000);
  let leaseUntil = now + 120;
  const lease = await db.prepare("UPDATE account_deletion_jobs SET lease_until = ? WHERE id = ? AND lease_until < ? RETURNING id")
    .bind(leaseUntil, job.id, now).first();
  if (!lease) return { deleted: false, receiptId: job.id, pending: true, message: "Deletion is already processing. Check again shortly." };
  const renewLease = async () => {
    const current = Math.floor(Date.now() / 1_000);
    const next = Math.max(current + 120, leaseUntil + 1);
    const held = await db.prepare("UPDATE account_deletion_jobs SET lease_until = ? WHERE id = ? AND lease_until = ? AND lease_until > ? RETURNING id")
      .bind(next, job.id, leaseUntil, current).first();
    if (!held) throw new ApiError(409, "DELETION_RETRY_REQUIRED", "This processing attempt expired. Check the saved deletion session again; completion is not confirmed.");
    leaseUntil = next;
  };
  try {
    // Read the stage again after acquiring the lease: another attempt may have advanced it.
    job = (await db.prepare("SELECT * FROM account_deletion_jobs WHERE id = ?").bind(job.id).first<DeletionJob>())!;
    if (job.stage === "completed") return { deleted: true, receiptId: job.id, ...JSON.parse(job.result_json) };
    const plan = await openDeletionPlan(job);
    if (job.stage === "checking") {
      const remote = await identityBridge(job, token, "prepare");
      await renewLease();
      if (remote.organizationId !== null && !ID.test(remote.organizationId ?? "")) throw new Error("Invalid identity plan");
      plan.remote = { organizationId: remote.organizationId ?? null };
      await db.prepare("UPDATE account_deletion_jobs SET plan_encrypted = ?, stage = 'confirmed' WHERE id = ?")
        .bind(await sealDeletionPlan(plan), job.id).run();
      job.stage = "confirmed";
    }
    if (job.stage === "confirmed") {
      if (job.scope === "workspace") {
        const connected = await db.prepare("SELECT id FROM integration_connections WHERE organization_id = ? AND status NOT IN ('not_connected','revoked') LIMIT 1").bind(job.organization_id).first();
        if (connected) throw new ApiError(409, "DELETION_PROVIDER_REVIEW", "A provider connection changed after confirmation. Contact the Privacy Officer before continuing.");
        const members = await db.prepare("SELECT u.auth_subject subject FROM users u JOIN memberships m ON m.user_id = u.id WHERE m.organization_id = ?").bind(job.organization_id).all<{subject: string | null}>();
        if ((members.results ?? []).some((m) => m.subject && !plan.memberSubjects.includes(m.subject))) throw new ApiError(409, "DELETION_MEMBERSHIP_REVIEW", "Workspace membership changed after confirmation. Contact the Privacy Officer before continuing.");
        // Store each confirmed billing milestone so a retry never guesses what happened.
        const result = JSON.parse(job.result_json) as Record<string, unknown>;
        if (!result.billingCanceled) {
          await renewLease();
          await terminateStripeBilling({ subscriptionId: plan.subscriptionId, customerId: plan.customerId });
          await renewLease();
          result.billingCanceled = true;
          await db.prepare("UPDATE account_deletion_jobs SET result_json = ? WHERE id = ?").bind(JSON.stringify(result), job.id).run();
        }
        await deleteWorkspaceObjects(job.organization_id, renewLease);
      }
      await renewLease();
      await eraseLocal(job, plan);
      job.stage = "local_deleted";
    }
    if (job.scope === "workspace") await deleteWorkspaceObjects(job.organization_id, renewLease);
    await renewLease();
    const identity = await identityBridge(job, token, "cleanup");
    await renewLease();
    // A remaining Vanteloq membership keeps this person's separate preference.
    // Shared Supabase identity in another product does not retain a closed
    // Vanteloq newsletter profile. Never change other members' choices here.
    const remainingMembership = await db.prepare("SELECT 1 present FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.auth_subject = ? AND m.status = 'active' LIMIT 1").bind(plan.subject).first();
    if (!remainingMembership) await eraseMarketingProfileForSubject(plan.subject);
    await renewLease();
    const result = JSON.stringify({ identityRetained: identity.identityRetained === true });
    await db.batch([
      db.prepare("UPDATE account_deletion_receipts SET result = 'completed', provider_outcomes_json = ?, completed_at = ? WHERE id = ?").bind(result, now, job.id),
      // Drop target identifiers and encrypted plan as soon as cleanup is confirmed.
      db.prepare("UPDATE account_deletion_jobs SET stage = 'completed', result_json = ?, plan_encrypted = '', organization_id = '', user_id = '' WHERE id = ?").bind(result, job.id),
    ]);
    return { deleted: true, receiptId: job.id, identityRetained: identity.identityRetained === true };
  } finally {
    // A delayed attempt must not unlock a newer attempt's lease.
    await db.prepare("UPDATE account_deletion_jobs SET lease_until = 0 WHERE id = ? AND lease_until = ?").bind(job.id, leaseUntil).run();
  }
}
