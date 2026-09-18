"use client";
import { useState } from "react";
import ProductBrandLogo from "./product-brand-logo";
import { apiFetch, signOut } from "./supabase-browser";
import { ACCOUNT_ACCEPTANCE_NOTICE_VERSION, PRIVACY_POLICY_VERSION, TERMS_OF_SERVICE_VERSION } from "../shared/legal-versions";
export type ComplimentaryWorkspaceOffer = { id: string; plan: "starter" | "growth" | "pro"; bookloq: boolean; expiresAt: string | null };
export default function ComplimentaryWorkspaceFlow({ offer, complete }: { offer: ComplimentaryWorkspaceOffer; complete: (business: string, owner: string) => void }) {
  const [accepted, setAccepted] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function activate() {
    if (!accepted || busy) return;
    setBusy(true); setError("");
    try {
      const response = await apiFetch("/api/v1/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        complimentaryId: offer.id, legalAccepted: accepted, termsVersion: TERMS_OF_SERVICE_VERSION,
        privacyPolicyVersion: PRIVACY_POLICY_VERSION, legalNoticeVersion: ACCOUNT_ACCEPTANCE_NOTICE_VERSION,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }) });
      const payload = await response.json();
      if (!response.ok) {
        if (payload.error?.code === "WORKSPACE_EXISTS") { window.location.reload(); return; }
        throw new Error(payload.error?.message ?? "Your workspace could not be opened. Try again.");
      }
      complete(payload.organization.businessName, payload.organization.ownerName);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Please try again."); }
    finally { setBusy(false); }
  }
  return <main className="billing-onboarding-gate complimentary-workspace"><section>
    <header><ProductBrandLogo product="vanteloq" variant="icon" priority/><span><b>Your invitation</b><small>COMPLIMENTARY ACCESS</small></span></header>
    <div className="billing-onboarding-copy"><h1>Your workspace is ready to open.</h1>
      <p>Your complimentary access includes Vanteloq {offer.plan === "pro" ? "Pro" : offer.plan === "growth" ? "Growth" : "Starter"}{offer.bookloq ? " and BookLoQ" : ""}. No payment details are required.</p>
      <p>{offer.expiresAt ? `Access is included until ${new Date(offer.expiresAt).toLocaleDateString("en-CA")}.` : "Your access has no scheduled expiry."} You can add business details and connect your data later in Settings.</p>
      <p>Your workspace starts empty and separate from other businesses. Currency defaults to CAD; review your business and tax settings before using accounting features.</p>
    </div>
    <label className="onboarding-legal-consent"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)}/>
      <span>I agree to the <a href="/terms" target="_blank" rel="noreferrer">Terms of Service</a> and <a href="/data-processing" target="_blank" rel="noreferrer">Data Processing Addendum</a>, and acknowledge the <a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>. *</span>
    </label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="complimentary-actions"><button className="primary" disabled={!accepted || busy} onClick={() => void activate()}>{busy ? "Opening your workspace…" : "Open my workspace"}</button>
    <button disabled={busy} onClick={() => void signOut()}>Sign out</button></div>
  </section></main>;
}
