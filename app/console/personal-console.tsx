"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch, signOut } from "../supabase-browser";

type Company = "lexedge" | "vanteloq";
type CompanyFilter = "all" | Company;
type View = "overview" | "people" | "subscriptions" | "contacts" | "calendar" | "work" | "access";
type Composer = "contact" | "activity" | "task" | "access";

type Contact = {
  id: string;
  company: Company;
  name: string;
  email: string;
  phone: string;
  organization: string;
  stage: "lead" | "prospect" | "client" | "partner" | "inactive";
  source: string;
  owner: string;
  notes: string;
  lastContactAt: string | null;
  nextFollowUpAt: string | null;
};

type Activity = {
  id: string;
  company: Company;
  kind: "call" | "meeting" | "follow_up" | "deadline";
  title: string;
  contactId: string | null;
  contactName: string;
  contactEmail: string;
  startsAt: string | null;
  endsAt: string | null;
  location: string;
  status: "scheduled" | "completed" | "cancelled" | "no_show";
  notes: string;
  outcome: string;
};

type Task = {
  id: string;
  company: Company;
  title: string;
  detail: string;
  priority: "high" | "medium" | "low";
  status: "open" | "in_progress" | "done";
  dueAt: string | null;
  assignee: string;
  contactId: string | null;
};

type ConsolePayload = {
  viewer: { name: string; email: string; role: "owner" | "admin" | "viewer"; scopes: Company[]; mfa: "verified" };
  generatedAt: string;
  vanteloq: null | {
    metrics: {
      accounts: number;
      organizations: number;
      activeSubscribers: number;
      trials: number;
      billingAttention: number;
      estimatedMrrCents: number;
      trialPipelineMrrCents: number;
      conversionRate: number;
      newAccounts30d: number;
    };
    planMix: Array<{ plan: "starter" | "growth" | "pro"; count: number }>;
    signupTrend: Array<{ key: string; label: string; signups: number }>;
    people: Array<{
      id: string;
      displayName: string;
      email: string;
      status: string;
      businessName: string | null;
      businessEmail: string | null;
      role: string | null;
      plan: string | null;
      subscriptionStatus: string | null;
      joinedAt: string | null;
    }>;
    subscriptions: Array<{
      organizationId: string | null;
      businessName: string | null;
      ownerName: string;
      ownerEmail: string;
      plan: string | null;
      billingInterval: string | null;
      status: string | null;
      trialEndsAt: string | null;
      currentPeriodEndsAt: string | null;
      cancelAtPeriodEnd: boolean;
      addonMrrCents: number;
      estimatedMrrCents: number;
      lastSyncedAt: string | null;
    }>;
    analytics: { status: string; message: string };
  };
  operations: {
    contacts: Contact[];
    activities: Activity[];
    tasks: Task[];
    summary: Array<{ company: Company; contacts: number; activeClients: number; upcoming: number; openTasks: number; overdueTasks: number }>;
  };
  access: null | Array<{
    id: string;
    email: string;
    role: "owner" | "admin" | "viewer";
    scopes: Company[];
    active: boolean;
    mfaRequired: boolean;
    lastAccessedAt: string | null;
    protected: boolean;
  }>;
  audit: Array<{ id: string; action: string; resourceType: string; resourceId: string | null; outcome: string; createdAt: string | null }>;
};

const navigation: Array<{ id: View; label: string; short: string }> = [
  { id: "overview", label: "Command overview", short: "CO" },
  { id: "people", label: "People and accounts", short: "PA" },
  { id: "subscriptions", label: "Subscriptions", short: "SB" },
  { id: "contacts", label: "Contacts and CRM", short: "CR" },
  { id: "calendar", label: "Calls and meetings", short: "CM" },
  { id: "work", label: "Tasks and follow-ups", short: "TF" },
  { id: "access", label: "Private access", short: "AC" },
];

const companyNames: Record<Company, string> = { lexedge: "Lexedge Consulting", vanteloq: "Vanteloq" };

function money(cents: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(cents / 100);
}

function dateLabel(value: string | null, includeTime = false) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";
  return new Intl.DateTimeFormat("en-CA", includeTime
    ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Edmonton" }
    : { month: "short", day: "numeric", year: "numeric", timeZone: "America/Edmonton" }).format(date);
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "NA";
}

function titleCase(value: string | null) {
  return value ? value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Not set";
}

function StatusPill({ value }: { value: string | null }) {
  const normalized = value ?? "not_set";
  return <span className={`console-status status-${normalized}`}>{titleCase(normalized)}</span>;
}

function MetricCard({ label, value, detail, tone = "blue" }: { label: string; value: string; detail: string; tone?: "blue" | "green" | "amber" | "navy" }) {
  return <article className={`console-metric metric-${tone}`}>
    <span>{label}</span>
    <strong>{value}</strong>
    <small>{detail}</small>
  </article>;
}

function EmptyState({ title, copy }: { title: string; copy: string }) {
  return <div className="console-empty"><span>+</span><b>{title}</b><p>{copy}</p></div>;
}

async function fetchConsoleData(): Promise<ConsolePayload> {
  const response = await apiFetch("/api/v1/management-console", { headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => ({})) as ConsolePayload & { error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || "The management console could not be loaded.");
  return payload;
}

export default function PersonalConsole() {
  const [data, setData] = useState<ConsolePayload | null>(null);
  const [view, setView] = useState<View>("overview");
  const [company, setCompany] = useState<CompanyFilter>("all");
  const [composer, setComposer] = useState<Composer | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await fetchConsoleData();
      setData(payload);
      setCompany((current) => current === "all" || payload.viewer.scopes.includes(current) ? current : payload.viewer.scopes[0] ?? "all");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The management console could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void fetchConsoleData()
      .then((payload) => {
        if (!active) return;
        setData(payload);
        setCompany((current) => current === "all" || payload.viewer.scopes.includes(current) ? current : payload.viewer.scopes[0] ?? "all");
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "The management console could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const filteredContacts = useMemo(() => (data?.operations.contacts ?? []).filter((row) =>
    (company === "all" || row.company === company)
    && (!search || `${row.name} ${row.email} ${row.organization}`.toLowerCase().includes(search.toLowerCase())),
  ), [data, company, search]);
  const filteredActivities = useMemo(() => (data?.operations.activities ?? []).filter((row) => company === "all" || row.company === company), [data, company]);
  const filteredTasks = useMemo(() => (data?.operations.tasks ?? []).filter((row) => company === "all" || row.company === company), [data, company]);
  const availableViews = navigation.filter((item) => {
    if ((item.id === "people" || item.id === "subscriptions") && !data?.vanteloq) return false;
    if (item.id === "access" && data?.viewer.role !== "owner") return false;
    return true;
  });

  async function send(body: Record<string, unknown>, method: "POST" | "PATCH") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch("/api/v1/management-console", {
        method,
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({})) as { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || "The change could not be saved.");
      setNotice("Saved securely.");
      setComposer(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The change could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  function selectedFormCompany(form: FormData): Company {
    const value = String(form.get("company") || "");
    if (value === "lexedge" || value === "vanteloq") return value;
    return data?.viewer.scopes[0] ?? "lexedge";
  }

  async function createRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!composer) return;
    const form = new FormData(event.currentTarget);
    if (composer === "contact") {
      return send({
        action: "contact.create",
        company: selectedFormCompany(form),
        name: form.get("name"),
        email: form.get("email"),
        phone: form.get("phone"),
        organization: form.get("organization"),
        stage: form.get("stage"),
        source: form.get("source"),
        nextFollowUpAt: form.get("nextFollowUpAt"),
        notes: form.get("notes"),
      }, "POST");
    }
    if (composer === "activity") {
      const contactId = String(form.get("contactId") || "");
      const contact = data?.operations.contacts.find((item) => item.id === contactId);
      return send({
        action: "activity.create",
        company: selectedFormCompany(form),
        kind: form.get("kind"),
        title: form.get("title"),
        contactId: contactId || null,
        contactName: contact?.name ?? form.get("contactName"),
        contactEmail: contact?.email ?? "",
        startsAt: form.get("startsAt"),
        endsAt: form.get("endsAt"),
        location: form.get("location"),
        notes: form.get("notes"),
      }, "POST");
    }
    if (composer === "task") {
      return send({
        action: "task.create",
        company: selectedFormCompany(form),
        title: form.get("title"),
        detail: form.get("detail"),
        priority: form.get("priority"),
        dueAt: form.get("dueAt"),
        assignee: form.get("assignee"),
        contactId: form.get("contactId") || null,
      }, "POST");
    }
    return send({
      action: "access.grant",
      email: form.get("email"),
      role: form.get("role"),
      scopes: form.getAll("scopes"),
    }, "POST");
  }

  function updateResource(resource: "contact" | "activity" | "task" | "access", id: string, changes: Record<string, unknown>) {
    return send({ resource, id, ...changes }, "PATCH");
  }

  if (loading && !data) return <main className="console-loading"><div className="console-loader-mark">LC</div><h1>Preparing your private console…</h1><p>Verifying access and loading live company records.</p></main>;
  if (!data) return <main className="console-loading console-denied"><div className="console-loader-mark">!</div><h1>Private access required</h1><p>{error || "This account is not authorized for the management console."}</p><div><button onClick={() => void load()}>Try again</button><button className="secondary" onClick={() => void signOut()}>Sign out</button></div></main>;

  const defaultCompany = company === "all" ? data.viewer.scopes[0] : company;

  return <div className="personal-console">
    <aside className="console-sidebar">
      <Link href="/console" className="console-brand"><span>LC</span><div><b>Lexedge Command</b><small>Private company console</small></div></Link>
      <div className="console-company-switch" role="group" aria-label="Company view">
        {data.viewer.scopes.length > 1 && <button className={company === "all" ? "active" : ""} onClick={() => setCompany("all")}><i>ALL</i><span>Both companies</span></button>}
        {data.viewer.scopes.map((scope) => <button key={scope} className={company === scope ? "active" : ""} onClick={() => setCompany(scope)}><i>{scope === "lexedge" ? "LX" : "VQ"}</i><span>{companyNames[scope]}</span></button>)}
      </div>
      <nav aria-label="Management console">
        <p>WORKSPACE</p>
        {availableViews.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}><span>{item.short}</span>{item.label}</button>)}
      </nav>
      <div className="console-security-card"><span className="security-dot"/><div><b>MFA protected</b><small>Verified owner access</small></div></div>
      <footer><div className="console-avatar">{initials(data.viewer.name)}</div><div><b>{data.viewer.name}</b><small>{titleCase(data.viewer.role)} · {data.viewer.email}</small></div><button aria-label="Sign out" onClick={() => void signOut()}>↗</button></footer>
    </aside>

    <main className="console-main">
      <header className="console-topbar">
        <div><p>{company === "all" ? "LEXEDGE CONSULTING × VANTELOQ" : companyNames[company].toUpperCase()}</p><h1>{navigation.find((item) => item.id === view)?.label}</h1></div>
        <div className="console-top-actions">
          <span className="console-live"><i/>Updated {dateLabel(data.generatedAt, true)}</span>
          <button className="console-refresh" onClick={() => void load()} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
          {data.viewer.role !== "viewer" && <button className="console-create" onClick={() => setComposer(view === "calendar" ? "activity" : view === "contacts" ? "contact" : view === "access" ? "access" : "task")}>+ Add</button>}
        </div>
      </header>

      {(error || notice) && <div className={`console-message ${error ? "error" : "success"}`} role={error ? "alert" : "status"}><span>{error || notice}</span><button onClick={() => { setError(""); setNotice(""); }}>×</button></div>}

      <section className="console-content">
        {view === "overview" && <Overview data={data} company={company} activities={filteredActivities} tasks={filteredTasks} openComposer={setComposer}/>} 
        {view === "people" && data.vanteloq && <PeopleView data={data} search={search} setSearch={setSearch}/>} 
        {view === "subscriptions" && data.vanteloq && <SubscriptionsView data={data}/>} 
        {view === "contacts" && <ContactsView contacts={filteredContacts} search={search} setSearch={setSearch} editable={data.viewer.role !== "viewer"} update={updateResource} add={() => setComposer("contact")}/>} 
        {view === "calendar" && <CalendarView activities={filteredActivities} editable={data.viewer.role !== "viewer"} update={updateResource} add={() => setComposer("activity")}/>} 
        {view === "work" && <WorkView tasks={filteredTasks} editable={data.viewer.role !== "viewer"} update={updateResource} add={() => setComposer("task")}/>} 
        {view === "access" && data.access && <AccessView access={data.access} audit={data.audit} update={updateResource} add={() => setComposer("access")}/>} 
      </section>
    </main>

    {composer && <ComposerPanel type={composer} company={defaultCompany ?? "lexedge"} scopes={data.viewer.scopes} contacts={data.operations.contacts} busy={busy} close={() => setComposer(null)} submit={createRecord}/>} 
  </div>;
}

function Overview({ data, company, activities, tasks, openComposer }: { data: ConsolePayload; company: CompanyFilter; activities: Activity[]; tasks: Task[]; openComposer: (value: Composer) => void }) {
  const showVanteloq = company === "all" || company === "vanteloq";
  const summary = data.operations.summary.filter((row) => company === "all" || row.company === company);
  const generatedAt = new Date(data.generatedAt).getTime();
  const upcoming = activities.filter((row) => row.status === "scheduled" && new Date(row.startsAt ?? 0).getTime() >= generatedAt).slice(0, 5);
  const priorityOrder = { high: 0, medium: 1, low: 2 } as const;
  const priorityTasks = tasks.filter((row) => row.status !== "done").sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]).slice(0, 5);
  const maxSignups = Math.max(1, ...(data.vanteloq?.signupTrend.map((item) => item.signups) ?? [1]));
  return <div className="console-overview">
    {showVanteloq && data.vanteloq && <div className="console-metric-grid">
      <MetricCard label="Active subscribers" value={String(data.vanteloq.metrics.activeSubscribers)} detail={`${data.vanteloq.metrics.trials} trial accounts`} tone="blue"/>
      <MetricCard label="Estimated active MRR" value={money(data.vanteloq.metrics.estimatedMrrCents)} detail={`${money(data.vanteloq.metrics.trialPipelineMrrCents)} trial pipeline`} tone="green"/>
      <MetricCard label="Total accounts" value={String(data.vanteloq.metrics.accounts)} detail={`${data.vanteloq.metrics.newAccounts30d} joined in 30 days`} tone="navy"/>
      <MetricCard label="Billing attention" value={String(data.vanteloq.metrics.billingAttention)} detail={`${data.vanteloq.metrics.conversionRate.toFixed(1)}% account conversion`} tone={data.vanteloq.metrics.billingAttention ? "amber" : "green"}/>
    </div>}

    <div className="console-company-summary">
      {summary.map((row) => <article key={row.company}><header><span>{row.company === "lexedge" ? "LX" : "VQ"}</span><div><p>{companyNames[row.company]}</p><h2>{row.company === "lexedge" ? "Client operations" : "Company operations"}</h2></div></header><dl><div><dt>Active contacts</dt><dd>{row.contacts}</dd></div><div><dt>Clients</dt><dd>{row.activeClients}</dd></div><div><dt>Upcoming</dt><dd>{row.upcoming}</dd></div><div><dt>Open work</dt><dd>{row.openTasks}</dd></div></dl>{row.overdueTasks > 0 && <footer>{row.overdueTasks} overdue task{row.overdueTasks === 1 ? "" : "s"} need attention</footer>}</article>)}
    </div>

    <div className="console-dashboard-grid">
      {showVanteloq && data.vanteloq && <article className="console-panel console-signup-chart">
        <header><div><p>ACCOUNT GROWTH</p><h2>New Vanteloq accounts</h2></div><span>Last six months</span></header>
        <div className="signup-bars">{data.vanteloq.signupTrend.map((item) => <div key={item.key}><i style={{ height: `${Math.max(8, item.signups / maxSignups * 100)}%` }}><b>{item.signups}</b></i><span>{item.label}</span></div>)}</div>
      </article>}
      {showVanteloq && data.vanteloq && <article className="console-panel console-plan-mix">
        <header><div><p>SUBSCRIPTION MIX</p><h2>Plans in service</h2></div><span>{data.vanteloq.metrics.activeSubscribers} active</span></header>
        <div className="plan-mix-list">{data.vanteloq.planMix.map((item) => <div key={item.plan}><span className={`plan-dot plan-${item.plan}`}/><b>{titleCase(item.plan)}</b><i><em style={{ width: `${data.vanteloq!.metrics.activeSubscribers ? item.count / data.vanteloq!.metrics.activeSubscribers * 100 : 0}%` }}/></i><strong>{item.count}</strong></div>)}</div>
      </article>}
      <article className="console-panel console-upcoming">
        <header><div><p>NEXT ON YOUR SCHEDULE</p><h2>Calls and meetings</h2></div><button onClick={() => openComposer("activity")}>Add event</button></header>
        {upcoming.length ? <div className="upcoming-list">{upcoming.map((row) => <div key={row.id}><time><b>{new Date(row.startsAt ?? 0).getDate()}</b><span>{new Intl.DateTimeFormat("en-CA", { month: "short", timeZone: "America/Edmonton" }).format(new Date(row.startsAt ?? 0))}</span></time><span className={`activity-icon kind-${row.kind}`}>{row.kind === "call" ? "C" : row.kind === "meeting" ? "M" : "F"}</span><div><b>{row.title}</b><small>{dateLabel(row.startsAt, true)} · {row.contactName || companyNames[row.company]}</small></div><StatusPill value={row.status}/></div>)}</div> : <EmptyState title="No upcoming calls or meetings" copy="Schedule your next client or subscriber conversation."/>}
      </article>
      <article className="console-panel console-priorities">
        <header><div><p>FOCUS QUEUE</p><h2>Priority work</h2></div><button onClick={() => openComposer("task")}>Add task</button></header>
        {priorityTasks.length ? <div className="priority-list">{priorityTasks.map((row) => <div key={row.id}><span className={`priority-mark priority-${row.priority}`}/><div><b>{row.title}</b><small>{companyNames[row.company]} · {row.assignee}</small></div><time>{row.dueAt ? dateLabel(row.dueAt) : "No due date"}</time></div>)}</div> : <EmptyState title="Your focus queue is clear" copy="Add work as decisions and follow-ups come in."/>}
      </article>
    </div>
    {showVanteloq && data.vanteloq && <div className="console-source-note"><span>i</span><div><b>Website visitor analytics are not connected yet</b><p>{data.vanteloq.analytics.message}</p></div></div>}
  </div>;
}

function PeopleView({ data, search, setSearch }: { data: ConsolePayload; search: string; setSearch: (value: string) => void }) {
  const people = (data.vanteloq?.people ?? []).filter((row) => !search || `${row.displayName} ${row.email} ${row.businessName ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="console-table-view">
    <div className="console-view-intro"><div><p>VERIFIED APPLICATION USERS</p><h2>People and Vanteloq accounts</h2><span>Account identities and workspace memberships. Authentication secrets are never displayed.</span></div><label className="console-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search people or businesses"/></label></div>
    <div className="console-table-shell"><table><thead><tr><th>Person</th><th>Business</th><th>Workspace role</th><th>Plan</th><th>Account status</th><th>Joined</th></tr></thead><tbody>{people.map((row) => <tr key={row.id}><td><div className="person-cell"><span>{initials(row.displayName)}</span><div><b>{row.displayName}</b><small>{row.email}</small></div></div></td><td><b>{row.businessName || "Onboarding not completed"}</b><small>{row.businessEmail}</small></td><td>{titleCase(row.role)}</td><td>{row.plan ? titleCase(row.plan) : "No active plan"}</td><td><StatusPill value={row.subscriptionStatus || row.status}/></td><td>{dateLabel(row.joinedAt)}</td></tr>)}</tbody></table>{!people.length && <EmptyState title="No matching accounts" copy="Try a different search term."/>}</div>
  </div>;
}

function SubscriptionsView({ data }: { data: ConsolePayload }) {
  const rows = data.vanteloq?.subscriptions ?? [];
  return <div className="console-table-view">
    <div className="console-view-intro"><div><p>STRIPE SYNCHRONIZED RECORDS</p><h2>Subscription control</h2><span>Amounts are calculated from the verified Vanteloq price catalogue and synchronized billing status.</span></div><div className="console-inline-stat"><span>Active MRR</span><b>{money(data.vanteloq?.metrics.estimatedMrrCents ?? 0)}</b></div></div>
    <div className="console-table-shell"><table><thead><tr><th>Subscriber</th><th>Plan</th><th>Status</th><th>Estimated MRR</th><th>Renewal</th><th>Stripe sync</th></tr></thead><tbody>{rows.map((row) => <tr key={row.organizationId ?? row.ownerEmail}><td><b>{row.businessName || "Workspace pending"}</b><small>{row.ownerName} · {row.ownerEmail}</small></td><td><b>{titleCase(row.plan)}</b><small>{titleCase(row.billingInterval)} billing{row.addonMrrCents ? " · BookLoQ" : ""}</small></td><td><StatusPill value={row.status}/>{row.cancelAtPeriodEnd && <small className="table-warning">Cancels at period end</small>}</td><td><b>{money(row.estimatedMrrCents)}</b></td><td>{dateLabel(row.currentPeriodEndsAt || row.trialEndsAt)}</td><td>{dateLabel(row.lastSyncedAt, true)}</td></tr>)}</tbody></table>{!rows.length && <EmptyState title="No subscription records yet" copy="Paid and trial subscriptions will appear after Stripe confirms them."/>}</div>
    <p className="console-fine-print">Stripe card data and secret keys never enter this console. Only synchronized subscription references and catalogue amounts are used.</p>
  </div>;
}

function ContactsView({ contacts, search, setSearch, editable, update, add }: { contacts: Contact[]; search: string; setSearch: (value: string) => void; editable: boolean; update: (resource: "contact", id: string, changes: Record<string, unknown>) => void; add: () => void }) {
  return <div className="console-table-view">
    <div className="console-view-intro"><div><p>CLIENT AND RELATIONSHIP RECORDS</p><h2>Contacts and CRM</h2><span>Keep leads, clients, partners, and follow-ups organized across both companies.</span></div><div className="view-actions"><label className="console-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search contacts"/></label>{editable && <button onClick={add}>+ New contact</button>}</div></div>
    <div className="console-table-shell"><table><thead><tr><th>Contact</th><th>Company</th><th>Relationship</th><th>Next follow-up</th><th>Owner</th><th>Reach</th></tr></thead><tbody>{contacts.map((row) => <tr key={row.id}><td><div className="person-cell"><span>{initials(row.name)}</span><div><b>{row.name}</b><small>{row.organization || "Independent contact"}</small></div></div></td><td><span className={`company-chip company-${row.company}`}>{companyNames[row.company]}</span></td><td>{editable ? <select value={row.stage} onChange={(event) => update("contact", row.id, { stage: event.target.value })}>{["lead", "prospect", "client", "partner", "inactive"].map((stage) => <option value={stage} key={stage}>{titleCase(stage)}</option>)}</select> : <StatusPill value={row.stage}/>}</td><td>{dateLabel(row.nextFollowUpAt)}</td><td>{row.owner}</td><td><div className="reach-links">{row.email && <a href={`mailto:${row.email}`}>Email</a>}{row.phone && <a href={`tel:${row.phone}`}>Call</a>}</div></td></tr>)}</tbody></table>{!contacts.length && <EmptyState title="No contacts in this view" copy="Add your first lead, client, or partner to begin building the relationship record."/>}</div>
  </div>;
}

function CalendarView({ activities, editable, update, add }: { activities: Activity[]; editable: boolean; update: (resource: "activity", id: string, changes: Record<string, unknown>) => void; add: () => void }) {
  const sorted = [...activities].sort((a, b) => new Date(a.startsAt ?? 0).getTime() - new Date(b.startsAt ?? 0).getTime());
  return <div className="console-calendar-view">
    <div className="console-view-intro"><div><p>OWNER SCHEDULE</p><h2>Calls, meetings, and follow-ups</h2><span>Manage the company schedule without exposing private notes to customer workspaces.</span></div>{editable && <button onClick={add}>+ Schedule activity</button>}</div>
    <div className="calendar-layout"><aside><b>{new Intl.DateTimeFormat("en-CA", { month: "long", year: "numeric" }).format(new Date())}</b><div className="mini-calendar"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span>{Array.from({ length: 35 }, (_, index) => <i className={index + 1 === new Date().getDate() ? "today" : ""} key={index}>{index + 1 <= 31 ? index + 1 : ""}</i>)}</div><div className="calendar-legend"><span><i className="kind-call"/>Calls</span><span><i className="kind-meeting"/>Meetings</span><span><i className="kind-follow_up"/>Follow-ups</span></div></aside><section>{sorted.length ? sorted.map((row) => <article className={`schedule-row schedule-${row.status}`} key={row.id}><time><b>{dateLabel(row.startsAt, true)}</b><span>{row.endsAt ? `Until ${dateLabel(row.endsAt, true)}` : titleCase(row.kind)}</span></time><span className={`activity-icon kind-${row.kind}`}>{row.kind === "call" ? "C" : row.kind === "meeting" ? "M" : row.kind === "follow_up" ? "F" : "D"}</span><div><p>{companyNames[row.company]}</p><h3>{row.title}</h3><span>{row.contactName || "Internal"}{row.location ? ` · ${row.location}` : ""}</span>{row.notes && <small>{row.notes}</small>}</div><div className="schedule-actions"><StatusPill value={row.status}/>{editable && row.status === "scheduled" && <><button onClick={() => update("activity", row.id, { status: "completed" })}>Complete</button><button className="quiet" onClick={() => update("activity", row.id, { status: "cancelled" })}>Cancel</button></>}</div></article>) : <EmptyState title="Your schedule is open" copy="Add a call, meeting, follow-up, or deadline."/>}</section></div>
  </div>;
}

function WorkView({ tasks, editable, update, add }: { tasks: Task[]; editable: boolean; update: (resource: "task", id: string, changes: Record<string, unknown>) => void; add: () => void }) {
  const columns = ["open", "in_progress", "done"] as const;
  return <div className="console-work-view">
    <div className="console-view-intro"><div><p>OWNER ACTION SYSTEM</p><h2>Tasks and follow-ups</h2><span>Keep commitments visible and separate from customer facing product tasks.</span></div>{editable && <button onClick={add}>+ New task</button>}</div>
    <div className="task-board">{columns.map((status) => <section key={status}><header><span>{titleCase(status)}</span><b>{tasks.filter((row) => row.status === status).length}</b></header><div>{tasks.filter((row) => row.status === status).map((row) => <article key={row.id}><div><span className={`company-mark company-${row.company}`}>{row.company === "lexedge" ? "LX" : "VQ"}</span><StatusPill value={row.priority}/></div><h3>{row.title}</h3>{row.detail && <p>{row.detail}</p>}<footer><span>{row.assignee}</span><time className={row.dueAt && new Date(row.dueAt).getTime() < Date.now() && status !== "done" ? "overdue" : ""}>{row.dueAt ? dateLabel(row.dueAt) : "No due date"}</time></footer>{editable && <div className="task-actions">{status !== "open" && <button onClick={() => update("task", row.id, { status: "open" })}>Open</button>}{status !== "in_progress" && <button onClick={() => update("task", row.id, { status: "in_progress" })}>In progress</button>}{status !== "done" && <button onClick={() => update("task", row.id, { status: "done" })}>Done</button>}</div>}</article>)}</div>{!tasks.some((row) => row.status === status) && <small className="column-empty">No {titleCase(status).toLowerCase()} tasks</small>}</section>)}</div>
  </div>;
}

function AccessView({ access, audit, update, add }: { access: NonNullable<ConsolePayload["access"]>; audit: ConsolePayload["audit"]; update: (resource: "access", id: string, changes: Record<string, unknown>) => void; add: () => void }) {
  return <div className="console-access-view">
    <div className="console-view-intro"><div><p>OWNER CONTROLLED AUTHORIZATION</p><h2>Private console access</h2><span>Every person must use a verified Vanteloq account and authenticator level MFA.</span></div><button onClick={add}>+ Grant access</button></div>
    <div className="access-grid"><section className="console-panel"><header><div><p>AUTHORIZED PEOPLE</p><h2>{access.filter((row) => row.active).length} active access grants</h2></div></header><div className="access-list">{access.map((row) => <article key={row.id}><div className="console-avatar">{initials(row.email)}</div><div><b>{row.email}</b><span>{titleCase(row.role)} · {row.scopes.map((scope) => companyNames[scope]).join(" + ")}</span><small>{row.lastAccessedAt ? `Last access ${dateLabel(row.lastAccessedAt, true)}` : "No delegated access recorded yet"}</small></div><StatusPill value={row.active ? "active" : "revoked"}/>{row.protected ? <em>Protected owner</em> : <button className={row.active ? "danger" : ""} onClick={() => update("access", row.id, { active: !row.active })}>{row.active ? "Revoke" : "Restore"}</button>}</article>)}</div></section><section className="console-panel"><header><div><p>SECURITY ACTIVITY</p><h2>Recent console changes</h2></div></header><div className="audit-list">{audit.map((row) => <div key={row.id}><span className={row.outcome === "success" ? "success" : "failure"}/><div><b>{titleCase(row.action.replace("management_console.", ""))}</b><small>{titleCase(row.resourceType)} · {dateLabel(row.createdAt, true)}</small></div></div>)}{!audit.length && <EmptyState title="No console changes yet" copy="Access and management changes will appear here."/>}</div></section></div>
    <div className="console-source-note secure"><span>✓</span><div><b>Server enforced, not hidden by the interface</b><p>Removing a person here blocks future API access. No role is trusted from editable profile metadata, and secret keys are never returned to the browser.</p></div></div>
  </div>;
}

function ComposerPanel({ type, company, scopes, contacts, busy, close, submit }: { type: Composer; company: Company; scopes: Company[]; contacts: Contact[]; busy: boolean; close: () => void; submit: (event: FormEvent<HTMLFormElement>) => void }) {
  const title = { contact: "Add a contact", activity: "Schedule an activity", task: "Create a task", access: "Grant private access" }[type];
  const today = new Date();
  const localDateTime = new Date(today.getTime() - today.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  return <div className="console-composer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) close(); }}>
    <aside className="console-composer" role="dialog" aria-modal="true" aria-labelledby="console-composer-title">
      <header><div><p>PRIVATE COMPANY RECORD</p><h2 id="console-composer-title">{title}</h2></div><button onClick={close} disabled={busy} aria-label="Close">×</button></header>
      <form onSubmit={submit}>
        {type !== "access" && <label>Company<select name="company" defaultValue={company}>{scopes.map((scope) => <option value={scope} key={scope}>{companyNames[scope]}</option>)}</select></label>}
        {type === "contact" && <>
          <label>Full name<input name="name" maxLength={160} required autoFocus/></label>
          <div className="form-row"><label>Email<input name="email" type="email" maxLength={255}/></label><label>Phone<input name="phone" type="tel" maxLength={50}/></label></div>
          <label>Organization<input name="organization" maxLength={160}/></label>
          <div className="form-row"><label>Relationship<select name="stage" defaultValue="lead"><option value="lead">Lead</option><option value="prospect">Prospect</option><option value="client">Client</option><option value="partner">Partner</option></select></label><label>Source<input name="source" defaultValue="manual" maxLength={100}/></label></div>
          <label>Next follow-up<input name="nextFollowUpAt" type="datetime-local"/></label>
          <label>Notes<textarea name="notes" maxLength={2000}/></label>
        </>}
        {type === "activity" && <>
          <div className="form-row"><label>Activity type<select name="kind" defaultValue="meeting"><option value="call">Call</option><option value="meeting">Meeting</option><option value="follow_up">Follow-up</option><option value="deadline">Deadline</option></select></label><label>Linked contact<select name="contactId" defaultValue=""><option value="">No linked contact</option>{contacts.filter((row) => scopes.includes(row.company)).map((row) => <option value={row.id} key={row.id}>{row.name}</option>)}</select></label></div>
          <label>Title<input name="title" maxLength={200} required autoFocus/></label>
          <label>Contact name<input name="contactName" maxLength={160}/></label>
          <div className="form-row"><label>Starts<input name="startsAt" type="datetime-local" defaultValue={localDateTime} required/></label><label>Ends<input name="endsAt" type="datetime-local"/></label></div>
          <label>Location or meeting link<input name="location" maxLength={300}/></label>
          <label>Private notes<textarea name="notes" maxLength={2000}/></label>
        </>}
        {type === "task" && <>
          <label>Task title<input name="title" maxLength={200} required autoFocus/></label>
          <label>Details<textarea name="detail" maxLength={2000}/></label>
          <div className="form-row"><label>Priority<select name="priority" defaultValue="medium"><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label><label>Due date<input name="dueAt" type="datetime-local"/></label></div>
          <label>Assignee<input name="assignee" defaultValue="Hussien Issa" maxLength={160}/></label>
          <label>Linked contact<select name="contactId" defaultValue=""><option value="">No linked contact</option>{contacts.filter((row) => scopes.includes(row.company)).map((row) => <option value={row.id} key={row.id}>{row.name}</option>)}</select></label>
        </>}
        {type === "access" && <>
          <div className="console-access-warning"><b>Account and MFA required</b><span>The person must sign in with this exact verified email and complete authenticator verification.</span></div>
          <label>Email address<input name="email" type="email" maxLength={255} required autoFocus/></label>
          <label>Permission level<select name="role" defaultValue="viewer"><option value="viewer">Viewer · read only</option><option value="admin">Administrator · manage company records</option></select></label>
          <fieldset><legend>Company access</legend>{scopes.map((scope) => <label className="scope-check" key={scope}><input type="checkbox" name="scopes" value={scope} defaultChecked/><span><b>{companyNames[scope]}</b><small>Metrics and management records</small></span></label>)}</fieldset>
        </>}
        <footer><button type="button" className="secondary" onClick={close} disabled={busy}>Cancel</button><button disabled={busy}>{busy ? "Saving securely…" : type === "access" ? "Grant access" : "Save record"}</button></footer>
      </form>
    </aside>
  </div>;
}
