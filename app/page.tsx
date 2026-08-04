"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SecureOnboardingFlow from "./secure-onboarding-flow";
import VanteloqApp from "./vanteloq-app";
import IntegrationBrandLogo from "./integration-brand-logo";

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

  if (entry === "loading") return <div className="entry-loading"><span className="brand-mark"><i/><b>V</b></span><p>Preparing Vanteloq…</p></div>;
  if (entry === "landing") return <LandingPage/>;
  if (entry === "signup") return <SecureOnboardingFlow accountName={accountName} accountEmail={accountEmail} signOut={() => router.push("/signout-with-chatgpt?return_to=/")} complete={(business, owner) => { setOrganizationName(business); setAccountName(owner); setEntry("app"); }}/>;
  return <VanteloqApp organizationName={organizationName} accountName={accountName}/>;
}

function LandingPage() {
  const router = useRouter();
  const start = () => router.push("/signin-with-chatgpt?return_to=/");
  return <main className="public-site">
    <header className="public-nav"><button className="public-brand" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}><span className="brand-mark"><i/><b>V</b></span><span>Vanteloq<small>OPERATING INTELLIGENCE</small></span></button><nav><a href="#platform">Platform</a><a href="#connect">Data</a><a href="#how">How it works</a></nav><div><a className="nav-login" href="/signin-with-chatgpt?return_to=/">Sign in</a><button onClick={start}>Create workspace</button></div></header>
    <section className="public-hero"><div className="hero-grid"/><div className="public-copy"><span className="public-pill"><i/> Action-first intelligence for independent operators</span><h1>Know what changed.<br/><em>Know what to do next.</em></h1><p>Vanteloq connects sales, inventory, expenses, customers and operations—then separates verified facts from estimates, explains what needs attention and turns the answer into accountable work.</p><div className="public-actions"><button onClick={start}>Build your workspace <span>→</span></button><a href="#platform">Explore the system</a></div><div className="public-trust"><span>✓ No fabricated metrics</span><span>✓ Evidence-linked actions</span><span>✓ Tenant-scoped by design</span></div></div>
      <div className="product-visual" aria-label="Vanteloq command centre preview"><div className="pv-top"><span><i/><i/><i/></span><small>vanteloq / owner command centre</small><b>•••</b></div><div className="pv-body"><aside><strong>V</strong>{[1,2,3,4,5,6].map(item => <i key={item}/>)}</aside><section><div className="pv-title"><span><small>OWNER BRIEF</small><b>Your operating picture</b></span><button>Verified data⌄</button></div><div className="pv-kpis"><span><small>WHAT HAPPENED</small><b>Calculated facts</b><em>with source freshness</em></span><span><small>WHY IT HAPPENED</small><b>Evidence and limits</b><em>no invented causes</em></span><span><small>WHAT TO DO</small><b>Assigned actions</b><em>with expected impact</em></span></div><div className="pv-chart"><div>{[42,55,48,73,62,88,79,96].map((height,index) => <i key={index} style={{ height: `${height}%` }}/>)}</div><span><small>DECISION ENGINE</small><b>Every signal ends in a next move.</b></span></div><div className="pv-bottom"><span><i>!</i><b>Exception ranked</b><small>by impact and confidence</small></span><span><i>↗</i><b>Action created</b><small>owner, deadline, outcome</small></span></div></section></div></div>
    </section>
    <section className="signal-ribbon"><span>SALES & PROFIT</span><i/><span>CASH & INVENTORY</span><i/><span>CUSTOMERS</span><i/><span>TEAM & OPERATIONS</span><i/><span>FORECASTING</span></section>
    <section className="platform-section" id="platform"><div className="platform-intro"><p>THE VANTELOQ DIFFERENCE</p><h2>More than charts.<br/>An operating decision system.</h2><span>Your numbers become useful only when they explain what changed, what is known, what is missing and which action should follow.</span></div><div className="feature-stack">{[["01","One verified business model","Normalize sales, costs, balances, inventory, customer and operating records before calculating."],["02","Evidence-bound intelligence","Show calculations, confidence, missing dimensions and source freshness beside every conclusion."],["03","Execution and memory","Assign the action, record major decisions and measure what happened afterward."]].map(([number,title,copy]) => <article key={number}><b>{number}</b><div><h3>{title}</h3><p>{copy}</p></div><span>↗</span></article>)}</div></section>
    <section className="connection-section" id="connect"><p>START WITH REAL DATA</p><h2>Import now. Connect as adapters become ready.</h2><div>{["Daily CSV","Lightspeed","Shopify","Square","Moneris","QuickBooks"].map(item => <span key={item}><IntegrationBrandLogo name={item} compact/>{item}</span>)}</div><small>The daily-summary importer works immediately. Provider buttons remain disabled until authorization, reconciliation, replay protection and failure recovery are fully wired.</small></section>
    <section className="how-section" id="how"><div><p>THE DAILY LOOP</p><h2>Understand.<br/>Decide. Execute. Learn.</h2></div><ol><li><b>01</b><span><strong>Verify the source</strong><small>Validate format, totals, ownership and freshness.</small></span></li><li><b>02</b><span><strong>Explain the signal</strong><small>Separate known facts, estimates and missing context.</small></span></li><li><b>03</b><span><strong>Assign the next move</strong><small>Track an owner, deadline, expected impact and result.</small></span></li></ol></section>
    <footer className="public-footer"><div><span className="brand-mark"><i/><b>V</b></span><strong>Vanteloq</strong></div><p>Clarity for every operating decision.</p><button onClick={start}>Create workspace →</button></footer>
  </main>;
}
