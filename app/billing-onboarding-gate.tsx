"use client";

import { type ReactNode, useEffect, useState } from "react";
import ProductBrandLogo from "./product-brand-logo";
import CustomPlanCallout from "./custom-plan-callout";
import { readPlanSelection, parsePlanSelection, savePlanSelection, clearPlanSelection } from "../shared/plan-selection";
import { currentSession, apiFetch, signOut } from "./supabase-browser";
import Link from "next/link";
import { TERMS_OF_SERVICE_VERSION, PRIVACY_POLICY_VERSION, ACCOUNT_ACCEPTANCE_NOTICE_VERSION } from "../shared/legal-versions";
import {
  billingGateState,
  type BillingAccessType,
} from "../shared/signup-funnel";
import {
  BillingEntitlementsProvider,
  type BillingEntitlements,
} from "./billing-entitlements-context";

type Plan = {
  key: "starter" | "growth" | "pro" | "bookloq";
  name: string;
  description: string;
  mostPopular: boolean;
  price: number;
  included: string[];
};

type BillingData = {
  needsWorkspace?: boolean;
  configured: boolean;
  canManageBilling?: boolean;
  legalAcceptanceCurrent?: boolean;
  trialEligible?: boolean;
  trialDays?: number;
  accessType: BillingAccessType;
  current: {
    plan: string | null;
    status: string | null;
    addons: string[];
    features: string[];
    limits: BillingEntitlements["limits"];
    hasCustomer?: boolean;
    trialEndsAt?: string | null;
    cancelAtPeriodEnd?: boolean;
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

async function loadAccess(beforeSetup = false): Promise<BillingData> {
  if (beforeSetup) {
    const response = await apiFetch("/api/v1/billing?onboarding=1", { headers: { Accept: "application/json" } });
    const payload = await response.json();
    if (!response.ok) throw new Error(problemMessage(payload, "Subscription options could not be loaded."));
    return payload;
  }
  const response = await apiFetch("/api/v1/entitlements", { headers: { Accept: "application/json" } });
  const payload = await response.json();
  if (!response.ok || !payload.accessType) throw new Error(problemMessage(payload, "Workspace access could not be loaded."));
  if (payload.accessType === "internal" || payload.accessType === "complimentary" || payload.accessType === "subscription") {
    return { ...payload, configured: true, plans: [], addon: { key: "bookloq", name: "BookLoQ", price: 0 }, currency: "CAD" };
  }
  if (!payload.canManageBilling) return { ...payload, configured: false, plans: [], addon: { key: "bookloq", name: "BookLoQ", price: 0 }, currency: "CAD" };
  const billing = await apiFetch("/api/v1/billing", { headers: { Accept: "application/json" } });
  const details = await billing.json();
  if (!billing.ok) throw new Error(problemMessage(details, "Billing settings could not be loaded."));
  return details;
}

export default function BillingOnboardingGate({ children, beforeSetup = false }: { children: ReactNode; beforeSetup?: boolean }) {
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [data, setData] = useState<BillingData | null>(null);
  const [plan, setPlan] = useState<Plan["key"] | "">("");
  const [includeBookloq, setIncludeBookloq] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    let retry: number | undefined;
    let inFlight = false;
    const billingReturn = new URLSearchParams(window.location.search).get("billing");

    let preferred = readPlanSelection();
    let selectionInitialized = false;
    const load = async (attempt = 0) => {
      if (inFlight) return;
      inFlight = true;
      try {
        const payload = await loadAccess(beforeSetup);
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
        setError("");
        setPlan(current => current || (preferred && payload.plans.some(item => item.key === preferred?.plan) ? preferred.plan : "") || payload.plans.find(item => item.mostPopular)?.key || payload.plans[0]?.key || "");
        const state = billingGateState(payload);
        if (state === "ready") {
          if (!beforeSetup) clearPlanSelection();
          else { const paidSelection = parsePlanSelection(payload.current.plan, payload.current.addons.includes("bookloq")); if (paidSelection) savePlanSelection(paidSelection); }
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
          setMessage("Checking Stripe for confirmed subscription access…");
          retry = window.setTimeout(() => void load(attempt + 1), 1_500);
        } else if (billingReturn === "success") {
          setMessage("Stripe is still confirming the subscription. Use Check subscription status in a moment.");
        } else if (billingReturn === "canceled") {
          setMessage("Checkout was canceled. Your workspace is saved, and no subscription was activated.");
        }
      } catch (caught) {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "Subscription status could not be loaded.");
      } finally {
        inFlight = false;
      }
    };

    const refreshVisible = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    const poll = window.setInterval(refreshVisible, 60_000);
    void load();
    return () => {
      active = false;
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
      window.clearInterval(poll);
      if (retry !== undefined) window.clearTimeout(retry);
    };
  }, [beforeSetup]);

  async function refresh() {
    setBusy(true);
    setError("");
    try {
      const payload = await loadAccess(beforeSetup);
      if (beforeSetup && billingGateState(payload) === "ready") {
        const paidSelection = parsePlanSelection(payload.current.plan, payload.current.addons.includes("bookloq"));
        if (paidSelection) savePlanSelection(paidSelection);
      }
      setData(payload);
      setMessage(billingGateState(payload) === "ready" ? "Subscription confirmed." : "Stripe has not confirmed an active subscription yet.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Subscription status could not be loaded.");
    } finally {
      setBusy(false);
    }
  }

  async function manageBilling() {
    setBusy(true);
    setError("");
    try {
      const response = await apiFetch("/api/v1/billing/portal", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const payload = await response.json();
      if (!response.ok) throw new Error(problemMessage(payload, "Billing could not be opened."));
      if (typeof payload.url !== "string" || !payload.url.startsWith("https://billing.stripe.com/")) throw new Error("Stripe did not return a secure billing page.");
      window.location.assign(payload.url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Billing could not be opened.");
      setBusy(false);
    }
  }

  async function checkout() {
    if (!plan || busy) return;
    if ((data?.needsWorkspace || data?.legalAcceptanceCurrent === false) && !legalAccepted) { setError("Review and accept the Terms of Service and Privacy Policy before checkout."); return; }
    const selectedBookloqAddon = plan === "bookloq" ? false : includeBookloq;
    savePlanSelection({ plan, bookloq: selectedBookloqAddon });
    setBusy(true);
    setError("");
    try {
      if (beforeSetup) {
        const prepared = await apiFetch("/api/v1/onboarding", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stage: "checkout", legalAccepted: true, termsVersion: TERMS_OF_SERVICE_VERSION,
            privacyPolicyVersion: PRIVACY_POLICY_VERSION, legalNoticeVersion: ACCOUNT_ACCEPTANCE_NOTICE_VERSION }),
        });
        const preparation = await prepared.json();
        if (!prepared.ok) throw new Error(problemMessage(preparation, "Your account could not be prepared for checkout."));
      }
      if (!data?.needsWorkspace && data?.legalAcceptanceCurrent === false) {
        const acceptance = await apiFetch("/api/v1/legal/acceptance", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accepted: true, termsVersion: TERMS_OF_SERVICE_VERSION,
            privacyPolicyVersion: PRIVACY_POLICY_VERSION, noticeVersion: ACCOUNT_ACCEPTANCE_NOTICE_VERSION }),
        });
        const confirmation = await acceptance.json();
        if (!acceptance.ok || confirmation.accepted !== true) throw new Error(problemMessage(confirmation, "Your acceptance could not be recorded. Review the current policies and try again."));
      }
      const response = await apiFetch("/api/v1/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ plan, interval: "month", includeBookloq: selectedBookloqAddon }),
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

  if (data && (data.accessType === "internal" || data.accessType === "complimentary" || data.accessType === "subscription")) {
    return <BillingEntitlementsProvider value={{
      accessType: data.accessType,
      plan: data.current.plan as BillingEntitlements["plan"],
      status: data.current.status,
      addons: data.current.addons,
      features: data.current.features,
      limits: data.current.limits,
    }}>{data.current.status === "trialing" && data.current.trialEndsAt && <div className="billing-onboarding-message" role="status">{data.current.cancelAtPeriodEnd ? "Trial access ends" : "First billing date"}: {new Date(data.current.trialEndsAt).toLocaleString("en-CA")}. {data.current.cancelAtPeriodEnd ? "Your subscription is scheduled to cancel." : "Your selected monthly subscription renews automatically after the trial."} {data.canManageBilling && <button type="button" disabled={busy} onClick={() => void manageBilling()}>Manage Billing</button>}</div>}{children}</BillingEntitlementsProvider>;
  }

  const state = data ? billingGateState(data) : null;
  const memberNeedsOwner = data?.canManageBilling === false;
  const restoreExisting = data?.current.hasCustomer === true && !["canceled", "incomplete_expired"].includes(data.current.status ?? "");
  const vanteloqPlans = data?.plans.filter((item) => item.key !== "bookloq") ?? [];
  const standaloneBookloq = data?.plans.find((item) => item.key === "bookloq");
  const choosePlan = (item: Plan) => {
    setPlan(item.key);
    if (item.key === "bookloq") setIncludeBookloq(false);
  };
  const planOption = (item: Plan) => <label className={`billing-plan-option ${plan === item.key ? "selected" : ""}`} key={item.key}>
    <input type="radio" name="billing-onboarding-plan" value={item.key} checked={plan === item.key} onChange={() => choosePlan(item)} />
    <span className="billing-plan-badge">{item.key === "bookloq" ? "STANDALONE PRODUCT" : item.mostPopular ? "MOST POPULAR" : "VANTELOQ PLAN"}</span>
    <b>{item.name}</b>
    <strong>{monthlyPrice(item.price, data?.currency ?? "CAD")}</strong>
    <small>per month</small>
    <p>{item.description}</p>
    <ul>{item.included.map(feature => <li key={feature}>{feature}</li>)}</ul>
  </label>;
  return <main className="billing-onboarding-gate">
    <section>
      <header><ProductBrandLogo product="vanteloq" priority/><span><b>{memberNeedsOwner || restoreExisting ? "Workspace access" : "Choose your subscription"}</b><small>SECURE STRIPE SUBSCRIPTION</small></span></header>
      <div className="billing-onboarding-copy">
        <p>{memberNeedsOwner || restoreExisting ? "BILLING REVIEW" : beforeSetup ? "1. SUBSCRIBE · 2. SET UP YOUR BUSINESS" : "ACTIVATE YOUR SUBSCRIPTION"}</p>
        <h1>{memberNeedsOwner ? "Workspace access needs attention." : restoreExisting ? "Restore your workspace access." : "Choose your product and plan."}</h1>
        <span>{memberNeedsOwner ? "Ask your workspace owner to review billing. You do not need a personal subscription." : restoreExisting ? "Review your existing subscription and payment method in Stripe. Your workspace records are saved." : beforeSetup ? "Choose a plan and confirm your subscription securely with Stripe. Then add your business details and connect your records." : "Choose Vanteloq, or open BookLoQ as its own finance workspace."}</span>
      </div>
      {message && <div className="billing-onboarding-message" aria-live="polite">{message}</div>}
      {error && <div className="billing-onboarding-message error" role="alert">{error}</div>}
      {!memberNeedsOwner && state === "configuration_required" && <div className="billing-onboarding-unavailable"><b>Checkout is temporarily unavailable.</b><span>Your workspace is saved. Contact support@vanteloq.com so billing can be enabled safely.</span></div>}
      {restoreExisting && !memberNeedsOwner && <button className="billing-onboarding-submit" type="button" disabled={busy || !data?.configured} onClick={() => void manageBilling()}>{busy ? "Opening billing…" : "Manage Billing in Stripe"}</button>}
      {data && state === "checkout_required" && !restoreExisting && !memberNeedsOwner && <>
        <fieldset className="billing-product-choice">
          <legend>Vanteloq operating plans</legend>
          <p>Choose Vanteloq for retail operations, sales and inventory intelligence.</p>
          <div className="billing-plans billing-vanteloq-plans">{vanteloqPlans.map(planOption)}</div>
        </fieldset>
        {standaloneBookloq && <fieldset className="billing-product-choice standalone-product">
          <legend>BookLoQ finance workspace</legend>
          <p>Choose BookLoQ on its own when you need financial review, evidence matching and cash planning without a Vanteloq plan.</p>
          <div className="billing-plans billing-standalone-plan">{planOption(standaloneBookloq)}</div>
        </fieldset>}
        {plan === "bookloq" ? <div className="billing-addon standalone"><span><b>BookLoQ is complete on its own</b><small>No Vanteloq plan or separate BookLoQ add-on is required.</small></span></div> : <label className="billing-addon"><input type="checkbox" checked={includeBookloq} onChange={event => setIncludeBookloq(event.target.checked)}/><span><b>Add {data.addon.name} for {monthlyPrice(data.addon.price, data.currency)} per month</b><small>Include BookLoQ in the same Vanteloq workspace and subscription.</small></span></label>}
        <div className="billing-selected-total" aria-live="polite"><span><b>{data.plans.find(item => item.key === plan)?.name}{plan !== "bookloq" && includeBookloq ? " + BookLoQ" : ""}</b><small>Monthly total before tax. Confirm the final amount in Stripe.</small></span><strong>{monthlyPrice((data.plans.find(item => item.key === plan)?.price ?? 0) + (plan !== "bookloq" && includeBookloq ? data.addon.price : 0), data.currency)}</strong></div>
        <div className="billing-onboarding-security"><b>{data.trialEligible ? "Your first subscription includes a 7-day free trial." : "A paid subscription is required to restore access."}</b><span>{data.trialEligible ? "A payment method is required. Pay $0 for the trial, then the selected monthly total plus applicable taxes renews automatically. Stripe shows the exact first billing date before you confirm. Cancel through Manage Billing before the trial ends to avoid the first charge. BookLoQ selected with your first subscription shares this trial; adding it later does not start another trial. " : "Returning subscriptions do not receive another trial. "}Stripe securely collects payment details. Vanteloq never receives card numbers. Access opens only after Stripe confirms your subscription.</span></div>
        {(data.needsWorkspace || data.legalAcceptanceCurrent === false) && <label className="onboarding-legal-consent"><input type="checkbox" checked={legalAccepted} disabled={busy} onChange={event => setLegalAccepted(event.target.checked)}/><span>I agree to the current <Link href="/terms" target="_blank">Terms of Service</Link> and acknowledge the <Link href="/privacy" target="_blank">Privacy Policy</Link>. Required before checkout.</span></label>}
        <button className="billing-onboarding-submit" type="button" disabled={busy || !plan || ((data.needsWorkspace || data.legalAcceptanceCurrent === false) && !legalAccepted)} onClick={() => void checkout()}>{busy ? "Opening secure checkout…" : "Continue to Stripe and subscribe"}</button>
      </>}
      {!memberNeedsOwner && <CustomPlanCallout/>}
      <footer><button type="button" disabled={busy} onClick={() => void refresh()}>Check subscription status</button><button type="button" onClick={() => void signOut()}>Sign out</button></footer>
    </section>
  </main>;
}
