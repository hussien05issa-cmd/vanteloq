import { getD1 } from "../../../../../db";
import { requireBillingAccess } from "../../../../../server/authorization";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, requireSameOrigin } from "../../../../../server/api";
import { FREE_PLAN } from "../../../../../server/entitlements/catalog";
import { getTenantEntitlements } from "../../../../../server/entitlements/engine";
import { requirePermission } from "../../../../../server/permissions";
import { hasCurrentLegalAcceptance } from "../../../../../server/legal-acceptance";
import { recordAudit } from "../../../../../server/audit";

/** App-owned enrolment. No Stripe customer, checkout or subscription is created. */
export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireBillingAccess(request, ["owner"]);
    await requirePermission(context, "organization.billing");
    await enforceRateLimit("billing:free", context.userId, 12, 3_600);
    if (!await hasCurrentLegalAcceptance(context.userId)) throw new ApiError(409, "LEGAL_ACCEPTANCE_REQUIRED", "Accept the current Terms of Service and Privacy Policy before starting Free.");
    const current = await getTenantEntitlements(context);
    if (current.accessType === "free") return jsonResponse({ activated: true, plan: "free" });
    if (current.accessType !== "none") throw new ApiError(409, "ACCESS_ALREADY_ACTIVE", "Your existing workspace access is already active. Manage a paid subscription through billing before changing it.");
    const database = getD1();
    const result = await database.prepare(`INSERT INTO free_plan_enrollments (organization_id,policy_version,created_at)
      SELECT ?,?,? WHERE
        NOT EXISTS (SELECT 1 FROM tenant_subscriptions WHERE organization_id=? AND status NOT IN ('canceled','incomplete_expired'))
        AND (SELECT COUNT(*) FROM organization_locations WHERE organization_id=? AND status='active')<=1
        AND (SELECT COUNT(*) FROM memberships WHERE organization_id=? AND status='active')<=1
        AND NOT EXISTS (SELECT 1 FROM team_members WHERE organization_id=? AND remote_login=1
          AND status IN ('draft','invited','pending_verification','active') AND (user_id IS NULL OR user_id<>?))
      ON CONFLICT(organization_id) DO NOTHING RETURNING organization_id`)
      .bind(context.organizationId,FREE_PLAN.policyVersion,Date.now(),context.organizationId,context.organizationId,
        context.organizationId,context.organizationId,context.userId).first();
    if (!result) {
      if ((await getTenantEntitlements(context)).accessType === "free") return jsonResponse({ activated: true, plan: "free" });
      throw new ApiError(409, "FREE_PLAN_CAPACITY_REQUIRED", "Free supports one owner and one active location. Review existing billing, locations and team access before switching.");
    }
    await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
      action: "billing.free_activated", resourceType: "workspace", resourceId: context.organizationId,
      details: { policyVersion: FREE_PLAN.policyVersion } });
    return jsonResponse({ activated: true, plan: "free" });
  });
}
