import type { CollectionsPreferences } from "../domain/collections-dashboard";
import "./bookloq-skeleton.css";

const sectionLayouts: Record<string, string> = {
  Overview: "collections", Transactions: "review", Banking: "banking", Reconciliation: "reconciliation",
  Sales: "receivables", Invoicing: "receivables", Customers: "records", Expenses: "expenses", Bills: "receivables", Suppliers: "records",
  "Inventory Accounting": "inventory", "Cash Flow": "cash", Reports: "reports", Budgets: "budgets", "Assets and Loans": "profiles",
  "Month-End": "close", "Chart of Accounts": "records", "Journal Entries": "records", "Sales Tax": "tax", Payroll: "payroll",
  "Accountant Portal": "profiles", "Audit Trail": "records", "BookLoQ Assistant": "assistant", Settings: "settings",
};
const defaultWidgets: CollectionsPreferences["widgets"] = [{ id: "schedule", visible: true }, { id: "aging", visible: true }, { id: "actions", visible: true }];

function Bar({ kind = "" }: { kind?: string }) { return <i className={`bq-load-bar ${kind}`}/>; }
function Intro() { return <div className="bq-load-intro"><Bar kind="bq-load-kicker"/><Bar kind="bq-load-title"/><Bar/><Bar kind="bq-load-copy"/></div>; }
function Cards({ count = 3 }: { count?: number }) { return <div className="bq-load-metrics">{Array.from({ length: count }, (_, index) => <div className="bq-load-panel bq-load-metric" key={index}><Bar/><Bar kind="bq-load-amount"/><Bar kind="bq-load-copy"/></div>)}</div>; }
function Rows({ count = 4 }: { count?: number }) { return <div className="bq-load-rows">{Array.from({ length: count }, (_, index) => <div key={index}><Bar/><Bar/><Bar/></div>)}</div>; }
function Table() { return <div className="bq-load-panel bq-load-table"><Bar kind="bq-load-subtitle"/><div className="bq-load-toolbar"><Bar/><Bar/><Bar/></div><Rows count={5}/></div>; }
function Plot() { return <div className="bq-load-panel bq-load-chart"><Bar kind="bq-load-subtitle"/><div className="bq-load-plot"/><Bar kind="bq-load-copy"/></div>; }
function Profile() { return <div className="bq-load-panel bq-load-profile"><Bar kind="bq-load-subtitle"/><Rows/></div>; }
function Banner() { return <div className="bq-load-panel bq-load-banner"><Bar kind="bq-load-subtitle"/><Bar/><Bar kind="bq-load-copy"/></div>; }

function CollectionsShape({ widgets = defaultWidgets }: { widgets?: CollectionsPreferences["widgets"] }) {
  return <div className="bq-load-collections"><Cards count={4}/><div className="bq-load-collections-grid">{widgets.filter(widget => widget.visible).map(widget => widget.id === "schedule" ? <Plot key={widget.id}/> : widget.id === "aging" ? <div className="bq-load-panel bq-load-aging" key={widget.id}><Bar kind="bq-load-subtitle"/><div className="bq-load-ring"/><Rows count={3}/></div> : <div className="bq-load-panel bq-load-focus" key={widget.id}><Bar kind="bq-load-subtitle"/><div className="bq-load-focus-items"><Banner/><Banner/><Banner/></div></div>)}</div><Table/></div>;
}

export function BookLoQCollectionsSkeleton({ widgets }: { widgets: CollectionsPreferences["widgets"] }) {
  return <section className="bq-section-skeleton" role="status" aria-live="polite" aria-label="Loading invoice and bill balances" aria-busy="true"><span className="bq-load-status">Loading invoice and bill balances</span><div aria-hidden="true"><CollectionsShape widgets={widgets}/></div></section>;
}

function SectionShape({ layout }: { layout: string }) {
  if (layout === "collections") return <><Intro/><CollectionsShape/><Banner/></>;
  if (layout === "settings") return <><Intro/><Banner/><div className="bq-load-pair"><Profile/><Profile/></div><Banner/></>;
  if (layout === "close") return <><Intro/><div className="bq-load-toolbar"><Bar/><Bar/></div><div className="bq-load-panel bq-load-close-progress"><Bar kind="bq-load-amount"/><Bar/></div><div className="bq-load-panel bq-load-checklist"><Rows count={5}/></div><Banner/></>;
  if (layout === "cash") return <><Intro/><Cards count={4}/><div className="bq-load-pair bq-load-cash"><Plot/><Profile/></div><Plot/><Table/></>;
  if (layout === "review") return <><Intro/><div className="bq-load-toolbar"><Bar/><Bar/><Bar/></div><div className="bq-load-pair bq-load-review"><div className="bq-load-panel"><Rows count={5}/></div><Profile/></div><Table/></>;
  if (layout === "assistant") return <><Intro/><div className="bq-load-pair bq-load-assistant"><Profile/><div className="bq-load-panel"><Bar kind="bq-load-subtitle"/><Rows count={5}/></div></div></>;
  if (layout === "profiles" || layout === "inventory") return <><Intro/>{layout === "inventory" && <Cards/>}<div className="bq-load-pair"><Profile/><Profile/></div></>;
  if (layout === "reports") return <><Intro/><div className="bq-load-toolbar"><Bar/><Bar/><Bar/></div><Cards count={6}/><Table/></>;
  if (layout === "banking") return <><Banner/><Intro/><Cards/><Table/><Banner/></>;
  if (layout === "reconciliation") return <><Intro/><Table/><Banner/></>;
  if (["receivables", "expenses", "budgets", "tax", "payroll"].includes(layout)) return <><Intro/><Cards/><Table/>{["expenses", "payroll"].includes(layout) && <Banner/>}</>;
  return <><Intro/><Table/></>;
}

export default function BookLoQSkeleton({ section, label = section, collapsed = false }: { section: string; label?: string; collapsed?: boolean }) {
  const layout = sectionLayouts[section] ?? "records";
  const status = `Loading BookLoQ · ${label}`;
  return <section className={`bookloq-shell bq-loading-shell${collapsed ? " bookloq-collapsed" : ""}`} role="status" aria-live="polite" aria-atomic="true" aria-label={status} aria-busy="true">
    <div className="bookloq-side bq-load-navigation" aria-hidden="true"><Bar kind="bq-load-logo"/><Bar kind="bq-load-search"/>{[0, 1, 2].map(group => <div key={group}><Bar kind="bq-load-kicker"/>{[0, 1, 2].map(item => <Bar key={item}/>)}</div>)}</div>
    <div className="bookloq-main"><div className="bookloq-top"><span className="bq-load-status">{status}</span></div><div className={`bookloq-content bq-section-skeleton bq-loading-${layout}`} aria-hidden="true"><SectionShape layout={layout}/></div></div>
  </section>;
}
