/** Versioned, deterministic planning mathematics. No cross-business training or AI predictions. */
export const FORECAST_MODEL_VERSION = "comparable-days-1.0";
export const forecastMetrics = ["transactions", "units", "netSalesCents"] as const;
export type ForecastMetric = typeof forecastMetrics[number];
export type ForecastDay = { date: string; status: "complete" | "missing" | "partial" | "closed"; transactions: number | null; units: number | null; netSalesCents: number | null; stockout?: boolean };
export type TradingDay = { open: boolean; from: string; to: string };
export type ForecastSettings = {
  hours: TradingDay[]; closures: string[]; unusualDates: string[]; zeroDates: string[];
  reviewedFrom: string; reviewedThrough: string; reviewedAt: string | null;
  regimeFrom: string; notes: string; stockAvailability: "unknown" | "reviewed";
};
export type ForecastLocation = { id: string; name: string; timezone: string; currency: string; settings: ForecastSettings; days: ForecastDay[]; sourceIds: string[]; sourceCutoff: string | null; blocked: string[] };
export function forecastDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const t = Date.parse(value + "T12:00:00Z");
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === value;
}
export function shiftForecastDate(date: string, count: number) { return new Date(Date.parse(date + "T12:00:00Z") + count * 86400000).toISOString().slice(0, 10); }
const weekday = (date: string) => new Date(date + "T12:00:00Z").getUTCDay();
export function defaultForecastSettings(): ForecastSettings { return { hours: [], closures: [], unusualDates: [], zeroDates: [], reviewedFrom: "", reviewedThrough: "", reviewedAt: null, regimeFrom: "", notes: "", stockAvailability: "unknown" }; }
export function normalizeForecastSettings(value: unknown): ForecastSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaultForecastSettings();
  const v = value as Record<string, unknown>, dates = (key: string) => {if(!Array.isArray(v[key]))return [];if(v[key].length>366||v[key].some(d=>!forecastDate(d)))throw new Error("Enter valid calendar dates in YYYY-MM-DD format, separated by commas.");return [...new Set(v[key] as string[])];};
  const clock = (s: unknown) => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
  const hours = Array.isArray(v.hours) && v.hours.length === 7 ? v.hours.map((h: Partial<TradingDay>) => {
    if (!h || typeof h !== "object" || typeof h.open !== "boolean" || !clock(h.from) || !clock(h.to) || (h.open && h.to! <= h.from!)) throw new Error("Enter valid same-day opening hours. Overnight trading requires separate daily evidence.");
    return {open: h.open, from: h.from!, to: h.to!};
  }) : [];
  return { hours, closures: dates("closures"), unusualDates: dates("unusualDates"), zeroDates: dates("zeroDates"), reviewedFrom: forecastDate(v.reviewedFrom) ? v.reviewedFrom : "", reviewedThrough: forecastDate(v.reviewedThrough) ? v.reviewedThrough : "", reviewedAt: typeof v.reviewedAt === "string" && Number.isFinite(Date.parse(v.reviewedAt)) ? v.reviewedAt : null, regimeFrom: forecastDate(v.regimeFrom) ? v.regimeFrom : "", notes: typeof v.notes === "string" ? v.notes.trim().slice(0, 1000) : "", stockAvailability: v.stockAvailability === "reviewed" ? "reviewed" : "unknown" };
}
export function tradingHours(settings: ForecastSettings, date: string): number | null {
  if (settings.closures.includes(date)) return 0;
  const h = settings.hours[weekday(date)];
  if (!h) return null;
  if (!h.open) return 0;
  const mins = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  return (mins(h.to) - mins(h.from)) / 60;
}
type Method = "seasonal-naive" | "comparable-day-mean";
const mean = (xs: number[]) => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
const round = (x: number) => Math.round(x * 100) / 100;
function quantile(xs: number[], p: number) { const s = [...xs].sort((a, b) => a - b), i = (s.length - 1) * p, lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); }
function predictor(history: ForecastDay[], metric: ForecastMetric, method: Method, settings: ForecastSettings,minimum=4) {
  const groups = new Map<string, number[]>(), unusual = new Set(settings.unusualDates);
  for (const d of history) {
    if (!["complete", "closed"].includes(d.status) || d.stockout || unusual.has(d.date) || d[metric] === null) continue;
    const key = `${weekday(d.date)}:${tradingHours(settings,d.date)}`;
    const values = groups.get(key) ?? []; values.push(d[metric]!); if(values.length>8)values.shift(); groups.set(key,values);
  }
  return (date:string):number|null => {
    const hours=tradingHours(settings,date);
    if(hours===0&&metric!=="netSalesCents")return 0;
    if(unusual.has(date))return null;
    const values=groups.get(`${weekday(date)}:${hours}`);if(!values||values.length<minimum)return null;
    const value=method==="seasonal-naive"?values.at(-1)!:mean(values);
    return metric==="netSalesCents"?Math.round(value):round(Math.max(0,value));
  };
}
export type ForecastEvaluation = { basis: string; origins: number; method: Method; mae: number | null; bias: number | null; mase: number | null; baselineMae: number | null; totalMae: number | null; calibrationOrigins: number; rangeCoverage: number | null; rangeWidth: number | null; rangeEvaluationOrigins: number; explanation: string };
type Origin = { index:number; targetEnd:number; predictions:number[]; errors: number[]; scale: number | null };
/** Origins advance a week. Training never contains the target dates; revised-history limits remain explicit. */
function evaluate(history: ForecastDay[], metric: ForecastMetric, horizon: number, settings: ForecastSettings) {
  const origins: Record<Method, Origin[]> = { "seasonal-naive": [], "comparable-day-mean": [] };
  for (let end = 27 + ((history.length - 1 - 27) % 7 + 7) % 7; end + horizon + 1 < history.length; end += 7) {
    // Forecasts start tomorrow from yesterday's closed history: preserve that one-day gap in evaluation.
    const training = history.slice(0, end + 1), target = history.slice(end + 2, end + 2 + horizon);
    if (target.some(d => !["complete", "closed"].includes(d.status) || d[metric] === null || d.stockout || settings.unusualDates.includes(d.date))) continue;
    const diffs = training.slice(7).flatMap((d, i) => d[metric] !== null && training[i][metric] !== null && ["complete", "closed"].includes(d.status) && ["complete", "closed"].includes(training[i].status) ? [Math.abs(d[metric]! - training[i][metric]!)] : []);
    const scale = mean(diffs) || null;
    const cache = new Map<Method,ReturnType<typeof predictor>>();
    const predictorCache=(method:Method)=>{if(!cache.has(method))cache.set(method,predictor(training,metric,method,settings));return cache.get(method)!;};
    const predictions = (["seasonal-naive", "comparable-day-mean"] as Method[]).map(method => ({method, values:target.map(d => predictorCache(method)(d.date))}));
    if (predictions.some(p => p.values.some(v => v === null))) continue;
    for (const p of predictions) origins[p.method].push({ index:end,targetEnd:end+1+horizon,predictions:p.values as number[],errors: p.values.map((v, i) => target[i][metric]! - v!), scale });
  }
  const n = origins["seasonal-naive"].length, proposedSelection = n >= 8 ? Math.max(4, Math.floor(n / 4)) : 0;
  const selectionN=n-proposedSelection-Math.ceil((horizon+1)/7)>=4?proposedSelection:0;
  const score = (method: Method) => mean(origins[method].slice(0, selectionN).flatMap(o => o.errors.map(Math.abs)));
  const method: Method = selectionN && score("comparable-day-mean") < score("seasonal-naive") ? "comparable-day-mean" : "seasonal-naive";
  const selectionEnd=selectionN?origins[method][selectionN-1].targetEnd:-1;
  const held = origins[method].slice(selectionN).filter(o=>o.index>selectionEnd), baseline = origins["seasonal-naive"].slice(selectionN).filter(o=>o.index>selectionEnd);
  const calibrationN = held.length >= 24+Math.ceil(horizon/7) ? held.length - Math.max(4, Math.floor(held.length / 5))-Math.ceil(horizon/7) : 0;
  const calibration = held.slice(0, calibrationN), later = held.slice(calibrationN).filter(o=>!calibrationN||o.index>calibration.at(-1)!.targetEnd);
  const bands = calibrationN >= 20 ? Array.from({length:horizon}, (_, h) => ({ low:quantile(calibration.map(o=>o.errors[h]), .1), high:quantile(calibration.map(o=>o.errors[h]), .9) })) : null;
  const totalBand = bands ? {low:quantile(calibration.map(o=>o.errors.reduce((s,x)=>s+x,0)),.1),high:quantile(calibration.map(o=>o.errors.reduce((s,x)=>s+x,0)),.9)} : null;
  const errors = held.flatMap(o=>o.errors), scaled = held.flatMap(o=>o.scale === null ? [] : o.errors.map(e=>Math.abs(e)/o.scale!));
  const bound=(value:number)=>metric==="netSalesCents"?Math.round(value):round(Math.max(0,value));
  const evaluation: ForecastEvaluation = { basis:"Retrospective rolling origins using current reviewed records; not reconstructed as-known history.",origins:held.length,method,mae:errors.length?round(mean(errors.map(Math.abs))):null,bias:errors.length?round(mean(errors)):null,mase:scaled.length?round(mean(scaled)):null,baselineMae:baseline.length?round(mean(baseline.flatMap(o=>o.errors.map(Math.abs)))):null,totalMae:held.length?round(mean(held.map(o=>Math.abs(o.errors.reduce((s,x)=>s+x,0))))):null,calibrationOrigins:calibrationN,rangeCoverage:bands&&later.length?mean(later.flatMap(o=>o.errors.map((e,h)=>Number(o.predictions[h]+e>=bound(o.predictions[h]+bands[h].low)&&o.predictions[h]+e<=bound(o.predictions[h]+bands[h].high))))):null,rangeWidth:bands&&later.length?mean(later.flatMap(o=>bands.map((b,h)=>bound(o.predictions[h]+b.high)-bound(o.predictions[h]+b.low)))):null,rangeEvaluationOrigins:bands?later.length:0,explanation:"MAE is mean absolute error. Positive bias means underforecasting. MASE is unavailable for a zero seasonal scale. Model choice uses earlier origins; ranges use separate calibration origins, then later coverage checks with purged horizon boundaries. Weekly origins within evaluation overlap at longer horizons." };
  return { method, evaluation, bands, totalBand };
}
export type ForecastPoint = { date:string; value:number|null; low:number|null; high:number|null; state:"closed"|"ordinary"|"unusual"|"unavailable"; workload:"busier"|"quieter"|"typical"|null };
export type ForecastSeries = { available:boolean; metric:ForecastMetric; points:ForecastPoint[]; total:number|null; low:number|null; high:number|null; evaluation:ForecastEvaluation; reasons:string[] };
export function forecastLocation(input: ForecastLocation, horizon:7|28, issuedAt:string) {
  const today = new Intl.DateTimeFormat("en-CA",{timeZone:input.timezone,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(issuedAt));
  const cutoff = shiftForecastDate(today,-1), from = shiftForecastDate(cutoff,-363);
  const unique = new Map<string,ForecastDay>(), reasons=[...input.blocked];
  for(const d of input.days) { if(unique.has(d.date)) reasons.push("Duplicate daily records require review."); unique.set(d.date,d); }
  const start = input.settings.regimeFrom > from ? input.settings.regimeFrom : from;
  const days:ForecastDay[]=[];
  for(let date=start;date<=cutoff;date=shiftForecastDate(date,1)) {
    const d=unique.get(date);
    days.push(d ?? {date,status:tradingHours(input.settings,date)===0?"closed":"missing",transactions:tradingHours(input.settings,date)===0?0:null,units:tradingHours(input.settings,date)===0?0:null,netSalesCents:null});
  }
  if(days.slice(-28).some(d=>tradingHours(input.settings,d.date)===0&&((d.transactions??0)>0||(d.units??0)>0))) reasons.push("Recorded sales conflict with closed-day hours. Review the location schedule and channel coverage.");
  if(input.settings.hours.length!==7) reasons.push("Review this location’s operating hours.");
  if(!input.settings.reviewedAt) reasons.push("Review source completeness before generating a forecast.");
  let lastExpected=cutoff;
  for(let i=0;i<14&&tradingHours(input.settings,lastExpected)===0;i++) lastExpected=shiftForecastDate(lastExpected,-1);
  if(!days.some(d=>d.date===lastExpected&&d.status==="complete")) reasons.push("The latest expected trading day is missing or incomplete.");
  const firstComplete=days.findIndex(d=>d.status==="complete");
  const history = firstComplete<0?[]:days.slice(firstComplete);
  const series = Object.fromEntries(forecastMetrics.map(metric=>{
    const localReasons=[...new Set(reasons)], evaluation=evaluate(history,metric,horizon,input.settings);
    const recent = days.slice(-28), incomplete=recent.filter(d=>d.status==="missing"||d.status==="partial"||d[metric]===null||d.stockout).length;
    if(recent.length<28||incomplete) localReasons.push(`The latest four weeks need complete comparable ${metric==="netSalesCents"?"net sales":metric} records. ${incomplete} dates need review.`);
    if(horizon===28&&evaluation.evaluation.origins<4) localReasons.push("A 28-day outlook needs at least four complete 28-day evaluation origins. Use seven days or a manual scenario meanwhile.");
    const ordinary=mean(recent.filter(d=>d.status==="complete"&&d[metric]!==null).map(d=>d[metric]!));
    const predict=predictor(history,metric,evaluation.method,input.settings);
    const points:ForecastPoint[]=Array.from({length:horizon},(_,i)=>{
      const date=shiftForecastDate(today,i+1), closed=tradingHours(input.settings,date)===0, value=localReasons.length?null:predict(date), band=evaluation.bands?.[i];
      const bound=(x:number)=>metric==="netSalesCents"?Math.round(x):round(Math.max(0,x));
      return {date,value,low:closed&&metric!=="netSalesCents"&&value===0?0:value!==null&&band?bound(value+band.low):null,high:closed&&metric!=="netSalesCents"&&value===0?0:value!==null&&band?bound(value+band.high):null,state:tradingHours(input.settings,date)===0?"closed":input.settings.unusualDates.includes(date)?"unusual":value===null?"unavailable":"ordinary",workload:closed||metric==="netSalesCents"||value===null||ordinary<=0?null:value>ordinary*1.2?"busier":value<ordinary*.8?"quieter":"typical"};
    });
    if(points.some(p=>p.state==="unavailable")&&!localReasons.length)localReasons.push("Some future dates need four comparable reviewed days. Check changed hours or unusual events.");
    const total=points.every(p=>p.value!==null)?points.reduce((s,p)=>s+p.value!,0):null, totalBound=(n:number)=>metric==="netSalesCents"?Math.round(n):round(Math.max(0,n));
    return [metric,{metric,available:points.some(p=>p.value!==null),points,total:total===null?null:round(total),low:total!==null&&evaluation.totalBand?totalBound(total+evaluation.totalBand.low):null,high:total!==null&&evaluation.totalBand?totalBound(total+evaluation.totalBand.high):null,evaluation:evaluation.evaluation,reasons:localReasons} satisfies ForecastSeries];
  })) as Record<ForecastMetric,ForecastSeries>;
  return {id:input.id,name:input.name,timezone:input.timezone,currency:input.currency,today,cutoff,sourceCutoff:input.sourceCutoff,sourceIds:input.sourceIds,settings:input.settings,history:days.slice(-28),series,observedToday:unique.get(today)??null,notes:["Future dates begin tomorrow. Today’s partial records are observed activity, not a full-day forecast.","Busier/quieter means transactions or units more than 20% above/below an ordinary open-day baseline, not foot traffic or a statistical anomaly.",...(input.settings.stockAvailability==="unknown"?["Stock availability is unknown. These are recorded-sales forecasts, not unconstrained demand."]:[]),"Holidays and promotions have no assumed uplift. Mark unusual dates for review."]};
}
export function buildForecast(locations:ForecastLocation[],horizon:7|28,issuedAt:string) {
  const results=locations.map(l=>forecastLocation(l,horizon,issuedAt));
  const sameDates=new Set(results.map(l=>l.today)).size<=1, sameCurrency=new Set(results.map(l=>l.currency)).size<=1;
  const totals=Object.fromEntries(forecastMetrics.map(metric=>[metric,sameDates&&sameCurrency&&results.length&&results.every(l=>l.series[metric].total!==null)?round(results.reduce((s,l)=>s+l.series[metric].total!,0)):null])) as Record<ForecastMetric,number|null>;
  return {modelVersion:FORECAST_MODEL_VERSION,issuedAt,horizon,locations:results,totals,aggregationReason:!sameDates?"Locations currently have different local dates. Review their own planning windows.":!sameCurrency?"Currencies are not combined.":results.some(l=>forecastMetrics.some(m=>l.series[m].total===null))?"Company totals stay unavailable when any included location is incomplete.":null,rangeLabel:"Empirical 80% range where calibration supports it. Company ranges are not summed from location ranges."};
}
export type ForecastReport=ReturnType<typeof buildForecast>;
