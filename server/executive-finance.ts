import { getD1 } from "../db";
import { ledgerIntelligence, agingBuckets, exactSum, classifyCashMovements, type CashClassificationRow, type ExecutivePeriod, type ExecutiveLedgerRow } from "../domain/executive-metrics";

type Aggregate = ExecutiveLedgerRow & { previousDebit:number; previousCredit:number; closingDebit:number; closingCredit:number; previousClosingDebit:number; previousClosingCredit:number; currentCount:number; previousCount:number; lastPostedAt:number|null };
/** Called only after add-on, organization scope and full-ledger permission checks. */
export async function loadExecutiveFinance(organizationId:string,currency:string,period:ExecutivePeriod,today:string,canIdentifyContacts:boolean) {
  const db=getD1();
  const settings=await db.prepare("SELECT data_mode mode,status,base_currency currency FROM bookloq_settings WHERE organization_id=?").bind(organizationId).first<{mode:string;status:string;currency:string}>();
  if(settings?.mode==="demonstration"||settings?.status!=="active"||settings.currency!==currency)return null;
  const aggregates=await db.prepare(`SELECT a.id,a.name,a.account_type accountType,a.account_subtype accountSubtype,a.system_key systemKey,
    COALESCE(SUM(CASE WHEN e.entry_date BETWEEN ? AND ? THEN l.debit_cents ELSE 0 END),0) debitCents,
    COALESCE(SUM(CASE WHEN e.entry_date BETWEEN ? AND ? THEN l.credit_cents ELSE 0 END),0) creditCents,
    COALESCE(SUM(CASE WHEN e.entry_date BETWEEN ? AND ? THEN l.debit_cents ELSE 0 END),0) previousDebit,
    COALESCE(SUM(CASE WHEN e.entry_date BETWEEN ? AND ? THEN l.credit_cents ELSE 0 END),0) previousCredit,
    COALESCE(SUM(CASE WHEN e.entry_date<=? THEN l.debit_cents ELSE 0 END),0) closingDebit,
    COALESCE(SUM(CASE WHEN e.entry_date<=? THEN l.credit_cents ELSE 0 END),0) closingCredit,
    COALESCE(SUM(CASE WHEN e.entry_date<=? THEN l.debit_cents ELSE 0 END),0) previousClosingDebit,
    COALESCE(SUM(CASE WHEN e.entry_date<=? THEN l.credit_cents ELSE 0 END),0) previousClosingCredit,
    COUNT(CASE WHEN e.entry_date BETWEEN ? AND ? THEN e.id END) currentCount,
    COUNT(CASE WHEN e.entry_date BETWEEN ? AND ? THEN e.id END) previousCount, MAX(e.posted_at) lastPostedAt
    FROM financial_accounts a LEFT JOIN journal_lines l ON l.account_id=a.id AND l.organization_id=a.organization_id
    LEFT JOIN journal_entries e ON e.id=l.journal_entry_id AND e.organization_id=a.organization_id AND e.status IN ('posted','reversed') AND e.currency=? AND e.entry_date<=?
    WHERE a.organization_id=? GROUP BY a.id ORDER BY a.code LIMIT 2001`).bind(period.from,period.to,period.from,period.to,period.comparisonFrom,period.comparisonTo,period.comparisonFrom,period.comparisonTo,period.to,period.to,period.comparisonTo,period.comparisonTo,period.from,period.to,period.comparisonFrom,period.comparisonTo,currency,period.to,organizationId).all<Aggregate>();
  if((aggregates.results?.length??0)>2000)throw Error("The ledger exceeds this overview's account limit. Use the detailed reports.");
  const rows=aggregates.results??[],current=ledgerIntelligence(rows),previous=ledgerIntelligence(rows.map(r=>({...r,debitCents:r.previousDebit,creditCents:r.previousCredit}))),closing=ledgerIntelligence(rows.map(r=>({...r,debitCents:r.closingDebit,creditCents:r.closingCredit}))),previousClosing=ledgerIntelligence(rows.map(r=>({...r,debitCents:r.previousClosingDebit,creditCents:r.previousClosingCredit})));
  const currentCount=exactSum(rows.map(r=>r.currentCount)),previousCount=exactSum(rows.map(r=>r.previousCount));
  const hasLedger=rows.some(r=>r.closingDebit!==0||r.closingCredit!==0);
  if(!hasLedger)return null;
  const trend=await db.prepare(`SELECT e.entry_date date, SUM(CASE WHEN a.account_type='revenue' THEN l.credit_cents-l.debit_cents ELSE 0 END) revenueCents, SUM(CASE WHEN a.account_type='expense' THEN l.debit_cents-l.credit_cents ELSE 0 END) expenseCents,
    SUM(CASE WHEN a.account_type='asset' AND (a.system_key IN ('operating_cash','cash','bank','cash_equivalents') OR a.account_subtype IN ('bank','cash')) THEN l.debit_cents-l.credit_cents ELSE 0 END) cashFlowCents
    FROM journal_entries e JOIN journal_lines l ON l.journal_entry_id=e.id AND l.organization_id=e.organization_id JOIN financial_accounts a ON a.id=l.account_id AND a.organization_id=e.organization_id
    WHERE e.organization_id=? AND e.currency=? AND e.status IN ('posted','reversed') AND e.entry_date BETWEEN ? AND ? GROUP BY e.entry_date ORDER BY e.entry_date`).bind(organizationId,currency,period.from,period.to).all<{date:string;revenueCents:number;expenseCents:number;cashFlowCents:number}>();
  const budgets=await db.prepare(`SELECT a.id,a.account_type accountType,a.account_subtype accountSubtype,a.system_key systemKey,a.name,SUM(b.budget_cents) amount FROM bookloq_budgets b JOIN financial_accounts a ON a.id=b.account_id AND a.organization_id=b.organization_id WHERE b.organization_id=? AND b.period_start=? AND b.period_end=? AND b.location_ref IN ('','all') AND COALESCE(b.department_ref,'') IN ('','all') GROUP BY a.id`).bind(organizationId,period.from,period.to).all<ExecutiveLedgerRow&{amount:number}>();
  const budgetRows=budgets.results??[];
  const planned=ledgerIntelligence(budgetRows.map(r=>({...r,debitCents:r.accountType==="expense"?r.amount:0,creditCents:r.accountType==="revenue"?r.amount:0})));
  const budgetComplete=rows.filter(r=>["revenue","expense"].includes(r.accountType)&&(r.debitCents!==0||r.creditCents!==0)).every(r=>budgetRows.some(b=>b.id===r.id));
  const aging=async(table:"supplier_bills"|"customer_invoices")=> {
    if(period.to!==today)return null;
    const result=await db.prepare(`SELECT due_date dueDate,SUM(total_cents) totalCents,SUM(paid_cents) paidCents,status FROM ${table} WHERE organization_id=? AND currency=? AND demo_record=0 AND status NOT IN ('draft','void','cancelled','paid','written_off') GROUP BY due_date,status LIMIT 5001`).bind(organizationId,currency).all<{dueDate:string;totalCents:number;paidCents:number;status:string}>();
    return (result.results?.length??0)>5000?null:agingBuckets(result.results??[],today);
  };
  const [receivables,payables,vendors]=await Promise.all([aging("customer_invoices"),aging("supplier_bills"),canIdentifyContacts?db.prepare(`SELECT COALESCE(c.name,'Unassigned supplier') name,SUM(l.debit_cents-l.credit_cents) cents FROM journal_lines l JOIN journal_entries e ON e.id=l.journal_entry_id AND e.organization_id=l.organization_id JOIN financial_accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id LEFT JOIN bookloq_contacts c ON c.id=l.contact_id AND c.organization_id=l.organization_id WHERE l.organization_id=? AND e.currency=? AND e.status IN ('posted','reversed') AND a.account_type='expense' AND e.entry_date BETWEEN ? AND ? GROUP BY COALESCE(c.name,'Unassigned supplier') ORDER BY cents DESC LIMIT 100`).bind(organizationId,currency,period.from,period.to).all<{name:string;cents:number}>():Promise.resolve({results:[] as {name:string;cents:number}[]})]);
  const cashFlowCents=current.cashCents;
  const cashRows=await db.prepare(`SELECT e.id entryId,e.entry_date date,a.id,a.name,a.account_type accountType,a.account_subtype accountSubtype,a.system_key systemKey,l.debit_cents debitCents,l.credit_cents creditCents FROM journal_entries e JOIN journal_lines l ON l.journal_entry_id=e.id AND l.organization_id=e.organization_id JOIN financial_accounts a ON a.id=l.account_id AND a.organization_id=e.organization_id WHERE e.organization_id=? AND e.currency=? AND e.status IN ('posted','reversed') AND e.entry_date BETWEEN ? AND ? ORDER BY e.id LIMIT 20001`).bind(organizationId,currency,period.from,period.to).all<CashClassificationRow & {date:string}>();
  const cashClassification=(cashRows.results?.length??0)>20000?null:classifyCashMovements(cashRows.results??[]);
  const dailyGroups=new Map<string,(CashClassificationRow & {date:string})[]>();
  if((cashRows.results?.length??0)<=20000)for(const row of cashRows.results??[]){const group=dailyGroups.get(row.date)??[];group.push(row);dailyGroups.set(row.date,group);}
  let cashBalance=exactSum([closing.cashCents,-current.cashCents]),inventoryBalance=exactSum([closing.inventoryCents,-current.inventoryCents]);
  const dailyLedger=[...dailyGroups].sort(([a],[b])=>a.localeCompare(b)).map(([date,lines])=>{const totals=ledgerIntelligence(lines);cashBalance=exactSum([cashBalance,totals.cashCents]);inventoryBalance=exactSum([inventoryBalance,totals.inventoryCents]);return {date,...totals,cashBalanceCents:cashBalance,inventoryBalanceCents:inventoryBalance,hasCosts:lines.some(r=>['cost_of_goods_sold','cogs'].includes(r.systemKey??r.accountSubtype))};});
  const accountCoverage={cash:rows.some(r=>(r.closingDebit!==0||r.closingCredit!==0)&&(['operating_cash','cash','bank','cash_equivalents'].includes(r.systemKey??r.accountSubtype)||['bank','cash'].includes(r.accountSubtype))),inventory:rows.some(r=>(r.closingDebit!==0||r.closingCredit!==0)&&['inventory','inventory_asset'].includes(r.systemKey??r.accountSubtype)),costs:rows.some(r=>['cost_of_goods_sold','cogs'].includes(r.systemKey??r.accountSubtype)&&(r.debitCents!==0||r.creditCents!==0)),previousCosts:rows.some(r=>['cost_of_goods_sold','cogs'].includes(r.systemKey??r.accountSubtype)&&(r.previousDebit!==0||r.previousCredit!==0))};
  const monthlyBurnCents=currentCount>0&&cashFlowCents<0?Math.round(-cashFlowCents/period.days*30.4375):null;
  return {dailyLedger,cashClassification,accountCoverage,current:currentCount?current:null,previous:previousCount?previous:null,closing,previousClosing,trend:trend.results??[],budget:budgetRows.length&&budgetComplete?planned:null,receivables,payables,vendors:vendors.results??[],monthlyBurnCents,runwayMonths:monthlyBurnCents&&closing.cashCents>=0?closing.cashCents/monthlyBurnCents:null,lastPostedAt:Math.max(0,...rows.map(r=>r.lastPostedAt??0))||null,currentCount,previousCount,
    boundary:"Posted ledger records only. Confirm account classification, completeness and tax adjustments with your accountant. POS revenue and ledger profit have different source bases. Cash burn uses net recorded cash movement, not an operating-only forecast.",
    agingBoundary:period.to===today?"Current unpaid invoice and bill balances, grouped by due date.":"Historical aging requires a payment allocation history; current balances are not backdated."};
}
