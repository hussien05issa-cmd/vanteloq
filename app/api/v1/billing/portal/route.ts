import { eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { tenantSubscriptions } from "../../../../../db/schema";
import { requireBillingAccess } from "../../../../../server/authorization";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../../server/api";
import { createStripePortal } from "../../../../../server/billing/stripe";
import { requirePermission } from "../../../../../server/permissions";

export async function POST(request: Request) {
  return handleApi(request, async () => {
    requireSameOrigin(request);
    const context = await requireBillingAccess(request, ["owner", "admin"]);
    await requirePermission(context, "organization.billing");
    await enforceRateLimit("billing:portal", context.userId, 30, 3_600);
    const input = await readJsonObject(request, 1_024);
    if (Object.keys(input).some(key => key !== "action") || (input.action !== undefined && input.action !== "manage" && input.action !== "cancel")) throw new ApiError(400, "BILLING_PORTAL_ACTION_INVALID", "Choose billing management or subscription cancellation.");
    const [subscription] = await getDb().select().from(tenantSubscriptions).where(eq(tenantSubscriptions.organizationId, context.organizationId)).limit(1);
    if (!subscription?.stripeCustomerId) throw new ApiError(409, "STRIPE_CUSTOMER_REQUIRED", "Complete Stripe checkout before opening billing management.");
    if (input.action === "cancel" && (!subscription.stripeSubscriptionId || ["canceled", "incomplete_expired"].includes(subscription.status))) throw new ApiError(409, "STRIPE_SUBSCRIPTION_REQUIRED", "There is no current subscription to cancel.");
    return jsonResponse(await createStripePortal(subscription.stripeCustomerId, new URL(request.url).origin, fetch, input.action === "cancel" ? subscription.stripeSubscriptionId! : undefined));
  });
}
