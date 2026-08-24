"use client";

import { type FormEvent, useState } from "react";
import Link from "next/link";
import ProductBrandLogo from "./product-brand-logo";
import { apiFetch, getSupabase, signOut } from "./supabase-browser";
import { passwordExposureStatus } from "../shared/password-exposure";
import { passwordRules, strongPasswordError } from "../shared/password-security";
import {
  ACCOUNT_ACCEPTANCE_NOTICE_VERSION,
  PRIVACY_POLICY_VERSION,
  TERMS_OF_SERVICE_VERSION,
} from "../shared/legal-versions";

export type TeamInvitationDetails = {
  id: string;
  email: string;
  businessName: string;
  vanteloqRole: "admin" | "manager" | "read_only";
  consoleAccess: boolean;
  consoleRole: "admin" | "viewer";
  consoleScopes: string[];
  expiresAt: string;
};

export default function TeamInvitationFlow({
  invitation,
  initialName,
  complete,
}: {
  invitation: TeamInvitationDetails;
  initialName: string;
  complete: (businessName: string, displayName: string) => void;
}) {
  const [displayName, setDisplayName] = useState(initialName === "Account owner" ? "" : initialName);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const normalizedName = displayName.trim();
    if (!normalizedName || normalizedName.length > 120) return setMessage("Enter your full name.");
    if (password !== confirmation) return setMessage("The passwords do not match.");
    const passwordError = strongPasswordError(password);
    if (passwordError) return setMessage(passwordError);
    if (!legalAccepted) return setMessage("Review and accept the Terms of Service and Privacy Policy to continue.");
    setBusy(true);
    setMessage("");
    try {
      const exposure = await passwordExposureStatus(password);
      if (exposure !== "safe") throw new Error(exposure === "exposed"
        ? "This password appears in known breach data. Choose a unique password."
        : "The password safety check is temporarily unavailable. Please try again shortly.");
      const client = await getSupabase();
      if (!client) throw new Error("Account security is temporarily unavailable.");
      const updated = await client.auth.updateUser({ password, data: { full_name: normalizedName } });
      if (updated.error) throw new Error("Your account password could not be secured. Try again.");
      const response = await apiFetch("/api/v1/team-invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          displayName: normalizedName,
          legalAccepted: true,
          termsVersion: TERMS_OF_SERVICE_VERSION,
          privacyPolicyVersion: PRIVACY_POLICY_VERSION,
          legalNoticeVersion: ACCOUNT_ACCEPTANCE_NOTICE_VERSION,
        }),
      });
      const payload = await response.json().catch(() => ({})) as { organization?: { businessName?: string }; error?: { message?: string } };
      if (!response.ok || !payload.organization?.businessName) throw new Error(payload.error?.message || "The invitation could not be accepted.");
      setPassword("");
      setConfirmation("");
      complete(payload.organization.businessName, normalizedName);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The invitation could not be accepted.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="team-invitation-flow">
    <section>
      <header><ProductBrandLogo product="vanteloq" priority/><span><b>Internal team invitation</b><small>Owner approved access</small></span></header>
      <div className="team-invitation-copy"><p>WELCOME TO {invitation.businessName.toUpperCase()}</p><h1>Finish your secure team account.</h1><span>Your access is internal. You will not be asked for a card and this account will not be counted as a paid subscriber.</span></div>
      <div className="team-invitation-summary"><article><small>EMAIL</small><b>{invitation.email}</b><span>Verified invitation identity</span></article><article><small>VANTELOQ ROLE</small><b>{invitation.vanteloqRole.replaceAll("_", " ")}</b><span>Access to the existing workspace</span></article><article><small>PRIVATE CONSOLE</small><b>{invitation.consoleAccess ? invitation.consoleRole : "Not included"}</b><span>{invitation.consoleAccess ? invitation.consoleScopes.join(" + ") : "Vanteloq only"}</span></article></div>
      <form onSubmit={submit}>
        <label>Full name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={120} autoComplete="name" required/></label>
        <div><label>Create a password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required/></label><label>Confirm password<input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" required/></label></div>
        <div className="team-password-rules">{passwordRules(password).map((rule) => <span className={rule.met ? "met" : ""} key={rule.label}>{rule.label}</span>)}</div>
        <label className="team-invitation-legal"><input type="checkbox" checked={legalAccepted} onChange={(event) => setLegalAccepted(event.target.checked)}/><span>I agree to the <Link href="/terms" target="_blank">Terms of Service</Link> and acknowledge the <Link href="/privacy" target="_blank">Privacy Policy</Link>. This acceptance is recorded with the current document versions.</span></label>
        {message && <p role="alert">{message}</p>}
        <button disabled={busy}>{busy ? "Creating secure access…" : "Accept invitation and enter Vanteloq"}</button>
      </form>
      <footer><button type="button" onClick={() => void signOut()}>Sign out</button><span>Two factor authentication is required for every internal team member.</span></footer>
    </section>
  </main>;
}
