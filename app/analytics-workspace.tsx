"use client";

import { useMemo, useState } from "react";

type Props = { showNotice: (message: string) => void; navigate: (view: string) => void };
type Lens = "Executive" | "Profit drivers" | "Products" | "Customers" | "Operations";
type AnalyticsModel = { net:number; gross:number; discounts:number; returns:number; cogs:number; profit:number; margin:number; transactions:number; aov:number; baseTrend:number[]; priorTrend:number[] };

const cad = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });
const compactCad = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", notation: "compact", maximumFractionDigits: 1 });

const trendShape = [0.84, 0.91, 0.88, 0.97, 1.02, 0.96, 1.09, 1.13, 1.08, 1.17, 1.15, 1.24, 1.21, 1.31];
const priorShape = [0.82, 0.87, 0.9, 0.92, 0.96, 0.98, 1.01, 1.04, 1.08, 1.06, 1.11, 1.13, 1.16, 1.17];
const products = [
  { name: "Cadence Hydration · Melonberry", category: "Hydration", revenue: 5842, profit: 2314, units: 188, margin: 39.6, velocity: 6.7, signal: "Reorder" },
  { name: "Ghost Whey · Cinnabon", category: "Protein", revenue: 4916, profit: 1578, units: 82, margin: 32.1, velocity: 2.9, signal: "Growing" },
  { name: "SW Bulk · Birthday Cake", category: "Protein", revenue: 3728, profit: 1316, units: 109, margin: 35.3, velocity: 3.9, signal: "Core" },
  { name: "ANS Creatine Gummies", category: "Performance", revenue: 2844, profit: 1132, units: 74, margin: 39.8, velocity: 2.6, signal: "Growing" },
  { name: "Rabeko Sauce · Teriyaki", category: "Food", revenue: 712, profit: 186, units: 31, margin: 26.1, velocity: 0.4, signal: "Markdown" },
];

const segments = [
  { name: "Champions", customers: 148, revenue: 19760, aov: 78, frequency: 4.8, retention: 82, share: 31 },
  { name: "Loyal", customers: 382, revenue: 22840, aov: 64, frequency: 3.2, retention: 68, share: 36 },
  { name: "New", customers: 296, revenue: 10820, aov: 53, frequency: 1.2, retention: 31, share: 17 },
  { name: "At risk", customers: 94, revenue: 7420, aov: 71, frequency: 2.7, retention: 18, share: 12 },
  { name: "Lapsed", customers: 181, revenue: 2480, aov: 49, frequency: 1.1, retention: 4, share: 4 },
];

const heat = [
  [12, 18, 24, 31, 38, 27, 19], [18, 28, 42, 49, 54, 43, 29], [25, 39, 57, 64, 71, 67, 45],
  [31, 48, 66, 74, 81, 89, 61], [28, 43, 63, 72, 86, 96, 74], [17, 32, 51, 59, 73, 82, 58],
];

function linePoints(values: number[], width = 620, height = 174) {
  const min = Math.min(...values) * 0.94;
  const max = Math.max(...values) * 1.04;
  return values.map((value, index) => `${(index / (values.length - 1)) * width},${height - ((value - min) / (max - min)) * height}`).join(" ");
}

export default function AnalyticsWorkspace({ showNotice, navigate }: Props) {
  const [lens, setLens] = useState<Lens>("Executive");
  const [period, setPeriod] = useState("30 days");
  const [location, setLocation] = useState("Newcastle");
  const [channel, setChannel] = useState("All channels");
  const [compare, setCompare] = useState(true);
  const [metric, setMetric] = useState("Net sales");
  const [productSort, setProductSort] = useState<"revenue" | "profit" | "margin">("profit");

  const model = useMemo(() => {
    const periodFactor = period === "7 days" ? 0.25 : period === "Quarter" ? 3.08 : period === "Year to date" ? 7.15 : 1;
    const locationFactor = location === "All locations" ? 1.34 : 1;
    const channelFactor = channel === "In-store" ? 0.91 : channel === "Online" ? 0.09 : 1;
    const scale = periodFactor * locationFactor * channelFactor;
    const net = 67540 * scale;
    const gross = net / 0.947;
    const discounts = gross * 0.041;
    const returns = gross * 0.012;
    const cogs = net * 0.641;
    const profit = net - cogs;
    const transactions = Math.round(1086 * scale);
    const baseTrend = trendShape.map((shape) => (net / trendShape.length) * shape);
    const priorTrend = priorShape.map((shape) => (net / trendShape.length / 1.124) * shape);
    return { net, gross, discounts, returns, cogs, profit, margin: profit / net * 100, transactions, aov: net / transactions, baseTrend, priorTrend };
  }, [period, location, channel]);

  const sortedProducts = [...products].sort((a, b) => b[productSort] - a[productSort]);
  const activeTrend = metric === "Gross profit" ? model.baseTrend.map(v => v * .359) : metric === "Transactions" ? model.baseTrend.map(v => v / model.aov) : model.baseTrend;
  const activePrior = metric === "Gross profit" ? model.priorTrend.map(v => v * .348) : metric === "Transactions" ? model.priorTrend.map(v => v / (model.aov / 1.048)) : model.priorTrend;

  return <div className="content intelligence-page">
    <section className="intel-head">
      <div>
        <div className="intel-kicker"><span>V</span> VANTELOQ INTELLIGENCE</div>
        <h2>From business data to the next best decision.</h2>
        <p>See the outcome, isolate the driver, and turn the signal into assigned work—without changing screens or rebuilding the analysis.</p>
      </div>
      <aside className="intel-brief">
        <div><small>PERFORMANCE BRIEF</small><span className="intel-score">82 <em>/100</em></span></div>
        <strong>Profit is outpacing sales.</strong>
        <p>Hydration mix and higher order value added <b>{cad.format(model.profit * .086)}</b> in gross profit. Promo discounting remains the largest controllable drag.</p>
        <button onClick={() => showNotice("Executive brief added to Reports")}>Save to owner report <span>→</span></button>
      </aside>
    </section>

    <section className="intel-controlbar" aria-label="Analytics filters">
      <div className="intel-lenses" role="tablist">{(["Executive", "Profit drivers", "Products", "Customers", "Operations"] as Lens[]).map(item => <button role="tab" aria-selected={lens === item} className={lens === item ? "active" : ""} key={item} onClick={() => setLens(item)}>{item}</button>)}</div>
      <div className="intel-filters">
        <label><span>Period</span><select value={period} onChange={e => setPeriod(e.target.value)}><option>7 days</option><option>30 days</option><option>Quarter</option><option>Year to date</option></select></label>
        <label><span>Location</span><select value={location} onChange={e => setLocation(e.target.value)}><option>Newcastle</option><option>All locations</option></select></label>
        <label><span>Channel</span><select value={channel} onChange={e => setChannel(e.target.value)}><option>All channels</option><option>In-store</option><option>Online</option></select></label>
        <button className={compare ? "intel-compare active" : "intel-compare"} onClick={() => setCompare(value => !value)}><i /> Compare prior period</button>
      </div>
      <div className="intel-source"><span><i /> DEMO MODEL</span><b>POS + CSV ready</b><small>Updated 8 min ago</small></div>
    </section>

    {lens === "Executive" && <>
      <section className="intel-kpis">
        <IntelKpi label="Net sales" value={cad.format(model.net)} delta="+12.4%" note={`${model.transactions.toLocaleString()} transactions`} spark={[38,45,42,51,58,55,67]} />
        <IntelKpi label="Gross profit" value={cad.format(model.profit)} delta="+15.8%" note={`${model.margin.toFixed(1)}% gross margin`} spark={[31,39,36,48,52,61,70]} />
        <IntelKpi label="Average order" value={cad.format(model.aov)} delta="+4.8%" note="2.04 units per order" spark={[46,43,51,49,55,58,62]} />
        <IntelKpi label="Repeat revenue" value="38.4%" delta="+3.1 pts" note="$25.9k from returning customers" spark={[33,36,39,42,47,51,56]} />
        <IntelKpi label="Cash in inventory" value={compactCad.format(84260 * (location === "All locations" ? 1.34 : 1))} delta="2.84× GMROI" note="$7.3k aged over 90 days" spark={[62,60,58,55,53,51,49]} neutral />
      </section>

      <section className="intel-main-grid">
        <article className="intel-card intel-trend-card">
          <div className="intel-card-head"><div><span>PERFORMANCE MOVEMENT</span><h3>{metric} trend</h3><p>Current period against the preceding equal-length period</p></div><select value={metric} onChange={e => setMetric(e.target.value)}><option>Net sales</option><option>Gross profit</option><option>Transactions</option></select></div>
          <div className="intel-chart-total"><strong>{metric === "Net sales" ? cad.format(model.net) : metric === "Gross profit" ? cad.format(model.profit) : model.transactions.toLocaleString()}</strong><span>+12.4%</span><small>vs prior period</small></div>
          <div className="intel-line-chart"><div className="intel-gridlines"><i/><i/><i/><i/></div><svg viewBox="0 0 620 174" preserveAspectRatio="none" role="img" aria-label={`${metric} current and prior period trend`}>
            {compare && <polyline className="prior-line" points={linePoints(activePrior)} />}
            <polyline className="current-line" points={linePoints(activeTrend)} />
            <circle cx="620" cy={linePoints(activeTrend).split(" ").at(-1)?.split(",")[1]} r="5" />
          </svg><div className="intel-axis"><span>Start</span><span>Week 1</span><span>Week 2</span><span>Latest</span></div></div>
          <div className="intel-chart-legend"><span><i /> Current</span>{compare && <span><i className="prior" /> Prior</span>}<button onClick={() => navigate("Reports")}>Open daily ledger →</button></div>
        </article>
        <DecisionQueue showNotice={showNotice} />
      </section>

      <section className="intel-two-col">
        <ProfitBridge model={model} />
        <ForecastCard net={model.net} profit={model.profit} />
      </section>

      <section className="intel-two-col intel-bottom-row">
        <ProductLeaderboard products={sortedProducts} sort={productSort} setSort={setProductSort} navigate={navigate} />
        <CustomerMix navigate={navigate} />
      </section>
    </>}

    {lens === "Profit drivers" && <ProfitDrivers model={model} showNotice={showNotice} navigate={navigate} />}
    {lens === "Products" && <ProductAnalysis products={sortedProducts} sort={productSort} setSort={setProductSort} showNotice={showNotice} navigate={navigate} />}
    {lens === "Customers" && <CustomerAnalysis showNotice={showNotice} navigate={navigate} />}
    {lens === "Operations" && <OperationsAnalysis showNotice={showNotice} navigate={navigate} />}
  </div>;
}

function IntelKpi({ label, value, delta, note, spark, neutral = false }: { label: string; value: string; delta: string; note: string; spark: number[]; neutral?: boolean }) {
  const max = Math.max(...spark); return <article className="intel-kpi"><div><span>{label}</span><button aria-label={`Metric definition: ${label}`}>i</button></div><strong>{value}</strong><p><em className={neutral ? "neutral" : ""}>{delta}</em>{note}</p><div className="intel-spark" aria-hidden>{spark.map((v, i) => <i key={i} style={{ height: `${v / max * 100}%` }} />)}</div></article>;
}

function DecisionQueue({ showNotice }: { showNotice: (message: string) => void }) {
  const decisions = [
    { tone: "urgent", label: "PROTECT REVENUE", title: "Reorder Cadence today", copy: "6 days of cover; projected stockout before the next standard delivery.", value: "$1,240 at risk", action: "Create reorder task" },
    { tone: "opportunity", label: "GROW PROFIT", title: "Shift the feature table to hydration", copy: "A 3-point category mix shift is worth about $410 in monthly profit.", value: "+$410 upside", action: "Add merchandising task" },
    { tone: "watch", label: "CONTROL LEAKAGE", title: "Review blanket 15% discounts", copy: "42% of discounted orders would likely have converted at a lower offer.", value: "$684 recoverable", action: "Open promotion review" },
  ];
  return <article className="intel-card decision-card"><div className="intel-card-head"><div><span>DECISION QUEUE</span><h3>Actions ranked by impact</h3><p>Signal strength × value × urgency</p></div><b className="decision-count">3</b></div><div>{decisions.map(item => <section className={`decision-item ${item.tone}`} key={item.title}><span className="decision-mark">{item.tone === "urgent" ? "!" : item.tone === "opportunity" ? "↗" : "◷"}</span><div><small>{item.label}</small><strong>{item.title}</strong><p>{item.copy}</p><button onClick={() => showNotice(`${item.action} added to Action Centre`)}>{item.action} →</button></div><em>{item.value}</em></section>)}</div></article>;
}

function ProfitBridge({ model }: { model: { gross:number; discounts:number; returns:number; net:number; cogs:number; profit:number } }) {
  const bars = [
    { name: "Gross sales", value: model.gross, type: "base", height: 100 },
    { name: "Discounts", value: -model.discounts, type: "drag", height: model.discounts / model.gross * 300 },
    { name: "Returns", value: -model.returns, type: "drag", height: model.returns / model.gross * 300 },
    { name: "Net sales", value: model.net, type: "subtotal", height: model.net / model.gross * 100 },
    { name: "COGS", value: -model.cogs, type: "cost", height: model.cogs / model.gross * 100 },
    { name: "Gross profit", value: model.profit, type: "result", height: model.profit / model.gross * 100 },
  ];
  return <article className="intel-card bridge-card"><div className="intel-card-head"><div><span>PROFIT BRIDGE</span><h3>How sales became gross profit</h3><p>CAD · filtered period</p></div><b>{(model.profit / model.gross * 100).toFixed(1)}¢</b></div><div className="bridge-chart">{bars.map(bar => <div className={`bridge-column ${bar.type}`} key={bar.name}><strong>{bar.value < 0 ? "−" : ""}{compactCad.format(Math.abs(bar.value))}</strong><i style={{height:`${Math.max(9, bar.height)}%`}}/><span>{bar.name}</span></div>)}</div><footer><span>For every $1.00 in gross sales</span><b>{(model.profit / model.gross).toFixed(2)} retained before operating expenses</b></footer></article>;
}

function ForecastCard({ net, profit }: { net: number; profit: number }) {
  const target = net * .96; const forecast = net * 1.048;
  return <article className="intel-card forecast-card"><div className="intel-card-head"><div><span>PACE & FORECAST</span><h3>Where the period is heading</h3><p>Run-rate estimate · not a guarantee</p></div><span className="confidence">78% confidence</span></div><div className="forecast-hero"><small>PROJECTED NET SALES</small><strong>{cad.format(forecast)}</strong><span>{cad.format(forecast - target)} above plan</span></div><div className="forecast-track"><i style={{width:"76%"}}/><b style={{left:"68%"}}>Plan</b></div><div className="forecast-grid"><span><small>Plan</small><b>{cad.format(target)}</b></span><span><small>Current pace</small><b>{cad.format(net)}</b></span><span><small>Profit forecast</small><b>{cad.format(profit * 1.061)}</b></span></div><p className="forecast-note"><b>Watch:</b> the forecast assumes Saturday demand remains within 8% of its four-week average.</p></article>;
}

function ProductLeaderboard({ products, sort, setSort, navigate }: { products: typeof products; sort: "revenue"|"profit"|"margin"; setSort:(v:"revenue"|"profit"|"margin")=>void; navigate:(v:string)=>void }) {
  return <article className="intel-card leaderboard-card"><div className="intel-card-head"><div><span>PRODUCT ECONOMICS</span><h3>SKUs creating the most value</h3><p>Ranked by {sort}</p></div><select value={sort} onChange={e=>setSort(e.target.value as "revenue"|"profit"|"margin")}><option value="profit">Gross profit</option><option value="revenue">Revenue</option><option value="margin">Margin</option></select></div><div className="leader-head"><span>Product</span><span>Revenue</span><span>Profit</span><span>Margin</span></div>{products.slice(0,4).map((product,index)=><div className="leader-row" key={product.name}><b>{index+1}</b><span><strong>{product.name}</strong><small>{product.category} · {product.units} units</small></span><em>{cad.format(product.revenue)}</em><em>{cad.format(product.profit)}</em><em>{product.margin.toFixed(1)}%</em></div>)}<button className="intel-card-action" onClick={()=>navigate("Inventory")}>Open SKU intelligence →</button></article>;
}

function CustomerMix({ navigate }: { navigate:(v:string)=>void }) {
  return <article className="intel-card customer-mix-card"><div className="intel-card-head"><div><span>CUSTOMER VALUE</span><h3>Revenue by lifecycle segment</h3><p>Known customer revenue · 30-day view</p></div></div><div className="segment-stack" aria-label="Revenue mix by customer segment">{segments.slice(0,4).map((segment,index)=><i key={segment.name} style={{width:`${segment.share}%`}} className={`segment-${index}`} title={`${segment.name}: ${segment.share}%`}/>)}</div><div className="segment-list">{segments.slice(0,4).map((segment,index)=><div key={segment.name}><i className={`segment-${index}`}/><span><b>{segment.name}</b><small>{segment.customers} customers</small></span><strong>{segment.share}%</strong><em>{cad.format(segment.revenue)}</em></div>)}</div><div className="customer-alert"><span>!</span><p><b>18 high-value customers are becoming inactive.</b> Their trailing revenue is $6,840.</p></div><button className="intel-card-action" onClick={()=>navigate("Customers")}>Open customer intelligence →</button></article>;
}

function ProfitDrivers({ model, showNotice, navigate }: { model:AnalyticsModel; showNotice:(m:string)=>void; navigate:(v:string)=>void }) {
  const drivers = [{name:"Hydration mix",value:1460,kind:"gain"},{name:"Higher AOV",value:910,kind:"gain"},{name:"More transactions",value:740,kind:"gain"},{name:"Discount depth",value:-684,kind:"loss"},{name:"Returns",value:-212,kind:"loss"},{name:"Supplier cost",value:-394,kind:"loss"}];
  return <div className="intel-lens-layout"><section className="intel-kpis"><IntelKpi label="Gross profit" value={cad.format(model.profit)} delta="+15.8%" note={`${model.margin.toFixed(1)}% margin`} spark={[33,38,42,48,55,61,70]}/><IntelKpi label="Contribution lift" value="+$1,820" delta="+8.6%" note="vs prior period" spark={[28,34,39,44,52,58,66]}/><IntelKpi label="Discount drag" value={cad.format(model.discounts)} delta="4.1% of gross" note="$684 recoverable" spark={[42,47,45,51,54,58,61]} neutral/><IntelKpi label="Return drag" value={cad.format(model.returns)} delta="1.2% rate" note="within 1.5% guardrail" spark={[48,45,44,42,39,38,36]} neutral/></section><section className="intel-two-col"><ProfitBridge model={model}/><article className="intel-card driver-rank"><div className="intel-card-head"><div><span>PERIOD-OVER-PERIOD DRIVERS</span><h3>What changed gross profit</h3><p>Estimated contribution · CAD</p></div></div>{drivers.map(driver=><div key={driver.name}><span>{driver.name}</span><i><b className={driver.kind} style={{width:`${Math.abs(driver.value)/1460*100}%`}}/></i><strong className={driver.kind}>{driver.value>0?"+":"−"}{cad.format(Math.abs(driver.value))}</strong></div>)}</article></section><section className="intel-two-col"><article className="intel-card leakage-table"><div className="intel-card-head"><div><span>MARGIN LEAKAGE</span><h3>Discounts that need a decision</h3><p>Offer economics after COGS</p></div><button onClick={()=>navigate("Marketing")}>Open campaigns →</button></div>{[["15% storewide","$8,420","31.1%","−2.8 pts","Review"],["BOGO 50%","$5,180","28.4%","−5.5 pts","Limit"],["VIP 10%","$4,960","35.7%","+1.8 pts","Keep"],["Staff code","$1,240","32.2%","−1.7 pts","Watch"]].map(row=><div className="leak-row" key={row[0]}>{row.map((cell,index)=><span key={cell} className={index===4?`leak-status ${cell.toLowerCase()}`:""}>{cell}</span>)}</div>)}</article><ForecastCard net={model.net} profit={model.profit}/></section><button className="intel-wide-action" onClick={()=>showNotice("Margin review task added to Action Centre")}>Create margin review task <span>→</span></button></div>;
}

function ProductAnalysis({ products, sort, setSort, showNotice, navigate }: { products:typeof products; sort:"revenue"|"profit"|"margin"; setSort:(v:"revenue"|"profit"|"margin")=>void; showNotice:(m:string)=>void; navigate:(v:string)=>void }) {
  return <div className="intel-lens-layout"><section className="intel-kpis"><IntelKpi label="Sell-through" value="68.2%" delta="+5.4 pts" note="weighted by units" spark={[36,42,47,51,58,63,68]}/><IntelKpi label="GMROI" value="2.84×" delta="+0.31×" note="gross profit / avg inventory" spark={[39,42,44,48,51,57,61]}/><IntelKpi label="Stockout exposure" value="$4,860" delta="9 SKUs" note="next 14 days" spark={[66,63,59,57,53,49,45]} neutral/><IntelKpi label="Aged inventory" value="$7,340" delta="8.7% of value" note="90+ days without sale" spark={[57,55,51,48,44,42,39]} neutral/></section><section className="intel-two-col"><ProductLeaderboard products={products} sort={sort} setSort={setSort} navigate={navigate}/><article className="intel-card product-matrix"><div className="intel-card-head"><div><span>ASSORTMENT MATRIX</span><h3>Velocity × margin</h3><p>Bubble size represents inventory value</p></div></div><div className="matrix-axis y">High margin</div><div className="matrix"><span className="quad q1">Nurture</span><span className="quad q2">Invest</span><span className="quad q3">Exit</span><span className="quad q4">Traffic</span>{products.map((p,i)=><button key={p.name} title={`${p.name}: ${p.margin}% margin, ${p.velocity} units/day`} style={{left:`${Math.min(88,p.velocity/7*88)+3}%`,bottom:`${Math.min(85,(p.margin-20)/25*85)+5}%`,width:`${20+i*3}px`,height:`${20+i*3}px`}}>{i+1}</button>)}</div><div className="matrix-axis x">High velocity →</div><div className="matrix-key">{products.map((p,i)=><span key={p.name}><b>{i+1}</b>{p.name.split(" · ")[0]}</span>)}</div></article></section><article className="intel-card product-detail-table"><div className="intel-card-head"><div><span>SKU DECISION TABLE</span><h3>Revenue, profit, velocity and action</h3><p>Use exact values to validate the chart signal</p></div><button onClick={()=>showNotice("SKU table exported")}>↓ Export CSV</button></div><div className="product-table-head"><span>Product</span><span>Revenue</span><span>Profit</span><span>Margin</span><span>Units/day</span><span>Signal</span></div>{products.map(p=><div className="product-table-row" key={p.name}><span><b>{p.name}</b><small>{p.category}</small></span><strong>{cad.format(p.revenue)}</strong><strong>{cad.format(p.profit)}</strong><span>{p.margin}%</span><span>{p.velocity}</span><button onClick={()=>showNotice(`${p.name} action opened`)}>{p.signal}</button></div>)}</article></div>;
}

function CustomerAnalysis({ showNotice, navigate }: { showNotice:(m:string)=>void; navigate:(v:string)=>void }) {
  return <div className="intel-lens-layout"><section className="intel-kpis"><IntelKpi label="Known-customer revenue" value="71.6%" delta="+4.2 pts" note="of net sales" spark={[42,45,48,51,55,59,64]}/><IntelKpi label="Repeat rate" value="38.4%" delta="+3.1 pts" note="90-day purchase window" spark={[33,36,39,42,46,50,54]}/><IntelKpi label="90-day LTV" value="$184" delta="+$18" note="known customers" spark={[39,42,43,48,52,58,63]}/><IntelKpi label="Revenue at risk" value="$6,840" delta="18 VIPs" note="45+ days inactive" spark={[63,61,58,55,51,49,46]} neutral/></section><section className="intel-two-col"><CustomerMix navigate={navigate}/><article className="intel-card cohort-card"><div className="intel-card-head"><div><span>RETENTION COHORTS</span><h3>Customers returning after first purchase</h3><p>Share active by months since acquisition</p></div></div><div className="cohort-head"><span>Cohort</span>{["M0","M1","M2","M3","M4","M5"].map(x=><span key={x}>{x}</span>)}</div>{[["Feb",100,48,39,34,31,28],["Mar",100,51,42,37,32,0],["Apr",100,54,44,38,0,0],["May",100,57,47,0,0,0],["Jun",100,61,0,0,0,0],["Jul",100,0,0,0,0,0]].map(row=><div className="cohort-row" key={row[0]}>{row.map((v,i)=><span key={`${row[0]}-${i}`} className={i?"cohort-cell":""} style={i&&v?{background:`rgba(38,112,196,${.12+Number(v)/125})`}:undefined}>{i&&v?`${v}%`:v||"—"}</span>)}</div>)}</article></section><article className="intel-card segment-table"><div className="intel-card-head"><div><span>LOYALTY SEGMENTS</span><h3>Value, behavior and retention</h3><p>Segments derived from recency, frequency and monetary value</p></div><button onClick={()=>showNotice("Customer segment builder opened")}>+ Build audience</button></div><div className="segment-table-head"><span>Segment</span><span>Customers</span><span>Revenue</span><span>AOV</span><span>Frequency</span><span>Retention</span><span>Action</span></div>{segments.map(segment=><div className="segment-table-row" key={segment.name}><b>{segment.name}</b><span>{segment.customers}</span><strong>{cad.format(segment.revenue)}</strong><span>{cad.format(segment.aov)}</span><span>{segment.frequency}×</span><span>{segment.retention}%</span><button onClick={()=>showNotice(`${segment.name} campaign brief created`)}>Activate</button></div>)}</article></div>;
}

function OperationsAnalysis({ showNotice, navigate }: { showNotice:(m:string)=>void; navigate:(v:string)=>void }) {
  const hours=["10a","12p","2p","4p","6p","8p"]; const days=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
  return <div className="intel-lens-layout"><section className="intel-kpis"><IntelKpi label="Sales / labour hour" value="$186" delta="+9.2%" note="productivity" spark={[38,44,49,47,55,61,66]}/><IntelKpi label="Conversion proxy" value="42.8%" delta="+2.6 pts" note="transactions / visits" spark={[34,39,43,48,51,55,59]}/><IntelKpi label="Peak coverage" value="91%" delta="On plan" note="Fri–Sat 4–8 PM" spark={[65,67,69,72,74,78,82]}/><IntelKpi label="Data coverage" value="94.1%" delta="3 gaps" note="customer identity missing" spark={[81,83,84,87,89,92,94]} neutral/></section><section className="intel-two-col"><article className="intel-card heat-card"><div className="intel-card-head"><div><span>DEMAND HEATMAP</span><h3>When the store is busiest</h3><p>Transaction index by weekday and time block</p></div></div><div className="heat-grid"><span/>{days.map(day=><b key={day}>{day}</b>)}{heat.map((row,rowIndex)=><div className="heat-row" key={hours[rowIndex]}><strong>{hours[rowIndex]}</strong>{row.map((value,col)=><i key={`${rowIndex}-${col}`} title={`${days[col]} ${hours[rowIndex]}: demand index ${value}`} style={{background:`rgba(33,104,188,${.08+value/115})`}}>{value}</i>)}</div>)}</div><div className="heat-legend"><span>Lower demand</span><i/><i/><i/><i/><span>Peak demand</span></div></article><ForecastCard net={67540} profit={24246}/></section><section className="intel-two-col"><article className="intel-card anomaly-card"><div className="intel-card-head"><div><span>ANOMALY MONITOR</span><h3>Unusual events worth explaining</h3><p>Compared with expected weekday and seasonal pattern</p></div></div>{[["Jul 31 · 7–8 PM","Sales +38% above expected","Hydration launch and Movati traffic overlap","Investigate"],["Jul 28 · 2–4 PM","Margin −4.1 points","BOGO redemptions concentrated in protein","Review promo"],["Jul 24 · all day","Transactions −19%","No inventory or staffing issue detected","Add note"]].map(row=><div className="anomaly-row" key={row[0]}><span><b>{row[0]}</b><small>{row[1]}</small></span><p>{row[2]}</p><button onClick={()=>showNotice(`${row[3]} opened`)}>{row[3]}</button></div>)}</article><article className="intel-card close-card"><div className="intel-card-head"><div><span>OPERATING CLOSE</span><h3>Today’s control checklist</h3><p>Data completeness before decisions are finalized</p></div></div>{[["POS sales imported","Complete"],["Moneris settlement","Pending"],["Returns matched to orders","Complete"],["Inventory adjustments","2 unresolved"],["Cash drawer variance","$14.20 review"]].map(([name,status],i)=><div key={name}><span className={i===0||i===2?"done":"pending"}>{i===0||i===2?"✓":"!"}</span><b>{name}</b><em>{status}</em></div>)}<button className="intel-card-action" onClick={()=>navigate("Action Centre")}>Open close tasks →</button></article></section><button className="intel-wide-action" onClick={()=>showNotice("Weekly operating review scheduled")}>Schedule weekly operating review <span>→</span></button></div>;
}
