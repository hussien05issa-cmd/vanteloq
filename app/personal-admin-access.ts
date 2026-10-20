"use client";

import { useEffect, useState } from "react";
import { apiFetch, getSupabase } from "./supabase-browser";
import { createPersonalAdminEligibilityController, type PersonalAdminEligibility } from "../domain/personal-admin-eligibility";

function pageScope(account: string): string {
  return `${account}:${typeof window === "undefined" ? "" : new URL(window.location.href).searchParams.get("workspace") ?? ""}`;
}

/** Server eligibility only. Never infer personal admin from email or billing in the browser. */
export function usePersonalAdminEligibility(account: string) {
  const scope = pageScope(account);
  const [eligibility, setEligibility] = useState<PersonalAdminEligibility & { scope: string } | null>(null);
  useEffect(() => {
    if (!account) return;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    const controller = createPersonalAdminEligibilityController({
      scope, readScope: () => pageScope(account),
      onChange: next => setEligibility({ ...next, scope }),
      checkAccess: async signal => {
        const response = await apiFetch("/api/v1/internal/personal-admin", { cache: "no-store", headers: { Accept: "application/json" }, signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) });
        const body = await response.json();
        return response.ok && body.personalAdmin === true;
      },
    });
    const check = () => { void controller.check(); };
    const clear = () => controller.invalidate();
    const expired = clear;
    const visible = () => { if (document.visibilityState === "visible") void check(); };
    void controller.check(true);
    void getSupabase().then(client => {
      if (disposed || !client) return;
      const { data } = client.auth.onAuthStateChange((event, session) => {
        controller.authChanged(event !== "SIGNED_OUT" && Boolean(session));
      });
      unsubscribe = () => data.subscription.unsubscribe();
    }).catch(() => { if (!disposed) expired(); });
    window.addEventListener("focus", check);
    window.addEventListener("popstate", check);
    window.addEventListener("pagehide", clear);
    window.addEventListener("pageshow", check);
    window.addEventListener("vanteloq-session-expired", expired);
    document.addEventListener("visibilitychange", visible);
    return () => {
      disposed = true; controller.dispose(); unsubscribe?.();
      window.removeEventListener("focus", check);
      window.removeEventListener("popstate", check);
      window.removeEventListener("pagehide", clear);
      window.removeEventListener("pageshow", check);
      window.removeEventListener("vanteloq-session-expired", expired);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [account, scope]);
  const current = eligibility?.scope === scope ? eligibility : null;
  return { allowed: Boolean(account) && current?.allowed === true, checking: Boolean(account) && (!current || current.checking) };
}
