"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { apiFetch, currentSession, getSupabase } from "./supabase-browser";
import { SESSION_IDLE_MS, SESSION_WARNING_MS, sessionRemaining } from "../shared/session-policy";
import WorkspaceSkeleton from "./workspace-skeleton";

export default function SessionTimeout({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"loading" | "active" | "warning" | "expired" | "error">("loading");
  const [seconds, setSeconds] = useState(120);
  const [canExtend, setCanExtend] = useState(true);
  const resume = useRef<() => void>(() => undefined);
  useEffect(() => {
    let disposed = false, ending = false, timer = 0, lastActivity = Date.now(), absoluteExpiry = 0, key = "", lastPersisted = 0, lastHeartbeat = Date.now();
    let removeListeners = () => undefined as void;
    const end = async () => {
      if (ending || disposed) return;
      ending = true;
      setState("expired");
      // Hide private content before waiting on the network or auth SDK.
      try { await apiFetch("/api/v1/session", { method: "DELETE", signal: AbortSignal.timeout(5000) }); } catch { /* Expired leases already reject access. */ }
      const client = await getSupabase();
      await client?.auth.signOut({ scope: "local" }).catch(() => undefined);
    };
    const tick = () => {
      if (disposed || ending) return;
      const remaining = sessionRemaining(Date.now(), lastActivity, absoluteExpiry);
      if (!remaining) { void end(); return; }
      setSeconds(Math.ceil(remaining / 1000));
      setCanExtend(absoluteExpiry - Date.now() > SESSION_WARNING_MS);
      setState(remaining <= SESSION_WARNING_MS ? "warning" : "active");
      if (Date.now() - lastHeartbeat >= 60_000 && lastActivity > lastHeartbeat && Date.now() - lastActivity < SESSION_IDLE_MS) {
        lastHeartbeat = Date.now();
        void apiFetch("/api/v1/session", { method: "POST", signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
      }
    };
    const activity = () => {
      const now = Date.now();
      // An interaction after expiry must not revive the session.
      if (!sessionRemaining(now, lastActivity, absoluteExpiry)) { void end(); return; }
      lastActivity = now;
      if (now - lastPersisted > 1000) {
        try { localStorage.setItem(key, String(now)); } catch { /* In-memory idle enforcement remains active. */ }
        lastPersisted = now;
      }
      tick();
    };
    const trustedActivity = (event: Event) => { if (event.isTrusted && document.visibilityState === "visible") activity(); };
    const sync = (event: StorageEvent) => {
      if (event.key !== key || !event.newValue) return;
      const now = Date.now(), next = Number(event.newValue);
      if (!sessionRemaining(now, lastActivity, absoluteExpiry)) { void end(); return; }
      if (Number.isFinite(next) && next <= now && next > lastActivity) { lastActivity = next; tick(); }
    };
    const initialize = async () => {
      try {
        const session = await currentSession();
        if (!session) { await end(); return; }
        // This value only namespaces activity between sessions. It is never a credential.
        const payload = JSON.parse(atob(session.access_token.split(".")[1].replaceAll("-", "+").replaceAll("_", "/")));
        key = `vanteloq:activity:${session.user.id}:${String(payload.session_id)}`;
        const response = await apiFetch("/api/v1/session", { signal: AbortSignal.timeout(15_000) });
        if (response.status === 401) { await end(); return; }
        if (!response.ok) throw new Error("Session unavailable");
        const body = await response.json() as { expiresAt: number; lastSeenAt: number; serverTime: number };
        if (!Number.isFinite(body.expiresAt) || !Number.isFinite(body.lastSeenAt) || !Number.isFinite(body.serverTime)) throw new Error("Session unavailable");
        if (disposed) return;
        absoluteExpiry = Date.now() + Math.max(0, body.expiresAt - body.serverTime);
        lastActivity = Date.now() - Math.max(0, body.serverTime - body.lastSeenAt);
        try { const saved = Number(localStorage.getItem(key)); if (saved > 0) lastActivity = Math.min(saved, Date.now()); else localStorage.setItem(key, String(lastActivity)); } catch { /* Storage is optional. */ }
        if (!sessionRemaining(Date.now(), lastActivity, absoluteExpiry)) { await end(); return; }
        for (const name of ["pointerdown", "keydown", "wheel", "touchstart"]) window.addEventListener(name, trustedActivity, { passive: true });
        window.addEventListener("storage", sync);
        window.addEventListener("focus", tick);
        window.addEventListener("vanteloq-session-expired", end);
        document.addEventListener("visibilitychange", tick);
        removeListeners = () => {
          for (const name of ["pointerdown", "keydown", "wheel", "touchstart"]) window.removeEventListener(name, trustedActivity);
          window.removeEventListener("storage", sync); window.removeEventListener("focus", tick);
          window.removeEventListener("vanteloq-session-expired", end); document.removeEventListener("visibilitychange", tick);
        };
        resume.current = () => {
          if (absoluteExpiry - Date.now() <= SESSION_WARNING_MS) { void end(); return; }
          activity(); void apiFetch("/api/v1/session", { method: "POST", signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
        };
        tick();
        timer = window.setInterval(tick, 1000);
      } catch { if (!disposed && !ending) setState("error"); }
    };
    void initialize();
    return () => { disposed = true; window.clearInterval(timer); removeListeners(); };
  }, []);
  if (state === "loading") return <WorkspaceSkeleton label="Checking your secure session"/>;
  if (state === "expired" || state === "error") return <main className="session-status-panel"><h1>{state === "expired" ? "Your session has ended" : "We could not verify your session"}</h1><p>{state === "expired" ? "Sign in again to continue. Your saved work is still available." : "Check your connection and try again."}</p><button onClick={() => window.location.reload()}>{state === "expired" ? "Sign In" : "Try Again"}</button></main>;
  return <>{children}{state === "warning" && <aside className="session-warning" role="status" aria-label="Session expiry warning"><div><strong>{canExtend ? "Still working?" : "Time to sign in again"}</strong><p>Your secure session ends in {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}. Unsaved changes may be lost.</p></div><button onClick={() => resume.current()}>{canExtend ? "Stay Signed In" : "Sign In Again"}</button></aside>}</>;
}
