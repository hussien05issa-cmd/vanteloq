"use client";

import { type FormEvent, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import Link from "next/link";
import ProductBrandLogo from "./product-brand-logo";
import { getSupabase } from "./supabase-browser";
import TurnstileField from "./turnstile-field";
import { MINIMUM_PASSWORD_LENGTH, passwordRules, strongPasswordError } from "../shared/password-security";
import { canonicalAuthUrl } from "../shared/auth-urls";
import { signupErrorMessage } from "../shared/auth-error-messages";
import { passwordExposureStatus } from "../shared/password-exposure";
import { inspectRecoveryMfa, verifyRecoveryMfa } from "../shared/recovery-mfa";
import {
  isCompleteEmailVerificationCode,
  MAXIMUM_EMAIL_VERIFICATION_CODE_LENGTH,
  MINIMUM_EMAIL_VERIFICATION_CODE_LENGTH,
  normalizeEmailVerificationCode,
  verifyRecoveryCode,
  verifySignupCode,
} from "../shared/signup-verification";
import {
  ACCOUNT_ACCEPTANCE_NOTICE_VERSION,
  PRIVACY_POLICY_VERSION,
  TERMS_OF_SERVICE_VERSION,
} from "../shared/legal-versions";

export type AuthPanelMode = "signin" | "signup" | "verify-signup" | "request-reset" | "verify-recovery" | "reset-password";

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
  const [verificationCode, setVerificationCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageIsError, setMessageIsError] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [recoveryReady, setRecoveryReady] = useState<boolean | null>(initialMode === "reset-password" ? null : true);
  const [recoveryMfaState, setRecoveryMfaState] = useState<"checking" | "ready" | "challenge_required" | "error">(initialMode === "reset-password" ? "checking" : "ready");
  const [recoveryMfaFactorId, setRecoveryMfaFactorId] = useState("");
  const [recoveryMfaCode, setRecoveryMfaCode] = useState("");
  const [siteKey, setSiteKey] = useState("");
  const [turnstileAction, setTurnstileAction] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileResetSignal, setTurnstileResetSignal] = useState(0);
  const [legalAccepted, setLegalAccepted] = useState(false);
  const protectedMode = mode === "signup" || mode === "signin" || mode === "request-reset";
  const showsTurnstile = protectedMode || mode === "verify-signup";
  const recoveryMfaRequired = mode === "reset-password" && recoveryMfaState === "challenge_required";

  useEffect(() => {
    let active = true;
    void getSupabase().then(async client => {
      if (!active) return;
      setConfigured(Boolean(client));
      if (initialMode !== "reset-password") return;
      if (!client) {
        setRecoveryReady(false);
        setRecoveryMfaState("error");
        return;
      }
      const { data, error } = await client.auth.getSession();
      const ready = Boolean(data.session) && !error;
      if (!active) return;
      setRecoveryReady(ready);
      if (!ready) {
        setRecoveryMfaState("error");
        setMessageIsError(true);
        setMessage("This password-reset link is invalid or has expired. Request a new link to continue.");
        return;
      }
      const mfa = await inspectRecoveryMfa(client.auth.mfa);
      if (!active) return;
      if (mfa.status === "challenge_required") {
        setRecoveryMfaFactorId(mfa.factorId);
        setRecoveryMfaState("challenge_required");
        return;
      }
      if (mfa.status === "error") {
        setRecoveryMfaState("error");
        setMessageIsError(true);
        setMessage(mfa.message);
        return;
      }
      setRecoveryMfaState("ready");
    }).catch(() => {
      if (!active || initialMode !== "reset-password") return;
      setRecoveryReady(false);
      setRecoveryMfaState("error");
      setMessageIsError(true);
      setMessage("Vanteloq could not prepare secure password recovery. Request a new link and try again.");
    });
    return () => { active = false; };
  }, [initialMode]);

  useEffect(() => {
    if (!showsTurnstile) return;
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
  }, [mode, showsTurnstile]);

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

    if (mode === "signup") {
      if (!legalAccepted) {
        setBusy(false);
        setMessageIsError(true);
        setMessage("Review and accept the Terms of Service and Privacy Policy to create an account.");
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
      try {
        const result = await supabase.auth.signUp({
          email: email.trim().toLowerCase(),
          password,
          options: {
            data: {
              full_name: name.trim(),
              legal_terms_version: TERMS_OF_SERVICE_VERSION,
              legal_privacy_version: PRIVACY_POLICY_VERSION,
              legal_notice_version: ACCOUNT_ACCEPTANCE_NOTICE_VERSION,
              legal_accepted_at: new Date().toISOString(),
            },
            emailRedirectTo: canonicalAuthUrl("/"),
            captchaToken: turnstileToken,
          },
        });
        if (result.error) {
          resetTurnstile();
          setMessageIsError(true);
          setMessage(signupErrorMessage(result.error));
          return;
        }
        if (result.data.session) {
          authenticated(result.data.session);
          return;
        }
        resetTurnstile();
        setVerificationCode("");
        setMode("verify-signup");
        setMessage("We sent a verification code to your email. Enter the newest code here to continue.");
      } catch {
        resetTurnstile();
        setMessageIsError(true);
        setMessage("Secure signup is temporarily unavailable. Please try again shortly.");
      } finally {
        setBusy(false);
      }
      return;
    }

    if (mode === "verify-signup") {
      try {
        const session = await verifySignupCode(supabase, email, verificationCode);
        setBusy(false);
        setVerificationCode("");
        authenticated(session);
      } catch (error) {
        setBusy(false);
        setVerificationCode("");
        setMessageIsError(true);
        setMessage(error instanceof Error ? error.message : "Email verification could not be completed.");
      }
      return;
    }

    if (mode === "verify-recovery") {
      const previousLocation = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      const recoveryLocation = new URL(window.location.href);
      recoveryLocation.searchParams.set("recovery", "1");
      window.history.replaceState({}, document.title, `${recoveryLocation.pathname}${recoveryLocation.search}${recoveryLocation.hash}`);
      try {
        await verifyRecoveryCode(supabase, email, verificationCode);
        const mfa = await inspectRecoveryMfa(supabase.auth.mfa);
        setBusy(false);
        setVerificationCode("");
        setRecoveryReady(true);
        setMode("reset-password");
        if (mfa.status === "challenge_required") {
          setRecoveryMfaFactorId(mfa.factorId);
          setRecoveryMfaState("challenge_required");
          setMessage("Recovery email verified. Enter the current six-digit code from your authenticator app.");
          return;
        }
        if (mfa.status === "error") {
          setRecoveryMfaState("error");
          setMessageIsError(true);
          setMessage(mfa.message);
          return;
        }
        setRecoveryMfaState("ready");
        setMessage("Recovery email verified. Choose your new password.");
      } catch (error) {
        window.history.replaceState({}, document.title, previousLocation);
        setBusy(false);
        setVerificationCode("");
        setMessageIsError(true);
        setMessage(error instanceof Error ? error.message : "The recovery code could not be verified.");
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
      setVerificationCode("");
      setMode("verify-recovery");
      setMessage("If an account exists for that email, the newest message includes both a secure reset link and a recovery email code.");
      return;
    }

    if (mode === "reset-password") {
      if (!recoveryReady) {
        setBusy(false);
        setMessageIsError(true);
        setMessage("This password-reset link is invalid or has expired. Request a new link to continue.");
        return;
      }
      if (recoveryMfaState === "challenge_required") {
        const verification = await verifyRecoveryMfa(supabase.auth.mfa, recoveryMfaFactorId, recoveryMfaCode);
        setBusy(false);
        setRecoveryMfaCode("");
        if (verification.status !== "ready") {
          setMessageIsError(true);
          setMessage(verification.message);
          return;
        }
        setRecoveryMfaState("ready");
        setMessage("Identity verified. Choose your new password to finish recovery.");
        return;
      }
      if (recoveryMfaState !== "ready") {
        setBusy(false);
        setMessageIsError(true);
        setMessage("Finish authenticator verification before changing the password.");
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
      setRecoveryMfaState("ready");
      setRecoveryMfaFactorId("");
      setRecoveryMfaCode("");
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
        setMode("verify-signup");
        setMessageIsError(false);
        return setMessage("Your email has not been verified. Enter the newest verification code, or request a new one below.");
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
    setMessage("A new verification code is on its way. Enter the newest code; earlier codes will no longer work.");
  }

  function changeMode(nextMode: AuthPanelMode) {
    setMode(nextMode);
    setSiteKey("");
    setTurnstileAction("");
    setTurnstileToken("");
    setMessage("");
    setMessageIsError(false);
    setPassword("");
    setPasswordConfirmation("");
    setVerificationCode("");
    setRecoveryMfaCode("");
    setRecoveryMfaFactorId("");
    setRecoveryMfaState(nextMode === "reset-password" ? "checking" : "ready");
    setRecoveryReady(nextMode === "reset-password" ? null : true);
    setLegalAccepted(false);
  }

  function dismiss() {
    if (mode === "verify-recovery" || mode === "reset-password") {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    close();
  }

  const title = mode === "signup" ? "Create your workspace"
    : mode === "verify-signup" ? "Verify your email"
    : mode === "signin" ? "Welcome back"
    : mode === "request-reset" ? "Reset your password"
    : mode === "verify-recovery" ? "Check your email"
    : recoveryMfaRequired ? "Verify it's you" : "Choose a new password";
  const description = mode === "signup"
    ? "Start with a verified owner account. Business data stays separated by workspace."
    : mode === "verify-signup"
      ? `Enter the verification code sent to ${email.trim().toLowerCase() || "your email"}. You will continue directly to two-factor authentication.`
    : mode === "signin"
      ? "Sign in with your verified Vanteloq account."
      : mode === "request-reset"
        ? "Enter your account email. We will send a secure reset link and a recovery email code."
        : mode === "verify-recovery"
          ? `Open the secure link in the newest message sent to ${email.trim().toLowerCase() || "your email"}, or enter its 6 to 10 digit recovery code below.`
        : recoveryMfaRequired
          ? "Enter the current six-digit code from your authenticator app before changing your password."
          : "Enter a new password for your Vanteloq account.";
  const submitLabel = mode === "signup" ? "Create secure account"
    : mode === "verify-signup" ? "Verify and continue"
    : mode === "signin" ? "Sign in"
    : mode === "request-reset" ? "Send reset link and code"
    : mode === "verify-recovery" ? "Verify recovery code"
    : recoveryMfaRequired ? "Verify and continue" : "Update password";

  return <div className="auth-backdrop" role="dialog" aria-modal="true" aria-labelledby="auth-title">
    <section className="auth-panel">
      <header><ProductBrandLogo product="vanteloq"/><button type="button" onClick={dismiss} aria-label="Close account form">×</button></header>
      <small>SECURE VANTELOQ ACCOUNT</small>
      <h2 id="auth-title">{title}</h2>
      <p>{description}</p>
      {configured === false && <div className="auth-message error">Account service is temporarily unavailable.</div>}
      <form onSubmit={submit}>
        {mode === "signup" && <label>Full name<input autoComplete="name" value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={120} required/></label>}
        {mode !== "reset-password" && mode !== "verify-signup" && <label>Email address<input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required/></label>}
        {(mode === "verify-signup" || mode === "verify-recovery") && <label>{mode === "verify-recovery" ? "Recovery email code" : "Verification code"}<input autoFocus value={verificationCode} onChange={event => setVerificationCode(normalizeEmailVerificationCode(event.target.value).slice(0, MAXIMUM_EMAIL_VERIFICATION_CODE_LENGTH))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" minLength={MINIMUM_EMAIL_VERIFICATION_CODE_LENGTH} maxLength={MAXIMUM_EMAIL_VERIFICATION_CODE_LENGTH} required/></label>}
        {recoveryMfaRequired && <label>Authenticator app code<input autoFocus value={recoveryMfaCode} onChange={event => setRecoveryMfaCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required/></label>}
        {(mode === "signup" || mode === "signin" || (mode === "reset-password" && recoveryMfaState === "ready")) && <label>{mode === "reset-password" ? "New password" : "Password"}<input type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} value={password} onChange={event => setPassword(event.target.value)} minLength={mode === "signin" ? 1 : MINIMUM_PASSWORD_LENGTH} required/></label>}
        {mode === "reset-password" && recoveryMfaState === "ready" && <label>Confirm new password<input type="password" autoComplete="new-password" value={passwordConfirmation} onChange={event => setPasswordConfirmation(event.target.value)} minLength={MINIMUM_PASSWORD_LENGTH} required/></label>}
        {(mode === "signup" || (mode === "reset-password" && recoveryMfaState === "ready")) && <div className="auth-password-rules" aria-label="Password requirements">{passwordRules(password).map(rule => <span className={rule.met ? "met" : ""} key={rule.id}>{rule.met ? "Met" : "Required"}: {rule.label}</span>)}<span>Known breached passwords are rejected when you submit.</span></div>}
        {showsTurnstile && siteKey && turnstileAction && <TurnstileField
          siteKey={siteKey}
          action={turnstileAction}
          resetSignal={turnstileResetSignal}
          onToken={acceptTurnstileToken}
          onError={error => { setTurnstileToken(""); setMessageIsError(true); setMessage(error); }}
        />}
        {message && <div className={`auth-message${messageIsError ? " error" : ""}`} aria-live="polite">{message}</div>}
        {mode === "verify-signup" && <button className="auth-secondary" type="button" onClick={() => void resendConfirmation()} disabled={busy || !siteKey || !turnstileToken}>Send a new code</button>}
        {mode === "signup" && <label className="auth-legal-consent"><input type="checkbox" checked={legalAccepted} onChange={event => setLegalAccepted(event.target.checked)} required/><span>I agree to the <Link href="/terms" target="_blank">Terms of Service</Link> and acknowledge the <Link href="/privacy" target="_blank">Privacy Policy</Link>.</span></label>}
        <button className="auth-submit" disabled={busy || configured !== true || (protectedMode && (!siteKey || !turnstileToken)) || ((mode === "verify-signup" || mode === "verify-recovery") && !isCompleteEmailVerificationCode(verificationCode)) || (mode === "signup" && !legalAccepted) || (mode === "reset-password" && (recoveryReady !== true || recoveryMfaState === "checking" || recoveryMfaState === "error" || (recoveryMfaState === "challenge_required" && recoveryMfaCode.length !== 6)))}>{busy || configured === null || (mode === "reset-password" && (recoveryReady === null || recoveryMfaState === "checking")) ? "Please wait…" : submitLabel}</button>
      </form>
      {mode === "signin" && <button className="auth-switch" type="button" onClick={() => changeMode("request-reset")}>Forgot your password?</button>}
      {mode === "request-reset" && <button className="auth-switch" type="button" onClick={() => changeMode("signin")}>Back to sign in</button>}
      {mode === "verify-recovery" && <button className="auth-switch" type="button" onClick={() => changeMode("request-reset")}>Send a new recovery email</button>}
      {mode === "verify-recovery" && <button className="auth-switch auth-switch-secondary" type="button" onClick={() => changeMode("signin")}>Back to sign in</button>}
      {mode === "reset-password" && recoveryReady === false && <button className="auth-switch" type="button" onClick={() => changeMode("request-reset")}>Request a new reset link</button>}
      {mode === "verify-signup" && <button className="auth-switch" type="button" onClick={() => changeMode("signup")}>Use a different email address</button>}
      {(mode === "signup" || mode === "signin") && <button className="auth-switch auth-switch-secondary" type="button" onClick={() => { changeMode(mode === "signup" ? "signin" : "signup"); setSiteKey(""); }}>
        {mode === "signup" ? "Already have an account? Sign in" : "New to Vanteloq? Create an account"}
      </button>}
    </section>
  </div>;
}
