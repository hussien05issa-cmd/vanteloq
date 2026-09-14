"use client";

import { type ReactNode, useEffect, useState } from "react";
import ProductBrandLogo from "./product-brand-logo";
import CustomPlanCallout from "./custom-plan-callout";
import { readPlanSelection, parsePlanSelection, savePlanSelection, clearPlanSelection } from "../shared/plan-selection";
import { currentSession, apiFetch, signOut } from "./supabase-browser";
import {
  billingGateState,
  type BillingAccessType,
} from "../shared/signup-funnel";
import {
  BillingEntitlementsProvider,
  type BillingEntitlements,
} from "./billing-entitlements-context";

type Plan = {
  key: "starter" | "growth" | "pro";
  name: string;
  description: string;
  mostPopular: boolean;
  price: number;
  included: string[];
};

type BillingData = {
  configured: boolean;
  accessType: BillingAccessType;
  current: {
    plan: string | null;
    status: string | null;
    addons: string[];
    features: string[];
    limits: BillingEntitlements["limits"];
  };
  plans: Plan[];
  addon: {
    key: "bookloq";
    name: string;
    price: number;
  };
  currency: string;
};

function problemMessage(data: unknown, fallback: string) {
  if (!data || typeof data !== "object") return fallback;
  const error = (data as { error?: unknown }).error;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return fallback;
}

function monthlyPrice(cents: number, currency: string) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

async function loadAccess(): Promise<BillingData> {
  const response = await apiFetch("/api/v1/entitlements", { headers: { Accept: "application/json" } });
  const payload = await response.json();
  if (!response.ok || !payload.accessType) throw new Error(problemMessage(payload, "Workspace access could not be loaded."));
  if (payload.accessType === "internal" || payload.accessType === "subscription") {
    return { ...payload, configured: true, plans: [], addon: { key: "bookloq", name: "BookLoQ", price: 0 }, currency: "CAD" };
  }
  if (!payload.canManageBilling) throw new Error("Your company workspace is not currently active. Ask the owner to check access; you do not need to buy a personal subscription.");
  const billing = await apiFetch("/api/v1/billing", { headers: { Accept: "application/json" } });
  const details = await billing.json();
  if (!billing.ok) throw new Error(problemMessage(details, "Billing settings could not be loaded."));
  return details;
}

export default function BillingOnboardingGate({ children }: { children: ReactNode }) {
  const [data, setData] = useState<BillingData | null>(null);
  const [plan, setPlan] = useState<Plan["key"] | "">("");
  const [includeBookloq, setIncludeBookloq] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    let retry: number | undefined;
    const billingReturn = new URLSearchParams(window.location.search).get("billing");

    let preferred = readPlanSelection();
    let selectionInitialized = false;
    const load = async (attempt = 0) => {
      try {
        const payload = await loadAccess();
        if (!preferred && payload.plans.length && !selectionInitialized) {
          const session = await currentSession();
          preferred = parsePlanSelection(session?.user.user_metadata?.signup_plan, session?.user.user_metadata?.signup_bookloq);
        }
        if (!active) return;
        if (!selectionInitialized && preferred && payload.plans.some(item => item.key === preferred?.plan)) {
          setIncludeBookloq(preferred.bookloq);
        }
        selectionInitialized = true;
        setData(payload);
        setPlan(current => current || (preferred && payload.plans.some(item => item.key === preferred?.plan) ? preferred.plan : "") || payload.plans.find(item => item.mostPopular)?.key || payload.plans[0]?.key || "");
        const state = billingGateState(payload);
        if (state === "ready") {
          clearPlanSelection();
          const clean = new URL(window.location.href);
          clean.searchParams.delete("billing");
          clean.searchParams.delete("plan");
          clean.searchParams.delete("bookloq");
          clean.searchParams.delete("start");
          clean.searchParams.delete("session_id");
          window.history.replaceState({}, "", `${clean.pathname}${clean.search}${clean.hash}`);
          return;
        }
        if (billingReturn === "success" && attempt < 20) {
          setMessage("Payment was received. We are confirming your subscription before opening the workspace.");
          retry = window.setTimeout(() => void load(attempt + 1), 1_500);
        } else if (billingReturn === "success") {
          setMessage("Stripe is still confirming the subscription. Use Check payment status in a moment.");
        } else if (billingReturn === "canceled") {
          setMessage("Checkout was canceled. Your workspace is saved, and no subscription was activated.");
        }
      } catch (caught) {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "Subscription status could not be loaded.");
      }
    };

    void load();
    return () => {
      active = false;
      if (retry !== undefined) window.clearTimeout(retry);
    };
  }, []);

  async function refresh() {
    setBusy(true);
    setError("");
    try {
      const payload = await loadAccess();
      setData(payload);
      setMessage(billingGateState(payload) === "ready" ? "Subscription confirmed." : "Stripe has not confirmed an active subscription yet.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Subscription status could not be loaded.");
    } finally {
      setBusy(false);
    }
  }

  async function checkout() {
    if (!plan || busy) return;
    savePlanSelection({ plan, bookloq: includeBookloq });
    setBusy(true);
    setError("");
    try {
      const response = await apiFetch("/api/v1/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ plan, interval: "month", includeBookloq }),
      });
      const payload = await response.json() as { url?: unknown; error?: unknown };
      if (!response.ok) throw new Error(problemMessage(payload, "Secure checkout could not be opened."));
      if (typeof payload.url !== "string" || !payload.url.startsWith("https://checkout.stripe.com/")) {
        throw new Error("Stripe did not return a secure checkout page.");
      }
      window.location.assign(payload.url);
    } catch (caught) {
      setBusy(false);
      setError(caught instanceof Error ? caught.message : "Secure checkout could not be opened.");
    }
  }

  if (!data && !error) {
    return <div className="entry-loading" role="status" aria-live="polite"><ProductBrandLogo product="vanteloq" priority/><p>Checking subscription access…</p></div>;
  }

  if (data && (data.accessType === "internal" || data.accessType === "subscription")) {
    return <BillingEntitlementsProvider value={{
      accessType: data.accessType,
      plan: data.current.plan as BillingEntitlements["plan"],
      status: data.current.status,
      addons: data.current.addons,
      features: data.current.features,
      limits: data.current.limits,
    }}>{children}</BillingEntitlementsProvider>;
  }

  const state = data ? billingGateState(data) : null;
  return <main className="billing-onboarding-gate">
    <section>
      <header><ProductBrandLogo product="vanteloq" priority/><span><b>Final setup step</b><small>SECURE STRIPE SUBSCRIPTION</small></span></header>
      <div className="billing-onboarding-copy">
        <p>STEP 3 OF 3</p>
        <h1>Choose your Vanteloq plan.</h1>
        <span>Your account, email, 2FA, and business profile are complete. A verified subscription is required before the workspace opens.</span>
      </div>
      {message && <div className="billing-onboarding-message" aria-live="polite">{message}</div>}
      {error && <div className="billing-onboarding-message error" role="alert">{error}</div>}
      {state === "configuration_required" && <div className="billing-onboarding-unavailable"><b>Checkout is temporarily unavailable.</b><span>Your workspace is saved. Contact support@vanteloq.com so billing can be enabled safely.</span></div>}
      {data && state === "checkout_required" && <>
        <div className="billing-plans" role="radiogroup" aria-label="Monthly Vanteloq plans">
          {data.plans.map(item => <button type="button" role="radio" aria-checked={plan === item.key} className={plan === item.key ? "selected" : ""} onClick={() => setPlan(item.key)} key={item.key}>
            <span>{item.mostPopular ? "MOST POPULAR" : "MONTH TO MONTH"}</span>
            <b>{item.name}</b>
            <strong>{monthlyPrice(item.price, data.currency)}</strong>
            <small>per month</small>
            <p>{item.description}</p>
            <ul>{item.included.map(feature => <li key={feature}>{feature}</li>)}</ul>
          </button>)}
        </div>
        <label className="billing-addon"><input type="checkbox" checked={includeBookloq} onChange={event => setIncludeBookloq(event.target.checked)}/><span><b>Add {data.addon.name} for {monthlyPrice(data.addon.price, data.currency)} per month</b><small>Include bookkeeping and cash control features in the same subscription.</small></span></label>
        <div className="billing-selected-total" aria-live="polite"><span><b>{data.plans.find(item => item.key === plan)?.name}{includeBookloq ? " + BookLoQ" : ""}</b><small>Monthly total before tax. Confirm the final amount in Stripe.</small></span><strong>{monthlyPrice((data.plans.find(item => item.key === plan)?.price ?? 0) + (includeBookloq ? data.addon.price : 0), data.currency)}</strong></div>
        <div className="billing-onboarding-security"><b>Card information is required.</b><span>Stripe securely collects and stores payment details. Vanteloq never receives card numbers. The subscription is charged according to the amount shown in Checkout.</span></div>
        <button className="billing-onboarding-submit" type="button" disabled={busy || !plan} onClick={() => void checkout()}>{busy ? "Opening secure checkout…" : "Continue to Stripe and subscribe"}</button>
      </>}
      <CustomPlanCallout/>
      <footer><button type="button" disabled={busy} onClick={() => void refresh()}>Check payment status</button><button type="button" onClick={() => void signOut()}>Sign out</button></footer>
    </section>
  </main>;
}
