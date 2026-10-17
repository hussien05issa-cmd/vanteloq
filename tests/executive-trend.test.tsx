import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import ExecutiveTrend from '../app/executive-trend';
import { dashboardDemoReport } from '../app/dashboard-demo-report';

test('executive inspection formats ratio percentages and exact source cents consistently', () => {
  const report = dashboardDemoReport();
  const margin = {...report.metrics.find(metric => metric.key === 'gross_margin')!,trend:[{date:'2026-06-25',value:.3075}]};
  const html = renderToStaticMarkup(<ExecutiveTrend metric={margin} currency="CAD" period={report.period} chart="line" onSetup={()=>{}}/>);
  assert.match(html, /2026-06-25: 30\.75%/);
  assert.match(html, /<b>30\.75%<\/b>/);
  assert.match(html, /r="4" fill="#326cdb"/); // An isolated observation remains visible.
  const money = {...report.metrics[0],trend:[{date:'2026-06-25',value:10001}]};
  const cash = renderToStaticMarkup(<ExecutiveTrend metric={money} currency="CAD" period={report.period} chart="line" onSetup={()=>{}}/>);
  assert.match(cash, /2026-06-25: \$100\.01/);
  assert.doesNotMatch(cash, /NaN|Infinity/);
});

test('executive line and fill remain separate around an unknown day, including signed records', () => {
  const report = dashboardDemoReport();
  const metric = {...report.metrics[0],trend:[
    {date:'2026-06-21',value:10000},{date:'2026-06-22',value:-5000},
    {date:'2026-06-23',value:null},{date:'2026-06-24',value:20000},{date:'2026-06-25',value:30000},
  ]};
  const html = renderToStaticMarkup(<ExecutiveTrend metric={metric} currency="CAD" period={report.period} chart="line" onSetup={()=>{}}/>);
  assert.equal((html.match(/fill="none" stroke="url/g)??[]).length,2);
  assert.equal((html.match(/ Z" fill="url/g)??[]).length,2);
  assert.equal((html.match(/role="button"/g)??[]).length,4);
  assert.match(html, /2026-06-22: -\$50\.00/);
  assert.match(html, /Not available/);
  assert.doesNotMatch(html, /NaN|Infinity/);
});
