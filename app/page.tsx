"use client";

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import Link from "next/link";
import IntegrationBrandLogo from "./integration-brand-logo";
import { integrationCatalog } from "./integration-catalog";
import ProductBrandLogo from "./product-brand-logo";
import AuthPanel, { type AuthPanelMode } from "./auth-panel";
import { currentSession, getSupabase, signOut } from "./supabase-browser";
import { canonicalLocation } from "../shared/auth-urls";
import { RESOURCE_ARTICLES, getCategory, getReadingTime } from "./resources/content";
import LexedgeLanding from "./lexedge-landing";

const SecureOnboardingFlow = lazy(() => import("./secure-onboarding-flow"));
const VanteloqApp = lazy(() => import("./vanteloq-app"));
const AccountMfaGate = lazy(() => import("./founder-mfa-gate"));

export default function Home() {
  const canonicalDestination = typeof window === "undefined" ? null : canonicalLocation(window.location);
  const [entry, setEntry] = useState<"loading" | "load-error" | "landing" | "signup" | "app">("landing");
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthPanelMode>("signup");
  const [organizationName, setOrganizationName] = useState("");
  const [accountName, setAccountName] = useState("Account owner");
  const [accountEmail, setAccountEmail] = useState("");
  const [loadError, setLoadError] = useState("");
  const loadSequence = useRef(0);
  const loadingUser = useRef<string | null>(null);
  const loadedUser = useRef<string | null>(null);

  useEffect(() => {
    if (canonicalDestination) window.location.replace(canonicalDestination);
  }, [canonicalDestination]);

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
    if (canonicalDestination) return;
    let active = true;
    const query = new URLSearchParams(window.location.search);
    const recoveryRequested = query.get("recovery") === "1";
    const requestedStart = query.get("start");
    const requestedAuth = query.get("auth");
    const requestedMode = requestedStart === "signup" || requestedStart === "signin"
      ? requestedStart
      : requestedAuth === "signup" || requestedAuth === "signin"
        ? requestedAuth
        : null;
    if (recoveryRequested) {
      queueMicrotask(() => {
        if (!active) return;
        setEntry("landing");
        setAuthMode("reset-password");
        setAuthOpen(true);
      });
    } else {
      void currentSession()
        .then(session => {
          if (!active) return;
          if (session) {
            void loadWorkspace(session);
            return;
          }
          setEntry("landing");
          if (requestedMode) {
            setAuthMode(requestedMode);
            setAuthOpen(true);
          }
        })
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
  }, [cancelPendingLoad, loadWorkspace, canonicalDestination]);

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
  if (entry === "signup") return <Suspense fallback={<AuthenticatedLoading/>}><AccountMfaGate><SecureOnboardingFlow accountName={accountName} accountEmail={accountEmail} signOut={() => void signOut()} complete={(business, owner) => { setOrganizationName(business); setAccountName(owner); setEntry("app"); }}/></AccountMfaGate></Suspense>;
  return <Suspense fallback={<AuthenticatedLoading/>}><AccountMfaGate><VanteloqApp organizationName={organizationName} accountName={accountName}/></AccountMfaGate></Suspense>;
}

function AuthenticatedLoading() {
  return <div className="entry-loading" role="status" aria-live="polite"><ProductBrandLogo product="vanteloq" priority/><p>Preparing your workspace…</p></div>;
}

const featureReelScenes = [
  {
    id: "commerce",
    label: "Commerce pulse",
    kicker: "LIVE OPERATING VIEW",
    title: "See sales, margin and demand move together.",
    copy: "Review the current trading picture with the source period and data coverage kept visible.",
    steps: ["Receive verified sales", "Build the hourly trend", "Compare the baseline", "Surface the decision"],
  },
  {
    id: "inventory",
    label: "Inventory decisions",
    kicker: "STOCK AND PURCHASING",
    title: "Move from stock counts to a supported order decision.",
    copy: "Bring sales velocity, supplier timing, on-hand inventory and cash constraints into one review.",
    steps: ["Read stock by location", "Calculate demand cover", "Apply supplier constraints", "Prioritize the order"],
  },
  {
    id: "bookloq",
    label: "BookLoQ control",
    kicker: "FINANCIAL CONTROL",
    title: "Turn financial records into cash context.",
    copy: "Categorize activity, review receipts and invoices, and compare commitments with available cash.",
    steps: ["Capture source records", "Confirm categories", "Project cash timing", "Flag the pressure point"],
  },
  {
    id: "reports",
    label: "Owner reports",
    kicker: "TRACEABLE REPORTING",
    title: "Understand what changed before deciding what to do.",
    copy: "Compare periods and follow every supported result back to its source, definition and freshness.",
    steps: ["Choose a period", "Compare like for like", "Inspect the variance", "Trace the evidence"],
  },
] as const;

function FeatureReelStage({ scene, phase }: { scene: (typeof featureReelScenes)[number]["id"]; phase: number }) {
  const commerceBars = [35, 48, 42, 67, 82, 58, 74, 91, 62, 46];
  const comparison = [62, 78, 55, 88, 70, 94];
  return <div className={`feature-reel-stage stage-${scene} phase-${phase}`} aria-hidden="true">
    <div className="reel-window-bar"><i/><i/><i/><span>Vanteloq workspace</span><b>Verified source</b></div>
    {scene === "commerce" && <div className="reel-commerce">
      <div className="reel-kpis"><article><span>Net sales</span><strong>$4,860</strong><small>Current day</small></article><article><span>Transactions</span><strong>96</strong><small>Completed</small></article><article><span>Average basket</span><strong>$50.63</strong><small>Net sales ÷ sales</small></article></div>
      <div className="reel-chart-card"><header><div><b>Sales by hour</b><span>Today compared with same weekday</span></div><em>Source time zone</em></header><div className="reel-bar-chart">{commerceBars.map((height, index) => <i key={index} style={{ height: `${height}%` }}><span>{index + 8}:00</span></i>)}</div></div>
      <div className="reel-decision"><span>Detected change</span><b>Lunch-period demand is ahead of the same-weekday baseline.</b><em>Open source evidence →</em></div>
    </div>}
    {scene === "inventory" && <div className="reel-inventory">
      <header><div><b>Reorder review</b><span>Demand, stock, lead time and cash in one queue</span></div><em>3 products reviewed</em></header>
      <div className="reel-stock-head"><span>Product</span><span>On hand</span><span>Velocity</span><span>Decision</span></div>
      {[["Creatine A", "45", "12 / week", "Order 36", "stable"], ["Pre-workout B", "18", "2 / week", "Hold", "hold"], ["Protein C", "11", "15 / week", "Order 60", "urgent"]].map(([name, stock, velocity, decision, state]) => <article className={`reel-stock-row ${state}`} key={name}><b>{name}</b><span>{stock}</span><span>{velocity}</span><em>{decision}</em></article>)}
      <div className="reel-constraint"><span>Order logic</span><b>Velocity + lead time + supplier minimum + available cash</b><i>Recommendation remains reviewable</i></div>
    </div>}
    {scene === "bookloq" && <div className="reel-bookloq">
      <div className="reel-record-stream"><article><span>Bank</span><b>Deposit received</b><i>Matched</i></article><article><span>Receipt</span><b>Operating expense</b><i>Review</i></article><article><span>Invoice</span><b>Supplier bill</b><i>Due soon</i></article></div>
      <div className="reel-cash-panel"><header><div><b>13-week cash view</b><span>Opening balance, inflows, outflows and commitments</span></div><em>Range shown</em></header><div className="reel-cash-bars">{[62, 74, 68, 54, 49, 57, 45, 39, 48, 52].map((height, index) => <i key={index} style={{ height: `${height}%` }}><span/></i>)}</div><div className="reel-cash-floor"><span>Cash floor</span></div></div>
      <div className="reel-cash-alert"><span>Timing risk</span><b>A supplier payment overlaps payroll week.</b><em>Review payment timing →</em></div>
    </div>}
    {scene === "reports" && <div className="reel-reports">
      <header><div><b>Performance report</b><span>Period, comparison and source coverage stay together</span></div><div><i>7 days</i><i className="active">30 days</i><i>Quarter</i></div></header>
      <div className="reel-report-body"><section><b>Net sales comparison</b><div className="reel-comparison-chart">{comparison.map((height, index) => <i key={index}><span style={{ height: `${Math.max(20, height - 18)}%` }}/><b style={{ height: `${height}%` }}/></i>)}</div></section><aside><span>Change</span><strong>+8.4%</strong><small>versus prior matched period</small><hr/><span>Coverage</span><b>30 of 30 days</b><small>Latest import verified</small></aside></div>
      <div className="reel-lineage"><span>Metric definition</span><i>→</i><span>Matched period</span><i>→</i><span>Source records</span><b>Export CSV</b></div>
    </div>}
    <div className="reel-stage-note"><span>Product tour</span><b>Illustrative interface</b></div>
  </div>;
}

function FeatureReel() {
  const [playhead, setPlayhead] = useState({ scene: 0, phase: 0 });
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!playing) return;
    const timer = window.setInterval(() => setPlayhead((current) => current.phase < 3
      ? { ...current, phase: current.phase + 1 }
      : { scene: (current.scene + 1) % featureReelScenes.length, phase: 0 }), 1450);
    return () => window.clearInterval(timer);
  }, [playing]);

  const scene = featureReelScenes[playhead.scene];
  return <div className={`feature-reel scene-${scene.id}`} role="region" aria-labelledby="feature-reel-title">
    <header>
      <div><p>VANTELOQ IN MOTION</p><h3 id="feature-reel-title">One operating picture, from source to decision.</h3></div>
      <button type="button" className="feature-reel-play" aria-label={playing ? "Pause feature tour" : "Play feature tour"} aria-pressed={!playing} onClick={() => setPlaying((value) => !value)}>
        <span aria-hidden="true">{playing ? "Ⅱ" : "▶"}</span>{playing ? "Pause" : "Play"}
      </button>
    </header>
    <div className="feature-reel-screen"><FeatureReelStage scene={scene.id} phase={playhead.phase}/></div>
    <div className="feature-reel-caption" aria-live="polite"><small>{scene.kicker}</small><strong>{scene.title}</strong><span>{scene.copy}</span><div className="feature-reel-progress"><i style={{ width: `${((playhead.phase + 1) / 4) * 100}%` }}/></div><em>{scene.steps[playhead.phase]}</em></div>
    <nav aria-label="Feature tour scenes">
      {featureReelScenes.map((item, index) => <button type="button" key={item.id} className={index === playhead.scene ? "active" : ""} aria-current={index === playhead.scene ? "step" : undefined} onClick={() => { setPlayhead({ scene: index, phase: 0 }); setPlaying(true); }}><span>{String(index + 1).padStart(2, "0")}</span>{item.label}</button>)}
    </nav>
  </div>;
}

function LandingPage({ start }: { start: (mode: "signin" | "signup") => void }) {
  return <LexedgeLanding start={start}/>;
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const closeMobileNav = () => setMobileNavOpen(false);
  const connectorBenefits: Record<string, string> = {
    "Point of sale": "Unify sales, returns, products and inventory movement",
    Commerce: "Connect orders, customers, products and channel performance",
    Payments: "Reconcile payouts, fees, refunds and cash timing",
    Accounting: "Keep books, balances and operating records aligned",
    Marketplace: "Bring marketplace demand and settlement records into view",
    Delivery: "Compare delivery revenue, commissions and order activity",
    Marketing: "Connect discovery, campaigns and attributable customer action",
    Banking: "Use owner-authorized balances and transactions in cash planning",
    "File import": "Turn structured operating files into verified records",
  };
  const publicIntegrations = integrationCatalog.map(provider => ({
    ...provider,
    detail: connectorBenefits[provider.category] ?? "Bring source records into one operating view",
  }));

  useEffect(() => {
    if (!mobileNavOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileNavOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileNavOpen]);

  return <div className="public-site">
    <a className="home-skip-link" href="#main-content">Skip to main content</a>
    <header className="public-nav">
      <button type="button" className="public-brand" aria-label="Vanteloq home" onClick={() => { closeMobileNav(); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
        <ProductBrandLogo product="vanteloq" priority/>
        <span>Vanteloq<small>BUSINESS OPERATING SYSTEM</small></span>
      </button>
      <button type="button" className="nav-menu-toggle" aria-label={mobileNavOpen ? "Close navigation menu" : "Open navigation menu"} aria-expanded={mobileNavOpen} aria-controls="public-navigation" onClick={() => setMobileNavOpen(open => !open)}>{mobileNavOpen ? "Close" : "Menu"}</button>
      <nav id="public-navigation" className={mobileNavOpen ? "is-open" : ""} aria-label="Main navigation">
        <a href="#platform" onClick={closeMobileNav}>Platform</a>
        <a href="#capabilities" onClick={closeMobileNav}>Capabilities</a>
        <a href="#connections" onClick={closeMobileNav}>Connections</a>
        <a href="#security" onClick={closeMobileNav}>Security</a>
        <Link href="/resources" onClick={closeMobileNav}>Resources</Link>
      </nav>
      <div className="public-nav-actions">
        <button type="button" className="nav-login" onClick={() => start("signin")}>Sign in</button>
        <button type="button" onClick={() => start("signup")}>Create workspace</button>
      </div>
    </header>

    <main id="main-content">
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-hero-copy">
          <span className="public-pill"><i/> Operations and analytics for independent retail</span>
          <h1 id="home-title">Understand your business. <em>Make better decisions.</em></h1>
          <p>Bring supported sales, inventory, cash and operational records into one clear view. See what changed, understand the limits of the data and decide what needs attention.</p>
          <div className="public-actions">
            <button type="button" onClick={() => start("signup")}>Create your workspace <span aria-hidden="true">→</span></button>
            <a href="#platform">See how Vanteloq works</a>
          </div>
          <ul className="home-proof" aria-label="Verified platform controls">
            <li>Source-linked calculations</li>
            <li>Role-based approvals</li>
            <li>Tenant-separated records</li>
          </ul>
        </div>
        <figure className="product-visual product-visual-reference home-product-visual">
          {/* The image is a real Vanteloq interface composition; the values shown are illustrative. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/vanteloq-command-ledger.webp" alt="Vanteloq command centre interface with sales, gross profit, cash, inventory and a decision queue." width={1487} height={1058} loading="eager" fetchPriority="high" />
          <figcaption>Vanteloq command centre · Illustrative values · Available views depend on connected and verified source data</figcaption>
        </figure>
      </section>

      <section className="home-connections" id="connections" aria-labelledby="connections-title">
        <div className="home-connection-intro">
          <div className="home-section-heading compact">
            <p>CONNECTED BUSINESS</p>
            <h2 id="connections-title">Connect the tools that already run your business.</h2>
            <span>Bring sales, inventory, payments, banking, accounting, delivery and marketing into one operating view, so every dashboard, forecast and recommendation starts from the same business records.</span>
          </div>
          <FeatureReel />
        </div>
        <div className="home-connection-grid">
          {publicIntegrations.map(provider => <article key={provider.id}><IntegrationBrandLogo name={provider.name} compact/><div><strong>{provider.name}</strong><span>{provider.detail}</span></div></article>)}
          <article><IntegrationBrandLogo name="Daily CSV" compact/><div><strong>CSV import</strong><span>Turn structured operating files into verified records</span></div></article>
        </div>
      </section>

      <section className="home-problem" aria-labelledby="problem-title">
        <div className="home-problem-intro">
          <div className="home-section-heading">
            <p>THE VISIBILITY PROBLEM</p>
            <h2 id="problem-title">Your business should not tell four different stories.</h2>
            <span>A sale, a stock movement, a supplier bill and an assigned task may describe the same event. Reviewing them separately makes it harder to see what changed and what needs attention.</span>
          </div>
          <figure className="home-problem-visual">
            {/* This generated editorial visual contains no customer data or fabricated performance values. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/business-sources-visual.webp" alt="Sales, inventory, cash and operational records flowing into one business view." width={1200} height={800} loading="lazy" />
            <figcaption>Four operating inputs. One decision view.</figcaption>
          </figure>
        </div>
        <div className="home-problem-grid">
          <article><small>SALES</small><h3>Sales records show what happened at checkout.</h3><p>Dates, locations, refunds and source definitions must be consistent before revenue and product activity can be compared.</p></article>
          <article><small>INVENTORY</small><h3>Stock records show what is on hand.</h3><p>Movements, costs, expiry context and count evidence explain whether the recorded quantity can be trusted.</p></article>
          <article><small>CASH</small><h3>A bank balance is one part of the picture.</h3><p>Known obligations and planned purchases affect how much cash is actually available to commit.</p></article>
          <article><small>OPERATIONS</small><h3>Every decision needs a clear owner.</h3><p>Important findings need an approval boundary, a responsible person and a recorded outcome.</p></article>
        </div>
      </section>

      <section className="home-platform" id="platform" aria-labelledby="platform-title">
        <div className="home-platform-copy">
          <p>ONE OPERATING MODEL</p>
          <h2 id="platform-title">Move from source records to a decision you can explain.</h2>
          <span>Vanteloq keeps the source, calculation status and approval path visible. Missing inputs remain unavailable or provisional instead of being silently replaced with confident-looking numbers.</span>
          <ol className="home-step-list">
            <li><b>01</b><div><strong>Connect or import</strong><span>Authorize a supported source or upload structured operating records.</span></div><span className="home-step-visual" aria-hidden="true">
              {/* Decorative generated art is already compact and served directly without an image transformation binding. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/connect-import-visual.webp" alt="" width={360} height={240}/>
            </span></li>
            <li><b>02</b><div><strong>Verify and organize</strong><span>Map locations, reconcile totals and apply consistent metric definitions.</span></div><span className="home-step-visual" aria-hidden="true">
              {/* Decorative generated art is already compact and served directly without an image transformation binding. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/verify-organize-visual.webp" alt="" width={360} height={240}/>
            </span></li>
            <li><b>03</b><div><strong>Review and act</strong><span>Turn a supported finding into assigned work with the right approval.</span></div><span className="home-step-review-visual" aria-hidden="true"><i/><i/><i/></span></li>
          </ol>
        </div>
        <article className="home-workflow-preview" aria-label="Inventory decision example">
          <header><span>SOURCE-BASED REVIEW</span><b>Inventory decision</b></header>
          <div className="home-workflow-source"><small>SOURCE</small><strong>Lightspeed R-Series</strong><span>Sales and inventory · last verified import shown in product</span></div>
          <div className="home-workflow-metrics"><span><small>ITEM</small><strong>Sample SKU</strong></span><span><small>ON HAND</small><strong>Confirmed in source</strong></span><span><small>LEAD TIME</small><strong>Supplier input</strong></span></div>
          <div className="home-workflow-decision"><div><small>REVIEW OUTPUT</small><strong>Review the proposed order against recent demand, supplier limits and available cash.</strong></div><figure>
            {/* This generated visual explains the review process without presenting customer data. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/inventory-decision-visual.webp" alt="Inventory, supplier timing, available cash and owner approval brought into one review." width={760} height={760} loading="lazy" />
          </figure></div>
          <footer><span>Example workflow · confirm with source records</span><b>Owner approval required</b></footer>
        </article>
      </section>

      <section className="home-capabilities" id="capabilities" aria-labelledby="capabilities-title">
        <div className="home-section-heading">
          <p>IMPLEMENTED CAPABILITIES</p>
          <h2 id="capabilities-title">One place to understand the operating picture.</h2>
          <span>Focus on the workflows available in the current product, with source coverage and calculation limits kept visible.</span>
        </div>
        <div className="home-capability-grid">
          {[
            ["01","Sales performance","Review sales, transactions, basket size, discounts, refunds and trends using imported daily records or supported source data."],
            ["02","Margin visibility","Calculate gross profit and gross margin from net sales and recorded cost, while marking incomplete cost coverage."],
            ["03","Inventory lifecycle","Track lots, expiry dates, shelf-life risk, first-expiring-first-out order and inventory cost at risk."],
            ["04","Cash context","Separate current cash from known obligations and model supported purchasing or operating scenarios."],
            ["05","Purchasing decisions","Evaluate demand, lead time, case packs, supplier constraints, expiry and cash before reviewing an order quantity."],
            ["06","Operational follow-through","Create tasks from supported findings, assign responsibility and preserve the event and audit context."],
          ].map(([number, title, copy]) => <article key={number}><small>{number}</small><span className="home-capability-signal" aria-hidden="true"><i/><i/><i/></span><h3>{title}</h3><p>{copy}</p></article>)}
        </div>
      </section>

      <section className="home-gemini" id="gemini" aria-labelledby="gemini-title">
        <div className="home-gemini-mark"><IntegrationBrandLogo name="Google"/><span>GOOGLE GEMINI</span><small>AI EXPLANATIONS IN VANTELOQ</small></div>
        <div className="home-gemini-copy">
          <p>GROUNDED BUSINESS INTELLIGENCE</p>
          <h2 id="gemini-title">Gemini explains the business behind the numbers.</h2>
          <span>Vanteloq uses Google Gemini to turn verified sales, inventory, cash and marketing evidence into a clear explanation, with the source, freshness and missing inputs kept visible.</span>
          <div className="home-gemini-grid">
            <article><strong>Ask in plain language</strong><span>Ask why sales changed, where margin is leaking or what deserves attention next.</span></article>
            <article><strong>Evidence stays visible</strong><span>Every answer is grounded in the records your workspace has approved. Missing data stays unavailable.</span></article>
            <article><strong>Memory stays in your workspace</strong><span>Conversation context is scoped to your organization and user, with no raw customer or bank details sent to the model.</span></article>
          </div>
          <small className="home-gemini-note">Gemini is an explanation layer, not an autonomous operator. Actions remain behind Vanteloq permissions and your approval.</small>
        </div>
      </section>

      <section className="home-product-family" aria-labelledby="product-family-title">
        <div className="home-section-heading compact">
          <p>PRODUCT FAMILY</p>
          <h2 id="product-family-title">Operating visibility and financial records, kept distinct.</h2>
          <span>Vanteloq is the core operating workspace. BookLoQ is the separate accounting workspace inside the product, available where the workspace has the required access.</span>
        </div>
        <div className="home-product-family-grid">
          <article className="home-product-card"><div className="home-product-logo-shell"><ProductBrandLogo product="vanteloq" variant="full"/></div><div><small>VANTELOQ</small><h3>Understand the operation.</h3><p>Sales, inventory, cash context, purchasing, reports, data quality and assigned operational work.</p><span className="home-product-chip">CORE WORKSPACE</span></div></article>
          <article className="home-product-card"><div className="home-product-logo-shell bookloq-logo-shell"><ProductBrandLogo product="bookloq" variant="full"/></div><div><small>BOOKLOQ</small><h3>Maintain the accounting workspace.</h3><p>Chart of accounts, journal controls, reconciliation, bills, documents and financial reporting where access is entitled.</p><span className="home-product-chip">ACCOUNTING WORKSPACE</span></div></article>
        </div>
      </section>

      <section className="home-use-cases" aria-labelledby="use-cases-title">
        <div className="home-section-heading compact">
          <p>QUESTIONS OPERATORS ASK</p>
          <h2 id="use-cases-title">Know what deserves attention.</h2>
          <span>Useful analysis begins with a specific operating question and enough evidence to answer it responsibly.</span>
        </div>
        <div className="home-use-case-grid">
          <a href="#capabilities"><small>SALES</small><strong>What changed in sales this week?</strong><span>Compare supported periods, locations and transaction measures.</span></a>
          <Link href="/resources/how-to-calculate-gross-margin-small-business"><small>MARGIN</small><strong>What is contributing to gross profit?</strong><span>Keep sales, recorded cost and missing-cost coverage visible.</span></Link>
          <Link href="/resources/how-to-track-inventory-small-business"><small>INVENTORY</small><strong>Which stock records need attention?</strong><span>Connect quantities to movements, counts and lifecycle risk.</span></Link>
          <a href="#platform"><small>OPERATIONS</small><strong>Who owns the next step?</strong><span>Move from a supported finding to review, approval and follow-through.</span></a>
        </div>
      </section>

      <section className="home-seo-copy" aria-labelledby="seo-copy-title">
        <div>
          <p>BUSINESS INTELLIGENCE FOR EVERYDAY OPERATORS</p>
          <h2 id="seo-copy-title">A clearer operating view for independent retail businesses.</h2>
          <div className="home-intelligence-map" role="img" aria-label="Supported sources are organized with context before they become an approved action.">
            <span><small>SUPPORTED SOURCES</small><b>Sales · Inventory · Cash</b></span>
            <i aria-hidden="true"/>
            <span><small>BUSINESS CONTEXT</small><b>Definitions · Limits · Owners</b></span>
            <i aria-hidden="true"/>
            <span><small>REVIEWED ACTION</small><b>Decide · Approve · Follow through</b></span>
          </div>
        </div>
        <div className="home-seo-columns">
          <p>Vanteloq is a business operating and analytics platform designed for independent retailers that need a clearer view of day-to-day performance. It works with supported point-of-sale and payment sources, structured daily imports and operating records created inside the platform. The goal is not to collect data for its own sake. It is to help owners and managers understand how sales, inventory, cash commitments, purchasing decisions and assigned work relate to one another.</p>
          <p>Most businesses already generate useful information. Transactions are recorded by a POS, stock changes appear in inventory records, supplier purchases affect cash and staff complete work across separate tools. The difficult part is often definition and context: whether two reports cover the same dates, whether cost data is complete, whether an estimate is being treated as a fact and whether anyone owns the next action. Vanteloq keeps those boundaries visible so a dashboard does not appear more certain than its source data allows.</p>
          <p>For a smaller organization, business intelligence should answer practical questions without requiring an enterprise reporting team. A useful operating view can show what changed, where the supporting record came from, what information is missing and which action needs approval. Vanteloq includes source-aware sales measures, gross-margin calculations, inventory lifecycle controls, cash context, purchasing tools, reporting and operational task workflows. The exact views available depend on the records and entitlements present in the workspace.</p>
          <p>Connected visibility does not replace sound accounting, physical inventory counts or management judgment. It makes comparison and follow-through easier. Vanteloq is built around that operating discipline: use supported sources, reconcile before promotion, preserve audit context and keep consequential actions in human hands.</p>
        </div>
      </section>

      <section className="home-resources" aria-labelledby="resources-title">
        <div className="home-section-heading compact">
          <p>PRACTICAL FIELD GUIDES</p>
          <h2 id="resources-title">Learn how to run a more informed business.</h2>
          <span>Detailed, source-backed explanations for the operating questions behind the dashboard.</span>
        </div>
        <div className="home-resource-grid">
          {RESOURCE_ARTICLES.map((article) => {
            const category = getCategory(article.category);
            const visualLabel = article.category === "inventory" ? "SKU" : article.category === "finance" ? "%" : "VIEW";
            return (
              <Link href={`/resources/${article.slug}`} key={article.slug}>
                <div className={`home-resource-art ${article.category}-art`} aria-hidden="true"><i/><i/><i/><b>{visualLabel}</b></div>
                <small>{category?.shortName.toUpperCase()} · {getReadingTime(article)} MIN</small>
                <h3>{article.title}</h3>
                <p>{article.description}</p>
                <span>Read guide →</span>
              </Link>
            );
          })}
        </div>
        <Link className="home-text-link" href="/resources">Explore all Vanteloq resources →</Link>
      </section>

      <section className="home-security" id="security" aria-labelledby="security-title">
        <div className="home-section-heading">
          <p>VERIFIED SECURITY CONTROLS</p>
          <h2 id="security-title">Business data is business-critical.</h2>
          <span>Authentication, authorization and audit controls are enforced within the current application, with sensitive actions kept behind server-side permission checks.</span>
        </div>
        <div className="home-security-grid">
          <article><strong>Organization separation</strong><p>Signed-in membership limits protected records to the correct organization, with automated boundary tests across application routes.</p></article>
          <article><strong>Role permissions</strong><p>Server-side permissions control sensitive integration, finance, export and workspace actions.</p></article>
          <article><strong>Protected connections</strong><p>Implemented provider flows use scoped authorization, one-time state and encrypted credentials.</p></article>
          <article><strong>Change history</strong><p>Important operating and connection actions are recorded, and duplicate requests are handled safely.</p></article>
        </div>
      </section>

      <section className="home-faq" aria-labelledby="faq-title">
        <div className="home-section-heading compact">
          <p>FREQUENTLY ASKED QUESTIONS</p>
          <h2 id="faq-title">Clear answers before you create a workspace.</h2>
        </div>
        <div className="home-faq-layout">
          <aside className="home-faq-visual" aria-label="Vanteloq workspace principles">
            <ProductBrandLogo product="vanteloq" variant="full"/>
            <strong>Clarity before commitment.</strong>
            <p>Know what connects, what needs verification and where a person stays in control.</p>
            <div><span>Supported sources</span><span>Visible data limits</span><span>Human approvals</span></div>
          </aside>
          <div className="home-faq-list">
            <details><summary>What is Vanteloq?</summary><p>Vanteloq is a business operating and analytics platform for independent retail. It organizes supported sales, inventory, cash and operational records into source-aware views and workflows.</p></details>
            <details><summary>Who is Vanteloq designed for?</summary><p>The current product and connection work are designed primarily for independent retailers and the owners or managers who oversee sales, inventory, purchasing, cash and daily operations.</p></details>
            <details><summary>What systems can I connect?</summary><p>Implemented connection paths currently cover Lightspeed R-Series, a Lightspeed X-Series pilot, Stripe staging, Plaid Link, and Google and Meta marketing measurement. Google, Meta and Plaid remain disabled until their hosted credentials and provider setup are complete. Structured CSV import is also available.</p></details>
            <details><summary>Do I need to replace my POS?</summary><p>No. Vanteloq is designed to use supported source records while the POS remains the transaction system. Availability and depth depend on the connector and successful reconciliation.</p></details>
            <details><summary>Can Vanteloq help with inventory?</summary><p>Yes. Implemented inventory tools cover lots, expiry, shelf-life risk, first-expiring-first-out review and a constrained reorder calculation. Recommendations still require reliable demand, cost, lead-time, supplier and cash inputs.</p></details>
            <details><summary>How does Vanteloq protect workspace data?</summary><p>The application uses secure authentication, organization-separated records, role-based server permissions, protected provider authorization, and recorded security events. Vanteloq does not claim SOC 2, ISO, or other certifications that have not been obtained.</p></details>
          </div>
        </div>
      </section>

      <section className="home-final-cta" aria-labelledby="final-cta-title">
        <div><p>START WITH A CLEARER VIEW</p><h2 id="final-cta-title">Understand what is happening in your business.</h2><span>Create a workspace, add supported information and keep the source, calculation and next action connected.</span></div>
        <div><button type="button" onClick={() => start("signup")}>Create your workspace</button><a href="#platform">Explore the platform</a></div>
      </section>
    </main>

    <footer className="home-footer">
      <div className="home-footer-brand"><div><ProductBrandLogo product="vanteloq"/><strong>Vanteloq</strong></div><p>Source-aware operations and analytics for independent retail.</p></div>
      <div><strong>PRODUCT</strong><a href="#platform">How it works</a><a href="#capabilities">Capabilities</a><a href="#connections">Connections</a><a href="#security">Security</a></div>
      <div><strong>RESOURCES</strong><Link href="/resources">All resources</Link><Link href="/resources/inventory">Inventory</Link><Link href="/resources/finance">Finance</Link><Link href="/resources/analytics">Analytics</Link></div>
      <div><strong>LEGAL</strong><Link href="/legal">Legal centre</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/cookies">Cookies</Link></div>
      <div><strong>ACCOUNT</strong><button type="button" onClick={() => start("signin")}>Sign in</button><button type="button" onClick={() => start("signup")}>Create workspace</button></div>
      <p className="home-footer-note">© {new Date().getFullYear()} Vanteloq. Feature availability depends on workspace access, configured sources and verified records.</p>
    </footer>
  </div>;
}
