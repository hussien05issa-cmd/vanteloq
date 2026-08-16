"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "./supabase-browser";
import { providerDisplayName } from "../domain/display-labels";

type Risk = "healthy" | "monitor" | "at_risk" | "urgent" | "expired" | "untracked";
type Lot = {
  id: string;
  version: number;
  locationRef: string;
  sku: string;
  productName: string;
  supplierName: string | null;
  lotNumber: string;
  batchNumber: string;
  manufacturingDate: string | null;
  receivedDate: string;
  expirationDate: string | null;
  bestBeforeDate: string | null;
  shelfLifeDays: number | null;
  unitCostCents: number | null;
  unitRetailCents: number | null;
  quantityRemaining: number;
  storageNotes: string;
  status: string;
  assessment: {
    risk: Risk;
    trackedDate: string | null;
    trackedDateKind: "expiration" | "best_before" | null;
    daysRemaining: number | null;
    monthlyVelocity: number | null;
    projectedUnitsAtDate: number | null;
    inventoryCostAtRiskCents: number | null;
    confidence: string;
    recommendation: string;
    evidence: string[];
  };
};
type Payload = {
  posBalances: {
    locationRef: string;
    sku: string;
    name: string;
    onHandQuantity: number;
    reorderPoint: number;
    updatedAt: string;
  }[];
  lots: Lot[];
  fefo: (Lot & { fefoRank: number })[];
  summary: {
    totalLots: number;
    trackedLots: number;
    totalUnits: number;
    costAtRiskCents: number;
    costRiskKnownLots: number;
    riskCounts: Record<Risk, number>;
    posSkus: number;
    posUnits: number;
    lowStockSkus: number;
  };
  source: { calculation: string; generatedAt: string };
  locationScope: { id: string; name: string } | null;
};
type TaskSeed = {
  title: string;
  detail: string;
  priority: "high" | "medium" | "low";
  expectedImpact?: string;
  sourceType?: "manual" | "insight" | "alert" | "decision";
  sourceRef?: string;
};
type Props = {
  currency: string;
  showNotice: (message: string) => void;
  createTask: (seed: TaskSeed) => void;
  activeLocationId: string | null;
};
type LotForm = {
  productName: string;
  sku: string;
  locationRef: string;
  supplierName: string;
  lotNumber: string;
  batchNumber: string;
  manufacturingDate: string;
  receivedDate: string;
  expirationDate: string;
  bestBeforeDate: string;
  shelfLifeDays: string;
  unitCost: string;
  unitRetail: string;
  quantityRemaining: string;
  storageNotes: string;
  status: "active" | "quarantined";
};

const today = () => new Date().toISOString().slice(0, 10);
const emptyForm = (): LotForm => ({
  productName: "", sku: "", locationRef: "MAIN", supplierName: "", lotNumber: "", batchNumber: "",
  manufacturingDate: "", receivedDate: today(), expirationDate: "", bestBeforeDate: "", shelfLifeDays: "",
  unitCost: "", unitRetail: "", quantityRemaining: "0", storageNotes: "", status: "active",
});
function cents(value: string): number | null {
  if (!value.trim()) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : null;
}
function money(value: number | null | undefined, currency: string) {
  return value === null || value === undefined
    ? "Unavailable"
    : new Intl.NumberFormat("en-CA", { style: "currency", currency, maximumFractionDigits: 0 }).format(value / 100);
}
function message(body: unknown, fallback: string) {
  if (body && typeof body === "object" && "error" in body) {
    const value = (body as { error?: { message?: unknown } }).error?.message;
    if (typeof value === "string") return value;
  }
  return fallback;
}

export function InventoryLifecycleWorkspace({ currency, showNotice, createTask, activeLocationId }: Props) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Risk | "all">("all");
  const [editing, setEditing] = useState<Lot | null | "new">(null);
  const [form, setForm] = useState<LotForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const parameters = new URLSearchParams();
      if (activeLocationId) parameters.set("location", activeLocationId);
      const response = await apiFetch(`/api/v1/inventory-lifecycle${parameters.size ? `?${parameters.toString()}` : ""}`, { cache: "no-store" });
      const body = await response.json() as Payload | unknown;
      if (!response.ok) throw new Error(message(body, "Inventory lifecycle data could not be loaded."));
      setData(body as Payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Inventory lifecycle data could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [activeLocationId]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const visible = useMemo(() => data?.lots.filter(lot => filter === "all" || lot.assessment.risk === filter) ?? [], [data, filter]);
  const open = (lot?: Lot) => {
    if (!lot) {
      setEditing("new");
      setForm(emptyForm());
      return;
    }
    setEditing(lot);
    setForm({
      productName: lot.productName, sku: lot.sku, locationRef: lot.locationRef, supplierName: lot.supplierName ?? "",
      lotNumber: lot.lotNumber, batchNumber: lot.batchNumber, manufacturingDate: lot.manufacturingDate ?? "",
      receivedDate: lot.receivedDate, expirationDate: lot.expirationDate ?? "", bestBeforeDate: lot.bestBeforeDate ?? "",
      shelfLifeDays: lot.shelfLifeDays?.toString() ?? "", unitCost: lot.unitCostCents === null ? "" : (lot.unitCostCents / 100).toFixed(2),
      unitRetail: lot.unitRetailCents === null ? "" : (lot.unitRetailCents / 100).toFixed(2),
      quantityRemaining: lot.quantityRemaining.toString(), storageNotes: lot.storageNotes,
      status: lot.status === "quarantined" ? "quarantined" : "active",
    });
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const quantity = Number(form.quantityRemaining);
    if (!Number.isSafeInteger(quantity) || quantity < 0) { setError("Quantity remaining must be a whole number of zero or more."); return; }
    setSaving(true);
    setError("");
    try {
      const parameters = new URLSearchParams();
      if (activeLocationId) parameters.set("location", activeLocationId);
      const response = await apiFetch(`/api/v1/inventory-lifecycle${parameters.size ? `?${parameters.toString()}` : ""}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: editing === "new" ? "create" : "update",
          ...(editing && editing !== "new" ? { lotId: editing.id, version: editing.version } : {}),
          ...form,
          shelfLifeDays: form.shelfLifeDays ? Number(form.shelfLifeDays) : null,
          unitCostCents: cents(form.unitCost),
          unitRetailCents: cents(form.unitRetail),
          quantityRemaining: quantity,
        }),
      });
      const body = await response.json() as Payload | unknown;
      if (!response.ok) throw new Error(message(body, "The inventory lot could not be saved."));
      setData(body as Payload);
      setEditing(null);
      showNotice(editing === "new" ? "Inventory lot added." : "Inventory lot updated.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The inventory lot could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return <section className="lifecycle-workspace">
    <header className="lifecycle-heading">
      <div><p>INVENTORY LIFECYCLE</p><h2>Know what is aging, what to sell first, and what cash is exposed.</h2><span>Lot evidence, recorded sales velocity, and shelf-life dates. Missing inputs stay unavailable.</span></div>
      <button onClick={() => open()}>Add inventory lot</button>
    </header>
    {loading ? <div className="card lifecycle-state">Loading recorded inventory lots…</div> : error && !data ? <div className="card lifecycle-state"><b>Inventory lifecycle unavailable</b><span>{error}</span><button onClick={() => void load()}>Retry</button></div> : data ? <>
      {data.locationScope ? <div className="workspace-scope-banner"><b>{data.locationScope.name}</b><span>Inventory lots, POS balances, shelf-life risk and sale velocity are limited to this mapped location.</span></div> : null}
      <div className="lifecycle-summary">
        <article><small>POS SKUS</small><b>{data.summary.posSkus}</b></article>
        <article><small>POS UNITS ON HAND</small><b>{data.summary.posUnits}</b></article>
        <article><small>AT OR BELOW REORDER</small><b>{data.summary.lowStockSkus}</b></article>
        <article><small>LOT RECORDS</small><b>{data.summary.totalLots}</b></article>
      </div>
      {data.posBalances.length > 0 ? <article className="card pos-stock-ledger">
        <header><div><p>CONNECTED POS INVENTORY</p><h3>Current normalized stock balances</h3><span>Read-only quantities imported by location. Reorder points are copied from the connected source when present.</span></div><strong>{data.summary.posSkus} SKUs</strong></header>
        <div className="pos-stock-head"><span>Product</span><span>Location</span><span>On hand</span><span>Reorder point</span></div>
        {data.posBalances.slice(0, 100).map(balance => <div className="pos-stock-row" key={`${balance.locationRef}:${balance.sku}`}>
          <span><b>{balance.name}</b><small>{balance.sku}</small></span>
          <span>{balance.locationRef.replace(/^([^:]+):/, (_, provider: string) => `${providerDisplayName(provider)} location `)}</span>
          <strong>{balance.onHandQuantity}</strong>
          <em className={balance.onHandQuantity <= balance.reorderPoint ? "low" : "ok"}>{balance.reorderPoint}</em>
        </div>)}
      </article> : null}
      <div className="lifecycle-grid">
        <article className="card lot-ledger">
          <header><div><h3>Lot risk ledger</h3><span>{data.source.calculation}</span></div><select value={filter} onChange={event => setFilter(event.target.value as Risk | "all")}><option value="all">All risk states</option><option value="urgent">Urgent</option><option value="expired">Expired</option><option value="at_risk">At risk</option><option value="monitor">Monitor</option><option value="healthy">Healthy</option><option value="untracked">Date untracked</option></select></header>
          <div className="lot-table-head"><span>Product / lot</span><span>Quantity</span><span>Shelf-life</span><span>Forecast</span><span>Risk</span></div>
          {visible.length === 0 ? <div className="lifecycle-state"><b>No inventory lots in this view</b><span>Add a lot or change the risk filter. No sample inventory is shown.</span></div> : visible.map(lot => <button className="lot-row" key={lot.id} onClick={() => open(lot)}>
            <span><b>{lot.productName}</b><small>{lot.sku} · {lot.locationRef} · {lot.lotNumber || lot.batchNumber || "No lot identifier"}</small></span>
            <span><b>{lot.quantityRemaining}</b><small>{lot.status}</small></span>
            <span><b>{lot.assessment.daysRemaining === null ? "Unavailable" : `${lot.assessment.daysRemaining} days`}</b><small>{lot.assessment.trackedDate ?? "No date recorded"}</small></span>
            <span><b>{lot.assessment.projectedUnitsAtDate === null ? "Unavailable" : `${lot.assessment.projectedUnitsAtDate} units`}</b><small>{lot.assessment.monthlyVelocity === null ? "Insufficient sales history" : `${lot.assessment.monthlyVelocity}/month`}</small></span>
            <span><em className={`lot-risk ${lot.assessment.risk}`}>{lot.assessment.risk.replace("_", " ")}</em><small>{money(lot.assessment.inventoryCostAtRiskCents, currency)} cost risk</small></span>
          </button>)}
        </article>
        <aside className="card fefo-panel"><p>FEFO PICK GUIDANCE</p><h3>Earliest shelf-life date first</h3><span>This is operational guidance, not an automatic stock adjustment.</span>{data.fefo.length === 0 ? <div className="lifecycle-state"><span>No active lot is available to rank.</span></div> : data.fefo.slice(0, 6).map(lot => <div key={lot.id}><i>{lot.fefoRank}</i><span><b>{lot.productName}</b><small>{lot.sku} · {lot.locationRef}</small></span><strong>{lot.assessment.trackedDate ?? "No date"}</strong></div>)}</aside>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
    </> : null}
    {editing ? <div className="modal-backdrop"><form className="lot-modal" onSubmit={submit}>
      <header><div><p>TRACEABLE LOT RECORD</p><h2>{editing === "new" ? "Add inventory lot" : `Edit ${editing.productName}`}</h2></div><button type="button" onClick={() => setEditing(null)}>×</button></header>
      <div className="lot-form-grid">
        {([['productName','Product name'],['sku','SKU'],['locationRef','Location'],['supplierName','Supplier'],['lotNumber','Lot number'],['batchNumber','Batch number'],['manufacturingDate','Manufacturing date'],['receivedDate','Received date'],['expirationDate','Expiration date'],['bestBeforeDate','Best-before date'],['shelfLifeDays','Shelf life (days)'],['unitCost',`Unit cost (${currency})`],['unitRetail',`Retail price (${currency})`],['quantityRemaining','Quantity remaining']] as const).map(([key,label]) => <label key={key}><span>{label}</span><input required={['productName','sku','locationRef','receivedDate','quantityRemaining'].includes(key)} type={key.includes('Date') ? 'date' : ['shelfLifeDays','quantityRemaining'].includes(key) ? 'number' : ['unitCost','unitRetail'].includes(key) ? 'number' : 'text'} min={['shelfLifeDays','quantityRemaining','unitCost','unitRetail'].includes(key) ? '0' : undefined} step={['unitCost','unitRetail'].includes(key) ? '0.01' : undefined} value={form[key]} onChange={event => setForm(current => ({ ...current, [key]: event.target.value }))}/></label>)}
        <label><span>Status</span><select value={form.status} onChange={event => setForm(current => ({ ...current, status: event.target.value as LotForm['status'] }))}><option value="active">Active</option><option value="quarantined">Quarantined</option></select></label>
        <label className="full"><span>Storage notes</span><textarea maxLength={1000} value={form.storageNotes} onChange={event => setForm(current => ({ ...current, storageNotes: event.target.value }))}/></label>
      </div>
      {editing !== "new" ? <section className="lot-decision"><b>{editing.assessment.recommendation}</b>{editing.assessment.evidence.map(item => <span key={item}>{item}</span>)}<button type="button" onClick={() => createTask({ title: `${editing.productName}: ${editing.assessment.risk.replace('_',' ')} inventory`, detail: `${editing.assessment.recommendation} ${editing.assessment.evidence.join(' ')}`, priority: ['urgent','expired'].includes(editing.assessment.risk) ? 'high' : 'medium', expectedImpact: money(editing.assessment.inventoryCostAtRiskCents, currency), sourceType: 'insight', sourceRef: editing.id })}>Create review task</button></section> : null}
      <footer><button type="button" onClick={() => setEditing(null)}>Cancel</button><button className="primary" disabled={saving}>{saving ? "Saving…" : "Save lot"}</button></footer>
    </form></div> : null}
  </section>;
}
