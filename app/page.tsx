"use client";

import { FormEvent, useEffect, useState } from "react";

const nav = [
  ["Command", ["Overview", "Action Centre", "Business Brief", "Advisor"]],
  ["Operate", ["Sales & margin", "Inventory", "Customers", "Marketing"]],
  ["Plan", ["Calendar", "Reports", "Goals"]],
] as const;

const actions = [
  { priority: "High", title: "Reorder top-selling hydration", detail: "Cadence Melonberry has 6 days of cover remaining.", impact: "$1,240 at risk", tone: "red" },
  { priority: "Opportunity", title: "Recover 3 overdue leads", detail: "Three high-intent wholesale conversations have no next step.", impact: "$2,850 potential", tone: "blue" },
  { priority: "Review", title: "Margin slipped on promo sales", detail: "Gross margin fell 2.3 points during the current bundle offer.", impact: "Investigate", tone: "amber" },
];

const integrations = [
  ["Lightspeed", "Point of sale", "Sales, products and inventory sync", "Ready to connect"],
  ["Moneris", "Payments", "Settlement and transaction reconciliation", "Planned"],
  ["Google Business", "Local presence", "Reviews, profile performance and search", "Ready to connect"],
  ["Meta", "Advertising", "Campaign spend, reach and conversions", "Ready to connect"],
  ["QuickBooks", "Accounting", "Expenses, categories and reconciliation", "Planned"],
  ["Stripe", "Payments", "Revenue, refunds and payout tracking", "Ready to connect"],
];

function Icon({ name }: { name: string }) {
  const map: Record<string, string> = { Overview: "⌂", "Action Centre": "✓", "Business Brief": "▤", Advisor: "✦", "Sales & margin": "↗", Inventory: "□", Customers: "◎", Marketing: "◇", Calendar: "▦", Reports: "≡", Goals: "◉" };
  return <span className="nav-icon" aria-hidden>{map[name] ?? "·"}</span>;
}

export default function Home() {
  const [view, setView] = useState("Overview");
  const [period, setPeriod] = useState("7 days");
  const [notice, setNotice] = useState("");
  const [quickOpen, setQuickOpen] = useState(false);

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2600);
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setView("Overview")}><span className="brand-mark">V</span><span>Vanteloq</span></button>
        <div className="workspace-switcher"><span className="workspace-avatar">SW</span><span><b>Supplement World</b><small>Newcastle · Edmonton</small></span><span className="chev">⌄</span></div>
        <nav aria-label="Primary navigation">
          {nav.map(([group, items]) => <section className="nav-group" key={group}><p>{group}</p>{items.map(item => <button key={item} className={view === item ? "nav-item active" : "nav-item"} onClick={() => setView(item)}><Icon name={item}/>{item}{item === "Action Centre" && <span className="badge">3</span>}</button>)}</section>)}
        </nav>
        <div className="side-bottom"><button className={view === "Integrations" ? "nav-item active" : "nav-item"} onClick={() => setView("Integrations")}><span className="nav-icon">⇄</span>Integrations</button><button className="nav-item"><span className="nav-icon">⚙</span>Settings</button><div className="profile"><span className="avatar">HI</span><span><b>Hussien</b><small>Manager</small></span><button aria-label="Account menu">•••</button></div></div>
      </aside>

      <section className="main-panel">
        <header className="topbar"><div><p className="eyebrow">{view === "Overview" ? "COMMAND CENTRE" : "WORKSPACE"}</p><h1>{view}</h1></div><div className="top-actions"><button className="icon-button" aria-label="Search">⌕</button><button className="icon-button notification" aria-label="Notifications">♢<span /></button><button className="primary" onClick={() => setQuickOpen(true)}>+ Quick action</button></div></header>

        {view === "Integrations" ? <Integrations showNotice={showNotice} /> : view === "Action Centre" ? <TaskCentre showNotice={showNotice} openComposer={() => setQuickOpen(true)} /> : <Dashboard period={period} setPeriod={setPeriod} showNotice={showNotice} />}
      </section>
      {quickOpen && <TaskComposer close={() => setQuickOpen(false)} saved={() => { setQuickOpen(false); setView("Action Centre"); showNotice("Task saved to the Action Centre"); }} />}
      {notice && <div className="toast" role="status">{notice}</div>}
    </main>
  );
}

type Task = { id: number; title: string; detail: string; priority: "high" | "medium" | "low"; status: "open" | "in_progress" | "done"; assignee: string; dueDate: string | null };

function TaskCentre({ showNotice, openComposer }: { showNotice: (m: string) => void; openComposer: () => void }) {
  const [tasks, setTasks] = useState<Task[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const load = async () => { try { const response = await fetch("/api/tasks"); const data = await response.json(); if (!response.ok) throw new Error(data.error); setTasks(data.tasks); setError(""); } catch (e) { setError(e instanceof Error ? e.message : "Unable to load tasks"); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  const update = async (task: Task, status: Task["status"]) => { const response = await fetch("/api/tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: task.id, status }) }); if (response.ok) { setTasks(current => current.map(item => item.id === task.id ? { ...item, status } : item)); showNotice(status === "done" ? "Task completed" : "Task status updated"); } };
  const active = tasks.filter(task => task.status !== "done");
  return <div className="content tasks-page"><section className="welcome-row"><div><h2>Turn signals into assigned work.</h2><p>Prioritize, assign and close the work that moves the business forward.</p></div><button className="primary" onClick={openComposer}>+ Create task</button></section><section className="task-stats"><div><strong>{active.length}</strong><span>Active tasks</span></div><div><strong>{tasks.filter(t => t.priority === "high" && t.status !== "done").length}</strong><span>High priority</span></div><div><strong>{tasks.filter(t => t.status === "done").length}</strong><span>Completed</span></div></section><article className="card task-board"><div className="card-head"><div><p className="card-kicker">OPERATIONS</p><h3>Shared task queue</h3></div><span className="live-label"><i/> Saved automatically</span></div>{loading ? <p className="empty-state">Loading your workspace…</p> : error ? <div className="empty-state"><b>We couldn’t load the task queue.</b><span>{error}</span><button onClick={() => { setLoading(true); void load(); }}>Try again</button></div> : tasks.length === 0 ? <div className="empty-state"><b>No tasks yet.</b><span>Create the first task for the Newcastle team.</span><button onClick={openComposer}>Create a task</button></div> : <div className="task-list">{tasks.map(task => <div className={`task-item ${task.status === "done" ? "is-done" : ""}`} key={task.id}><button className="check-task" aria-label={`Mark ${task.title} complete`} onClick={() => void update(task, task.status === "done" ? "open" : "done")}>{task.status === "done" ? "✓" : ""}</button><div className="task-copy"><div><span className={`task-priority ${task.priority}`}>{task.priority}</span><b>{task.title}</b></div>{task.detail && <p>{task.detail}</p>}<small>{task.assignee}{task.dueDate ? ` · Due ${new Date(`${task.dueDate}T12:00:00`).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}` : " · No due date"}</small></div><select aria-label={`Status for ${task.title}`} value={task.status} onChange={event => void update(task, event.target.value as Task["status"])}><option value="open">To do</option><option value="in_progress">In progress</option><option value="done">Done</option></select></div>)}</div>}</article></div>;
}

function TaskComposer({ close, saved }: { close: () => void; saved: () => void }) {
  const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setSaving(true); setError(""); const form = new FormData(event.currentTarget); const response = await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(form)) }); const data = await response.json(); if (!response.ok) { setError(data.error ?? "Unable to save task"); setSaving(false); return; } saved(); };
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) close(); }}><form className="task-modal" onSubmit={submit} aria-labelledby="task-title"><div className="modal-head"><div><p className="card-kicker">QUICK ACTION</p><h2 id="task-title">Create a team task</h2></div><button type="button" onClick={close} aria-label="Close">×</button></div><label>Task title<input name="title" maxLength={120} required autoFocus placeholder="e.g. Confirm Friday Peak order" /></label><label>Details<textarea name="detail" rows={3} placeholder="Add enough context to complete this without follow-up." /></label><div className="form-row"><label>Priority<select name="priority" defaultValue="medium"><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label><label>Assignee<select name="assignee" defaultValue="Hussien"><option>Hussien</option><option>Owner</option><option>Store team</option></select></label><label>Due date<input name="dueDate" type="date" /></label></div>{error && <p className="form-error">{error}</p>}<div className="modal-actions"><button type="button" className="secondary" onClick={close}>Cancel</button><button className="primary" disabled={saving}>{saving ? "Saving…" : "Create task"}</button></div></form></div>;
}

function Dashboard({ period, setPeriod, showNotice }: { period: string; setPeriod: (p: string) => void; showNotice: (m: string) => void }) {
  return <div className="content">
    <section className="welcome-row"><div><h2>Good afternoon, Hussien.</h2><p>Here’s what deserves your attention at Newcastle today.</p></div><div className="period" aria-label="Reporting period">{["7 days", "30 days", "Quarter"].map(p => <button className={period === p ? "selected" : ""} key={p} onClick={() => setPeriod(p)}>{p}</button>)}</div></section>

    <section className="signal-strip"><div><span className="pulse"/><b>Business pulse</b><span>Sales are ahead of the prior period, but inventory risk and promo margin need attention.</span></div><button onClick={() => showNotice("Business Brief selected")}>Open brief <span>→</span></button></section>

    <section className="kpi-grid">
      <Kpi label="Net revenue" value="$18,420" change="↑ 12.4%" detail="vs prior period" />
      <Kpi label="Gross margin" value="31.2%" change="↑ 1.1 pts" detail="target 32%" />
      <Kpi label="Average order" value="$62.18" change="↑ 4.8%" detail="296 transactions" />
      <Kpi label="Operating health" value="76" suffix="/ 100" change="Strong" detail="3 items need attention" health />
    </section>

    <section className="dashboard-grid">
      <article className="card revenue-card"><div className="card-head"><div><p className="card-kicker">PERFORMANCE</p><h3>Revenue movement</h3></div><button>View sales <span>→</span></button></div><div className="chart-summary"><strong>$18,420</strong><span className="positive">+12.4%</span><small>net revenue · {period}</small></div><div className="chart" aria-label="Revenue trend chart"><div className="y-labels"><span>$4k</span><span>$3k</span><span>$2k</span><span>$1k</span><span>$0</span></div><svg viewBox="0 0 700 190" role="img"><defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2878e3" stopOpacity=".23"/><stop offset="1" stopColor="#2878e3" stopOpacity="0"/></linearGradient></defs><path className="area" d="M0 154 C45 145 68 115 110 124 S180 146 220 106 S288 76 330 92 S398 122 440 68 S506 82 550 50 S620 72 700 20 L700 190 L0 190Z"/><path className="line" d="M0 154 C45 145 68 115 110 124 S180 146 220 106 S288 76 330 92 S398 122 440 68 S506 82 550 50 S620 72 700 20"/><circle cx="700" cy="20" r="5"/></svg><div className="x-labels"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div></div></article>
      <article className="card priorities"><div className="card-head"><div><p className="card-kicker">PRIORITIES</p><h3>Action Centre</h3></div><button>View all <span>→</span></button></div><div>{actions.map(a => <button className="action-row" key={a.title} onClick={() => showNotice(`${a.title} opened`)}><span className={`priority-icon ${a.tone}`}>{a.tone === "red" ? "!" : a.tone === "blue" ? "↗" : "◷"}</span><span className="action-copy"><span className={`priority-label ${a.tone}`}>{a.priority}</span><b>{a.title}</b><small>{a.detail}</small></span><span className="impact">{a.impact}<i>›</i></span></button>)}</div></article>
    </section>

    <section className="bottom-grid"><article className="card mini"><p className="card-kicker">TOP CATEGORY</p><h3>Hydration & performance</h3><div><strong>$5,842</strong><span className="positive">↑ 18.2%</span></div><p>31.7% of period revenue</p></article><article className="card mini"><p className="card-kicker">CUSTOMER SIGNAL</p><h3>Repeat purchase rate</h3><div><strong>38.4%</strong><span className="positive">↑ 3.1 pts</span></div><p>84 returning customers</p></article><article className="card mini integration-mini"><div><p className="card-kicker">DATA FRESHNESS</p><h3>4 sources connected</h3></div><button onClick={() => showNotice("Integration status opened")}>All systems healthy <span className="healthy-dot"/> →</button></article></section>
  </div>;
}

function Kpi({ label, value, suffix, change, detail, health }: { label: string; value: string; suffix?: string; change: string; detail: string; health?: boolean }) { return <article className="kpi"><div className="kpi-label"><span>{label}</span><button aria-label={`More about ${label}`}>•••</button></div><div className="kpi-value">{health && <span className="health-ring"/>}{value}<small>{suffix}</small></div><div className="kpi-meta"><span className={change === "Strong" ? "strong" : "positive"}>{change}</span><span>{detail}</span></div></article> }

function Integrations({ showNotice }: { showNotice: (m: string) => void }) { return <div className="content integrations-page"><section className="welcome-row"><div><h2>Connect your business systems.</h2><p>Bring sales, inventory, marketing and financial data into one reliable operating view.</p></div><button className="secondary">View data policy</button></section><div className="integration-notice"><span>✓</span><div><b>Connection security is server-managed</b><p>Credentials are never stored in the browser. Each connection will use scoped access, encrypted secrets and a revocable authorization flow.</p></div></div><section className="integration-grid">{integrations.map(([name, type, desc, status]) => <article className="integration-card" key={name}><div className="integration-logo">{name.slice(0,2).toUpperCase()}</div><span className="integration-type">{type}</span><h3>{name}</h3><p>{desc}</p><div><span className={status === "Planned" ? "status planned" : "status"}>{status}</span><button disabled={status === "Planned"} onClick={() => showNotice(`${name} connection flow prepared`)}>{status === "Planned" ? "Coming soon" : "Connect"}</button></div></article>)}</section></div> }
