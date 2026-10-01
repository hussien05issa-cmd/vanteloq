import {and,asc,eq,gte,inArray} from "drizzle-orm";
import {getD1,getDb} from "../db";
import {dailyBusinessMetrics} from "../db/schema";
import {ApiError} from "./api";
import type {AccessContext} from "./authorization";
import {effectivePermissions,requirePermission} from "./permissions";
import {getTenantEntitlements} from "./entitlements/engine";
import {authorizedLocationDataScope} from "./location-access";
import {commerceSourceAuthority} from "./integrations/source-authority";
import {authoritativeDailySalesScope} from "./integrations/daily-sales-scope";
import {approvedFactSource} from "./integrations/trusted-data";
import {businessClock} from "../domain/intraday-sales";
import {buildForecast,defaultForecastSettings,normalizeForecastSettings,shiftForecastDate,tradingHours,type ForecastDay,type ForecastLocation} from "../domain/forecasting";

export async function loadForecast(context:AccessContext,locationId:string|null,horizon:7|28,now=new Date()) {
  await requirePermission(context,"sales.view");await requirePermission(context,"metrics.revenue");
  const scope=await authorizedLocationDataScope(context,locationId),locations=scope.locations.filter(l=>scope.locationIds===null||scope.locationIds.includes(l.id));
  if(locations.length>20)throw new ApiError(422,"FORECAST_SCOPE_LIMIT","Select a location. Company forecasting supports up to 20 locations in one complete review.");
  const ids=locations.map(l=>l.id),authority=await commerceSourceAuthority({organizationId:context.organizationId,localLocationIds:ids,factFamily:"sales"});
  const start=shiftForecastDate(businessClock(now,context.organization.timezone)!.date,-366);
  const [rows,settingsRows,permissions,entitlements]=await Promise.all([
    getDb().select().from(dailyBusinessMetrics).where(and(eq(dailyBusinessMetrics.organizationId,context.organizationId),gte(dailyBusinessMetrics.businessDate,start),approvedFactSource(dailyBusinessMetrics.organizationId,dailyBusinessMetrics.sourceProvider,dailyBusinessMetrics.sourceConnectionId),authoritativeDailySalesScope({authority,localLocationIds:ids,locationRestricted:scope.locationRefs!==null}),...(scope.locationRefs!==null?[inArray(dailyBusinessMetrics.locationRef,scope.locationRefs)]:[]))).orderBy(asc(dailyBusinessMetrics.businessDate)).limit(20001),
    getD1().prepare("SELECT location_id locationId, settings_json settingsJson FROM forecasting_settings WHERE organization_id = ?").bind(context.organizationId).all<{locationId:string;settingsJson:string}>(),effectivePermissions(context),getTenantEntitlements(context)
  ]);
  if(rows.length>20000)throw new ApiError(422,"FORECAST_RECORD_LIMIT","Choose one location. Forecasts never use a silently truncated history.");
  const inputs:ForecastLocation[]=locations.map(location=>{
    const raw=settingsRows.results?.find(r=>r.locationId===location.id),settings=raw?normalizeForecastSettings(JSON.parse(raw.settingsJson)):defaultForecastSettings();
    const selections=authority.selections.filter(s=>s.localLocationId===location.id),refs=new Set(selections.map(s=>s.metricLocationRef));
    const selected=rows.filter(r=>selections.length?refs.has(r.locationRef):r.locationRef===location.id||scope.organizationWide&&scope.locations.length===1&&r.locationRef==="all");
    const dateGroups=new Map<string,typeof rows>();for(const r of selected)dateGroups.set(r.businessDate,[...(dateGroups.get(r.businessDate)??[]),r]);
    const today=businessClock(now,location.timezone)!.date,reviewTime=settings.reviewedAt?Date.parse(settings.reviewedAt):0,days:ForecastDay[]=[];
    for(let date=shiftForecastDate(today,-364);date<=today;date=shiftForecastDate(date,1)){
      const records=dateGroups.get(date)??[],closed=tradingHours(settings,date)===0;
      const reviewed=date>=settings.reviewedFrom&&date<=settings.reviewedThrough&&records.every(r=>r.updatedAt.getTime()<=reviewTime);
      const explicitZero=reviewed&&settings.zeroDates.includes(date)&&records.every(r=>r.transactionCount===0&&r.unitsSold===0&&r.netSalesCents===0);
      const complete=reviewed&&date<today&&(explicitZero||records.length>0&&(!selections.length||selections.every(s=>records.some(r=>r.locationRef===s.metricLocationRef))));
      const closedZero=closed&&records.length===0&&reviewed;
      const status=date===today?"partial":complete?(closed&&records.every(r=>r.transactionCount===0&&r.unitsSold===0)?"closed":"complete"):closedZero?"closed":"missing";
      const read=(key:"transactionCount"|"unitsSold"|"netSalesCents")=>records.length?records.reduce((s,r)=>s+r[key],0):reviewed&&settings.zeroDates.includes(date)?0:null;
      days.push({date,status,transactions:read("transactionCount")??(closedZero?0:null),units:read("unitsSold")??(closedZero?0:null),netSalesCents:read("netSalesCents")??(closedZero?0:null)});
    }
    const sourceIds=[...new Set(selected.map(r=>r.sourceConnectionId??`manual:${location.id}`))];
    const blocked:string[]=[];
    if(authority.conflicts.some(c=>c.localLocationId===location.id))blocked.push("Resolve overlapping or unavailable sales sources in Reports.");
    if(authority.needsData?.some(c=>c.localLocationId===location.id))blocked.push("The selected source is disconnected, awaiting approval or still importing.");
    if(location.timezone!==context.organization.timezone)blocked.push("Daily summaries use the workspace time zone. Reconcile location-local dates before forecasting this location.");
    if(location.currency!==context.organization.currency)blocked.push("Daily summaries use the workspace currency. This location needs an explicit currency reconciliation.");
    return {id:location.id,name:location.name,timezone:location.timezone,currency:location.currency,settings,days,sourceIds,sourceCutoff:selected.length?new Date(Math.max(...selected.map(r=>r.updatedAt.getTime()))).toISOString():null,blocked};
  });
  const issuedAt=now.toISOString(),report=buildForecast(inputs,horizon,issuedAt);
  const capabilities={configure:["owner","admin","manager"].includes(context.role)&&permissions.includes("data.import"),promotion:entitlements.features.includes("forecasting.scenarios")&&permissions.includes("metrics.profit")&&(permissions.includes("finance.costs")||permissions.includes("inventory.value")),inventory:permissions.includes("inventory.view")&&entitlements.features.includes("forecasting.inventory"),capacity:permissions.includes("operations.tasks"),cash:entitlements.features.includes("bookloq")&&permissions.includes("finance.bank_balances")&&permissions.includes("finance.ap_ar")&&scope.organizationWide,export:permissions.includes("reports.export")&&entitlements.features.includes("reporting.exports")};
  return {report,inputs,capabilities,locations:locations.map(l=>({id:l.id,name:l.name})),scope};
}
export type ForecastView={name:string;horizon:7|28;metric:"transactions"|"units"|"netSalesCents";locationId:string|null};
export function normalizeForecastViews(value:unknown,allowed:ReadonlySet<string>) {
  const p=(value&&typeof value==="object"?value:{}) as Record<string,unknown>;
  const views:ForecastView[]=[];
  if(Array.isArray(p.views))for(const x of p.views.slice(0,5)){if(!x||typeof x!=="object"||typeof x.name!=="string")continue;const name=x.name.trim().replace(/[\u0000-\u001f]/g,"").slice(0,40);if(!name||views.some(v=>v.name===name))continue;if(x.locationId&&!allowed.has(x.locationId))throw new ApiError(403,"LOCATION_ACCESS_DENIED","A saved view contains a location you cannot access.");views.push({name,horizon:x.horizon===28?28:7,metric:["transactions","units","netSalesCents"].includes(x.metric)?x.metric:"transactions",locationId:x.locationId||null});}
  return {pinned:p.pinned===true,views};
}
