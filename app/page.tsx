"use client";

import { useEffect, useState } from "react";
import SecureOnboardingFlow from "./secure-onboarding-flow";
import VanteloqApp from "./vanteloq-app";
import IntegrationBrandLogo from "./integration-brand-logo";
import ProductBrandLogo from "./product-brand-logo";
import AuthPanel from "./auth-panel";
import { apiFetch, currentSession, signOut, supabase } from "./supabase-browser";

export default function Home() {
  const [entry, setEntry] = useState<"loading" | "landing" | "signup" | "app">("loading");
  const [authOpen, setAuthOpen] = useState(false);
  const [organizationName, setOrganizationName] = useState("");
  const [accountName, setAccountName] = useState("Account owner");
  const [accountEmail, setAccountEmail] = useState("");

  useEffect(() => {
    let active = true;
    void currentSession().then(session => {
      if (!active) return;
      if (!session) {
        setEntry("landing");
        return;
      }
      return apiFetch("/api/v1/onboarding", { headers: { Accept: "application/json" } })
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
    });
    const listener = supabase?.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") window.location.reload();
      if (event === "SIGNED_OUT") setEntry("landing");
    });
    return () => { active = false; listener?.data.subscription.unsubscribe(); };
  }, []);

  if (entry === "loading") return <div className="entry-loading"><ProductBrandLogo product="vanteloq" priority/><p>Preparing Vanteloq…</p></div>;
  if (entry === "landing") return <><LandingPage start={() => setAuthOpen(true)}/>{authOpen && <AuthPanel close={() => setAuthOpen(false)}/>}</>;
  if (entry === "signup") return <SecureOnboardingFlow accountName={accountName} accountEmail={accountEmail} signOut={() => void signOut()} complete={(business, owner) => { setOrganizationName(business); setAccountName(owner); setEntry("app"); }}/>;
  return <VanteloqApp organizationName={organizationName} accountName={accountName}/>;
}

function LandingPage({ start }: { start: () => void }) {
  return <main className="public-site">
    <header className="public-nav"><button className="public-brand" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}><ProductBrandLogo product="vanteloq" priority/><span>Vanteloq<small>BUSINESS OPERATING SYSTEM</small></span></button><nav><a href="#platform">Platform</a><a href="#engines">Workspaces</a><a href="#connect">Connections</a><a href="#how">How it works</a></nav><div><button className="nav-login" onClick={start}>Sign in</button><button onClick={start}>Create workspace</button></div></header>
    <section className="public-hero"><div className="hero-grid"/><div className="public-copy"><span className="public-pill"><i/> Built for independent retail</span><h1>Run the business from<br/><em>one clear operating view.</em></h1><p>Vanteloq brings sales, cash, inventory and daily work into one place. It shows what changed, why it matters and which action needs an owner&apos;s approval.</p><div className="public-actions"><button onClick={start}>Create your workspace <span>→</span></button><a href="#platform">See the platform</a></div><div className="public-trust"><span>✓ Verified source data</span><span>✓ Your team keeps approval</span><span>✓ Separate data for every business</span></div></div>
      <div className="product-visual" aria-label="Example Vanteloq operating dashboard"><div className="pv-top"><span><i/><i/><i/></span><small>Vanteloq / example workspace</small><b>•••</b></div><div className="pv-body"><aside><ProductBrandLogo product="vanteloq"/>{[1,2,3,4,5,6].map(item => <i key={item}/>)}</aside><section><div className="pv-title"><span><small>OPERATING OVERVIEW</small><b>North Edmonton · This week</b></span><span className="pv-data-pill">Example data</span></div><div className="pv-kpis"><span className="sales"><small>NET SALES</small><b>$42,680</b><em>↑ 6.2% vs. last week</em></span><span className="profit"><small>GROSS PROFIT</small><b>$19,440</b><em>45.5% margin</em></span><span className="stock"><small>STOCK RISK</small><b>3 items</b><em>one needs action today</em></span></div><div className="pv-analytics-grid"><article className="pv-trend-card"><header><span><b>Sales and profit</b><small>Last 10 days</small></span><div><i/> Sales <i/> Profit</div></header><div className="pv-combo-chart">{[[54,24],[66,31],[48,22],[72,35],[63,30],[84,41],[76,37],[91,44],[81,39],[96,47]].map(([sales,profit],index) => <span key={index}><i style={{height:`${sales}%`}}/><i style={{height:`${profit}%`}}/></span>)}</div></article><article className="pv-stock-card"><div className="pv-ring"><span><b>9</b><small>days</small></span></div><small>Projected stockout</small><b>Creatine 500 g</b><p>Order 36 units before Friday.</p><button>Review order →</button></article></div><div className="pv-bottom"><span><i>3</i><b>Actions due</b><small>assigned with owners</small></span><span><i>✓</i><b>Sources verified</b><small>updated 12 minutes ago</small></span></div></section></div></div>
    </section>
    <section className="signal-ribbon"><span>SALES</span><i/><span>MONEY</span><i/><span>INVENTORY</span><i/><span>CUSTOMERS</span><i/><span>OPERATIONS</span><i/><span>DECISIONS</span></section>
    <section className="os-map-section" id="platform"><div className="os-map-copy"><p>ONE OPERATING MODEL</p><h2>Bring the daily operation together.</h2><span>Your POS, bank, accounting, payroll, supplier and marketing tools remain the source records. Vanteloq organizes those records into one reliable operating view.</span></div><div className="os-map"><div className="os-source-row">{["Sales","Money","Inventory"].map(item => <span key={item}>{item}</span>)}</div><div className="os-spine"><b>VANTELOQ OPERATING LAYER</b><small>Organize · verify · explain · prioritize</small></div><div className="os-source-row secondary">{["Customers","Accounting","Suppliers","Team"].map(item => <span key={item}>{item}</span>)}</div><div className="os-decision">CLEAR NEXT ACTIONS <span>with evidence, permissions and approval</span></div></div></section>
    <section className="platform-section"><div className="platform-intro"><p>FROM SIGNAL TO FOLLOW-THROUGH</p><h2>See the issue.<br/>Assign the work.</h2><span>Every important signal includes its source, age, limits and next step. Your team can act without losing the audit trail.</span></div><div className="feature-stack">{[["01","See the full operating picture","Bring sales, costs, cash, inventory, customers and daily work into consistent definitions."],["02","Focus on the right issue","Rank work by urgency, financial impact, confidence and data freshness."],["03","Approve and follow through","Assign the work, keep sensitive actions behind approval and record the outcome."]].map(([number,title,copy]) => <article key={number}><b>{number}</b><div><h3>{title}</h3><p>{copy}</p></div><span>↗</span></article>)}</div></section>
    <section className="engine-section" id="engines"><div><p>FOUR FOCUSED WORKSPACES</p><h2>One set of numbers.<br/>Four ways to act on them.</h2><span>Built for retailers who manage cash, stock, customers and daily execution at the same time.</span></div><div className="engine-grid">{[
      ["01","Owner Command","Review sales, basket size, margin, labour and operating exceptions in one daily brief.","Change → reason → next step"],
      ["02","Cash CFO","Separate the bank balance from cash available after known obligations and planned purchases.","Cash → commitments → capacity"],
      ["03","Reorder Brain","Use demand, lead time, case packs, expiry, storage and cash to recommend an order quantity.","Availability without overspending"],
      ["04","Back-office Agent","Watch invoices, deadlines and discrepancies, then prepare the work for approval.","Prepare → approve → record"],
    ].map(([n,title,copy,outcome]) => <article key={n}><small>{n}</small><h3>{title}</h3><p>{copy}</p><span>{outcome}</span></article>)}</div></section>
    <section className="product-family-section" id="products"><div className="product-family-intro"><p>THE VANTELOQ PRODUCT FAMILY</p><h2>Operations and accounting,<br/>connected by design.</h2><span>Vanteloq manages the operating view. BookLoQ keeps the financial records in a focused workspace while staying connected to sales, inventory, purchasing and assigned work.</span></div><div className="product-family-grid"><article><ProductBrandLogo product="vanteloq" variant="full"/><div><small>CORE OPERATING PLATFORM</small><h3>See the business clearly.</h3><p>Performance, exceptions, decisions and assigned work in one command centre.</p><span>Sales · Inventory · Customers · Team · Operations</span></div></article><article><ProductBrandLogo product="bookloq" variant="full"/><div><small>CONNECTED ACCOUNTING</small><h3>Keep the books connected.</h3><p>Ledger, cash, reconciliation, tax, reports and month-end controls built into Vanteloq.</p><span>Books · Cash · Bills · Reports · Audit</span></div></article></div></section>
    <section className="connection-section" id="connect"><p>CONNECT THE TOOLS YOU ALREADY USE</p><h2>Your existing systems keep the records. Vanteloq organizes the operation.</h2><div>{["Daily CSV","Lightspeed","Shopify","Square","Moneris","QuickBooks","Plaid"].map(item => <span key={item}><IntegrationBrandLogo name={item} compact/>{item}</span>)}</div><small>Each connection is separated by business. New data stays in review until the account, totals and recovery controls are verified.</small></section>
    <section className="how-section" id="how"><div><p>THE DAILY LOOP</p><h2>See. Decide.<br/>Assign. Follow through.</h2></div><ol><li><b>01</b><span><strong>Check the source</strong><small>Confirm ownership, completeness, totals and freshness.</small></span></li><li><b>02</b><span><strong>Understand the change</strong><small>Separate verified facts from estimates and missing context.</small></span></li><li><b>03</b><span><strong>Approve the next step</strong><small>Apply the right role, location and spending limit.</small></span></li><li><b>04</b><span><strong>Record the result</strong><small>Compare the expected outcome with what actually happened.</small></span></li></ol></section>
    <footer className="public-footer"><div><ProductBrandLogo product="vanteloq"/><strong>Vanteloq</strong><span className="footer-product-divider"/><ProductBrandLogo product="bookloq"/><strong>BookLoQ</strong></div><p>One operating view for independent retail.</p><button onClick={start}>Create your workspace →</button></footer>
  </main>;
}
