import { useState } from "react";
import { createRoot } from "react-dom/client";
import DecisionWorkspace from "../../app/decision-workspace";
import { buildCommandCentre, type MetricRow } from "../../server/intelligence";
import { buildOperatingSystem } from "../../server/operating-system";

const rows: MetricRow[] = Array.from({ length: 60 }, (_, index) => ({
  businessDate: new Date(Date.UTC(2026, 6, 6 + index)).toISOString().slice(0, 10), locationRef: "fictional-central",
  grossSalesCents: index < 30 ? 110000 : 100000, netSalesCents: index < 30 ? 100000 : 80000,
  costOfGoodsCents: 50000, transactionCount: index < 30 ? 100 : 80, unitsSold: 140, refundsCents: 0, discountsCents: index < 30 ? 10000 : 20000,
  labourCostCents: 18000, inventoryValueCents: null, cashBalanceCents: null, accountsPayableCents: null,
}));
function Preview() {
  const [partial, setPartial] = useState(false), [notice, setNotice] = useState("");
  const data = buildCommandCentre(partial ? rows.filter((_, i) => i !== 12) : rows, "CAD", new Date("2026-09-04T12:00:00Z"));
  const operating = buildOperatingSystem({ ...data, currency: "CAD" });
  const comparison = data.periodComparisons!.thirtyDays;
  return <div className="operating-shell"><aside className="fixture-sidebar"><strong>Vanteloq</strong><small>LOCAL QA · FICTIONAL DATA</small><p>Command Centre</p><b>Intelligence</b><p>Sales</p><p>Inventory</p><p>BookLoQ</p><p>Action Centre</p></aside><main className="main-panel"><div className="fixture-notice"><strong>Northline Retail · Sample workspace</strong><label><input type="checkbox" checked={partial} onChange={e => setPartial(e.target.checked)}/> Remove one baseline day</label></div><div className="content"><DecisionWorkspace decisions={operating.decisions}
    period={{ from: comparison.periodStart, to: comparison.periodEnd }} freshness={data.source.freshness} verifiedDays={data.source.verifiedDays} comparisonNote={comparison.unavailableReason}
    onAction={decision => setNotice(`Action form requested: ${decision.title}`)} onAsk={decision => setNotice(`AI context requested: ${decision.title}; ${comparison.periodStart} to ${comparison.periodEnd}`)}
    onEvidence={() => setNotice("Report requested")} onConnections={() => setNotice("Connections requested")} onActions={() => setNotice("Action Centre requested")}/><p role="status">{notice}</p></div></main></div>;
}
createRoot(document.getElementById("root")!).render(<Preview/>);
