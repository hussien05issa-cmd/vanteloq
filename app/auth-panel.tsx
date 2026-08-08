"use client";

import { type FormEvent, useState } from "react";
import ProductBrandLogo from "./product-brand-logo";
import { isSupabaseAuthConfigured, supabase } from "./supabase-browser";

export default function AuthPanel({ close }: { close: () => void }) {
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return setMessage("Account service is not configured yet.");
    setBusy(true);
    setMessage("");
    const result = mode === "signup"
      ? await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: name.trim() },
            emailRedirectTo: `${window.location.origin}/`,
          },
        })
      : await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (result.error) return setMessage(result.error.message);
    if (mode === "signup" && !result.data.session) {
      setMessage("Check your email to verify the account, then return here to sign in.");
      return;
    }
    window.location.reload();
  }

  return <div className="auth-backdrop" role="dialog" aria-modal="true" aria-labelledby="auth-title">
    <section className="auth-panel">
      <header><ProductBrandLogo product="vanteloq"/><button type="button" onClick={close} aria-label="Close account form">×</button></header>
      <small>SECURE VANTELOQ ACCOUNT</small>
      <h2 id="auth-title">{mode === "signup" ? "Create your workspace" : "Welcome back"}</h2>
      <p>{mode === "signup" ? "Start with a verified owner account. Business data stays separated by workspace." : "Sign in with your verified Vanteloq account."}</p>
      {!isSupabaseAuthConfigured && <div className="auth-message error">Account service is temporarily unavailable.</div>}
      <form onSubmit={submit}>
        {mode === "signup" && <label>Full name<input autoComplete="name" value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={120} required/></label>}
        <label>Email address<input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required/></label>
        <label>Password<input type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={event => setPassword(event.target.value)} minLength={8} required/></label>
        {message && <div className="auth-message" aria-live="polite">{message}</div>}
        <button className="auth-submit" disabled={busy || !isSupabaseAuthConfigured}>{busy ? "Please wait…" : mode === "signup" ? "Create secure account" : "Sign in"}</button>
      </form>
      <button className="auth-switch" type="button" onClick={() => { setMode(value => value === "signup" ? "signin" : "signup"); setMessage(""); }}>
        {mode === "signup" ? "Already have an account? Sign in" : "New to Vanteloq? Create an account"}
      </button>
    </section>
  </div>;
}
