"use client";
import { useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { demoAnalysis } from "../domain/product-demo";
import { bookloqDemo } from "../domain/bookloq-demo";
import VanteloqAiLogo from "./vanteloq-ai-logo";
import "./feature-carousel.css";

const money = (cents: number) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(cents / 100);
const slides = [
  { label: "Sales analytics", title: "Why was this week down?", copy: "Compare product mix, discounts and locations. Open the records behind the change.", href: "/demo#retail", cta: "Explore your sales" },
  { label: "Inventory planning", title: "What could expire before it sells?", copy: "Review stock cover, expiry and reorder needs before committing more cash.", href: "/demo#inventory", cta: "Inspect stock risks" },
  { label: "BookLoQ accounting", title: "Can I afford the next order?", copy: "Review bills, expected cash and a 13-week forecast before making a commitment.", href: "/demo#bookloq", cta: "Try the cash forecast" },
  { label: "Vanteloq AI", title: "What are my numbers telling me?", copy: "Ask about permitted business information, or get help using the app. You decide what to share.", href: "#vanteloq-ai", cta: "Meet Vanteloq AI" },
] as const;

function Preview({ index }: { index: number }) {
  const [mode, setMode] = useState(false);
  const analysis = useMemo(() => demoAnalysis("all", "complete"), []);
  const flow = useMemo(() => bookloqDemo(mode ? 1200000 : 400000, false, false), [mode]);
  if (index === 0) {
    const values = analysis.weeks.map(week => mode ? week.salesCents / 7 : week.salesCents);
    // The second view changes units only, never invents an additional financial measure.
    const maximum = Math.max(...values, 1);
    return <div className="feature-preview"><header><span>Weekly net sales</span><button type="button" aria-pressed={mode} onClick={() => setMode(!mode)}>{mode ? "Show weekly total" : "Show daily average"}</button></header><strong>{money(mode ? analysis.kpis.current!.netSalesCents! / 28 : analysis.kpis.current!.netSalesCents!)}</strong><small>{mode ? "Average per calendar day" : "28-day net sales"} · CAD</small><div className="feature-preview-bars">{analysis.weeks.map((week, i) => <div key={week.from}><span>{money(mode ? week.salesCents / 7 : week.salesCents)}</span><i style={{ height: `${values[i] / maximum * 92}px` }}/><small>Week {i + 1}</small></div>)}</div></div>;
  }
  if (index === 1) return <div className="feature-preview"><header><span>Stock cover</span><button type="button" aria-pressed={mode} onClick={() => setMode(!mode)}>{mode ? "View all stock" : "Focus on low cover"}</button></header><strong>{mode ? "7 days" : "3 products"}</strong><small>Illustrative stock at the current selling pace</small><div className="feature-stock-rows">{[{ name: "Protein powder", stock: 84, daily: 12 }, { name: "Creatine", stock: 120, daily: 6 }, { name: "Electrolytes", stock: 90, daily: 3 }].filter(row => !mode || row.stock / row.daily < 14).map(row => <div key={row.name}><span>{row.name}<small>{row.stock} units ÷ {row.daily} sold per day</small></span><b>{row.stock / row.daily} days</b></div>)}</div></div>;
  if (index === 2) return <div className="feature-preview"><header><span>Cash after commitments</span><button type="button" aria-pressed={mode} onClick={() => setMode(!mode)}>{mode ? "Try $4,000 order" : "Try $12,000 order"}</button></header><strong>{money(flow.weeks.at(-1)!.conservativeClosingCashCents!)}</strong><small>Week 13 · Confirmed items only</small><dl className="feature-cash-rows"><div><dt>Opening cash</dt><dd>$30,000</dd></div><div><dt>Existing bills</dt><dd>−$12,000</dd></div><div><dt>Proposed order</dt><dd>{mode ? "−$12,000" : "−$4,000"}</dd></div></dl><p>Expected receipts stay separate from confirmed cash.</p></div>;
  return <div className="feature-preview feature-ai-preview"><header><span>Vanteloq AI</span><VanteloqAiLogo size={32} decorative/></header><strong>Ask the next question.</strong><div className="feature-question">{mode ? "What information do I need before placing this order?" : "Which products and discounts explain the change in sales?"}</div><button type="button" onClick={() => setMode(!mode)}>Try another example →</button><small>Example questions, not a generated answer. AI uses only information you permit.</small></div>;
}

export default function FeatureCarousel() {
  const id = useId();
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const select = (index: number) => {
    const element = track.current?.children[index] as HTMLElement | undefined;
    if (!element || !track.current) return;
    track.current.scrollTo({ left: element.offsetLeft - (track.current.children[0] as HTMLElement).offsetLeft, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };
  return <div className="feature-carousel" role="region" aria-roledescription="carousel" aria-label="Explore Vanteloq features">
    <div className="feature-carousel-toolbar"><p>Explore what you can do <span>Swipe or use the arrows</span></p><div><button type="button" aria-label="Previous feature" aria-controls={id} disabled={active === 0} onClick={() => select(active - 1)}>←</button><button type="button" aria-label="Next feature" aria-controls={id} disabled={active === slides.length - 1} onClick={() => select(active + 1)}>→</button></div></div>
    <div className="feature-carousel-track" ref={track} id={id} onScroll={() => { const el = track.current; if (!el) return; const first = el.children[0] as HTMLElement; const index = Array.from(el.children).reduce((best, item, i) => Math.abs((item as HTMLElement).offsetLeft - first.offsetLeft - el.scrollLeft) < Math.abs((el.children[best] as HTMLElement).offsetLeft - first.offsetLeft - el.scrollLeft) ? i : best, 0); setActive(index); }}>
      {slides.map((slide, index) => <article key={slide.label} className="feature-slide" role="group" aria-roledescription="slide" aria-label={`${index + 1} of ${slides.length}: ${slide.label}`}><div className="feature-slide-copy"><span>{slide.label}</span><h3>{slide.title}</h3><p>{slide.copy}</p><Link href={slide.href}>{slide.cta} <span aria-hidden="true">↗</span></Link><small>Interactive example · Fictional data</small></div><Preview index={index}/></article>)}
    </div>
    <div className="feature-carousel-pagination"><span aria-live="polite" aria-atomic="true">{active + 1} / {slides.length} · {slides[active].label}</span><div>{slides.map((slide,index) => <button type="button" key={slide.label} aria-label={`Show ${slide.label}`} aria-current={active === index ? "true" : undefined} onClick={() => select(index)}><i/></button>)}</div></div>
  </div>;
}
