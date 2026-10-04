import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { dashboardDemoPreferences, dashboardDemoReport } from '../app/dashboard-demo-report';
import ExecutiveOverview from '../app/executive-overview';
import HomeDashboardPreview from '../app/home-dashboard-preview';
import { demoAnalysis, type DemoLocation } from '../domain/product-demo';
import { goalResult } from '../domain/dashboard-personalization';

const money = (cents: number) => new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD'}).format(cents/100);

test('sample attribution and insights reconcile to receipt totals for every location scope',()=>{
  for (const location of ['all','central','riverside'] as DemoLocation[]) {
    const report=dashboardDemoReport(location), analysis=demoAnalysis(location,'complete');
    const current=analysis.kpis.current!, previous=analysis.kpis.previous!;
    const source=report.revenueSources!;
    assert.equal(source.totalCents,current.netSalesCents);
    assert.equal(source.recordCount,analysis.currentRows.length);
    assert.equal(source.sources.length,1);
    assert.equal(source.sources[0].label,'Fictional sample receipts');
    assert.equal(source.sources[0].cents,source.totalCents);
    assert.equal(source.sources[0].updatedAt,null);
    assert.equal(report.insights.length,2);
    assert.ok(report.insights[0].whatHappened.includes(money(current.netSalesCents!)));
    assert.ok(report.insights[0].whatHappened.includes(money(previous.netSalesCents!)));
    assert.ok(report.insights[0].financialImpact.includes(money(current.netSalesCents!-previous.netSalesCents!)));
    assert.ok(report.insights[1].financialImpact.includes(money(current.grossProfitCents!-previous.grossProfitCents!)));
    assert.ok(report.insights.every(item=>item.probableCause.includes('cause is not established')));
    assert.equal(report.finance,null);
    for (const key of ['cash_balance','cash_flow','operating_profit','net_margin']) assert.equal(report.metrics.find(metric=>metric.key===key)?.value,null);
  }
});

test('illustrative sample goals use prior results, exact displayed dates and eligible current values',()=>{
  const report=dashboardDemoReport(), preferences=dashboardDemoPreferences(report);
  assert.deepEqual(preferences.widgets.filter(widget=>widget.visible).map(widget=>widget.id),['net_revenue','gross_profit','gross_margin','transactions']);
  assert.ok(preferences.widgets.every(widget=>widget.size==='standard'));
  assert.deepEqual(preferences.goalRings,['net_revenue','transactions','gross_margin']);
  assert.equal(Object.keys(preferences.targets).length,3);
  for (const key of preferences.goalRings) {
    const metric=report.metrics.find(item=>item.key===key)!;
    const scale=metric.unit==='money'?0.01:metric.unit==='percent'?100:1;
    assert.equal(preferences.targets[key],metric.unit==='money'?metric.previous!/100:metric.previous!*scale);
    const result=goalResult(metric.value!*scale,preferences.targets[key],preferences.goalRules[key],{...report.period,eligible:metric.goalEligible,locationId:null});
    assert.ok(result.progress!==null && Number.isFinite(result.progress));
    assert.equal(goalResult(metric.value!*scale,preferences.targets[key],preferences.goalRules[key],{...report.period,eligible:true,locationId:'other'}).progress,null);
  }
  const html=renderToStaticMarkup(<ExecutiveOverview currency="CAD" initialReport={report} initialPreferences={preferences} navigate={()=>{}}/>);
  assert.match(html,/Revenue share by source/);
  assert.match(html,/Fictional sample receipts/);
  assert.doesNotMatch(html,/Empty revenue composition ring|Your next decision starts here|Target not set/);
  assert.match(renderToStaticMarkup(<HomeDashboardPreview/>),/illustrative targets, not business recommendations/);
});

test('before-connecting preview has no sample attribution, insight or goal progress',()=>{
  const report=dashboardDemoReport('all',true), preferences=dashboardDemoPreferences(report);
  assert.equal(report.revenueSources,null); assert.deepEqual(report.insights,[]);
  assert.deepEqual(preferences.targets,{}); assert.deepEqual(preferences.goalRules,{});
  assert.ok(report.metrics.every(metric=>metric.value===null&&!metric.goalEligible));
  const html=renderToStaticMarkup(<ExecutiveOverview currency="CAD" initialReport={report} initialPreferences={preferences} navigate={()=>{}}/>);
  assert.match(html,/Empty revenue composition ring|Target not set/);
  assert.match(html,/Your next decision starts here/);
  assert.doesNotMatch(html,/\$\d|sample-sales-comparison|sample-margin-comparison/);
});
