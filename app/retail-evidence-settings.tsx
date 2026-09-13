"use client";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "./supabase-browser";
import { measurementDescriptions, measurementTemplates, parseMeasurementCsv, type MeasurementKind } from "../domain/retail-measurements";
import type { RetailMeasurement } from "../domain/retail-intelligence";
import type { RetailAccess } from "./retail-intelligence-panel";

type Choice = { provider: string; connectionId: string; outletRef: string; label: string };
type Dataset = Choice & { id: string; kind: MeasurementKind; from: string; to: string; source: string; version: number; entries: Array<{ reference: string; values: RetailMeasurement["values"] }> };
const csvCell = (value: unknown) => '"' + String(value ?? "").replaceAll('"', '""') + '"';
export default function RetailEvidenceSettings({ from, to, locationId, access, onSaved, onClose }: {
  from: string; to: string; locationId: string | null; access: RetailAccess; onSaved: () => void; onClose: () => void;
}) {
  const kinds: MeasurementKind[] = [...(access.inventory ? ["stock", "catalog"] as const : []), ...(access.labour ? ["labour"] as const : []), ...(access.customers ? ["loyalty"] as const : [])];
  const [kind, setKind] = useState<MeasurementKind>(kinds[0] ?? "catalog"), [choices, setChoices] = useState<Choice[]>([]), [datasets, setDatasets] = useState<Dataset[]>([]);
  const [choiceIndex, setChoiceIndex] = useState(0), [csv, setCsv] = useState<string>(measurementTemplates[kind]), [source, setSource] = useState(""), [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState(""), [message, setMessage] = useState(""), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [revision, setRevision] = useState(0);
  const choice = choices[choiceIndex], global = kind === "catalog" || kind === "loyalty";
  const existing = useMemo(() => datasets.find(row => row.connectionId === choice?.connectionId && row.outletRef === choice?.outletRef && row.from === (global ? "" : from) && row.to === (global ? "" : to)), [datasets, choice, global, from, to]);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ kind }); if (locationId) params.set("location", locationId);
    void apiFetch("/api/v1/retail-measurements?" + params, { signal: controller.signal }).then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error?.message || "Evidence settings could not be loaded.");
      if (!controller.signal.aborted) { setChoices(data.choices); setDatasets(data.datasets); setError(""); setChoiceIndex(0); }
    }).catch(caught => { if (!controller.signal.aborted) { setError(caught.message); setChoices([]); setDatasets([]); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [kind, locationId, revision]);
  useEffect(() => {
    queueMicrotask(() => {
      const fields = measurementTemplates[kind].trim().split(",");
      setCsv(existing ? measurementTemplates[kind] + existing.entries.map(row => fields.map(field => csvCell(field === "reference" ? row.reference : row.values[field])).join(",")).join("\n") : measurementTemplates[kind]);
      setSource(existing?.source ?? ""); setReviewed(false);
    });
  }, [existing, kind]);
  const preview = useMemo(() => { try { return { rows: parseMeasurementCsv(kind, csv), error: "" }; } catch (e) { return { rows: [], error: e instanceof Error ? e.message : "Check the CSV." }; } }, [kind, csv]);
  const save = async (action: "save" | "delete") => {
    if (!choice || !reviewed || saving) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const response = await apiFetch("/api/v1/retail-measurements", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, kind, from, to, locationId, ...choice, source, csv, reviewed, expectedVersion: existing?.version ?? null }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error?.message || "Evidence could not be saved.");
      setMessage(action === "save" ? body.rows + " reviewed rows saved. Calculations are refreshing." : "Evidence removed. Dependent metrics will show missing inputs.");
      setReviewed(false); setLoading(true); setRevision(value => value + 1); onSaved();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Evidence could not be saved."); }
    finally { setSaving(false); }
  };
  return <section className="retail-inputs" aria-labelledby="retail-evidence-title"><div className="retail-view-heading"><div><h3 id="retail-evidence-title">Evidence settings</h3><p>Add reviewed records for inputs your connection does not supply. Provider records remain separate.</p></div><button type="button" onClick={onClose} disabled={saving}>Close</button></div>
    <form onSubmit={e => { e.preventDefault(); void save("save"); }}>
      <div className="retail-filters"><label>Evidence type<select disabled={saving} value={kind} onChange={e => { setKind(e.target.value as MeasurementKind); setLoading(true); setChoices([]); setMessage(""); }}>{kinds.map(value => <option key={value} value={value}>{{ stock: "Inventory period totals", labour: "Paid labour", loyalty: "Loyalty enrollment", catalog: "Product classification" }[value]}</option>)}</select></label><label>Approved source / location<select value={choiceIndex} disabled={loading || saving || !choices.length} onChange={e => { setChoiceIndex(Number(e.target.value)); setReviewed(false); }}>{choices.length ? choices.map((row, index) => <option key={row.connectionId + row.outletRef} value={index}>{row.label}</option>) : <option>No available source</option>}</select></label><label>Reporting scope<input readOnly value={global ? "Source-wide classification" : from + " to " + to}/></label></div>
      <p>{measurementDescriptions[kind]}</p>
      <label>Source record name<input maxLength={120} value={source} disabled={saving} onChange={e => { setSource(e.target.value); setReviewed(false); }} placeholder="For example: reviewed September timesheet"/></label>
      <label>CSV evidence<textarea spellCheck={false} value={csv} disabled={loading || saving} onChange={e => { setCsv(e.target.value); setReviewed(false); }}/></label>
      <div className="retail-inputs-actions"><label>Load a CSV<input type="file" accept=".csv,text/csv" disabled={saving} onChange={async e => {
        const file = e.target.files?.[0]; if (!file) return; if (file.size > 100000) { setError("Choose a CSV under 100 KB."); return; }
        setCsv(await file.text()); setReviewed(false); setError("");
      }}/></label><button type="button" disabled={saving} onClick={() => { setCsv(measurementTemplates[kind]); setReviewed(false); }}>Clear to template</button><button type="button" disabled={saving} onClick={() => { setLoading(true); setRevision(value => value + 1); }}>Reload saved evidence</button></div>
      <div className="retail-inputs-preview" aria-live="polite">{loading ? "Loading source and saved evidence…" : preview.error || preview.rows.length + " valid rows ready for review."}{existing && <p>Saved version {existing.version}. Saving replaces this entire dataset for the selected source and period.</p>}</div>
      <label className="retail-review-check"><input type="checkbox" checked={reviewed} disabled={saving || loading || !choices.length} onChange={e => setReviewed(e.target.checked)}/><span>I reviewed the source, period, units and {existing ? "replacement of the saved dataset" : "records"}. Unknown values remain blank.</span></label>
      <div className="retail-inputs-actions"><button type="submit" disabled={saving || loading || !reviewed || !source.trim() || !preview.rows.length}>{saving ? "Saving…" : "Save reviewed evidence"}</button>{existing && <button type="button" disabled={!reviewed || saving || loading} onClick={() => void save("delete")}>Delete this evidence dataset</button>}</div>
      {error && <p className="retail-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    </form>
  </section>;
}
