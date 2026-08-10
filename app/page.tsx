"use client";

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import Link from "next/link";
import IntegrationBrandLogo from "./integration-brand-logo";
import ProductBrandLogo from "./product-brand-logo";
import AuthPanel, { type AuthPanelMode } from "./auth-panel";
import { currentSession, getSupabase, signOut } from "./supabase-browser";
import { canonicalLocation } from "../shared/auth-urls";

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
    const recoveryRequested = new URLSearchParams(window.location.search).get("recovery") === "1";
    const requestedStart = new URLSearchParams(window.location.search).get("start");
    if (recoveryRequested) {
      queueMicrotask(() => {
        if (!active) return;
        setEntry("landing");
        setAuthMode("reset-password");
        setAuthOpen(true);
      });
    } else {
      if (requestedStart === "signup" || requestedStart === "signin") {
        queueMicrotask(() => {
          if (!active) return;
          setAuthMode(requestedStart);
          setAuthOpen(true);
        });
      }
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

function LandingPage({ start }: { start: (mode: "signin" | "signup") => void }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const closeMobileNav = () => setMobileNavOpen(false);

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
          <p>Bring verified sales, inventory, cash and operational records into clearer views—so owners and managers can see what changed, understand the limits of the data and decide what needs attention.</p>
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
        <div className="home-section-heading compact">
          <p>VERIFIED CONNECTION PATHS</p>
          <h2 id="connections-title">Connect supported sources with clear status at every step.</h2>
          <span>Start with the connection paths available in Vanteloq today. Authorization, mapping and reconciliation remain visible before imported records are used for decisions.</span>
        </div>
        <div className="home-connection-grid">
          <article><IntegrationBrandLogo name="Lightspeed" compact/><div><strong>Lightspeed R-Series</strong><span>Read-only sales and inventory import</span></div><small>READ-ONLY</small></article>
          <article><IntegrationBrandLogo name="Lightspeed" compact/><div><strong>Lightspeed X-Series</strong><span>Read-only pilot and sample review</span></div><small>LIMITED PILOT</small></article>
          <article><IntegrationBrandLogo name="Stripe" compact/><div><strong>Stripe</strong><span>Read-only payout and balance staging</span></div><small>STAGING</small></article>
          <article><IntegrationBrandLogo name="Daily CSV" compact/><div><strong>CSV import</strong><span>Structured daily operating records</span></div><small>AVAILABLE</small></article>
        </div>
      </section>

      <section className="home-problem" aria-labelledby="problem-title">
        <div className="home-section-heading">
          <p>THE VISIBILITY PROBLEM</p>
          <h2 id="problem-title">Your business information should not become four different stories.</h2>
          <span>A sale, a stock movement, a supplier bill and an assigned task may describe the same business event. When they are reviewed separately, owners spend more time reconciling reports and less time deciding what to do.</span>
        </div>
        <div className="home-problem-grid">
          <article><small>SALES</small><h3>Your POS records transactions.</h3><p>Revenue and product activity need consistent dates, locations, refunds and source definitions before they can be compared.</p></article>
          <article><small>INVENTORY</small><h3>Your stock records quantities.</h3><p>On-hand balances become more useful when they retain movements, costs, expiry context and count evidence.</p></article>
          <article><small>CASH</small><h3>Your balance is only one input.</h3><p>Known obligations and planned purchases change how much cash is actually available to commit.</p></article>
          <article><small>OPERATIONS</small><h3>Your team owns the follow-through.</h3><p>Important findings need an owner, approval boundary and recorded outcome—not another forgotten report.</p></article>
        </div>
      </section>

      <section className="home-platform" id="platform" aria-labelledby="platform-title">
        <div className="home-platform-copy">
          <p>ONE OPERATING MODEL</p>
          <h2 id="platform-title">Move from source records to a decision you can explain.</h2>
          <span>Vanteloq keeps the source, calculation status and approval path visible. Missing inputs remain unavailable or provisional instead of being silently replaced with confident-looking numbers.</span>
          <ol>
            <li><b>01</b><div><strong>Connect or import</strong><span>Authorize a supported source or upload structured operating records.</span></div></li>
            <li><b>02</b><div><strong>Verify and organize</strong><span>Map locations, reconcile totals and apply consistent metric definitions.</span></div></li>
            <li><b>03</b><div><strong>Review and act</strong><span>Turn a supported finding into assigned work with the right approval.</span></div></li>
          </ol>
        </div>
        <article className="home-workflow-preview" aria-label="Illustrative inventory decision workflow">
          <header><span>ILLUSTRATIVE WORKFLOW</span><b>Inventory review</b></header>
          <div className="home-workflow-source"><small>SOURCE</small><strong>Lightspeed R-Series</strong><span>Sales and inventory · last verified import shown in product</span></div>
          <div className="home-workflow-metrics"><span><small>ITEM</small><strong>Protein C</strong></span><span><small>ON HAND</small><strong>11 units</strong></span><span><small>LEAD TIME</small><strong>7 days</strong></span></div>
          <div className="home-workflow-decision"><small>REVIEW OUTPUT</small><strong>Check the proposed order against demand, supplier constraints and available cash.</strong></div>
          <footer><span>Illustrative data, clearly labelled</span><b>Owner approval required</b></footer>
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
          ].map(([number, title, copy]) => <article key={number}><small>{number}</small><h3>{title}</h3><p>{copy}</p></article>)}
        </div>
      </section>

      <section className="home-product-family" aria-labelledby="product-family-title">
        <div className="home-section-heading compact">
          <p>PRODUCT FAMILY</p>
          <h2 id="product-family-title">Operating visibility and financial records, kept distinct.</h2>
          <span>Vanteloq is the core operating workspace. BookLoQ is the separate accounting workspace inside the product, available where the workspace has the required access.</span>
        </div>
        <div className="home-product-family-grid">
          <article><ProductBrandLogo product="vanteloq" variant="full"/><div><small>VANTELOQ</small><h3>Understand the operation.</h3><p>Sales, inventory, cash context, purchasing, reports, data quality and assigned operational work.</p></div></article>
          <article><ProductBrandLogo product="bookloq" variant="full"/><div><small>BOOKLOQ</small><h3>Maintain the accounting workspace.</h3><p>Chart of accounts, journal controls, reconciliation, bills, documents and financial reporting where access is entitled.</p></div></article>
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
          <Link href="/resources/how-to-track-inventory-small-business"><small>INVENTORY · 8 MIN</small><h3>How to Track Inventory for a Small Business</h3><p>Build a reliable SKU, movement, counting and reorder process before choosing the software.</p><span>Read guide →</span></Link>
          <Link href="/resources/how-to-calculate-gross-margin-small-business"><small>FINANCE · 6 MIN</small><h3>How to Calculate Gross Margin for a Small Business</h3><p>Use the right sales and cost inputs, then avoid the mistakes that make the percentage misleading.</p><span>Read guide →</span></Link>
          <Link href="/resources/what-should-small-business-dashboard-show"><small>ANALYTICS · 7 MIN</small><h3>What Should a Small Business Dashboard Show?</h3><p>Choose a focused set of measures, context and action cues instead of filling the screen with charts.</p><span>Read guide →</span></Link>
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
          <article><strong>Tenant isolation</strong><p>Organization membership scopes protected records, with cross-tenant boundary tests covering application routes.</p></article>
          <article><strong>Role permissions</strong><p>Server-side permissions control sensitive integration, finance, export and workspace actions.</p></article>
          <article><strong>Protected connections</strong><p>Implemented provider flows use scoped authorization, one-time state and encrypted credentials.</p></article>
          <article><strong>Audit context</strong><p>Append-only audit events and idempotency controls preserve important operating and integration actions.</p></article>
        </div>
      </section>

      <section className="home-faq" aria-labelledby="faq-title">
        <div className="home-section-heading compact">
          <p>FREQUENTLY ASKED QUESTIONS</p>
          <h2 id="faq-title">Clear answers before you create a workspace.</h2>
        </div>
        <div className="home-faq-list">
          <details><summary>What is Vanteloq?</summary><p>Vanteloq is a business operating and analytics platform for independent retail. It organizes supported sales, inventory, cash and operational records into source-aware views and workflows.</p></details>
          <details><summary>Who is Vanteloq designed for?</summary><p>The current product and connection work are designed primarily for independent retailers and the owners or managers who oversee sales, inventory, purchasing, cash and daily operations.</p></details>
          <details><summary>What systems can I connect?</summary><p>Implemented connection paths currently cover Lightspeed R-Series, a read-only Lightspeed X-Series pilot and read-only Stripe staging. Structured CSV import is also available. Other providers shown inside the integration directory are disabled until their production adapters are built and verified.</p></details>
          <details><summary>Do I need to replace my POS?</summary><p>No. Vanteloq is designed to use supported source records while the POS remains the transaction system. Availability and depth depend on the connector and successful reconciliation.</p></details>
          <details><summary>Can Vanteloq help with inventory?</summary><p>Yes. Implemented inventory tools cover lots, expiry, shelf-life risk, first-expiring-first-out review and a constrained reorder calculation. Recommendations still require reliable demand, cost, lead-time, supplier and cash inputs.</p></details>
          <details><summary>How does Vanteloq protect workspace data?</summary><p>The application uses secure authentication, tenant-scoped records, role-based server permissions, protected provider authorization flows and audit events. Vanteloq does not claim SOC 2, ISO or other certifications that have not been obtained.</p></details>
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
      <div><strong>ACCOUNT</strong><button type="button" onClick={() => start("signin")}>Sign in</button><button type="button" onClick={() => start("signup")}>Create workspace</button></div>
      <p className="home-footer-note">© {new Date().getFullYear()} Vanteloq. Feature availability depends on workspace access, configured sources and verified records.</p>
    </footer>
  </div>;
}
