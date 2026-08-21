import { eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { tenantSubscriptions } from "../../../../../db/schema";
import { requireBillingAccess } from "../../../../../server/authorization";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, requireSameOrigin } from "../../../../../server/api";
import { createStripePortal } from "../../../../../server/billing/stripe";
import { requirePermission } from "../../../../../server/permissions";

export async function POST(request: Request) {
  return handleApi(request, async () => {
    requireSameOrigin(request);
    const context = await requireBillingAccess(request, ["owner", "admin"]);
    await requirePermission(context, "organization.billing");
    await enforceRateLimit("billing:portal", context.userId, 30, 3_600);
    const [subscription] = await getDb().select().from(tenantSubscriptions).where(eq(tenantSubscriptions.organizationId, context.organizationId)).limit(1);
    if (!subscription?.stripeCustomerId) throw new ApiError(409, "STRIPE_CUSTOMER_REQUIRED", "Complete Stripe checkout before opening billing management.");
    return jsonResponse(await createStripePortal(subscription.stripeCustomerId, new URL(request.url).origin));
  });
}
