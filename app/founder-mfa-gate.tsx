"use client";

import { type ReactNode, useEffect, useState } from "react";
import { getSupabase, signOut } from "./supabase-browser";
import ProductBrandLogo from "./product-brand-logo";

const FOUNDER_EMAIL = "hussienissa@lexedgeconsulting.com";
const VERIFICATION_WINDOW_MS = 30 * 60 * 1000;

type GateState = "checking" | "request_required" | "code_required" | "ready" | "error";

function verificationKey(userId: string) {
  return `vanteloq:founder-email-verification:${userId}`;
}

export default function FounderMfaGate({ email, children }: { email: string; children: ReactNode }) {
  const isFounder = email.toLowerCase() === FOUNDER_EMAIL;
  const [state, setState] = useState<GateState>(isFounder ? "checking" : "ready");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isFounder) return;
    let active = true;
    void getSupabase().then(async (client) => {
      if (!active) return;
      if (!client) {
        setMessage("Secure account verification is temporarily unavailable.");
        setState("error");
        return;
      }
      const { data, error } = await client.auth.getUser();
      if (!active) return;
      if (error || !data.user) {
        setMessage("Vanteloq could not confirm the signed-in account.");
        setState("error");
        return;
      }
      const verifiedAt = Number(window.sessionStorage.getItem(verificationKey(data.user.id)) ?? "0");
      setState(Date.now() - verifiedAt < VERIFICATION_WINDOW_MS ? "ready" : "request_required");
    });
    return () => { active = false; };
  }, [isFounder]);

  async function sendCode() {
    const client = await getSupabase();
    if (!client || busy) return;
    setBusy(true);
    setMessage("");
    const { error } = await client.auth.reauthenticate();
    setBusy(false);
    if (error) {
      setMessage(error.message || "The verification email could not be sent.");
      setState("error");
      return;
    }
    setState("code_required");
    setMessage("A six-digit security code was sent to your verified email address.");
  }

  async function verifyCode() {
    const client = await getSupabase();
    if (!client || busy) return;
    if (!/^\d{6}$/.test(code)) {
      setMessage("Enter the six-digit code from the Vanteloq email.");
      return;
    }
    setBusy(true);
    setMessage("");
    const verified = await client.auth.verifyOtp({ email, token: code, type: "reauthentication" });
    if (verified.error) {
      setBusy(false);
      setCode("");
      setMessage("That code was not accepted. Request a fresh code and try again.");
      return;
    }
    const { data } = await client.auth.getUser();
    if (data.user) window.sessionStorage.setItem(verificationKey(data.user.id), String(Date.now()));
    setBusy(false);
    setCode("");
    setState("ready");
  }

  if (state === "ready") return children;

  return <main className="founder-mfa-gate">
    <section>
      <header><ProductBrandLogo product="vanteloq" priority/><span><b>Secure founder access</b><small>Internal Vanteloq account</small></span></header>
      {state === "checking" && <div className="founder-mfa-copy"><h1>Checking this session…</h1><p>Vanteloq is confirming whether this browser was recently verified.</p></div>}
      {state === "request_required" && <div className="founder-mfa-copy"><h1>Confirm this sign-in by email.</h1><p>We’ll send a six-digit code to the verified email address on your founder account. The address stays hidden on this screen.</p><button onClick={() => void sendCode()} disabled={busy}>{busy ? "Sending…" : "Send verification email"}</button></div>}
      {state === "code_required" && <div className="founder-mfa-copy"><h1>Enter the code from your email.</h1><p>The code is short-lived and works once. Vanteloq support will never ask you to share it.</p><EmailCode code={code} setCode={setCode} verify={verifyCode} resend={sendCode} busy={busy}/></div>}
      {state === "error" && <div className="founder-mfa-copy"><h1>Email verification did not finish.</h1><p>{message || "Try again or sign out safely."}</p><button onClick={() => { setMessage(""); setState("request_required"); }}>Try again</button></div>}
      {message && state !== "error" && <p className="founder-mfa-message" role="status">{message}</p>}
      <footer><span>Verified email · 30-minute browser window · Not billed</span><button onClick={() => void signOut()}>Sign out</button></footer>
    </section>
  </main>;
}

function EmailCode({ code, setCode, verify, resend, busy }: { code: string; setCode: (value: string) => void; verify: () => Promise<void>; resend: () => Promise<void>; busy: boolean }) {
  return <form className="founder-mfa-form" onSubmit={(event) => { event.preventDefault(); void verify(); }}>
    <label>Six-digit email code<input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" aria-label="Email verification code"/></label>
    <button disabled={busy || code.length !== 6} title={code.length !== 6 ? "Enter the six-digit email code." : "Verify this email code."}>{busy ? "Verifying…" : "Verify and continue"}</button>
    <button className="founder-mfa-resend" type="button" onClick={() => void resend()} disabled={busy}>Send a new code</button>
  </form>;
}
