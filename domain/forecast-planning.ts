import {forecastDate, shiftForecastDate} from "./forecasting";
export type PromotionLine={key:string;name:string;baselineUnits:number;scenarioUnits:number;priceCents:number;discountPercent:number;costCents:number|null;variableCents:number|null};
export type PromotionPlan={from:string;to:string;location:string;channel:string;lines:PromotionLine[];advertisingCents:number|null;staffingCents:number|null;otherCents:number|null;displacedContributionCents:number|null;deferredContributionCents:number|null};
function cents(n:number|null){if(n!==null&&(!Number.isSafeInteger(n)||n<0||n>1e12))throw new Error("Enter whole, non-negative minor currency units within the supported limit.");}
function bounded(n:number|null,name:string,nullable=true) {if(n===null&&nullable)return;if(n===null||!Number.isFinite(n)||n<0||n>1e12)throw new Error(`Enter a valid non-negative ${name}.`);}
export function promotionScenario(p:PromotionPlan) {
  if(!forecastDate(p.from)||!forecastDate(p.to)||p.to<p.from||p.to>shiftForecastDate(p.from,27))throw new Error("Choose a promotion lasting one to 28 days.");
  if(!p.location.trim()||!p.channel.trim()||!p.lines.length||p.lines.length>30||new Set(p.lines.map(l=>l.key)).size!==p.lines.length)throw new Error("Choose a scope and distinct products or categories.");
  const extra=[p.advertisingCents,p.staffingCents,p.otherCents,p.displacedContributionCents,p.deferredContributionCents];extra.forEach(cents);
  const lines=p.lines.map(l=>{
    [l.baselineUnits,l.scenarioUnits,l.priceCents,l.discountPercent].forEach(x=>bounded(x,"product input",false));bounded(l.costCents,"unit cost");bounded(l.variableCents,"variable cost");
    if(l.discountPercent>100)throw new Error("Discount must be between zero and 100%.");
    [l.priceCents,l.costCents,l.variableCents].forEach(cents);
    const price=Math.round(l.priceCents*(1-l.discountPercent/100));
    if(!Number.isSafeInteger(Math.round(l.baselineUnits*l.priceCents))||!Number.isSafeInteger(Math.round(l.scenarioUnits*l.priceCents))||[l.costCents,l.variableCents].some(c=>c!==null&&(!Number.isSafeInteger(Math.round(c*l.baselineUnits))||!Number.isSafeInteger(Math.round(c*l.scenarioUnits)))))throw new Error("The scenario exceeds supported monetary precision.");
    const baselineSales=Math.round(l.baselineUnits*l.priceCents),sales=Math.round(l.scenarioUnits*price);
    const baselineGross=l.costCents===null?null:baselineSales-Math.round(l.baselineUnits*l.costCents),gross=l.costCents===null?null:sales-Math.round(l.scenarioUnits*l.costCents);
    const baselineContribution=baselineGross===null||l.variableCents===null?null:baselineGross-Math.round(l.baselineUnits*l.variableCents),contribution=gross===null||l.variableCents===null?null:gross-Math.round(l.scenarioUnits*l.variableCents);
    return {...l,scenarioPriceCents:price,baselineSalesCents:baselineSales,scenarioSalesCents:sales,baselineGrossCents:baselineGross,scenarioGrossCents:gross,baselineContributionCents:baselineContribution,scenarioContributionCents:contribution};
  });
  const sum=(k:"baselineSalesCents"|"scenarioSalesCents"|"baselineGrossCents"|"scenarioGrossCents"|"baselineContributionCents"|"scenarioContributionCents")=>lines.every(l=>l[k]!==null)?lines.reduce((s,l)=>s+l[k]!,0):null;
  const baselineContribution=sum("baselineContributionCents"),incrementalCosts=extra.every(x=>x!==null)?extra.reduce<number>((s,x)=>s+x!,0):null;
  const after=sum("scenarioContributionCents")===null||incrementalCosts===null?null:sum("scenarioContributionCents")!-incrementalCosts;
  const cm=lines.length===1&&lines[0].costCents!==null&&lines[0].variableCents!==null?lines[0].scenarioPriceCents-lines[0].costCents!-lines[0].variableCents!:null;
  return {mode:"Owner-entered what-if scenario" as const,lines,baseline:{units:lines.reduce((s,l)=>s+l.baselineUnits,0),salesCents:sum("baselineSalesCents")!,grossCents:sum("baselineGrossCents"),contributionCents:baselineContribution},scenario:{units:lines.reduce((s,l)=>s+l.scenarioUnits,0),salesCents:sum("scenarioSalesCents")!,grossCents:sum("scenarioGrossCents"),contributionCents:after},differenceCents:after===null||baselineContribution===null?null:after-baselineContribution,preserveContributionUnits:cm!==null&&cm>0&&baselineContribution!==null&&incrementalCosts!==null?Math.ceil((baselineContribution+incrementalCosts)/cm):null,standaloneBreakEvenUnits:cm!==null&&cm>0&&incrementalCosts!==null?Math.ceil(incrementalCosts/cm):null,reason:after===null?"Complete product, selling and promotion costs to calculate contribution. Enter zero only when a cost does not apply.":cm!==null&&cm<=0?"The discounted unit contribution is not positive. More volume will not recover promotion costs.":after<baselineContribution!?"Contribution is lower than the baseline under these assumptions.":"Review stock, workload and cash timing before acting.",boundary:"Unit assumptions are editable, not learned uplift. Displacement and deferred purchases are explicit costs. A later before-and-after change is not causal proof. Tax and cash timing remain separate."};
}
export type InventoryPlan={start:string;units:number;reserved:number|null;demand:{date:string;units:number}[];receipts:{id:string;date:string;units:number}[];lots:{id:string;units:number;expires:string|null}[];pack:number;minimumUnits:number;minimumSpendCents:number;unitCostCents:number|null;cashCents:number|null;storageUnits:number|null;leadDays:number;bufferUnits:number};
export function inventoryProjection(p:InventoryPlan) {
  if(!forecastDate(p.start)||!p.demand.length||p.demand.length>28)throw new Error("Enter one to 28 demand dates.");
  [p.units,p.reserved,p.pack,p.minimumUnits,p.minimumSpendCents,p.unitCostCents,p.cashCents,p.storageUnits,p.leadDays,p.bufferUnits].forEach(x=>bounded(x,"stock planning input"));
  if(p.pack<=0||!Number.isInteger(p.leadDays))throw new Error("Pack size must be positive and lead time must be whole days.");
  if(p.reserved===null)return {available:false as const,reason:"Review reserved stock before projecting availability.",days:[],reorderUnits:null,firstStockout:null,unmetUnits:null,expiredUnits:null};
  if(p.reserved>p.units)throw new Error("Reserved stock cannot exceed on-hand stock.");
  const demand=[...p.demand].sort((a,b)=>a.date.localeCompare(b.date));
  if(new Set(demand.map(d=>d.date)).size!==demand.length||demand.some(d=>!forecastDate(d.date)||d.date<p.start||d.date>shiftForecastDate(p.start,27)||!Number.isFinite(d.units)||d.units<0))throw new Error("Check the demand dates and quantities.");
  if(demand.some((d,i)=>d.date!==shiftForecastDate(p.start,i)))throw new Error("Enter demand for every date, including explicit zero-demand dates.");
  if(p.receipts.some(r=>!forecastDate(r.date)||!Number.isFinite(r.units)||r.units<0)||new Set(p.receipts.map(r=>r.id)).size!==p.receipts.length)throw new Error("Each delivery needs a unique identifier, date and quantity.");
  if(p.lots.some(l=>!Number.isFinite(l.units)||l.units<0||l.expires!==null&&!forecastDate(l.expires))||p.lots.reduce((s,l)=>s+l.units,0)>p.units)throw new Error("Lot quantities cannot exceed the stock balance.");
  const lots=p.lots.map(l=>({...l}));
  lots.push({id:"unallocated",units:p.units-p.lots.reduce((s,l)=>s+l.units,0),expires:null});
  lots.sort((a,b)=>(a.expires??"9999").localeCompare(b.expires??"9999"));
  let reserve=p.reserved;for(const l of lots){const take=Math.min(l.units,reserve);l.units-=take;reserve-=take;}
  let unmet=0,expired=0,firstStockout:string|null=null;
  const days=[];
  for(let date=p.start;date<=demand.at(-1)!.date;date=shiftForecastDate(date,1)) {
    const requested=demand.find(d=>d.date===date)?.units??0;
    for(const l of lots)if(l.expires&&l.expires<=date){expired+=l.units;l.units=0;}
    for(const r of p.receipts.filter(r=>r.date===date))lots.push({id:r.id,units:r.units,expires:null});
    lots.sort((a,b)=>(a.expires??"9999").localeCompare(b.expires??"9999"));
    let left=requested;for(const l of lots){const take=Math.min(l.units,left);l.units-=take;left-=take;}
    if(left>0&&firstStockout===null)firstStockout=date;unmet+=left;
    days.push({date,demand:requested,achievable:requested-left,unmet:left,closing:lots.reduce((s,l)=>s+l.units,0)});
  }
  const needed=Math.max(0,demand.reduce((s,d)=>s+d.units,0)+p.bufferUnits-Math.max(0,p.units-p.reserved-expired)-p.receipts.filter(r=>r.date>=p.start&&r.date<=demand.at(-1)!.date).reduce((s,r)=>s+r.units,0));
  const minimumCostUnits=p.unitCostCents!==null&&p.unitCostCents>0?p.minimumSpendCents/p.unitCostCents:0;
  const arrival=shiftForecastDate(p.start,p.leadDays);
  const timelyNeed=days.filter(d=>d.date>=arrival).reduce((sum,d)=>sum+d.unmet,0);
  const orderNeed=Math.max(needed,timelyNeed);
  const requested=orderNeed>0?Math.ceil(Math.max(orderNeed,p.minimumUnits,minimumCostUnits)/p.pack)*p.pack:0;
  const reasons:string[]=[];
  if(p.unitCostCents===null||p.cashCents===null||p.storageUnits===null)reasons.push("Review unit cost, purchasing cash and storage before a reorder quantity is suggested.");
  const cap=Math.min(p.storageUnits??0,p.unitCostCents===0?Infinity:(p.cashCents??0)/(p.unitCostCents??1));
  const capped=Math.min(requested,Math.floor(cap/p.pack)*p.pack);
  if(capped<requested)reasons.push("Purchasing cash or free storage headroom prevent covering the full demand assumption.");
  if(capped>0&&(capped<p.minimumUnits||capped*(p.unitCostCents??0)<p.minimumSpendCents))reasons.push("The affordable order does not meet the supplier minimum.");
  if(firstStockout&&firstStockout<shiftForecastDate(p.start,p.leadDays))reasons.push("Stock may run out before a new order could arrive.");
  return {available:true as const,reason:reasons.join(" ")||"Review the assumptions before creating a purchase order.",days,reorderUnits:reasons.some(r=>r.includes("Review unit cost")||r.includes("supplier minimum"))?null:capped,firstStockout,unmetUnits:unmet,expiredUnits:expired};
}
export function capacityPlan(input:{transactions:number;openHours:number;minimumStaff:number;transactionsPerStaffHour:number;fixedTaskHours:number}) {
  Object.values(input).forEach(x=>bounded(x,"capacity assumption",false));
  if(input.transactionsPerStaffHour<=0||input.openHours<=0)return null;
  return {staffHours:Math.ceil(Math.max(input.openHours*input.minimumStaff,input.transactions/input.transactionsPerStaffHour+input.fixedTaskHours)*10)/10,label:"Coverage to review",boundary:"Total staff-hours are not a shift schedule or peak-hour headcount. Productivity must exclude the fixed tasks added here. No employee performance assessment."};
}
