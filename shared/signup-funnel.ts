export type BillingAccessType = "internal" | "subscription" | "none";

export type BillingGateSnapshot = {
  configured: boolean;
  accessType: BillingAccessType;
};

export function billingGateState(
  snapshot: BillingGateSnapshot,
): "ready" | "checkout_required" | "configuration_required" {
  if (snapshot.accessType === "internal" || snapshot.accessType === "subscription") {
    return "ready";
  }
  return snapshot.configured ? "checkout_required" : "configuration_required";
}
