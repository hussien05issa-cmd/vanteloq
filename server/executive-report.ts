import { changePercent, executiveDefinitions, type ExecutiveKey, type ExecutivePeriod } from "../domain/executive-metrics";
import type { loadExecutiveFinance } from "./executive-finance";
import type { MetricResult } from "./data-trust";

type Finance = Awaited<ReturnType<typeof loadExecutiveFinance>>;
type Sales = {
  metrics:Record<string,MetricResult>; previous:{netSalesCents:number|null;grossProfitCents:number|null;grossMarginRate:number|null}|null;
  trend:{date:string;netSalesCents:number;grossProfitCents:number|null;inventoryValueCents?:number|null}[];
  reportingPeriod?:{comparable:boolean;previousInventoryValueCents?:number|null};
  insights:{id:string;title:string;whatHappened:string;probableCause:string;financialImpact:string;recommendedAction:string;confidence:string}[];
};
export function buildExecutiveReport(period:ExecutivePeriod,sales:Sales,finance:Finance,financeReason:string|null,basis:"commerce"|"ledger") {
  const f=finance?.current,p=finance?.previous;
  const moneyValues=(v:typeof f):Partial<Record<ExecutiveKey,number|null>>=>v?{net_revenue:v.operatingRevenueCents,gross_profit:v.grossProfitCents,gross_margin:v.operatingRevenueCents>0?v.grossProfitCents/v.operatingRevenueCents:null,operating_profit:v.operatingProfitCents,net_margin:v.netMargin,cash_flow:v.cashCents}:{};
  const ledger=moneyValues(f),prior=moneyValues(p),plan=moneyValues(finance?.budget??null);
  const fromSales:Partial<Record<ExecutiveKey,string>>={net_revenue:"net_sales",gross_profit:"gross_profit",gross_margin:"gross_margin",inventory_value:"inventory_value"};
  const priorSales={net_revenue:sales.previous?.netSalesCents??null,gross_profit:sales.previous?.grossProfitCents??null,gross_margin:sales.previous?.grossMarginRate??null,inventory_value:sales.reportingPeriod?.previousInventoryValueCents??null};
  const lastPosted=finance?.lastPostedAt;
  const updatedAt=lastPosted?new Date(lastPosted<1e12?lastPosted*1000:lastPosted).toISOString():null;
  const metrics=executiveDefinitions.map(def=>{
    const useSales=basis==="commerce"&&def.key in fromSales;
    const metric=useSales?sales.metrics[fromSales[def.key]!]:undefined;
    let value:number|null=useSales?(metric?.actuality==="actual"?metric.value:null):ledger[def.key]??null;
    let previous:number|null=useSales?(sales.reportingPeriod?.comparable&&def.key in priorSales?priorSales[def.key as keyof typeof priorSales]:null):prior[def.key]??null;
    let reason=useSales?"Verified source records are needed for this period.":financeReason??"Post and review the ledger for this period.";
    if(!useSales&&def.key==="cash_balance"){value=finance?.accountCoverage.cash?finance.closing.cashCents:null;previous=finance?.accountCoverage.cash&&finance.previousCount?finance.previousClosing.cashCents:null;}
    if(!useSales&&def.key==="inventory_value"){value=finance?.accountCoverage.inventory?finance.closing.inventoryCents:null;previous=finance?.accountCoverage.inventory&&finance.previousCount?finance.previousClosing.inventoryCents:null;}
    if(!useSales&&["gross_profit","gross_margin","operating_profit","net_margin"].includes(def.key)&&!finance?.accountCoverage.costs){value=null;reason=financeReason??"Recorded product costs are needed before showing profit.";}
    if(!useSales&&["gross_profit","gross_margin","operating_profit","net_margin"].includes(def.key)&&!finance?.accountCoverage.previousCosts)previous=null;
    if(!useSales&&def.key==="cash_flow"&&!finance?.accountCoverage.cash)value=null;
    const target=!useSales&&value!==null?plan[def.key]??null:null;
    const trend=useSales?sales.trend.map(row=>({date:row.date,value:def.key==="net_revenue"?row.netSalesCents:def.key==="gross_profit"?row.grossProfitCents:def.key==="inventory_value"?row.inventoryValueCents??null:def.key==="gross_margin"&&row.netSalesCents>0&&row.grossProfitCents!==null?row.grossProfitCents/row.netSalesCents:null})):finance?.dailyLedger.map(row=>({date:row.date,value:def.key==="cash_flow"?row.cashCents:def.key==="cash_balance"?row.cashBalanceCents:def.key==="inventory_value"?row.inventoryBalanceCents:def.key==="net_revenue"?row.operatingRevenueCents:!row.hasCosts?null:def.key==="gross_profit"?row.grossProfitCents:def.key==="gross_margin"&&row.operatingRevenueCents>0?row.grossProfitCents/row.operatingRevenueCents:def.key==="operating_profit"?row.operatingProfitCents:def.key==="net_margin"?row.netMargin:null}))??[];
    return {...def,value,previous,change:changePercent(value,previous),budget:target,budgetVariance:value!==null&&target!==null?value-target:null,source:useSales?(metric?.sourceSystem??"Sales records"):"BookLoQ posted ledger",sourceTimestamp:useSales?(metric?.sourceTimestamp??null):updatedAt,confidence:value===null?"unavailable":useSales?(metric?.confidenceLevel??"low"):"Recorded, not audited",limitations:useSales?(metric?.limitations??[reason]):[finance?.boundary??reason],reason:value===null?reason:null,trend:value===null?[]:trend,drill:useSales?"Sales":"BookLoQ"} as const;
  });
  return {period,basis,metrics,finance,financeReason,insights:sales.insights,sourceCoverage:sales.reportingPeriod?.comparable===true,generatedAt:new Date().toISOString()};
}
export type ExecutiveReport=ReturnType<typeof buildExecutiveReport>;
