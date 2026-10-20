import type { ForecastLocation } from "./forecasting";
import { foodAmountText } from "./foodservice";

export type OutcomeWindows = { baselineFrom: string; baselineTo: string; followupFrom: string; followupTo: string };
export type OutcomeSalesSnapshot = OutcomeWindows & {
  metric: "net-sales"; locationId: string; currency: string; baselineMinor: number; followupMinor: number;
  sourceIds: string[]; sourceCutoff: string | null; reviewedAt: string; capturedAt: string; fingerprint: string;
};
export type OutcomeSalesPreview = { available: boolean; reason: string; snapshot: OutcomeSalesSnapshot | null; baseline: string | null; followup: string | null };
function date(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value; }
export function outcomeWindows(value: Record<string,string>, today: string): OutcomeWindows {
  const result = { baselineFrom:value.baselineFrom,baselineTo:value.baselineTo,followupFrom:value.followupFrom,followupTo:value.followupTo };
  if (Object.values(result).some(v=>typeof v!=="string"||!date(v))) throw Error("Choose valid baseline and follow-up dates.");
  const days=(from:string,to:string)=>(Date.parse(to)-Date.parse(from))/86400000+1;
  if(result.baselineFrom>result.baselineTo||result.followupFrom>result.followupTo||result.followupFrom<=result.baselineTo||days(result.baselineFrom,result.baselineTo)!==days(result.followupFrom,result.followupTo)) throw Error("Use equal, non-overlapping baseline and follow-up periods.");
  if(result.followupTo>=today) throw Error("Recorded comparisons require completed days before today.");
  if(days(result.baselineFrom,result.followupTo)>364) throw Error("Choose periods within the last 364 days of reviewed history.");
  return result;
}
export function recordedOutcomeSales(input: ForecastLocation, windows: OutcomeWindows, capturedAt: string): Omit<OutcomeSalesSnapshot,"fingerprint"> | { reason: string } {
  if(input.blocked?.length) return {reason:input.blocked.join(" ")};
  const sum=(from:string,to:string)=>{
    const rows=input.days.filter(d=>d.date>=from&&d.date<=to),expected=(Date.parse(to)-Date.parse(from))/86400000+1;
    if(rows.length!==expected||new Set(rows.map(d=>d.date)).size!==expected||rows.some(d=>!['complete','closed'].includes(d.status)||!Number.isSafeInteger(d.netSalesCents))) return null;
    const amount=rows.reduce((total,d)=>total+BigInt(d.netSalesCents!),BigInt(0));
    return amount>BigInt(Number.MAX_SAFE_INTEGER)||amount<BigInt(Number.MIN_SAFE_INTEGER)?null:Number(amount);
  };
  const baselineMinor=sum(windows.baselineFrom,windows.baselineTo),followupMinor=sum(windows.followupFrom,windows.followupTo);
  if(baselineMinor===null||followupMinor===null||!input.settings.reviewedAt) return {reason:"Review exact source coverage for both reporting periods in Forecasting. Missing days and changed imports cannot become zero."};
  return {...windows,metric:"net-sales",locationId:input.id,currency:input.currency,baselineMinor,followupMinor,sourceIds:[...new Set(input.sourceIds)].sort(),sourceCutoff:input.sourceCutoff??null,reviewedAt:input.settings.reviewedAt,capturedAt};
}
export function outcomeSalesValues(snapshot: Pick<OutcomeSalesSnapshot,"baselineMinor"|"followupMinor"|"currency">) { return {baseline:foodAmountText(snapshot.baselineMinor,snapshot.currency),followup:foodAmountText(snapshot.followupMinor,snapshot.currency)}; }
export function validateOutcomeSalesSnapshot(value: unknown): OutcomeSalesSnapshot | null {
  if(value==null) return null;
  if(typeof value!=="object"||Array.isArray(value)) throw Error("Review the retained outcome source snapshot.");
  const s=value as OutcomeSalesSnapshot;
  const keys=['baselineFrom','baselineTo','followupFrom','followupTo','metric','locationId','currency','baselineMinor','followupMinor','sourceIds','sourceCutoff','reviewedAt','capturedAt','fingerprint'];
  if(Object.keys(s).some(k=>!keys.includes(k))||keys.some(k=>!(k in s))||s.metric!=="net-sales"||typeof s.locationId!=="string"||!/^[A-Za-z0-9_.:-]{1,200}$/.test(s.locationId)||typeof s.currency!=="string"||!/^[A-Z]{3}$/.test(s.currency)||![s.baselineMinor,s.followupMinor].every(Number.isSafeInteger)||![s.baselineFrom,s.baselineTo,s.followupFrom,s.followupTo].every(date)||!Array.isArray(s.sourceIds)||s.sourceIds.length>100||s.sourceIds.some(id=>typeof id!=="string"||id.length>250)||new Set(s.sourceIds).size!==s.sourceIds.length||typeof s.fingerprint!=="string"||!/^[a-f0-9]{64}$/.test(s.fingerprint)||![s.reviewedAt,s.capturedAt,...(s.sourceCutoff===null?[]:[s.sourceCutoff])].every(t=>typeof t==='string'&&Number.isFinite(Date.parse(t)))) throw Error("Review the retained outcome source snapshot.");
  outcomeWindows(s as unknown as Record<string,string>,new Date(Date.parse(s.capturedAt)+86400000).toISOString().slice(0,10));
  return {...s,sourceIds:[...s.sourceIds]};
}
