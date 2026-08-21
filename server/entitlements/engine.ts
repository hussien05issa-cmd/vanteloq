import { and, count, eq, inArray } from "drizzle-orm";
import { getDb } from "../../db/index.ts";
import { organizationLocations, teamMembers, tenantAddons, tenantSubscriptions } from "../../db/schema.ts";
import { ApiError } from "../api.ts";
import type { AccessContext } from "../authorization.ts";
import { getInternalAccessGrant, type InternalAccessGrant, type InternalAccessLevel } from "../internal-access.ts";
import {
  ADDONS,
  ALL_NORMAL_PAID_FEATURES,
  PLANS,
  type AddonKey,
  type FeatureKey,
  type PlanKey,
  type PlanLimits,
} from "./catalog.ts";

export const SUBSCRIPTION_STATUSES = [
  "incomplete",
  "incomplete_expired",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "paused",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export type SubscriptionSnapshot = {
  readonly basePlan: PlanKey | null;
  readonly status: SubscriptionStatus | null;
  readonly addons: readonly AddonKey[];
  readonly trialEndsAt: Date | null;
  readonly currentPeriodEndsAt: Date | null;
  readonly cancelAtPeriodEnd: boolean;
  readonly scheduledBasePlan: PlanKey | null;
  readonly scheduledEffectiveAt: Date | null;
  readonly version: number;
};

export type EffectiveEntitlements = {
  readonly accessType: "internal" | "subscription" | "none";
  readonly internalAccessLevel: InternalAccessLevel | null;
  readonly plan: PlanKey | null;
  readonly subscriptionStatus: SubscriptionStatus | null;
  readonly addons: readonly AddonKey[];
  readonly features: readonly FeatureKey[];
  readonly limits: PlanLimits | null;
  readonly trialEndsAt: Date | null;
  readonly currentPeriodEndsAt: Date | null;
  readonly cancelAtPeriodEnd: boolean;
  readonly scheduledBasePlan: PlanKey | null;
  readonly scheduledEffectiveAt: Date | null;
  readonly version: number;
};

export type CapacityDecision = {
  readonly allowed: boolean;
  readonly current: number;
  readonly limit: number;
  readonly remaining: number;
  readonly reason: "capacity_available" | "limit_reached" | "subscription_required";
};

const accessBearingStatuses = new Set<SubscriptionStatus>(["trialing", "active"]);
const activeAddonStatuses = new Set(["trialing", "active", "scheduled_for_removal"]);

function uniqueFeatures(groups: readonly (readonly FeatureKey[])[]): readonly FeatureKey[] {
  return Object.freeze([...new Set(groups.flat())]);
}

export function subscriptionGrantsAccess(status: SubscriptionStatus | null): boolean {
  return status !== null && accessBearingStatuses.has(status);
}

export function requireTenantServiceAccess(entitlements: EffectiveEntitlements): void {
  if (entitlements.accessType === "none") {
    throw new ApiError(
      402,
      "SUBSCRIPTION_REQUIRED",
      "Choose a Vanteloq plan or restore billing to continue.",
    );
  }
}

export function resolveSubscriptionEntitlements(snapshot: SubscriptionSnapshot): EffectiveEntitlements {
  if (!snapshot.basePlan || !subscriptionGrantsAccess(snapshot.status)) {
    return Object.freeze({
      accessType: "none",
      internalAccessLevel: null,
      plan: null,
      subscriptionStatus: snapshot.status,
      addons: Object.freeze([]),
      features: Object.freeze([]),
      limits: null,
      trialEndsAt: snapshot.trialEndsAt,
      currentPeriodEndsAt: snapshot.currentPeriodEndsAt,
      cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
      scheduledBasePlan: snapshot.scheduledBasePlan,
      scheduledEffectiveAt: snapshot.scheduledEffectiveAt,
      version: snapshot.version,
    });
  }

  const addons = Object.freeze([...new Set(snapshot.addons)]);
  const addonFeatures = addons.map((addon) => ADDONS[addon].features);
  return Object.freeze({
    accessType: "subscription",
    internalAccessLevel: null,
    plan: snapshot.basePlan,
    subscriptionStatus: snapshot.status,
    addons,
    features: uniqueFeatures([PLANS[snapshot.basePlan].features, ...addonFeatures]),
    limits: PLANS[snapshot.basePlan].limits,
    trialEndsAt: snapshot.trialEndsAt,
    currentPeriodEndsAt: snapshot.currentPeriodEndsAt,
    cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
    // A scheduled plan never changes current access before its effective Stripe event.
    scheduledBasePlan: snapshot.scheduledBasePlan,
    scheduledEffectiveAt: snapshot.scheduledEffectiveAt,
    version: snapshot.version,
  });
}

export function resolveInternalEntitlements(grant: InternalAccessGrant): EffectiveEntitlements {
  return Object.freeze({
    accessType: "internal",
    internalAccessLevel: grant.accessLevel,
    plan: null,
    subscriptionStatus: null,
    addons: Object.freeze(["bookloq"] as const),
    features: ALL_NORMAL_PAID_FEATURES,
    limits: PLANS.pro.limits,
    trialEndsAt: null,
    currentPeriodEndsAt: null,
    cancelAtPeriodEnd: false,
    scheduledBasePlan: null,
    scheduledEffectiveAt: null,
    version: 1,
  });
}

export function requireInternalAccessMfa(
  grant: InternalAccessGrant,
  assuranceLevel: AccessContext["identity"]["assuranceLevel"],
): void {
  if (grant.mfaRequired && assuranceLevel !== "aal2") {
    throw new ApiError(403, "MFA_REQUIRED_FOR_INTERNAL_ACCESS", "Multi-factor authentication is required for internal full-platform access.");
  }
}

async function subscriptionSnapshot(organizationId: string): Promise<SubscriptionSnapshot> {
  const [subscription, addonRows] = await Promise.all([
    getDb().select().from(tenantSubscriptions).where(eq(tenantSubscriptions.organizationId, organizationId)).limit(1),
    getDb().select({ addonKey: tenantAddons.addonKey, status: tenantAddons.status })
      .from(tenantAddons)
      .where(eq(tenantAddons.organizationId, organizationId)),
  ]);
  const row = subscription[0];
  return {
    basePlan: row?.basePlan ?? null,
    status: row?.status ?? null,
    addons: addonRows.filter((addon) => activeAddonStatuses.has(addon.status)).map((addon) => addon.addonKey),
    trialEndsAt: row?.trialEndsAt ?? null,
    currentPeriodEndsAt: row?.currentPeriodEndsAt ?? null,
    cancelAtPeriodEnd: row?.cancelAtPeriodEnd ?? false,
    scheduledBasePlan: row?.scheduledBasePlan ?? null,
    scheduledEffectiveAt: row?.scheduledEffectiveAt ?? null,
    version: row?.version ?? 0,
  };
}

export async function getTenantEntitlements(context: AccessContext): Promise<EffectiveEntitlements> {
  const internalGrant = await getInternalAccessGrant(context);
  if (internalGrant) {
    requireInternalAccessMfa(internalGrant, context.identity.assuranceLevel);
    return resolveInternalEntitlements(internalGrant);
  }
  return resolveSubscriptionEntitlements(await subscriptionSnapshot(context.organizationId));
}

export async function getTenantPlan(context: AccessContext): Promise<PlanKey | null> {
  return (await getTenantEntitlements(context)).plan;
}

export async function getTenantLimits(context: AccessContext): Promise<PlanLimits | null> {
  return (await getTenantEntitlements(context)).limits;
}

export async function hasFeature(context: AccessContext, feature: FeatureKey): Promise<boolean> {
  return (await getTenantEntitlements(context)).features.includes(feature);
}

export async function hasAddon(context: AccessContext, addon: AddonKey): Promise<boolean> {
  return (await getTenantEntitlements(context)).addons.includes(addon);
}

export function requireAddonEntitlement(entitlements: EffectiveEntitlements, addon: AddonKey): void {
  if (!entitlements.addons.includes(addon)) {
    throw new ApiError(403, "ADDON_NOT_INCLUDED", "This add-on is not included in the workspace's current access.");
  }
}

export async function requireAddon(context: AccessContext, addon: AddonKey): Promise<void> {
  requireAddonEntitlement(await getTenantEntitlements(context), addon);
}

export async function requireFeature(context: AccessContext, feature: FeatureKey): Promise<void> {
  if (!(await hasFeature(context, feature))) {
    throw new ApiError(403, "FEATURE_NOT_INCLUDED", "This feature is not included in the workspace's current access.");
  }
}

function capacity(current: number, limit: number | null): CapacityDecision {
  if (limit === null) {
    return { allowed: false, current, limit: 0, remaining: 0, reason: "subscription_required" };
  }
  const remaining = Math.max(0, limit - current);
  return {
    allowed: current < limit,
    current,
    limit,
    remaining,
    reason: current < limit ? "capacity_available" : "limit_reached",
  };
}

export async function canAddUser(context: AccessContext): Promise<CapacityDecision> {
  const entitlements = await getTenantEntitlements(context);
  const [row] = await getDb().select({ value: count() }).from(teamMembers).where(and(
    eq(teamMembers.organizationId, context.organizationId),
    eq(teamMembers.remoteLogin, true),
    inArray(teamMembers.status, ["draft", "invited", "pending_verification", "active"]),
  ));
  return capacity(row?.value ?? 0, entitlements.limits?.users ?? null);
}

export async function canAddLocation(context: AccessContext): Promise<CapacityDecision> {
  const entitlements = await getTenantEntitlements(context);
  const [row] = await getDb().select({ value: count() }).from(organizationLocations).where(and(
    eq(organizationLocations.organizationId, context.organizationId),
    eq(organizationLocations.status, "active"),
  ));
  return capacity(row?.value ?? 0, entitlements.limits?.activeLocations ?? null);
}
