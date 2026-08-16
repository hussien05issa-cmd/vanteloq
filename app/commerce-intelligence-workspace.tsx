"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "./supabase-browser";
import { providerDisplayName } from "../domain/display-labels";

type Mode = "Sales" | "Inventory" | "Customers" | "Suppliers";
type TaskSeed = { title: string; detail: string; priority: "high" | "medium" | "low"; sourceType?: "alert"; sourceRef?: string };

type Snapshot = {
  period: { from: string; to: string; days: number; comparisonFrom: string; comparisonTo: string };
  kpis: {
    netSalesCents: number; grossProfitCents: number | null; grossMarginRate: number | null;
    discountsCents: number; discountRate: number | null; transactions: number; units: number;
    averageTransactionCents: number | null; unitsPerTransaction: number | null; knownCustomerTransactions: number;
    changes: { netSalesRate: number | null; grossProfitRate: number | null; transactionsRate: number | null; averageTransactionRate: number | null };
  };
  saleLines: Array<{
    provider: string; externalSaleId: string; externalLineId: string; soldAt: string | null; sku: string | null;
    productName: string; quantityMilli: number; netSalesCents: number; costCents: number | null; discountCents: number;
    grossProfitCents: number | null; marginRate: number | null; customerName: string | null; customerEmail: string | null;
  }>;
  inventory: Array<{
    provider: string; connectionId: string; externalProductId: string | null; locationRef: string; sku: string; name: string; categoryRef: string | null; supplierRef: string | null;
    onHandQuantity: number; reorderPoint: number; unitsSold: number; dailyVelocity: number; daysOfCover: number | null;
    stockStatus: "healthy" | "watch" | "low" | "stockout"; recommendedOrderUnits: number; periodNetSalesCents: number;
    periodDiscountCents: number; defaultCostCents: number | null; ownerCostCents: number | null; effectiveCostCents: number | null;
    costSource: "manual" | "csv" | "provider" | null; costUpdatedAt: number | string | null; updatedAt: number | string;
  }>;
  customers: Array<{
    provider: string; externalCustomerId: string | null; displayName: string; email: string | null; phone: string | null;
    transactionCount: number; netSalesCents: number; grossProfitCents: number | null; discountCents: number;
    averageTransactionCents: number | null; lastPurchaseAt: string | null;
  }>;
  suppliers: Array<{
    provider: string; externalSupplierId: string; name: string; accountNumber: string | null; contactName: string | null;
    email: string | null; phone: string | null; productCount: number; periodQuantityMilli: number;
    periodNetSalesCents: number; periodGrossProfitCents: number | null; periodMarginRate: number | null; lowStockItems: number;
  }>;
  products: Array<{
    productRef: string; name: string; quantityMilli: number; netSalesCents: number; discountCents: number;
    transactionCount: number; grossProfitCents: number | null; marginRate: number | null; discountRate: number | null;
  }>;
  alerts: Array<{ type: string; severity: "urgent" | "warning" | "review"; title: string; detail: string; action: string }>;
  permissions: { customerIdentity: boolean; productCosts: boolean; profit: boolean; suppliers: boolean; inventory: boolean; manageCosts: boolean; importCosts: boolean };
};

type CostImportRow = { row: number; sku: string; provider: string | null; unitCostCents: number };

const today = () => new Date().toISOString().slice(0, 10);
const dateBefore = (days: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
};
const money = (value: number | null, currency: string) => value == null
  ? "Not available"
  : new Intl.NumberFormat("en-CA", { style: "currency", currency, maximumFractionDigits: 0 }).format(value / 100);
const preciseMoney = (value: number | null, currency: string) => value == null
  ? "Not available"
  : new Intl.NumberFormat("en-CA", { style: "currency", currency, minimumFractionDigits: 2 }).format(value / 100);
const percent = (value: number | null, digits = 1) => value == null ? "Not available" : `${(value * 100).toFixed(digits)}%`;
const changeCopy = (value: number | null) => value == null ? "No matched baseline" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}% vs prior period`;
const dateTime = (value: string | null) => value ? new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "Not supplied";
const csvCell = (value: unknown) => {
  const raw = String(value ?? "");
  // Prevent spreadsheet applications from executing a provider-supplied value as a formula.
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
};

function downloadInventoryCsv(rows: Snapshot["inventory"], from: string, to: string) {
  const header = ["SKU", "Item", "Provider", "Location", "Unit cost", "Cost source", "On hand", "Reorder point", "Units sold", "Daily velocity", "Days of cover", "Stock status", "Recommended order", "Period sales"];
  const body = rows.map((row) => [row.sku, row.name, row.provider, row.locationRef, row.effectiveCostCents == null ? "" : (row.effectiveCostCents / 100).toFixed(2), row.costSource ?? "", row.onHandQuantity, row.reorderPoint, row.unitsSold.toFixed(2), row.dailyVelocity.toFixed(2), row.daysOfCover?.toFixed(1) ?? "", row.stockStatus, row.recommendedOrderUnits, (row.periodNetSalesCents / 100).toFixed(2)]);
  const blob = new Blob([[header, ...body].map((row) => row.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `vanteloq-inventory-${from}-to-${to}.csv`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

function downloadCostTemplate() {
  const blob = new Blob(["SKU,Unit Cost,Provider\nABC-001,12.50,\n"], { type: "text/csv;charset=utf-8" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = "vanteloq-inventory-cost-template.csv";
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell); cell = "";
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
    } else cell += character;
  }
  if (quoted) throw new Error("The CSV contains an unfinished quoted value.");
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function inventoryCostRows(text: string): CostImportRow[] {
  const rows = parseCsv(text.replace(/^\uFEFF/, ""));
  if (rows.length < 2) throw new Error("Add at least one inventory item beneath the CSV header.");
  const headings = rows[0].map((value) => value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " "));
  const skuIndex = headings.indexOf("sku");
  const costIndex = headings.findIndex((value) => value === "unit cost" || value === "cost");
  const providerIndex = headings.indexOf("provider");
  if (skuIndex < 0 || costIndex < 0) throw new Error("The CSV must include SKU and Unit Cost columns.");
  if (rows.length - 1 > 500) throw new Error("Upload no more than 500 items at a time.");
  return rows.slice(1).map((values, index) => {
    const rowNumber = index + 2;
    const sku = (values[skuIndex] ?? "").trim();
    const rawCost = (values[costIndex] ?? "").trim().replace(/^\$/, "").replaceAll(",", "");
    const provider = providerIndex >= 0 ? (values[providerIndex] ?? "").trim().toLowerCase() || null : null;
    if (!sku) throw new Error(`Row ${rowNumber} needs a SKU.`);
    if (!/^\d+(?:\.\d{1,2})?$/.test(rawCost)) throw new Error(`Row ${rowNumber} needs a non-negative cost with no more than two decimal places.`);
    const unitCostCents = Math.round(Number(rawCost) * 100);
    if (!Number.isSafeInteger(unitCostCents) || unitCostCents > 100_000_000) throw new Error(`Row ${rowNumber} has a cost outside the supported range.`);
    return { row: rowNumber, sku, provider, unitCostCents };
  });
}

function Stat({ label, value, note, tone = "blue" }: { label: string; value: string; note: string; tone?: string }) {
  return <article className={`commerce-stat commerce-stat-${tone}`}><small>{label}</small><strong>{value}</strong><span>{note}</span></article>;
}

function DataEmpty({ mode, navigate }: { mode: Mode; navigate: (view: "Integrations") => void }) {
  return <section className="commerce-intelligence-empty">
    <div>
      <p>CONNECTED COMMERCE INTELLIGENCE</p>
      <h3>No verified {mode.toLowerCase()} records are available yet.</h3>
      <span>Vanteloq will populate this workspace only from an authorized POS sync. It does not invent missing catalog, customer, supplier or transaction data.</span>
      <button onClick={() => navigate("Integrations")}>Review data connection →</button>
    </div>
    <Image src="/media/vanteloq-commerce-intelligence.png" alt="Illustration of connected sales, inventory, customer and supplier intelligence" width={1536} height={864} sizes="(max-width: 780px) 100vw, 46vw" />
  </section>;
}

export default function CommerceIntelligenceWorkspace({ mode, currency, activeLocationId, navigate, createTask }: {
  mode: Mode; currency: string; activeLocationId: string | null; navigate: (view: "Integrations") => void; createTask: (seed: TaskSeed) => void;
}) {
  const [from, setFrom] = useState(dateBefore(29));
  const [to, setTo] = useState(today());
  const [applied, setApplied] = useState({ from: dateBefore(29), to: today() });
  const [data, setData] = useState<Snapshot | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [costPreview, setCostPreview] = useState<CostImportRow[]>([]);
  const [costFileName, setCostFileName] = useState("");
  const [costError, setCostError] = useState("");
  const [costSaving, setCostSaving] = useState(false);
  const [editingCostKey, setEditingCostKey] = useState("");
  const [costDraft, setCostDraft] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ from: applied.from, to: applied.to });
      if (activeLocationId) params.set("location", activeLocationId);
      const response = await apiFetch(`/api/v1/commerce-intelligence?${params}`, { headers: { Accept: "application/json" } });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Commerce intelligence could not be loaded.");
      setData(body);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Commerce intelligence could not be loaded.");
    } finally { setLoading(false); }
  }, [activeLocationId, applied]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const saveCosts = useCallback(async (source: "manual" | "csv", entries: Array<Record<string, unknown>>) => {
    setCostSaving(true);
    setCostError("");
    try {
      const response = await apiFetch("/api/v1/inventory-costs", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ source, entries }),
      });
      const body = await response.json();
      if (!response.ok) {
        const details = Array.isArray(body.errors) ? body.errors.slice(0, 3).map((item: { message?: string }) => item.message).filter(Boolean).join(" ") : "";
        throw new Error(details || body.error?.message || "Inventory costs could not be saved.");
      }
      setCostPreview([]);
      setCostFileName("");
      setEditingCostKey("");
      setCostDraft("");
      await load();
    } catch (caught) {
      setCostError(caught instanceof Error ? caught.message : "Inventory costs could not be saved.");
    } finally { setCostSaving(false); }
  }, [load]);

  const readCostFile = useCallback(async (file: File | undefined) => {
    setCostPreview([]);
    setCostFileName("");
    setCostError("");
    if (!file) return;
    if (file.size > 1_000_000) { setCostError("Choose a CSV smaller than 1 MB."); return; }
    try {
      const rows = inventoryCostRows(await file.text());
      setCostPreview(rows);
      setCostFileName(file.name);
    } catch (caught) { setCostError(caught instanceof Error ? caught.message : "The CSV could not be read."); }
  }, []);

  const saveManualCost = useCallback((row: Snapshot["inventory"][number]) => {
    const raw = costDraft.trim().replace(/^\$/, "").replaceAll(",", "");
    if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) { setCostError("Enter a non-negative unit cost with no more than two decimal places."); return; }
    const unitCostCents = Math.round(Number(raw) * 100);
    if (!Number.isSafeInteger(unitCostCents) || unitCostCents > 100_000_000) { setCostError("Enter a unit cost from 0.00 to 1,000,000.00."); return; }
    void saveCosts("manual", [{ provider: row.provider, connectionId: row.connectionId, externalProductId: row.externalProductId, sku: row.sku, unitCostCents }]);
  }, [costDraft, saveCosts]);

  const normalizedQuery = query.trim().toLowerCase();
  const lines = useMemo(() => (data?.saleLines ?? []).filter((row) => !normalizedQuery || `${row.productName} ${row.sku} ${row.customerName} ${row.externalSaleId}`.toLowerCase().includes(normalizedQuery)), [data, normalizedQuery]);
  const inventory = useMemo(() => (data?.inventory ?? []).filter((row) => !normalizedQuery || `${row.name} ${row.sku} ${row.locationRef} ${row.stockStatus}`.toLowerCase().includes(normalizedQuery)), [data, normalizedQuery]);
  const customers = useMemo(() => (data?.customers ?? []).filter((row) => !normalizedQuery || `${row.displayName} ${row.email} ${row.phone}`.toLowerCase().includes(normalizedQuery)), [data, normalizedQuery]);
  const suppliers = useMemo(() => (data?.suppliers ?? []).filter((row) => !normalizedQuery || `${row.name} ${row.accountNumber} ${row.contactName} ${row.email}`.toLowerCase().includes(normalizedQuery)), [data, normalizedQuery]);
  const hasRecords = mode === "Sales" ? lines.length : mode === "Inventory" ? inventory.length : mode === "Customers" ? customers.length : suppliers.length;
  const title = { Sales: "Sale-line intelligence", Inventory: "Inventory control", Customers: "Customer value", Suppliers: "Supplier directory" }[mode];
  const description = {
    Sales: "Inspect each imported transaction line, its customer link, discounts, product economics and margin contribution.",
    Inventory: "Track verified on-hand stock, demand velocity, cover, reorder thresholds and stock-risk exceptions by location.",
    Customers: "Understand purchase frequency, basket value, revenue contribution and recency without exposing identity to unauthorized roles.",
    Suppliers: "Connect vendor contacts to catalog coverage, demand, margin and stock exposure for purchasing review.",
  }[mode];
  return <div className="content commerce-intelligence-page">
    <section className="commerce-intelligence-head">
      <div><p>VERIFIED COMMERCE RECORDS</p><h2>{title}</h2><span>{description}</span></div>
      <form className="commerce-period-picker" onSubmit={(event) => { event.preventDefault(); setApplied({ from, to }); }}>
        <label>From<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} required /></label>
        <label>To<input type="date" value={to} min={from} max={today()} onChange={(event) => setTo(event.target.value)} required /></label>
        <button disabled={loading}>{loading ? "Loading…" : "Apply dates"}</button>
      </form>
    </section>
    {error ? <section className="commerce-api-error" role="alert"><b>Commerce data could not be loaded.</b><span>{error}</span><button onClick={() => void load()}>Try again</button></section> : null}
    {data ? <>
      <section className="commerce-date-context"><span>{data.period.from} → {data.period.to}</span><b>{data.period.days} calendar {data.period.days === 1 ? "day" : "days"}</b><small>Compared with {data.period.comparisonFrom} → {data.period.comparisonTo}</small></section>
      {mode === "Sales" && <section className="commerce-stats">
        <Stat label="NET SALES" value={money(data.kpis.netSalesCents, currency)} note={changeCopy(data.kpis.changes.netSalesRate)} />
        <Stat label="GROSS MARGIN" value={percent(data.kpis.grossMarginRate)} note={changeCopy(data.kpis.changes.grossProfitRate)} tone="green" />
        <Stat label="AVERAGE BASKET" value={preciseMoney(data.kpis.averageTransactionCents, currency)} note={changeCopy(data.kpis.changes.averageTransactionRate)} tone="amber" />
        <Stat label="DISCOUNTS" value={money(data.kpis.discountsCents, currency)} note={`${percent(data.kpis.discountRate)} of pre-discount value`} tone="coral" />
        <Stat label="TRANSACTIONS" value={data.kpis.transactions.toLocaleString()} note={`${data.kpis.units.toFixed(1)} units · ${data.kpis.unitsPerTransaction?.toFixed(2) ?? "—"} per basket`} tone="cyan" />
        <Stat label="KNOWN CUSTOMERS" value={data.kpis.knownCustomerTransactions.toLocaleString()} note={`${data.kpis.transactions ? ((data.kpis.knownCustomerTransactions / data.kpis.transactions) * 100).toFixed(1) : "0.0"}% of transactions linked`} tone="violet" />
      </section>}
      {mode === "Inventory" && <section className="commerce-stats">
        <Stat label="VERIFIED SKUS" value={data.inventory.length.toLocaleString()} note="Across imported stock locations" />
        <Stat label="STOCKOUTS" value={data.inventory.filter((row) => row.stockStatus === "stockout").length.toLocaleString()} note="Zero units on hand" tone="coral" />
        <Stat label="LOW STOCK" value={data.inventory.filter((row) => row.stockStatus === "low").length.toLocaleString()} note="At or below source reorder point" tone="amber" />
        <Stat label="COVER WATCH" value={data.inventory.filter((row) => row.stockStatus === "watch").length.toLocaleString()} note="Under 14 estimated selling days" tone="violet" />
      </section>}
      {(mode === "Sales" || mode === "Inventory") && data.alerts.length > 0 && <section className="commerce-alert-rail" aria-label="Commerce exceptions">
        <header><div><p>EXCEPTION QUEUE</p><h3>Issues supported by the selected records</h3></div><span>{data.alerts.length} for review</span></header>
        <div>{data.alerts.slice(0, 8).map((alert, index) => <article key={`${alert.type}:${alert.title}:${index}`} className={`commerce-alert ${alert.severity}`}><i /><span><b>{alert.title}</b><small>{alert.detail} {alert.action}</small></span><button onClick={() => createTask({ title: alert.title, detail: `${alert.detail} ${alert.action}`, priority: alert.severity === "urgent" ? "high" : "medium", sourceType: "alert", sourceRef: `${alert.type}:${index}` })}>Assign →</button></article>)}</div>
      </section>}
      {mode === "Inventory" && data.permissions.manageCosts && <section className="commerce-cost-manager" aria-labelledby="inventory-cost-title">
        <header>
          <div><p>INVENTORY COSTS</p><h3 id="inventory-cost-title">Add verified unit costs</h3><span>Enter a cost beside one item or upload a CSV. Owner costs are kept separate from POS values and used for margin calculations.</span></div>
          <div className="commerce-cost-actions">
            <button type="button" onClick={downloadCostTemplate}>Download template</button>
            {data.permissions.importCosts && <label>Choose cost CSV<input type="file" accept=".csv,text/csv" onChange={(event) => void readCostFile(event.target.files?.[0])} /></label>}
          </div>
        </header>
        {costError && <div className="commerce-cost-error" role="alert">{costError}</div>}
        {costPreview.length > 0 && <div className="commerce-cost-preview">
          <div><b>{costFileName}</b><span>{costPreview.length} {costPreview.length === 1 ? "cost" : "costs"} ready for review</span></div>
          <div className="commerce-cost-preview-rows">{costPreview.slice(0, 6).map((row) => <span key={`${row.row}:${row.sku}`}><b>{row.sku}</b><small>{row.provider ? providerDisplayName(row.provider) : "Any matching provider"}</small><strong>{preciseMoney(row.unitCostCents, currency)}</strong></span>)}</div>
          {costPreview.length > 6 && <small>+ {costPreview.length - 6} more rows</small>}
          <div className="commerce-cost-confirm"><button type="button" onClick={() => { setCostPreview([]); setCostFileName(""); }}>Cancel</button><button type="button" disabled={costSaving} onClick={() => void saveCosts("csv", costPreview.map((row) => ({ sku: row.sku, provider: row.provider, unitCostCents: row.unitCostCents })))}>{costSaving ? "Saving…" : `Save ${costPreview.length} costs`}</button></div>
        </div>}
      </section>}
      <section className="dense-panel commerce-intelligence-table">
        <header><div><p>{mode.toUpperCase()}</p><h3>{mode === "Sales" ? "Transaction-line ledger" : mode === "Inventory" ? "Stock and reorder directory" : mode === "Customers" ? "Customer performance directory" : "Vendor performance directory"}</h3></div><div className="commerce-table-actions"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${mode.toLowerCase()}…`} aria-label={`Search ${mode.toLowerCase()}`} />{mode === "Inventory" && <button onClick={() => downloadInventoryCsv(inventory, data.period.from, data.period.to)} disabled={!inventory.length}>Export CSV</button>}</div></header>
        {hasRecords ? <div className="commerce-scroll-table" role="region" aria-label={`${mode} records`} tabIndex={0}>
          {mode === "Sales" && <div className="commerce-ledger commerce-ledger-sales">
            <div className="commerce-ledger-head"><span>Date / sale</span><span>Item</span><span>Customer</span><span>Qty</span><span>Net sales</span><span>Discount</span><span>Margin</span></div>
            {lines.map((row) => <div key={`${row.provider}:${row.externalSaleId}:${row.externalLineId}`}><span><b>{dateTime(row.soldAt)}</b><small>{row.externalSaleId}</small></span><span><b>{row.productName}</b><small>{row.sku || "No SKU"}</small></span><span><b>{row.customerName || "Guest / not supplied"}</b><small>{row.customerEmail || "No identity attached"}</small></span><span>{(row.quantityMilli / 1000).toFixed(2)}</span><span>{preciseMoney(row.netSalesCents, currency)}</span><span>{preciseMoney(row.discountCents, currency)}</span><span className={row.marginRate != null && row.marginRate < .25 ? "negative" : "positive"}>{percent(row.marginRate)}</span></div>)}
          </div>}
          {mode === "Inventory" && <div className="commerce-ledger commerce-ledger-inventory">
            <div className="commerce-ledger-head"><span>Item</span><span>Location</span><span>Unit cost</span><span>On hand</span><span>Velocity</span><span>Cover</span><span>Status</span><span>Order review</span></div>
            {inventory.map((row) => {
              const costKey = `${row.provider}:${row.connectionId}:${row.externalProductId ?? row.sku}`;
              const editing = editingCostKey === costKey;
              return <div key={`${row.provider}:${row.locationRef}:${row.sku}`}><span><b>{row.name}</b><small>{row.sku}</small></span><span>{row.locationRef.split(":").at(-1)}</span><span className="commerce-unit-cost">{editing ? <form onSubmit={(event) => { event.preventDefault(); saveManualCost(row); }}><label><span className="sr-only">Unit cost for {row.name}</span><input autoFocus inputMode="decimal" value={costDraft} onChange={(event) => setCostDraft(event.target.value)} placeholder="0.00" /></label><button disabled={costSaving}>Save</button><button type="button" onClick={() => { setEditingCostKey(""); setCostDraft(""); }}>Cancel</button></form> : <><b>{preciseMoney(row.effectiveCostCents, currency)}</b><small>{row.costSource ? `${row.costSource === "provider" ? "POS" : row.costSource.toUpperCase()} source` : "Cost needed"}</small>{data.permissions.manageCosts && row.externalProductId ? <button type="button" onClick={() => { setCostError(""); setEditingCostKey(costKey); setCostDraft(row.effectiveCostCents == null ? "" : (row.effectiveCostCents / 100).toFixed(2)); }}>Edit</button> : null}</>}</span><span>{row.onHandQuantity.toLocaleString()}</span><span>{row.dailyVelocity.toFixed(2)}/day</span><span>{row.daysOfCover == null ? "No velocity" : `${row.daysOfCover.toFixed(1)} days`}</span><span><i className={`stock-state ${row.stockStatus}`}>{row.stockStatus}</i></span><span><b>{row.recommendedOrderUnits > 0 ? `${row.recommendedOrderUnits} units` : "No order"}</b><small>Review—not automatic</small></span></div>;
            })}
          </div>}
          {mode === "Customers" && <div className="commerce-ledger commerce-ledger-customers">
            <div className="commerce-ledger-head"><span>Customer</span><span>Last purchase</span><span>Transactions</span><span>Net sales</span><span>Avg basket</span><span>Gross profit</span></div>
            {customers.map((row, index) => <div key={`${row.provider}:${row.externalCustomerId ?? index}`}><span><b>{row.displayName || "Known customer"}</b><small>{row.email || row.phone || "Identity restricted or not supplied"}</small></span><span>{dateTime(row.lastPurchaseAt)}</span><span>{Number(row.transactionCount).toLocaleString()}</span><span>{money(Number(row.netSalesCents), currency)}</span><span>{preciseMoney(Number(row.averageTransactionCents), currency)}</span><span>{money(row.grossProfitCents == null ? null : Number(row.grossProfitCents), currency)}</span></div>)}
          </div>}
          {mode === "Suppliers" && <div className="commerce-ledger commerce-ledger-suppliers">
            <div className="commerce-ledger-head"><span>Supplier</span><span>Contact</span><span>Products</span><span>Units sold</span><span>Net sales</span><span>Margin</span><span>Stock risk</span></div>
            {suppliers.map((row) => <div key={`${row.provider}:${row.externalSupplierId}`}><span><b>{row.name}</b><small>{row.accountNumber || "No account number"}</small></span><span><b>{row.contactName || "Not supplied"}</b><small>{row.email || row.phone || "No contact detail"}</small></span><span>{Number(row.productCount).toLocaleString()}</span><span>{(Number(row.periodQuantityMilli) / 1000).toFixed(1)}</span><span>{money(Number(row.periodNetSalesCents), currency)}</span><span>{percent(row.periodMarginRate)}</span><span className={Number(row.lowStockItems) > 0 ? "negative" : "positive"}>{Number(row.lowStockItems)} at risk</span></div>)}
          </div>}
        </div> : <DataEmpty mode={mode} navigate={navigate} />}
      </section>
      {mode === "Sales" && data.products.length > 0 && <section className="commerce-product-rank">
        <header><div><p>PRODUCT ECONOMICS</p><h3>Revenue, discount and margin leaders</h3></div><span>Selected date range</span></header>
        <div>{data.products.slice(0, 12).map((product, index) => <article key={product.productRef}><i>{String(index + 1).padStart(2, "0")}</i><span><b>{product.name}</b><small>{(product.quantityMilli / 1000).toFixed(1)} units · {product.transactionCount} baskets</small></span><strong>{money(product.netSalesCents, currency)}</strong><em>{percent(product.marginRate)} margin</em><small>{money(product.discountCents, currency)} discounts</small></article>)}</div>
      </section>}
    </> : loading ? <section className="commerce-loading-canvas" aria-label="Loading commerce intelligence"><i /><i /><i /></section> : null}
  </div>;
}
