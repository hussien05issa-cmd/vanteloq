"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { apiFetch } from "./supabase-browser";
import { FOOD_PERIOD_AMOUNTS, foodAmountText, foodAmountToMinor, foodserviceRecordReport, validateFoodserviceContent, type FoodRecordContent, type FoodSavedRecord, type FoodResult, type FoodUnit } from "../domain/foodservice";
import "./foodservice-workspace.css";

type Report = ReturnType<typeof foodserviceRecordReport>;
type Saved = FoodSavedRecord & { report: Report };
type Data = { locationId: string | null; locations: { id: string; name: string; currency: string; timezone: string }[]; records: Saved[]; truncated: boolean; permissions: { recipeWrite: boolean; periodRead: boolean; periodWrite: boolean } };
type IngredientDraft = { id: string; purchaseAmount: string; purchaseUnit: FoodUnit; cost: string; recipeAmount: string; recipeUnit: FoodUnit; yield: string };
type Draft = { kind: "recipe" | "period"; name: string; source: string; asOfDate: string; from: string; to: string; portions: string; ingredients: IngredientDraft[]; amounts: Record<string, string>; checks: string };
const labels: Record<typeof FOOD_PERIOD_AMOUNTS[number], string> = { opening: "Opening inventory at cost", purchases: "Purchases received at cost", supplierCredits: "Supplier returns / credits", transfersIn: "Transfers in at cost", transfersOut: "Transfers out at cost", closing: "Closing inventory at cost", foodNetSales: "Net food sales, excluding tax", totalNetSales: "Total net sales, excluding tax", theoreticalCost: "Recipe-based theoretical food cost", recordedWasteCost: "Recorded waste at cost", labourCost: "Reviewed labour cost", otherVariableCosts: "Other selected variable food costs" };
const emptyIngredient = (): IngredientDraft => ({ id: "", purchaseAmount: "", purchaseUnit: "g", cost: "", recipeAmount: "", recipeUnit: "g", yield: "" });
const empty = (kind: Draft["kind"]): Draft => ({ kind, name: "", source: "", asOfDate: "", from: "", to: "", portions: "", ingredients: [emptyIngredient()], amounts: {}, checks: "" });
const units: FoodUnit[] = ["g", "kg", "oz_mass", "lb", "ml", "l", "each"];
const unitLabel = (unit: FoodUnit) => unit === "oz_mass" ? "oz (mass)" : unit;
const shownMoney = (minor: number, currency: string) => `${currency} ${foodAmountText(minor, currency)}`;
const reason = (r: FoodResult<unknown>) => r.status === "unavailable" ? r.reason === "missing_input" ? `Not available. Missing: ${r.fields.join(", ")}.` : r.reason === "negative_consumption" ? "Needs review: inventory movements produce negative consumption." : r.reason === "inconsistent_waste" ? "Needs review: waste exceeds available inventory." : "Not available with a zero or nonpositive denominator." : "";
function resultMoney(r: FoodResult<{ currency: string; minor: number }>) { return r.status === "available" ? shownMoney(r.value.minor, r.value.currency) : "Unavailable"; }
function resultPercent(r: FoodResult<number>) { return r.status === "available" ? `${(r.value / 100).toFixed(2)}%` : "Unavailable"; }
async function response(response: Response) { const body = await response.json(); if (!response.ok) throw Error(body.error?.message || "Foodservice records could not be loaded."); return body; }
function ReportView({ report, currency, compact = false }: { report: Report; currency: string; compact?: boolean }) {
  if (report.kind === "recipe") return report.recipe.status === "available" ? <><dl className="foodservice-metrics"><div><dt>Recipe cost</dt><dd>{shownMoney(report.recipe.value.totalMinor, currency)}</dd></div><div><dt>Cost per portion</dt><dd>{shownMoney(report.recipe.value.perPortionMinor, currency)}</dd></div></dl><p className="foodservice-note">Rounded for display. The calculation retains fractional minor units.</p></> : <p className="foodservice-note">{reason(report.recipe)}</p>;
  const m = report.metrics;
  const metrics = [
    ["Actual food cost", report.inventory.status === "available" ? shownMoney(report.inventory.value.actualMinor, currency) : "Unavailable", reason(report.inventory)],
    ["Food cost / food sales", resultPercent(m.actualFoodCostBasisPoints), reason(m.actualFoodCostBasisPoints)],
    ["Labour / total sales", resultPercent(m.labourCostBasisPoints), reason(m.labourCostBasisPoints)],
    ["Waste / available inventory cost", resultPercent(m.recordedWasteRateBasisPoints), reason(m.recordedWasteRateBasisPoints)],
    ["Food contribution", resultMoney(m.foodContribution), reason(m.foodContribution)],
    ["After selected variable costs", resultMoney(m.contributionAfterVariableCosts), reason(m.contributionAfterVariableCosts)],
    ["Actual less theoretical cost", resultMoney(m.costVariance), reason(m.costVariance)],
    ["Average closed check", resultMoney(m.averageCheck), reason(m.averageCheck)],
  ];
  return <><dl className="foodservice-metrics">{(compact ? metrics.slice(0, 5) : metrics).map(([label, value, detail]) => <div key={label}><dt>{label}</dt><dd>{value}</dd>{detail && <small>{detail}</small>}</div>)}</dl><p className="foodservice-note">Food contribution is net food sales less recorded food depletion, before labour, other operating costs and profit. Waste is already inside depletion. Variance does not establish its cause.</p></>;
}
type WorkspaceProps = { activeLocationId?: string | null; compactOverview?: boolean; onOpen?: () => void };
export default function FoodserviceWorkspace(props: WorkspaceProps) { return <FoodservicePanel key={props.activeLocationId ?? "all"} {...props}/>; }
function FoodservicePanel({ activeLocationId = null, compactOverview = false, onOpen }: WorkspaceProps) {
  const [data, setData] = useState<Data | null>(null), [locationId, setLocationId] = useState(activeLocationId ?? "");
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null), [editing, setEditing] = useState<Saved | null>(null), [preview, setPreview] = useState<Report | null>(null), [reviewed, setReviewed] = useState(false);
  const read = useRef<AbortController | null>(null), write = useRef<AbortController | null>(null), heading = useRef<HTMLHeadingElement>(null);
  const selected = data?.locations.find(row => row.id === (activeLocationId || locationId || data.locationId));
  const load = useCallback(() => {
    read.current?.abort(); const controller = new AbortController(); read.current = controller;
    const query = new URLSearchParams(); if (activeLocationId || locationId) query.set("locationId", activeLocationId || locationId);
    return apiFetch(`/api/v1/foodservice?${query}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) }).then(response)
      .then((body: Data) => { if (!controller.signal.aborted) setData(body); })
      .catch((caught: unknown) => { if (!controller.signal.aborted) { setData(null); setError(caught instanceof Error ? caught.message : "Records could not be loaded."); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
  }, [activeLocationId, locationId]);
  useEffect(() => { void load(); return () => { read.current?.abort(); write.current?.abort(); }; }, [load]);
  const draftKind = draft?.kind;
  useEffect(() => { if (draftKind) heading.current?.focus(); }, [draftKind, editing?.id]);
  function reload() { setLoading(true); setError(""); void load(); }
  function change(next: Draft) { setDraft(next); setPreview(null); setReviewed(false); setMessage(""); }
  function edit(row?: Saved, kind: Draft["kind"] = "recipe") {
    setError(""); setMessage(""); setEditing(row ?? null); setPreview(null); setReviewed(false);
    if (!row) { setDraft(empty(kind)); return; }
    const next = { ...empty(row.kind), name: row.name, source: row.source, asOfDate: row.asOfDate, from: row.from, to: row.to };
    if (row.kind === "recipe") { next.portions = row.payload.portions ?? ""; next.ingredients = (row.payload.ingredients ?? []).map(i => ({ id: i.id, purchaseAmount: i.purchaseQuantity?.amount ?? "", purchaseUnit: i.purchaseQuantity?.unit ?? "g", cost: foodAmountText(i.purchaseCost?.minor ?? null, row.payload.currency), recipeAmount: i.recipeQuantity?.amount ?? "", recipeUnit: i.recipeQuantity?.unit ?? "g", yield: i.preparationYield ?? "" })); }
    else { next.checks = row.payload.closedChecks === null ? "" : String(row.payload.closedChecks); for (const key of FOOD_PERIOD_AMOUNTS) next.amounts[key] = foodAmountText(row.payload[key]?.minor ?? null, row.payload.currency); }
    setDraft(next);
  }
  function content(): FoodRecordContent {
    if (!draft || !selected) throw Error("Select a location first.");
    const currency = selected.currency, amount = (value: string) => { const minor = foodAmountToMinor(value, currency); return minor === null ? null : { minor, currency }; };
    const payload = draft.kind === "recipe" ? { currency, portions: draft.portions || null, ingredients: draft.ingredients.map(i => ({ id: i.id, purchaseQuantity: { amount: i.purchaseAmount || null, unit: i.purchaseUnit }, purchaseCost: amount(i.cost), recipeQuantity: { amount: i.recipeAmount || null, unit: i.recipeUnit }, preparationYield: i.yield || null })) } : { currency, ...Object.fromEntries(FOOD_PERIOD_AMOUNTS.map(key => [key, amount(draft.amounts[key] ?? "")])), closedChecks: draft.checks === "" ? null : /^\d+$/.test(draft.checks) ? Number(draft.checks) : NaN };
    return validateFoodserviceContent({ kind: draft.kind, name: draft.name, source: draft.source, asOfDate: draft.asOfDate, from: draft.from, to: draft.to, payload });
  }
  function calculate() { setError(""); try { setPreview(foodserviceRecordReport(content())); } catch (caught) { setError(caught instanceof Error ? caught.message : "Review the inputs."); } }
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy || !preview || !reviewed || !selected) return;
    const controller = new AbortController(); write.current = controller; setBusy(true); setError("");
    try {
      await response(await apiFetch("/api/v1/foodservice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save", locationId: selected.id, id: editing?.id ?? null, expectedVersion: editing?.version ?? null, reviewed, record: content() }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) }));
      if (!controller.signal.aborted) { setDraft(null); setEditing(null); setPreview(null); setReviewed(false); setMessage("Reviewed record saved. No ledger or stock balance was changed."); await load(); }
    } catch (caught) { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "The save could not be confirmed. Reload records before retrying."); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  const latest = data?.records.find(row => row.kind === "period");
  return <section className="foodservice-workspace" aria-label="Foodservice costs">
    <header><div><p className="foodservice-eyebrow">Menu & ingredients</p><h2>{compactOverview ? "Foodservice overview" : "Recipe and food-cost review"}</h2><p>Use reviewed source records. These calculations do not post to BookLoQ or change stock balances.</p></div>{compactOverview && onOpen && <button type="button" onClick={onOpen}>Open food-cost workspace</button>}</header>
    {loading && <p role="status">Loading saved foodservice records…</p>}
    {error && <p role="alert" className="foodservice-error">{error}</p>}
    {message && <p role="status">{message}</p>}
    {!loading && !data && <button type="button" onClick={reload}>Reload records</button>}
    {data && <>
      {!activeLocationId && <label className="foodservice-location">Location<select aria-label="Foodservice location" value={locationId || data.locationId || ""} disabled={busy} onChange={e => { setLocationId(e.target.value); setLoading(true); setError(""); setData(null); setDraft(null); setEditing(null); setPreview(null); setReviewed(false); setMessage(""); }}><option value="" disabled>Choose one location</option>{data.locations.map(l => <option key={l.id} value={l.id}>{l.name} ({l.currency})</option>)}</select></label>}
      {selected && <p className="foodservice-note">{selected.name} · {selected.currency} · {selected.timezone}. Records from other locations are kept separate.</p>}
      {compactOverview ? latest ? <article><h3>{latest.name}</h3><p>{latest.from} to {latest.to} · Source: {latest.source} · As of {latest.asOfDate}</p><ReportView report={latest.report} currency={latest.payload.currency} compact/></article> : <p>{data.permissions.periodRead ? "No reviewed period is saved for this location yet." : "Revenue, profit and payroll totals access is needed for period reports."}</p> : <>
        <div className="foodservice-actions"><button type="button" disabled={!selected || !data.permissions.recipeWrite || busy} onClick={() => edit()}>New recipe</button><button type="button" disabled={!selected || !data.permissions.periodWrite || busy} onClick={() => edit(undefined, "period")}>New period review</button><button type="button" disabled={busy} onClick={reload}>Reload saved records</button></div>
        {!data.permissions.periodRead && <p className="foodservice-note">Period reports require revenue, profit and payroll totals access. Recipe access is separate.</p>}
        {draft && <form onSubmit={save}><fieldset disabled={busy}><h3 ref={heading} tabIndex={-1}>{editing ? "Edit" : "New"} {draft.kind === "recipe" ? "recipe" : "period review"}</h3><p>Blank amounts remain unknown. Enter 0 only when the source confirms zero. Amounts use {selected?.currency}.</p><div className="foodservice-fields">
          {([['name', 'Name'], ['source', 'Source reference'], ['asOfDate', 'Source as-of date']] as const).map(([key,label]) => <label key={key}>{label}<input required maxLength={120} type={key === "asOfDate" ? "date" : "text"} value={draft[key]} onChange={e => change({ ...draft, [key]: e.target.value })}/></label>)}
          {draft.kind === "recipe" ? <label>Yielded portions<input inputMode="decimal" value={draft.portions} onChange={e => change({ ...draft, portions: e.target.value })}/></label> : <>{([['from','Period start'],['to','Period end']] as const).map(([key,label]) => <label key={key}>{label}<input required type="date" value={draft[key]} onChange={e => change({ ...draft, [key]: e.target.value })}/></label>)}</>}
        </div>
        {draft.kind === "recipe" ? <><p className="foodservice-note">Preparation yield is prepared quantity ÷ purchased quantity. Use 0.8 for 80%, or 1 for no loss. A documented hydration gain may exceed 1. Mass and volume cannot be interchanged.</p>{draft.ingredients.map((i,index) => <div className="foodservice-ingredient" key={index}><h4>Ingredient {index + 1}</h4><div className="foodservice-fields">
          {([['id','Ingredient name'],['purchaseAmount','Purchased pack quantity'],['cost','Pack cost'],['recipeAmount','Prepared quantity in recipe'],['yield','Preparation yield factor']] as const).map(([key,label]) => <label key={key}>{label}<input aria-label={`${label}, ingredient ${index + 1}`} maxLength={120} inputMode={key === "id" ? "text" : "decimal"} value={i[key]} onChange={e => change({ ...draft, ingredients: draft.ingredients.map((row,n) => n === index ? { ...row, [key]: e.target.value } : row) })}/></label>)}
          {([['purchaseUnit','Purchase unit'],['recipeUnit','Recipe unit']] as const).map(([key,label]) => <label key={key}>{label}<select aria-label={`${label}, ingredient ${index + 1}`} value={i[key]} onChange={e => change({ ...draft, ingredients: draft.ingredients.map((row,n) => n === index ? { ...row, [key]: e.target.value as FoodUnit } : row) })}>{units.map(u => <option key={u} value={u}>{unitLabel(u)}</option>)}</select></label>)}
        </div><button type="button" disabled={draft.ingredients.length === 1} onClick={() => change({ ...draft, ingredients: draft.ingredients.filter((_,n) => n !== index) })}>Remove ingredient {index + 1}</button></div>)}<button type="button" disabled={draft.ingredients.length >= 100} onClick={() => change({ ...draft, ingredients: [...draft.ingredients, emptyIngredient()] })}>Add ingredient</button></> : <><div className="foodservice-fields">{FOOD_PERIOD_AMOUNTS.map(key => <label key={key}>{labels[key]}<input inputMode="decimal" value={draft.amounts[key] ?? ""} onChange={e => change({ ...draft, amounts: { ...draft.amounts, [key]: e.target.value } })}/></label>)}<label>Closed checks in the same sales scope<input inputMode="numeric" value={draft.checks} onChange={e => change({ ...draft, checks: e.target.value })}/></label></div><p className="foodservice-note">Inventory values must share one valuation method and physical count interval. Theoretical cost needs recipe versions and item/portion counts. Labour needs a consistent wage and employer-cost policy. Do not add recorded waste to purchases. Other variable costs must not already be included in food depletion.</p></>}
        <div className="foodservice-actions"><button type="button" onClick={calculate}>Calculate preview</button><button type="button" onClick={() => { setDraft(null); setPreview(null); }}>Cancel edit</button></div>
        {preview && <div className="foodservice-preview"><h4>Unsaved calculation preview</h4><ReportView report={preview} currency={selected?.currency ?? "CAD"}/><label className="foodservice-review"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)}/>I reviewed the source, dates, quantities, currency and missing inputs.</label><button type="submit" disabled={!reviewed}>{busy ? "Saving…" : "Save reviewed record"}</button></div>}
        </fieldset></form>}
        {!data.records.length && <p>No reviewed records are saved for this location. Start with a recipe or a period review.</p>}
        {data.truncated && <p>Showing the 200 most recently updated records for this location. Older records remain saved.</p>}
        <div className="foodservice-records">{data.records.map(row => <article key={row.id}><header><div><p className="foodservice-eyebrow">{row.kind === "recipe" ? "Recipe" : "Period review"} · Version {row.version}</p><h3>{row.name}</h3><p>{row.kind === "period" && `${row.from} to ${row.to} · `}Source: {row.source} · As of {row.asOfDate}</p></div><button type="button" disabled={busy || !data.permissions[row.kind === "recipe" ? "recipeWrite" : "periodWrite"]} onClick={() => edit(row)}>Edit {row.name}</button></header><ReportView report={row.report} currency={row.payload.currency}/></article>)}</div>
      </>}
    </>}
  </section>;
}
