export type BillingAccessType = "internal" | "complimentary" | "subscription" | "none";

export type BillingGateSnapshot = {
  configured: boolean;
  accessType: BillingAccessType;
};

export function billingGateState(
  snapshot: BillingGateSnapshot,
): "ready" | "checkout_required" | "configuration_required" {
  if (snapshot.accessType === "internal" || snapshot.accessType === "complimentary" || snapshot.accessType === "subscription") {
    return "ready";
  }
  return snapshot.configured ? "checkout_required" : "configuration_required";
}
