import { dashboardPreferencePreset, normalizeDashboardPreferences, type DashboardPreferences, type DashboardWidgetId } from './dashboard-preferences';
import { applyIndustryKpis } from './industry-kpis';

export const overviewPriorities = [
  ['sales', 'Grow Sales', 'Revenue, orders and basket value'],
  ['profit', 'Understand Profitability', 'Product costs and recorded earnings'],
  ['cash', 'Improve Cash Visibility', 'Recorded balances and cash movement'],
  ['collect', 'Collect Invoices', 'Unpaid balances and due dates'],
  ['bills', 'Manage Bills', 'Upcoming payments and obligations'],
  ['stock', 'Control Stock', 'Inventory at cost and units sold'],
] as const;
export type OverviewPriority = typeof overviewPriorities[number][0];
const priorityMetrics: Record<OverviewPriority, DashboardWidgetId[]> = {
  sales: ['net_revenue','transactions','average_order_value'], profit: ['gross_profit','gross_margin','operating_profit'],
  cash: ['cash_balance','cash_flow'], collect: ['cash_balance','net_revenue'], bills: ['cash_flow','operating_profit'],
  stock: ['inventory_value','units_sold','gross_margin'],
};
export function recommendedOverview(industry: string | null | undefined, priorities: readonly OverviewPriority[] = []): DashboardPreferences {
  const base = applyIndustryKpis(dashboardPreferencePreset(), industry);
  const requested = priorities.flatMap(priority => priorityMetrics[priority] ?? []);
  const selected = [...new Set([...requested, ...base.widgets.filter(w => w.visible).map(w => w.id)])].slice(0,6);
  const order = [...selected, ...base.widgets.map(w => w.id).filter(id => !selected.includes(id))];
  return normalizeDashboardPreferences({...base, priorities, widgets: order.map(id => ({id, visible:selected.includes(id), size:'standard'})), sections:{...base.sections, collections: priorities.includes('collect') || priorities.includes('bills')}});
}

export type GoalDirection = 'higher' | 'lower';
export type GoalRule = { direction: GoalDirection; from: string; to: string; locationId: string | null; start?: number };
export function validDashboardDates(from: unknown, to: unknown): from is string {
  const valid = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
  return valid(from) && valid(to) && from <= to && Date.parse(to)-Date.parse(from) <= 365*86400000;
}
export function goalResult(actual: number | null, target: number | undefined, rule: GoalRule | undefined, scope: {from:string;to:string;locationId?:string|null;eligible:boolean}) {
  const empty = (status:string) => ({status, progress:null as number|null, visual:0, complete:false});
  if(target === undefined || !Number.isFinite(target) || target<=0) return empty('Target not set');
  if(!rule || !validDashboardDates(rule.from,rule.to)) return empty('Choose target dates');
  if(rule.from!==scope.from || scope.to>rule.to || scope.to<rule.from || (rule.locationId??null)!==(scope.locationId??null)) return empty('Outside goal dates or location');
  if(actual===null || !Number.isFinite(actual) || !scope.eligible) return empty('Awaiting eligible records');
  const lower=rule.direction==='lower', attained=lower?actual<=target:actual>=target, complete=attained&&(!lower||scope.to===rule.to);
  const progress=lower?(rule.start!==undefined&&rule.start>target?(rule.start-actual)/(rule.start-target)*100:null):actual/target*100;
  return {status:complete?(lower?'At or below target':actual>target?'Target exceeded':'Target reached'):lower&&attained?'Within target so far':'In progress',progress,visual:progress===null?(complete?100:0):Math.max(0,Math.min(100,progress)),complete};
}

// Envelope IDs always come from the authenticated server context, never the client.
export function workspaceDashboardJson(value:string|null|undefined, organizationId:string): DashboardPreferences {
  try { const parsed=JSON.parse(value??'{}'); return normalizeDashboardPreferences(parsed.workspaceId===organizationId?parsed.dashboard:null); }
  catch { return dashboardPreferencePreset(); }
}
