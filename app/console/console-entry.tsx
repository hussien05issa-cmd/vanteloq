"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AccountMfaGate from "../founder-mfa-gate";
import ProductBrandLogo from "../product-brand-logo";
import { currentSession } from "../supabase-browser";
import PersonalConsole from "./personal-console";

type EntryState = "checking" | "signed_out" | "ready" | "error";

export default function ConsoleEntry() {
  const [state, setState] = useState<EntryState>("checking");

  useEffect(() => {
    let active = true;
    void currentSession().then((session) => {
      if (active) setState(session ? "ready" : "signed_out");
    }).catch(() => {
      if (active) setState("error");
    });
    return () => { active = false; };
  }, []);

  if (state === "ready") {
    return <AccountMfaGate><PersonalConsole/></AccountMfaGate>;
  }

  return <main className="console-entry">
    <section className="console-entry-card">
      <header><ProductBrandLogo product="vanteloq" priority/><span>PRIVATE MANAGEMENT CONSOLE</span></header>
      <div className="console-entry-copy">
        <p className="console-eyebrow">LEXEDGE CONSULTING × VANTELOQ</p>
        <h1>Your companies, your people, and your next move.</h1>
        <p>Review subscribers, clients, calls, meetings, tasks, and access from one protected owner workspace.</p>
      </div>
      <div className="console-entry-preview" aria-hidden="true">
        <span/><span/><span/><span/>
      </div>
      {state === "checking" && <p className="console-entry-status">Checking your secure session…</p>}
      {state === "signed_out" && <div className="console-entry-actions">
        <Link href="/?auth=signin">Sign in to Vanteloq</Link>
        <small>After signing in, return to <b>vanteloq.com/console</b>. Authenticator verification is required.</small>
      </div>}
      {state === "error" && <div className="console-entry-actions"><p>Vanteloq could not verify your session.</p><Link href="/?auth=signin">Try secure sign in</Link></div>}
    </section>
  </main>;
}
