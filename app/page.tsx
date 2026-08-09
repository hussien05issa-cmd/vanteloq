"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import SecureOnboardingFlow from "./secure-onboarding-flow";
import VanteloqApp from "./vanteloq-app";
import IntegrationBrandLogo from "./integration-brand-logo";
import ProductBrandLogo from "./product-brand-logo";
import AuthPanel, { type AuthPanelMode } from "./auth-panel";
import AccountMfaGate from "./founder-mfa-gate";
import { currentSession, getSupabase, signOut } from "./supabase-browser";

export default function Home() {
  const [entry, setEntry] = useState<"loading" | "load-error" | "landing" | "signup" | "app">("loading");
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthPanelMode>("signup");
  const [organizationName, setOrganizationName] = useState("");
  const [accountName, setAccountName] = useState("Account owner");
  const [accountEmail, setAccountEmail] = useState("");
  const [loadError, setLoadError] = useState("");
  const loadSequence = useRef(0);
  const loadingUser = useRef<string | null>(null);
  const loadedUser = useRef<string | null>(null);

  const cancelPendingLoad = useCallback(() => {
    ++loadSequence.current;
    loadingUser.current = null;
  }, []);

  const loadWorkspace = useCallback(async (session: Session | null) => {
    if (!session) {
      ++loadSequence.current;
      loadingUser.current = null;
      loadedUser.current = null;
      setLoadError("");
      setEntry("landing");
      return;
    }
    const userId = session.user.id;
    if (loadingUser.current === userId || loadedUser.current === userId) return;
    const sequence = ++loadSequence.current;
    loadingUser.current = userId;

    setEntry("loading");
    setLoadError("");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch("/api/v1/onboarding", {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({})) as {
        authenticated?: boolean;
        user?: { email?: string; displayName?: string };
        organization?: { setupComplete?: boolean; businessName?: string; ownerName?: string } | null;
      };
      if (sequence !== loadSequence.current) return;

      if (response.ok && data.organization?.setupComplete) {
        loadedUser.current = userId;
        setAccountEmail(data.user?.email ?? "");
        setOrganizationName(data.organization.businessName ?? "");
        setAccountName(data.organization.ownerName || data.user?.displayName || "Account owner");
        setEntry("app");
        return;
      }
      if (response.ok && data.authenticated) {
        loadedUser.current = userId;
        setAccountEmail(data.user?.email ?? "");
        setAccountName(data.user?.displayName || "Account owner");
        setEntry("signup");
        return;
      }

      setLoadError(response.status === 401
        ? "Your sign-in could not be verified. Try again, or sign out and sign in once more."
        : "Your workspace could not be loaded. Your account is safe; try again in a moment.");
      setEntry("load-error");
    } catch (error) {
      if (sequence !== loadSequence.current) return;
      setLoadError(error instanceof DOMException && error.name === "AbortError"
        ? "Vanteloq took too long to load. Check your connection and try again."
        : "Vanteloq could not load your workspace. Check your connection and try again.");
      setEntry("load-error");
    } finally {
      window.clearTimeout(timeout);
      if (sequence === loadSequence.current) loadingUser.current = null;
    }
  }, []);

  useEffect(() => {
    let active = true;
    const recoveryRequested = new URLSearchParams(window.location.search).get("recovery") === "1";
    if (recoveryRequested) {
      queueMicrotask(() => {
        if (!active) return;
        setEntry("landing");
        setAuthMode("reset-password");
        setAuthOpen(true);
      });
    } else {
      void currentSession()
        .then(session => { if (active) void loadWorkspace(session); })
        .catch(() => {
          if (!active) return;
          setLoadError("Vanteloq could not check your sign-in. Check your connection and try again.");
          setEntry("load-error");
        });
    }
    let unsubscribe: (() => void) | undefined;
    void getSupabase().then(client => {
      if (!active) return;
      const listener = client?.auth.onAuthStateChange((event, session) => {
        if (event === "PASSWORD_RECOVERY") {
          setEntry("landing");
          setAuthMode("reset-password");
          setAuthOpen(true);
        }
        if (event === "SIGNED_IN" && !recoveryRequested) {
          setAuthOpen(false);
          window.setTimeout(() => { if (active) void loadWorkspace(session); }, 0);
        }
        if (event === "SIGNED_OUT") {
          cancelPendingLoad();
          loadedUser.current = null;
          setOrganizationName("");
          setAccountEmail("");
          setEntry("landing");
        }
      });
      unsubscribe = () => listener?.data.subscription.unsubscribe();
    });
    return () => {
      active = false;
      cancelPendingLoad();
      unsubscribe?.();
    };
  }, [cancelPendingLoad, loadWorkspace]);

  if (entry === "loading") return <div className="entry-loading" role="status" aria-live="polite"><ProductBrandLogo product="vanteloq" priority/><p>Preparing Vanteloq…</p></div>;
  if (entry === "load-error") return <main className="entry-loading entry-load-error">
    <ProductBrandLogo product="vanteloq" priority/>
    <h1>Vanteloq did not finish loading</h1>
    <p>{loadError}</p>
    <div>
      <button onClick={() => void currentSession().then(loadWorkspace)}>Try again</button>
      <button className="secondary" onClick={() => void signOut()}>Sign out</button>
    </div>
  </main>;
  function openAuth(mode: "signin" | "signup") {
    setAuthMode(mode);
    setAuthOpen(true);
  }

  function closeAuth() {
    if (authMode === "reset-password") window.history.replaceState({}, "", window.location.pathname);
    setAuthOpen(false);
    setAuthMode("signup");
  }

  if (entry === "landing") return <><LandingPage start={openAuth}/>{authOpen && <AuthPanel initialMode={authMode} close={closeAuth} authenticated={session => void loadWorkspace(session)}/>}</>;
  if (entry === "signup") return <AccountMfaGate><SecureOnboardingFlow accountName={accountName} accountEmail={accountEmail} signOut={() => void signOut()} complete={(business, owner) => { setOrganizationName(business); setAccountName(owner); setEntry("app"); }}/></AccountMfaGate>;
  return <AccountMfaGate><VanteloqApp organizationName={organizationName} accountName={accountName}/></AccountMfaGate>;
}

function LandingPage({ start }: { start: (mode: "signin" | "signup") => void }) {
  return <main className="public-site">
    <header className="public-nav"><button className="public-brand" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}><ProductBrandLogo product="vanteloq" priority/><span>Vanteloq<small>BUSINESS OPERATING SYSTEM</small></span></button><nav><a href="#platform">Platform</a><a href="#engines">Workspaces</a><a href="#connect">Connections</a><a href="#how">How it works</a></nav><div><button className="nav-login" onClick={() => start("signin")}>Sign in</button><button onClick={() => start("signup")}>Create workspace</button></div></header>
    <section className="public-hero"><div className="hero-grid"/><div className="public-copy"><span className="public-pill"><i/> Built for independent retail</span><h1>Run the business from<br/><em>one clear operating view.</em></h1><p>Vanteloq brings sales, cash, inventory and daily work into one place. It shows what changed, why it matters and which action needs an owner&apos;s approval.</p><div className="public-actions"><button onClick={() => start("signup")}>Create your workspace <span>→</span></button><a href="#platform">See the platform</a></div><div className="public-trust"><span>✓ Verified source data</span><span>✓ Your team keeps approval</span><span>✓ Separate data for every business</span></div></div>
      <figure className="product-visual product-visual-reference">
        {/* This static, local design reference is already sized and compressed for the exact visual slot. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/vanteloq-command-ledger.png" alt="Vanteloq command centre showing verified sales, profit, cash, inventory and decision queue data in a structured operational ledger." width={1487} height={1058} />
        <figcaption>Illustrative workspace · Connected accounts determine the data shown</figcaption>
      </figure>
    </section>
    <section className="signal-ribbon"><span>SALES</span><i/><span>MONEY</span><i/><span>INVENTORY</span><i/><span>CUSTOMERS</span><i/><span>OPERATIONS</span><i/><span>DECISIONS</span></section>
    <section className="os-map-section" id="platform"><div className="os-map-copy"><p>ONE OPERATING MODEL</p><h2>Bring the daily operation together.</h2><span>Your POS, bank, accounting, payroll, supplier and marketing tools remain the source records. Vanteloq organizes those records into one reliable operating view.</span></div><div className="os-map"><div className="os-source-row">{["Sales","Money","Inventory"].map(item => <span key={item}>{item}</span>)}</div><div className="os-spine"><b>VANTELOQ OPERATING LAYER</b><small>Organize · verify · explain · prioritize</small></div><div className="os-source-row secondary">{["Customers","Accounting","Suppliers","Team"].map(item => <span key={item}>{item}</span>)}</div><div className="os-decision">CLEAR NEXT ACTIONS <span>with evidence, permissions and approval</span></div></div></section>
    <section className="platform-section"><div className="platform-intro"><p>FROM SIGNAL TO FOLLOW-THROUGH</p><h2>See the issue.<br/>Assign the work.</h2><span>Every important signal includes its source, age, limits and next step. Your team can act without losing the audit trail.</span><article className="workflow-preview" aria-label="Illustrative Vanteloq decision workflow preview"><header><span>ILLUSTRATIVE WORKFLOW</span><b>Inventory risk</b></header><div className="workflow-preview-main"><span><small>ITEM</small><strong>Protein C</strong></span><span><small>STOCK COVER</small><strong>4 days</strong></span><span><small>RECOMMENDATION</small><strong>Review order 60</strong></span></div><footer><span>Lightspeed R-Series · sales and inventory</span><b>Owner approval required</b></footer></article></div><div className="feature-stack">{[["01","See the full operating picture","Bring sales, costs, cash, inventory, customers and daily work into consistent definitions."],["02","Focus on the right issue","Rank work by urgency, financial impact, confidence and data freshness."],["03","Approve and follow through","Assign the work, keep sensitive actions behind approval and record the outcome."]].map(([number,title,copy]) => <article key={number}><b>{number}</b><div><h3>{title}</h3><p>{copy}</p></div><span>VIEW</span></article>)}</div></section>
    <section className="engine-section" id="engines"><div><p>FOUR FOCUSED WORKSPACES</p><h2>One set of numbers.<br/>Four ways to act on them.</h2><span>Built for retailers who manage cash, stock, customers and daily execution at the same time.</span></div><div className="engine-grid">{[
      ["01","Owner Command","Review sales, basket size, margin, labour and operating exceptions in one daily brief.","Change → reason → next step"],
      ["02","Cash CFO","Separate the bank balance from cash available after known obligations and planned purchases.","Cash → commitments → capacity"],
      ["03","Reorder Brain","Use demand, lead time, case packs, expiry, storage and cash to recommend an order quantity.","Availability without overspending"],
      ["04","Back-office Agent","Watch invoices, deadlines and discrepancies, then prepare the work for approval.","Prepare → approve → record"],
    ].map(([n,title,copy,outcome], index) => <article key={n}><small>{n}</small><h3>{title}</h3><p>{copy}</p><EngineCardPreview type={index}/><span>{outcome}</span></article>)}</div></section>
    <section className="product-family-section" id="products"><div className="product-family-intro"><p>THE VANTELOQ PRODUCT FAMILY</p><h2>Operations and accounting,<br/>connected by design.</h2><span>Vanteloq manages the operating view. BookLoQ keeps the financial records in a focused workspace while staying connected to sales, inventory, purchasing and assigned work.</span></div><div className="product-family-grid"><article><div className="product-family-logo-panel"><ProductBrandLogo product="vanteloq" variant="full"/></div><div><small>CORE OPERATING PLATFORM</small><h3>See the business clearly.</h3><p>Performance, exceptions, decisions and assigned work in one command centre.</p><span>Sales · Inventory · Customers · Team · Operations</span></div></article><article className="bookloq-product-card"><div className="product-family-logo-panel bookloq-logo-panel"><ProductBrandLogo product="bookloq" variant="full"/></div><div><small>CONNECTED ACCOUNTING</small><h3>Keep the books connected.</h3><p>Ledger, cash, reconciliation, tax, reports and month-end controls built into Vanteloq.</p><span>Books · Cash · Bills · Reports · Audit</span></div></article></div></section>
    <section className="connection-section" id="connect"><p>CONNECT THE TOOLS YOU ALREADY USE</p><h2>Your existing systems keep the records. Vanteloq organizes the operation.</h2><div>{["Daily CSV","Lightspeed","Shopify","Square","Moneris","QuickBooks","Plaid"].map(item => <span key={item}><IntegrationBrandLogo name={item} compact/>{item}</span>)}</div><small>Each connection is separated by business. New data stays in review until the account, totals and recovery controls are verified.</small></section>
    <section className="how-section" id="how"><div><p>THE DAILY LOOP</p><h2>See. Decide.<br/>Assign. Follow through.</h2></div><ol><li><b>01</b><span><strong>Check the source</strong><small>Confirm ownership, completeness, totals and freshness.</small></span></li><li><b>02</b><span><strong>Understand the change</strong><small>Separate verified facts from estimates and missing context.</small></span></li><li><b>03</b><span><strong>Approve the next step</strong><small>Apply the right role, location and spending limit.</small></span></li><li><b>04</b><span><strong>Record the result</strong><small>Compare the expected outcome with what actually happened.</small></span></li></ol></section>
    <footer className="public-footer"><div><ProductBrandLogo product="vanteloq"/><strong>Vanteloq</strong><span className="footer-product-divider"/><ProductBrandLogo product="bookloq"/><strong>BookLoQ</strong></div><p>One operating view for independent retail.</p><button onClick={() => start("signup")}>Create your workspace →</button></footer>
  </main>;
}

function EngineCardPreview({ type }: { type: number }) {
  if (type === 0) return <div className="engine-preview owner-preview" aria-label="Illustrative Owner Command preview"><div><span><small>SALES</small><b>$8,420</b></span><span><small>MARGIN</small><b>42.8%</b></span></div><p><b>2</b> operating exceptions need review</p></div>;
  if (type === 1) return <div className="engine-preview cash-preview" aria-label="Illustrative Cash CFO preview"><dl><div><dt>Bank balance</dt><dd>$42,184</dd></div><div><dt>Known obligations</dt><dd>− $30,344</dd></div><div><dt>Available to commit</dt><dd>$11,840</dd></div></dl></div>;
  if (type === 2) return <div className="engine-preview reorder-preview" aria-label="Illustrative Reorder Brain preview"><header><span>Protein C</span><b>URGENT</b></header><div><span><small>ON HAND</small><b>11</b></span><span><small>VELOCITY</small><b>15 / wk</b></span><span><small>ORDER</small><b>60</b></span></div></div>;
  return <div className="engine-preview agent-preview" aria-label="Illustrative back-office work queue preview"><div><span><i>INV</i><b>Supplier invoice</b></span><small>Ready for approval</small></div><div><span><i>TAX</i><b>GST deadline</b></span><small>Due in 4 days</small></div></div>;
}
