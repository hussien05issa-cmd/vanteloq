import { eq } from "drizzle-orm";
import { getD1, getDb, getRuntimeEnv } from "../../../../../db";
import { tenantSubscriptions } from "../../../../../db/schema";
import { requirePrivacyAccess } from "../../../../../server/authorization";
import { terminateStripeBilling } from "../../../../../server/billing/stripe";
import {
  ApiError,
  enforceRateLimit,
  handleApi,
  hashIdentifier,
  jsonResponse,
  readJsonObject,
  requireSameOrigin,
  requireRecentMfa,
} from "../../../../../server/api";
import {
  deleteSupabaseAuthUser,
  revokeSupabaseSessions,
  supabaseAccountDeletionReadiness,
} from "../../../../../server/supabase";

const WORKSPACE_CONFIRMATION = "DELETE VANTELOQ WORKSPACE";
const ACCOUNT_CONFIRMATION = "DELETE MY VANTELOQ ACCOUNT";
const RECEIPT_RETENTION_SECONDS = 2 * 365 * 24 * 60 * 60;

type AuthSubject = { id: string; authSubject: string | null; membershipCount: number };

async function deleteExpiredReceipts(nowSeconds = Math.floor(Date.now() / 1_000)) {
  await getD1().prepare("DELETE FROM account_deletion_receipts WHERE expires_at < ?")
    .bind(nowSeconds)
    .run();
}

async function deleteWorkspaceObjects(organizationId: string) {
  const bucket = getRuntimeEnv().BUCKET;
  if (!bucket) return 0;
  let cursor: string | undefined;
  let deleted = 0;
  do {
    const page = await bucket.list({ prefix: `${organizationId}/`, cursor, limit: 1_000 });
    if (page.objects.length) {
      await bucket.delete(page.objects.map((object) => object.key));
      deleted += page.objects.length;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return deleted;
}

async function deleteAuthSubjects(subjects: Array<string | null>) {
  const outcomes = await Promise.all(subjects.filter((subject): subject is string => Boolean(subject)).map(async (subject) => {
    try {
      return await deleteSupabaseAuthUser(subject);
    } catch {
      return false;
    }
  }));
  return { attempted: outcomes.length, completed: outcomes.filter(Boolean).length, pending: outcomes.filter((value) => !value).length };
}

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requirePrivacyAccess(request, ["owner", "admin", "manager", "employee", "read_only", "integration"]);
    await deleteExpiredReceipts();
    const scope = context.role === "owner" ? "workspace" : "account";
    return jsonResponse({
      available: supabaseAccountDeletionReadiness().configured,
      scope,
      confirmation: scope === "workspace" ? WORKSPACE_CONFIRMATION : ACCOUNT_CONFIRMATION,
      consequences: scope === "workspace"
        ? ["The Stripe subscription and customer are canceled and removed before deletion.", "Every Vanteloq member, integration credential, workspace record, and stored file is permanently removed.", "Provider financial records may remain with Stripe or another provider where law or the provider's own agreement requires retention."]
        : ["Your Vanteloq login, membership, personal profile, preferences, and private assistant history are removed.", "Business records you created remain for the organization under an anonymous user reference."],
    });
  });
}

export async function POST(request: Request) {
  return handleApi(request, async () => {
    requireSameOrigin(request);
    const context = await requirePrivacyAccess(request, ["owner", "admin", "manager", "employee", "read_only", "integration"]);
    if (!supabaseAccountDeletionReadiness().configured) {
      throw new ApiError(503, "ACCOUNT_DELETION_CONFIGURATION_REQUIRED", "Secure account deletion is temporarily unavailable. Contact the privacy officer.");
    }
    await enforceRateLimit("account:delete", context.userId, 3, 86_400);
    requireRecentMfa(context.identity);
    const input = await readJsonObject(request, 2_000);
    const scope = context.role === "owner" ? "workspace" : "account";
    const requiredConfirmation = scope === "workspace" ? WORKSPACE_CONFIRMATION : ACCOUNT_CONFIRMATION;
    if (input.confirmation !== requiredConfirmation || input.acknowledgeNoRecovery !== true) {
      throw new ApiError(400, "ACCOUNT_DELETE_CONFIRMATION_REQUIRED", `Type ${requiredConfirmation} and confirm that deletion cannot be reversed.`);
    }
    if (scope === "workspace" && input.acknowledgeBillingCancellation !== true) {
      throw new ApiError(400, "BILLING_CANCELLATION_ACKNOWLEDGEMENT_REQUIRED", "Confirm that the Vanteloq subscription will be canceled immediately.");
    }

    const accountHash = await hashIdentifier(`vanteloq-account:${context.authSubject ?? context.userId}`);
    const organizationHash = await hashIdentifier(`vanteloq-workspace:${context.organizationId}`);
    const nowSeconds = Math.floor(Date.now() / 1_000);
    const receiptId = crypto.randomUUID();
    const database = getD1();
    await deleteExpiredReceipts(nowSeconds);
    await revokeSupabaseSessions(request).catch(() => false);

    if (scope === "workspace") {
      const [subscription, membersResult] = await Promise.all([
        getDb().select({
          stripeCustomerId: tenantSubscriptions.stripeCustomerId,
          stripeSubscriptionId: tenantSubscriptions.stripeSubscriptionId,
        }).from(tenantSubscriptions).where(eq(tenantSubscriptions.organizationId, context.organizationId)).limit(1).then((rows) => rows[0] ?? null),
        database.prepare(`
          SELECT u.id, u.auth_subject AS authSubject,
            (SELECT COUNT(*) FROM memberships all_memberships WHERE all_memberships.user_id = u.id) AS membershipCount
          FROM users u
          INNER JOIN memberships target_membership ON target_membership.user_id = u.id
          WHERE target_membership.organization_id = ?
        `).bind(context.organizationId).all<AuthSubject>(),
      ]);
      const members = membersResult.results ?? [];
      const exclusiveMembers = members.filter((member) => Number(member.membershipCount) <= 1);
      const billing = await terminateStripeBilling({
        subscriptionId: subscription?.stripeSubscriptionId ?? null,
        customerId: subscription?.stripeCustomerId ?? null,
      });
      const storedFilesDeleted = await deleteWorkspaceObjects(context.organizationId);
      const deletionStatements = [
        database.prepare("DELETE FROM audit_events WHERE organization_id = ?").bind(context.organizationId),
        database.prepare("DELETE FROM workspaces WHERE id = ?").bind(context.organizationId),
        ...exclusiveMembers.map((member) => database.prepare("DELETE FROM users WHERE id = ?").bind(member.id)),
        database.prepare(`
          INSERT INTO account_deletion_receipts
            (id, account_hash, organization_hash, scope, result, retained_categories_json, provider_outcomes_json, completed_at, expires_at)
          VALUES (?, ?, ?, 'workspace', 'auth_cleanup_pending', ?, ?, ?, ?)
        `).bind(
          receiptId,
          accountHash,
          organizationHash,
          JSON.stringify(["Stripe and provider records retained independently where legally required", "Nonidentifying deletion receipt retained for 24 months"]),
          JSON.stringify({ ...billing, storedFilesDeleted, localIntegrationCredentialsDeleted: true }),
          nowSeconds,
          nowSeconds + RECEIPT_RETENTION_SECONDS,
        ),
      ];
      await database.batch(deletionStatements);
      const auth = await deleteAuthSubjects(exclusiveMembers.map((member) => member.authSubject));
      await database.prepare("UPDATE account_deletion_receipts SET result = ?, provider_outcomes_json = ? WHERE id = ?")
        .bind(
          auth.pending ? "auth_cleanup_pending" : "completed",
          JSON.stringify({ ...billing, storedFilesDeleted, localIntegrationCredentialsDeleted: true, auth }),
          receiptId,
        ).run();
      return jsonResponse({ deleted: true, scope, receiptId, authCleanupPending: auth.pending > 0 });
    }

    const deletedAlias = `deleted+${accountHash.slice(0, 24)}@invalid.vanteloq`;
    await database.batch([
      database.prepare("DELETE FROM assistant_messages WHERE user_id = ?").bind(context.userId),
      database.prepare("DELETE FROM assistant_conversations WHERE user_id = ?").bind(context.userId),
      database.prepare("DELETE FROM legal_acceptances WHERE user_id = ?").bind(context.userId),
      database.prepare("DELETE FROM account_preferences WHERE user_id = ?").bind(context.userId),
      database.prepare("DELETE FROM memberships WHERE user_id = ? AND organization_id = ?").bind(context.userId, context.organizationId),
      database.prepare(`
        UPDATE team_members
        SET user_id = NULL, first_name = 'Deleted', last_name = 'User', preferred_name = '',
            email = ?, mobile = '', employee_code = ?, job_title = '', department = '',
            status = 'archived', remote_login = 0, require_mfa = 0, pin_enabled = 0,
            notes = '', updated_at = ?
        WHERE user_id = ? AND organization_id = ?
      `).bind(deletedAlias, `deleted-${accountHash.slice(0, 16)}`, nowSeconds, context.userId, context.organizationId),
      database.prepare("UPDATE audit_events SET actor_user_id = NULL, source_hash = NULL, details_json = '{}' WHERE actor_user_id = ?").bind(context.userId),
      database.prepare(`
        UPDATE users SET email = ?, display_name = 'Deleted user', status = 'suspended',
          auth_subject = NULL, auth_provider = NULL, updated_at = ? WHERE id = ?
      `).bind(deletedAlias, nowSeconds, context.userId),
      database.prepare(`
        INSERT INTO account_deletion_receipts
          (id, account_hash, organization_hash, scope, result, retained_categories_json, provider_outcomes_json, completed_at, expires_at)
        VALUES (?, ?, ?, 'account', 'auth_cleanup_pending', ?, '{}', ?, ?)
      `).bind(
        receiptId,
        accountHash,
        organizationHash,
        JSON.stringify(["Anonymous authorship references in organization business records", "Nonidentifying deletion receipt retained for 24 months"]),
        nowSeconds,
        nowSeconds + RECEIPT_RETENTION_SECONDS,
      ),
    ]);
    const auth = await deleteAuthSubjects([context.authSubject]);
    await database.prepare("UPDATE account_deletion_receipts SET result = ?, provider_outcomes_json = ? WHERE id = ?")
      .bind(auth.pending ? "auth_cleanup_pending" : "completed", JSON.stringify({ auth }), receiptId).run();
    return jsonResponse({ deleted: true, scope, receiptId, authCleanupPending: auth.pending > 0 });
  });
}
