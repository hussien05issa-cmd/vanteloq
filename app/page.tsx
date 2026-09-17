"use client";

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import SessionTimeout from "./session-timeout";
import ClientLoadBoundary from "./client-load-boundary";
import WorkspaceSkeleton from "./workspace-skeleton";
import Link from "next/link";
import { PRODUCT_RELEASE_NAME } from "../domain/product-release";
import VanteloqAiShowcase from "./vanteloq-ai-showcase";
import VanteloqAiLogo from "./vanteloq-ai-logo";
import CompatibilityCheck from "./compatibility-check";
import PublicPlanCards from "./public-plan-cards";
import CustomPlanCallout from "./custom-plan-callout";
import HomeDecisionPreview from "./home-decision-preview";
import FeatureCarousel from "./feature-carousel";
import ProductBrandLogo from "./product-brand-logo";
import FinanceProof from "./finance-proof";
import ResourceArticleBrowser from "./resource-article-browser";
import { RESOURCE_ARTICLES } from "./resources/content";
import SocialLinks from "./social-links";
import HomeSocialSection from "./home-social-section";
import IntegrationBrandLogo from "./integration-brand-logo";
import AuthPanel, { type AuthPanelMode } from "./auth-panel";
import { currentSession, getSupabase, signOut } from "./supabase-browser";
import { readPlanSelection } from "../shared/plan-selection";
import { canonicalLocation } from "../shared/auth-urls";
import {
  clearTeamInviteCallback,
  parseTeamInviteCallback,
  type TeamInviteCallback,
} from "../shared/team-invite-auth";
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
        error?: { code?: string };
      };
      if (sequence !== loadSequence.current) return;
      if (response.status === 401 && data.error?.code === "SESSION_EXPIRED") {
        const client = await getSupabase();
        await client?.auth.signOut({ scope: "local" });
        setAuthMode("signin");
        setAuthOpen(true);
        return;
      }

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
    readPlanSelection();
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

  if (entry === "loading") return <AuthenticatedLoading/>;
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
    const clean = new URL(window.location.href);
    clean.searchParams.delete("start"); clean.searchParams.delete("auth");
    window.history.replaceState({}, "", clean.pathname + clean.search + clean.hash);
    setAuthOpen(false);
    setAuthMode("signup");
  }

  if (entry === "landing") return <><LandingPage start={openAuth}/>{authOpen && <AuthPanel initialMode={authMode} close={closeAuth} authenticated={session => void loadWorkspace(session)}/>}</>;
  if (entry === "signup") return <ClientLoadBoundary><Suspense fallback={<AuthenticatedLoading/>}><AccountMfaGate><SecureOnboardingFlow accountName={accountName} accountEmail={accountEmail} signOut={() => void signOut()} complete={(business, owner) => { setOrganizationName(business); setAccountName(owner); setEntry("app"); }}/></AccountMfaGate></Suspense></ClientLoadBoundary>;
  if (entry === "invitation" && teamInvitation) return <ClientLoadBoundary><Suspense fallback={<AuthenticatedLoading/>}><AccountMfaGate><TeamInvitationFlow invitation={teamInvitation} initialName={accountName} complete={(business, member) => { setOrganizationName(business); setAccountName(member); setTeamInvitation(null); setEntry("app"); }}/></AccountMfaGate></Suspense></ClientLoadBoundary>;
  return <ClientLoadBoundary><Suspense fallback={<AuthenticatedLoading/>}><AccountMfaGate><SessionTimeout><LegalAcceptanceGate><BillingOnboardingGate><VanteloqApp organizationName={organizationName} accountName={accountName}/></BillingOnboardingGate></LegalAcceptanceGate></SessionTimeout></AccountMfaGate></Suspense></ClientLoadBoundary>;
}

function AuthenticatedLoading() {
  return <main className="workspace-entry-loading"><ProductBrandLogo product="vanteloq" priority/><WorkspaceSkeleton label="Preparing your workspace"/></main>;
}

const featureReelScenes = [
  { id: "commerce", label: "Sales intelligence", source: "POS records", metric: "Net sales", value: "$4,860", context: "96 transactions", detail: "$50.63 average basket", insight: "Demand peaks at 2 p.m.", explanation: "Use the hourly pattern to review staffing and stock availability." },
  { id: "inventory", label: "Inventory intelligence", source: "Stock & sales", metric: "Stock cover", value: "5.1 days", context: "11 units on hand", detail: "15 units sold per week", insight: "Stock cover is shorter than lead time.", explanation: "Review the reorder before the next 14-day supplier delivery." },
  { id: "bookloq", label: "BookLoQ cash planning", source: "Financial records", metric: "Projected closing cash", value: "$13,100", context: "Opening cash $18,400", detail: "One-week scenario", insight: "$1,100 above the cash floor.", explanation: "Test a purchase against commitments before approving the spend." },
  { id: "reports", label: "Performance analysis", source: "Matched periods", metric: "Net sales change", value: "+8.5%", context: "+$380 net sales", detail: "Versus the prior matched period", insight: "See the movement behind the total.", explanation: "Follow the change into transactions, basket value and source records." },
] as const;

function FeatureReelStage({ scene }: { scene: (typeof featureReelScenes)[number] }) {
  return <div className={"feature-reel-stage stage-" + scene.id}>
    <div className="reel-metric"><span>{scene.metric}</span><strong>{scene.value}</strong><p>{scene.context}<i/>{scene.detail}</p></div>
    <div className="reel-data-visual">
      {scene.id === "commerce" && <div className="reel-sales">
        <div className="reel-visual-label"><span>Sales by hour</span><b>2 p.m. peak</b></div>
        <div className="reel-sales-bars" aria-label="Hourly sales from 8 a.m. to 5 p.m. Peak sales are $780 at 2 p.m.">{[280, 420, 360, 540, 650, 510, 780, 610, 410, 300].map((sales, index) => <i key={index} className={index === 6 ? "peak" : ""} style={{ height: (sales / 780 * 100) + "%", animationDelay: (index * 55) + "ms" }}><span>{index === 6 ? "$780" : ""}</span></i>)}</div>
        <div className="reel-chart-axis"><span>8 a.m.</span><span>Noon</span><span>5 p.m.</span></div>
      </div>}
      {scene.id === "inventory" && <div className="reel-stock">
        <div className="reel-visual-label"><span>Protein C</span><b>Reorder review</b></div>
        <div className="reel-cover-row"><span>Stock cover</span><i><b style={{ width: "36.43%" }}/></i><strong>5.1d</strong></div>
        <div className="reel-cover-row lead-time"><span>Lead time</span><i><b style={{ width: "100%" }}/></i><strong>14d</strong></div>
        <p className="reel-formula">11 units ÷ (15 units ÷ 7 days)</p>
      </div>}
      {scene.id === "bookloq" && <div className="reel-cash">
        <div className="reel-visual-label"><span>Cash movement</span><b>$12,000 cash floor</b></div>
        <div className="reel-cash-row"><span>Expected inflows</span><i><b style={{ width: "63.45%" }}/></i><strong>+$9,200</strong></div>
        <div className="reel-cash-row outflow"><span>Planned outflows</span><i><b style={{ width: "100%" }}/></i><strong>−$14,500</strong></div>
        <p className="reel-formula">Opening cash + inflows − outflows</p>
      </div>}
      {scene.id === "reports" && <div className="reel-compare">
        <div className="reel-visual-label"><span>Like-for-like comparison</span><b>Net sales</b></div>
        <div className="reel-compare-row prior"><span>Prior period</span><i><b style={{ width: "92.18%" }}/></i><strong>$4,480</strong></div>
        <div className="reel-compare-row"><span>Current period</span><i><b style={{ width: "100%" }}/></i><strong>$4,860</strong></div>
        <p className="reel-formula">($4,860 − $4,480) ÷ $4,480</p>
      </div>}
    </div>
    <div className="reel-insight"><VanteloqAiLogo size={42} decorative/><div><span>Vanteloq AI</span><strong>{scene.insight}</strong><p>{scene.explanation}</p></div></div>
  </div>;
}

function FeatureReel() {
  const [sceneIndex, setSceneIndex] = useState(0);
  const reel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer: number | undefined;
    let visible = true;
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
    if (reel.current) observer.observe(reel.current);
    const updateMotion = () => {
      window.clearInterval(timer);
      if (motion.matches) return;
      timer = window.setInterval(() => {
        if (visible && !document.hidden) setSceneIndex(current => (current + 1) % featureReelScenes.length);
      }, 8000);
    };
    updateMotion();
    motion.addEventListener("change", updateMotion);
    return () => {
      window.clearInterval(timer);
      motion.removeEventListener("change", updateMotion);
      observer.disconnect();
    };
  }, []);

  const scene = featureReelScenes[sceneIndex];
  return <div className="feature-reel" ref={reel} role="region" aria-labelledby="feature-reel-title" aria-live="off">
    <header><p>THE CONNECTED WORKSPACE</p><h3 id="feature-reel-title">One operating picture,<br/>from source to decision.</h3></header>
    <div className="reel-flow" aria-label="Source records become analysis for an owner to review">
      <span>{scene.source}</span><i aria-hidden="true"/><b>Vanteloq</b><i aria-hidden="true"/><span>Your next step</span>
    </div>
    <div className="feature-reel-screen">
      <div className="reel-window-bar"><span className="reel-app-symbol" aria-hidden="true">V</span><strong>{scene.label}</strong><span>Illustrative interface</span></div>
      <FeatureReelStage key={scene.id} scene={scene}/>
    </div>
    <footer><span>Illustrative data. Every decision stays yours.</span><Link href="/demo#retail">Explore the demo <span aria-hidden="true">↗</span></Link></footer>
  </div>;
}

function LandingPage({ start }: { start: (mode: "signin" | "signup") => void }) {
  const siteRef = useRef<HTMLDivElement>(null);
  const [activeSection, setActiveSection] = useState("");
  useEffect(() => {
    const site = siteRef.current, header = site?.querySelector<HTMLElement>(".public-nav");
    if (!site || !header) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const height = header.getBoundingClientRect().height;
      site.style.setProperty("--public-nav-height", `${height + 20}px`);
      const section = Array.from(site.querySelectorAll<HTMLElement>("main > section")).find(element => {
        const box = element.getBoundingClientRect();
        return box.top <= height + 80 && box.bottom > height + 80;
      });
      setActiveSection(section?.id ?? "");
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    const resize = new ResizeObserver(schedule);
    resize.observe(header); update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => { window.cancelAnimationFrame(frame); resize.disconnect(); window.removeEventListener("scroll", schedule); window.removeEventListener("resize", schedule); };
  }, []);
  return <div ref={siteRef} className="public-site journey-home reference-home">
    <a className="home-skip-link" href="#main-content">Skip to main content</a>
    <header className="public-nav">
      <div className="public-brand-family">
      <button type="button" className="public-brand" aria-label="Vanteloq home" onClick={() => { window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }}>
        <ProductBrandLogo product="vanteloq" priority/>
        <span>Vanteloq<small>Retail analytics by LexEdge Consulting</small></span>
      </button>
      </div>
      <nav id="public-navigation" aria-label="Main navigation">
        <a href="#platform" aria-current={activeSection === "platform" ? "location" : undefined}>How it works</a><a href="#connections" aria-current={activeSection === "connections" ? "location" : undefined}>Connections</a><a href="/demo" aria-current={activeSection === "demo" ? "location" : undefined}>Open the demo</a><Link data-public-event="pricing_view" href="/pricing">Pricing</Link><Link href="/help">Help</Link>
        <a href="#social" aria-current={activeSection === "social" ? "location" : undefined}>Socials</a><div className="public-nav-socials"><SocialLinks/></div>
      </nav>
      <div className="public-nav-actions">
        <button type="button" className="nav-login" onClick={() => start("signin")}>Sign in</button>
        <button type="button" data-public-event="signup_start" onClick={() => start("signup")}>Create a workspace</button>
      </div>
    </header>

    <main id="main-content">
      <section className="home-hero" aria-labelledby="home-title">
        <picture className="reference-scene">
          <source media="(max-width:1000px)" srcSet="/brand/vanteloq-alpine-hero-mobile-v2.webp"/>
          <img src="/brand/vanteloq-alpine-hero-v2.webp" width={1832} height={859} alt="" fetchPriority="high" decoding="async"/>
        </picture>
        <div className="home-hero-copy">
          <p className="home-eyebrow">Independent retail. Built by someone who ran a store.</p>
          <h1 id="home-title">A number without a source <em>is a rumour.</em></h1>
          <p>Follow last week’s sales back to the baskets, discounts and SKUs that caused it.</p>
          <p className="home-hero-support">Vanteloq is retail analytics software for sales, stock and cash. Keep the POS you already pay for. Missing data stays visible.</p>
          <div className="public-actions"><a href="/demo" data-public-event="demo_view">Open the demo <span aria-hidden="true">→</span></a><button type="button" data-public-event="signup_start" onClick={() => start("signup")}>Create a workspace</button></div>
          <ul className="home-proof"><li>No signup for the demo</li><li>Totals open to source rows</li><li>AI memory starts off</li></ul>
          <p className="home-company-credit">A product built and operated by <a href="#company">LexEdge Consulting</a>.</p>
        </div>
        <Link className="hero-product-hotspot" href="/demo" aria-label="Open the interactive Vanteloq demo" data-public-event="demo_view"><span>Sample store <b>Open the demo <i aria-hidden="true">↗</i></b></span></Link>
      </section>
      <div className="reference-connections" aria-label="Explore data connections"><span>YOUR TOOLS, CONNECTED</span><div>{["Lightspeed","Square","Shopify","Stripe","Google"].map(name=><a key={name} href="#connections" aria-label={`Check ${name} availability`}><IntegrationBrandLogo name={name} compact/><strong>{name}</strong></a>)}</div><a href="#connections">View Availability <span aria-hidden="true">→</span></a></div>
      <section className="home-decision-proof" id="platform" aria-labelledby="decision-proof-title">
        <span id="capabilities"/><div className="reference-section-heading"><div><p className="demo-eyebrow">THE QUESTIONS BEHIND THE COUNTER</p><h2 id="decision-proof-title">Before you reorder, discount or close the week.</h2></div><p>A sales total is a starting point. Look at what sold, what it earned and what your store needs next.</p></div>
        <FeatureCarousel/>
      </section>
      <section className="home-proof-studio" id="demo" aria-labelledby="home-demo-entry-title"><div className="proof-studio-copy"><p className="demo-eyebrow">TRY IT WITH SAMPLE RECORDS</p><h2 id="home-demo-entry-title">Sales changed.<br/>Show me why.</h2><p>Choose a location. Watch the totals update. Follow the result into the baskets, products and discounts behind it.</p><p className="proof-studio-note">Fictional records. Working calculations. No signup required.</p><Link href="/demo" data-public-event="demo_engaged">Open the full demo <span aria-hidden="true">→</span></Link></div><HomeDecisionPreview/>
        <div className="journey-steps" aria-label="From signup to the first insight"><div><b>1</b><span><strong>Set up your account</strong>Verify your email, secure your account and choose a plan.</span></div><div><b>2</b><span><strong>Bring in your records</strong>Connect your source, map locations and review the imported totals.</span></div><div><b>3</b><span><strong>Work through a store question</strong>Inspect the evidence, ask AI for help and assign a next step.</span></div></div>
      </section>
      <section className="home-connections" id="connections" aria-labelledby="connections-title">
        <div className="home-section-heading compact"><p>CHECK YOUR FIT FIRST</p><h2 id="connections-title">Keep your POS.<br/>Get more from its data.</h2><span>Choose your system to see what it can support, what you need to connect and what is still in development.</span></div>
        <CompatibilityCheck/>
        <FeatureReel/>
      </section>
      <section className="home-ai" id="vanteloq-ai" aria-labelledby="vanteloq-ai-title">
        <VanteloqAiShowcase/>
        <div className="home-ai-copy"><p>VANTELOQ AI</p><h2 id="vanteloq-ai-title">Ask about your store.<br/>Choose what AI can see.</h2><span>Vanteloq AI is the assistant inside your retail software. Work through sales, margins, cash forecasts or app questions using only the information you permit it to use, within your role’s access.</span><div className="home-ai-grid"><article><strong>Business questions and app help</strong><span>Ask about sales, inventory, marketing or BookLoQ. Get help finding a report or understanding your next step.</span></article><article><strong>Your permission comes first</strong><span>Memory starts off. Choose whether to share permitted business summaries, turn memory on or off, and delete saved chats in AI Settings.</span></article></div><small className="home-ai-note">Review important conclusions. AI does not replace your accountant or approve decisions for you.</small></div>
      </section>
      <FinanceProof/>
      <section className="journey-evidence" id="security" aria-labelledby="evidence-title">
        <div><p className="demo-eyebrow">KNOW WHAT IS BEHIND THE NUMBER</p><h2 id="evidence-title">Missing records should not look like a quiet day.</h2><p>See what information is available, what needs review and who can access it.</p></div>
        <div className="journey-trust"><article><strong>Access follows responsibility</strong><p>Workspace membership and role permissions control access to business and financial information.</p></article><article><strong>Missing data stays visible</strong><p>Missing costs do not become zero. An incomplete import does not prove the store was closed.</p></article><article><strong>You own the decision</strong><p>LexEdge Consulting provides business analysis, financial review, operations and marketing support. It builds and operates Vanteloq. You review consequential actions and own the decision.</p></article><div><Link href="/privacy">Privacy and deletion</Link><Link href="/subprocessors">Data processors</Link><Link href="/contact">Contact us</Link></div></div>
      </section>
      <section className="journey-pricing" id="plans" aria-labelledby="home-plans-title"><div className="home-section-heading compact"><p>CHOOSE YOUR CAPACITY</p><h2 id="home-plans-title">One store or several. Start with what you need.</h2><span>Choose the locations and team capacity that fit your operation. Add BookLoQ for accounting and cash planning.</span></div><PublicPlanCards compact/><CustomPlanCallout className="journey-custom" headingLevel={3} title="Need more locations or a custom scope?"/></section>
      <section className="home-faq journey-faq" aria-labelledby="faq-title"><div className="home-section-heading compact"><p>BEFORE YOU CONNECT YOUR STORE</p><h2 id="faq-title">What happens next?</h2><Link href="/help">Visit the help centre →</Link></div><div className="home-faq-list">
        <details><summary>Can I try it before signing up?</summary><p>Yes. The demo uses fictional records and working retail calculations. It does not access customer records or send requests to an AI provider.</p><Link href="/demo">Open the demo →</Link></details>
        <details><summary>Will it work with my POS?</summary><p>Check the provider selector for current availability and supported data. Each business authorizes its own account, maps locations and reviews imported totals before relying on reports. CSV is an alternative where a supported template fits your records.</p><a href="#connections">Check your system →</a></details>
        <details><summary>What happens after signup?</summary><p>Verify your email, set up an authenticator, add your business and confirm a subscription. Then connect a source, map locations and review the import. Reports show which records are available so you can see what is ready and what is missing.</p></details>
        <details><summary>What does BookLoQ add?</summary><p>BookLoQ adds accounting records, journals, financial statements, reconciliation and cash planning for $39 CAD per month on top of a base plan. It does not file tax returns or certify your books. Keep your accountant involved.</p></details>
        <details><summary>Can I control what AI remembers?</summary><p>Yes. Memory starts off. Choose whether to share permitted workspace summaries, turn memory on or off, and delete saved chats in AI Settings. AI access remains limited by your role.</p><Link href="/privacy">Read the privacy details →</Link></details>
        <details><summary>Can I change or cancel my subscription?</summary><p>Open Stripe’s billing portal from workspace billing to review available changes or cancellation. Check the effective date and any prorated charges before confirming.</p></details>
        <div className="journey-final"><strong>Start with a question you would ask about your own store.</strong><a href="/demo">Open the demo →</a><button type="button" data-public-event="signup_start" onClick={() => start("signup")}>Create a workspace</button></div>
      </div></section>


      <HomeSocialSection/>
      <section className="home-article-library" aria-label="Business resource articles"><ResourceArticleBrowser articles={RESOURCE_ARTICLES} title="Browse articles"/><Link href="/resources">Explore the resource library →</Link></section>
    </main>

    <footer className="home-footer" id="company">
      <div className="home-footer-brand"><div><ProductBrandLogo product="vanteloq"/><strong>Vanteloq</strong></div><p>Sales, stock and cash, with the records behind the numbers.</p><div className="home-footer-owner">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/lexedge-consulting-logo-web.png" alt="LexEdge Consulting" width={480} height={320} loading="lazy" />
        <span>LexEdge Consulting is the consulting business behind Vanteloq, covering business analysis, financial review, operations and marketing support. It builds and operates the software; your business decisions stay yours.</span>
      </div></div>
      <div><strong>PRODUCT</strong><Link href="/features/retail-intelligence">Retail intelligence</Link><Link href="/features/inventory-and-cash">Inventory and cash</Link><Link data-public-event="pricing_view" href="/pricing">Pricing</Link><Link href="/demo">Interactive demo</Link><a href="#platform">How it works</a><a href="#capabilities">Capabilities</a><a href="#connections">Connections</a><a href="#security">Security</a></div>
      <div><strong>RESOURCES</strong><Link href="/social">Follow Vanteloq</Link><Link href="/help">Help centre</Link><Link href="/resources">All resources</Link><Link href="/resources/inventory">Inventory</Link><Link href="/resources/finance">Finance</Link><Link href="/resources/analytics">Analytics</Link></div>
      <div><strong>LEGAL</strong><Link href="/legal">Legal centre</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/cookies">Cookies</Link></div>
      <div><strong>ACCOUNT</strong><Link href="/contact">Contact</Link><button type="button" onClick={() => start("signin")}>Sign in</button><button type="button" data-public-event="signup_start" onClick={() => start("signup")}>Create a workspace</button></div>
      <p className="home-footer-note"><strong>{PRODUCT_RELEASE_NAME}</strong><br/>© {new Date().getFullYear()} LexEdge Consulting. Feature availability depends on workspace access, configured sources and verified records.</p>
    </footer>
  </div>;
}
