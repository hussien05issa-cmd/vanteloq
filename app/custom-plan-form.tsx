"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { FieldLabel, FormInput, FormTextarea, FormLegend, RequiredMark } from "./form-primitives";
import TurnstileField from "./turnstile-field";

export default function CustomPlanForm({ purpose = "custom_plan" }: { purpose?: "custom_plan" | "contact" | "demo" | "advisory" }) {
  const demo = purpose === "demo";
  const advisory = purpose === "advisory";
  const [config, setConfig] = useState<{ siteKey: string; action: string } | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [reference, setReference] = useState("");
  const [error, setError] = useState(""), [token, setToken] = useState(""), [reset, setReset] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const submissionId = useRef("");
  const consentSubmittedAt = useRef("");
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
    if (!submissionId.current) {
      submissionId.current = crypto.randomUUID();
      consentSubmittedAt.current = new Date().toISOString();
    }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/v1/custom-plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        purpose, name: fields.get("name"), email: fields.get("email"), company: fields.get("company"), phone: fields.get("phone"), needs: fields.get("needs"), website: fields.get("website"), consent: fields.get("consent") === "on", noticeVersion: demo ? "demo-request-v2" : advisory ? "advisory-inquiry-v1" : "custom-plan-contact-v2", ...((demo || advisory) ? { consentSubmittedAt: consentSubmittedAt.current } : {}), submissionId: submissionId.current, token,
      }) });
      const result = await response.json();
      if (result.error?.code === "INQUIRY_CONSENT_TIME_INVALID") submissionId.current = "";
      if (!response.ok || result.sent !== true || result.reference !== submissionId.current) throw new Error(result.error?.message ?? "Delivery could not be confirmed. Please retry.");
      setReference(result.reference);
      window.dispatchEvent(new CustomEvent("vanteloq:public-conversion", { detail: demo ? "demo_request_sent" : advisory ? "advisory_inquiry_sent" : "inquiry_sent" }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Delivery could not be confirmed. Please retry."); }
    finally { setBusy(false); setToken(""); setReset(value => value + 1); }
  }
  if (reference) return <section className="custom-plan-success" role="status"><span aria-hidden="true">✓</span><h2>{demo ? "Your demo request is with us." : advisory ? "Your advisory request is with us." : "Your request is with us."}</h2><p>{demo ? "Our team will review your business details and contact you to arrange a time. Your appointment is confirmed only after we agree on a time with you. The demo is free, with no obligation and no payment required." : advisory ? "We’ll review your business priority and respond using the contact details you provided. This request does not create a paid engagement." : <>We’ll review your message and respond using the contact details you provided.{purpose === "custom_plan" && " Your subscription has not changed, and no payment was taken."}</>}</p><p className="custom-plan-reference">Request reference: <strong>{reference}</strong></p><Link href={purpose === "custom_plan" ? "/pricing" : advisory ? "/advisory" : "/"}>{purpose === "custom_plan" ? "Return to plans" : advisory ? "Return to Vanteloq Advisory" : "Return to Vanteloq"} →</Link></section>;
  return <form aria-label={demo ? "Vanteloq demo request" : advisory ? "Vanteloq Advisory inquiry" : purpose === "custom_plan" ? "Custom plan inquiry" : "Contact inquiry"} className={`custom-plan-form${demo ? " demo-request-form" : ""}`} onSubmit={event => void submit(event)} onChange={() => { if (!busy) { submissionId.current = ""; consentSubmittedAt.current = ""; } }}>
    <FormLegend/>
    <div className="custom-plan-fields">
      <label><FieldLabel>Your Name</FieldLabel><FormInput aria-label="Your Name" name="name" autoComplete="name" required maxLength={100} disabled={busy}/></label>
      <label><FieldLabel>{purpose === "contact" ? "Email Address" : "Work Email"}</FieldLabel><FormInput aria-label={purpose === "contact" ? "Email Address" : "Work Email"} name="email" type="email" autoComplete="email" required maxLength={254} disabled={busy}/></label>
      <label><FieldLabel required={purpose === "custom_plan"}>Business Name</FieldLabel><FormInput aria-label={purpose === "custom_plan" ? "Business Name" : "Business Name (Optional)"} name="company" autoComplete="organization" required={purpose === "custom_plan"} maxLength={160} disabled={busy}/></label>
      <label><FieldLabel required={false}>Phone</FieldLabel><FormInput aria-label="Phone (Optional)" name="phone" type="tel" autoComplete="tel" maxLength={60} disabled={busy}/></label>
    </div>
    <label><FieldLabel required={!demo}>{demo ? "Your Business and Demo Questions" : advisory ? "What Would You Like to Improve?" : purpose === "custom_plan" ? "Business Requirements" : "Your Message"}</FieldLabel><FormTextarea aria-label={demo ? "Your Business and Demo Questions (Optional)" : advisory ? "What Would You Like to Improve?" : purpose === "custom_plan" ? "Business Requirements" : "Your Message"} aria-describedby={demo ? "demo-request-hint" : advisory ? "advisory-request-hint" : undefined} name="needs" required={!demo} minLength={demo ? undefined : 20} maxLength={3000} rows={6} disabled={busy} placeholder={demo ? "If useful, tell us about your business, your current POS or systems, and what you would like to explore. You can include preferred days, times and your time zone." : advisory ? "Tell us what is working, what is getting in the way and the decision or improvement you want to make." : purpose === "custom_plan" ? "Tell us about your locations, team size, current systems and the workflows you want to improve." : "Describe your question or privacy request. If relevant, include your request receipt number."}/></label>
    <p className="custom-plan-hint" id={demo ? "demo-request-hint" : advisory ? "advisory-request-hint" : undefined}>{demo ? "Demo interests, availability and time zone are optional. Share business requirements only. " : advisory ? "Share the business context needed to understand your priority. " : "Share business requirements only. "}Please leave out passwords, bank details and customer records.</p>
    <div className="custom-plan-honeypot" aria-hidden="true"><label>Website<input name="website" tabIndex={-1} autoComplete="off"/></label></div>
    {(demo || advisory) && <p className="custom-plan-hint">Vanteloq is operated by Vanteloq Inc. Cloudflare Turnstile processes limited browser and security signals to protect this form. Your inquiry is sent to our team through Resend, which may process it in the United States. Questions about this collection? <Link href="/contact">Contact our Privacy Officer</Link>.</p>}
    {advisory && <p className="custom-plan-hint">Vanteloq Advisory provides business advisory and implementation support. It does not provide legal, tax, audit, assurance, investment or other regulated professional advice.</p>}
    <label className="custom-plan-consent"><input name="consent" type="checkbox" required disabled={busy}/><span>{demo ? "I agree that Vanteloq Inc. may use the details I provide to respond to my request and schedule a Vanteloq demo." : advisory ? "I agree that Vanteloq Inc. may use the details I provide to respond to my Vanteloq Advisory inquiry." : "I agree that Vanteloq Inc. may use these details to respond to this inquiry."} {(demo || advisory) && "This does not subscribe me to marketing. "}<Link href="/privacy">Privacy Policy</Link>{(demo || advisory) && <> · <Link href="/subprocessors">Service providers</Link></>} <RequiredMark/></span></label>
    {loading && <p role="status">Preparing the secure form…</p>}
    {config && <TurnstileField siteKey={config.siteKey} action={config.action} resetSignal={reset} onToken={setToken} onError={setError}/>}
    {error && <p className="custom-plan-error" role="alert">{error}</p>}
    {!config && !loading ? <button type="button" onClick={() => { setLoading(true); setError(""); setAttempt(value => value + 1); }}>Retry loading the form</button> : <button type="submit" disabled={busy || !token || !config}>{busy ? "Sending your request…" : demo ? "Request a Free Demo" : advisory ? "Start the Conversation" : purpose === "custom_plan" ? "Send Custom Plan Request" : "Send Message"}</button>}
    <small>{demo ? "$0, no obligation and no card required. Our team will contact you to arrange a time." : advisory ? "Your details are used to respond to and manage this inquiry as described in the Privacy Policy. No paid engagement, subscription or payment is created. Any paid work begins only after a written scope and fee are agreed." : purpose === "custom_plan" ? "No payment details required. Any custom scope and price are agreed before checkout." : "Your details are used to respond to this request. This does not subscribe you to marketing."}</small>
  </form>;
}
