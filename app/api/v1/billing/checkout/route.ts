import { eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { tenantSubscriptions } from "../../../../../db/schema";
import { requireBillingAccess } from "../../../../../server/authorization";
import { enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin, ApiError } from "../../../../../server/api";
import { startStripeCheckout } from "../../../../../server/billing/checkout";
import { isPlanKey } from "../../../../../server/entitlements/catalog";
import { requirePermission } from "../../../../../server/permissions";
import { getTenantEntitlements } from "../../../../../server/entitlements/engine";

export async function POST(request: Request) {
  return handleApi(request, async () => {
    requireSameOrigin(request);
    const context = await requireBillingAccess(request, ["owner", "admin"]);
    await requirePermission(context, "organization.billing");
    if ((await getTenantEntitlements(context)).accessType === "internal") {
      throw new ApiError(409, "INTERNAL_ACCESS_INCLUDED", "Your internal company access is already included. No subscription is required.");
    }
    await enforceRateLimit("billing:checkout", context.userId, 10, 3_600);
    const input = await readJsonObject(request, 4_096);
    const plan = input.plan;
    const interval = input.interval;
    if (!isPlanKey(plan) || interval !== "month") {
      throw new ApiError(400, "BILLING_SELECTION_INVALID", "Select a valid Vanteloq monthly plan.");
    }
    const [subscription] = await getDb().select().from(tenantSubscriptions).where(eq(tenantSubscriptions.organizationId, context.organizationId)).limit(1);
    if (subscription?.stripeSubscriptionId && !["canceled", "incomplete_expired"].includes(subscription.status)) {
      throw new ApiError(409, "BILLING_PORTAL_REQUIRED", "Use Manage billing to update or restore your existing subscription.");
    }
    const origin = new URL(request.url).origin;
    return jsonResponse(await startStripeCheckout({
      userId: context.userId,
      organizationId: context.organizationId,
      email: context.identity.email,
      plan,
      interval: "month",
      includeBookloq: input.includeBookloq === true,
      customerId: subscription?.stripeCustomerId ?? null,
      origin,
    }));
  });
}
