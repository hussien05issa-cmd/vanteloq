"use client";
import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import ProductBrandLogo from "../../product-brand-logo";
export default function UnsubscribeForm() {
  const token = useSearchParams().get("token") ?? "";
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  async function unsubscribe() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/v1/communications/unsubscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }), signal: AbortSignal.timeout(10_000) });
      const data = await response.json() as { unsubscribed?: boolean; error?: { message?: string } };
      if (!response.ok || data.unsubscribed !== true) throw new Error(data.error?.message || "We could not save your choice. Please try again.");
      setDone(true); window.history.replaceState(null, "", "/email/unsubscribe");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "We could not save your choice. Please try again."); }
    finally { setBusy(false); }
  }
  return <main className="email-unsubscribe-shell">
    <ProductBrandLogo product="vanteloq" />
    <h1>{done ? "You’re Unsubscribed" : "Unsubscribe From Email Updates"}</h1>
    <p>{done ? "You will no longer receive Vanteloq news, business tips or offers at this email address. Your account and essential service messages are unchanged." : "Turn off Vanteloq news, business tips and offers. You do not need to sign in."}</p>
    {!done && <button type="button" onClick={() => void unsubscribe()} disabled={busy || !/^[a-f0-9]{64}$/.test(token)}>{busy ? "Saving…" : "Unsubscribe"}</button>}
    {!done && !/^[a-f0-9]{64}$/.test(token) && <p role="alert">This link is incomplete. Open the full unsubscribe link in your email.</p>}
    {error && <p role="alert">{error}</p>}
    <p>Need help? <Link href="/contact">Contact Vanteloq</Link>.</p>
    {done && <Link href="/">Return to Vanteloq</Link>}
  </main>;
}
