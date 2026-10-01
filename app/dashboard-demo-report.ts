import { demoAnalysis, type DemoLocation } from '../domain/product-demo';
import { advisorDailySeries } from '../domain/advisor-kpis';
import { executivePeriod } from '../domain/executive-metrics';
import { dashboardPreferencePreset, normalizeDashboardPreferences, type DashboardPreferences } from '../domain/dashboard-preferences';
import { buildExecutiveReport, type ExecutiveReport } from '../server/executive-report';
import { buildMetricResults } from '../server/data-trust';
import { revenueAttribution } from '../server/revenue-attribution';

const money = (cents: number) => new Intl.NumberFormat('en-CA', {style:'currency',currency:'CAD'}).format(cents / 100);
const number = (value: number) => value.toLocaleString('en-CA', {maximumFractionDigits:2});

/** Prior-period sample results are illustrative targets, not account settings or recommendations. */
export function dashboardDemoPreferences(report: ExecutiveReport): DashboardPreferences {
  const base = dashboardPreferencePreset('sales');
  const targets: DashboardPreferences['targets'] = {}, goalRules: DashboardPreferences['goalRules'] = {};
  const goalRings: DashboardPreferences['goalRings'] = ['net_revenue','transactions','gross_margin'];
  if (report.sourceCoverage) for (const key of goalRings) {
    const metric = report.metrics.find(item => item.key === key);
    if (!metric || metric.previous === null || metric.previous <= 0) continue;
    targets[key] = metric.unit === 'money' ? metric.previous / 100 : metric.unit === 'percent' ? metric.previous * 100 : metric.previous;
    goalRules[key] = {direction:'higher',from:report.period.from,to:report.period.to,locationId:null};
  }
  return normalizeDashboardPreferences({...base,widgets:base.widgets.map(widget=>({...widget,size:'standard'})),goalRings,targets,goalRules});
}

/** Fictional receipt-derived preview, never sent to account APIs or storage. */
export function dashboardDemoReport(location:DemoLocation='all',empty=false) {
  const analysis=demoAnalysis(location,'complete'),c=analysis.kpis.current!,p=analysis.kpis.previous!;
  const period=executivePeriod(new URLSearchParams({period:'custom',from:c.start,to:c.end,compare:'previous'}),c.end);
  const metrics=buildMetricResults({rows:empty?[]:analysis.currentRows.map(r=>({businessDate:r.date,locationRef:r.locationRef,updatedAt:`${c.end}T12:00:00Z`})),currency:'CAD',periodStart:c.start,periodEnd:c.end,comparisonPeriodStart:p.start,comparisonPeriodEnd:p.end,freshnessStatus:'current',values:empty?{}:{net_sales:c.netSalesCents,gross_profit:c.grossProfitCents,gross_margin:c.grossMarginPercent===null?null:c.grossMarginPercent/100,transactions:c.transactions,average_transaction:c.averageTransactionCents,units:c.unitsSold}});
  for(const metric of Object.values(metrics)) {metric.sourceSystem='Fictional sample receipts';metric.limitations=['Sample records only. Not connected to a business account.'];}
  const trend=empty?[]:advisorDailySeries(analysis.currentRows).map(r=>({date:r.date,netSalesCents:r.netSalesCents!,grossProfitCents:r.grossProfitCents,transactionCount:r.transactions!,averageTransactionCents:r.transactions?Math.round(r.netSalesCents!/r.transactions):null,unitsSold:analysis.currentRows.filter(row=>row.date===r.date).reduce((sum,row)=>sum+(row.unitsSold??0),0)}));
  const sources = empty ? null : revenueAttribution(analysis.currentRows.map(row=>({businessDate:row.date,netSalesCents:row.netSalesCents!})), {from:c.start,to:c.end,expectedCents:c.netSalesCents,revealSources:false});
  if (sources) sources.sources = sources.sources.map(source=>({...source,key:'fictional-receipts',label:'Fictional sample receipts'}));
  const insights: ExecutiveReport['insights'] = [];
  if (!empty && analysis.kpis.comparisonComplete && c.netSalesCents !== null && p.netSalesCents !== null && c.transactions !== null && p.transactions !== null) {
    insights.push({id:'sample-sales-comparison',title:'Sample sales changed across comparable periods',
      whatHappened:`Fictional net revenue was ${money(c.netSalesCents)} across ${number(c.transactions)} transactions, compared with ${money(p.netSalesCents)} across ${number(p.transactions)} in the previous ${p.observedDays} days.`,
      probableCause:'The cause is not established. Transaction counts and average sale values describe the recorded difference; they do not establish why it happened.',
      financialImpact:`Recorded net revenue changed by ${money(c.netSalesCents-p.netSalesCents)}. This is a sales comparison, not a cash-flow or net-profit result.`,
      recommendedAction:'Open the sample sales records to compare transaction counts, basket values and recorded discounts across the same dates.',confidence:'High (sample records)'});
  }
  if (!empty && analysis.kpis.comparisonComplete && c.grossMarginPercent !== null && p.grossMarginPercent !== null && c.grossProfitCents !== null && p.grossProfitCents !== null) {
    insights.push({id:'sample-margin-comparison',title:'Review the sample gross margin change',
      whatHappened:`Fictional gross margin was ${number(c.grossMarginPercent)}%, compared with ${number(p.grossMarginPercent)}% in the previous period.`,
      probableCause:'The cause is not established. A comparison of item mix, recorded discounts and matched product costs is needed before attributing the change.',
      financialImpact:`Recorded gross profit changed by ${money(c.grossProfitCents-p.grossProfitCents)}. Operating expenses, tax and financing are excluded.`,
      recommendedAction:'Review the receipt lines and matched product costs in the sample sales report.',confidence:'High (sample records)'});
  }
  return buildExecutiveReport(period,{metrics,trend,previous:empty?null:{netSalesCents:p.netSalesCents,grossProfitCents:p.grossProfitCents,grossMarginRate:p.grossMarginPercent===null?null:p.grossMarginPercent/100,transactionCount:p.transactions!,averageTransactionCents:p.averageTransactionCents,unitsSold:p.unitsSold!},reportingPeriod:{comparable:!empty&&analysis.kpis.comparisonComplete,coverage:{current:{complete:!empty&&c.complete},previous:{complete:!empty&&p.complete}}},insights},null,'Connect and review financial records in your own workspace.','commerce',sources);
}
