"use client";

import { type FormEvent, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import ProductBrandLogo from "./product-brand-logo";
import { getSupabase } from "./supabase-browser";
import TurnstileField from "./turnstile-field";
import { MINIMUM_PASSWORD_LENGTH, passwordRules, strongPasswordError } from "../shared/password-security";
import { canonicalAuthUrl } from "../shared/auth-urls";
import { passwordExposureStatus } from "../shared/password-exposure";

export type AuthPanelMode = "signin" | "signup" | "request-reset" | "reset-password";

export default function AuthPanel({
  close,
  authenticated,
  initialMode = "signup",
}: {
  close: () => void;
  authenticated: (session: Session) => void;
  initialMode?: AuthPanelMode;
}) {
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
  const [turnstileAction, setTurnstileAction] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileResetSignal, setTurnstileResetSignal] = useState(0);
  const protectedMode = mode === "signup" || mode === "signin" || mode === "request-reset";

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
    if (!protectedMode) return;
    const requestedAction = mode === "signin" ? "signin" : mode === "request-reset" ? "password-recovery" : "signup";
    const controller = new AbortController();
    void fetch(`/api/v1/auth/signup?action=${encodeURIComponent(requestedAction)}`, { headers: { accept: "application/json" }, signal: controller.signal })
      .then(async response => {
        const payload = await response.json() as { configured?: boolean; siteKey?: string; action?: string };
        if (!response.ok || !payload.configured || !payload.siteKey || payload.action !== requestedAction) throw new Error("Account protection is unavailable.");
        setSiteKey(payload.siteKey);
        setTurnstileAction(payload.action);
      })
      .catch(error => {
        if ((error as Error).name !== "AbortError") {
          setMessageIsError(true);
          setMessage("Secure account verification is temporarily unavailable. Please try again shortly.");
        }
      });
    return () => controller.abort();
  }, [mode, protectedMode]);

  function resetTurnstile() {
    setTurnstileToken("");
    setTurnstileResetSignal(value => value + 1);
  }

  function acceptTurnstileToken(token: string) {
    setTurnstileToken(token);
    if (token && /security check|account verification/i.test(message)) {
      setMessage("");
      setMessageIsError(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const supabase = await getSupabase();
    if (!supabase) {
      setMessageIsError(true);
      return setMessage("Account service is not configured yet.");
    }
    if (protectedMode && !turnstileToken) {
      setMessageIsError(true);
      return setMessage("Complete the security check to continue.");
    }
    setBusy(true);
    setMessage("");
    setMessageIsError(false);
    setNeedsConfirmation(false);

    if (mode === "signup") {
      const passwordError = strongPasswordError(password);
      if (passwordError) {
        setBusy(false);
        setMessageIsError(true);
        setMessage(passwordError);
        return;
      }
      const exposure = await passwordExposureStatus(password);
      if (exposure !== "safe") {
        setBusy(false);
        setMessageIsError(true);
        setMessage(exposure === "exposed"
          ? "This password appears in known breach data. Choose a unique password that you have not used anywhere else."
          : "The password safety check is temporarily unavailable. Please try again shortly.");
        return;
      }
      try {
        const result = await supabase.auth.signUp({
          email: email.trim().toLowerCase(),
          password,
          options: {
            data: { full_name: name.trim() },
            emailRedirectTo: canonicalAuthUrl("/"),
            captchaToken: turnstileToken,
          },
        });
        if (result.error) {
          resetTurnstile();
          setMessageIsError(true);
          setMessage(result.error.status === 429
            ? "Too many account-creation attempts. Wait a moment and try again."
            : "Account creation could not be completed. Check your details and try again.");
          return;
        }
        if (result.data.session) {
          authenticated(result.data.session);
          return;
        }
        resetTurnstile();
        setMessage("Check your email and open the newest verification link. Vanteloq will securely finish this sign-in for you.");
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
      const redirectTo = canonicalAuthUrl("/?recovery=1");
      const result = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo, captchaToken: turnstileToken });
      resetTurnstile();
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
      const passwordError = strongPasswordError(password);
      if (passwordError) {
        setBusy(false);
        setMessageIsError(true);
        setMessage(passwordError);
        return;
      }
      const exposure = await passwordExposureStatus(password);
      if (exposure !== "safe") {
        setBusy(false);
        setMessageIsError(true);
        setMessage(exposure === "exposed"
          ? "This password appears in known breach data. Choose a unique password that you have not used anywhere else."
          : "The password safety check is temporarily unavailable. Please try again shortly.");
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

    let result: { data: { session: Session | null }; error: { code?: string; message: string } | null };
    try {
      const response = await fetch("/api/v1/auth/signin", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ email, password, turnstileToken }),
      });
      const payload = await response.json() as { session?: { accessToken?: string; refreshToken?: string }; error?: { code?: string; message?: string } };
      if (!response.ok || !payload.session?.accessToken || !payload.session.refreshToken) {
        result = { data: { session: null }, error: { code: payload.error?.code, message: payload.error?.message ?? "Sign-in could not be completed." } };
      } else {
        const sessionResult = await supabase.auth.setSession({ access_token: payload.session.accessToken, refresh_token: payload.session.refreshToken });
        result = { data: { session: sessionResult.data.session }, error: sessionResult.error };
      }
    } catch {
      result = { data: { session: null }, error: { code: "SIGNIN_UNAVAILABLE", message: "Secure sign-in is temporarily unavailable." } };
    }
    resetTurnstile();
    setBusy(false);
    if (result.error) {
      setMessageIsError(true);
      if (result.error.code === "EMAIL_NOT_CONFIRMED") {
        setNeedsConfirmation(true);
        return setMessage("Your email has not been verified. Open the newest confirmation email, or resend it below.");
      }
      if (result.error.code === "INVALID_CREDENTIALS") {
        return setMessage("The email or password is incorrect. If you registered more than once, use the original password or reset it below.");
      }
      return setMessage(result.error.message);
    }
    if (!result.data.session) {
      setMessageIsError(true);
      setMessage("Your account signed in, but the session could not be loaded. Please try again.");
      return;
    }
    authenticated(result.data.session);
  }

  async function resendConfirmation() {
    const supabase = await getSupabase();
    if (!supabase || busy) return;
    if (!turnstileToken) {
      setMessageIsError(true);
      setMessage("Complete a fresh security check before resending the confirmation email.");
      return;
    }
    setBusy(true);
    setMessage("");
    const result = await supabase.auth.resend({
      type: "signup",
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: canonicalAuthUrl("/"), captchaToken: turnstileToken },
    });
    resetTurnstile();
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
    setSiteKey("");
    setTurnstileAction("");
    setTurnstileToken("");
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
        ? "Enter your account email. We will send one secure reset link to open on this device."
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
        {(mode === "signup" || mode === "signin" || mode === "reset-password") && <label>{mode === "reset-password" ? "New password" : "Password"}<input type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} value={password} onChange={event => setPassword(event.target.value)} minLength={mode === "signin" ? 1 : MINIMUM_PASSWORD_LENGTH} required/></label>}
        {mode === "reset-password" && <label>Confirm new password<input type="password" autoComplete="new-password" value={passwordConfirmation} onChange={event => setPasswordConfirmation(event.target.value)} minLength={MINIMUM_PASSWORD_LENGTH} required/></label>}
        {(mode === "signup" || mode === "reset-password") && <div className="auth-password-rules" aria-label="Password requirements">{passwordRules(password).map(rule => <span className={rule.met ? "met" : ""} key={rule.id}>{rule.met ? "Met" : "Required"}: {rule.label}</span>)}<span>Known breached passwords are rejected when you submit.</span></div>}
        {protectedMode && siteKey && turnstileAction && <TurnstileField
          siteKey={siteKey}
          action={turnstileAction}
          resetSignal={turnstileResetSignal}
          onToken={acceptTurnstileToken}
          onError={error => { setTurnstileToken(""); setMessageIsError(true); setMessage(error); }}
        />}
        {message && <div className={`auth-message${messageIsError ? " error" : ""}`} aria-live="polite">{message}</div>}
        {needsConfirmation && <button className="auth-secondary" type="button" onClick={() => void resendConfirmation()} disabled={busy}>Resend confirmation email</button>}
        <button className="auth-submit" disabled={busy || configured !== true || (protectedMode && (!siteKey || !turnstileToken)) || (mode === "reset-password" && recoveryReady !== true)}>{busy || configured === null || (mode === "reset-password" && recoveryReady === null) ? "Please wait…" : submitLabel}</button>
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
