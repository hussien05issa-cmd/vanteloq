import { getD1 } from "../../../../../db";
import { requirePrivacyAccess } from "../../../../../server/authorization";
import { ApiError, enforceRateLimit, handleApi, hashIdentifier, jsonResponse, readJsonObject, requireSameOrigin, requireRecentMfa, requireIdentity, requireAal2 } from "../../../../../server/api";
import { deletionReadiness, sealDeletionPlan, DELETION_JOB_TTL, type DeletionPlan } from "../../../../../server/account-deletion";

const roles = ["owner", "admin", "manager", "employee", "read_only", "integration"] as const;
const WORKSPACE_CONFIRMATION = "DELETE VANTELOQ WORKSPACE";
const ACCOUNT_CONFIRMATION = "DELETE MY VANTELOQ ACCOUNT";

async function deletionContext(request: Request) {
  try { return await requirePrivacyAccess(request, roles); }
  catch (error) {
    if (!(error instanceof ApiError) || error.code !== "MEMBERSHIP_REQUIRED") throw error;
    const identity = await requireIdentity(request);
    requireAal2(identity);
    const row = await getD1().prepare("SELECT u.id, (SELECT COUNT(*) FROM memberships m WHERE m.user_id = u.id) count FROM users u WHERE auth_subject = ?")
      .bind(identity.subject).first<{id:string; count:number}>();
    // A never-onboarded account can delete itself. A suspended workspace
    // relationship still needs scope review; lack of access is not ownership.
    if (Number(row?.count) > 0) throw new ApiError(409, "DELETION_SCOPE_REVIEW", "This account has a suspended workspace relationship. Contact the Privacy Officer to verify its deletion scope.");
    return { identity, role: "employee" as const, authSubject: identity.subject, userId: row?.id ?? identity.subject!, organizationId: "", organization: {businessName:""} };
  }
}

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await deletionContext(request);
    const scope = context.role === "owner" ? "workspace" : "account";
    return jsonResponse({ available: deletionReadiness(), scope,
      confirmation: scope === "workspace" ? WORKSPACE_CONFIRMATION : ACCOUNT_CONFIRMATION,
      consequences: scope === "workspace" ? [
        "The Vanteloq subscription is canceled before workspace records and files are removed. Export any records your business must retain first.",
        "This removes workspace data, stored files, local integration credentials and workspace memberships. Other members' independent sign-in identities are not deleted.",
        "Your own sign-in identity is removed only when it is not needed by another workspace or the private console.",
        "Independent providers may retain their own records. Disconnect providers first. Completion is confirmed only after the required cleanup finishes.",
      ] : [
        "Your Vanteloq membership, personal profile, preferences and private assistant history are removed.",
        "Business records remain with anonymous authorship where needed. A shared sign-in used by another workspace or the private console is preserved.",
      ],
    });
  });
}

export async function POST(request: Request) {
  return handleApi(request, async () => {
    requireSameOrigin(request);
    const context = await deletionContext(request);
    requireRecentMfa(context.identity);
    if (!deletionReadiness()) throw new ApiError(503, "ACCOUNT_DELETION_CONFIGURATION_REQUIRED", "Secure deletion is temporarily unavailable. Contact the Privacy Officer.");
    const input = await readJsonObject(request, 2_000);
    const scope = context.role === "owner" ? "workspace" : "account";
    if (input.confirmation !== (scope === "workspace" ? WORKSPACE_CONFIRMATION : ACCOUNT_CONFIRMATION) || input.acknowledgeNoRecovery !== true) {
      throw new ApiError(400, "ACCOUNT_DELETE_CONFIRMATION_REQUIRED", "Enter the exact deletion phrase and acknowledge that deletion cannot be reversed.");
    }
    if (scope === "workspace" && input.acknowledgeBillingCancellation !== true) throw new ApiError(400, "BILLING_CANCELLATION_ACKNOWLEDGEMENT_REQUIRED", "Confirm immediate subscription cancellation.");
    if (typeof input.jobId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.jobId) || typeof input.token !== "string" || !/^[a-f0-9]{64}$/.test(input.token)) {
      throw new ApiError(400, "DELETION_SESSION_REQUIRED", "Start a new protected deletion session.");
    }
    if (!context.authSubject) throw new ApiError(403, "DELETION_IDENTITY_REQUIRED", "A verified account identity is required.");
    const db = getD1();
    const now = Math.floor(Date.now() / 1_000);
    const accountHash = await hashIdentifier(`vanteloq-account:${context.authSubject}`);
    const tokenHash = await hashIdentifier(`deletion-key:${input.jobId}:${input.token}`);
    const previous = await db.prepare("SELECT id, token_hash, stage FROM account_deletion_jobs WHERE account_hash = ?").bind(accountHash).first<{id: string; token_hash: string; stage: string}>();
    if (previous) {
      if (previous.id === input.jobId && previous.token_hash === tokenHash) return jsonResponse({ accepted: true, receiptId: previous.id }, { status: 202 });
      if (previous.stage === "completed") {
        // A shared identity may later create a new Vanteloq account. Its old
        // receipt remains, but must not prevent a new confirmed deletion.
        await db.prepare("DELETE FROM account_deletion_jobs WHERE id = ? AND stage = 'completed'").bind(previous.id).run();
      } else throw new ApiError(409, "DELETION_ALREADY_REQUESTED", "A deletion is already recorded. Resume it in the browser where you confirmed it, or contact the Privacy Officer with its receipt number.");
    }
    await enforceRateLimit("account:delete", context.userId, 3, 86_400);
    const members = await db.prepare(`SELECT u.id, u.auth_subject AS subject,
      (SELECT COUNT(*) FROM memberships all_memberships WHERE all_memberships.user_id = u.id) AS membershipCount
      FROM users u JOIN memberships m ON m.user_id = u.id WHERE m.organization_id = ?`).bind(context.organizationId)
      .all<{id: string; subject: string | null; membershipCount: number}>();
    const membershipCount = await db.prepare("SELECT COUNT(*) count FROM memberships WHERE user_id = ?").bind(context.userId).first<{count: number}>();
    if (scope === "account" && Number(membershipCount?.count) > 1) throw new ApiError(409, "DELETION_SCOPE_REVIEW", "This account has multiple workspace relationships. Contact the Privacy Officer to choose the correct deletion scope.");
    const subscription = await db.prepare("SELECT stripe_subscription_id subscriptionId, stripe_customer_id customerId FROM tenant_subscriptions WHERE organization_id = ?")
      .bind(context.organizationId).first<{subscriptionId: string | null; customerId: string | null}>();
    const connections = await db.prepare("SELECT COUNT(*) count FROM integration_connections WHERE organization_id = ? AND status NOT IN ('not_connected','revoked')").bind(context.organizationId).first<{count: number}>();
    if (scope === "workspace" && Number(connections?.count) > 0) throw new ApiError(409, "DELETION_DISCONNECT_REQUIRED", "Disconnect your providers in Integrations before deleting this workspace. This allows their authorization to be revoked safely.");
    const plan: DeletionPlan = {
      subject: context.authSubject, organizationName: context.organization.businessName,
      memberSubjects: scope === "workspace" ? (members.results ?? []).flatMap((m) => m.subject ? [m.subject] : []) : [context.authSubject],
      exclusiveUserIds: scope === "workspace" ? (members.results ?? []).filter((m) => Number(m.membershipCount) === 1).map((m) => m.id) : [],
      subscriptionId: scope === "workspace" ? subscription?.subscriptionId ?? null : null,
      customerId: scope === "workspace" ? subscription?.customerId ?? null : null,
    };
    await db.prepare(`INSERT INTO account_deletion_jobs (id, account_hash, organization_id, user_id, scope, token_hash, plan_encrypted, stage, result_json, lease_until, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'checking', '{}', 0, ?, ?)`).bind(input.jobId, accountHash, context.organizationId, context.userId, scope, tokenHash, await sealDeletionPlan(plan), now, now + DELETION_JOB_TTL).run();
    await db.prepare("DELETE FROM account_deletion_receipts WHERE expires_at < ?").bind(now).run();
    await db.prepare("DELETE FROM account_deletion_jobs WHERE stage = 'completed' AND expires_at < ?").bind(now).run();
    return jsonResponse({ accepted: true, receiptId: input.jobId }, { status: 202 });
  });
}
