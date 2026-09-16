"use client";

import { Component, type ReactNode, useEffect, useRef, useState } from "react";
import ProductBrandLogo from "./product-brand-logo";
import "./client-load-recovery.css";

/** Match module transport failures only; application and authorization errors keep their existing handling. */
export function isClientModuleLoadError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  return name === "ChunkLoadError" || typeof message === "string" && (
    /Failed to fetch dynamically imported module/i.test(message)
    || /error loading dynamically imported module/i.test(message)
    || /Importing a module script failed/i.test(message)
    || /Loading (?:CSS )?chunk [\w-]+ failed/i.test(message)
    || /Unable to preload CSS for /i.test(message)
  );
}

export function ClientLoadRecovery() {
  const heading = useRef<HTMLHeadingElement>(null);
  const reloading = useRef(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { heading.current?.focus(); }, []);

  function reload() {
    if (reloading.current) return;
    reloading.current = true;
    setBusy(true);
    // A deliberate page reload obtains current module URLs. Resetting React.lazy
    // would reuse its cached rejection. Never reload on an error or a timer.
    window.location.reload();
  }

  return <main className="client-load-recovery" aria-labelledby="client-load-title">
    <section className="client-load-card">
      <div className="client-load-brand"><ProductBrandLogo product="vanteloq" priority/><span>Vanteloq</span></div>
      <span className="client-load-status"><i aria-hidden="true"/>Page File Unavailable</span>
      <h1 id="client-load-title" ref={heading} tabIndex={-1}>Your Workspace Could Not Load</h1>
      <p>A required file could not load. This can happen after an update or a connection interruption.</p>
      <div className="client-load-guidance">
        <strong>Check your connection, then reload.</strong>
        <p>Unsaved entries may need to be entered again. Vanteloq will not reload automatically.</p>
      </div>
      <div className="client-load-actions">
        <button type="button" onClick={reload} disabled={busy} aria-busy={busy}>{busy ? "Reloading…" : "Reload Vanteloq"}<span aria-hidden="true">↻</span></button>
        <a href="/contact" target="_blank" rel="noopener noreferrer">Get Help<span className="client-load-visually-hidden"> (opens in a new tab)</span><span aria-hidden="true">↗</span></a>
      </div>
    </section>
  </main>;
}

export default class ClientLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(error: unknown) {
    if (!isClientModuleLoadError(error)) throw error;
    return { failed: true };
  }

  render() {
    return this.state.failed ? <ClientLoadRecovery/> : this.props.children;
  }
}
