"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import ProductBrandLogo from "../../product-brand-logo";
import { getSupabase } from "../../supabase-browser";

export default function DeletionProgress() {
  const running = useRef(false);
  const [status, setStatus] = useState("Loading the protected deletion session…");
  const [receipt, setReceipt] = useState("");
  const [complete, setComplete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retained, setRetained] = useState(false);
  const resume = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      const saved = sessionStorage.getItem("vanteloq:deletion-session");
      if (!saved) throw new Error("No deletion session is saved in this browser tab. Return to Settings to begin, or contact the Privacy Officer with your receipt number. Do not share passwords or verification codes.");
      const session = JSON.parse(saved);
      setReceipt(session.jobId);
      setStatus("Processing your confirmed deletion. Keep this tab open. Completion has not yet been confirmed.");
      const response = await fetch("/api/v1/account/deletion/resume", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(session), credentials: "omit", cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Deletion is not confirmed. You can retry safely using this saved session.");
      if (body.deleted !== true) { setStatus(body.message ?? "Deletion is still processing. Check again shortly."); return; }
      sessionStorage.setItem("vanteloq:deletion-session", JSON.stringify({ ...session, complete: true }));
      setComplete(true);
      setRetained(body.identityRetained === true);
      setStatus("Vanteloq deletion is complete. Save your receipt number for your records.");
      // Only end this browser's Vanteloq session; never sign out every service.
      const client = await getSupabase();
      await client?.auth.signOut({ scope: "local" }).catch(() => undefined);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Deletion is not confirmed. Please retry.");
    } finally { running.current = false; setBusy(false); }
  }, []);
  useEffect(() => {
    const start = window.setTimeout(() => { void resume(); }, 0);
    return () => window.clearTimeout(start);
  }, [resume]);
  return <main style={{ maxWidth: 720, margin: "64px auto", padding: "32px 24px", color: "#142640" }}>
    <div style={{ width: 56 }}><Link href="/" aria-label="Vanteloq home"><ProductBrandLogo product="vanteloq" priority /></Link></div>
    <h1>{complete ? "Deletion complete" : "Your deletion status"}</h1>
    <p role="status" aria-live="polite">{status}</p>
    {receipt && <p>Receipt number: <code style={{ overflowWrap: "anywhere" }}>{receipt}</code></p>}
    {complete && retained && <p>Your shared sign-in remains available for another workspace or the private console. Deletion did not remove those separate services.</p>}
    {!complete && <button type="button" disabled={busy} onClick={() => void resume()} style={{ padding: "14px 22px", margin: "16px 0", borderRadius: 8, border: 0, background: "#1558db", color: "white" }}>{busy ? "Processing…" : "Retry or check status"}</button>}
    <p><a href="/contact">Contact the Privacy Officer</a> if the process cannot finish. Share only the receipt number, not your private deletion session key.</p>
    <p><Link href="/privacy#retention">Retention and deletion information</Link> · <Link href="/">Return to Vanteloq</Link></p>
  </main>;
}
