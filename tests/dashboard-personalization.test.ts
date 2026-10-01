import assert from 'node:assert/strict';
import test from 'node:test';
import { goalResult, recommendedOverview, validDashboardDates, workspaceDashboardJson } from '../domain/dashboard-personalization';
import { normalizeDashboardPreferences } from '../domain/dashboard-preferences';
import { dashboardDemoReport } from '../app/dashboard-demo-report';
import { buildExecutiveReport } from '../server/executive-report';

const scope={from:'2026-09-01',to:'2026-09-30',locationId:null,eligible:true};
const rule={direction:'higher' as const,from:scope.from,to:scope.to,locationId:null};
test('goals preserve unknown, zero, negative and exceeded results without inventing progress',()=>{
  assert.equal(goalResult(null,100,rule,scope).progress,null);
  assert.equal(goalResult(0,100,rule,scope).progress,0);
  assert.equal(goalResult(-25,100,rule,scope).progress,-25);
  assert.deepEqual(goalResult(125,100,rule,scope),{status:'Target exceeded',progress:125,visual:100,complete:true});
  assert.equal(goalResult(125,100,rule,{...scope,eligible:false}).progress,null);
  assert.equal(goalResult(125,100,rule,{...scope,locationId:'other'}).progress,null);
  assert.equal(goalResult(125,100,rule,{...scope,to:'2026-10-01'}).progress,null);
  assert.equal(goalResult(100,0,rule,scope).status,'Target not set');
});
test('lower goals require a real baseline for proportional progress',()=>{
  assert.equal(goalResult(90,100,{...rule,direction:'lower'},scope).progress,null);
  assert.equal(goalResult(90,100,{...rule,direction:'lower'},scope).complete,true);
  assert.equal(goalResult(150,100,{...rule,direction:'lower',start:200},scope).progress,50);
  assert.equal(goalResult(150,100,{...rule,direction:'lower',start:50},scope).progress,null);
});
test('calendar validation and bounded named views survive serialization',()=>{
  assert.equal(validDashboardDates('2026-02-30','2026-03-01'),false);
  assert.equal(validDashboardDates('2026-03-02','2026-03-01'),false);
  const base=recommendedOverview('Retail',['cash','stock']);
  const saved=normalizeDashboardPreferences({...base,defaultPeriod:'custom',customDates:scope,views:Array.from({length:9},(_,i)=>({name:`View ${i}`,layout:base})),targets:{net_revenue:-5,gross_margin:40},goalRules:{gross_margin:rule}});
  assert.equal(saved.views.length,5);assert.equal(saved.defaultPeriod,'custom');assert.equal(saved.targets.net_revenue,undefined);
  assert.deepEqual(normalizeDashboardPreferences(JSON.parse(JSON.stringify(saved))),saved);
  assert.equal(normalizeDashboardPreferences({defaultPeriod:'custom'}).defaultPeriod,'30d');
  assert.equal(base.widgets.filter(w=>w.visible).length,6);
});
test('workspace envelope rejects stale or foreign layouts and never trusts a client organization',()=>{
  const prefs=recommendedOverview('Retail',['stock']);prefs.targets.net_revenue=999;
  const json=JSON.stringify({workspaceId:'org-a',dashboard:prefs});
  assert.equal(workspaceDashboardJson(json,'org-a').targets.net_revenue,999);
  assert.equal(workspaceDashboardJson(json,'org-b').targets.net_revenue,undefined);
  assert.equal(workspaceDashboardJson(JSON.stringify(prefs),'org-b').targets.net_revenue,undefined);
});
test('sample figures are receipt-derived and missing records remain unavailable',()=>{
  const all=dashboardDemoReport(),shop=dashboardDemoReport('central');
  assert.ok(all.metrics.find(m=>m.key==='net_revenue')!.value!>shop.metrics.find(m=>m.key==='net_revenue')!.value!);
  const empty=dashboardDemoReport('all',true);assert.ok(empty.metrics.every(m=>m.value===null&&m.goalEligible===false));
  const current=all.metrics.find(m=>m.key==='net_revenue')!;
  assert.equal(current.trend.reduce((sum,p)=>sum+(p.value??0),0),current.value);
  const report=buildExecutiveReport(all.period,{metrics:{net_sales:{value:100,actuality:'actual'} as never},previous:null,trend:[],insights:[],reportingPeriod:{comparable:false,coverage:{current:{complete:true},previous:{complete:false}}}},null,null,'commerce');
  assert.equal(report.metrics[0].goalEligible,true);assert.equal(report.metrics[0].previous,null);
});

test("goals use full targets with clearly bounded progress to date",()=>{
  const rule={direction:"higher" as const,from:"2026-09-01",to:"2026-09-30",locationId:null};
  const scope={from:"2026-09-01",to:"2026-09-20",eligible:true};
  assert.equal(goalResult(50,100,rule,scope).progress,50);
  assert.equal(goalResult(50,100,rule,{...scope,from:"2026-09-10"}).progress,null);
  assert.equal(goalResult(50,100,{...rule,direction:"lower",start:200},scope).complete,false);
  assert.equal(goalResult(50,100,{...rule,direction:"lower",start:200},scope).status,"Within target so far");
});
