"use client";
import { useCallback, useEffect, useId, useState } from "react";
import { apiFetch } from "./supabase-browser";
import { MARKETING_PURPOSE, MARKETING_WITHDRAWAL, type MarketingConfig, type MarketingPreference } from "../shared/communications";

function errorMessage(data: unknown, fallback: string) {
  const message = (data as { error?: { message?: unknown } } | null)?.error?.message;
  return typeof message === "string" ? message : fallback;
}

export function MarketingChoice({ config, selected, change, disabled = false }: {
  config: MarketingConfig;
  selected: boolean;
  change: (value: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return <div className="marketing-consent-choice">
    <label htmlFor={id} className="marketing-consent-check">
      <input id={id} type="checkbox" checked={selected} disabled={disabled || !config.available} onChange={event => change(event.target.checked)} aria-describedby={`${id}-notice`} />
      <span><strong>News and Product Updates <small>(Optional)</small></strong><span>{MARKETING_PURPOSE}</span></span>
    </label>
    <p id={`${id}-notice`} className="marketing-consent-notice">
      {MARKETING_WITHDRAWAL}
      <span>{config.senderName}. {config.postalAddress} <a href={config.contactUrl} target="_blank" rel="noreferrer">Contact Us</a> · <a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a></span>
    </p>
  </div>;
}

export function SignupMarketingChoice({ selected, change, configure }: {
  selected: boolean;
  change: (value: boolean) => void;
  configure: (value: MarketingConfig | null) => void;
}) {
  const [config, setConfig] = useState<MarketingConfig | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/v1/communications/config", { signal: controller.signal, credentials: "same-origin" })
      .then(async response => { if (!response.ok) return; const value = await response.json() as MarketingConfig; setConfig(value); configure(value); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [configure]);
  // Do not solicit consent without the complete, configured sender notice.
  if (!config?.available) return null;
  return <MarketingChoice config={config} selected={selected} change={change} />;
}

export async function saveSignupMarketingChoice(email: string, selected: boolean, config: MarketingConfig | null) {
  if (!config?.available) return true;
  try {
    const response = await fetch("/api/v1/communications/signup-intent", {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(5_000),
      body: JSON.stringify({ email, selected, noticeVersion: config.noticeVersion, noticeHash: config.noticeHash }),
    });
    return response.ok;
  } catch { return false; }
}

export default function MarketingPreferences({ placement = "settings" }: { placement?: "onboarding" | "settings" }) {
  const [data, setData] = useState<MarketingPreference | null>(null);
  const [selected, setSelected] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    const response = await apiFetch("/api/v1/communications/signup-intent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "claim" }), signal: AbortSignal.timeout(8_000) });
    const next = await response.json() as MarketingPreference;
    if (!response.ok) throw new Error(errorMessage(next, "Email preferences could not load. You can continue and try again in Settings."));
    return next;
  }, []);
  const showPreference = useCallback((next: MarketingPreference) => {
    setMessage(""); setError(false);
    setData(next); setSelected(next.subscribed); setEditing(!next.chosen || placement === "settings");
  }, [placement]);
  const showLoadError = useCallback((caught: unknown) => {
    setError(true); setMessage(caught instanceof Error ? caught.message : "Email preferences could not load. You can continue without subscribing.");
  }, []);
  useEffect(() => {
    let active = true;
    void load().then(next => { if (active) showPreference(next); }, caught => { if (active) showLoadError(caught); });
    return () => { active = false; };
  }, [load, showPreference, showLoadError]);
  async function save(nextSelected = selected) {
    if (!data) return;
    setBusy(true); setMessage(""); setError(false);
    try {
      const response = await apiFetch("/api/v1/communications/preferences", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(8_000),
        body: JSON.stringify({ selected: nextSelected, source: placement, noticeVersion: data.config.noticeVersion, noticeHash: data.config.noticeHash, revision: data.revision }),
      });
      const next = await response.json() as MarketingPreference;
      if (!response.ok) throw new Error(errorMessage(next, "Your email preference was not saved. Please try again."));
      setData(next); setSelected(next.subscribed); setEditing(placement === "settings");
      setMessage(next.subscribed ? "Email updates are on. You can unsubscribe at any time." : "Email updates are off. Your account and service messages are unchanged.");
    } catch (caught) {
      setError(true); setMessage(caught instanceof Error ? caught.message : "Your preference was not saved. Please try again.");
    } finally { setBusy(false); }
  }
  if (!data && !message) return <div className="marketing-consent-loading" role="status"><span />Loading email preferences…</div>;
  if (data && !data.config.available && !data.subscribed) return placement === "onboarding" ? null : <section className="marketing-preferences"><h3>News and Product Updates</h3><p>Email updates are not available yet. You are not subscribed.</p></section>;
  return <section className="marketing-preferences" aria-label="Marketing Email Preferences">
    {data && !editing ? <div className="marketing-consent-saved"><div><strong>News and Product Updates</strong><p>{data.subscribed ? "Your preference is saved. Email updates are on." : "Your preference is saved. Email updates are off."}</p></div><button type="button" onClick={() => setEditing(true)}>Change</button></div> : data && <>
      {data.config.available ? <MarketingChoice config={data.config} selected={selected} change={value => { setSelected(value); if (placement === "onboarding") void save(value); }} disabled={busy || data.status === "suppressed"} /> : <label className="marketing-consent-check"><input type="checkbox" checked={selected} onChange={event => setSelected(event.target.checked)} disabled={busy} /><span><strong>Receive News and Product Updates</strong><span>You can turn off your existing subscription.</span></span></label>}
      {data.status === "suppressed" ? <p>Email delivery is paused for this address. <a href="/contact">Contact support</a> to review it.</p> : (placement === "settings" || !data.config.available) && <button type="button" className="marketing-consent-save" onClick={() => void save()} disabled={busy || (selected && !data.config.available)}>{busy ? "Saving…" : "Save Email Preference"}</button>}
      {busy && placement === "onboarding" && <p role="status">Saving your email preference…</p>}
      {placement === "onboarding" && !data.chosen && <p className="marketing-consent-hint">Or continue setup without subscribing.</p>}
    </>}
    {message && <p role={error ? "alert" : "status"} className={error ? "marketing-consent-error" : "marketing-consent-status"}>{message}</p>}
    {error && <button type="button" onClick={() => void load().then(showPreference, showLoadError)} disabled={busy}>Refresh Preferences</button>}
  </section>;
}
