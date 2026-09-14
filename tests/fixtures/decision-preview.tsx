import { useState } from "react";
import { createRoot } from "react-dom/client";
import DecisionWorkspace from "../../app/decision-workspace";
import { buildCommandCentre, type MetricRow } from "../../server/intelligence";
import { buildOperatingSystem } from "../../server/operating-system";
import type { OpportunityReview } from "../../domain/opportunity-review";

const rows: MetricRow[] = Array.from({ length: 60 }, (_, index) => ({
  businessDate: new Date(Date.UTC(2026, 6, 6 + index)).toISOString().slice(0, 10), locationRef: "fictional-central",
  grossSalesCents: index < 30 ? 110000 : 100000, netSalesCents: index < 30 ? 100000 : 80000,
  costOfGoodsCents: 50000, transactionCount: index < 30 ? 100 : 80, unitsSold: 140, refundsCents: 0, discountsCents: index < 30 ? 10000 : 20000,
  labourCostCents: 18000, inventoryValueCents: null, cashBalanceCents: null, accountsPayableCents: null,
}));
function Preview() {
  const [partial, setPartial] = useState(false), [notice, setNotice] = useState("");
  const [reviews, setReviews] = useState<OpportunityReview[]>([]);
  const data = buildCommandCentre(partial ? rows.filter((_, i) => i !== 12) : rows, "CAD", new Date("2026-09-04T12:00:00Z"));
  const operating = buildOperatingSystem({ ...data, currency: "CAD" });
  const comparison = data.periodComparisons!.thirtyDays;
  const period = { from: comparison.periodStart, to: comparison.periodEnd };
  const saveReview = (decision: typeof operating.decisions[number]) => {
    const review: OpportunityReview = { id: crypto.randomUUID(), ruleId: decision.id, scopeKey: "all", scopeLabel: "Sample locations", period, snapshot: decision, status: "reviewed", snoozedUntil: null, version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), events: [{ id: crypto.randomUUID(), status: "reviewed", note: "Review started.", actor: "Sample analyst", at: new Date().toISOString() }], task: null };
    setReviews(rows => [review, ...rows]); return review;
  };
  return <div className="operating-shell"><aside className="fixture-sidebar"><strong>Vanteloq</strong><small>LOCAL QA · FICTIONAL DATA</small><p>Command Centre</p><b>Intelligence</b><p>Sales</p><p>Inventory</p><p>BookLoQ</p><p>Action Centre</p></aside><main className="main-panel"><div className="fixture-notice"><strong>Northline Retail · Sample workspace</strong><label><input type="checkbox" checked={partial} onChange={e => setPartial(e.target.checked)}/> Remove one baseline day</label></div><div className="content"><DecisionWorkspace decisions={operating.decisions}
    period={{ from: comparison.periodStart, to: comparison.periodEnd }} freshness={data.source.freshness} verifiedDays={data.source.verifiedDays} comparisonNote={comparison.unavailableReason}
    reviews={reviews} canReview onRefresh={() => setNotice("Sample reviews refreshed. Local preview only.")} onCapture={saveReview}
    onReview={async (review, change) => { setReviews(rows => rows.map(row => row.id === review.id ? { ...row, ...change, version: row.version + 1, updatedAt: new Date().toISOString(), events: [{ id: crypto.randomUUID(), ...change, actor: "Sample analyst", at: new Date().toISOString() }, ...row.events] } : row)); }}
    onAction={(decision, existing) => { const review = existing ?? saveReview(decision); setReviews(rows => rows.map(row => row.id === review.id ? { ...row, task: { id: 1, title: "Inspect receipts and discount rules", status: "open", assignee: "Sample store owner", dueDate: "2026-09-20" } } : row)); setNotice("Sample action linked. Nothing sent or saved to a customer workspace."); }} onAsk={decision => setNotice(`AI context requested: ${decision.title}; ${comparison.periodStart} to ${comparison.periodEnd}`)}
    onEvidence={() => setNotice("Report requested")} onConnections={() => setNotice("Connections requested")} onActions={() => setNotice("Action Centre requested")}/><p role="status">{notice}</p></div></main></div>;
}
createRoot(document.getElementById("root")!).render(<Preview/>);
