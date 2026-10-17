"use client";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "./supabase-browser";
import { loadReceiptEvidence } from "./bookloq-receipt-evidence";

export default function BookLoQReceiptReview({ receipt, transactionLabel, busy, canMatch, close, confirm }: {
  receipt: { id: string; fileName: string };
  transactionLabel: string;
  busy: boolean;
  canMatch: boolean;
  close: () => void;
  confirm: () => Promise<void>;
}) {
  const [preview, setPreview] = useState<{ url: string; type: string } | null>(null);
  const [error, setError] = useState("");
  const [opened, setOpened] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]);
    let objectUrl: string | null = null;
    heading.current?.focus();
    void loadReceiptEvidence(apiFetch, receipt.id, signal).then(blob => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setPreview({ url: objectUrl, type: blob.type });
    }).catch(caught => {
      if (!controller.signal.aborted) setError(caught instanceof Error && caught.name !== "TimeoutError" ? caught.message : "The receipt could not be opened in time. Close this review and try again.");
    });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [receipt.id]);
  return <section className="bookloq-receipt-evidence" aria-label="Review original receipt">
    <header><h4 ref={heading} tabIndex={-1}>Review {receipt.fileName}</h4><button type="button" disabled={busy} onClick={close}>Close receipt</button></header>
    <p>Compare the merchant, date, amount and currency with {transactionLabel}. Opening this file does not save a match or post an expense.</p>
    {error && <p role="alert" className="bookloq-form-error">{error}</p>}
    {!preview && !error && <p role="status">Opening the verified original receipt…</p>}
    {preview && <>
      {preview.type.startsWith("image/") && !error ? <>
        {/* eslint-disable-next-line @next/next/no-img-element -- Authenticated private blob, revoked when the review closes. */}
        <img src={preview.url} alt={`Original receipt: ${receipt.fileName}`} onLoad={() => setOpened(true)} onError={() => { setOpened(false); setReviewed(false); setError("The receipt image could not be displayed. Open the original file to review it."); }}/>
      </> : <p>Open the original in a new tab, review it, then return here to confirm.</p>}
      <a href={preview.url} target="_blank" rel="noopener noreferrer" onClick={() => setOpened(true)}>Open original {preview.type === "application/pdf" ? "PDF" : "image"} ↗</a>
      <label className="bookloq-receipt-confirm"><input type="checkbox" checked={reviewed} disabled={!opened || busy || !canMatch} onChange={event => setReviewed(event.target.checked)}/><span>I reviewed this original receipt and confirm it supports this transaction.</span></label>
      <button type="button" className="bookloq-primary" disabled={!opened || !reviewed || busy || !canMatch} onClick={() => { if (opened && reviewed && !busy && canMatch) void confirm(); }}>{busy ? "Confirming match…" : "Confirm receipt match"}</button>
    </>}
  </section>;
}
