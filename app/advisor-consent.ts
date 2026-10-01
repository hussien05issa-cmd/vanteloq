"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ADVISOR_CONSENT_NOTICE_VERSION, PRIVACY_POLICY_VERSION } from "../domain/privacy-controls";
const empty = { analysis: false, help: false };
/** Kept by the signed-in workspace, never browser storage. The server authorizes every message. */
export function useAdvisorConsent(fetcher: typeof fetch, scope: string, enabled = true) {
  const [saved, setSaved] = useState({ scope: "", value: empty, checkedAt: 0 });
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const request = useRef<AbortController | null>(null), latest = useRef(saved);
  const key = `${scope}:${ADVISOR_CONSENT_NOTICE_VERSION}:${PRIVACY_POLICY_VERSION}`;
  const load = useCallback(async (accepted?: boolean, purpose: "analysis" | "help" = "analysis", background = false) => {
    if (background && request.current) return;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    const known = latest.current.scope === key && latest.current.checkedAt > 0;
    if (!background || !known) setBusy(true);
    setError("");
    if (accepted === false) { latest.current = {scope:key,value:empty,checkedAt:0}; setSaved(latest.current); }
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetcher("/api/v1/advisor/consent", {
        method: accepted === undefined ? "GET" : accepted ? "POST" : "DELETE", cache: "no-store", signal: controller.signal,
        ...(accepted ? { headers: { "content-type": "application/json" }, body: JSON.stringify({ accepted:true,purpose,noticeVersion:ADVISOR_CONSENT_NOTICE_VERSION,privacyPolicyVersion:PRIVACY_POLICY_VERSION }) } : {}),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Your data-use setting could not be saved.");
      if (request.current === controller && !controller.signal.aborted) {
        latest.current = {scope:key,value:{analysis:payload.consent?.analysis===true,help:payload.consent?.help===true},checkedAt:Date.now()};
        setSaved(latest.current);
      }
    } catch (failure) {
      if (request.current === controller) {
        latest.current = {scope:key,value:empty,checkedAt:0}; setSaved(latest.current);
        setError(controller.signal.aborted ? "Your data-use setting could not be checked. Retry in Settings." : failure instanceof Error ? failure.message : "Your data-use setting is unavailable.");
      }
    } finally { clearTimeout(timer); if(request.current===controller){request.current=null;setBusy(false);} }
  }, [fetcher,key]);
  const refresh = useCallback((accepted?:boolean,purpose:"analysis"|"help"="analysis") => load(accepted,purpose), [load]);
  const invalidate = useCallback(() => { latest.current={scope:key,value:empty,checkedAt:0};setSaved(latest.current);return load(); },[key,load]);
  useEffect(() => {
    if(!enabled || !scope) return;
    const refreshIfDue = () => { const known=latest.current.scope===key && latest.current.checkedAt>0; if(!known || Date.now()-latest.current.checkedAt>60_000) void load(undefined,"analysis",known); };
    refreshIfDue();
    window.addEventListener("focus",refreshIfDue);
    return () => {
      window.removeEventListener("focus", refreshIfDue);
      if (request.current) {
        request.current.abort(); request.current = null;
        latest.current = { scope: key, value: empty, checkedAt: 0 };
        setSaved(latest.current);
      }
      setBusy(false);
    };
  },[enabled,scope,key,load]);
  return {scope,consent:saved.scope===key?saved.value:empty,busy:busy||(enabled&&(!saved.checkedAt||saved.scope!==key)&&!error),error,refresh,invalidate};
}

export function useAdvisorAvailability(fetcher:typeof fetch, scope:string, enabled:boolean) {
  const [state,setState]=useState({scope:"",checkedAt:0,providers:{openai:{ready:false,reason:"Preparing Vanteloq AI." as string|null}}});
  useEffect(()=>{
    if(!enabled||!scope||(state.scope===scope&&Date.now()-state.checkedAt<60_000))return;
    let active=true;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    void fetcher("/api/v1/advisor/chat",{signal:controller.signal}).then(async response=>{if(!response.ok)throw Error("Unavailable");return response.json();}).then(payload=>{if(!controller.signal.aborted&&payload.providers)setState({scope,checkedAt:Date.now(),providers:payload.providers});}).catch(()=>{if(active)setState({scope,checkedAt:Date.now(),providers:{openai:{ready:false,reason:"AI availability could not be checked. Reopen Vanteloq AI to retry."}}});}).finally(()=>clearTimeout(timer));
    return()=>{active=false;controller.abort();clearTimeout(timer);};
  },[enabled,fetcher,scope,state.scope,state.checkedAt]);
  return {providers:state.scope===scope?state.providers:{openai:{ready:false,reason:"Preparing Vanteloq AI."}},loading:state.scope!==scope};
}
