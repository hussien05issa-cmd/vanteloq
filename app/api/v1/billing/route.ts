import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { tenantAddons, tenantSubscriptions } from "../../../../db/schema";
import { requireAccess } from "../../../../server/authorization";
import { handleApi, jsonResponse } from "../../../../server/api";
import { stripeBillingReadiness } from "../../../../server/billing/stripe";
import { ADDONS, PLANS } from "../../../../server/entitlements/catalog";
import { getTenantEntitlements } from "../../../../server/entitlements/engine";
import { requirePermission } from "../../../../server/permissions";

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, ["owner", "admin"]);
    await requirePermission(context, "organization.billing");
    const [subscriptions, addons, entitlements] = await Promise.all([
      getDb().select().from(tenantSubscriptions).where(eq(tenantSubscriptions.organizationId, context.organizationId)).limit(1),
      getDb().select().from(tenantAddons).where(eq(tenantAddons.organizationId, context.organizationId)),
      getTenantEntitlements(context),
    ]);
    const subscription = subscriptions[0];
    return jsonResponse({
      configured: stripeBillingReadiness().configured,
      accessType: entitlements.accessType,
      current: {
        plan: entitlements.plan,
        status: entitlements.subscriptionStatus,
        addons: entitlements.addons,
        billingInterval: subscription?.billingInterval ?? null,
        currentPeriodEndsAt: entitlements.currentPeriodEndsAt,
        cancelAtPeriodEnd: entitlements.cancelAtPeriodEnd,
        hasCustomer: Boolean(subscription?.stripeCustomerId),
      },
      plans: Object.values(PLANS).map((plan) => ({
        key: plan.key,
        name: plan.displayName,
        description: plan.description,
        mostPopular: plan.mostPopular,
        price: plan.prices.month.amountCents,
      })),
      addon: { key: "bookloq", name: ADDONS.bookloq.displayName, price: ADDONS.bookloq.prices.month.amountCents },
      purchaseInterval: "month",
      synchronizedAddonRows: addons.length,
      currency: "CAD",
    });
  });
}
