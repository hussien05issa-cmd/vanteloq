"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { apiFetch } from "./supabase-browser";
import { VEHICLE_CSV_TEMPLATE, VEHICLE_STATUSES, validateVehicle, vehicleAmount, vehicleAmountToCents, type VehicleInput, type VehicleRecord } from "../domain/vehicles";
import "./vehicle-inventory.css";

type Location = { id: string; name: string; currency: string };
type InventoryData = { vehicles: VehicleRecord[]; nextCursor: string | null; locations: Location[]; source: string;
  permissions: { edit: boolean; import: boolean; costs: boolean; export: boolean } };
type Preview = { entries: VehicleInput[]; fingerprint: string; count: number; location: { id: string; name: string } };
type Draft = { identifierKind: "vin" | "legacy"; identifier: string; year: string; make: string; model: string; stockNumber: string; status: VehicleInput["status"]; acquiredDate: string; acquisition: string; reconditioning: string };
const emptyDraft = (): Draft => ({ identifierKind: "vin", identifier: "", year: "", make: "", model: "", stockNumber: "", status: "available", acquiredDate: "", acquisition: "", reconditioning: "" });
const displayStatus = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const money = (cents: number | null, currency: string) => cents === null ? "Not recorded" : new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(cents / 100);
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), anchor = document.createElement("a");
  anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function responseBody(response: Response) {
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message || "Vehicle records could not be loaded. Try again.");
  return payload;
}

export default function InventoryVehicleWorkspace({ industry, activeLocationId, children }: { industry: string; activeLocationId: string | null; children: ReactNode }) {
  const [view, setView] = useState<"products" | "vehicles">(industry.toLowerCase() === "dealership" ? "vehicles" : "products");
  return <div className="vehicle-inventory-workspace">
    <div className="vehicle-inventory-switch" role="group" aria-label="Inventory records">
      <button type="button" aria-pressed={view === "products"} onClick={() => setView("products")}>Products</button>
      <button type="button" aria-pressed={view === "vehicles"} onClick={() => setView("vehicles")}>Vehicles</button>
    </div>
    {view === "vehicles" ? <VehicleInventoryPanel key={activeLocationId ?? "all"} activeLocationId={activeLocationId}/> : children}
  </div>;
}

export function VehicleInventoryPanel({ activeLocationId }: { activeLocationId: string | null }) {
  const [data, setData] = useState<InventoryData | null>(null), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [reload, setReload] = useState(0);
  const [locationId, setLocationId] = useState(activeLocationId ?? ""), [editing, setEditing] = useState<VehicleRecord | null>(null), [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft), [csv, setCsv] = useState(""), [preview, setPreview] = useState<Preview | null>(null);
  const readController = useRef<AbortController | null>(null), writeController = useRef<AbortController | null>(null), fileRevision = useRef(0);
  const formHeading = useRef<HTMLHeadingElement>(null);

  const load = useCallback((after?: string) => {
    readController.current?.abort();
    const controller = new AbortController(); readController.current = controller;
    const query = new URLSearchParams();
    if (activeLocationId) query.set("locationId", activeLocationId);
    if (after) query.set("after", after);
    return apiFetch(`/api/v1/vehicles?${query}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) }).then(responseBody).then((payload: InventoryData) => {
      if (controller.signal.aborted) return;
      setData(current => ({ ...payload, vehicles: after ? [...(current?.vehicles ?? []), ...payload.vehicles] : payload.vehicles }));
      setLocationId(current => current || (payload.locations.length === 1 ? payload.locations[0].id : ""));
    }).catch(caught => {
      if (!controller.signal.aborted) { setData(null); setError(caught instanceof Error ? caught.message : "Vehicle records could not be loaded."); }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
  }, [activeLocationId]);
  useEffect(() => {
    const fileReads = fileRevision;
    void load();
    return () => { readController.current?.abort(); writeController.current?.abort(); fileReads.current++; };
  }, [load, reload]);
  useEffect(() => { if (showForm) formHeading.current?.focus(); }, [showForm]);
  const selectedLocation = data?.locations.find(location => location.id === locationId);

  function edit(row?: VehicleRecord) {
    setError(""); setMessage(""); setEditing(row ?? null); setShowForm(true);
    if (row) {
      setLocationId(row.locationId);
      setDraft({ identifierKind: row.identifierKind, identifier: row.identifier, year: String(row.year), make: row.make, model: row.model, stockNumber: row.stockNumber, status: row.status, acquiredDate: row.acquiredDate, acquisition: vehicleAmount(row.acquisitionCents), reconditioning: vehicleAmount(row.reconditioningCents) });
    } else setDraft(emptyDraft());
  }
  async function write(action: "save" | "preview" | "confirm") {
    if (busy || !selectedLocation) { if (!selectedLocation) setError("Select a location before recording vehicles."); return; }
    const controller = new AbortController(); writeController.current = controller;
    setBusy(true); setError(""); setMessage("");
    try {
      let body: Record<string, unknown>;
      if (action === "save") {
        const vehicle = validateVehicle({ ...draft, year: Number(draft.year), currency: selectedLocation.currency,
          acquisitionCents: data?.permissions.costs ? vehicleAmountToCents(draft.acquisition) : null,
          reconditioningCents: data?.permissions.costs ? vehicleAmountToCents(draft.reconditioning) : null });
        body = { action: "create", vehicle, locationId, ...(editing ? { id: editing.id, expectedVersion: editing.version } : {}) };
      } else body = { action, csv, locationId, ...(action === "confirm" ? { fingerprint: preview?.fingerprint } : {}) };
      const result = await responseBody(await apiFetch("/api/v1/vehicles", { method: action === "save" && editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) }));
      if (controller.signal.aborted) return;
      if (action === "preview") { setPreview(result); setMessage("Review every row below before confirming. Nothing has been saved."); }
      else {
        setPreview(null); setCsv(""); setEditing(null); setShowForm(false); setDraft(emptyDraft());
        setMessage(action === "confirm" ? `${result.saved} vehicle records saved.` : "Vehicle record saved.");
        await load();
      }
    } catch (caught) { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "The request could not finish. Reload records before retrying a save."); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  async function exportRecords() {
    if (busy) return;
    const controller = new AbortController(); writeController.current = controller;
    setBusy(true); setError("");
    try {
      const query = new URLSearchParams({ format: "csv" }); if (activeLocationId) query.set("locationId", activeLocationId);
      const response = await apiFetch(`/api/v1/vehicles?${query}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) });
      if (!response.ok) await responseBody(response);
      const blob = await response.blob();
      if (!controller.signal.aborted) download(blob, "vehicle-inventory.csv");
    } catch (caught) { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "The export could not be downloaded."); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  const set = (key: keyof Draft, value: string) => setDraft(current => ({ ...current, [key]: value }));
  const submit = (event: FormEvent) => { event.preventDefault(); void write("save"); };
  return <section className="vehicle-inventory" aria-labelledby="vehicle-inventory-title">
    <header><div><p>INVENTORY</p><h2 id="vehicle-inventory-title">Vehicle records</h2><span>VIN, stock status and recorded costs, organized by location.</span></div><div className="vehicle-actions">
      {data?.permissions.edit && <button type="button" disabled={busy} onClick={() => edit()}>Add vehicle</button>}
      {data?.permissions.export && <button type="button" disabled={busy || loading} onClick={() => void exportRecords()}>Export records</button>}
      <button type="button" disabled={busy || loading} onClick={() => { setShowForm(false); setEditing(null); setPreview(null); setLoading(true); setError(""); setReload(value => value + 1); }}>Reload latest records</button>
    </div></header>
    {error && <p className="vehicle-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {loading && <p role="status">Loading vehicle records…</p>}
    {data && <>
      <p className="vehicle-boundary">{data.source} A sold status does not record a sale amount, disposal date or payment.</p>
      {data.permissions.edit && <label className="vehicle-location">Location for new or edited records<select value={locationId} disabled={busy} onChange={event => { setLocationId(event.target.value); setPreview(null); }}><option value="">Choose a location</option>{data.locations.map(location => <option key={location.id} value={location.id}>{location.name} · {location.currency}</option>)}</select></label>}
      {showForm && data.permissions.edit && <form onSubmit={submit} className="vehicle-form">
        <h3 tabIndex={-1} ref={formHeading}>{editing ? `Edit stock ${editing.stockNumber}` : "Add a vehicle"}</h3>
        <p>Enter values from reviewed records. Leave optional costs blank when unknown; enter 0 only for a verified zero.</p>
        <label>Identifier type<select value={draft.identifierKind} disabled={busy} onChange={event => set("identifierKind", event.target.value)}><option value="vin">17-character VIN</option><option value="legacy">Pre-1981 legacy identifier</option></select></label>
        <label>{draft.identifierKind === "vin" ? "VIN" : "Legacy identifier"}<input required maxLength={draft.identifierKind === "vin" ? 17 : 40} value={draft.identifier} disabled={busy} onChange={event => set("identifier", event.target.value)} autoCapitalize="characters" spellCheck={false}/></label>
        <label>Model year<input required inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={draft.year} disabled={busy} onChange={event => set("year", event.target.value)}/></label>
        <label>Make<input required maxLength={80} value={draft.make} disabled={busy} onChange={event => set("make", event.target.value)}/></label>
        <label>Model<input required maxLength={120} value={draft.model} disabled={busy} onChange={event => set("model", event.target.value)}/></label>
        <label>Stock number<input required maxLength={40} value={draft.stockNumber} disabled={busy} onChange={event => set("stockNumber", event.target.value)}/></label>
        <label>Status<select value={draft.status} disabled={busy} onChange={event => set("status", event.target.value)}>{VEHICLE_STATUSES.map(status => <option key={status} value={status}>{displayStatus(status)}</option>)}</select></label>
        <label>Acquisition date<input required type="date" value={draft.acquiredDate} disabled={busy} onChange={event => set("acquiredDate", event.target.value)}/></label>
        {data.permissions.costs && <><label>Acquisition cost in {selectedLocation?.currency ?? "location currency"} (optional)<input inputMode="decimal" value={draft.acquisition} disabled={busy} onChange={event => set("acquisition", event.target.value)} placeholder="Leave blank if unknown"/></label><label>Reconditioning cost in {selectedLocation?.currency ?? "location currency"} (optional)<input inputMode="decimal" value={draft.reconditioning} disabled={busy} onChange={event => set("reconditioning", event.target.value)} placeholder="Leave blank if unknown"/></label></>}
        <div className="vehicle-actions"><button type="submit" disabled={busy || !selectedLocation}>{busy ? "Saving…" : "Save vehicle"}</button><button type="button" disabled={busy} onClick={() => { setShowForm(false); setEditing(null); }}>Cancel</button></div>
      </form>}
      {data.permissions.import && <details className="vehicle-import"><summary>Import reviewed vehicle records</summary><p>Use the exact template, one vehicle per row, up to 100 rows and 100 KB. Costs use decimal amounts in the selected location&apos;s currency. Imports create records; edit existing stock individually. CSV files stay in this browser until you request a preview.</p>
        <button type="button" onClick={() => download(new Blob([VEHICLE_CSV_TEMPLATE], { type: "text/csv" }), "vehicle-inventory-template.csv")}>Download CSV template</button>
        <label>Vehicle CSV<input type="file" accept=".csv,text/csv" disabled={busy} onChange={async event => {
          const file = event.target.files?.[0], revision = ++fileRevision.current; setCsv(""); setPreview(null); setError("");
          if (!file) return;
          if (file.size > 100_000) { setError("Use a CSV smaller than 100 KB."); return; }
          try { const value = await file.text(); if (fileRevision.current === revision) setCsv(value); }
          catch { if (fileRevision.current === revision) setError("This file could not be read."); }
        }}/></label>
        <button type="button" disabled={busy || !csv || !selectedLocation} onClick={() => void write("preview")}>{busy ? "Checking…" : "Preview CSV"}</button>
        {preview && <div className="vehicle-preview"><h3>Review {preview.count} records for {preview.location.name}</h3><VehicleTable rows={preview.entries} costs={data.permissions.costs}/><button type="button" disabled={busy} onClick={() => void write("confirm")}>Confirm and save {preview.count} records</button><button type="button" disabled={busy} onClick={() => setPreview(null)}>Cancel import</button></div>}
      </details>}
      {data.vehicles.length ? <><p>{data.vehicles.length} records shown{data.nextCursor ? ", more available" : ""}. Archived and sold records remain visible for review.</p><VehicleTable rows={data.vehicles} costs={data.permissions.costs} onEdit={data.permissions.edit && !busy ? edit : undefined}/>{data.nextCursor && <button type="button" disabled={busy || loading} onClick={() => { setLoading(true); setError(""); void load(data.nextCursor!); }}>Load more vehicles</button>}</> : !loading && <p className="vehicle-empty">No vehicle records are available in this location scope. {data.permissions.edit ? "Add a vehicle or preview a CSV to start." : "An authorized inventory editor can add reviewed records."}</p>}
    </>}
  </section>;
}

function VehicleTable({ rows, costs, onEdit }: { rows: Array<VehicleInput | VehicleRecord>; costs: boolean; onEdit?: (row: VehicleRecord) => void }) {
  return <div className="vehicle-table-scroll" tabIndex={0} role="region" aria-label="Vehicle inventory records"><table><caption>Recorded vehicle details{costs ? " and optional costs" : ""}</caption><thead><tr><th>Stock / identifier</th><th>Vehicle</th><th>Status / acquired</th><th>Location / source</th>{costs && <><th>Acquisition</th><th>Reconditioning</th></>}{onEdit && <th>Actions</th>}</tr></thead><tbody>{rows.map((row, index) => <tr key={"id" in row ? row.id : index}><td><strong>{row.stockNumber}</strong><span>{row.identifierKind === "legacy" ? "Legacy: " : "VIN: "}{row.identifier}</span></td><td>{row.year} {row.make} {row.model}</td><td>{displayStatus(row.status)}<span>{row.acquiredDate}</span></td><td>{"locationName" in row ? row.locationName : "Selected location"}<span>{"source" in row ? `${row.source.toUpperCase()} · Version ${row.version}` : "CSV preview"}</span></td>{costs && <><td>{money(row.acquisitionCents, row.currency)}</td><td>{money(row.reconditioningCents, row.currency)}</td></>}{onEdit && <td>{"id" in row && <button type="button" aria-label={`Edit stock ${row.stockNumber}`} onClick={() => onEdit(row)}>Edit</button>}</td>}</tr>)}</tbody></table></div>;
}
