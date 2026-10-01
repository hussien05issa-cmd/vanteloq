import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import ExecutiveOverview from "../app/executive-overview";
import ExecutiveStatusFrame from "../app/executive-status-frame";
import ExecutiveSummaryPanels from "../app/executive-summary-panels";
import { dashboardPreferencePreset } from "../domain/dashboard-preferences";
import { executivePeriod } from "../domain/executive-metrics";
import { buildExecutiveReport } from "../server/executive-report";

const blank=()=>buildExecutiveReport(executivePeriod(new URLSearchParams("period=30d"),"2026-09-27"),{metrics:{},previous:null,trend:[],insights:[]},null,"No posted records for this period.","commerce");

test("a disconnected executive dashboard retains six cards, its chart and records table without sample figures",()=>{
  const html=renderToStaticMarkup(<ExecutiveOverview currency="CAD" initialReport={blank()} navigate={()=>{}}/>);
  assert.equal((html.match(/class="executive-kpi size-/g)??[]).length,6);
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
    assert.equal((html.match(/class="executive-kpi size-/g)??[]).length,6);
    assert.match(html,/PERIOD TREND/);
    assert.match(html,/Totals are withheld/);
    assert.doesNotMatch(html,/\$\d|data-testid="actual-value"/);
  }
});

test("source composition keeps signed amounts exact and does not turn negative shares into a pie",()=>{
  const report=blank();
  report.revenueSources={totalCents:15000,recordCount:2,sources:[{key:"a",label:"Sales",cents:20000,recordCount:1,updatedAt:null},{key:"b",label:"Returns",cents:-5000,recordCount:1,updatedAt:null}]};
  const html=renderToStaticMarkup(<ExecutiveSummaryPanels report={report} currency="CAD" onConnect={()=>{}} onRecords={()=>{}}/>);
  assert.match(html,/\$150\.00/);assert.match(html,/-\$50\.00/);
  assert.doesNotMatch(html,/conic-gradient/);
});
