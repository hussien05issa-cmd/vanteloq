"use client";

import { type ReactNode, useEffect, useState } from "react";
import { getSupabase, signOut } from "./supabase-browser";
import ProductBrandLogo from "./product-brand-logo";

const FOUNDER_EMAIL = "hussienissa@lexedgeconsulting.com";

type GateState = "checking" | "enrollment_required" | "enrolling" | "challenge_required" | "ready" | "error";
type MfaInspection = { state: "enrollment_required" | "challenge_required" | "ready" | "error"; factorId?: string; message?: string };

async function inspectFounderMfa(): Promise<MfaInspection> {
  const client = await getSupabase();
  if (!client) return { state: "error", message: "Secure account verification is temporarily unavailable." };
  const [assurance, factors] = await Promise.all([
    client.auth.mfa.getAuthenticatorAssuranceLevel(),
    client.auth.mfa.listFactors(),
  ]);
  if (assurance.error || factors.error) {
    return { state: "error", message: "Vanteloq could not verify the founder account's security level." };
  }
  if (assurance.data.currentLevel === "aal2") return { state: "ready" };
  const verified = factors.data.totp.find((factor) => factor.status === "verified");
  return verified ? { state: "challenge_required", factorId: verified.id } : { state: "enrollment_required" };
}

export default function FounderMfaGate({ email, children }: { email: string; children: ReactNode }) {
  const [state, setState] = useState<GateState>(email.toLowerCase() === FOUNDER_EMAIL ? "checking" : "ready");
  const [factorId, setFactorId] = useState("");
  const [qrCode, setQrCode] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (email.toLowerCase() !== FOUNDER_EMAIL) return;
    let active = true;
    void inspectFounderMfa().then((result) => {
      if (!active) return;
      if (result.factorId) setFactorId(result.factorId);
      if (result.message) setMessage(result.message);
      setState(result.state);
    });
    return () => { active = false; };
  }, [email]);

  async function retryInspection() {
    setMessage("");
    setState("checking");
    const result = await inspectFounderMfa();
    if (result.factorId) setFactorId(result.factorId);
    if (result.message) setMessage(result.message);
    setState(result.state);
  }

  async function beginEnrollment() {
    const client = await getSupabase();
    if (!client || busy) return;
    setBusy(true);
    setMessage("");
    const result = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: "Vanteloq founder" });
    setBusy(false);
    if (result.error) {
      setMessage(result.error.message || "The authenticator could not be prepared.");
      setState("error");
      return;
    }
    setFactorId(result.data.id);
    setQrCode(result.data.totp.qr_code);
    setSecret(result.data.totp.secret);
    setState("enrolling");
  }

  async function verify() {
    const client = await getSupabase();
    if (!client || !factorId || busy) return;
    if (!/^\d{6}$/.test(code)) {
      setMessage("Enter the six-digit code from your authenticator app.");
      return;
    }
    setBusy(true);
    setMessage("");
    const challenge = await client.auth.mfa.challenge({ factorId });
    if (challenge.error) {
      setBusy(false);
      setMessage(challenge.error.message || "A verification challenge could not be created.");
      return;
    }
    const verified = await client.auth.mfa.verify({ factorId, challengeId: challenge.data.id, code });
    setBusy(false);
    if (verified.error) {
      setMessage("That code was not accepted. Wait for a new code and try again.");
      setCode("");
      return;
    }
    setCode("");
    setState("ready");
  }

  if (state === "ready") return children;

  return <main className="founder-mfa-gate">
    <section>
      <header><ProductBrandLogo product="vanteloq" priority/><span><b>Secure founder access</b><small>Internal Vanteloq account</small></span></header>
      {state === "checking" && <div className="founder-mfa-copy"><h1>Checking account security…</h1><p>Vanteloq is confirming the authentication level for full-platform access.</p></div>}
      {state === "enrollment_required" && <div className="founder-mfa-copy"><h1>Add an authenticator before continuing.</h1><p>The founder account is never billed, but it has access to every normal paid feature. A second factor protects that access if the password is compromised.</p><button onClick={() => void beginEnrollment()} disabled={busy}>{busy ? "Preparing…" : "Set up authenticator"}</button></div>}
      {state === "enrolling" && <div className="founder-mfa-enroll"><div><h1>Scan this code.</h1><p>Use Google Authenticator, Microsoft Authenticator, 1Password or another TOTP app.</p>{qrCode && <img src={qrCode} alt="QR code for the Vanteloq founder authenticator"/> /* eslint-disable-line @next/next/no-img-element */}<details><summary>Can&apos;t scan it?</summary><code>{secret}</code></details></div><MfaCode code={code} setCode={setCode} verify={verify} busy={busy}/></div>}
      {state === "challenge_required" && <div className="founder-mfa-copy"><h1>Enter your authenticator code.</h1><p>This session has verified the password but still needs the founder account&apos;s second factor.</p><MfaCode code={code} setCode={setCode} verify={verify} busy={busy}/></div>}
      {state === "error" && <div className="founder-mfa-copy"><h1>Security verification did not finish.</h1><p>{message || "Try again or sign out safely."}</p><button onClick={() => void retryInspection()}>Try again</button></div>}
      {message && state !== "error" && <p className="founder-mfa-error" role="alert">{message}</p>}
      <footer><span>Full platform · BookLoq included · Not billed</span><button onClick={() => void signOut()}>Sign out</button></footer>
    </section>
  </main>;
}

function MfaCode({ code, setCode, verify, busy }: { code: string; setCode: (value: string) => void; verify: () => Promise<void>; busy: boolean }) {
  return <form className="founder-mfa-form" onSubmit={(event) => { event.preventDefault(); void verify(); }}>
    <label>Six-digit code<input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" aria-label="Authenticator code"/></label>
    <button disabled={busy || code.length !== 6} title={code.length !== 6 ? "Enter the six-digit authenticator code." : "Verify this authenticator code."}>{busy ? "Verifying…" : "Verify and continue"}</button>
  </form>;
}
