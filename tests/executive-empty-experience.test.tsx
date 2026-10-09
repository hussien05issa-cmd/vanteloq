import assert from "node:assert/strict";
import test from "node:test";
import { Children, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ExecutiveOverview from "../app/executive-overview";
import ExecutiveStatusFrame from "../app/executive-status-frame";
import ExecutiveSummaryPanels from "../app/executive-summary-panels";
import { dashboardPreferencePreset } from "../domain/dashboard-preferences";
import { executivePeriod } from "../domain/executive-metrics";
import { buildExecutiveReport } from "../server/executive-report";

const blank=()=>buildExecutiveReport(executivePeriod(new URLSearchParams("period=30d"),"2026-09-27"),{metrics:{},previous:null,trend:[],insights:[]},null,"No posted records for this period.","commerce");

function clickButton(node: ReactNode, label: string): boolean {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(child)) continue;
    if (child.type === "button" && child.props.children === label) {
      assert.equal(typeof child.props.onClick, "function", `${label} must be actionable`);
      child.props.onClick!();
      return true;
    }
    if (clickButton(child.props.children, label)) return true;
  }
  return false;
}

test("a disconnected executive dashboard retains four cards, its chart and records table without sample figures",()=>{
  const html=renderToStaticMarkup(<ExecutiveOverview currency="CAD" initialReport={blank()} navigate={()=>{}}/>);
  assert.equal((html.match(/class="executive-kpi size-/g)??[]).length,4);
  assert.match(html,/Your .*net revenue.* trend/);
  assert.match(html,/Revenue by Source/);
  assert.match(html,/Recent Daily Results/);
  assert.match(html,/<table/);
  assert.match(html,/Empty revenue composition ring/);
  assert.doesNotMatch(html,/\$0\.00|\$[1-9]|Synced|Awaiting comparison/);
});

test("sync and source-conflict states preserve the layout while withholding all values",()=>{
  for(const syncing of [true,false]){
    const html=renderToStaticMarkup(<ExecutiveStatusFrame syncing={syncing} message="Review required" preferences={dashboardPreferencePreset()} onSources={()=>{}} onRetry={()=>{}}/>);
    assert.equal((html.match(/class="executive-kpi size-/g)??[]).length,4);
    assert.match(html,/PERIOD TREND/);
    assert.match(html,/Totals are withheld/);
    assert.doesNotMatch(html,/\$\d|data-testid="actual-value"/);
  }
});

test("source gates keep reporting review and connection review as separate actions",()=>{
  for (const syncing of [true, false]) {
    const destinations: string[] = [];
    const frame = ExecutiveStatusFrame({
      syncing,
      message: "Review required",
      preferences: dashboardPreferencePreset(),
      onSources: () => destinations.push("Reports"),
      onConnections: () => destinations.push("Integrations"),
      onRetry: () => destinations.push("retry"),
    });
    assert.equal(clickButton(frame, "Review Sources"), true);
    assert.equal(clickButton(frame, "Review Connections"), true);
    assert.deepEqual(destinations, ["Reports", "Integrations"]);
  }
});

test("existing source-gate callers retain their connection-review fallback",()=>{
  let reviewed = 0;
  const frame = ExecutiveStatusFrame({ syncing: true, message: "Refreshing", preferences: dashboardPreferencePreset(), onSources: () => reviewed++, onRetry: () => {} });
  assert.equal(clickButton(frame, "Review Connections"), true);
  assert.equal(reviewed, 1);
});

test("source composition keeps signed amounts exact and does not turn negative shares into a pie",()=>{
  const report=blank();
  report.revenueSources={totalCents:15000,recordCount:2,sources:[{key:"a",label:"Sales",cents:20000,recordCount:1,updatedAt:null},{key:"b",label:"Returns",cents:-5000,recordCount:1,updatedAt:null}]};
  const html=renderToStaticMarkup(<ExecutiveSummaryPanels report={report} currency="CAD" onConnect={()=>{}} onRecords={()=>{}}/>);
  assert.match(html,/\$150\.00/);assert.match(html,/-\$50\.00/);
  assert.doesNotMatch(html,/conic-gradient/);
});
