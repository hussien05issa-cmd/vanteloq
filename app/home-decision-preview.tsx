"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { demoAnalysis, type DemoLocation } from "../domain/product-demo";
import VanteloqAiLogo from "./vanteloq-ai-logo";
const money = (value: number) => new Intl.NumberFormat("en-CA",{style:"currency",currency:"CAD",maximumFractionDigits:0}).format(value/100);
export default function HomeDecisionPreview() {
  const [location, setLocation] = useState<DemoLocation>("all");
  const {kpis,weeks} = useMemo(() => demoAnalysis(location,"complete"),[location]);
  return <div className="home-live-proof"><header><div><span className="home-proof-dot"/><strong>Northline Retail</strong></div><span>SAMPLE WORKSPACE</span></header>
    <div className="home-live-proof-top"><div><small>NET SALES · MAY 29 TO JUN 25</small><strong>{money(kpis.current!.netSalesCents!)}</strong><span>{kpis.salesChangePercent!.toFixed(1)}% vs previous 28 days</span></div><label><span className="sr-only">Sample location</span><select aria-label="Sample location" value={location} data-public-event="demo_engaged" onChange={event => setLocation(event.target.value as DemoLocation)}><option value="all">Both shops</option><option value="central">Central shop</option><option value="riverside">Riverside shop</option></select></label></div>
    <div className="home-proof-chart" role="img" aria-label="Weekly sample net sales">{weeks.map(week=><div key={week.label}><span>{money(week.salesCents)}</span><i style={{height:Math.max(10,week.salesCents/Math.max(...weeks.map(w=>w.salesCents))*110)}}/><small>{week.label}</small></div>)}</div>
    <div className="home-proof-insight"><VanteloqAiLogo size={34} decorative/><div><strong>What changed behind the total?</strong><p>Compare baskets, product mix and discounts. Follow each result back to its records.</p><Link href={"/demo?location=" + location + "#retail"} data-public-event="demo_engaged">Show me why <span aria-hidden="true">↗</span></Link></div></div>
    <footer>Fictional records · Working calculations · Try the location selector</footer>
  </div>;
}
