"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import ProductBrandLogo from "./product-brand-logo";
import { getSupabase } from "./supabase-browser";

type TurnstileApi = {
  render(container: HTMLElement, options: {
    sitekey: string;
    action: string;
    theme: "light";
    callback(token: string): void;
    "error-callback"(): void;
    "expired-callback"(): void;
  }): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
};

declare global {
  interface Window { turnstile?: TurnstileApi; }
}

let turnstileScript: Promise<void> | null = null;

function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (turnstileScript) return turnstileScript;
  turnstileScript = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-vanteloq-turnstile]');
    const script = existing ?? document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.dataset.vanteloqTurnstile = "true";
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("Turnstile failed to load.")), { once: true });
    if (!existing) document.head.appendChild(script);
  });
  return turnstileScript;
}

export default function AuthPanel({ close }: { close: () => void }) {
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [siteKey, setSiteKey] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const turnstileContainer = useRef<HTMLDivElement>(null);
  const turnstileWidget = useRef<string | null>(null);

  useEffect(() => { void getSupabase().then(client => setConfigured(Boolean(client))); }, []);

  useEffect(() => {
    if (mode !== "signup") return;
    const controller = new AbortController();
    void fetch("/api/v1/auth/signup", { headers: { accept: "application/json" }, signal: controller.signal })
      .then(async response => {
        const payload = await response.json() as { configured?: boolean; siteKey?: string };
        if (!response.ok || !payload.configured || !payload.siteKey) throw new Error("Signup protection is unavailable.");
        setSiteKey(payload.siteKey);
      })
      .catch(error => {
        if ((error as Error).name !== "AbortError") setMessage("Secure signup is temporarily unavailable. Please try again shortly.");
      });
    return () => controller.abort();
  }, [mode]);

  useEffect(() => {
    if (mode !== "signup" || !siteKey || !turnstileContainer.current) return;
    let cancelled = false;
    void loadTurnstile().then(() => {
      if (cancelled || !window.turnstile || !turnstileContainer.current || turnstileWidget.current) return;
      turnstileWidget.current = window.turnstile.render(turnstileContainer.current, {
        sitekey: siteKey,
        action: "signup",
        theme: "light",
        callback: token => { setTurnstileToken(token); setMessage(""); },
        "expired-callback": () => setTurnstileToken(""),
        "error-callback": () => { setTurnstileToken(""); setMessage("The security check could not be completed. Please retry."); },
      });
    }).catch(() => setMessage("The security check could not load. Please retry."));
    return () => {
      cancelled = true;
      if (turnstileWidget.current && window.turnstile) window.turnstile.remove(turnstileWidget.current);
      turnstileWidget.current = null;
      setTurnstileToken("");
    };
  }, [mode, siteKey]);

  function resetTurnstile() {
    setTurnstileToken("");
    if (turnstileWidget.current && window.turnstile) window.turnstile.reset(turnstileWidget.current);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const supabase = await getSupabase();
    if (!supabase) return setMessage("Account service is not configured yet.");
    if (mode === "signup" && !turnstileToken) return setMessage("Complete the security check to create your account.");
    setBusy(true);
    setMessage("");

    if (mode === "signup") {
      try {
        const response = await fetch("/api/v1/auth/signup", {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ name: name.trim(), email, password, turnstileToken }),
        });
        const payload = await response.json() as {
          session?: { accessToken?: string; refreshToken?: string } | null;
          error?: { message?: string };
        };
        if (!response.ok) {
          resetTurnstile();
          setMessage(payload.error?.message ?? "Account creation could not be completed. Please try again.");
          return;
        }
        if (payload.session?.accessToken && payload.session.refreshToken) {
          const sessionResult = await supabase.auth.setSession({ access_token: payload.session.accessToken, refresh_token: payload.session.refreshToken });
          if (sessionResult.error) throw sessionResult.error;
          window.location.reload();
          return;
        }
        resetTurnstile();
        setMessage("Check your email to verify the account, then return here to sign in.");
      } catch {
        resetTurnstile();
        setMessage("Secure signup is temporarily unavailable. Please try again shortly.");
      } finally {
        setBusy(false);
      }
      return;
    }

    const result = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (result.error) return setMessage(result.error.message);
    window.location.reload();
  }

  return <div className="auth-backdrop" role="dialog" aria-modal="true" aria-labelledby="auth-title">
    <section className="auth-panel">
      <header><ProductBrandLogo product="vanteloq"/><button type="button" onClick={close} aria-label="Close account form">×</button></header>
      <small>SECURE VANTELOQ ACCOUNT</small>
      <h2 id="auth-title">{mode === "signup" ? "Create your workspace" : "Welcome back"}</h2>
      <p>{mode === "signup" ? "Start with a verified owner account. Business data stays separated by workspace." : "Sign in with your verified Vanteloq account."}</p>
      {configured === false && <div className="auth-message error">Account service is temporarily unavailable.</div>}
      <form onSubmit={submit}>
        {mode === "signup" && <label>Full name<input autoComplete="name" value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={120} required/></label>}
        <label>Email address<input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required/></label>
        <label>Password<input type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={event => setPassword(event.target.value)} minLength={8} required/></label>
        {mode === "signup" && <div className="turnstile-field">
          <span>Security verification</span>
          <div ref={turnstileContainer} aria-label="Cloudflare security verification"/>
          <small>Protected by Cloudflare Turnstile. No puzzle is shown unless additional verification is needed.</small>
        </div>}
        {message && <div className="auth-message" aria-live="polite">{message}</div>}
        <button className="auth-submit" disabled={busy || configured !== true || (mode === "signup" && (!siteKey || !turnstileToken))}>{busy || configured === null ? "Please wait…" : mode === "signup" ? "Create secure account" : "Sign in"}</button>
      </form>
      <button className="auth-switch" type="button" onClick={() => { setMode(value => value === "signup" ? "signin" : "signup"); setMessage(""); setSiteKey(""); }}>
        {mode === "signup" ? "Already have an account? Sign in" : "New to Vanteloq? Create an account"}
      </button>
    </section>
  </div>;
}
