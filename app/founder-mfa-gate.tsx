"use client";

import { type ReactNode, useEffect, useState } from "react";
import { getSupabase, signOut } from "./supabase-browser";
import ProductBrandLogo from "./product-brand-logo";
import TurnstileField from "./turnstile-field";

const FOUNDER_EMAIL = "hussienissa@lexedgeconsulting.com";
const VERIFICATION_WINDOW_MS = 30 * 60 * 1000;

type GateState = "checking" | "request_required" | "link_sent" | "ready" | "error";

function verificationKey(userId: string) {
  return `vanteloq:founder-email-verification:${userId}`;
}

export default function FounderMfaGate({ email, children }: { email: string; children: ReactNode }) {
  const isFounder = email.toLowerCase() === FOUNDER_EMAIL;
  const [state, setState] = useState<GateState>(isFounder ? "checking" : "ready");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [siteKey, setSiteKey] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileResetSignal, setTurnstileResetSignal] = useState(0);

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
      const verifiedFromLink = new URLSearchParams(window.location.search).get("founder_email_verified") === "1";
      if (verifiedFromLink) {
        window.sessionStorage.setItem(verificationKey(data.user.id), String(Date.now()));
        window.history.replaceState({}, "", `${window.location.pathname}${window.location.hash}`);
        setState("ready");
        return;
      }
      const verifiedAt = Number(window.sessionStorage.getItem(verificationKey(data.user.id)) ?? "0");
      setState(Date.now() - verifiedAt < VERIFICATION_WINDOW_MS ? "ready" : "request_required");
    });
    return () => { active = false; };
  }, [isFounder]);

  useEffect(() => {
    if (!isFounder || state !== "request_required") return;
    const controller = new AbortController();
    void fetch("/api/v1/auth/signup?action=founder-signin", { headers: { accept: "application/json" }, signal: controller.signal })
      .then(async response => {
        const payload = await response.json() as { configured?: boolean; siteKey?: string; action?: string };
        if (!response.ok || !payload.configured || !payload.siteKey || payload.action !== "founder-signin") {
          throw new Error("Founder verification protection is unavailable.");
        }
        setSiteKey(payload.siteKey);
      })
      .catch(error => {
        if ((error as Error).name !== "AbortError") {
          setMessage("Secure account verification is temporarily unavailable.");
          setState("error");
        }
      });
    return () => controller.abort();
  }, [isFounder, state]);

  async function sendLink() {
    const client = await getSupabase();
    if (!client || busy) return;
    if (!turnstileToken) {
      setMessage("Complete the security check before requesting the sign-in email.");
      return;
    }
    setBusy(true);
    setMessage("");
    const redirectTo = `${window.location.origin}/?founder_email_verified=1`;
    const { error } = await client.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: redirectTo, captchaToken: turnstileToken },
    });
    setBusy(false);
    if (error) {
      setTurnstileToken("");
      setTurnstileResetSignal(value => value + 1);
      setMessage(error.message.includes("security purposes")
        ? "Please wait a moment before requesting another sign-in email."
        : error.message || "The secure sign-in email could not be sent.");
      setState("error");
      return;
    }
    setState("link_sent");
    setMessage("Open the newest Vanteloq email and select “Sign in securely.”");
  }

  if (state === "ready") return children;

  return <main className="founder-mfa-gate">
    <section>
      <header><ProductBrandLogo product="vanteloq" priority/><span><b>Secure founder access</b><small>Internal Vanteloq account</small></span></header>
      {state === "checking" && <div className="founder-mfa-copy"><h1>Checking this session…</h1><p>Vanteloq is confirming whether this browser was recently verified.</p></div>}
      {state === "request_required" && <div className="founder-mfa-copy"><h1>Confirm this sign-in by email.</h1><p>We’ll send a secure, one-time sign-in link to the verified email address on your founder account. The address stays hidden on this screen.</p>{siteKey && <TurnstileField siteKey={siteKey} action="founder-signin" resetSignal={turnstileResetSignal} onToken={setTurnstileToken} onError={setMessage}/>}<button onClick={() => void sendLink()} disabled={busy || !siteKey || !turnstileToken}>{busy ? "Sending…" : "Send secure sign-in link"}</button></div>}
      {state === "link_sent" && <div className="founder-mfa-copy"><h1>Check your newest Vanteloq email.</h1><p>Select <b>Sign in securely</b> in that email. Older emails may no longer work after a new link is requested.</p><button onClick={() => { setMessage(""); setState("request_required"); }}>I need another link</button></div>}
      {state === "error" && <div className="founder-mfa-copy"><h1>Email verification did not finish.</h1><p>{message || "Try again or sign out safely."}</p><button onClick={() => { setMessage(""); setState("request_required"); }}>Try again</button></div>}
      {message && state !== "error" && <p className="founder-mfa-message" role="status">{message}</p>}
      <footer><span>Verified email · 30-minute browser window · Not billed</span><button onClick={() => void signOut()}>Sign out</button></footer>
    </section>
  </main>;
}
