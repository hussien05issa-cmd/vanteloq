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

/** Existing subscribers can always withdraw; the launch does not solicit newsletters. */
export default function MarketingPreferences({ placement = "settings" }: { placement?: "onboarding" | "settings" }) {
  const [data, setData] = useState<MarketingPreference | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    const response = await apiFetch("/api/v1/communications/preferences", { signal: AbortSignal.timeout(8_000) });
    const next = await response.json() as MarketingPreference;
    if (!response.ok) throw new Error(errorMessage(next, "Email preferences could not load."));
    return next;
  }, []);
  useEffect(() => {
    let active = true;
    void load().then(next => { if (active) setData(next); }, () => { if (active) { setFailed(true); setMessage("Email preferences could not load. You can use an existing email’s unsubscribe link or retry."); } });
    return () => { active = false; };
  }, [load]);
  async function unsubscribe() {
    if (!data || busy) return;
    setBusy(true); setFailed(false); setMessage("");
    try {
      const response = await apiFetch("/api/v1/communications/preferences", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(8_000),
        body: JSON.stringify({ selected: false, source: placement, noticeVersion: data.config.noticeVersion, noticeHash: data.config.noticeHash, revision: data.revision }),
      });
      const next = await response.json() as MarketingPreference;
      if (!response.ok) throw new Error(errorMessage(next, "Your preference was not saved. Please try again."));
      setData(next); setMessage("Email updates are off. Account and security messages are unchanged.");
    } catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : "Please try again."); }
    finally { setBusy(false); }
  }
  if (!message && !data?.subscribed) return null;
  return <section className="marketing-preferences" aria-label="Email preferences">
    {data?.subscribed && <><h3>Email preferences</h3><p>You can withdraw your previously saved email subscription.</p><button type="button" disabled={busy} onClick={() => void unsubscribe()}>{busy ? "Saving…" : "Unsubscribe"}</button></>}
    {message && <p role={failed ? "alert" : "status"}>{message}</p>}
    {failed && !data && <button type="button" onClick={() => void load().then(next => { setData(next); setMessage(""); setFailed(false); }, () => setMessage("Email preferences remain unavailable. Please try again later."))}>Retry</button>}
  </section>;
}
