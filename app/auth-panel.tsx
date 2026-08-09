"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import ProductBrandLogo from "./product-brand-logo";
import { getSupabase } from "./supabase-browser";

export type AuthPanelMode = "signin" | "signup" | "request-reset" | "reset-password";

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

export default function AuthPanel({ close, initialMode = "signup" }: { close: () => void; initialMode?: AuthPanelMode }) {
  const [mode, setMode] = useState<AuthPanelMode>(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageIsError, setMessageIsError] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [recoveryReady, setRecoveryReady] = useState<boolean | null>(initialMode === "reset-password" ? null : true);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [siteKey, setSiteKey] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const turnstileContainer = useRef<HTMLDivElement>(null);
  const turnstileWidget = useRef<string | null>(null);

  useEffect(() => {
    void getSupabase().then(async client => {
      setConfigured(Boolean(client));
      if (initialMode !== "reset-password") return;
      if (!client) {
        setRecoveryReady(false);
        return;
      }
      const { data, error } = await client.auth.getSession();
      const ready = Boolean(data.session) && !error;
      setRecoveryReady(ready);
      if (!ready) {
        setMessageIsError(true);
        setMessage("This password-reset link is invalid or has expired. Request a new link to continue.");
      }
    });
  }, [initialMode]);

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
        if ((error as Error).name !== "AbortError") {
          setMessageIsError(true);
          setMessage("Secure signup is temporarily unavailable. Please try again shortly.");
        }
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
        callback: token => { setTurnstileToken(token); setMessage(""); setMessageIsError(false); },
        "expired-callback": () => setTurnstileToken(""),
        "error-callback": () => { setTurnstileToken(""); setMessageIsError(true); setMessage("The security check could not be completed. Please retry."); },
      });
    }).catch(() => { setMessageIsError(true); setMessage("The security check could not load. Please retry."); });
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
    if (!supabase) {
      setMessageIsError(true);
      return setMessage("Account service is not configured yet.");
    }
    if (mode === "signup" && !turnstileToken) {
      setMessageIsError(true);
      return setMessage("Complete the security check to create your account.");
    }
    setBusy(true);
    setMessage("");
    setMessageIsError(false);
    setNeedsConfirmation(false);

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
          setMessageIsError(true);
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
        setMessageIsError(true);
        setMessage("Secure signup is temporarily unavailable. Please try again shortly.");
      } finally {
        setBusy(false);
      }
      return;
    }

    if (mode === "request-reset") {
      const redirectTo = `${window.location.origin}/?recovery=1`;
      const result = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo });
      setBusy(false);
      if (result.error) {
        setMessageIsError(true);
        setMessage("The reset email could not be sent. Wait a moment and try again.");
        return;
      }
      setMessage("If an account exists for that email, a password-reset link is on its way. Open the newest email only; older links expire after use.");
      return;
    }

    if (mode === "reset-password") {
      if (!recoveryReady) {
        setBusy(false);
        setMessageIsError(true);
        setMessage("This password-reset link is invalid or has expired. Request a new link to continue.");
        return;
      }
      if (password !== passwordConfirmation) {
        setBusy(false);
        setMessageIsError(true);
        setMessage("The passwords do not match.");
        return;
      }
      const result = await supabase.auth.updateUser({ password });
      if (result.error) {
        setBusy(false);
        setMessageIsError(true);
        setMessage(result.error.message || "The password could not be updated. Request a new reset link and try again.");
        return;
      }
      await supabase.auth.signOut({ scope: "global" });
      window.history.replaceState({}, "", window.location.pathname);
      setBusy(false);
      setMode("signin");
      setPassword("");
      setPasswordConfirmation("");
      setRecoveryReady(true);
      setMessage("Your password has been updated. Sign in with the new password.");
      return;
    }

    const result = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (result.error) {
      setMessageIsError(true);
      if (result.error.code === "email_not_confirmed") {
        setNeedsConfirmation(true);
        return setMessage("Your email has not been verified. Open the newest confirmation email, or resend it below.");
      }
      if (result.error.code === "invalid_credentials") {
        return setMessage("The email or password is incorrect. If you registered more than once, use the original password or reset it below.");
      }
      return setMessage(result.error.message);
    }
    window.location.reload();
  }

  async function resendConfirmation() {
    const supabase = await getSupabase();
    if (!supabase || busy) return;
    setBusy(true);
    setMessage("");
    const result = await supabase.auth.resend({
      type: "signup",
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: `${window.location.origin}/` },
    });
    setBusy(false);
    if (result.error) {
      setMessageIsError(true);
      setMessage("A new confirmation email could not be sent yet. Wait a moment and try again.");
      return;
    }
    setMessageIsError(false);
    setMessage("A new confirmation email is on its way. Open the newest email; earlier links will no longer work.");
  }

  function changeMode(nextMode: AuthPanelMode) {
    setMode(nextMode);
    setMessage("");
    setMessageIsError(false);
    setNeedsConfirmation(false);
    setPassword("");
    setPasswordConfirmation("");
  }

  const title = mode === "signup" ? "Create your workspace"
    : mode === "signin" ? "Welcome back"
    : mode === "request-reset" ? "Reset your password"
    : "Choose a new password";
  const description = mode === "signup"
    ? "Start with a verified owner account. Business data stays separated by workspace."
    : mode === "signin"
      ? "Sign in with your verified Vanteloq account."
      : mode === "request-reset"
        ? "Enter your account email. We will send one secure reset link."
        : "Enter a new password for your Vanteloq account.";
  const submitLabel = mode === "signup" ? "Create secure account"
    : mode === "signin" ? "Sign in"
    : mode === "request-reset" ? "Send reset link"
    : "Update password";

  return <div className="auth-backdrop" role="dialog" aria-modal="true" aria-labelledby="auth-title">
    <section className="auth-panel">
      <header><ProductBrandLogo product="vanteloq"/><button type="button" onClick={close} aria-label="Close account form">×</button></header>
      <small>SECURE VANTELOQ ACCOUNT</small>
      <h2 id="auth-title">{title}</h2>
      <p>{description}</p>
      {configured === false && <div className="auth-message error">Account service is temporarily unavailable.</div>}
      <form onSubmit={submit}>
        {mode === "signup" && <label>Full name<input autoComplete="name" value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={120} required/></label>}
        {mode !== "reset-password" && <label>Email address<input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required/></label>}
        {(mode === "signup" || mode === "signin" || mode === "reset-password") && <label>{mode === "reset-password" ? "New password" : "Password"}<input type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} value={password} onChange={event => setPassword(event.target.value)} minLength={8} required/></label>}
        {mode === "reset-password" && <label>Confirm new password<input type="password" autoComplete="new-password" value={passwordConfirmation} onChange={event => setPasswordConfirmation(event.target.value)} minLength={8} required/></label>}
        {mode === "signup" && <div className="turnstile-field">
          <span>Security verification</span>
          <div ref={turnstileContainer} aria-label="Cloudflare security verification"/>
          <small>Protected by Cloudflare Turnstile. No puzzle is shown unless additional verification is needed.</small>
        </div>}
        {message && <div className={`auth-message${messageIsError ? " error" : ""}`} aria-live="polite">{message}</div>}
        {needsConfirmation && <button className="auth-secondary" type="button" onClick={() => void resendConfirmation()} disabled={busy}>Resend confirmation email</button>}
        <button className="auth-submit" disabled={busy || configured !== true || (mode === "signup" && (!siteKey || !turnstileToken)) || (mode === "reset-password" && recoveryReady !== true)}>{busy || configured === null || (mode === "reset-password" && recoveryReady === null) ? "Please wait…" : submitLabel}</button>
      </form>
      {mode === "signin" && <button className="auth-switch" type="button" onClick={() => changeMode("request-reset")}>Forgot your password?</button>}
      {mode === "request-reset" && <button className="auth-switch" type="button" onClick={() => changeMode("signin")}>Back to sign in</button>}
      {mode === "reset-password" && recoveryReady === false && <button className="auth-switch" type="button" onClick={() => changeMode("request-reset")}>Request a new reset link</button>}
      {(mode === "signup" || mode === "signin") && <button className="auth-switch auth-switch-secondary" type="button" onClick={() => { changeMode(mode === "signup" ? "signin" : "signup"); setSiteKey(""); }}>
        {mode === "signup" ? "Already have an account? Sign in" : "New to Vanteloq? Create an account"}
      </button>}
    </section>
  </div>;
}
