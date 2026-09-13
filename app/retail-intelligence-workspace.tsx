"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "./supabase-browser";
import RetailIntelligencePanel, { type RetailAccess, type RetailReport } from "./retail-intelligence-panel";
import RetailEvidenceSettings from "./retail-evidence-settings";
import { InventoryLifecycleWorkspace } from "./inventory-lifecycle-workspace";

export type RetailAdvisorSeed = { question: string; from: string; to: string; locationId: string | null };
export default function RetailIntelligenceWorkspace({ from, to, locationId, currency, onAsk, navigate, createTask, initialSection }: {
  from: string; to: string; locationId: string | null; currency: string; onAsk?: (seed: RetailAdvisorSeed) => void;
  navigate: (view: "Integrations") => void; createTask: (seed: { title: string; detail: string; priority: "high" | "medium" | "low"; sourceType?: "alert" }) => void;
  initialSection?: "Why it changed" | "Inventory" | "Customers";
}) {
  const [data, setData] = useState<{ report: RetailReport; access: RetailAccess } | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0), [inputs, setInputs] = useState(false), [expiry, setExpiry] = useState(false), [notice, setNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ from, to }); if (locationId) params.set("location", locationId);
    void apiFetch("/api/v1/retail-intelligence?" + params, { signal: controller.signal }).then(async response => {
      const body = await response.json(); if (!response.ok) throw new Error(body.error?.message ?? "Retail intelligence could not be loaded.");
      if (!controller.signal.aborted) { setData(body); setError(""); }
    }).catch(caught => { if (!controller.signal.aborted) { setData(null); setError(caught.message); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [from, to, locationId, revision]);
  // The parent keys this component by scope, so old data cannot flash in a new location.
  return <div className="retail-workspace" aria-busy={loading}>
    {loading && !data && <p role="status">Preparing complete product and basket evidence…</p>}
    {error && <div className="retail-inputs"><h3>Retail evidence needs attention.</h3><p role="alert">{error}</p><button onClick={() => { setLoading(true); setRevision(v => v + 1); }}>Retry</button> <button onClick={() => navigate("Integrations")}>Review connections</button></div>}
    {data && <><RetailIntelligencePanel report={data.report} currency={currency} access={data.access} initialSection={initialSection}
      onAsk={onAsk ? question => onAsk({ question, from, to, locationId }) : undefined}
      onTask={(title, detail) => createTask({ title, detail, priority: "medium", sourceType: "alert" })}
      onInputs={data.access.edit ? () => setInputs(v => !v) : undefined} onExpiry={data.access.expiry ? () => setExpiry(v => !v) : undefined}/>
      {inputs && <RetailEvidenceSettings key={from + to + locationId} from={from} to={to} locationId={locationId} access={data.access} onClose={() => setInputs(false)} onSaved={() => { setLoading(true); setRevision(v => v + 1); }}/>}
      {notice && <p role="status">{notice}</p>}
      {expiry && <div className="retail-inputs"><button onClick={() => { setExpiry(false); setRevision(v => v + 1); }}>Close expiry manager & refresh</button><InventoryLifecycleWorkspace currency={currency} activeLocationId={locationId} showNotice={setNotice} createTask={seed => createTask({ title: seed.title, detail: seed.detail, priority: seed.priority, sourceType: "alert" })}/></div>}
    </>}
  </div>;
}
