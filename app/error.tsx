"use client";

import { useEffect, useRef, useTransition } from "react";
import Link from "next/link";
import ProductBrandLogo from "./product-brand-logo";
import "./client-load-recovery.css";

/** Framework boundary: never render an exception, URL or stack to a customer. */
export default function PageRecovery({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [pending, startTransition] = useTransition();
  useEffect(() => { heading.current?.focus(); }, []);
  return <main className="client-load-recovery" aria-labelledby="page-recovery-title">
    <section className="client-load-card">
      <div className="client-load-brand"><ProductBrandLogo product="vanteloq" priority/><span>Vanteloq</span></div>
      <span className="client-load-status"><i aria-hidden="true"/>A brief interruption</span>
      <h1 id="page-recovery-title" ref={heading} tabIndex={-1}>This view couldn’t load.</h1>
      <p>Please try again. If this keeps happening, our support team can help.</p>
      <div className="client-load-guidance"><strong>Your next step</strong><p>If you were saving a change, check its status before submitting it again. Unsaved entries may need to be entered again.</p></div>
      <div className="client-load-actions">
        <button type="button" disabled={pending} aria-busy={pending} onClick={() => startTransition(() => reset())}>{pending ? "Trying again…" : "Try again"}</button>
        <Link href="/">Return to Vanteloq</Link>
        <a href="/contact" target="_blank" rel="noopener noreferrer">Get help<span className="client-load-visually-hidden"> (opens in a new tab)</span></a>
      </div>
    </section>
  </main>;
}
