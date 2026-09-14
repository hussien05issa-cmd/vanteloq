"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ADVISOR_CONSENT_NOTICE_VERSION, PRIVACY_POLICY_VERSION } from "../domain/privacy-controls";

const empty = { analysis: false, help: false };

/** The server receipt is authoritative. Nothing is accepted via browser storage. */
export function useAdvisorConsent(fetcher: typeof fetch, scope: string) {
  const [saved, setSaved] = useState({ scope, value: empty });
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const load = useCallback(async (accepted?: boolean, purpose: "analysis" | "help" = "analysis") => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const timer = setTimeout(() => { controller.abort(); if (request.current === controller) { setBusy(false); setSaved({ scope, value: empty }); setError("Your data-use setting could not be checked. Retry in Settings."); } }, 15_000);
    try {
      const response = await fetcher("/api/v1/advisor/consent", {
        method: accepted === undefined ? "GET" : accepted ? "POST" : "DELETE",
        signal: controller.signal,
        ...(accepted ? { headers: { "content-type": "application/json" }, body: JSON.stringify({ accepted: true, purpose, noticeVersion: ADVISOR_CONSENT_NOTICE_VERSION, privacyPolicyVersion: PRIVACY_POLICY_VERSION }) } : {}),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Your data-use setting could not be saved.");
      if (request.current === controller && !controller.signal.aborted) setSaved({ scope, value: { analysis: payload.consent?.analysis === true, help: payload.consent?.help === true } });
    } catch (failure) {
      if (request.current === controller && !controller.signal.aborted) { setSaved({ scope, value: empty }); setError(failure instanceof Error ? failure.message : "Your data-use setting is unavailable."); }
    } finally { clearTimeout(timer); if (request.current === controller && !controller.signal.aborted) setBusy(false); }
  }, [fetcher, scope]);
  const refresh = useCallback((accepted?: boolean, purpose: "analysis" | "help" = "analysis") => {
    setBusy(true);
    setError("");
    if (accepted === false) setSaved({ scope, value: empty });
    return load(accepted, purpose);
  }, [load, scope]);
  useEffect(() => {
    void load();
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => { window.removeEventListener("focus", onFocus); request.current?.abort(); request.current = null; };
  }, [load, refresh]);
  return { consent: saved.scope === scope ? saved.value : empty, busy: busy || saved.scope !== scope, error, refresh };
}
