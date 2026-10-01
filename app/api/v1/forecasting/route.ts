import {getD1} from "../../../../db";
import {ApiError,enforceRateLimit,handleApi,jsonResponse,readJsonObject,requireSameOrigin} from "../../../../server/api";
import {requireAccess} from "../../../../server/authorization";
import {loadForecast,normalizeForecastViews} from "../../../../server/forecasting";
import {accessibleLocations,requireAccessibleLocation} from "../../../../server/location-access";
import {requirePermission} from "../../../../server/permissions";
import {recordAudit} from "../../../../server/audit";
import {requireFeature} from "../../../../server/entitlements/engine";
import {businessClock} from "../../../../domain/intraday-sales";
import {forecastDate,normalizeForecastSettings,type ForecastReport} from "../../../../domain/forecasting";
import {csvCell} from "../../../../domain/csv";

const readers=["owner","admin","manager","employee","read_only"] as const;
const horizonOf=(x:unknown):7|28=>{if(x!==7&&x!==28&&x!=="7"&&x!=="28"&&x!==null&&x!==undefined)throw new ApiError(400,"FORECAST_HORIZON","Choose seven or 28 days.");return x===28||x==="28"?28:7;};
async function views(organizationId:string,userId:string,allowed:Set<string>){const row=await getD1().prepare("SELECT preferences_json value FROM forecasting_views WHERE organization_id=? AND user_id=?").bind(organizationId,userId).first<{value:string}>();const raw=row?JSON.parse(row.value):{};return normalizeForecastViews({...raw,views:(raw.views??[]).filter((v:{locationId:string|null})=>!v.locationId||allowed.has(v.locationId))},allowed);}
export async function GET(request:Request){return handleApi(request,async()=>{
  const context=await requireAccess(request,readers,"forecasting.revenue");await enforceRateLimit("forecast:read",context.userId,50,60);
  const p=new URL(request.url).searchParams,data=await loadForecast(context,p.get("location"),horizonOf(p.get("horizon"))),allowed=new Set(data.locations.map(l=>l.id));
  const preference=await views(context.organizationId,context.userId,new Set((await accessibleLocations(context)).map(l=>l.id)));
  const runs=(await getD1().prepare("SELECT id, issued_at issuedAt, horizon, report_json reportJson FROM forecasting_runs WHERE organization_id=? AND created_by=? ORDER BY issued_at DESC LIMIT 30").bind(context.organizationId,context.userId).all<{id:string;issuedAt:string;horizon:number;reportJson:string}>()).results??[];
  // A saved result cannot outlive access to its location or approved source.
  const permitted=(report:ForecastReport)=>report.locations.every(l=>allowed.has(l.id)&&l.sourceIds.every(id=>data.inputs.find(x=>x.id===l.id)?.sourceIds.includes(id)));
  if(p.has("run")){
    const record=await getD1().prepare("SELECT report_json value FROM forecasting_runs WHERE id=? AND organization_id=? AND created_by=?").bind(p.get("run"),context.organizationId,context.userId).first<{value:string}>();
    if(!record)throw new ApiError(404,"FORECAST_NOT_FOUND","Forecast not found.");
    const report=JSON.parse(record.value) as ForecastReport;if(!permitted(report))throw new ApiError(403,"FORECAST_ACCESS_CHANGED","This saved forecast includes a location or source that is no longer available to you.");
    if(p.get("format")==="csv"){
      await requirePermission(context,"reports.export");await requireFeature(context,"reporting.exports");
      const body=[["Location","Issue time","Model","Source cutoff","Date","Metric","Forecast","Low","High","Status"],...report.locations.flatMap(l=>Object.values(l.series).flatMap(s=>s.points.map(d=>[l.name,report.issuedAt,report.modelVersion,l.sourceCutoff,d.date,s.metric,d.value,d.low,d.high,d.state])))].map(r=>r.map(csvCell).join(",")).join("\r\n");
      return new Response(body,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":"attachment; filename=vanteloq-forecast.csv","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
    }
    return jsonResponse({report,saved:true});
  }
  return jsonResponse({report:data.report,capabilities:data.capabilities,locations:data.locations,preferences:preference,runs:runs.filter(r=>permitted(JSON.parse(r.reportJson))).map(r=>({id:r.id,issuedAt:r.issuedAt,horizon:r.horizon}))});
});}
export async function POST(request:Request){return handleApi(request,async({requestId})=>{
  requireSameOrigin(request);const context=await requireAccess(request,readers,"forecasting.revenue");await requirePermission(context,"sales.view");await requirePermission(context,"metrics.revenue");await enforceRateLimit("forecast:write",context.userId,40,3600);
  const body=await readJsonObject(request,40000),now=new Date(),db=getD1();
  if(body.action==="settings"){
    if(!["owner","admin","manager"].includes(context.role))throw new ApiError(403,"FORECAST_CONFIG_PERMISSION","A manager must review operating assumptions.");
    await requirePermission(context,"data.import");if(typeof body.locationId!=="string")throw new ApiError(400,"LOCATION_REQUIRED","Choose one location.");
    const location=await requireAccessibleLocation(context,body.locationId);let settings;
    try{settings=normalizeForecastSettings(body.settings);}catch(error){throw new ApiError(400,"FORECAST_SETTINGS",error instanceof Error?error.message:"Check operating hours.");}
    const today=businessClock(now,location.timezone)!.date;
    if(body.complete!==true||!forecastDate(settings.reviewedFrom)||!forecastDate(settings.reviewedThrough)||settings.reviewedFrom>settings.reviewedThrough||settings.reviewedThrough>=today||settings.hours.length!==7)throw new ApiError(400,"FORECAST_REVIEW_REQUIRED","Confirm a past completeness range and all seven operating days.");
    const previous=await db.prepare("SELECT settings_json value FROM forecasting_settings WHERE organization_id=? AND location_id=?").bind(context.organizationId,location.id).first<{value:string}>();
    if(previous&&JSON.stringify(JSON.parse(previous.value).hours)!==JSON.stringify(settings.hours)&&(!settings.regimeFrom||settings.regimeFrom>today))throw new ApiError(400,"FORECAST_HOURS_CHANGE","Enter the date the current operating pattern began when changing hours.");
    settings.reviewedAt=now.toISOString();
    await db.prepare("INSERT INTO forecasting_settings(organization_id,location_id,settings_json,updated_by,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(organization_id,location_id) DO UPDATE SET settings_json=excluded.settings_json,updated_by=excluded.updated_by,updated_at=excluded.updated_at").bind(context.organizationId,location.id,JSON.stringify(settings),context.userId,Math.floor(now.getTime()/1000)).run();
    await recordAudit({request,requestId,organizationId:context.organizationId,actorUserId:context.userId,action:"forecast.assumptions_reviewed",resourceType:"forecasting",resourceId:location.id,details:{from:settings.reviewedFrom,through:settings.reviewedThrough}});
    return jsonResponse({settings});
  }
  if(body.action==="preferences"){
    const allowed=new Set((await accessibleLocations(context)).map(l=>l.id)),preferences=normalizeForecastViews(body.preferences,allowed);
    await db.prepare("INSERT INTO forecasting_views(organization_id,user_id,preferences_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(organization_id,user_id) DO UPDATE SET preferences_json=excluded.preferences_json,updated_at=excluded.updated_at").bind(context.organizationId,context.userId,JSON.stringify(preferences),Math.floor(now.getTime()/1000)).run();return jsonResponse({preferences});
  }
  if(body.action!=="issue")throw new ApiError(400,"FORECAST_ACTION","Choose a supported forecasting action.");
  const locationId=typeof body.locationId==="string"?body.locationId:null,data=await loadForecast(context,locationId,horizonOf(body.horizon),now);
  if(!data.report.locations.some(l=>Object.values(l.series).some(s=>s.available)))throw new ApiError(422,"FORECAST_NOT_READY","Review the missing inputs before issuing a forecast. Manual scenarios remain available separately.");
  const snapshot=JSON.stringify(data.inputs),bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(snapshot)),hash=Array.from(new Uint8Array(bytes)).map(b=>b.toString(16).padStart(2,"0")).join(""),id=crypto.randomUUID();
  await db.prepare("INSERT INTO forecasting_runs(id,organization_id,created_by,issued_at,horizon,model_version,input_hash,snapshot_json,report_json) VALUES(?,?,?,?,?,?,?,?,?)").bind(id,context.organizationId,context.userId,data.report.issuedAt,data.report.horizon,data.report.modelVersion,hash,snapshot,JSON.stringify(data.report)).run();
  await recordAudit({request,requestId,organizationId:context.organizationId,actorUserId:context.userId,action:"forecast.issued",resourceType:"forecasting",resourceId:id,details:{horizon:data.report.horizon,model:data.report.modelVersion,inputHash:hash}});
  return jsonResponse({id,report:data.report,inputHash:hash},{status:201});
});}
