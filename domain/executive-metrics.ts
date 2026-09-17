import { parseCommercePeriod, shiftCommerceDate } from "./commerce-intelligence";

export const executiveDefinitions = [
  { key: "net_revenue", label: "Net Revenue", formula: "Net sales after recorded discounts and returns, excluding sales tax.", unit: "money" },
  { key: "gross_profit", label: "Gross Profit", formula: "Net revenue minus recorded cost of goods sold. Missing costs remain unavailable.", unit: "money" },
  { key: "gross_margin", label: "Gross Margin", formula: "Gross profit divided by positive net revenue.", unit: "percent" },
  { key: "operating_profit", label: "Operating Profit", formula: "Operating revenue minus COGS and operating expenses, before finance costs and income tax.", unit: "money" },
  { key: "net_margin", label: "Net Profit Margin", formula: "Recorded net earnings after posted finance costs and income tax divided by positive ledger revenue. Unposted adjustments are not estimated.", unit: "percent" },
  { key: "cash_balance", label: "Cash Balance", formula: "Recorded cash account balance at the selected period end. Credit limits are excluded.", unit: "money" },
  { key: "cash_flow", label: "Cash Flow", formula: "Posted cash-account debits minus credits within the selected period. Internal transfers net to zero.", unit: "money" },
  { key: "inventory_value", label: "Inventory Value", formula: "Recorded inventory at cost at period end. Never summed across dates.", unit: "money" },
] as const;
export type ExecutiveKey = typeof executiveDefinitions[number]["key"];
export type ExecutivePeriod = ReturnType<typeof executivePeriod>;
export function executivePeriod(params: URLSearchParams, today: string) {
  const preset = params.get("period") ?? "30d";
  const comparison = params.get("compare") ?? "previous";
  if (!["today", "7d", "30d", "mtd", "qtd", "ytd", "custom"].includes(preset) || !["previous", "yoy", "budget", "target"].includes(comparison)) throw new Error("Choose a supported reporting period and comparison.");
  let from = shiftCommerceDate(today, -29), to = today;
  if (preset === "today") from = today;
  if (preset === "7d") from = shiftCommerceDate(today, -6);
  if (preset === "mtd") from = today.slice(0,7) + "-01";
  if (preset === "qtd") from = today.slice(0,4) + "-" + String(Math.floor((Number(today.slice(5,7)) - 1) / 3) * 3 + 1).padStart(2,"0") + "-01";
  if (preset === "ytd") from = today.slice(0,4) + "-01-01";
  if (preset === "custom") { from = params.get("from") ?? ""; to = params.get("to") ?? ""; }
  const period = parseCommercePeriod(from,to,today);
  if (period.days > 366 || to > today) throw new Error("Choose up to 366 days ending today or earlier.");
  const priorYear = (date: string) => { const year = Number(date.slice(0,4))-1; const month=Number(date.slice(5,7)); const day=Math.min(Number(date.slice(8)),new Date(Date.UTC(year,month,0)).getUTCDate()); return `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`; };
  return { ...period, ...(comparison === "yoy" ? { comparisonFrom:priorYear(from), comparisonTo:priorYear(to), comparisonToExclusive:shiftCommerceDate(priorYear(to),1) } : {}), preset, comparison };
}
export function exactSum(values: readonly number[]) { const total=values.reduce((sum,value)=>{if(!Number.isSafeInteger(value))throw Error("Amounts must use exact integer cents.");return sum+BigInt(value);},BigInt(0)); if(total>BigInt(Number.MAX_SAFE_INTEGER)||total<BigInt(Number.MIN_SAFE_INTEGER))throw Error("Amount exceeds safe precision.");return Number(total); }
export const changePercent = (current:number|null,previous:number|null) => current===null||previous===null||previous===0 ? null : (current-previous)/Math.abs(previous)*100;
export const positiveRatio = (n:number,d:number) => d>0 ? n/d : null;
export type ExecutiveLedgerRow = { id:string; name:string; accountType:string; accountSubtype:string; systemKey:string|null; debitCents:number; creditCents:number };
const cashKeys=new Set(["operating_cash","cash","bank","cash_equivalents"]);
const financeKeys=new Set(["interest_expense","finance_cost","finance_costs","income_tax","income_tax_expense"]);
export function ledgerIntelligence(accounts: readonly ExecutiveLedgerRow[]) {
  const value=(row:ExecutiveLedgerRow)=>exactSum([row.debitCents,-row.creditCents]);
  const selected=(predicate:(row:ExecutiveLedgerRow)=>boolean, sign=1)=>exactSum(accounts.filter(predicate).map(row=>sign*value(row)));
  const key=(row:ExecutiveLedgerRow)=>row.systemKey??row.accountSubtype;
  const revenue=selected(row=>row.accountType==="revenue",-1), expenses=selected(row=>row.accountType==="expense");
  const otherIncome=selected(row=>row.accountType==="revenue"&&["other_income","non_operating_income","interest_income"].includes(key(row)),-1);
  const cogs=selected(row=>row.accountType==="expense"&&["cost_of_goods_sold","cogs"].includes(key(row)));
  const financeAndTax=selected(row=>row.accountType==="expense"&&financeKeys.has(key(row)));
  const operatingRevenue=exactSum([revenue,-otherIncome]), operatingExpenses=exactSum([expenses,-cogs,-financeAndTax]);
  const assets=selected(row=>row.accountType==="asset"), liabilities=selected(row=>row.accountType==="liability",-1), contributedEquity=selected(row=>row.accountType==="equity",-1);
  const cash=selected(row=>row.accountType==="asset"&&(cashKeys.has(key(row))||["bank","cash"].includes(row.accountSubtype)));
  const inventory=selected(row=>row.accountType==="asset"&&["inventory","inventory_asset"].includes(key(row)));
  const currentAssetKeys=new Set([...cashKeys,"accounts_receivable","inventory","inventory_asset","prepaid_expenses","gst_recoverable","short_term_investments"]);
  const currentLiabilityKeys=new Set(["accounts_payable","gst_collected","sales_tax_payable","payroll_payable","credit_card","current_loan","current_portion_debt"]);
  const balanceAccounts=accounts.filter(row=>["asset","liability"].includes(row.accountType)&&value(row)!==0);
  const classified=balanceAccounts.every(row=>currentAssetKeys.has(key(row))||currentLiabilityKeys.has(key(row))||["current_asset","non_current_asset","fixed_asset","current_liability","non_current_liability","long_term_liability"].includes(row.accountSubtype));
  const currentAssets=selected(row=>row.accountType==="asset"&&(currentAssetKeys.has(key(row))||row.accountSubtype==="current_asset"));
  const currentLiabilities=selected(row=>row.accountType==="liability"&&(currentLiabilityKeys.has(key(row))||row.accountSubtype==="current_liability"),-1);
  const quickAssets=selected(row=>row.accountType==="asset"&&(cashKeys.has(key(row))||key(row)==="accounts_receivable"||key(row)==="short_term_investments"));
  const netProfit=exactSum([revenue,-expenses]);
  const gstCollected=selected(row=>row.accountType==="liability"&&key(row)==="gst_collected",-1),gstRecoverable=selected(row=>row.accountType==="asset"&&key(row)==="gst_recoverable");
  return { revenueCents:revenue,operatingRevenueCents:operatingRevenue,cogsCents:cogs,grossProfitCents:exactSum([operatingRevenue,-cogs]),operatingExpensesCents:operatingExpenses,operatingProfitCents:exactSum([operatingRevenue,-cogs,-operatingExpenses]),financeAndTaxCents:financeAndTax,otherIncomeCents:otherIncome,netProfitCents:netProfit,netMargin:positiveRatio(netProfit,revenue),cashCents:cash,inventoryCents:inventory,assetsCents:assets,liabilitiesCents:liabilities,equityCents:exactSum([contributedEquity,netProfit]),balanceDifferenceCents:exactSum([assets,-liabilities,-contributedEquity,-netProfit]),workingCapitalCents:classified?exactSum([currentAssets,-currentLiabilities]):null,currentRatio:classified?positiveRatio(currentAssets,currentLiabilities):null,quickRatio:classified?positiveRatio(quickAssets,currentLiabilities):null,classificationComplete:classified,gstCollectedCents:gstCollected,gstRecoverableCents:gstRecoverable,gstNetCents:exactSum([gstCollected,-gstRecoverable]),expenseCategories:accounts.filter(row=>row.accountType==="expense").map(row=>({name:row.name,cents:value(row)})).sort((a,b)=>b.cents-a.cents) };
}

export type CashClassificationRow = ExecutiveLedgerRow & { entryId:string };
/** Classify only journals whose non-cash side has one explicit activity type. Mixed journals require review. */
export function classifyCashMovements(rows:readonly CashClassificationRow[]) {
  const totals={operating:0,investing:0,financing:0,unclassified:0};
  const entries=new Map<string,CashClassificationRow[]>();
  for(const row of rows)entries.set(row.entryId,[...(entries.get(row.entryId)??[]),row]);
  for(const entry of entries.values()){
    const isCash=(r:CashClassificationRow)=>r.accountType==="asset"&&(cashKeys.has(r.systemKey??r.accountSubtype)||["bank","cash"].includes(r.accountSubtype));
    const cash=exactSum(entry.filter(isCash).map(r=>exactSum([r.debitCents,-r.creditCents])));
    if(!cash)continue;
    const types=new Set(entry.filter(r=>!isCash(r)&&(r.debitCents!==r.creditCents)).map(r=>{
      const key=r.systemKey??r.accountSubtype;
      if(["interest_expense","interest_income","dividend_income","income_tax","income_tax_expense"].includes(key))return "unclassified" as const;
      if(r.accountType==="equity"||["loan","long_term_debt","current_loan","current_portion_debt","dividends"].includes(key))return "financing" as const;
      if(["fixed_asset","non_current_asset","investment"].includes(r.accountSubtype))return "investing" as const;
      if(["revenue","expense"].includes(r.accountType)||["accounts_receivable","accounts_payable","inventory","inventory_asset","gst_collected","gst_recoverable","payroll_payable","prepaid_expenses"].includes(key))return "operating" as const;
      return "unclassified" as const;
    }));
    const category=types.size===1?[...types][0]:"unclassified";
    totals[category]=exactSum([totals[category],cash]);
  }
  return {...totals,total:exactSum(Object.values(totals))};
}
export function agingBuckets(items:readonly {dueDate:string;totalCents:number;paidCents:number;status:string}[],asOf:string) { const buckets=[{label:"Not due",cents:0},{label:"1–30 days",cents:0},{label:"31–60 days",cents:0},{label:"61–90 days",cents:0},{label:"90+ days",cents:0}]; for(const row of items){if(["draft","void","cancelled","paid","written_off"].includes(row.status))continue;const amount=Math.max(0,exactSum([row.totalCents,-row.paidCents]));const days=Math.floor((Date.parse(asOf+"T00:00:00Z")-Date.parse(row.dueDate+"T00:00:00Z"))/86400000);if(!Number.isFinite(days))throw Error("Aging requires valid due dates.");const index=days<=0?0:days<=30?1:days<=60?2:days<=90?3:4;buckets[index].cents=exactSum([buckets[index].cents,amount]);}return buckets; }
