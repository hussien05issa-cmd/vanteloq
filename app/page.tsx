"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SecureOnboardingFlow from "./secure-onboarding-flow";
import VanteloqApp from "./vanteloq-app";
import IntegrationBrandLogo from "./integration-brand-logo";
import ProductBrandLogo from "./product-brand-logo";

export default function Home() {
  const router = useRouter();
  const [entry, setEntry] = useState<"loading" | "landing" | "signup" | "app">("loading");
  const [organizationName, setOrganizationName] = useState("");
  const [accountName, setAccountName] = useState("Account owner");
  const [accountEmail, setAccountEmail] = useState("");

  useEffect(() => {
    void fetch("/api/v1/onboarding", { headers: { Accept: "application/json" } })
      .then(async response => ({ response, data: await response.json() }))
      .then(({ response, data }) => {
        if (data.user?.email) setAccountEmail(data.user.email);
        if (response.ok && data.organization?.setupComplete) {
          setOrganizationName(data.organization.businessName);
          setAccountName(data.organization.ownerName || data.user?.displayName || "Account owner");
          setEntry("app");
        } else if (response.ok && data.authenticated) {
          setAccountName(data.user?.displayName || "Account owner");
          setEntry("signup");
        } else setEntry("landing");
      })
      .catch(() => setEntry("landing"));
  }, []);

  if (entry === "loading") return <div className="entry-loading"><ProductBrandLogo product="vanteloq" priority/><p>Preparing Vanteloq…</p></div>;
  if (entry === "landing") return <LandingPage/>;
  if (entry === "signup") return <SecureOnboardingFlow accountName={accountName} accountEmail={accountEmail} signOut={() => router.push("/signout-with-chatgpt?return_to=/")} complete={(business, owner) => { setOrganizationName(business); setAccountName(owner); setEntry("app"); }}/>;
  return <VanteloqApp organizationName={organizationName} accountName={accountName}/>;
}

function LandingPage() {
  const router = useRouter();
  const start = () => router.push("/signin-with-chatgpt?return_to=/");
  return <main className="public-site">
    <header className="public-nav"><button className="public-brand" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}><ProductBrandLogo product="vanteloq" priority/><span>Vanteloq<small>BUSINESS OPERATING SYSTEM</small></span></button><nav><a href="#platform">Platform</a><a href="#engines">Decision engines</a><a href="#connect">Connections</a><a href="#how">Method</a></nav><div><a className="nav-login" href="/signin-with-chatgpt?return_to=/">Sign in</a><button onClick={start}>Create workspace</button></div></header>
    <section className="public-hero"><div className="hero-grid"/><div className="public-copy"><span className="public-pill"><i/> Retail-first AI operating system</span><h1>Your business already has software.<br/><em>It needs a brain.</em></h1><p>Vanteloq connects sales, money, inventory and operations, then tells an independent retailer what changed, what it means and which approved action should happen next.</p><div className="public-actions"><button onClick={start}>Build your operating system <span>→</span></button><a href="#platform">See how it works</a></div><div className="public-trust"><span>✓ Evidence before advice</span><span>✓ Approval before execution</span><span>✓ One tenant, one data boundary</span></div></div>
      <div className="product-visual" aria-label="Example Vanteloq decision briefing"><div className="pv-top"><span><i/><i/><i/></span><small>vanteloq / example owner brief</small><b>•••</b></div><div className="pv-body"><aside><ProductBrandLogo product="vanteloq"/>{[1,2,3,4,5,6].map(item => <i key={item}/>)}</aside><section><div className="pv-title"><span><small>TODAY&apos;S PRIORITY</small><b>Protect cash and availability</b></span><span className="pv-data-pill">Example</span></div><div className="pv-kpis"><span><small>SALES</small><b>Down 8.4%</b><em>basket, not traffic</em></span><span><small>STOCK RISK</small><b>9 days</b><em>creatine at current velocity</em></span><span><small>PURCHASING CAPACITY</small><b>$18,300</b><em>after known commitments</em></span></div><div className="pv-decision"><small>RECOMMENDED NEXT MOVE</small><b>Build a cash-safe supplier order, then route it for approval.</b><button>Review evidence →</button></div><div className="pv-bottom"><span><i>1</i><b>Evidence attached</b><small>source, freshness, limits</small></span><span><i>✓</i><b>Human controlled</b><small>no automatic payment</small></span></div></section></div></div>
    </section>
    <section className="signal-ribbon"><span>SALES</span><i/><span>MONEY</span><i/><span>INVENTORY</span><i/><span>CUSTOMERS</span><i/><span>OPERATIONS</span><i/><span>DECISIONS</span></section>
    <section className="os-map-section" id="platform"><div className="os-map-copy"><p>ONE OPERATING MODEL</p><h2>Stop being the integration layer.</h2><span>POS, banking, accounting, payroll, suppliers and marketing stay useful systems of record. Vanteloq becomes the governed system of understanding and action above them.</span></div><div className="os-map"><div className="os-source-row">{["Sales","Money","Inventory"].map(item => <span key={item}>{item}</span>)}</div><div className="os-spine"><b>VANTELOQ BUSINESS AI</b><small>Normalize · verify · explain · prioritize</small></div><div className="os-source-row secondary">{["Customers","Accounting","Suppliers","Team"].map(item => <span key={item}>{item}</span>)}</div><div className="os-decision">DECISIONS <span>with evidence, permissions and approval</span></div></div></section>
    <section className="platform-section"><div className="platform-intro"><p>THE SYSTEM OF ACTION</p><h2>Not another dashboard.<br/>A closed operating loop.</h2><span>Every important signal follows the same contract, so recommendations remain explainable, safe and measurable as Vanteloq grows.</span></div><div className="feature-stack">{[["01","Understand the whole business","Normalize sales, costs, cash, inventory, customer and operating facts without mixing tenants or definitions."],["02","Rank the decision","Score urgency, financial impact, confidence and freshness. Show missing inputs instead of inventing a cause."],["03","Execute with control","Create accountable work, require step-up approval for sensitive actions and measure the result afterward."]].map(([number,title,copy]) => <article key={number}><b>{number}</b><div><h3>{title}</h3><p>{copy}</p></div><span>↗</span></article>)}</div></section>
    <section className="engine-section" id="engines"><div><p>FOUR DECISION ENGINES</p><h2>A back office, CFO and buyer<br/>inside one operating system.</h2><span>Built for independent retail first, where cash, stock and daily execution are inseparable.</span></div><div className="engine-grid">{[
      ["01","Owner Command","Explain sales, basket, margin, labour and operating exceptions in one ranked daily brief.","What changed → why → next action"],
      ["02","Cash CFO","Separate bank balance from what is actually available after known obligations and scenarios.","Cash → commitments → capacity"],
      ["03","Reorder Brain","Combine demand, variability, lead time, case packs, expiry, storage and cash before recommending quantity.","Availability without cash damage"],
      ["04","Back-office Agent","Monitor invoices, tasks, deadlines and discrepancies, then prepare bounded work for approval.","Prepare → approve → audit"],
    ].map(([n,title,copy,outcome]) => <article key={n}><small>{n}</small><h3>{title}</h3><p>{copy}</p><span>{outcome}</span></article>)}</div></section>
    <section className="product-family-section" id="products"><div className="product-family-intro"><p>THE VANTELOQ PRODUCT FAMILY</p><h2>Operations and accounting,<br/>connected by design.</h2><span>Vanteloq runs the operating picture. BookLoQ gives the financial records their own focused workspace without breaking the link to sales, inventory, purchasing and action tracking.</span></div><div className="product-family-grid"><article><ProductBrandLogo product="vanteloq" variant="full"/><div><small>CORE OPERATING PLATFORM</small><h3>See the business clearly.</h3><p>Verified performance, exceptions, decisions and assigned work in one command centre.</p><span>Sales · Inventory · Customers · Team · Operations</span></div></article><article><ProductBrandLogo product="bookloq" variant="full"/><div><small>CONNECTED ACCOUNTING</small><h3>Keep the books connected.</h3><p>Ledger, cash, reconciliation, tax, reports and month-end controls built into Vanteloq.</p><span>Books · Cash · Bills · Reports · Audit</span></div></article></div></section>
    <section className="connection-section" id="connect"><p>CONNECT WITHOUT SURRENDERING CONTROL</p><h2>Your systems remain the records. Vanteloq becomes the brain.</h2><div>{["Daily CSV","Lightspeed","Shopify","Square","Moneris","QuickBooks","Plaid"].map(item => <span key={item}><IntegrationBrandLogo name={item} compact/>{item}</span>)}</div><small>Every connector is isolated by organization, read-only before reconciliation, replay-safe and visibly gated until its provider credentials and recovery controls are verified.</small></section>
    <section className="how-section" id="how"><div><p>THE DAILY LOOP</p><h2>Understand.<br/>Decide. Execute. Learn.</h2></div><ol><li><b>01</b><span><strong>Verify the source</strong><small>Validate ownership, completeness, totals and freshness.</small></span></li><li><b>02</b><span><strong>Explain the signal</strong><small>Separate facts, estimates, assumptions and missing context.</small></span></li><li><b>03</b><span><strong>Approve the action</strong><small>Respect role, location, dollar limits and step-up authentication.</small></span></li><li><b>04</b><span><strong>Measure the result</strong><small>Record the decision, expected outcome and actual change.</small></span></li></ol></section>
    <footer className="public-footer"><div><ProductBrandLogo product="vanteloq"/><strong>Vanteloq</strong><span className="footer-product-divider"/><ProductBrandLogo product="bookloq"/><strong>BookLoQ</strong></div><p>The governed operating brain for independent retail.</p><button onClick={start}>Build your operating system →</button></footer>
  </main>;
}
