"use client";

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import Link from "next/link";
import IntegrationBrandLogo from "./integration-brand-logo";
import VanteloqAiLogo from "./vanteloq-ai-logo";
import { integrationCatalog, integrationPublicStatus } from "./integration-catalog";
import SourceRecordIcon from "./source-record-icon";
import WorkspaceIcon from "./workspace-icon";
import ResourceGuideVisual from "./resource-guide-visual";
import { AccountSteps, OperatingStepPreview } from "./home-journey-visuals";
import ProductBrandLogo from "./product-brand-logo";
import PlatformPreview from "./platform-preview";
import ProductDemo from "./product-demo";
import SocialLinks from "./social-links";
import AuthPanel, { type AuthPanelMode } from "./auth-panel";
import { currentSession, getSupabase, signOut } from "./supabase-browser";
import { canonicalLocation } from "../shared/auth-urls";
import {
  clearTeamInviteCallback,
  parseTeamInviteCallback,
  type TeamInviteCallback,
} from "../shared/team-invite-auth";
import { RESOURCE_ARTICLES, getCategory, getReadingTime } from "./resources/content";
import type { TeamInvitationDetails } from "./team-invitation-flow";

const SecureOnboardingFlow = lazy(() => import("./secure-onboarding-flow"));
const VanteloqApp = lazy(() => import("./vanteloq-app"));
const AccountMfaGate = lazy(() => import("./founder-mfa-gate"));
const BillingOnboardingGate = lazy(() => import("./billing-onboarding-gate"));
const LegalAcceptanceGate = lazy(() => import("./legal-acceptance-gate"));
const TeamInvitationFlow = lazy(() => import("./team-invitation-flow"));

export default function Home() {
  const canonicalDestination = typeof window === "undefined" ? null : canonicalLocation(window.location);
  const [entry, setEntry] = useState<"loading" | "load-error" | "landing" | "invite-review" | "signup" | "invitation" | "app">("landing");
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthPanelMode>("signup");
  const [organizationName, setOrganizationName] = useState("");
  const [accountName, setAccountName] = useState("Account owner");
  const [accountEmail, setAccountEmail] = useState("");
  const [loadError, setLoadError] = useState("");
  const [teamInvitation, setTeamInvitation] = useState<TeamInvitationDetails | null>(null);
  const [inviteCallback, setInviteCallback] = useState<TeamInviteCallback | null>(null);
  const [inviteVerificationBusy, setInviteVerificationBusy] = useState(false);
  const [inviteVerificationError, setInviteVerificationError] = useState("");
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
        invitation?: TeamInvitationDetails | null;
      };
      if (sequence !== loadSequence.current) return;

      if (response.ok && data.organization?.setupComplete && !data.invitation) {
        loadedUser.current = userId;
        setAccountEmail(data.user?.email ?? "");
        setOrganizationName(data.organization.businessName ?? "");
        setAccountName(data.organization.ownerName || data.user?.displayName || "Account owner");
        setEntry("app");
        return;
      }
      if (response.ok && data.invitation) {
        loadedUser.current = userId;
        setAccountEmail(data.user?.email ?? "");
        setAccountName(data.user?.displayName || "Team member");
        setTeamInvitation(data.invitation);
        setEntry("invitation");
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
    const inviteRequested = query.get("team_invite") === "1";
    const callback = parseTeamInviteCallback(window.location.href);
    const requestedStart = query.get("start");
    const requestedAuth = query.get("auth");
    const requestedMode = requestedStart === "signup" || requestedStart === "signin"
      ? requestedStart
      : requestedAuth === "signup" || requestedAuth === "signin"
        ? requestedAuth
        : null;
    if (callback) {
      queueMicrotask(() => {
        if (!active) return;
        setInviteCallback(callback);
        setInviteVerificationError("");
        setEntry("invite-review");
      });
    } else if (recoveryRequested) {
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
          if (inviteRequested) {
            setEntry("landing");
            setAuthMode("signin");
            setAuthOpen(true);
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
        if (event === "SIGNED_IN" && new URLSearchParams(window.location.search).get("recovery") !== "1") {
          setAuthOpen(false);
          window.setTimeout(() => { if (active) void loadWorkspace(session); }, 0);
        }
        if (event === "SIGNED_OUT") {
          cancelPendingLoad();
          loadedUser.current = null;
          setOrganizationName("");
          setAccountEmail("");
          setTeamInvitation(null);
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

  async function verifyTeamInvite() {
    if (!inviteCallback || inviteVerificationBusy) return;
    setInviteVerificationBusy(true);
    setInviteVerificationError("");
    try {
      const client = await getSupabase();
      if (!client) throw new Error("Secure invitation verification is temporarily unavailable.");
      const { data, error } = await client.auth.verifyOtp({
        token_hash: inviteCallback.tokenHash,
        type: inviteCallback.type,
      });
      if (error || !data.session) throw new Error("This invitation has expired or was already used. Ask the owner to send a new invitation.");
      window.history.replaceState({}, document.title, clearTeamInviteCallback(window.location.href));
      setInviteCallback(null);
      await loadWorkspace(data.session);
    } catch (error) {
      setInviteVerificationError(error instanceof Error ? error.message : "The invitation could not be verified.");
    } finally {
      setInviteVerificationBusy(false);
    }
  }

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
  if (entry === "invite-review") return <main className="entry-loading entry-load-error team-invite-review">
    <ProductBrandLogo product="vanteloq" priority/>
    <p className="eyebrow">OWNER APPROVED TEAM ACCESS</p>
    <h1>Review your secure invitation</h1>
    <p>This invitation provides internal Vanteloq workspace access without checkout and includes private console access when assigned by the owner.</p>
    <p>No Stripe customer or paid subscription is created.</p>
    {inviteVerificationError && <p role="alert">{inviteVerificationError}</p>}
    {inviteCallback && <button disabled={inviteVerificationBusy} onClick={() => void verifyTeamInvite()}>{inviteVerificationBusy ? "Verifying securely…" : "Accept invitation and continue"}</button>}
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
  if (entry === "invitation" && teamInvitation) return <Suspense fallback={<AuthenticatedLoading/>}><AccountMfaGate><TeamInvitationFlow invitation={teamInvitation} initialName={accountName} complete={(business, member) => { setOrganizationName(business); setAccountName(member); setTeamInvitation(null); setEntry("app"); }}/></AccountMfaGate></Suspense>;
  return <Suspense fallback={<AuthenticatedLoading/>}><AccountMfaGate><LegalAcceptanceGate><BillingOnboardingGate><VanteloqApp organizationName={organizationName} accountName={accountName}/></BillingOnboardingGate></LegalAcceptanceGate></AccountMfaGate></Suspense>;
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
      : { scene: (current.scene + 1) % featureReelScenes.length, phase: 0 }), 2000);
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
    <div className="feature-reel-caption" aria-live="off"><small>{scene.kicker}</small><strong>{scene.title}</strong><span>{scene.copy}</span><div className="feature-reel-progress"><i style={{ width: `${((playhead.phase + 1) / 4) * 100}%` }}/></div><em>{scene.steps[playhead.phase]}</em></div>
    <nav aria-label="Feature tour scenes">
      {featureReelScenes.map((item, index) => <button type="button" key={item.id} className={index === playhead.scene ? "active" : ""} aria-current={index === playhead.scene ? "step" : undefined} onClick={() => { setPlayhead({ scene: index, phase: 0 }); setPlaying(false); }}><span>{index + 1}</span>{item.label}</button>)}
    </nav>
  </div>;
}

function LandingPage({ start }: { start: (mode: "signin" | "signup") => void }) {
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
    publicStatus: integrationPublicStatus(provider),
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
      <div className="public-brand-family">
      <button type="button" className="public-brand" aria-label="Vanteloq home" onClick={() => { closeMobileNav(); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
        <ProductBrandLogo product="vanteloq" priority/>
        <span>Vanteloq<small>BUSINESS INTELLIGENCE</small></span>
      </button>
      <a className="public-owner-brand" href="#company" onClick={closeMobileNav} aria-label="LexEdge Consulting, owner of Vanteloq">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/lexedge-consulting-logo.png" width={1536} height={1024} alt="LexEdge Consulting" decoding="async"/>
      </a>
      </div>
      <button type="button" className="nav-menu-toggle" aria-label={mobileNavOpen ? "Close navigation menu" : "Open navigation menu"} aria-expanded={mobileNavOpen} aria-controls="public-navigation" onClick={() => setMobileNavOpen(open => !open)}>{mobileNavOpen ? "Close" : "Menu"}</button>
      <nav id="public-navigation" className={mobileNavOpen ? "is-open" : ""} aria-label="Main navigation">
        <a href="#platform" onClick={closeMobileNav}>Platform</a>
        <a href="#connections" onClick={closeMobileNav}>Connections</a>
        <a href="#demo" onClick={closeMobileNav}>Try the demo</a>
        <Link data-public-event="pricing_view" href="/pricing" onClick={closeMobileNav}>Pricing</Link>
        <Link href="/help" onClick={closeMobileNav}>Help</Link>
        <div className="public-nav-mobile-socials">
          <span>Follow Vanteloq</span>
          <SocialLinks/>
        </div>
        <div className="public-nav-mobile-actions">
          <button type="button" className="nav-login" onClick={() => { closeMobileNav(); start("signin"); }}>Sign in</button>
          <button type="button" onClick={() => { closeMobileNav(); start("signup"); }}>Create workspace</button>
        </div>
      </nav>
      <div className="public-nav-actions">
        <button type="button" className="nav-login" onClick={() => start("signin")}>Sign in</button>
        <button type="button" data-public-event="signup_start" onClick={() => start("signup")}>Create workspace</button>
      </div>
    </header>

    <main id="main-content">
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-hero-copy">
          <p className="home-eyebrow">RETAIL ANALYTICS, CASH AND FOLLOW-THROUGH</p>
          <h1 id="home-title">Understand your business. <em>Make better decisions.</em></h1>
          <p>Know what sells together, which products earn their place and what accounts for a revenue change. Bring supported sales, inventory and financial records into one workspace, with evidence behind the decision.</p>
          <div className="public-actions">
            <a href="#demo">Try the interactive demo <span aria-hidden="true">→</span></a>
            <button type="button" data-public-event="signup_start" onClick={() => start("signup")}>Create your workspace <span aria-hidden="true">→</span></button>
          </div>
          <ul className="home-proof" aria-label="Verified platform controls">
            <li>Trace results to source records</li>
            <li>Keep control of approvals</li>
            <li>Protect your business data</li>
          </ul>

          <p className="home-demo-caption">No signup required. <Link href="/demo#retail">Explore retail intelligence with sample records →</Link></p>
        </div>
        <figure className="product-visual product-visual-reference home-product-visual">
          {/* The image is a real Vanteloq interface composition; the values shown are illustrative. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/vanteloq-command-ledger.webp" alt="Vanteloq command centre interface with sales, gross profit, cash, inventory and a decision queue." width={1487} height={1058} loading="eager" fetchPriority="high" />
          <figcaption>Vanteloq command centre · Illustrative values · Available views depend on connected and verified source data</figcaption>
        </figure>
      </section>

      <ProductDemo/>

      <section className="home-decision-proof" aria-labelledby="decision-proof-title">
        <div><p className="demo-eyebrow">TRY THE EVIDENCE. THEN MAKE THE CALL.</p><h2 id="decision-proof-title">Know what changed. See where to act.</h2><p>Explore the same retail calculation engine used inside a workspace. The demo uses fictional records, clearly marked, so you can inspect the result without sharing your business data.</p></div>
        <div className="decision-proof-grid">
          <article><span>1 / REVENUE DRIVERS</span><h3>Revenue is down. Tap “Why?”</h3><p>Break the change into purchase volume, basket value and returns. See how category revenue contributes, with a bridge that reconciles to the cent.</p><Link href="/demo#retail">Inspect the revenue bridge →</Link></article>
          <article><span>2 / PRODUCTS & BASKETS</span><h3>Find the pattern behind the purchase.</h3><p>Filter products by category and type. Compare discount reliance, repeat activity and combinations bought together, with sample sizes and formulas visible.</p><Link href="/demo#retail">Explore products and baskets →</Link></article>
          <article><span>3 / STOCK & OPERATIONS</span><h3>Plan with the inputs that matter.</h3><p>Review stock cover, expiry and hourly demand. Add reviewed inventory or labour records when your source does not supply the inputs a calculation needs.</p><Link href="/demo#retail">Explore inventory and hours →</Link></article>
        </div>
        <div className="home-retail-next"><p><strong>One practical workflow.</strong> Connect and review your source, inspect the result, ask Vanteloq AI for an interpretation, then assign a review task. BookLoQ adds the cash context before you commit.</p><Link href="/demo#bookloq">Test a purchase in BookLoQ →</Link><button type="button" data-public-event="signup_start" onClick={() => start("signup")}>Create your workspace</button></div>
      </section>

      <section className="home-connections" id="connections" aria-labelledby="connections-title">
        <div className="home-connection-intro">
          <div className="home-section-heading compact">
            <p>CONNECTED BUSINESS</p>
            <h2 id="connections-title">Connect the tools that already run your business.</h2>
            <span>Start with a supported sales source or a structured import. Add inventory, financial and marketing context as each connection is configured and its records are reviewed. Check availability before choosing your plan.</span>
          </div>
          <FeatureReel />
        </div>
        <details className="home-connection-directory">
          <summary>Explore providers and current availability <span>Check your systems before you sign up</span></summary>
        <div className="home-connection-grid">
          {publicIntegrations.map(provider => <article key={provider.id}><IntegrationBrandLogo name={provider.name} compact/><div><strong>{provider.name}</strong><span className={`home-connection-status ${provider.publicStatus.tone}`}>{provider.publicStatus.label}</span><span>{provider.detail}</span></div></article>)}
          <article><IntegrationBrandLogo name="Daily CSV" compact/><div><strong>CSV import</strong><span className="home-connection-status available">Available</span><span>Turn structured operating files into verified records</span></div></article>
        </div>
        </details>
      </section>

      <section className="home-problem" aria-labelledby="problem-title">
        <div className="home-problem-intro">
          <div className="home-section-heading">
            <p>THE VISIBILITY PROBLEM</p>
            <h2 id="problem-title">Your business should not tell four different stories.</h2>
            <span>A sale, a stock movement, a supplier bill and an assigned task may describe the same event. Reviewing them separately makes it harder to see what changed and what needs attention.</span>
          </div>
          <figure className="home-record-review" aria-labelledby="record-review-title">
            <header>
              <div>
                <span>EXAMPLE RECORD REVIEW</span>
                <strong id="record-review-title">One business event, four verified records.</strong>
              </div>
              <small>Example records</small>
            </header>
            <div className="home-record-review-body">
              <div className="home-record-sources" aria-label="Source records">
                <article className="sale">
                  <span className="home-record-source-mark"><SourceRecordIcon kind="sale"/></span>
                  <div><small>SALE</small><strong>Point of sale receipt</strong><em>Receipt 1458 · Today, 2:41 p.m.</em></div>
                  <p><b>$128.40</b><span>Posted</span></p>
                </article>
                <article className="stock">
                  <span className="home-record-source-mark"><SourceRecordIcon kind="stock"/></span>
                  <div><small>STOCK</small><strong>Inventory movement</strong><em>3 products · 5 units recorded</em></div>
                  <p><b>5 units</b><span>Matched</span></p>
                </article>
                <article className="cost">
                  <span className="home-record-source-mark"><SourceRecordIcon kind="cost"/></span>
                  <div><small>COST</small><strong>Supplier cost record</strong><em>3 lines · Cost basis confirmed</em></div>
                  <p><b>3 lines</b><span>Linked</span></p>
                </article>
                <article className="work">
                  <span className="home-record-source-mark"><SourceRecordIcon kind="work"/></span>
                  <div><small>WORK</small><strong>Manager follow-up</strong><em>Assigned · Due today</em></div>
                  <p><b>Owner set</b><span>Ready</span></p>
                </article>
              </div>
              <div className="home-record-path" aria-hidden="true">
                <i/>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/brand/vanteloq-mark.png" alt="" width={180} height={180}/>
                <i/>
              </div>
              <aside>
                <span className="home-review-status">RECORDS IN AGREEMENT</span>
                <strong>Ready for owner review</strong>
                <p>The sale, stock movement, cost basis and assigned work agree.</p>
                <ul>
                  <li>Source timestamps aligned</li>
                  <li>Product quantities reconciled</li>
                  <li>Responsible person recorded</li>
                </ul>
                <div className="home-review-summary"><span><b>4</b><small>source records</small></span><span><b>0</b><small>open conflicts</small></span></div>
                <footer><span>Prepared for approval</span><i aria-hidden="true">→</i></footer>
              </aside>
            </div>
            <figcaption>Example values show how Vanteloq keeps the source, calculation context and responsible person visible before approval.</figcaption>
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
            <li><b>1</b><div><strong>Connect or import</strong><span>Authorize a supported source or upload structured operating records.</span></div><OperatingStepPreview step="connect"/></li>
            <li><b>2</b><div><strong>Verify and organize</strong><span>Map locations, reconcile totals and apply consistent metric definitions.</span></div><OperatingStepPreview step="verify"/></li>
            <li><b>3</b><div><strong>Review and act</strong><span>Turn a supported finding into assigned work with the right approval.</span></div><OperatingStepPreview step="review"/></li>
          </ol>
        </div>
        <PlatformPreview/>
      </section>

      <section className="home-capabilities" id="capabilities" aria-labelledby="capabilities-title">
        <div className="home-section-heading">
          <p>IMPLEMENTED CAPABILITIES</p>
          <h2 id="capabilities-title">One place to understand the operating picture.</h2>
          <span>Focus on the workflows available in the current product, with source coverage and calculation limits kept visible.</span>
        </div>
        <div className="home-capability-grid">
          {[
            ["1","Sales performance","Review sales, transactions, basket size, discounts, refunds and trends using imported daily records or supported source data."],
            ["2","Margin visibility","Calculate gross profit and gross margin from net sales and recorded cost, while marking incomplete cost coverage."],
            ["3","Inventory lifecycle","Track lots, expiry dates, shelf-life risk, first-expiring-first-out order and inventory cost at risk."],
            ["4","Cash context","Separate current cash from known obligations and model supported purchasing or operating scenarios."],
            ["5","Purchasing decisions","Evaluate demand, lead time, case packs, supplier constraints, expiry and cash before reviewing an order quantity."],
            ["6","Operational follow-through","Create tasks from supported findings, assign responsibility and preserve the event and audit context."],
          ].map(([number, title, copy]) => <article key={number}><small>{number}</small><span className="home-capability-signal" aria-hidden="true"><i/><i/><i/></span><h3>{title}</h3><p>{copy}</p></article>)}
        </div>
      </section>

      <section className="home-marketing" id="marketing" aria-labelledby="marketing-title">
        <div className="home-section-heading"><p>FROM ATTENTION TO ACTION</p><h2 id="marketing-title">Make marketing decisions with the business in view.</h2><span>Understand how people find you, what they do next and which action deserves your time. Keep the source visible, the plan focused and the result measurable.</span></div>
        <div className="home-marketing-grid">
          <article><WorkspaceIcon name="Search"/><h3>Understand discovery</h3><p>Review website traffic, search queries and local discovery from approved Google resources. Compare the same source and time period.</p><span>Search and traffic reports</span></article>
          <article><WorkspaceIcon name="Customers"/><h3>Find the measurement gaps</h3><p>See where recorded journeys stop. Matched sales remain separate from advertising platforms&apos; reported conversions.</p><span>Evidence before attribution</span></article>
          <article><WorkspaceIcon name="Action Centre"/><h3>Give the next move a plan</h3><p>Prepare a campaign brief, build consistent campaign links and carry recommendations into your calendar for review.</p><span>Goal, action and measurement</span></article>
        </div>
        <div className="home-marketing-footer"><p>Provider authorization and sample approval are required. Facebook and Instagram organic insights are not yet available. Planning tools do not publish content or change advertising budgets.</p><button type="button" data-public-event="signup_start" onClick={() => start("signup")}>Build your business workspace →</button><a href="#connections">Check connection availability</a></div>
      </section>

      <section className="home-ai" id="vanteloq-ai" aria-labelledby="vanteloq-ai-title">
        <aside className="home-ai-mark" aria-label="How Vanteloq AI supports a business answer">
          <div className="home-ai-brand">
            <VanteloqAiLogo size={64} decorative/>
            <div><span>Vanteloq AI</span><small>POWERED BY OPENAI</small></div>
          </div>
          <p>From verified business records to an explanation your team can review.</p>
          <ol>
            <li><b>1</b><span><strong>Verified records</strong><small>Vanteloq prepares the approved business context.</small></span></li>
            <li><b>2</b><span><strong>Grounded explanation</strong><small>Vanteloq AI explains the evidence and identifies missing inputs.</small></span></li>
            <li><b>3</b><span><strong>Human approval</strong><small>Your permissions still control every action.</small></span></li>
          </ol>
        </aside>
        <div className="home-ai-copy">
          <p>GROUNDED BUSINESS INTELLIGENCE</p>
          <h2 id="vanteloq-ai-title">Your business context.<br/>A clearer next question.</h2>
          <div className="vanteloq-ai-engines" aria-label="Vanteloq AI provider"><span>Powered by OpenAI</span></div>
          <span>Explore sales, margins, inventory, marketing and BookLoQ with Vanteloq AI, powered by OpenAI. Ask about the approved evidence you can access, or switch to App help for guidance on using the product.</span>
          <p className="vanteloq-ai-activation">You choose when to share data. Memory starts off, saved chats can be deleted, and App help does not attach workspace records.</p>
          <div className="home-ai-grid">
            <article><strong>Ask in plain language</strong><span>Ask why sales changed, where margin is leaking or what deserves attention next.</span></article>
            <article><strong>Evidence stays visible</strong><span>Business analysis uses permitted summaries with source dates and coverage. Review the evidence and check important conclusions.</span></article>
            <article><strong>Memory is your choice</strong><span>Memory starts off. Enable it for a chat, switch it off, or delete your saved chats. Permitted context stays scoped to your user and workspace.</span></article>
          </div>
          <small className="home-ai-note">Vanteloq AI supports analysis and planning. Actions remain behind Vanteloq permissions and your approval.</small>
          <a className="home-ai-demo-link" href="#demo">Explore the evidence in the interactive demo →</a>
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
          <p>Vanteloq is a business operating and analytics platform owned and operated by LexEdge Consulting. It is designed for independent retailers that need a clearer view of daily performance. It works with supported point of sale and payment sources, structured daily imports and operating records created inside the platform. The goal is not to collect data for its own sake. It is to help owners and managers understand how sales, inventory, cash commitments, purchasing decisions and assigned work relate to one another.</p>
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
            return (
              <Link href={`/resources/${article.slug}`} key={article.slug}>
                <ResourceGuideVisual category={article.category} slug={article.slug}/>
                <small>{category?.shortName.toUpperCase()} · {getReadingTime(article)} MIN</small>
                <h3>{article.title}</h3>
                <p>{article.description}</p>
                <span>Read guide →</span>
              </Link>
            );
          })}
        </div>
        <Link className="home-text-link" href="/resources">Explore all Vanteloq resources →</Link> <Link className="home-text-link" href="/help">Visit the help centre →</Link>
      </section>

      <section className="home-security" id="security" aria-labelledby="security-title">
        <div className="home-section-heading">
          <p>IMPLEMENTED SECURITY CONTROLS</p>
          <h2 id="security-title">Business data is business-critical.</h2>
          <span>Authentication, authorization and audit controls are enforced within the current application, with sensitive actions kept behind server-side permission checks.</span>
        </div>
        <div className="home-security-grid">
          <article><strong>Organization separation</strong><p>Signed-in membership limits protected records to the correct organization, with automated boundary tests across application routes.</p></article>
          <article><strong>Role permissions</strong><p>Server-side permissions control sensitive integration, finance, export and workspace actions.</p></article>
          <article><strong>Protected connections</strong><p>Implemented provider flows use scoped authorization, one-time state and encrypted credentials.</p></article>
          <article><strong>Change history</strong><p>Important operating and connection actions are recorded, and duplicate requests are handled safely.</p></article>
        </div>
        <div className="home-security-evidence"><a href="/privacy">Privacy and deletion choices →</a><a href="/subprocessors">Who processes your data →</a><a href="https://github.com/hussien05issa-cmd/vanteloq/blob/main/tests/release-security.test.ts" target="_blank" rel="noopener noreferrer">Inspect application security tests ↗</a></div>
      </section>

      <section className="home-ownership" id="company" aria-labelledby="ownership-title">
        <div className="home-ownership-brand">
          <span>PRODUCT OWNERSHIP</span>
          {/* This is the supplied LexEdge Consulting logo. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/lexedge-consulting-logo-web.png" srcSet="/brand/lexedge-consulting-logo-web.png 480w, /brand/lexedge-consulting-logo.png 1536w" sizes="(max-width: 620px) 280px, (max-width: 1100px) 220px, 326px" alt="LexEdge Consulting" width={480} height={320} loading="lazy" decoding="async" />
          <p>Company ownership and operating responsibility</p>
        </div>
        <div className="home-ownership-copy">
          <p>BUILT AND OPERATED BY LEXEDGE CONSULTING</p>
          <h2 id="ownership-title">Vanteloq is a LexEdge Consulting product.</h2>
          <span>LexEdge Consulting owns and operates Vanteloq. The company is responsible for the product direction, service operations, privacy commitments and customer support behind the platform.</span>
          <div className="home-ownership-ledger" aria-label="LexEdge Consulting owns and operates Vanteloq">
            <article><small>COMPANY</small><strong>LexEdge Consulting</strong><span>Product owner and operator</span></article>
            <i aria-hidden="true">→</i>
            <article><small>PRODUCT</small><strong>Vanteloq</strong><span>Business operations and analytics platform</span></article>
          </div>
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
            <div className="home-faq-owner">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/lexedge-consulting-logo-web.png" alt="" width={480} height={320} loading="lazy" />
              <span>Owned and operated by LexEdge Consulting</span>
            </div>
          </aside>
          <div className="home-faq-list">
            <details><summary>What is Vanteloq?</summary><p>Vanteloq is a business operations and analytics platform for independent retailers. It brings supported sales, inventory, cash, purchasing and operational records into one workspace, then shows where each result came from, what is missing and what needs attention. It is designed to help owners make better decisions without hiding uncertainty behind a polished dashboard.</p></details>
            <details><summary>Who owns Vanteloq?</summary><p>Vanteloq is owned and operated by LexEdge Consulting. LexEdge Consulting is responsible for the product direction, service operations, privacy commitments and customer support behind Vanteloq.</p></details>
            <details><summary>How are LexEdge Consulting and Vanteloq connected?</summary><p>LexEdge Consulting is the company. Vanteloq is the company&apos;s business software product. A Vanteloq subscription provides access to the software and does not create a separate consulting engagement unless the customer and LexEdge Consulting agree to one in writing.</p></details>
            <details><summary>Can I explore the product before signing up?</summary><p>Yes. The interactive demo includes retail revenue drivers, product and basket analysis, inventory evidence, hourly demand and BookLoQ cash scenarios. It uses fictional sample records and the same retail calculation engine as the workspace. Missing input scenarios show why unsupported results are withheld.</p><Link href="/demo#retail">Explore retail intelligence →</Link></details>
            <details><summary>Who is Vanteloq designed for?</summary><p>The current product and connection work are designed primarily for independent retailers and the owners or managers who oversee sales, inventory, purchasing, cash and daily operations.</p></details>
            <details><summary>What systems can I connect?</summary><p>The Connections section shows the current status for every provider. Setup required means a connection path exists but customer or hosted provider setup is still required. Sandbox only and Production approval needed do not mean the provider is available for live production data. In development and Coming soon connections remain unavailable. Structured CSV import is available.</p></details>
            <details><summary>Do I need to replace my POS?</summary><p>No. Vanteloq is designed to use supported source records while the POS remains the transaction system. Availability and depth depend on the connector and successful reconciliation.</p></details>
            <details><summary>Can Vanteloq help with inventory?</summary><p>Yes. Implemented inventory tools cover lots, expiry, shelf-life risk, first-expiring-first-out review and a constrained reorder calculation. Recommendations still require reliable demand, cost, lead-time, supplier and cash inputs.</p></details>
            <details><summary>What is BookLoQ?</summary><p>BookLoQ is the accounting workspace inside the Vanteloq product family. It keeps journals, bills, documents, reconciliation and financial reporting separate from the main operating workspace. Access depends on the customer&apos;s plan and any required connection setup.</p></details>
            <details><summary>Does Vanteloq make decisions or move money automatically?</summary><p>No. Vanteloq organizes evidence and prepares reviewable recommendations. Financial connections, accounting records and important operating actions stay behind user consent, role permissions and human approval.</p></details>
            <details><summary>How does Vanteloq protect workspace data?</summary><p>The application uses secure authentication, organization-separated records, role-based server permissions, protected provider authorization, and recorded security events. Vanteloq does not claim SOC 2, ISO, or other certifications that have not been obtained.</p></details>
            <details><summary>Can I delete my account and data?</summary><p>Yes. An authorized account owner can request account and workspace deletion from the application. Vanteloq removes eligible application data and disconnects supported providers, while retaining only information that must be kept for security, billing, fraud prevention or legal obligations. The privacy notice explains the current process and retention limits.</p></details>
            <details><summary>Is Vanteloq a replacement for an accountant or legal adviser?</summary><p>No. Vanteloq provides software, records and decision support. It does not provide legal, tax, audit or professional accounting advice. Customers remain responsible for reviewing their records and using qualified advisers where appropriate.</p></details>
          </div>
        </div>
      </section>

      <div className="home-onboarding-summary"><AccountSteps/></div>
      <section className="home-final-cta" aria-labelledby="final-cta-title">
        <div><p>START WITH A CLEARER VIEW</p><h2 id="final-cta-title">Understand what is happening in your business.</h2><span>Create a workspace, add supported information and keep the source, calculation and next action connected.</span></div>
        <div><button type="button" data-public-event="signup_start" onClick={() => start("signup")}>Create your workspace</button><a href="#platform">Explore the platform</a></div>
      </section>
    </main>

    <footer className="home-footer">
      <div className="home-footer-brand"><div><ProductBrandLogo product="vanteloq"/><strong>Vanteloq</strong></div><p>Source-aware operations and analytics for independent retail.</p><div className="home-footer-owner">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/lexedge-consulting-logo-web.png" alt="LexEdge Consulting" width={480} height={320} loading="lazy" />
        <span>Owned and operated by LexEdge Consulting</span>
      </div></div>
      <div><strong>PRODUCT</strong><Link data-public-event="pricing_view" href="/pricing">Pricing</Link><Link href="/demo">Interactive demo</Link><a href="#platform">How it works</a><a href="#capabilities">Capabilities</a><a href="#connections">Connections</a><a href="#security">Security</a></div>
      <div><strong>RESOURCES</strong><Link href="/help">Help centre</Link><Link href="/resources">All resources</Link><Link href="/resources/inventory">Inventory</Link><Link href="/resources/finance">Finance</Link><Link href="/resources/analytics">Analytics</Link></div>
      <div><strong>LEGAL</strong><Link href="/legal">Legal centre</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/cookies">Cookies</Link></div>
      <div><strong>ACCOUNT</strong><button type="button" onClick={() => start("signin")}>Sign in</button><button type="button" data-public-event="signup_start" onClick={() => start("signup")}>Create workspace</button></div>
      <p className="home-footer-note">© {new Date().getFullYear()} LexEdge Consulting. Vanteloq is a product owned and operated by LexEdge Consulting. Feature availability depends on workspace access, configured sources and verified records.</p>
    </footer>
  </div>;
}
