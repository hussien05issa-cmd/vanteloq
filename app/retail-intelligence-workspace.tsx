"use client";
import { useEffect, useRef, useState } from "react";
import { createCommerceReportLoader, type CommerceReportState } from "./commerce-read";
import WorkspaceSkeleton from "./workspace-skeleton";
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
  type Data = { report: RetailReport; access: RetailAccess };
  const params = new URLSearchParams({ from, to }); if (locationId) params.set("location", locationId);
  const scope = "/api/v1/retail-intelligence?" + params;
  const [read, setRead] = useState<CommerceReportState<Data>>({ scope: "", data: null, error: "", loading: true });
  const requests = useRef<ReturnType<typeof createCommerceReportLoader<Data>> | null>(null);
  if (requests.current === null) { requests.current = createCommerceReportLoader<Data>(apiFetch, setRead); }
  const { data, error, loading } = read.scope === scope ? read : { data: null, error: "", loading: true };
  const [revision, setRevision] = useState(0), [inputs, setInputs] = useState(false), [expiry, setExpiry] = useState(false), [notice, setNotice] = useState("");
  useEffect(() => {
    const loader = requests.current!;
    void loader.load(scope);
    return () => loader.cancel();
  }, [scope, revision]);
  // The parent keys this component by scope, so old data cannot flash in a new location.
  return <div className="retail-workspace" aria-busy={loading}>
    {loading && <WorkspaceSkeleton compact label="Preparing product and basket evidence"/>}
    {error && <div className="retail-inputs"><h3>Retail evidence needs attention.</h3><p role="alert">{error}</p><button type="button" disabled={loading} onClick={() => setRevision(v => v + 1)}>Try Again</button> <button onClick={() => navigate("Integrations")}>Review connections</button></div>}
    {data && <><RetailIntelligencePanel report={data.report} currency={currency} access={data.access} initialSection={initialSection}
      onAsk={onAsk ? question => onAsk({ question, from, to, locationId }) : undefined}
      onTask={(title, detail) => createTask({ title, detail, priority: "medium", sourceType: "alert" })}
      onInputs={data.access.edit ? () => setInputs(v => !v) : undefined} onExpiry={data.access.expiry ? () => setExpiry(v => !v) : undefined}/>
      {inputs && <RetailEvidenceSettings key={from + to + locationId} from={from} to={to} locationId={locationId} access={data.access} onClose={() => setInputs(false)} onSaved={() => setRevision(v => v + 1)}/>}
      {notice && <p role="status">{notice}</p>}
      {expiry && <div className="retail-inputs"><button onClick={() => { setExpiry(false); setRevision(v => v + 1); }}>Close expiry manager & refresh</button><InventoryLifecycleWorkspace currency={currency} activeLocationId={locationId} showNotice={setNotice} createTask={seed => createTask({ title: seed.title, detail: seed.detail, priority: seed.priority, sourceType: "alert" })}/></div>}
    </>}
  </div>;
}
