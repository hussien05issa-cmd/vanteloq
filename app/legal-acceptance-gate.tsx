"use client";

import { type ReactNode, useEffect, useState } from "react";
import ProductBrandLogo from "./product-brand-logo";
import { apiFetch, signOut } from "./supabase-browser";
import {
  ACCOUNT_ACCEPTANCE_NOTICE_VERSION,
  PRIVACY_POLICY_VERSION,
  TERMS_OF_SERVICE_VERSION,
} from "../shared/legal-versions";

function problem(data: unknown, fallback: string) {
  if (data && typeof data === "object" && "error" in data) {
    const message = (data as { error?: { message?: unknown } }).error?.message;
    if (typeof message === "string") return message;
  }
  return fallback;
}

export default function LegalAcceptanceGate({ children }: { children: ReactNode }) {
  const [accepted, setAccepted] = useState<boolean | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void apiFetch("/api/v1/legal/acceptance", { headers: { Accept: "application/json" } })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(problem(body, "Current legal terms could not be checked."));
        if (active) setAccepted(body.accepted === true);
      })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Current legal terms could not be checked."); });
    return () => { active = false; };
  }, []);
  async function accept() {
    if (!checked || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await apiFetch("/api/v1/legal/acceptance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accepted: true,
          termsVersion: TERMS_OF_SERVICE_VERSION,
          privacyPolicyVersion: PRIVACY_POLICY_VERSION,
          noticeVersion: ACCOUNT_ACCEPTANCE_NOTICE_VERSION,
        }),
      });
      const body = await response.json();
      if (!response.ok || body.accepted !== true) throw new Error(problem(body, "Your acceptance could not be recorded."));
      setAccepted(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Your acceptance could not be recorded.");
    } finally {
      setBusy(false);
    }
  }
  if (accepted === true) return children;
  if (accepted === null && !error) return <div className="entry-loading" role="status"><ProductBrandLogo product="vanteloq" priority/><p>Checking current service terms…</p></div>;
  return <main className="legal-acceptance-gate"><section>
    <header><ProductBrandLogo product="vanteloq" priority/><span><b>Policy update</b><small>REVIEW REQUIRED</small></span></header>
    <p>CURRENT SERVICE TERMS</p>
    <h1>Review the updated Vanteloq terms.</h1>
    <span>The update explains self service account deletion, billing cancellation during workspace deletion, connected service processing, retention exceptions, and customer responsibilities.</span>
    <div className="legal-acceptance-links"><a href="/terms" target="_blank" rel="noreferrer">Read Terms of Service</a><a href="/privacy" target="_blank" rel="noreferrer">Read Privacy Policy</a><a href="/data-processing" target="_blank" rel="noreferrer">Read Data Processing Addendum</a><a href="/subprocessors" target="_blank" rel="noreferrer">View subprocessors</a></div>
    <label><input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)}/><span>I agree to the current Terms of Service and acknowledge the Privacy Policy and Data Processing Addendum.</span></label>
    {error && <div className="billing-onboarding-message error" role="alert">{error}</div>}
    <button type="button" disabled={!checked || busy} onClick={() => void accept()}>{busy ? "Recording acceptance…" : "Accept and continue"}</button>
    <footer><button type="button" onClick={() => void signOut()}>Sign out</button></footer>
  </section></main>;
}
