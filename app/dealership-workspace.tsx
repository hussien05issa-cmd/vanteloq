"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { DEALERSHIP_APPOINTMENT_STATUSES, DEALERSHIP_COST_CATEGORIES, DEALERSHIP_CSV_TEMPLATE, DEALERSHIP_LEAD_STAGES, DEALERSHIP_PHYSICAL_STATUSES, DEALERSHIP_PREP_STATUSES, DEALERSHIP_TASK_STATUSES, dealershipInstant, validateDealershipCredits, type DealershipAcquire, type DealershipAppointment, type DealershipDashboard, type DealershipLead, type DealershipPermissions, type DealershipSale, type DealershipStock, type DealershipTask } from "../domain/dealership";
import { vehicleAmount, vehicleAmountToCents } from "../domain/vehicles";
import { dealerAppointmentOutcomes, dealerAverageGross, dealerStockAging, dealershipCalendarAge } from "../domain/dealer-analytics";
import { apiFetch } from "./supabase-browser";
import { FormInput } from "./form-primitives";
import { useModalFocus } from "./use-modal-focus";
import "./dealership-workspace.css";

export type DealershipTab = "overview" | "inventory" | "preparation" | "sales" | "customers" | "team";
type View = DealershipTab;
export type DealershipAction = "acquire" | "adopt_legacy" | "update_stock" | "transfer" | "add_cost" | "save_task" | "save_lead" | "save_appointment" | "reserve" | "release_reservation" | "deliver" | "reverse_sale";
type Draft = Record<string, string>;
type CreditDraft = { personId: string; share: string };
type Editor = { action: DealershipAction; draft: Draft; context: Record<string, unknown>; credits: CreditDraft[] };
type Preview = { entries: DealershipAcquire[]; count: number; fingerprint: string };
type OpenEditor = (action: DealershipAction, record?: DealershipStock | DealershipTask | DealershipLead | DealershipAppointment | DealershipSale) => void;
const labels: Record<DealershipAction, string> = { acquire: "Add vehicle", adopt_legacy: "Bring existing vehicle records", update_stock: "Update stock", transfer: "Transfer vehicle", add_cost: "Record cost evidence", save_task: "Save preparation task", save_lead: "Save customer lead", save_appointment: "Save appointment", reserve: "Reserve vehicle", release_reservation: "Release reservation", deliver: "Record delivery", reverse_sale: "Reverse delivery" };
const human = (value: string) => value.replaceAll("_", " ").replace(/^./, char => char.toUpperCase());
export const dealershipMoney = (cents: number | null | undefined, currency: string) => cents == null ? "Not recorded" : new Intl.NumberFormat("en-CA", { style: "currency", currency, currencyDisplay: "code" }).format(cents / 100);
export { dealershipCalendarAge } from "../domain/dealer-analytics";
const vehicleName = (row: DealershipStock) => `${row.year} ${row.make} ${row.model}`;
export function dealershipDeliveryBlockers(row: DealershipStock): string[] {
  const blockers: string[] = [];
  if (!["available", "reserved"].includes(row.availability)) blockers.push("availability must be available or reserved");
  if (!["owned", "consignment"].includes(row.ownership)) blockers.push("ownership must be reviewed");
  if (row.physicalStatus !== "on_lot") blockers.push("the vehicle must be on lot");
  if (row.prepStatus !== "ready") blockers.push("preparation must be ready");
  return blockers;
}
const dateLabel = (value: string) => value ? new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" }).format(new Date(`${value}T12:00:00Z`)) : "Not recorded";
const personName = (data: DealershipDashboard, id: string | null) => id ? data.people.find(person => person.id === id)?.name || "Assigned member" : "Unassigned";
function instantLabel(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(value));
}
export function dealershipActionAllowed(action: DealershipAction, permissions: DealershipPermissions) {
  if (["acquire", "update_stock", "transfer", "adopt_legacy"].includes(action)) return permissions.stockEdit;
  if (action === "add_cost") return permissions.costs && permissions.costEdit;
  if (action === "save_task") return permissions.tasks && permissions.tasksEdit;
  if (action === "save_lead" || action === "save_appointment") return permissions.customers && permissions.customersEdit;
  return permissions.sales && permissions.salesEdit;
}

/** Constructs only the supported action fields. Hidden costs never round-trip from a draft. */
export function dealershipActionPayload(editor: Editor, permissions: DealershipPermissions): Record<string, unknown> {
  if (!dealershipActionAllowed(editor.action, permissions)) throw new Error("Your current role cannot make this change.");
  const { action, draft: d, context } = editor;
  const optional = (key: string) => d[key]?.trim() || null;
  const amount = (key: string, required = false) => {
    const cents = vehicleAmountToCents(d[key] || "");
    if (required && cents === null) throw new Error("Enter the recorded amount. Leave unknown costs unrecorded.");
    return cents;
  };
  if (action === "acquire") return { action, locationId: d.locationId, vehicle: { identifierKind: d.identifierKind, identifier: d.identifier, year: Number(d.year), make: d.make, model: d.model, stockNumber: d.stockNumber, acquiredDate: d.acquiredDate }, ownership: d.ownership, physicalStatus: d.physicalStatus, prepStatus: d.prepStatus, availability: d.availability, askingCents: amount("asking") };
  if (action === "update_stock") return { action, ...context, ownership: d.ownership, physicalStatus: d.physicalStatus, prepStatus: d.prepStatus, availability: d.availability, askingCents: amount("asking"), ...(permissions.costApprove && permissions.costs ? { costComplete: d.costComplete === "true" } : {}) };
  if (action === "adopt_legacy" || action === "transfer") return { action, ...context, locationId: d.locationId };
  if (action === "add_cost") {
    if (d.status !== "estimated" && !permissions.costApprove) throw new Error("Your role can record cost estimates. Approval is required to record approved or posted evidence.");
    return { action, ...context, category: d.category, status: d.status, amountCents: amount("amount", true), description: d.description, sourceReference: d.sourceReference };
  }
  if (action === "save_task") {
    if (!!optional("episodeId") === !!optional("leadId")) throw new Error("Link this task to exactly one vehicle or customer lead.");
    return { action, ...context, episodeId: optional("episodeId"), leadId: optional("leadId"), title: d.title, status: d.status, assigneeId: optional("assigneeId"), dueDate: optional("dueDate"), blockedReason: d.blockedReason || "" };
  }
  if (action === "save_lead") return { action, ...context, locationId: d.locationId, customerName: d.customerName, contact: d.contact || "", stage: d.stage, assigneeId: optional("assigneeId"), nextActionDate: optional("nextActionDate") };
  if (action === "save_appointment") return { action, ...context, leadId: d.leadId, scheduledAt: dealershipInstant(`${d.localTime}${d.utcOffset}`), status: d.status };
  if (action === "reserve") return { action, ...context, leadId: optional("leadId"), expiresAt: dealershipInstant(`${d.localTime}${d.utcOffset}`) };
  if (action === "release_reservation") return { action, ...context };
  if (action === "reverse_sale") return { action, ...context, date: d.date, reason: d.reason };
  const credits = validateDealershipCredits(editor.credits.map(row => ({ personId: row.personId, shareBps: vehicleAmountToCents(row.share) })));
  return { action, ...context, deliveredDate: d.deliveredDate, channel: d.channel, amountCents: amount("amount", true), credits };
}

function newEditor(action: DealershipAction, data: DealershipDashboard, locationId: string | null, record?: Parameters<OpenEditor>[1]): Editor {
  const editor: Editor = { action, context: {}, credits: [], draft: { locationId: locationId || (data.locations.length === 1 ? data.locations[0].id : ""), identifierKind: "vin", ownership: "owned", physicalStatus: "on_lot", prepStatus: "not_started", availability: "available", category: "acquisition", status: "open", stage: "new", channel: "retail" } };
  if (record && "stockNumber" in record && "vehicleId" in record) {
    editor.context = { episodeId: record.id, expectedVersion: record.version };
    Object.assign(editor.draft, { locationId: record.locationId, episodeId: record.id, ownership: record.ownership, physicalStatus: record.physicalStatus, prepStatus: record.prepStatus, availability: record.availability, asking: vehicleAmount(record.askingCents), costComplete: String(record.costComplete) });
  } else if (record && "customerName" in record) {
    editor.context = action === "save_lead" ? { id: record.id, expectedVersion: record.version } : {};
    Object.assign(editor.draft, record, { leadId: record.id, assigneeId: record.assigneeId || "", nextActionDate: record.nextActionDate || "" });
  } else if (record && "title" in record) {
    editor.context = { id: record.id, expectedVersion: record.version };
    Object.assign(editor.draft, record, { assigneeId: record.assigneeId || "", episodeId: record.episodeId || "", leadId: record.leadId || "", dueDate: record.dueDate || "" });
  } else if (record && "scheduledAt" in record) {
    editor.context = { id: record.id, expectedVersion: record.version };
    Object.assign(editor.draft, record);
    const location = data.locations.find(row => row.id === data.leads.find(lead => lead.id === record.leadId)?.locationId);
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: location?.timezone || "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "longOffset" }).formatToParts(new Date(record.scheduledAt));
    const part = (type: string) => parts.find(row => row.type === type)?.value || "";
    editor.draft.localTime = `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
    editor.draft.utcOffset = part("timeZoneName").replace("GMT", "") || "+00:00";
  } else if (record && "deliveredDate" in record) editor.context = { saleId: record.id };
  if (action === "save_task" && record && "vehicleId" in record) editor.context = {};
  if (action === "save_appointment" && !(record && "scheduledAt" in record)) editor.draft.status = "scheduled";
  if (action === "add_cost") editor.draft.status = "estimated";
  return editor;
}

type WorkspaceProps = { activeLocationId: string | null; initialTab?: DealershipTab; compactOverview?: boolean; agingReviewDays?: number };
export default function DealershipWorkspace({ activeLocationId, initialTab = "overview", compactOverview = false, agingReviewDays = 60 }: WorkspaceProps) {
  return <DealershipScope key={activeLocationId || "all-authorized-locations"} activeLocationId={activeLocationId} initialTab={initialTab} compactOverview={compactOverview} agingReviewDays={agingReviewDays}/>;
}

function DealershipScope({ activeLocationId, initialTab = "overview", compactOverview = false, agingReviewDays = 60 }: WorkspaceProps) {
  const [data, setData] = useState<DealershipDashboard | null>(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [view, setView] = useState<View>(initialTab), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [filters, setFilters] = useState({ from: "", to: "", q: "" }), [query, setQuery] = useState({ from: "", to: "", q: "" });
  const [editor, setEditor] = useState<Editor | null>(null), [editorOpen, setEditorOpen] = useState(false), [uncertain, setUncertain] = useState(false), [conflict, setConflict] = useState(false);
  const [csv, setCsv] = useState(""), [preview, setPreview] = useState<Preview | null>(null), [importLocation, setImportLocation] = useState(activeLocationId || "");
  const reads = useRef<AbortController | null>(null), writes = useRef<AbortController | null>(null), alive = useRef(true), busyRef = useRef(false), fileRevision = useRef(0);
  const pending = useRef<{ body: Record<string, unknown>; key: string; after: () => void } | null>(null);
  const modal = useRef<HTMLDivElement>(null);
  useModalFocus(modal, editorOpen && data !== null, () => { if (!busyRef.current) setEditorOpen(false); });
  const savedHeading = useRef<HTMLHeadingElement>(null), focusAfterSave = useRef(false);
  useEffect(() => { if (!busy && !editorOpen && focusAfterSave.current) { savedHeading.current?.focus(); focusAfterSave.current = false; } }, [busy, editorOpen]);

  const load = useCallback((after?: string) => {
    reads.current?.abort();
    const controller = new AbortController(); reads.current = controller;
    const params = new URLSearchParams();
    if (activeLocationId) params.set("locationId", activeLocationId);
    for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
    if (after) params.set("after", after);
    return apiFetch(`/api/v1/dealership?${params}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) }).then(async response => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || "Dealership records could not be loaded.");
      return payload as DealershipDashboard;
    }).then(next => {
      if (!controller.signal.aborted && alive.current) {
        setData(current => ({ ...next, stock: after && current ? [...current.stock, ...next.stock.filter(row => !current.stock.some(existing => existing.id === row.id))] : next.stock }));
        setFilters(current => ({ ...current, from: current.from || next.summary.from, to: current.to || next.summary.to }));
        setImportLocation(current => current || (next.locations.length === 1 ? next.locations[0].id : ""));
        return next;
      }
    }).catch(caught => {
      if (!controller.signal.aborted && alive.current) { setData(null); setError(caught instanceof Error ? caught.message : "Dealership records could not be loaded. Try again."); }
    }).finally(() => { if (!controller.signal.aborted && alive.current) setLoading(false); });
  }, [activeLocationId, query]);

  useEffect(() => { const pendingFileReads = fileRevision; alive.current = true; return () => { alive.current = false; reads.current?.abort(); writes.current?.abort(); pendingFileReads.current++; }; }, []);
  useEffect(() => { void load(); return () => reads.current?.abort(); }, [load]);
  function refreshRecords(after?: string) { setLoading(true); setError(""); return load(after); }

  async function write(body: Record<string, unknown>, after: () => void) {
    if (busyRef.current) return;
    if (pending.current && JSON.stringify(pending.current.body) !== JSON.stringify(body)) { setError("Confirm the result of your pending save before starting another change."); return; }
    const mutation = pending.current || { body, key: crypto.randomUUID(), after };
    if (body.action !== "preview") pending.current = mutation;
    const controller = new AbortController(); writes.current = controller;
    busyRef.current = true; setBusy(true); setError(""); setMessage(""); setConflict(false);
    let certainFailure = false;
    try {
      const response = await apiFetch("/api/v1/dealership", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, ...(body.action !== "preview" ? { mutationKey: mutation.key } : {}) }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]) });
      certainFailure = !response.ok && response.status >= 400 && response.status < 500;
      const result = await response.json();
      if (!response.ok) { if (response.status === 409) setConflict(true); throw new Error(result.error?.message || "This change could not be saved."); }
      if (!alive.current || controller.signal.aborted) return;
      pending.current = null; setUncertain(false);
      if (body.action === "preview") { setPreview(result); setMessage("Preview ready. Review every row below. Nothing has been saved."); }
      else { focusAfterSave.current = true; mutation.after(); setMessage(result.replayed ? "This request was already saved. The latest records are shown below." : "Saved. The latest records are shown below."); await refreshRecords(); }
    } catch (caught) {
      if (!alive.current || controller.signal.aborted) return;
      if (certainFailure || body.action === "preview") { pending.current = null; setUncertain(false); }
      else setUncertain(true);
      setError(caught instanceof Error ? caught.message : "The request could not finish. Your input is still here.");
    } finally { busyRef.current = false; if (alive.current) setBusy(false); }
  }

  const open: OpenEditor = (action, record) => {
    if (!data || !dealershipActionAllowed(action, data.permissions) || busy || uncertain) return;
    if (editor) { setEditorOpen(true); setError("Finish or discard the current form before starting another change."); return; }
    setEditor(newEditor(action, data, activeLocationId, record)); setEditorOpen(true); setError(""); setMessage(""); setConflict(false);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault(); if (!editor || !data || busy || uncertain) return;
    try { void write(dealershipActionPayload(editor, data.permissions), () => { setEditorOpen(false); setEditor(null); }); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Review the entered values."); }
  };
  async function replaceWithLatest() {
    if (!editor || busyRef.current || uncertain) return;
    const latest = await refreshRecords();
    if (!latest) return;
    const id = editor.context.id;
    const record = editor.context.episodeId ? latest.stock.find(row => row.id === editor.context.episodeId)
      : editor.action === "save_task" ? (latest.tasks.find(row => row.id === id) ?? latest.attention?.tasks.find(row => row.id === id))
      : editor.action === "save_lead" ? latest.leads.find(row => row.id === id)
      : editor.action === "save_appointment" ? latest.appointments.find(row => row.id === id)
      : editor.action === "reverse_sale" ? latest.sales.find(row => row.id === editor.context.saleId) : undefined;
    if (!record) { setError("The record is outside this loaded scope or is no longer available. Close this form and review the latest records."); return; }
    setEditor(newEditor(editor.action, latest, activeLocationId, record)); setConflict(false); setMessage("The form now contains the latest saved values. Review them before saving.");
  }
  async function exportRecords(kind: "stock" | "sales" | "summary") {
    if (!data?.permissions.export || busyRef.current || uncertain) return;
    busyRef.current = true; setBusy(true); setError("");
    const controller = new AbortController(); writes.current = controller;
    try {
      const params = new URLSearchParams({ format: "csv", export: kind });
      if (activeLocationId) params.set("locationId", activeLocationId);
      for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
      const response = await apiFetch(`/api/v1/dealership?${params}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]) });
      if (!response.ok) { const payload = await response.json(); throw new Error(payload.error?.message || "The export could not be downloaded."); }
      const blob = await response.blob();
      if (!alive.current || controller.signal.aborted) return;
      const url = URL.createObjectURL(blob), anchor = document.createElement("a"); anchor.href = url; anchor.download = `dealership-${kind}.csv`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("The scoped CSV export was downloaded.");
    } catch (caught) { if (alive.current && !controller.signal.aborted) setError(caught instanceof Error ? caught.message : "The export could not be downloaded."); }
    finally { busyRef.current = false; if (alive.current) setBusy(false); }
  }
  const locations = data?.locations.filter(location => !activeLocationId || location.id === activeLocationId) || [];
  const tabs: [View, string, boolean][] = [["overview", "Overview", true], ["inventory", "Inventory", true], ["preparation", "Preparation", !!data?.permissions.tasks], ["sales", "Deals & deliveries", !!data?.permissions.sales], ["customers", "Leads & appointments", !!data?.permissions.customers], ["team", "Team", !!(data?.permissions.tasks || data?.permissions.sales)]];
  const currentView = tabs.find(tab => tab[0] === view && tab[2]) ? view : "overview";
  const blocked = busy || uncertain;
  return <section className={`dealership-workspace${compactOverview && currentView === "overview" ? " dl-compact-overview" : ""}`} aria-labelledby="dealership-title">
    <header className="dl-header"><div><p className="dl-eyebrow">DEALERSHIP</p><h2 id="dealership-title" ref={savedHeading} tabIndex={-1}>Vehicle operations</h2><p>Keep vehicle readiness, customer follow-up and recorded deliveries in one place.</p><p>Bring together reviewed DMS exports using the stock CSV template and dealership records. Vanteloq complements your system of record.</p></div><button type="button" disabled={busy || loading} onClick={() => void refreshRecords()}>Refresh records</button></header>
    <p className="dl-scope">{activeLocationId ? data?.locations.find(row => row.id === activeLocationId)?.name || "Selected location" : "All authorized locations"}{data ? ` · ${dateLabel(data.summary.from)} to ${dateLabel(data.summary.to)}` : ""}</p>
    {error && !editorOpen && <p className="dl-error" role="alert">{error}</p>}
    {message && <p className="dl-success" role="status">{message}</p>}
    {editor && !editorOpen && !uncertain && <div className="dl-actions"><button type="button" disabled={busy} onClick={() => setEditorOpen(true)}>Resume unsaved form</button><button type="button" disabled={busy} onClick={() => setEditor(null)}>Discard unsaved form</button></div>}
    {uncertain && <div className="dl-notice" role="status"><p>A save may have completed. Your original request is retained in this tab. Retry it to confirm the result before making another change.</p><button type="button" disabled={busy} onClick={() => { const request = pending.current; if (request) void write(request.body, request.after); }}>{busy ? "Confirming…" : "Confirm pending save"}</button></div>}
    {loading && <p role="status">Loading dealership records…</p>}
    {data && <>
      <form className="dl-filters" onSubmit={event => { event.preventDefault(); reads.current?.abort(); setData(null); setLoading(true); setError(""); setQuery({ ...filters }); }}>
        <label>Delivery period starts<input required type="date" value={filters.from} onChange={event => setFilters(current => ({ ...current, from: event.target.value }))}/></label>
        <label>Delivery period ends<input required type="date" min={filters.from} value={filters.to} onChange={event => setFilters(current => ({ ...current, to: event.target.value }))}/></label>
        <label className="dl-search">Find stock<input type="search" maxLength={100} placeholder="VIN, stock number, make or model" value={filters.q} onChange={event => setFilters(current => ({ ...current, q: event.target.value }))}/></label>
        <button type="submit" disabled={busy || loading || uncertain}>Apply</button>
      </form>
      <nav className="dl-tabs" aria-label="Dealership workspace">{tabs.filter(tab => tab[2]).map(([key, name]) => <button type="button" key={key} aria-pressed={currentView === key} onClick={() => setView(key)}>{name}</button>)}</nav>
      {data.permissions.export && <details className="dl-export"><summary>Export authorized records</summary><p className="dl-hint">Exports use the selected location, stock search or delivery period. Cost and profit columns follow your permissions.</p><div className="dl-actions"><button type="button" disabled={blocked} onClick={() => void exportRecords("stock")}>Export stock CSV</button>{data.permissions.sales && <><button type="button" disabled={blocked} onClick={() => void exportRecords("sales")}>Export deliveries CSV</button><button type="button" disabled={blocked} onClick={() => void exportRecords("summary")}>Export summary CSV</button></>}</div></details>}
      {currentView === "overview" && <><DealershipSummary data={data} search={query.q} onView={setView}/><DealershipAttention data={data} blocked={blocked} onAction={open}/><DealershipAnalytics data={data} search={query.q} agingReviewDays={agingReviewDays} onView={setView}/></>}
      {currentView === "inventory" && <>
        <div className="dl-section-heading"><div><h3>Vehicle inventory</h3><p>Each row is one stock episode. A returning vehicle keeps its identity and receives a new episode.</p></div><div className="dl-actions">{data.permissions.stockEdit && <button type="button" disabled={blocked} onClick={() => open("acquire")}>Add vehicle</button>}</div></div>
        {data.legacyAvailable > 0 && data.permissions.stockEdit && <div className="dl-notice"><p>{data.legacyAvailable} existing vehicle records can be brought into this workspace. Imported history and ownership remain marked incomplete until reviewed.</p><button type="button" disabled={blocked} onClick={() => open("adopt_legacy")}>Bring existing vehicle records</button></div>}
        {data.permissions.import && <details className="dl-card dl-import"><summary>Import stock from a CSV</summary><p>Use the exact template headings, up to 100 rows and 100 KB. Every row is checked before confirmation. Imports add stock episodes; they do not delete records missing from the file.</p><div className="dl-actions"><button type="button" onClick={() => {
          const url = URL.createObjectURL(new Blob([DEALERSHIP_CSV_TEMPLATE], { type: "text/csv;charset=utf-8" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "dealership-stock-template.csv"; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}>Download CSV template</button></div>
          <label>Import location<select value={importLocation} disabled={blocked} onChange={event => { setImportLocation(event.target.value); setPreview(null); }}><option value="">Choose a location</option>{locations.map(location => <option key={location.id} value={location.id}>{location.name} · {location.currency}</option>)}</select></label>
          <p className="dl-hint">Use owned or consignment for ownership; on_lot, offsite or in_transit for physical status; not_started, in_progress, ready or blocked for preparation. Asking amounts use decimal values in the chosen location&apos;s currency. Leave an unknown asking amount blank.</p>
          <label>Stock CSV<input type="file" accept=".csv,text/csv" disabled={blocked} onChange={async event => {
            const revision = ++fileRevision.current, file = event.target.files?.[0]; setCsv(""); setPreview(null); setError("");
            if (!file) return; if (file.size > 100_000) { setError("Use a CSV no larger than 100 KB."); return; }
            try { const text = await file.text(); if (alive.current && revision === fileRevision.current) setCsv(text); } catch { if (alive.current && revision === fileRevision.current) setError("The file could not be read. Select it again."); }
          }}/></label>
          <button type="button" disabled={blocked || !csv || !importLocation} onClick={() => void write({ action: "preview", locationId: importLocation, csv }, () => {})}>Preview CSV</button>
          {preview && <div className="dl-preview"><h4>Review {preview.count} stock records for {locations.find(location => location.id === importLocation)?.name}</h4><div className="dl-table-scroll" tabIndex={0} role="region" aria-label="CSV preview"><table><thead><tr><th>Vehicle</th><th>Identifier</th><th>Stock / acquired</th><th>Ownership</th><th>Physical / preparation</th><th>Asking amount</th></tr></thead><tbody>{preview.entries.map((entry, index) => <tr key={index}><td>{entry.vehicle.year} {entry.vehicle.make} {entry.vehicle.model}</td><td>{entry.vehicle.identifier}</td><td>{entry.vehicle.stockNumber}<small>{dateLabel(entry.vehicle.acquiredDate)}</small></td><td>{human(entry.ownership)}</td><td>{human(entry.physicalStatus)}<small>{human(entry.prepStatus)}</small></td><td>{dealershipMoney(entry.askingCents, locations.find(location => location.id === importLocation)?.currency || "CAD")}</td></tr>)}</tbody></table></div><div className="dl-actions"><button type="button" disabled={blocked} onClick={() => void write({ action: "confirm", locationId: importLocation, csv, fingerprint: preview.fingerprint }, () => { setPreview(null); setCsv(""); })}>Confirm and save {preview.count} records</button><button type="button" disabled={blocked} onClick={() => setPreview(null)}>Discard preview</button></div></div>}
        </details>}
        <DealershipStockTable data={data} blocked={blocked} onAction={open} agingReviewDays={agingReviewDays}/>
        {data.nextCursor && <button type="button" disabled={loading || busy} onClick={() => void refreshRecords(data.nextCursor || undefined)}>Load more stock</button>}
      </>}
      {currentView === "preparation" && <Preparation data={data} blocked={blocked} onAction={open}/>}
      {currentView === "sales" && <DealershipSalesTable data={data} blocked={blocked} onAction={open}/>}
      {currentView === "customers" && <Customers data={data} blocked={blocked} onAction={open}/>}
      {currentView === "team" && <DealershipTeam data={data}/>}
      {data.limits.truncated && <p className="dl-notice">This view reached the limit of {data.limits.relatedRows} related records. Narrow the location or delivery period. Summary totals cover the full selected scope; the lists and team breakdown below may be incomplete.</p>}
      <details className="dl-boundary"><summary>Sources, calculations and boundaries</summary><p>{data.boundary}</p><p>Stock counts use the selected location and stock search. Delivery summaries use the full selected location and delivery period. Dates are recorded business dates, and appointment times include a timezone offset. Different currencies remain separate.</p><p>Vehicle sales are recorded delivery activity. Reversals are shown separately; this is not accounting revenue or a bank balance. Operational gross uses only deliveries with reviewed, complete posted cost evidence. Missing costs are not zero.</p><p>Loaded {data.stock.length} stock records{data.nextCursor ? ", with more available" : ""}. Last response: {data.generatedAt}.</p></details>
    </>}
    {editor && editorOpen && data && <div className="dl-modal-backdrop" ref={modal} tabIndex={-1}><div className="dl-modal" role="dialog" aria-modal="true" aria-labelledby="dl-editor-title"><div className="dl-section-heading"><h3 id="dl-editor-title">{labels[editor.action]}</h3><button type="button" disabled={busy} onClick={() => setEditorOpen(false)} aria-label="Close form and keep input">Close</button></div><p className="dl-hint">Closing keeps this form in the current tab. A location change or page reload clears unsaved input.</p>{error && <p className="dl-error" role="alert">{error}</p>}{conflict && editor.context.episodeId || conflict && editor.context.id || conflict && editor.context.saleId ? <button type="button" disabled={blocked || loading} onClick={() => void replaceWithLatest()}>Reload record and replace form values</button> : null}{uncertain && <p className="dl-notice">The result is unconfirmed. Close this form and choose Confirm pending save to retry the original request.</p>}<form onSubmit={submit}><fieldset disabled={blocked}><EditorFields editor={editor} data={data} locations={editor.action === "transfer" ? data.locations : locations} onChange={setEditor}/></fieldset><div className="dl-actions"><button type="submit" disabled={blocked}>{busy ? "Saving…" : editor.action === "deliver" || editor.action === "reverse_sale" || editor.action === "adopt_legacy" ? `Confirm: ${labels[editor.action].toLowerCase()}` : labels[editor.action]}</button><button type="button" disabled={blocked} onClick={() => { setEditorOpen(false); setEditor(null); }}>Discard form</button></div></form></div></div>}
  </section>;
}

function Empty({ children }: { children: ReactNode }) { return <p className="dl-empty">{children}</p>; }
function Status({ value }: { value: string }) { return <span className={`dl-status dl-status-${value}`}>{human(value)}</span>; }

export function DealershipAttention({data,blocked=false,onAction}:{data:DealershipDashboard;blocked?:boolean;onAction:OpenEditor}) {
  if(!data.permissions.tasks || !data.attention)return null;
  const {tasks,totalTasks,truncated}=data.attention;
  return <section className="dl-card dl-attention" aria-labelledby="dl-attention-title"><div className="dl-section-heading"><div><p className="dl-eyebrow">Next actions</p><h3 id="dl-attention-title">What needs attention</h3><p>Blocked, unassigned or due tasks across the selected locations. Due dates use each location&apos;s calendar.</p></div><span className="dl-attention-count">{totalTasks} {totalTasks===1?"task":"tasks"}</span></div>
    {tasks.length===0?<p className="dl-empty">No blocked, unassigned or due tasks are recorded in this location scope.</p>:<ul className="dl-attention-list">{tasks.map(task=><li key={task.id}><div><div className="dl-attention-label"><Status value={task.status}/><h4>{task.title}</h4></div><p>{task.linkedLabel} · {task.locationName}</p><small>{task.assigneeName|| (task.assigneeId?"Assigned member":"Needs an owner")} · {task.dueDate ? `${task.dueDate<task.localDate?"Overdue":task.dueDate===task.localDate?"Due today":"Due"}: ${dateLabel(task.dueDate)}` : "No due date recorded"}</small>{task.blockedReason&&<p className="dl-attention-reason">{task.blockedReason}</p>}</div>{data.permissions.tasksEdit&&<button type="button" disabled={blocked} onClick={()=>onAction("save_task",task)}>Review task<span className="dl-sr-only">: {task.title}</span></button>}</li>)}</ul>}
    <p className="dl-hint">{truncated?"Showing the first 50 priority tasks. Narrow the location to review more. ":""}Stock search and delivery-period filters do not change this current task queue. A task status is recorded by your team and does not certify vehicle readiness.</p></section>;
}

export function DealershipSummary({ data, search = "", onView }: { data: DealershipDashboard; search?: string; onView?: (view: View) => void }) {
  const { summary, permissions } = data;
  const averages = dealerAverageGross(data);
  return <div className="dl-overview"><div className="dl-section-heading"><div><h3>Your dealership overview</h3><p>Recorded activity for {dateLabel(summary.from)} to {dateLabel(summary.to)}.</p></div></div>
    <div className="dl-metrics"><article><span>Active stock{search ? " matching search" : ""}</span><strong>{summary.activeStock}</strong><small>Current stock episodes in scope</small></article><article><span>Ready and available{search ? " matching search" : ""}</span><strong>{summary.availableStock}</strong><small>On lot, preparation ready and available</small></article>{summary.legacyIncomplete > 0 && <article><span>History to review</span><strong>{summary.legacyIncomplete}</strong><small>Adopted records with incomplete history</small></article>}</div>
    {permissions.sales && (summary.currencies.length ? summary.currencies.map(row => <section className="dl-card" key={row.currency}><h4>Delivery activity · {row.currency}</h4><div className="dl-metrics"><article><span>Delivered vehicles</span><strong>{row.deliveredUnits}</strong><small>One recorded delivery per stock episode</small></article><article><span>Recorded vehicle sales</span><strong>{dealershipMoney(row.vehicleSalesCents, row.currency)}</strong><small>Vehicle amount recorded at delivery</small></article>{permissions.profit && <article><span>Known operational gross</span><strong>{dealershipMoney(row.grossCents, row.currency)}</strong><small>{row.grossEligibleUnits} deliveries with complete costs; {row.missingCostUnits} excluded for missing costs</small></article>}</div>{row.reversedUnits > 0 && <p>{row.reversedUnits} reversals · {dealershipMoney(row.reversedSalesCents, row.currency)} shown separately from delivered activity.</p>}</section>) : <Empty>No deliveries are recorded in this period. Stock and preparation records remain available.</Empty>)}
    {averages.length > 0 && <div className="dl-metrics">{averages.map(row => <article key={row.currency}><span>Average recorded delivery gross · {row.currency}</span><strong>{dealershipMoney(row.averageCents, row.currency)}</strong><small>Known operational gross ÷ {row.eligibleUnits} cost-complete deliveries. {row.missingCostUnits} missing-cost deliveries excluded. Reversals remain separate from this delivery activity.</small></article>)}</div>}
    <div className="dl-actions">{onView && <button type="button" onClick={() => onView("inventory")}>Review inventory</button>}{onView && permissions.tasks && <button type="button" onClick={() => onView("preparation")}>Review preparation</button>}{onView && permissions.customers && <button type="button" onClick={() => onView("customers")}>Review follow-up</button>}</div>
  </div>;
}

export function DealershipAnalytics({ data, search = "", agingReviewDays = 60, onView }: { data: DealershipDashboard; search?: string; agingReviewDays?: number; onView?: (view: View) => void }) {
  const aging = dealerStockAging(data, agingReviewDays), appointments = dealerAppointmentOutcomes(data);
  const percentage = (value: number | null) => value === null ? "Not available" : new Intl.NumberFormat("en-CA", { style: "percent", maximumFractionDigits: 1 }).format(value);
  return <>
    <section className="dl-card" aria-labelledby="dealer-aging-heading"><div className="dl-section-heading"><div><p className="dl-eyebrow">Inventory intelligence</p><h3 id="dealer-aging-heading">Stock aging and recorded investment</h3><p>Current active stock from the loaded records{search ? " matching your search" : ""}. Calendar age follows each vehicle&apos;s location.</p></div>{onView && <button type="button" onClick={() => onView("inventory")}>Review stock</button>}</div>
      {aging.partial && <p className="dl-notice">Partial stock view. Load more stock in Inventory to include the remaining records. These figures are not totals for all stock.</p>}
      <div className="dl-metrics"><article><span>Loaded active vehicles</span><strong>{aging.activeUnits}</strong><small>Available, held and reserved episodes only</small></article><article><span>Aged {aging.threshold}+ calendar days</span><strong>{aging.agedUnits}</strong><small>{aging.ageKnownUnits} vehicles with known age; {aging.unknownAgeUnits} with unavailable age. The threshold is your review setting.</small></article></div>
      {aging.currencies.map(group => <div className="dl-table-scroll" key={group.currency} tabIndex={0} role="region" aria-label={`Stock aging in ${group.currency}`}><table><caption>Loaded active stock · {group.currency}</caption><thead><tr><th scope="col">Calendar age</th><th scope="col">Vehicles</th><th scope="col">Ownership</th>{data.permissions.costs && <><th scope="col">Known posted owned cost</th><th scope="col">Owned cost coverage</th></>}</tr></thead><tbody>{group.buckets.map(bucket => <tr key={bucket.label}><th scope="row">{bucket.label}</th><td>{bucket.units}</td><td>{bucket.ownedUnits} owned<small>{bucket.consignmentUnits} consignment · {bucket.unknownOwnershipUnits} unreviewed</small></td>{data.permissions.costs && <><td>{dealershipMoney(bucket.postedOwnedCostCents, group.currency)}</td><td>{bucket.knownCostUnits} of {bucket.ownedUnits} with posted costs<small>{bucket.reviewedCostUnits} reviewed complete</small></td></>}</tr>)}</tbody></table></div>)}
      <p className="dl-hint">Posted owned costs are recorded investment evidence. Incomplete costs remain labelled; consignment and unreviewed ownership are excluded from owned investment. Asking prices, holding costs, lender balances and unsold profit are not estimated. Delivery-period filters do not change current stock aging.</p>
    </section>
    {appointments && <section className="dl-card" aria-labelledby="dealer-appointments-heading"><div className="dl-section-heading"><div><p className="dl-eyebrow">Customer follow-through</p><h3 id="dealer-appointments-heading">Appointment outcomes</h3><p>Appointments dated {dateLabel(data.summary.from)} to {dateLabel(data.summary.to)} in each location&apos;s timezone.</p></div>{onView && <button type="button" onClick={() => onView("customers")}>Review appointments</button>}</div>
      <div className="dl-metrics"><article><span>Recorded show rate</span><strong>{percentage(appointments.showRate)}</strong><small>Attended ÷ (attended + no-show). {appointments.decided} known outcomes.</small></article><article><span>Attended / no-show</span><strong>{appointments.attended} / {appointments.noShow}</strong><small>{appointments.scheduled} scheduled and {appointments.cancelled} cancelled appointments excluded from the rate.</small></article></div>
      {appointments.reason && <p className="dl-hint">{appointments.reason} Counts describe matched loaded records.</p>}
      <p className="dl-hint">This measures recorded appointment attendance. F&amp;I income and lead-to-sale conversion require linked source records that are not captured here.</p>
    </section>}
  </>;
}

export function DealershipStockTable({ data, blocked = false, onAction, agingReviewDays = 60 }: { data: DealershipDashboard; blocked?: boolean; onAction?: OpenEditor; agingReviewDays?: number }) {
  const [selected, setSelected] = useState<string | null>(null), [availability, setAvailability] = useState("all"), [preparation, setPreparation] = useState("all"), [ageOnly, setAgeOnly] = useState(false);
  const detailRef = useRef<HTMLElement>(null), opener = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { if (selected) detailRef.current?.focus(); }, [selected]);
  const reviewAge = Number.isInteger(agingReviewDays) && agingReviewDays >= 1 && agingReviewDays <= 730 ? agingReviewDays : 60;
  const age = (stock: DealershipStock) => dealershipCalendarAge(stock.acquiredDate, data.generatedAt, data.locations.find(location => location.id === stock.locationId)?.timezone || "UTC");
  const active = (stock: DealershipStock) => !["delivered", "archived", "legacy_sold"].includes(stock.availability);
  const visible = data.stock.filter(stock => (availability === "all" || stock.availability === availability) && (preparation === "all" || stock.prepStatus === preparation) && (!ageOnly || active(stock) && (age(stock) ?? -1) >= reviewAge));
  const row = visible.find(item => item.id === selected);
  if (!data.stock.length) return <Empty>No stock records match this location and search. {data.permissions.stockEdit ? "Add a vehicle or preview a CSV to begin." : "An authorized inventory editor can add reviewed records."}</Empty>;
  return <><div className="dl-stock-filters"><label>Availability<select value={availability} onChange={event => setAvailability(event.target.value)}><option value="all">All loaded stock</option>{["available", "held", "reserved", "delivered", "archived", "legacy_sold"].map(value => <option key={value} value={value}>{human(value)}</option>)}</select></label><label>Preparation<select value={preparation} onChange={event => setPreparation(event.target.value)}><option value="all">All preparation states</option>{DEALERSHIP_PREP_STATUSES.map(value => <option key={value} value={value}>{human(value)}</option>)}</select></label><label className="dl-check"><input type="checkbox" checked={ageOnly} onChange={event => setAgeOnly(event.target.checked)}/><span>Active stock aged {reviewAge}+ calendar days</span></label></div><p className="dl-hint">Filters below apply to loaded stock only. Age uses the acquisition date and each location&apos;s calendar date. Your {reviewAge}-day threshold is a review setting, not an industry benchmark.</p><div className="dl-table-scroll" tabIndex={0} role="region" aria-label="Vehicle inventory"><table><caption>{visible.length} of {data.stock.length} loaded stock episodes{data.nextCursor ? ", more available" : ""}</caption><thead><tr><th>Vehicle / stock</th><th>Location / age</th><th>Availability</th><th>Preparation</th><th>Asking amount</th>{data.permissions.costs && <th>Posted cost / coverage</th>}<th>Review</th></tr></thead><tbody>{visible.map(stock => <tr key={stock.id}><td><strong>{vehicleName(stock)}</strong><small>{stock.stockNumber} · {stock.identifier}</small></td><td>{stock.locationName}<small>{active(stock) ? age(stock) == null ? "Age unavailable" : `${age(stock)} calendar days` : "Closed stock episode"}</small></td><td><Status value={stock.availability}/></td><td><Status value={stock.prepStatus}/></td><td>{dealershipMoney(stock.askingCents, stock.currency)}</td>{data.permissions.costs && <td>{dealershipMoney(stock.postedCostCents, stock.currency)}<small>{stock.costComplete ? "Reviewed complete" : "Incomplete costs"}</small></td>}<td><button type="button" aria-expanded={selected === stock.id} onClick={event => { opener.current = event.currentTarget; setSelected(selected === stock.id ? null : stock.id); }}>{selected === stock.id ? "Close" : "Details"}<span className="dl-sr-only"> for stock {stock.stockNumber}</span></button></td></tr>)}</tbody></table></div>{visible.length === 0 && <Empty>No loaded stock matches these filters. Adjust the filters or load more records.</Empty>}
    {row && <section className="dl-card dl-stock-detail" ref={detailRef} tabIndex={-1} aria-label={`Details for stock ${row.stockNumber}`}><div className="dl-section-heading"><div><h4>{vehicleName(row)} · {row.stockNumber}</h4><p>{row.identifierKind === "vin" ? "VIN" : "Legacy identifier"}: {row.identifier}</p></div><button type="button" onClick={() => { setSelected(null); opener.current?.focus(); }}>Close details</button></div><dl className="dl-facts"><div><dt>Acquired</dt><dd>{dateLabel(row.acquiredDate)}</dd></div><div><dt>Ownership</dt><dd>{human(row.ownership)}</dd></div><div><dt>Physical location</dt><dd>{human(row.physicalStatus)}</dd></div><div><dt>Preparation</dt><dd>{human(row.prepStatus)}</dd></div><div><dt>Source</dt><dd>{human(row.source)}</dd></div><div><dt>Record version</dt><dd>{row.version}</dd></div></dl>{row.legacyIncomplete && <p className="dl-notice">This record came from basic vehicle inventory. Its earlier lifecycle, ownership and delivery history have not been reconstructed.</p>}{row.reservationExpiresAt && <p>Reservation expires {instantLabel(row.reservationExpiresAt, data.locations.find(location => location.id === row.locationId)?.timezone || "UTC")}. Review the customer&apos;s status before releasing it.</p>}
      <div className="dl-actions">
        {onAction && data.permissions.stockEdit && !["delivered", "archived", "legacy_sold"].includes(row.availability) && <><button type="button" disabled={blocked} onClick={() => onAction("update_stock", row)}>Update stock</button>{row.availability !== "reserved" && <button type="button" disabled={blocked} onClick={() => onAction("transfer", row)}>Transfer</button>}</>}
        {onAction && data.permissions.sales && data.permissions.salesEdit && (row.availability === "available" ? <button type="button" disabled={blocked} onClick={() => onAction("reserve", row)}>Reserve</button> : row.availability === "reserved" ? <button type="button" disabled={blocked} onClick={() => onAction("release_reservation", row)}>Release reservation</button> : null)}
        {onAction && data.permissions.tasksEdit && data.permissions.tasks && <button type="button" disabled={blocked} onClick={() => onAction("save_task", row)}>Add task</button>}
        {onAction && data.permissions.costEdit && data.permissions.costs && !["delivered", "archived", "legacy_sold"].includes(row.availability) && <button type="button" disabled={blocked} onClick={() => onAction("add_cost", row)}>Record cost evidence</button>}
        {onAction && data.permissions.salesEdit && data.permissions.sales && dealershipDeliveryBlockers(row).length === 0 && <button type="button" disabled={blocked} onClick={() => onAction("deliver", row)}>Record delivery</button>}
      </div>
      {data.permissions.salesEdit && data.permissions.sales && active(row) && dealershipDeliveryBlockers(row).length > 0 && <p className="dl-notice">Before recording delivery: {dealershipDeliveryBlockers(row).join("; ")}. Update the stock record after reviewing the supporting evidence.</p>}
      {data.permissions.stockEdit && row.availability === "reserved" && <p className="dl-hint">An authorized sales editor must release the reservation before this stock can be transferred.</p>}
      {data.permissions.salesEdit && row.availability === "held" && <p className="dl-hint">Review and clear the hold in Update stock before creating a customer reservation.</p>}
      {data.permissions.costs && <details><summary>Cost evidence</summary><p>Estimated and approved amounts remain separate from posted costs. Only reviewed complete posted costs qualify for operational gross.</p>{data.costs.filter(cost => cost.episodeId === row.id).length ? <ul className="dl-record-list">{data.costs.filter(cost => cost.episodeId === row.id).map(cost => <li key={cost.id}><strong>{human(cost.category)} · {dealershipMoney(cost.amountCents, cost.currency)}</strong><Status value={cost.status}/><p>{cost.description || "No description recorded"}</p><small>Source reference: {cost.sourceReference || "Not recorded"}</small></li>)}</ul> : <p>No cost evidence recorded.</p>}</details>}
      {data.permissions.tasks && <details><summary>Preparation tasks for this stock</summary>{data.tasks.filter(task => task.episodeId === row.id).length ? <ul className="dl-record-list">{data.tasks.filter(task => task.episodeId === row.id).map(task => <li key={task.id}><strong>{task.title}</strong><Status value={task.status}/><small>{personName(data, task.assigneeId)} · {task.dueDate ? dateLabel(task.dueDate) : "No due date"}</small>{onAction && data.permissions.tasksEdit && <button type="button" disabled={blocked} onClick={() => onAction("save_task", task)}>Update task</button>}</li>)}</ul> : <p>No tasks recorded for this stock.</p>}</details>}
    </section>}
  </>;
}

function Preparation({ data, blocked, onAction }: { data: DealershipDashboard; blocked: boolean; onAction: OpenEditor }) {
  const [status, setStatus] = useState("active");
  const rows = data.tasks.filter(task => status === "all" || (status === "active" ? task.status !== "done" : task.status === status));
  return <><div className="dl-section-heading"><div><h3>Preparation and follow-through</h3><p>Assign work, record blockers and keep completed tasks for review.</p></div>{data.permissions.tasksEdit && <button type="button" disabled={blocked} onClick={() => onAction("save_task")}>Add task</button>}</div><label className="dl-compact-field">Task status<select value={status} onChange={event => setStatus(event.target.value)}><option value="active">Active tasks</option><option value="all">All tasks</option>{DEALERSHIP_TASK_STATUSES.map(value => <option key={value} value={value}>{human(value)}</option>)}</select></label>{rows.length ? <ul className="dl-record-list">{rows.map(task => <li key={task.id}><div className="dl-section-heading"><h4>{task.title}</h4><Status value={task.status}/></div><p>{personName(data, task.assigneeId)} · {task.dueDate ? `Due ${dateLabel(task.dueDate)}` : "No due date"}</p><p className="dl-hint">{task.episodeId ? `Stock ${data.stock.find(row => row.id === task.episodeId)?.stockNumber || "outside the loaded stock page"}` : "General task"}{task.leadId ? ` · Lead: ${data.leads.find(lead => lead.id === task.leadId)?.customerName || "linked customer record"}` : ""}</p>{task.blockedReason && <p>Blocker: {task.blockedReason}</p>}{data.permissions.tasksEdit && <button type="button" disabled={blocked} onClick={() => onAction("save_task", task)}>Update task</button>}</li>)}</ul> : <Empty>No tasks match this view. Add a task when work needs an owner or follow-up.</Empty>}</>;
}

export function DealershipSalesTable({ data, blocked = false, onAction }: { data: DealershipDashboard; blocked?: boolean; onAction?: OpenEditor }) {
  if (!data.permissions.sales) return null;
  return <><div className="dl-section-heading"><div><h3>Deals and recorded deliveries</h3><p>Record delivery from a vehicle&apos;s inventory details. Holds and reservations remain in Inventory until delivery is confirmed.</p></div></div>{data.sales.length ? <div className="dl-table-scroll" tabIndex={0} role="region" aria-label="Recorded deliveries"><table><thead><tr><th>Stock / delivery date</th><th>Channel / status</th><th>Vehicle amount</th>{data.permissions.profit && <th>Operational gross</th>}<th>Sales credit</th>{data.permissions.salesEdit && onAction && <th>Review</th>}</tr></thead><tbody>{data.sales.map(sale => <tr key={sale.id}><td><strong>{sale.stockNumber}</strong><small>{dateLabel(sale.deliveredDate)}</small></td><td>{human(sale.channel)}<small>{human(sale.status)}{sale.reversalDate ? ` on ${dateLabel(sale.reversalDate)}` : ""}</small></td><td>{dealershipMoney(sale.amountCents, sale.currency)}</td>{data.permissions.profit && <td>{sale.grossCents == null ? "Costs incomplete" : dealershipMoney(sale.grossCents, sale.currency)}</td>}<td>{sale.credits.map(credit => <small key={credit.personId}>{credit.name || personName(data, credit.personId)}: {credit.shareBps / 100}%</small>)}{sale.unallocatedBps > 0 && <small>Unallocated: {sale.unallocatedBps / 100}%</small>}</td>{data.permissions.salesEdit && onAction && <td>{sale.status === "delivered" ? <button type="button" disabled={blocked} onClick={() => onAction("reverse_sale", sale)}>Reverse delivery</button> : "Reversal retained"}</td>}</tr>)}</tbody></table></div> : <Empty>No deliveries recorded in the selected period. Recording a reservation, deposit or task does not create a delivered sale.</Empty>}</>;
}

function Customers({ data, blocked, onAction }: { data: DealershipDashboard; blocked: boolean; onAction: OpenEditor }) {
  return <><div className="dl-section-heading"><div><h3>Leads and appointments</h3><p>Record customer follow-up and attendance. Saving here does not contact customers or send invitations.</p></div>{data.permissions.customersEdit && <button type="button" disabled={blocked} onClick={() => onAction("save_lead")}>Add lead</button>}</div>{data.leads.length ? <ul className="dl-record-list">{data.leads.map(lead => <li key={lead.id}><div className="dl-section-heading"><h4>{lead.customerName}</h4><Status value={lead.stage}/></div><p>{lead.contact || "No contact recorded"}</p><p className="dl-hint">{personName(data, lead.assigneeId)} · {lead.nextActionDate ? `Follow up ${dateLabel(lead.nextActionDate)}` : "No follow-up date"} · {data.locations.find(location => location.id === lead.locationId)?.name || "Authorized location"}</p><div className="dl-actions">{data.permissions.customersEdit && <><button type="button" disabled={blocked} onClick={() => onAction("save_lead", lead)}>Update lead</button><button type="button" disabled={blocked} onClick={() => onAction("save_appointment", lead)}>Add appointment</button></>}</div>{data.appointments.filter(row => row.leadId === lead.id).map(appointment => <div key={appointment.id} className="dl-appointment"><div><strong>{instantLabel(appointment.scheduledAt, data.locations.find(location => location.id === lead.locationId)?.timezone || "UTC")}</strong><small>{human(appointment.status)}</small></div>{data.permissions.customersEdit && <button type="button" disabled={blocked} onClick={() => onAction("save_appointment", appointment)}>Update appointment</button>}</div>)}</li>)}</ul> : <Empty>No leads recorded in this location scope.</Empty>}</>;
}

export function DealershipTeam({ data }: { data: DealershipDashboard }) {
  const delivered = data.permissions.sales ? data.sales.filter(sale => sale.status === "delivered") : [];
  return <><div className="dl-section-heading"><div><h3>Team follow-through</h3><p>Assignments and credit from the loaded records. Sales credit is attribution, not a commission or payroll calculation.</p></div></div>{data.limits.truncated && <p className="dl-notice">Partial team view: the related-record limit was reached. These counts and allocations cover loaded records only, not the full business.</p>}{data.people.length ? <ul className="dl-team-grid">{data.people.map(person => {
    const tasks = data.permissions.tasks ? data.tasks.filter(task => task.assigneeId === person.id && task.status !== "done") : [];
    const credits = delivered.flatMap(sale => sale.credits.filter(credit => credit.personId === person.id).map(credit => ({ sale, credit })));
    return <li className="dl-card" key={person.id}><h4>{person.name}</h4>{data.permissions.tasks && <p>{tasks.length} active assigned tasks{tasks.filter(task => task.status === "blocked").length ? ` · ${tasks.filter(task => task.status === "blocked").length} blocked` : ""}</p>}{data.permissions.sales && <><p>{credits.reduce((sum, entry) => sum + entry.credit.shareBps, 0) / 10_000} credited units across {credits.length} deliveries</p>{[...new Set(credits.map(entry => entry.sale.currency))].map(currency => {
      const entries = credits.filter(entry => entry.sale.currency === currency);
      const allocated = entries.every(entry => entry.credit.allocatedSalesCents != null) ? entries.reduce((sum, entry) => sum + entry.credit.allocatedSalesCents!, 0) : null;
      return <p className="dl-hint" key={currency}>{dealershipMoney(allocated, currency)} allocated vehicle sales</p>;
    })}</>}</li>;
  })}</ul> : <Empty>No assignable team members are available in this scope.</Empty>}{data.permissions.tasks && <p>{data.tasks.filter(task => !task.assigneeId && task.status !== "done").length} active tasks are unassigned.</p>}{data.permissions.sales && <p>{delivered.reduce((sum, sale) => sum + sale.unallocatedBps, 0) / 10_000} delivered units have unallocated credit.</p>}</>;
}

function EditorFields({ editor, data, locations, onChange }: { editor: Editor; data: DealershipDashboard; locations: DealershipDashboard["locations"]; onChange: (editor: Editor) => void }) {
  const { action, draft: d } = editor;
  const set = (key: string, value: string) => onChange({ ...editor, draft: { ...d, [key]: value, ...(action === "save_task" && value && key === "episodeId" ? { leadId: "" } : {}), ...(action === "save_task" && value && key === "leadId" ? { episodeId: "" } : {}) } });
  const text = (key: string, label: string, options: { required?: boolean; type?: string; hint?: string; maxLength?: number } = {}) => <label key={key}>{label}{options.required === false ? " (optional)" : ""}<FormInput required={options.required !== false} type={options.type || "text"} value={d[key] || ""} maxLength={options.maxLength || 160} hint={options.hint} onChange={event => set(key, event.target.value)} {...(["asking", "amount"].includes(key) ? { inputMode: "decimal" as const } : {})}/></label>;
  const select = (key: string, label: string, options: readonly string[] | { id: string; name: string }[], optional = false, locked = false) => <label key={key}>{label}{optional ? " (optional)" : ""}<select required={!optional} disabled={locked} value={d[key] || ""} onChange={event => set(key, event.target.value)}><option value="">{optional ? "Unassigned" : "Choose…"}</option>{d[key] && !options.some(option => (typeof option === "string" ? option : option.id) === d[key]) && <option value={d[key]}>Current linked record (outside this list)</option>}{options.map(option => typeof option === "string" ? <option key={option} value={option}>{human(option)}</option> : <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>;
  const location = () => select("locationId", action === "transfer" ? "Destination location" : "Location", locations.map(row => ({ id: row.id, name: `${row.name} · ${row.currency}` })), false, action === "save_lead" && !!editor.context.id);
  const stock = data.stock.find(row => row.id === editor.context.episodeId || row.id === d.episodeId);
  const sale = data.sales.find(row => row.id === editor.context.saleId);
  const currency = stock?.currency || data.locations.find(row => row.id === d.locationId)?.currency || "location currency";
  const person = () => select("assigneeId", "Assigned team member", data.people, true);
  const leadOptions = data.leads.filter(lead => !stock || lead.locationId === stock.locationId).map(lead => ({ id: lead.id, name: lead.customerName }));
  const timeFields = () => <>{text("localTime", action === "reserve" ? "Reservation expiry date and local time" : "Appointment date and local time", { type: "datetime-local" })}{text("utcOffset", "UTC offset on that date", { maxLength: 6, hint: `Use ±HH:MM, such as -06:00. Confirm daylight saving time for ${data.locations.find(row => row.id === (stock?.locationId || data.leads.find(lead => lead.id === d.leadId)?.locationId))?.timezone || "the selected location"}.` })}</>;
  return <>
    {stock && <p className="dl-form-context">{vehicleName(stock)} · stock {stock.stockNumber} · {stock.locationName}</p>}
    {sale && <p className="dl-form-context">Stock {sale.stockNumber} · delivered {dateLabel(sale.deliveredDate)} · {dealershipMoney(sale.amountCents, sale.currency)} · {human(sale.status)}</p>}
    {action === "acquire" && <>{location()}{select("identifierKind", "Identifier type", [{ id: "vin", name: "17-character VIN" }, { id: "legacy", name: "Pre-1981 legacy identifier" }])}{text("identifier", d.identifierKind === "legacy" ? "Legacy identifier" : "VIN", { maxLength: d.identifierKind === "vin" ? 17 : 40 })}{text("year", "Model year", { maxLength: 4 })}{text("make", "Make", { maxLength: 80 })}{text("model", "Model", { maxLength: 120 })}{text("stockNumber", "Stock number", { maxLength: 40 })}{text("acquiredDate", "Acquisition date", { type: "date" })}{select("ownership", "Ownership", ["owned", "consignment"])}<p className="dl-hint">The identifier is checked for structure only. No vehicle history, ownership or VIN decoding service is connected.</p></>}
    {(action === "acquire" || action === "update_stock") && <>{action === "update_stock" && select("ownership", "Ownership", ["owned", "consignment", "unknown"])}{select("physicalStatus", "Physical status", DEALERSHIP_PHYSICAL_STATUSES)}{select("prepStatus", "Preparation status", DEALERSHIP_PREP_STATUSES)}{select("availability", "Availability", d.availability === "reserved" ? ["reserved"] : ["available", "held", ...(action === "update_stock" ? ["archived"] : [])])}{text("asking", `Asking amount in ${currency}`, { required: false, hint: "Leave blank if unknown. Use two decimal places, without symbols or separators." })}{action === "update_stock" && data.permissions.costApprove && data.permissions.costs && <label className="dl-check"><input type="checkbox" checked={d.costComplete === "true"} onChange={event => set("costComplete", String(event.target.checked))}/><span>I reviewed the posted costs and they are complete for this stock episode.</span></label>}</>}
    {action === "transfer" && <>{location()}<p className="dl-notice">Transfers move this active stock episode to the selected authorized location. Existing related records remain associated with the episode. Review any open reservations first.</p></>}
    {action === "adopt_legacy" && <>{location()}<p className="dl-notice">Bring up to 100 existing vehicle records from this location. This preserves identifiers and recorded amounts, while explicitly marking unknown ownership and incomplete history. It does not create delivery revenue or prove cost completeness.</p></>}
    {action === "add_cost" && <>{select("category", "Cost category", DEALERSHIP_COST_CATEGORIES)}{select("status", "Evidence status", data.permissions.costApprove ? ["estimated", "approved", "posted"] : ["estimated"])}{text("amount", `Amount in ${currency}`, { hint: "Enter 0 only for a verified zero. Estimated or approved amounts are not posted costs." })}{text("description", "Description", { maxLength: 300 })}{text("sourceReference", "Source reference", { required: d.status === "posted", maxLength: 200, hint: "Use an invoice or document reference. Required for posted evidence." })}<p className="dl-hint">Each save adds a cost entry. For an estimate that becomes posted, record the posted evidence once; the estimate remains separate.</p></>}
    {action === "save_task" && <>{text("title", "Task title", { maxLength: 200 })}{select("status", "Task status", DEALERSHIP_TASK_STATUSES)}<p className="dl-hint">Link this task to one vehicle or one customer lead. Selecting one clears the other. Existing task links are retained.</p>{select("episodeId", "Vehicle stock", data.stock.map(row => ({ id: row.id, name: `${row.stockNumber} · ${vehicleName(row)}` })), true, !!editor.context.id)}{data.permissions.customers && select("leadId", "Related lead", leadOptions, true, !!editor.context.id)}{person()}{text("dueDate", "Due date", { type: "date", required: false })}{text("blockedReason", "Blocker or next step", { required: d.status === "blocked", maxLength: 300 })}</>}
    {action === "save_lead" && <>{location()}{text("customerName", "Customer name", { maxLength: 160 })}{text("contact", "Contact information", { required: false, maxLength: 200 })}{select("stage", "Lead stage", DEALERSHIP_LEAD_STAGES)}{person()}{text("nextActionDate", "Next follow-up date", { type: "date", required: false })}</>}
    {action === "save_appointment" && <>{select("leadId", "Customer lead", leadOptions, false, !!editor.context.id)}{timeFields()}{select("status", "Appointment status", DEALERSHIP_APPOINTMENT_STATUSES)}<p className="dl-hint">This records an appointment only. It does not send an invitation or a reminder.</p></>}
    {action === "reserve" && <>{data.permissions.customers && select("leadId", "Customer lead", leadOptions, true)}{timeFields()}<p className="dl-hint">A reservation changes availability. It does not record a deposit, signed contract or delivery.</p></>}
    {action === "release_reservation" && <p>Confirm that this reservation should be released. This action does not refund a deposit or contact the customer.</p>}
    {action === "deliver" && <>{text("deliveredDate", "Actual delivery date", { type: "date" })}{select("channel", "Sale channel", ["retail", "wholesale"])}{text("amount", `Vehicle sale amount in ${currency}`, { hint: "Use the reviewed vehicle amount. This is not a payment or an accounting posting." })}<h4>Sales credit</h4><p className="dl-hint">Allocate up to 100%. Any remainder stays explicitly unallocated. Credit does not calculate commission.</p>{editor.credits.map((credit, index) => <div className="dl-credit-row" key={index}><label>Team member {index + 1}<select required value={credit.personId} onChange={event => onChange({ ...editor, credits: editor.credits.map((item, position) => position === index ? { ...item, personId: event.target.value } : item) })}><option value="">Choose a team member</option>{data.people.map(person => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label><label>Credit percentage<FormInput required inputMode="decimal" value={credit.share} hint="Up to two decimal places" onChange={event => onChange({ ...editor, credits: editor.credits.map((item, position) => position === index ? { ...item, share: event.target.value } : item) })}/></label><button type="button" onClick={() => onChange({ ...editor, credits: editor.credits.filter((_, position) => position !== index) })}>Remove allocation {index + 1}</button></div>)}{editor.credits.length < 10 && data.people.length > 0 && <button type="button" onClick={() => onChange({ ...editor, credits: [...editor.credits, { personId: "", share: "" }] })}>Add sales credit</button>}<p className="dl-notice">Confirm only an actual delivery supported by your records. This records the delivery event and its attribution. It does not collect money or post a journal entry.</p></>}
    {action === "reverse_sale" && <>{text("date", "Reversal date", { type: "date" })}{text("reason", "Reason for reversal", { maxLength: 300 })}<p className="dl-notice">The original delivery and this reversal remain recorded. This does not issue a refund or automatically create a new acquisition episode.</p></>}
  </>;
}
