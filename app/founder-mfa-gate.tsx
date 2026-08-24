"use client";

import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { getSupabase, signOut } from "./supabase-browser";
import ProductBrandLogo from "./product-brand-logo";

type GateState = "checking" | "enroll_required" | "challenge_required" | "ready" | "error";

function qrSource(value: string) {
  return value.startsWith("data:") ? value : `data:image/svg+xml;utf-8,${encodeURIComponent(value)}`;
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

export default function AccountMfaGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>("checking");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [factorId, setFactorId] = useState("");
  const [qrCode, setQrCode] = useState("");
  const [manualSecret, setManualSecret] = useState("");
  const [code, setCode] = useState("");

  useEffect(() => {
    let active = true;
    void getSupabase().then(async (client) => {
      if (!active) return;
      if (!client) {
        setMessage("Multi-factor authentication is temporarily unavailable.");
        setState("error");
        return;
      }

      const assurance = await client.auth.mfa.getAuthenticatorAssuranceLevel();
      if (!active) return;
      if (assurance.error) {
        setMessage("Vanteloq could not verify this session's security level.");
        setState("error");
        return;
      }
      if (assurance.data.currentLevel === "aal2") {
        setState("ready");
        return;
      }

      const factors = await client.auth.mfa.listFactors();
      if (!active) return;
      if (factors.error) {
        setMessage("Vanteloq could not load your verification methods.");
        setState("error");
        return;
      }
      const verified = factors.data.totp[0];
      if (verified) {
        setFactorId(verified.id);
        setState("challenge_required");
        return;
      }

      // An interrupted enrollment is not a usable second factor. Remove only
      // unverified TOTP rows before issuing one fresh enrollment secret.
      for (const factor of factors.data.all.filter((item) => item.factor_type === "totp" && item.status === "unverified")) {
        let removal = await client.auth.mfa.unenroll({ factorId: factor.id });
        if (removal.error && removal.error.status !== 404) {
          await wait(350);
          removal = await client.auth.mfa.unenroll({ factorId: factor.id });
        }
        if (removal.error && removal.error.status !== 404) {
          if (!active) return;
          setMessage("An earlier authenticator setup is still being cleared. Wait a moment, then try again; no new QR code was issued.");
          setState("error");
          return;
        }
      }
      if (!active) return;
      const refreshedFactors = await client.auth.mfa.listFactors();
      if (!active) return;
      if (refreshedFactors.error || refreshedFactors.data.all.some((item) => item.factor_type === "totp" && item.status === "unverified")) {
        setMessage("Vanteloq could not confirm that the earlier authenticator setup was cleared. Wait a moment, then try again.");
        setState("error");
        return;
      }
      const enrollment = await client.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Vanteloq account",
        issuer: "Vanteloq",
      });
      if (!active) return;
      if (enrollment.error) {
        setMessage("A secure authenticator could not be prepared. Sign out, then try again.");
        setState("error");
        return;
      }
      setFactorId(enrollment.data.id);
      setQrCode(qrSource(enrollment.data.totp.qr_code));
      setManualSecret(enrollment.data.totp.secret);
      setState("enroll_required");
    }).catch(() => {
      if (!active) return;
      setMessage("Multi-factor authentication is temporarily unavailable.");
      setState("error");
    });
    return () => { active = false; };
  }, []);

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (busy || !factorId || !/^\d{6}$/.test(code)) {
      setMessage("Enter the current six-digit code from your authenticator app.");
      return;
    }
    const client = await getSupabase();
    if (!client) {
      setMessage("Multi-factor authentication is temporarily unavailable.");
      return;
    }
    setBusy(true);
    setMessage("");
    const result = await client.auth.mfa.challengeAndVerify({ factorId, code });
    setBusy(false);
    if (result.error) {
      setCode("");
      setMessage(result.error.status === 429
        ? "Too many verification attempts. Wait before trying again."
        : "That code was not accepted. Wait for a new code and try again.");
      return;
    }
    const assurance = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assurance.error || assurance.data.currentLevel !== "aal2") {
      setMessage("The second factor was accepted, but the secured session could not be confirmed. Sign in again.");
      setState("error");
      return;
    }
    setCode("");
    setManualSecret("");
    setQrCode("");
    setState("ready");
  }

  if (state === "ready") return children;

  return <main className="founder-mfa-gate">
    <section>
      <header><ProductBrandLogo product="vanteloq" priority/><span><b>Vanteloq account</b><small>Two-step verification</small></span></header>
      {state === "checking" && <div className="founder-mfa-copy"><h1>Preparing secure sign-in…</h1><p>One moment while we finish protecting your account.</p></div>}
      {state === "enroll_required" && <div className="founder-mfa-enroll">
        <div>
          <h1>Set up two-step verification.</h1>
          <p>Scan the QR code with your authenticator app, then enter the six-digit code it provides. Keep this page open until setup is complete.</p>
          <details><summary>Use a setup key instead</summary><code>{manualSecret}</code></details>
        </div>
        <div>
          {/* A provider-generated data URI cannot be optimized by next/image. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {qrCode && <img src={qrCode} width={190} height={190} alt="Authenticator enrollment QR code"/>}
          <form className="founder-mfa-form" onSubmit={verify}>
            <label>Verification code<input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required/></label>
            <button disabled={busy || code.length !== 6}>{busy ? "Verifying…" : "Enable two-factor authentication"}</button>
          </form>
        </div>
      </div>}
      {state === "challenge_required" && <div className="founder-mfa-copy">
        <h1>Verify it&apos;s you.</h1>
        <p>Enter the current six-digit code from your authenticator app to continue.</p>
        <form className="founder-mfa-form" onSubmit={verify}>
          <label>Verification code<input autoFocus value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required/></label>
          <button disabled={busy || code.length !== 6}>{busy ? "Verifying…" : "Verify and continue"}</button>
        </form>
      </div>}
      {state === "error" && <div className="founder-mfa-copy"><h1>We couldn&apos;t finish verification.</h1><p>{message || "Sign out safely and try again."}</p></div>}
      {message && state !== "error" && <p className="founder-mfa-message" role="alert">{message}</p>}
      <footer><button onClick={() => void signOut()}>Sign out</button></footer>
    </section>
  </main>;
}
