"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import PublicPageNav from "./public-page-nav";
import PublicFooter from "./public-footer";
import HomepageStory, { SampleContext, SalesBridge } from "./homepage-story";
import CompatibilityCheck from "./compatibility-check";
import IntegrationBrandLogo from "./integration-brand-logo";
import { integrationCatalog, integrationPublicStatus } from "./integration-catalog";
import VanteloqAiLogo from "./vanteloq-ai-logo";
import InteractiveGoalRings from "./interactive-goal-rings";
import { goalResult } from "../domain/dashboard-personalization";
import { HOME_DEMO as demo, sampleMoney as money } from "../domain/homepage-demo";
import { bookloqDemo } from "../domain/bookloq-demo";
import { FREE_PLAN, PLANS, ADDONS } from "../server/entitlements/catalog";
import { planSelectionUrl } from "../shared/plan-selection";
import { HOME_FAQS, RETAIL_FAQS, INDUSTRY_FITS, RETAIL_LANDING } from "./homepage-content";
import "./homepage-refinement.css";
import { useMotionPreference } from "./use-motion-preference";

function Actions({ section = "hero" }: { section?: string }) { return <div className="hp-actions"><a className="hp-primary" href={planSelectionUrl({ plan: "free", bookloq: false })} data-public-event="signup_start" data-public-section={section} data-public-plan="free">Start Free <span aria-hidden="true">↗</span></a><Link className="hp-secondary" href="/demo" data-public-event="demo_view" data-public-section={section}>Explore the demo</Link></div>; }
function SectionHeading({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) { return <header className="hp-section-heading"><p className="hp-eyebrow">{eyebrow}</p><h2>{title}</h2>{children && <p>{children}</p>}</header>; }

function AvailableConnections() {
  const available = integrationCatalog.filter(row => row.category === "Point of sale" && integrationPublicStatus(row).tone === "setup");
  return <div className="hp-available"><div><strong>Keep your POS.</strong><span>Supported direct connections on paid plans</span></div>{available.map(row => <a key={row.id} href="#connections"><IntegrationBrandLogo name={row.name} compact/><span>{row.name}</span></a>)}<a href="#connections" className="hp-file-option"><span aria-hidden="true">↥</span><span>CSV / manual entry<small>File option, including Free</small></span></a><a className="hp-text-link" href="#connections">Check compatibility →</a></div>;
}

function OwnerWorkflow() {
  const [step, setStep] = useState(0);
  const [source, setSource] = useState("csv");
  const sequence = useRef<HTMLDivElement>(null), evidence = useRef<HTMLDivElement>(null), manual = useRef(false);
  const motion = useMotionPreference();
  useEffect(() => {
    if (!motion) return;
    let frame = 0;
    const followScroll = () => {
      if (frame || manual.current || !matchMedia("(min-width: 801px)").matches) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const rect = sequence.current?.getBoundingClientRect();
        if (!rect || rect.top >= innerHeight || rect.bottom <= 100) return;
        const progress = (innerHeight * .52 - rect.top) / Math.max(rect.height, 1);
        setStep(Math.max(0, Math.min(2, Math.floor(progress * 3))));
      });
    };
    window.addEventListener("scroll", followScroll, { passive: true });
    return () => { window.removeEventListener("scroll", followScroll); cancelAnimationFrame(frame); };
  }, [motion]);
  useEffect(() => {
    if (!motion || !evidence.current?.animate) return;
    const animation = evidence.current.animate([{ opacity: .65, transform: "translateY(6px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 280, easing: "ease-out" });
    return () => animation.cancel();
  }, [motion, step, source]);
  const steps = [
    { id: "connect", title: "Connect your records", body: "Choose supported CSV or manual entry, or a direct connection on a paid plan. Map locations and review the import.", evidence: "Source → location → reviewed totals", detail: "Start with the records you have. Missing costs or incomplete imports remain visible.", link: "#connections", cta: "Check your source" },
    { id: "understand", title: "Understand the movement", body: "Compare the same period and location. Follow a total back to the records and calculations behind it.", evidence: `${demo.current.purchaseBaskets} transactions × ${money(demo.current.averageBasketCents)} average basket`, detail: `${money(demo.current.netCents)} net sales. Basket display is rounded; source calculations retain exact amounts.`, link: "/demo#retail", cta: "Inspect the sample" },
    { id: "decide", title: "Choose your next step", body: "Review the evidence before making a decision. Paid operations tools let you record actions and review their outcomes.", evidence: "Evidence → your action → outcome review", detail: "Vanteloq supports the review. You approve decisions, spending and changes.", link: "/features/retail-intelligence", cta: "See the retail workflow" },
  ];
  const active = steps[step];
  return <section className="hp-section" id="platform"><SectionHeading eyebrow="A clearer daily review" title="From your records to your next decision."/><div className="hp-workflow" ref={sequence}><div className="hp-workflow-steps" role="group" aria-label="How Vanteloq works">{steps.map((item, index) => <button type="button" key={item.id} aria-pressed={step === index} onClick={() => { manual.current = true; setStep(index); }} data-public-event="story_step_selected" data-public-section="story" data-public-step={item.id}><span>0{index + 1}</span><div><h3>{item.title}</h3><p>{item.body}</p></div></button>)}</div><div className="hp-workflow-evidence" ref={evidence}><span className="hp-status">{active.title}</span><h3>{active.evidence}</h3>{step === 0 && <div className="hp-source-example"><label>Sample source<select value={source} onChange={event => { manual.current = true; setSource(event.target.value); }}><option value="csv">Daily CSV summary</option><option value="receipts">Receipt-level POS records</option></select></label><p>{source === "csv" ? `${demo.coverage.rows} daily rows across two sample shops` : `${demo.current.purchaseBaskets} sample purchase receipts across two shops`}</p><small>Observed coverage: {demo.coverage.days} of 28 days<br/>Sample snapshot: {demo.coverage.snapshot}</small></div>}<p>{active.detail}</p><Link href={active.link}>{active.cta} →</Link><small>Sample store · Fictional records · Two-location paid workspace example</small></div></div></section>;
}

function Questions() {
  const [salesOpen, setSalesOpen] = useState(false), [stockOpen, setStockOpen] = useState(false), [purchase, setPurchase] = useState(false);
  const cash = bookloqDemo(purchase ? 500000 : 0, false, false);
  return <section className="hp-section hp-question-section" id="capabilities"><span id="demo" className="hp-anchor"/><SectionHeading eyebrow="Three questions worth asking" title="The detail that makes the next step clearer.">Explore a fictional example, then open the full demo to check the records.</SectionHeading><div className="hp-questions">
    <article><span className="hp-card-kicker">Sales · Detailed analysis on paid plans</span><h3>Why did sales change?</h3><p>Compare transaction count and basket value before guessing at the cause.</p><div className="hp-question-proof"><span>Net sales change</span><strong>{money(demo.current.netCents - demo.prior.netCents)}</strong><small>May 29 to June 25 vs May 1 to 28, 2026<br/>All sample locations · CAD</small></div><button type="button" className="hp-inline-button" aria-expanded={salesOpen} onClick={() => setSalesOpen(!salesOpen)} data-public-event="demo_engaged" data-public-section="questions" data-public-step="sales">{salesOpen ? "Hide" : "Show"} the breakdown</button>{salesOpen && <div className="hp-proof-detail"><SalesBridge/><p>This describes the arithmetic, not the cause of customer behaviour. Confirm coverage and inspect the receipts.</p></div>}<Link href="/features/retail-intelligence">Explore sales analysis →</Link>
    </article>
    <article><span className="hp-card-kicker">Stock review · Growth and Pro</span><h3>Which stock needs review?</h3><p>Compare recent sales with recorded stock, cover and expiry evidence.</p><div className="hp-question-proof"><span>{demo.stock.name}</span><strong>{demo.stock.daysOfCover?.toFixed(1)} days of cover</strong><small>{demo.stock.onHand} units recorded · Central shop<br/>28-day sales pace · Snapshot June 25, 2026</small></div><button type="button" className="hp-inline-button" aria-expanded={stockOpen} onClick={() => setStockOpen(!stockOpen)} data-public-event="demo_engaged" data-public-section="questions" data-public-step="stock">{stockOpen ? "Hide" : "Check"} the calculation</button>{stockOpen && <div className="hp-proof-detail"><p>{demo.stock.units} units sold ÷ 28 days = {demo.stock.dailyVelocity.toFixed(2)} units per day.</p><p>{demo.stock.onHand} on hand ÷ recent daily pace = {demo.stock.daysOfCover?.toFixed(1)} days. This assumes the same pace; check stock accuracy, lead time and incoming orders.</p></div>}<Link href="/features/inventory-and-cash">Explore stock review →</Link>
    </article>
    <article><span className="hp-card-kicker">Cash planning · BookLoQ required</span><h3>How much cash is committed?</h3><p>Separate recorded obligations from expected money before planning a purchase.</p><div className="hp-question-proof"><span>Capacity after commitments and cash floor</span><strong>{money(cash.purchasingCapacityCents, 0)}</strong><small>As of June 25, 2026 · CAD<br/>Fictional BookLoQ scenario</small></div><button type="button" className="hp-inline-button" aria-pressed={purchase} onClick={() => setPurchase(!purchase)} data-public-event="demo_engaged" data-public-section="questions" data-public-step="cash">{purchase ? "Remove" : "Test"} a $5,000 purchase</button><p className="hp-proof-detail">{money(cash.openingCashCents, 0)} opening cash − {money(cash.confirmedPurchasingObligationsCents, 0)} commitments − {money(cash.safetyThresholdCents, 0)} cash floor. Expected receipts do not increase this capacity.</p><Link href="/demo#bookloq">Explore the BookLoQ scenario →</Link>
    </article></div></section>;
}

function IndustryFit() {
  const [selected, setSelected] = useState<string>("retail"); const fit = INDUSTRY_FITS.find(item => item.id === selected)!;
  return <section className="hp-section hp-fit"><SectionHeading eyebrow="Check the fit" title="Built for retail. Clear about what comes next."/><div role="group" aria-label="Business type" className="hp-selector">{INDUSTRY_FITS.map(item => <button type="button" key={item.id} aria-pressed={selected === item.id} onClick={() => setSelected(item.id)} data-public-event="industry_selected" data-public-section="industries" data-public-industry={item.id}>{item.label}</button>)}</div><div className="hp-fit-panel"><span className="hp-status">{fit.status}</span><h3>{fit.title}</h3><p>{fit.body}</p><Link href={fit.href}>{fit.cta} →</Link></div></section>;
}

function AiExample() {
  const [selected, setSelected] = useState(0);
  const answers = [
    { id: "sales", question: "What changed in sales?", answer: `Recorded net sales fell ${Math.abs((demo.salesChange ?? 0) * 100).toFixed(1)}% between the two 28-day periods. Transactions fell from ${demo.prior.purchaseBaskets} to ${demo.current.purchaseBaskets}; average basket fell from ${money(demo.prior.averageBasketCents)} to ${money(demo.current.averageBasketCents)}. The transaction-count effect explains the larger share. Review source coverage and receipts before assigning a business cause.`, source: "/demo#retail", label: "Review sample sales records", scope: "All sample locations · May 29 to June 25 vs May 1 to 28, 2026" },
    { id: "stock", question: "What should I check in stock?", answer: `Central shop has ${demo.stock.onHand} recorded units of creatine and sold ${demo.stock.units} over 28 days. That is about ${demo.stock.daysOfCover?.toFixed(1)} days of cover at the recent pace. Confirm the stock count, incoming orders and supplier lead time before reordering. This is a review prompt, not an approved purchase.`, source: "/demo#retail", label: "Inspect sample inventory", scope: "Central shop · Stock at June 25, 2026 · 28-day sales pace" },
    { id: "cash", question: "Can I plan a purchase?", answer: `The BookLoQ sample starts with ${money(demo.cash.opening, 0)} cash, ${money(demo.cash.committed, 0)} confirmed commitments and a ${money(demo.cash.threshold, 0)} cash floor. That leaves ${money(demo.cash.capacity, 0)} under these assumptions. Expected receipts do not raise this capacity. Review every obligation and scenario before deciding.`, source: "/demo#bookloq", label: "Inspect the cash assumptions", scope: "BookLoQ scenario · CAD · As of June 25, 2026" },
  ]; const active = answers[selected];
  return <section className="hp-section hp-ai" id="vanteloq-ai"><div><VanteloqAiLogo size={52} decorative/><SectionHeading eyebrow="Vanteloq AI" title="Ask a question. Keep the source in view.">Use permitted business context to support your review. Your judgement stays central.</SectionHeading><p className="hp-muted">Free includes 10 basic AI replies per month. Detailed retail and BookLoQ context depend on your plan and records.</p></div><div className="hp-ai-example"><p className="hp-card-kicker">Scripted product illustration · Sample data</p><div className="hp-ai-questions" role="group" aria-label="Example AI question">{answers.map((item, index) => <button type="button" key={item.id} aria-pressed={selected === index} onClick={() => setSelected(index)} data-public-event="ai_example_selected" data-public-section="ai" data-public-step={item.id}>{item.question}</button>)}</div><div className="hp-ai-answer"><strong>{active.question}</strong><p>{active.answer}</p><small>{active.scope}</small><Link href={active.source}>{active.label} →</Link></div><small>Scripted, not a live AI response. AI can be wrong and cannot post, pay or approve decisions.</small></div></section>;
}

function Goals() {
  const [selected, setSelected] = useState("sales");
  const values = [{ key: "sales", label: "Net sales", actual: demo.current.netCents / 100, target: 30000 }, { key: "transactions", label: "Transactions", actual: demo.current.purchaseBaskets, target: 500 }, { key: "margin", label: "Gross margin", actual: demo.current.grossProfitCents! / demo.current.netCents * 100, target: 55 }];
  const goals = values.map(item => ({ ...item, ...goalResult(item.actual, item.target, { direction: "higher", from: demo.period.from, to: demo.period.to, locationId: null }, { from: demo.period.from, to: demo.period.to, locationId: null, eligible: true }) }));
  const active = goals.find(item => item.key === selected)!;
  return <section className="hp-section hp-goals"><div><p className="hp-eyebrow">Your priorities, in context</p><h2>Give the numbers a target.</h2><p>Keep your goal beside the same period and location. These targets are illustrative, not promised results.</p></div><div className="hp-goal-control"><InteractiveGoalRings goals={goals} selected={selected} onSelect={setSelected} label="Select an illustrative sample goal"/><div><strong>{active.label}</strong><p>{active.key === "sales" ? money(active.actual * 100, 0) : active.actual.toFixed(active.key === "margin" ? 1 : 0) + (active.key === "margin" ? "%" : "")} of {active.key === "sales" ? money(active.target * 100, 0) : active.target + (active.key === "margin" ? "%" : "")} target</p><SampleContext/></div></div></section>;
}

export function HomepagePricing() { return <section className="hp-section" id="plans"><SectionHeading eyebrow="Start with Free" title="A clear starting point. Room to add more.">Choose the tools you need today. Compare the complete plan limits before upgrading.</SectionHeading><div className="hp-pricing"><article className="hp-free-card"><span className="hp-card-kicker">No expiry · No card required</span><h3>Free</h3><strong className="hp-price">$0 <small>CAD</small></strong><ul>{FREE_PLAN.highlights.map(item => <li key={item}>{item}</li>)}</ul><a className="hp-primary" href={planSelectionUrl({ plan: "free", bookloq: false })} data-public-event="plan_selected" data-public-section="pricing" data-public-plan="free">Start Free</a></article><div className="hp-paid-summary">{[PLANS.starter, PLANS.growth, PLANS.pro].map(plan => <div key={plan.key}><span><strong>{plan.displayName}</strong><small>{plan.limits.users} users · {plan.limits.activeLocations} {plan.limits.activeLocations === 1 ? "location" : "locations"}</small></span><span><strong>${plan.prices.month.amountCents / 100}</strong><small>CAD / month</small></span></div>)}<p>Paid plans add supported connections and deeper tools. Your first eligible paid subscription includes a <strong>7-day trial with a payment method required</strong>, then renews monthly unless cancelled before the charge shown at checkout.</p><p>BookLoQ: ${ADDONS.bookloq.prices.month.amountCents / 100} CAD/month with a paid Vanteloq plan, or ${PLANS.bookloq.prices.month.amountCents / 100} on its own. Not included in Free.</p><Link href="/pricing" data-public-event="pricing_view" data-public-section="pricing">Compare all plans and features →</Link><small>Monthly prices, plus applicable taxes. No new annual purchases.</small></div></div></section>; }

export default function HomepageLanding({ start, retail = false }: { start?: (mode: "signin" | "signup") => void; retail?: boolean }) {
  return <div className="public-site hp-site"><a href="#main-content" className="hp-skip">Skip to content</a><PublicPageNav signIn={start ? () => start("signin") : undefined}/><main id="main-content">
    <section className="hp-hero"><div className="hp-hero-copy"><p className="hp-eyebrow">{retail ? RETAIL_LANDING.eyebrow : "Business analytics for independent retailers"}</p><h1>{retail ? RETAIL_LANDING.title : "See what is happening. Know what to do next."}</h1><p className="hp-hero-lead">{retail ? RETAIL_LANDING.description : "Understand sales and stock in Vanteloq. Add BookLoQ for finance and cash planning."}</p><p className="hp-hero-plan">Start with daily sales summaries on Free. Add supported connections and deeper tools when you need them.</p><Actions section={retail ? "retail_landing" : "hero"}/><p className="hp-cta-note">No card required for Free.<br/>Explore the demo without signing up.</p><a className="hp-text-link" href="#connections">Keep your POS. Check supported connections →</a></div><HomepageStory/></section>
    <AvailableConnections/>
    {retail && <section className="hp-section hp-retail-problems"><SectionHeading eyebrow="The retail day" title="Less hunting for totals. More informed review."/><div>{RETAIL_LANDING.problems.map(([title, body]) => <article key={title}><h3>{title}</h3><p>{body}</p></article>)}</div></section>}
    <OwnerWorkflow/><Questions/>{!retail && <IndustryFit/>}<AiExample/><Goals/>
    <section className="hp-section hp-operator"><p className="hp-eyebrow">Built around decisions you can check</p><h2>Evidence before confidence.</h2><div><p>Vanteloq is owned and operated by LexEdge Consulting. The product connects records, calculations and your review so a useful-looking number is not the end of the story.</p><p>Try the same fictional sample in the full demo. Change the location, inspect source gaps, and see what the result can and cannot support.</p><Link href="/demo">Review the product yourself →</Link></div></section>
    <section className="hp-section" id="connections"><SectionHeading eyebrow="Connection availability" title="Check your exact system before you start.">Direct POS connections require a paid plan. CSV and manual daily entry are available on Free within its monthly allowance. Slack is a collaboration connection for confirmed link sharing, not a POS source or automatic alerts.</SectionHeading><details className="hp-connection-directory"><summary>Browse all connections and setup requirements</summary><CompatibilityCheck/></details><p className="hp-muted">Available POS connections are shown above. Other providers remain labelled Coming Soon until available. Access depends on your provider, edition, permissions, region and plan.</p></section>
    <HomepagePricing/>
    <section className="hp-section hp-trust" id="security"><SectionHeading eyebrow="Your records, your review" title="Know the boundaries before connecting."/><div><article><h3>Reviewable evidence</h3><p>Source coverage and missing inputs affect a result. Review the import and assumptions before relying on it.</p><Link href="/help">Read setup guidance →</Link></article><article><h3>Access by role</h3><p>Workspace access and financial tools depend on permissions. Review the terms for your records and service providers.</p><Link href="/data-processing">Read data processing terms →</Link></article><article><h3>Clear account controls</h3><p>Read how personal information is handled and how to request deletion or support.</p><Link href="/privacy">Read the Privacy Notice →</Link></article></div></section>
    <section className="hp-section hp-faq"><SectionHeading eyebrow="Before you begin" title={retail ? "Questions from a retail review." : "A few useful answers."}/>{(retail ? RETAIL_FAQS : HOME_FAQS).map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}<p>Need help with your specific source? <Link href="/contact">Contact us</Link>.</p></section>
    <section className="hp-final"><p className="hp-eyebrow">Start with one clearer view</p><h2>See your business more clearly.</h2><p>Bring your daily records to Free, or explore the fictional demo first.</p><Actions section="final_cta"/><small>Free has no expiry. No card required.</small></section>
  </main><PublicFooter/></div>;
}
