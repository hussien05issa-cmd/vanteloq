"use client";

import { createContext, useContext, type ReactNode } from "react";

export type BillingEntitlements = {
  accessType: "internal" | "complimentary" | "subscription";
  plan: "starter" | "growth" | "pro" | null;
  status: string | null;
  addons: readonly string[];
  features: readonly string[];
  limits: {
    activeLocations: number;
    users: number;
    ai: {
      capability: "basic" | "advanced" | "pro";
      requestsPerMonth: null;
      meteringStatus: "not_launched";
    };
  };
};

const BillingEntitlementsContext = createContext<BillingEntitlements | null>(null);

export function BillingEntitlementsProvider({
  value,
  children,
}: {
  value: BillingEntitlements;
  children: ReactNode;
}) {
  return <BillingEntitlementsContext.Provider value={value}>{children}</BillingEntitlementsContext.Provider>;
}

export function useBillingEntitlements(): BillingEntitlements {
  const value = useContext(BillingEntitlementsContext);
  if (!value) throw new Error("Billing entitlements are unavailable outside the subscription gate.");
  return value;
}
