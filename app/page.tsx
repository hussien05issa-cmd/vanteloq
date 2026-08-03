"use client";

import { FormEvent, useEffect, useState } from "react";
import SecureOnboardingFlow from "./secure-onboarding-flow";

const nav = [
  ["Command", ["Overview", "Intelligence", "Action Centre", "Business Brief", "Advisor"]],
  ["Operate", ["Sales & margin", "Inventory", "Customers", "Marketing", "SEO"]],
  ["Plan", ["Calendar", "Reports", "Goals"]],
] as const;

const integrations = [
  ["Lightspeed", "Point of sale", "Sales, products and inventory sync", "Planned"],
  ["Moneris", "Payments", "Settlement and transaction reconciliation", "Planned"],
  ["Google Business", "Local presence", "Reviews, profile performance and search", "Planned"],
  ["Meta", "Advertising", "Campaign spend, reach and conversions", "Planned"],
  ["QuickBooks", "Accounting", "Expenses, categories and reconciliation", "Planned"],
  ["Stripe", "Payments", "Revenue, refunds and payout tracking", "Planned"],
];

function Icon({ name }: { name: string }) {
  const map: Record<string, string> = { Overview: "⌂", Intelligence: "◫", "Action Centre": "✓", "Business Brief": "▤", Advisor: "✦", "Sales & margin": "↗", Inventory: "□", Customers: "◎", Marketing: "◇", SEO: "⌕", Calendar: "▦", Reports: "≡", Goals: "◉" };
  return <span className="nav-icon" aria-hidden>{map[name] ?? "·"}</span>;
}

export default function Home() {
  const [entry, setEntry] = useState<"loading" | "landing" | "signup" | "app">("loading");
  const [organizationName, setOrganizationName] = useState("");
  const [accountName, setAccountName] = useState("Account owner");
  const [view, setView] = useState("Overview");
  const [notice, setNotice] = useState("");
  const [quickOpen, setQuickOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    void fetch("/api/v1/onboarding", { headers: { Accept: "application/json" } })
      .then(async (response) => ({ response, data: await response.json() }))
      .then(({ response, data }) => {
        if (response.ok && data.organization?.setupComplete) {
          setOrganizationName(data.organization.businessName);
          setAccountName(data.organization.ownerName || data.user?.displayName || "Account owner");
          setEntry("app");
        } else if (response.ok && data.authenticated) {
          setAccountName(data.user?.displayName || "Account owner");
          setEntry("signup");
        } else {
          setEntry("landing");
        }
      })
      .catch(() => setEntry("landing"));
  }, []);

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2600);
  };

  if (entry === "loading") return <div className="entry-loading"><span className="brand-mark"><i/><b>V</b></span><p>Preparing Vanteloq…</p></div>;
  if (entry === "landing") return <LandingPage start={() => window.location.assign("/signin-with-chatgpt?return_to=/")} />;
  if (entry === "signup") return <SecureOnboardingFlow accountName={accountName} signOut={() => window.location.assign("/signout-with-chatgpt?return_to=/")} complete={(business, owner) => { setOrganizationName(business); setAccountName(owner); setEntry("app"); }} />;
  return (
    <main className="app-shell">
      <aside className={mobileNavOpen ? "sidebar mobile-open" : "sidebar"}>
        <button className="brand" onClick={() => setView("Overview")}><span className="brand-mark"><i/><b>V</b></span><span className="brand-name">Vanteloq<small>OPERATING INTELLIGENCE</small></span></button>
        <div className="workspace-switcher"><span className="workspace-avatar">{organizationName.slice(0,2).toUpperCase()}</span><span><b>{organizationName}</b><small>Workspace setup</small></span><span className="chev">⌄</span></div>
        <nav aria-label="Primary navigation">
          {nav.map(([group, items]) => <section className="nav-group" key={group}><p>{group}</p>{items.map(item => <button key={item} className={view === item ? "nav-item active" : "nav-item"} onClick={() => {setView(item);setMobileNavOpen(false)}}><Icon name={item}/>{item}</button>)}</section>)}
        </nav>
        <div className="side-bottom"><button className={view === "Integrations" ? "nav-item active" : "nav-item"} onClick={() => setView("Integrations")}><span className="nav-icon">⇄</span>Integrations</button><button className={view === "Settings" ? "nav-item active" : "nav-item"} onClick={() => setView("Settings")}><span className="nav-icon">⚙</span>Settings</button><div className="profile"><span className="avatar">{accountName.split(/\s+/).map(part=>part[0]).join("").slice(0,2).toUpperCase()}</span><span><b>{accountName}</b><small>Owner</small></span><button aria-label="Open account settings" onClick={() => setView("Settings")}>•••</button></div></div>
      </aside>

      <section className="main-panel">
        <header className="topbar"><button className="mobile-menu" aria-label="Open navigation" onClick={() => setMobileNavOpen(v=>!v)}>☰</button><div><p className="eyebrow">{view === "Overview" ? "COMMAND CENTRE" : "WORKSPACE"}</p><h1>{view}</h1></div><div className="top-actions"><button className="icon-button" aria-label="Search" onClick={() => setSearchOpen(true)}>⌕</button><button className="icon-button notification" aria-label="Notifications" onClick={() => setNotificationsOpen(v=>!v)}>♢<span /></button><button className="primary" onClick={() => setQuickOpen(true)}>+ Quick action</button></div></header>

        {view === "Integrations" ? <Integrations showNotice={showNotice} /> : view === "Action Centre" ? <TaskCentre showNotice={showNotice} openComposer={() => setQuickOpen(true)} /> : <EmptyDataWorkspace view={view} navigate={setView} />}
      </section>
      {quickOpen && <TaskComposer close={() => setQuickOpen(false)} saved={() => { setQuickOpen(false); setView("Action Centre"); showNotice("Task saved to the Action Centre"); }} />}
      {searchOpen && <CommandSearch close={()=>setSearchOpen(false)} navigate={(next)=>{setView(next);setSearchOpen(false)}} />}
      {notificationsOpen && <NotificationPanel close={()=>setNotificationsOpen(false)} navigate={(next)=>{setView(next);setNotificationsOpen(false)}} />}
      {notice && <div className="toast" role="status">{notice}</div>}
    </main>
  );
}

function LandingPage({ start }: { start: () => void }) {
  return <main className="public-site">
    <header className="public-nav"><button className="public-brand"><span className="brand-mark"><i/><b>V</b></span><span>Vanteloq<small>OPERATING INTELLIGENCE</small></span></button><nav><a href="#platform">Platform</a><a href="#connect">Integrations</a><a href="#how">How it works</a></nav><div><a className="nav-login" href="/signin-with-chatgpt?return_to=/">Sign in</a><button onClick={start}>Create workspace</button></div></header>
    <section className="public-hero"><div className="hero-grid"/><div className="public-copy"><span className="public-pill"><i/> Built for independent retail operators</span><h1>One operating system.<br/><em>Every business signal.</em></h1><p>Vanteloq connects sales, inventory, customers, marketing and daily operations—then turns the noise into the next decision.</p><div className="public-actions"><button onClick={start}>Build your workspace <span>→</span></button><a href="#platform">Explore the platform</a></div><div className="public-trust"><span>✓ Start with an empty workspace</span><span>✓ Live POS or CSV</span><span>✓ Your data stays yours</span></div></div>
      <div className="product-visual" aria-label="Vanteloq product interface preview"><div className="pv-top"><span><i/><i/><i/></span><small>vanteloq / command centre</small><b>•••</b></div><div className="pv-body"><aside><strong>V</strong>{[1,2,3,4,5,6].map(x=><i key={x}/>)}</aside><section><div className="pv-title"><span><small>GOOD MORNING</small><b>Your business pulse</b></span><button>Last 30 days⌄</button></div><div className="pv-kpis"><span><small>NET SALES</small><b>Connected data</b><em>updates here</em></span><span><small>GROSS MARGIN</small><b>Calculated live</b><em>from POS costs</em></span><span><small>ACTION CENTRE</small><b>Prioritized</b><em>for your team</em></span></div><div className="pv-chart"><div>{[42,55,48,73,62,88,79,96].map((h,i)=><i key={i} style={{height:`${h}%`}}/>)}</div><span><small>SALES</small><b>See the signal behind every shift.</b></span></div><div className="pv-bottom"><span><i>!</i><b>Stockout risk</b><small>Detected early</small></span><span><i>↗</i><b>Loyalty opportunity</b><small>Ready to activate</small></span></div></section></div></div>
    </section>
    <section className="signal-ribbon"><span>SALES & MARGIN</span><i/> <span>INVENTORY</span><i/> <span>CUSTOMERS</span><i/> <span>MARKETING</span><i/> <span>OPERATIONS</span></section>
    <section className="platform-section" id="platform"><div className="platform-intro"><p>THE VANTELOQ DIFFERENCE</p><h2>From disconnected reports<br/>to one clear operating picture.</h2><span>Your numbers are only useful when they tell you what changed, why it matters and what to do next.</span></div><div className="feature-stack">{[["01","Unified commerce data","Normalize every store, channel, product and customer into one reliable model."],["02","Decision-grade intelligence","Track profit drivers, demand, loyalty, anomalies and forecasts—not vanity metrics."],["03","Action built in","Turn any signal into assigned work, scheduled reports or an operating routine."]].map(([n,t,c])=><article key={n}><b>{n}</b><div><h3>{t}</h3><p>{c}</p></div><span>↗</span></article>)}</div></section>
    <section className="connection-section" id="connect"><p>CONNECT YOUR STACK</p><h2>Start with what you already use.</h2><div>{["Lightspeed","Square","Moneris","Shopify","Google","QuickBooks"].map(x=><span key={x}><b>{x.slice(0,2).toUpperCase()}</b>{x}</span>)}</div><small>Use secure provider authorization where available, or import a CSV immediately. No sample business data is added.</small></section>
    <section className="how-section" id="how"><div><p>YOUR FIRST 10 MINUTES</p><h2>A clean workspace,<br/>built around your business.</h2></div><ol><li><b>01</b><span><strong>Create your account</strong><small>Set owner contact and access security.</small></span></li><li><b>02</b><span><strong>Define the business</strong><small>Add legal details, location, hours and reporting defaults.</small></span></li><li><b>03</b><span><strong>Bring your data</strong><small>Connect a system, upload CSV, or continue with an empty workspace.</small></span></li></ol></section>
    <footer className="public-footer"><div><span className="brand-mark"><i/><b>V</b></span><strong>Vanteloq</strong></div><p>Clarity for every operating decision.</p><button onClick={start}>Create workspace →</button></footer>
  </main>;
}

function EmptyDataWorkspace({view,navigate}:{view:string;navigate:(v:string)=>void}){return <div className="content empty-workspace"><section><div className="empty-orbit"><span>V</span><i/><i/></div><p>{view.toUpperCase()}</p><h2>Your {view.toLowerCase()} workspace is ready for real data.</h2><span>Nothing is displayed because this business has not connected or imported a data source. Vanteloq will never fill your workspace with demo figures.</span><div><button onClick={()=>navigate("Integrations")}>Connect a data source →</button><button onClick={()=>navigate("Integrations")}>Import CSV</button></div></section><div className="empty-capabilities">{[["01","Connect","Authorize your POS, commerce or business system."],["02","Validate","Review field mapping, totals and data quality before import."],["03","Understand","Unlock trusted metrics, drill-downs and recommendations."]].map(([n,t,c])=><article key={n}><b>{n}</b><span><strong>{t}</strong><small>{c}</small></span></article>)}</div></div>}

function CommandSearch({close,navigate}:{close:()=>void;navigate:(v:string)=>void}){const [query,setQuery]=useState("");const destinations=[...nav.flatMap(([,items])=>items),"Integrations","Settings"];const results=destinations.filter(x=>x.toLowerCase().includes(query.toLowerCase()));return <div className="modal-backdrop" onMouseDown={e=>{if(e.currentTarget===e.target)close()}}><div className="command-modal" role="dialog" aria-modal="true"><div className="command-input"><span>⌕</span><input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search tools, reports and workspaces…"/><button onClick={close}>Esc</button></div><div className="command-results"><small>GO TO</small>{results.map(x=><button key={x} onClick={()=>navigate(x)}><Icon name={x}/><span>{x}</span><b>↵</b></button>)}{!results.length&&<p>No matching workspace found.</p>}</div></div></div>}

function NotificationPanel({close}:{close:()=>void;navigate:(v:string)=>void}){return <aside className="notification-panel"><div className="panel-head"><div><small>INBOX</small><h2>Notifications</h2></div><button onClick={close}>×</button></div><div className="empty-state"><b>No notifications yet.</b><span>Operational alerts will appear only after a verified data source is connected.</span></div></aside>}

type Task = { id: number; title: string; detail: string; priority: "high" | "medium" | "low"; status: "open" | "in_progress" | "done"; assignee: string; dueDate: string | null };

function TaskCentre({ showNotice, openComposer }: { showNotice: (m: string) => void; openComposer: () => void }) {
  const [tasks, setTasks] = useState<Task[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const load = async () => { try { const response = await fetch("/api/v1/tasks"); const data = await response.json(); if (!response.ok) throw new Error(data.error?.message ?? "Unable to load tasks"); setTasks(data.tasks); setError(""); } catch (e) { setError(e instanceof Error ? e.message : "Unable to load tasks"); } finally { setLoading(false); } };
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, []);
  const update = async (task: Task, status: Task["status"]) => { const response = await fetch("/api/v1/tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: task.id, status }) }); if (response.ok) { setTasks(current => current.map(item => item.id === task.id ? { ...item, status } : item)); showNotice(status === "done" ? "Task completed" : "Task status updated"); } };
  const active = tasks.filter(task => task.status !== "done");
  return <div className="content tasks-page"><section className="welcome-row"><div><h2>Turn signals into assigned work.</h2><p>Prioritize, assign and close the work that moves the business forward.</p></div><button className="primary" onClick={openComposer}>+ Create task</button></section><section className="task-stats"><div><strong>{active.length}</strong><span>Active tasks</span></div><div><strong>{tasks.filter(t => t.priority === "high" && t.status !== "done").length}</strong><span>High priority</span></div><div><strong>{tasks.filter(t => t.status === "done").length}</strong><span>Completed</span></div></section><article className="card task-board"><div className="card-head"><div><p className="card-kicker">OPERATIONS</p><h3>Shared task queue</h3></div><span className="live-label"><i/> Saved automatically</span></div>{loading ? <p className="empty-state">Loading your workspace…</p> : error ? <div className="empty-state"><b>We couldn’t load the task queue.</b><span>{error}</span><button onClick={() => { setLoading(true); void load(); }}>Try again</button></div> : tasks.length === 0 ? <div className="empty-state"><b>No tasks yet.</b><span>Create the first task for the store team.</span><button onClick={openComposer}>Create a task</button></div> : <div className="task-list">{tasks.map(task => <div className={`task-item ${task.status === "done" ? "is-done" : ""}`} key={task.id}><button className="check-task" aria-label={`Mark ${task.title} complete`} onClick={() => void update(task, task.status === "done" ? "open" : "done")}>{task.status === "done" ? "✓" : ""}</button><div className="task-copy"><div><span className={`task-priority ${task.priority}`}>{task.priority}</span><b>{task.title}</b></div>{task.detail && <p>{task.detail}</p>}<small>{task.assignee}{task.dueDate ? ` · Due ${new Date(`${task.dueDate}T12:00:00`).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}` : " · No due date"}</small></div><select aria-label={`Status for ${task.title}`} value={task.status} onChange={event => void update(task, event.target.value as Task["status"])}><option value="open">To do</option><option value="in_progress">In progress</option><option value="done">Done</option></select></div>)}</div>}</article></div>;
}

function TaskComposer({ close, saved }: { close: () => void; saved: () => void }) {
  const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setSaving(true); setError(""); const form = new FormData(event.currentTarget); const response = await fetch("/api/v1/tasks", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(Object.fromEntries(form)) }); const data = await response.json(); if (!response.ok) { setError(data.error?.message ?? "Unable to save task"); setSaving(false); return; } saved(); };
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) close(); }}><form className="task-modal" onSubmit={submit} aria-labelledby="task-title"><div className="modal-head"><div><p className="card-kicker">QUICK ACTION</p><h2 id="task-title">Create a team task</h2></div><button type="button" onClick={close} aria-label="Close">×</button></div><label>Task title<input name="title" maxLength={120} required autoFocus placeholder="e.g. Confirm Friday supplier order" /></label><label>Details<textarea name="detail" rows={3} placeholder="Add enough context to complete this without follow-up." /></label><div className="form-row"><label>Priority<select name="priority" defaultValue="medium"><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label><label>Assignee<select name="assignee" defaultValue="Owner"><option>Owner</option><option>Store team</option></select></label><label>Due date<input name="dueDate" type="date" /></label></div>{error && <p className="form-error">{error}</p>}<div className="modal-actions"><button type="button" className="secondary" onClick={close}>Cancel</button><button className="primary" disabled={saving}>{saving ? "Saving…" : "Create task"}</button></div></form></div>;
}

function Integrations({ showNotice }: { showNotice: (m: string) => void }) { return <div className="content integrations-page"><section className="welcome-row"><div><h2>Connect your business systems.</h2><p>Bring sales, inventory, marketing and financial data into one reliable operating view.</p></div><button className="secondary">View data policy</button></section><div className="integration-notice"><span>✓</span><div><b>Connection security is server-managed</b><p>Credentials are never stored in the browser. Each connection will use scoped access, encrypted secrets and a revocable authorization flow.</p></div></div><section className="integration-grid">{integrations.map(([name, type, desc, status]) => <article className="integration-card" key={name}><div className="integration-logo">{name.slice(0,2).toUpperCase()}</div><span className="integration-type">{type}</span><h3>{name}</h3><p>{desc}</p><div><span className={status === "Planned" ? "status planned" : "status"}>{status}</span><button disabled={status === "Planned"} onClick={() => showNotice(`${name} connection flow prepared`)}>{status === "Planned" ? "Coming soon" : "Connect"}</button></div></article>)}</section></div> }
