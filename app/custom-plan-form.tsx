"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import TurnstileField from "./turnstile-field";

export default function CustomPlanForm({ purpose = "custom_plan" }: { purpose?: "custom_plan" | "contact" }) {
  const [config, setConfig] = useState<{ siteKey: string; action: string } | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [sent, setSent] = useState(false);
  const [error, setError] = useState(""), [token, setToken] = useState(""), [reset, setReset] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const submissionId = useRef("");
  useEffect(() => {
    let active = true;
    void fetch("/api/v1/custom-plan", { cache: "no-store" }).then(async response => {
      const data = await response.json();
      if (!response.ok || !data.configured || !data.siteKey) throw new Error("The inquiry form is temporarily unavailable. Please retry in a moment.");
      if (active) setConfig({ siteKey: data.siteKey, action: data.action });
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "The form could not load."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !token) return;
    const fields = new FormData(event.currentTarget);
    if (!submissionId.current) submissionId.current = crypto.randomUUID();
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/v1/custom-plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        purpose, name: fields.get("name"), email: fields.get("email"), company: fields.get("company"), phone: fields.get("phone"), needs: fields.get("needs"), website: fields.get("website"), consent: fields.get("consent") === "on", noticeVersion: "custom-plan-contact-v1", submissionId: submissionId.current, token,
      }) });
      const result = await response.json();
      if (!response.ok || result.sent !== true) throw new Error(result.error?.message ?? "Delivery could not be confirmed. Please retry.");
      setSent(true);
      window.dispatchEvent(new CustomEvent("vanteloq:public-conversion", { detail: "inquiry_sent" }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Delivery could not be confirmed. Please retry."); }
    finally { setBusy(false); setToken(""); setReset(value => value + 1); }
  }
  if (sent) return <section className="custom-plan-success" role="status"><span aria-hidden="true">✓</span><h2>Your request is with us.</h2><p>We’ll review your message and respond using the contact details you provided.{purpose === "custom_plan" && " Your subscription has not changed, and no payment was taken."}</p><Link href={purpose === "custom_plan" ? "/pricing" : "/"}>{purpose === "custom_plan" ? "Return to plans" : "Return to Vanteloq"} →</Link></section>;
  return <form className="custom-plan-form" onSubmit={event => void submit(event)} onChange={() => { if (!busy) submissionId.current = ""; }}>
    <div className="custom-plan-fields">
      <label>Your name<input name="name" autoComplete="name" required maxLength={100} disabled={busy}/></label>
      <label>{purpose === "custom_plan" ? "Work email" : "Email address"}<input name="email" type="email" autoComplete="email" required maxLength={254} disabled={busy}/></label>
      <label><span className="custom-plan-field-title">Business name{purpose === "contact" && <small> (optional)</small>}</span><input name="company" autoComplete="organization" required={purpose === "custom_plan"} maxLength={160} disabled={busy}/></label>
      <label><span className="custom-plan-field-title">Phone <small>(optional)</small></span><input name="phone" type="tel" autoComplete="tel" maxLength={60} disabled={busy}/></label>
    </div>
    <label>{purpose === "custom_plan" ? "What does your business need?" : "How can we help?"}<textarea name="needs" required minLength={20} maxLength={3000} rows={6} disabled={busy} placeholder={purpose === "custom_plan" ? "Tell us about your locations, team size, current systems and the workflows you want to improve." : "Describe your question or privacy request. If relevant, include your request receipt number."}/></label>
    <p className="custom-plan-hint">Share business requirements only. Please leave out passwords, bank details and customer records.</p>
    <div className="custom-plan-honeypot" aria-hidden="true"><label>Website<input name="website" tabIndex={-1} autoComplete="off"/></label></div>
    <label className="custom-plan-consent"><input name="consent" type="checkbox" required disabled={busy}/><span>I agree that Vanteloq, operated by LexEdge Consulting, may use these details to respond to this inquiry. <Link href="/privacy">Privacy policy</Link></span></label>
    {loading && <p role="status">Preparing the secure form…</p>}
    {config && <TurnstileField siteKey={config.siteKey} action={config.action} resetSignal={reset} onToken={setToken} onError={setError}/>}
    {error && <p className="custom-plan-error" role="alert">{error}</p>}
    {!config && !loading ? <button type="button" onClick={() => { setLoading(true); setError(""); setAttempt(value => value + 1); }}>Retry loading the form</button> : <button type="submit" disabled={busy || !token || !config}>{busy ? "Sending your request…" : purpose === "custom_plan" ? "Send custom plan request" : "Send message"}</button>}
    <small>{purpose === "custom_plan" ? "No payment details required. Any custom scope and price are agreed before checkout." : "Your details are used to respond to this request. This does not subscribe you to marketing."}</small>
  </form>;
}
