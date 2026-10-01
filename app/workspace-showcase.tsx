"use client";
import { useId, useRef, useState, type CSSProperties } from "react";
import ProductBrandLogo from "./product-brand-logo";
import "./workspace-showcase.css";

const views = ["Overview", "Invoices", "Bills", "Cash Flow", "Reports"] as const;
type View = typeof views[number];
type Filter = "All" | "Overdue" | "Part paid" | "Paid" | "Due in 30 days" | "Awaiting approval";
type SampleRecord = { reference: string; name: string; description: string; due: string; total: number; paid: number; approval?: boolean };
export const showcaseDate = "2026-09-27";
export const showcaseInvoices: readonly SampleRecord[] = [
  { reference: "INV-1048", name: "Westhaven Goods", description: "September wholesale order", due: "2026-10-02", total: 780000, paid: 180000 },
  { reference: "INV-1047", name: "Cedar Market", description: "Autumn collection", due: "2026-10-12", total: 640000, paid: 0 },
  { reference: "INV-1046", name: "Juniper Studio", description: "Store display materials", due: "2026-10-22", total: 600000, paid: 0 },
  { reference: "INV-1045", name: "Northline Co.", description: "Monthly supply order", due: "2026-09-20", total: 520000, paid: 200000 },
  { reference: "INV-1044", name: "Harbor Supply", description: "Packaging replenishment", due: "2026-09-14", total: 200000, paid: 0 },
  { reference: "INV-1043", name: "Atlas Retail", description: "Seasonal accessories", due: "2026-09-07", total: 120000, paid: 0 },
  { reference: "INV-1042", name: "Willow & Pine", description: "Completed wholesale order", due: "2026-09-24", total: 360000, paid: 360000 },
];
export const showcaseBills: readonly SampleRecord[] = [
  { reference: "BILL-2112", name: "Evergreen Wholesale", description: "Inventory replenishment", due: "2026-10-04", total: 420000, paid: 0, approval: true },
  { reference: "BILL-2111", name: "Foundry Logistics", description: "Freight and fulfilment", due: "2026-10-11", total: 460000, paid: 120000, approval: true },
  { reference: "BILL-2110", name: "Paperhouse Studio", description: "Packaging design", due: "2026-10-24", total: 200000, paid: 0, approval: false },
  { reference: "BILL-2109", name: "Northwind Properties", description: "November premises costs", due: "2026-11-10", total: 460000, paid: 0, approval: true },
  { reference: "BILL-2108", name: "Brightline Services", description: "September maintenance", due: "2026-09-25", total: 180000, paid: 180000, approval: true },
];
const balance = (record: SampleRecord) => record.total - record.paid;
const total = (records: readonly SampleRecord[]) => records.reduce((sum, record) => sum + balance(record), 0);
const overdue = (record: SampleRecord) => balance(record) > 0 && record.due < showcaseDate;
const dueSoon = (record: SampleRecord) => balance(record) > 0 && record.due >= showcaseDate && record.due <= "2026-10-27";
const money = (cents: number) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(cents / 100);
const dateLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
export const showcaseSummary = {
  receivables: total(showcaseInvoices), overdue: total(showcaseInvoices.filter(overdue)),
  payables: total(showcaseBills), payablesDue: total(showcaseBills.filter(dueSoon)),
};
const weeks = [
  { label: "Week 1", dates: "Sep 28 – Oct 4", from: "2026-09-28", to: "2026-10-04" },
  { label: "Week 2", dates: "Oct 5 – 11", from: "2026-10-05", to: "2026-10-11" },
  { label: "Week 3", dates: "Oct 12 – 18", from: "2026-10-12", to: "2026-10-18" },
  { label: "Week 4", dates: "Oct 19 – 27", from: "2026-10-19", to: "2026-10-27" },
];
export function showcaseCashSchedule(delayed = false) {
  let closing = 1800000;
  return weeks.map(week => {
    const invoices = showcaseInvoices.filter(record => record.due >= week.from && record.due <= week.to && balance(record) > 0);
    const bills = showcaseBills.filter(record => record.due >= week.from && record.due <= week.to && balance(record) > 0);
    const receipts = Math.round(total(invoices) * (delayed ? .9 : 1)), payments = total(bills), opening = closing;
    closing += receipts - payments;
    return { ...week, invoices, bills, opening, receipts, payments, closing };
  });
}
const ageing = [
  { label: "Not overdue", records: showcaseInvoices.filter(record => !overdue(record)) },
  { label: "1–7 days", records: showcaseInvoices.filter(record => overdue(record) && record.due >= "2026-09-20") },
  { label: "8–14 days", records: showcaseInvoices.filter(record => record.due >= "2026-09-13" && record.due < "2026-09-20") },
  { label: "15–30 days", records: showcaseInvoices.filter(record => record.due >= "2026-08-28" && record.due < "2026-09-13") },
];
function status(record: SampleRecord, bills: boolean) {
  if (!balance(record)) return "Paid";
  if (bills && record.approval === false) return "Awaiting approval";
  if (overdue(record)) return "Overdue";
  return record.paid ? "Part paid" : "Open";
}
function EmptyTable({ columns }: { columns: number }) {
  return <tr><td colSpan={columns} className="workspace-preview-table-empty"><b>No records in this view</b><span>Try another filter or switch back to sample records. This preview does not create real records.</span></td></tr>;
}

/** An interactive, local product preview. No customer records or network requests. */
export default function WorkspaceShowcase() {
  const [empty, setEmpty] = useState(false), [view, setView] = useState<View>("Overview");
  const [filter, setFilter] = useState<Filter>("All"), [search, setSearch] = useState(""), [selected, setSelected] = useState<SampleRecord | null>(null);
  const [delayed, setDelayed] = useState(false), [weekIndex, setWeekIndex] = useState(0), [report, setReport] = useState<"ageing" | "payments">("ageing");
  const selectedTrigger = useRef<HTMLButtonElement | null>(null);
  const id = useId().replaceAll(":", "");
  const cash = showcaseCashSchedule(delayed), selectedWeek = cash[weekIndex];
  const changeView = (next: View, nextFilter: Filter = "All") => { setView(next); setFilter(nextFilter); setSearch(""); setSelected(null); };
  const isBills = view === "Bills";
  const records = (empty ? [] : isBills ? showcaseBills : showcaseInvoices).filter(record => {
    const matchesFilter = filter === "All" || (filter === "Overdue" && overdue(record)) || (filter === "Part paid" && record.paid > 0 && balance(record) > 0) || (filter === "Paid" && !balance(record)) || (filter === "Due in 30 days" && dueSoon(record)) || (filter === "Awaiting approval" && record.approval === false && balance(record) > 0);
    return matchesFilter && `${record.reference} ${record.name}`.toLowerCase().includes(search.toLowerCase().trim());
  });
  const cards: { label: string; amount: number; detail: string; view: View; filter?: Filter }[] = [
    { label: "Accounts Receivable", amount: showcaseSummary.receivables, detail: "6 open invoices", view: "Invoices" },
    { label: "Overdue Invoices", amount: showcaseSummary.overdue, detail: "3 need follow-up", view: "Invoices", filter: "Overdue" },
    { label: "Accounts Payable", amount: showcaseSummary.payables, detail: "4 open bills", view: "Bills" },
    { label: "Payables Due in 30 Days", amount: showcaseSummary.payablesDue, detail: "Review 3 upcoming bills", view: "Bills", filter: "Due in 30 days" },
  ];
  const amount = (value: number) => empty ? "—" : money(value);
  const title = { Overview: "Your Financial Picture", Invoices: "Track What Customers Owe", Bills: "Plan What You Owe", "Cash Flow": "Look Ahead, With Context", Reports: "Trace Every Balance" }[view];
  return <section className="workspace-showcase" id="inside-bookloq" aria-labelledby={`${id}-title`}>
    <header><div><p className="demo-eyebrow">INSIDE YOUR WORKSPACE</p><h2 id={`${id}-title`}>See What’s Owed.<br/>Know Where to Start.</h2><p>Open an invoice. Follow a balance. Explore how the same records connect across your financial workspace.</p></div><div className="workspace-preview-switch" role="group" aria-label="Preview data state"><button type="button" aria-pressed={!empty} onClick={() => { setEmpty(false); setSelected(null); }}>With Sample Records</button><button type="button" aria-pressed={empty} onClick={() => { setEmpty(true); setSelected(null); }}>Before Your First Import</button></div></header>
    <div className="workspace-preview-shell"><aside><ProductBrandLogo product="bookloq" variant="full"/><nav aria-label="BookLoQ preview sections">{views.map(item => <button type="button" key={item} aria-pressed={view === item} aria-controls={`${id}-view`} onClick={() => changeView(item)}><span>{item}</span><span aria-hidden="true">{view === item ? "↗" : ""}</span></button>)}</nav><small>A Vanteloq Product</small></aside><div className="workspace-preview-main" id={`${id}-view`}>
      <div className="workspace-preview-top"><div><b aria-live="polite">{title}</b><span>Fictional demonstration · CAD · As of Sep 27, 2026{empty ? " · No records" : ""}</span></div><span className="workspace-preview-badge">Explore {view}</span></div>
      {view === "Overview" && <>
        <div className="workspace-preview-kpis">{cards.map(card => <button type="button" key={card.label} onClick={() => changeView(card.view, card.filter)}><span>{card.label}</span><strong>{amount(card.amount)}</strong><small>{empty ? "See the empty record view" : card.detail}<span aria-hidden="true"> ↗</span></small></button>)}</div>
        <div className="workspace-preview-visuals"><article><div className="workspace-preview-panel-title"><h3>Money Due In & Out</h3><button type="button" className="workspace-preview-text-button" onClick={() => changeView("Cash Flow")}>Explore Cash Flow ↗</button></div><div className="workspace-preview-legend"><span><i/>Invoices Due</span><span><i/>Bills Due</span></div><div className="workspace-preview-plot"><svg viewBox="0 0 560 180" role="img" aria-label={empty ? "Empty due-date chart" : "Four-week due schedule: invoices 18,400 dollars, bills 9,600 dollars. Overdue invoices excluded."}>{[20,60,100,140,160].map(y => <line key={y} x1="15" x2="545" y1={y} y2={y} stroke="#dce5ef"/>)}{!empty && showcaseCashSchedule().map((week, index) => <g key={week.label}><rect x={58 + index * 130} y={160 - week.receipts / 640000 * 140} width="28" height={week.receipts / 640000 * 140} rx="4" fill="#3f85dc"/><rect x={92 + index * 130} y={160 - week.payments / 640000 * 140} width="28" height={week.payments / 640000 * 140} rx="4" fill="#aa7b9d"/></g>)}</svg>{empty && <div className="workspace-preview-empty"><b>Ready for Your Records</b><span>The chart keeps its shape while you add your first invoices and bills.</span></div>}</div><div className="workspace-preview-axis">{weeks.map(week => <span key={week.label}>{week.label}</span>)}</div><small>Due dates are a planning guide, not guaranteed cash.{!empty && ` ${money(showcaseSummary.overdue)} of fictional overdue invoices sit outside this schedule.`}</small></article>
        <article className="workspace-preview-aging"><h3>Balance Ageing</h3><div className={`workspace-preview-donut ${empty ? "empty" : ""}`} style={{ "--current-share": `${(1 - showcaseSummary.overdue / showcaseSummary.receivables) * 100}%` } as CSSProperties}><div><strong>{amount(showcaseSummary.receivables)}</strong><span>Receivables</span></div></div><div className="workspace-preview-key"><span><i/>Not Overdue<b>{amount(showcaseSummary.receivables - showcaseSummary.overdue)}</b></span><span><i/>Past Due<b>{amount(showcaseSummary.overdue)}</b></span></div><button type="button" className="workspace-preview-text-button" onClick={() => { setReport("ageing"); changeView("Reports"); }}>Open Ageing Report ↗</button></article></div>
        <div className="workspace-preview-insight"><span aria-hidden="true">↗</span><div><b>{empty ? "A clear place to begin" : "Start with the balance that needs attention"}</b><p>{empty ? "Explore each section to see where your records will appear. No sample figures are treated as business data." : "Northline has paid $2,000 of a $5,200 invoice. The remaining $3,200 is seven days overdue."}</p></div><button type="button" onClick={() => changeView("Invoices", "Overdue")}>Review Invoices</button></div>
      </>}
      {(view === "Invoices" || view === "Bills") && <>
        <div className="workspace-preview-record-summary"><div><span>{isBills ? "Outstanding to suppliers" : "Outstanding from customers"}</span><strong>{amount(isBills ? showcaseSummary.payables : showcaseSummary.receivables)}</strong></div><p>{isBills ? "See due dates, partial payments and approval status before you decide what to pay." : "Inspect each invoice and its recorded payments. A remaining balance is not cash received."}</p></div>
        <div className="workspace-preview-toolbar"><div className="workspace-preview-filters" role="group" aria-label={`${view} filters`}>{(isBills ? ["All", "Due in 30 days", "Awaiting approval", "Paid"] as const : ["All", "Overdue", "Part paid", "Paid"] as const).map(item => <button type="button" key={item} aria-pressed={filter === item} onClick={() => { setFilter(item); setSelected(null); }}>{item}</button>)}</div><label className="workspace-preview-search"><span className="workspace-preview-sr">Search {view.toLowerCase()}</span><input type="search" placeholder={`Search ${isBills ? "supplier" : "customer"} or reference`} value={search} onChange={event => { setSearch(event.target.value); setSelected(null); }}/></label></div>
        <div className="workspace-preview-table-wrap" tabIndex={0} role="region" aria-label={`${view} sample records`}><table><caption>{records.length} {isBills ? "bills" : "invoices"} shown · {amount(total(records))} outstanding in this view</caption><thead><tr><th scope="col">{isBills ? "Bill / Supplier" : "Invoice / Customer"}</th><th scope="col">Due</th><th scope="col">Status</th><th scope="col" className="number">Remaining</th></tr></thead><tbody>{records.length ? records.map(record => <tr key={record.reference} className={selected?.reference === record.reference ? "selected" : ""}><td><button type="button" className="workspace-preview-record-link" aria-label={`View ${record.reference} for ${record.name}`} aria-expanded={selected?.reference === record.reference} onClick={event => { selectedTrigger.current = event.currentTarget; setSelected(record); }}>{record.reference} <span aria-hidden="true">↗</span></button><small>{record.name}</small></td><td>{dateLabel(record.due)}</td><td><span className={`workspace-preview-status ${status(record, isBills) === "Overdue" ? "late" : !balance(record) ? "paid" : ""}`}>{status(record, isBills)}</span></td><td className="number">{money(balance(record))}</td></tr>) : <EmptyTable columns={4}/>}</tbody></table></div>
        {selected ? <section className="workspace-preview-record-detail" aria-label={`${selected.reference} detail`}><header><div><small>FICTIONAL {isBills ? "BILL" : "INVOICE"}</small><h3>{selected.reference} · {selected.name}</h3></div><button type="button" onClick={() => { selectedTrigger.current?.focus(); setSelected(null); }} aria-label="Close record details">Close</button></header><p>{selected.description} · Due {dateLabel(selected.due)}, 2026</p><dl><div><dt>Document total</dt><dd>{money(selected.total)}</dd></div><div><dt>Payments recorded</dt><dd>{money(selected.paid)}</dd></div><div><dt>Remaining balance</dt><dd>{money(balance(selected))}</dd></div></dl><p>{isBills ? selected.approval === false ? "This bill is awaiting approval. It stays in amounts owed; no payment has been authorised or sent." : "Approval status is separate from payment. Recorded payments reduce the remaining balance." : "Document total minus recorded payments equals the balance above. Reviewing this sample does not send a reminder or collect money."}</p></section> : <p className="workspace-preview-helper">Select a reference to inspect its total, payments and remaining balance.</p>}
      </>}
      {view === "Cash Flow" && <>
        <div className="workspace-preview-scenario"><div><h3>What if receipts arrive later?</h3><p>Compare a due-date scenario with 10% of future invoice receipts moved beyond this horizon.</p></div><div className="workspace-preview-filters" role="group" aria-label="Cash flow scenario"><button type="button" aria-pressed={!delayed} onClick={() => setDelayed(false)}>On Due Dates</button><button type="button" aria-pressed={delayed} onClick={() => setDelayed(true)}>10% Arrives Later</button></div></div>
        <div className="workspace-preview-cash-totals"><div><span>Assumed opening cash</span><strong>{amount(1800000)}</strong></div><div><span>Scenario receipts</span><strong>{amount(cash.reduce((sum, week) => sum + week.receipts, 0))}</strong></div><div><span>Scheduled bills</span><strong>{amount(showcaseSummary.payablesDue)}</strong></div><div><span>Projected closing cash</span><strong>{amount(cash[3].closing)}</strong></div></div>
        <article className="workspace-preview-cash-chart"><div className="workspace-preview-panel-title"><h3>Projected Cash, Week by Week</h3><span>Scenario · Not a bank balance</span></div><div className="workspace-preview-plot"><svg viewBox="0 0 600 190" role="img" aria-label={empty ? "Empty projected cash chart" : `Projected closing cash ${cash.map(week => `${week.label}: ${money(week.closing)}`).join(", ")}`}><defs><linearGradient id={`${id}-cash-fill`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#4989e2" stopOpacity=".22"/><stop offset="1" stopColor="#4989e2" stopOpacity=".015"/></linearGradient></defs>{[40,90,140,170].map(y => <line key={y} x1="30" x2="575" y1={y} y2={y} stroke="#dce5ef"/>)}{!empty && <><path d={`M40 170 L${[1800000, ...cash.map(week => week.closing)].map((value, index) => `${40 + index * 130} ${170 - value / 3000000 * 140}`).join(" L")} L560 170 Z`} fill={`url(#${id}-cash-fill)`}/><polyline points={[1800000, ...cash.map(week => week.closing)].map((value, index) => `${40 + index * 130},${170 - value / 3000000 * 140}`).join(" ")} fill="none" stroke="#397bd4" strokeWidth="3" strokeLinejoin="round"/>{cash.map((week, index) => <circle key={week.label} cx={170 + index * 130} cy={170 - week.closing / 3000000 * 140} r={index === weekIndex ? 7 : 4} fill={index === weekIndex ? "#173d73" : "#397bd4"} stroke="#f7faff" strokeWidth="2"/>)}</>}</svg>{empty && <div className="workspace-preview-empty"><b>Your Cash Plan Starts Here</b><span>Opening cash and dated records are needed before a projection can be shown.</span></div>}</div><div className="workspace-preview-weeks" role="group" aria-label="Inspect cash flow week">{cash.map((week, index) => <button type="button" key={week.label} aria-pressed={weekIndex === index} onClick={() => setWeekIndex(index)}><b>{week.label}</b><small>{week.dates}</small><span>{amount(week.closing)}</span></button>)}</div></article>
        <div className="workspace-preview-week-detail"><div><h3>{selectedWeek.label}: Follow the Calculation</h3><p>{amount(selectedWeek.opening)} opening + {amount(selectedWeek.receipts)} receipts − {amount(selectedWeek.payments)} bills = <b>{amount(selectedWeek.closing)} closing</b></p><small>{empty ? "No forecast is calculated without records." : `${selectedWeek.invoices.length} invoice${selectedWeek.invoices.length===1?"":"s"} and ${selectedWeek.bills.length} bill${selectedWeek.bills.length===1?"":"s"} fall in this week.`}</small></div><div className="workspace-preview-week-links"><button type="button" onClick={() => changeView("Invoices")}>Review Invoices ↗</button><button type="button" onClick={() => changeView("Bills", "Due in 30 days")}>Review Bills ↗</button></div></div>
        <p className="workspace-preview-helper">{empty ? "A cash plan needs an opening balance and dated invoices and bills. Missing records stay visible instead of becoming invented results." : `Fictional assumptions: $18,000 opening cash; ${delayed ? "90% of future invoice balances collected on due dates, with 10% arriving after October 27" : "future invoice balances collected on their due dates"}; all scheduled bills paid, including the $2,000 awaiting approval. The $6,400 overdue balance is excluded until collection timing is reviewed. No bank connection or payment execution is implied.`}</p>
      </>}
      {view === "Reports" && <>
        <div className="workspace-preview-scenario"><div><h3>Reports You Can Trace</h3><p>Every figure below comes from the same fictional invoice and bill records.</p></div><div className="workspace-preview-filters" role="group" aria-label="Choose sample report"><button type="button" aria-pressed={report === "ageing"} onClick={() => setReport("ageing")}>Receivables Ageing</button><button type="button" aria-pressed={report === "payments"} onClick={() => setReport("payments")}>Balance Reconciliation</button></div></div>
        <div className="workspace-preview-table-wrap" tabIndex={0} role="region" aria-label="Sample financial report"><table><caption>{report === "ageing" ? "Receivables ageing as of September 27, 2026" : "Document balances, including paid records"} · CAD</caption><thead><tr>{(report === "ageing" ? ["Age of Balance", "Open Invoices", "Outstanding", "Share"] : ["Record Type", "Document Totals", "Recorded Payments", "Remaining"]).map((heading, index) => <th key={heading} scope="col" className={index ? "number" : ""}>{heading}</th>)}</tr></thead><tbody>{empty ? <EmptyTable columns={4}/> : report === "ageing" ? ageing.map(group => <tr key={group.label}><th scope="row">{group.label}</th><td className="number">{group.records.filter(record => balance(record) > 0).length}</td><td className="number">{money(total(group.records))}</td><td className="number">{(total(group.records) / showcaseSummary.receivables * 100).toFixed(1)}%</td></tr>) : ([{ name: "Invoices", entries: showcaseInvoices }, { name: "Bills", entries: showcaseBills }]).map(({ name, entries }) => <tr key={name}><th scope="row">{name}</th><td className="number">{money(entries.reduce((sum, row) => sum + row.total, 0))}</td><td className="number">{money(entries.reduce((sum, row) => sum + row.paid, 0))}</td><td className="number">{money(total(entries))}</td></tr>)}</tbody>{report === "ageing" && <tfoot><tr><th scope="row">Total Receivables</th><td className="number">{empty ? "—" : "6"}</td><td className="number">{amount(showcaseSummary.receivables)}</td><td className="number">{empty ? "—" : "100%"}</td></tr></tfoot>}</table></div>
        <div className="workspace-preview-report-note"><b>{report === "ageing" ? "An ageing report is a starting point for follow-up." : "A paid record stays visible without inflating amounts owed."}</b><p>{report === "ageing" ? "Partial payments are already deducted. Due dates are compared with the fixed sample reporting date; this is not a current customer ledger." : "Document totals minus recorded payments equal remaining balances. Receivables and payables stay separate; this report is not a profit and loss statement or bank reconciliation."}</p><div className="workspace-preview-week-links"><button type="button" onClick={() => changeView("Invoices", report === "ageing" ? "Overdue" : "All")}>Inspect Invoices ↗</button><button type="button" onClick={() => changeView("Bills")}>Inspect Bills ↗</button></div></div>
      </>}
    </div></div>
    <div className="workspace-file-preview"><div><p className="demo-eyebrow">FILES YOU ALREADY USE</p><h3>Keep Your Working Files Close to Your Numbers.</h3><p>Import a daily CSV now. Private Google Sheets and Microsoft file connections are coming soon, with selected-file review before anything reaches your books.</p></div><div className="workspace-file-options"><span><b>Google Drive & Sheets</b><small>Coming Soon · Sheet tables and document copies</small></span><span><b>Microsoft OneDrive</b><small>Coming Soon · Excel, Word and PowerPoint document copies</small></span></div></div>
    <footer><span>Interactive product preview. Sample figures are fictional. No records are saved.</span><a href="/demo#bookloq">Explore the Demo <span aria-hidden="true">↗</span></a></footer>
  </section>;
}
