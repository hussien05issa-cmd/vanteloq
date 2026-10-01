import {PLAN_HIGHLIGHTS as planHighlights} from "../../../../server/entitlements/presentation";
import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { tenantAddons, tenantSubscriptions } from "../../../../db/schema";
import { findAccessContext, requireBillingAccess } from "../../../../server/authorization";
import { handleApi, jsonResponse, requireIdentity, requireAal2 } from "../../../../server/api";
import { stripeBillingReadiness } from "../../../../server/billing/stripe";
import { ADDONS, PLANS } from "../../../../server/entitlements/catalog";
import { getTenantEntitlements } from "../../../../server/entitlements/engine";
import { requirePermission } from "../../../../server/permissions";
import { SUBSCRIPTION_TRIAL_DAYS } from "../../../../shared/subscription-trial";
import { hasCurrentLegalAcceptance } from "../../../../server/legal-acceptance";

export async function GET(request: Request) {
  return handleApi(request, async () => {
    if (new URL(request.url).searchParams.get("onboarding") === "1") {
      const identity = await requireIdentity(request);
      requireAal2(identity);
      if (!await findAccessContext(identity, request)) return jsonResponse({
        ...billingOptions(), trialEligible: true, accessType: "none", canManageBilling: true, needsWorkspace: true,
        current: {plan:null,status:null,addons:[],features:[],limits:null,hasCustomer:false},
      });
    }
    const context = await requireBillingAccess(request, ["owner", "admin"]);
    await requirePermission(context, "organization.billing");
    const [subscriptions, addons, entitlements, legalAcceptanceCurrent] = await Promise.all([
      getDb().select().from(tenantSubscriptions).where(eq(tenantSubscriptions.organizationId, context.organizationId)).limit(1),
      getDb().select().from(tenantAddons).where(eq(tenantAddons.organizationId, context.organizationId)),
      getTenantEntitlements(context),
      hasCurrentLegalAcceptance(context.userId),
    ]);
    const subscription = subscriptions[0];
    return jsonResponse({
      accessType: entitlements.accessType,
      canManageBilling: true,
      legalAcceptanceCurrent,
      trialEligible: !subscription?.stripeSubscriptionId && entitlements.accessType === "none",
      current: {
        plan: entitlements.plan,
        status: entitlements.subscriptionStatus,
        addons: entitlements.addons,
        billingInterval: subscription?.billingInterval ?? null,
        currentPeriodEndsAt: entitlements.currentPeriodEndsAt,
        trialEndsAt: entitlements.trialEndsAt,
        cancelAtPeriodEnd: entitlements.cancelAtPeriodEnd,
        hasCustomer: Boolean(subscription?.stripeCustomerId),
        features: entitlements.features,
        limits: entitlements.limits,
      },
      ...billingOptions(),
      synchronizedAddonRows: addons.length,
    });
  });
}

function billingOptions() {
  return {
      configured: stripeBillingReadiness().configured,
      plans: Object.values(PLANS).map((plan) => ({
        key: plan.key,
        name: plan.displayName,
        description: plan.description,
        mostPopular: plan.mostPopular,
        price: plan.prices.month.amountCents,
        included: [
          ...planHighlights[plan.key],
          `Up to ${plan.limits.activeLocations} active ${plan.limits.activeLocations === 1 ? "location" : "locations"} and ${plan.limits.users} users`,
        ],
      })),
      addon: { key: "bookloq", name: ADDONS.bookloq.displayName, price: ADDONS.bookloq.prices.month.amountCents },
      purchaseInterval: "month",
      trialDays: SUBSCRIPTION_TRIAL_DAYS,
      currency: "CAD",
  };
}
