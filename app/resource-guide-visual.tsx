/** Decorative editorial diagrams. No chart here represents customer records. */
export default function ResourceGuideVisual({ category, slug }: { category: string; slug: string }) {
  const kind = slug.includes("cash-flow") ? "cash" : slug.includes("bookkeeping") ? "ledger" : category === "finance" ? "margin" : category;
  const title = { inventory: "Stock, with context", margin: "Know your margin", cash: "Follow the cash", ledger: "From receipt to report", analytics: "Turn evidence into action" }[kind] ?? "Turn evidence into action";
  return <div className={`home-resource-art ${category}-art guide-${kind}`} aria-hidden="true">
    <div className="guide-visual-heading"><span>{title}</span><svg viewBox="0 0 24 24" fill="none"><path d="M5 18V6h14v12H5Z M8 10h8 M8 14h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></div>
    {kind === "inventory" ? <div className="guide-stock-diagram">{["Received", "Sold", "On hand"].map((label, index) => <div key={label}><div className="guide-stock-bars"><i style={{height: `${[58, 24, 38][index]}px`}}/></div><span>{label}</span></div>)}</div>
    : kind === "margin" ? <div className="guide-equation"><div><span>Net sales</span><i/></div><b>−</b><div><span>Product cost</span><i/></div><b>=</b><div><span>Gross profit</span><i/></div></div>
    : kind === "cash" ? <div className="guide-cash-diagram"><div><span>Money in</span><b>↓</b></div><div><span>Cash balance</span><svg viewBox="0 0 140 50"><path d="M1 34L25 26L48 30L72 12L96 20L119 9L139 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round"/></svg></div><div><span>Money out</span><b>↑</b></div></div>
    : <div className="guide-process-diagram">{(kind === "ledger" ? ["Document", "Reconcile", "Report"] : ["Records", "Compare", "Decide"]).map((label, index) => <div key={label}><svg viewBox="0 0 40 32" fill="none">{index === 0 ? <path d="M10 3h20v26H10z M15 10h10 M15 16h10 M15 22h6"/> : index === 1 ? <path d="M8 25V16 M20 25V7 M32 25V12 M5 28h30"/> : <path d="M10 16l7 7L31 8 M6 5h9 M5 5v24h28v-9"/>}</svg><span>{label}</span></div>)}</div>}
  </div>;
}
