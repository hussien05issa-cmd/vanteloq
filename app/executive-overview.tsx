"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { ExecutiveReport } from "../server/executive-report";
import type { ExecutiveKey } from "../domain/executive-metrics";
import {
  dashboardPreferencePreset,
  normalizeDashboardPreferences,
  type DashboardPreferences,
} from "../domain/dashboard-preferences";
import { apiFetch } from "./supabase-browser";
import { MetricSparkline } from "./dashboard-charts";
import InteractiveGoalRings from "./interactive-goal-rings";
import RevenueSourceDetail from "./revenue-source-detail";
import ExecutiveSummaryPanels from "./executive-summary-panels";
import ExecutiveStatusFrame from "./executive-status-frame";
import { formatRecordedTimestamp } from "../domain/executive-presentation";
import ExecutiveTrend from "./executive-trend";
import "./executive-overview.css";
import "./dashboard-personalization.css";
import "./origin-overview.css";
import "./commerce-overview.css";
import VanteloqAiLogo from "./vanteloq-ai-logo";
import type { RetailAdvisorSeed } from "./retail-intelligence-workspace";
import DashboardCustomizer from "./dashboard-customizer";
import { goalResult, validDashboardDates } from "../domain/dashboard-personalization";
import InvoiceOverview from "./invoice-overview";
import { dashboardDraftScope, dashboardDraftKey, dashboardDraftFingerprint, dashboardLayoutDraft, serializeDashboardDraft, recoverDashboardDraft, type DashboardDraftScope } from "../domain/dashboard-draft";
import ExpandingSurface from "./expanding-surface";
import { useMotionPreference } from "./use-motion-preference";
import WorkspaceSkeleton from "./workspace-skeleton";
import { ADVISOR_QUESTION_LIMIT } from "../shared/advisor-limits";

const periods=[["today","Today","Today"],["yesterday","Yesterday","Yesterday"],["7d","7D","Last 7 days"],["30d","30D","Last 30 days"],["90d","90D","Last 90 days"],["mtd","MTD","Month to date"],["qtd","QTD","Quarter to date"],["ytd","YTD","Year to date"],["1y","1Y","Last 365 days"],["custom","Custom","Custom date range"]];
const cash=(v:number|null,currency:string)=>v===null?"Not available":new Intl.NumberFormat("en-CA",{style:"currency",currency,maximumFractionDigits:2}).format(v===0?0:v/100);
const number=(v:number|null)=>v===null?"Not available":v.toLocaleString("en-CA",{maximumFractionDigits:2});
const display=(v:number|null,unit:string,currency:string)=>v===null?"Not available":unit==="percent"?`${number(v*100)}%`:unit==="count"?number(v):cash(v,currency);
const date=(value:string)=>new Intl.DateTimeFormat("en-CA",{month:"short",day:"numeric",timeZone:"UTC"}).format(new Date(value+"T00:00:00Z"));

export default function ExecutiveOverview({currency,industry,activeLocationId,basis="commerce",navigate,onAsk,refreshKey,initialReport,initialPreferences,compact=false}:{currency:string;industry?:string|null;activeLocationId?:string|null;basis?:"commerce"|"ledger";navigate:(view:"Sales"|"Reports"|"BookLoQ"|"Integrations"|"Intelligence",period?:{from:string;to:string})=>void;onAsk?:(seed:RetailAdvisorSeed)=>void;refreshKey?:string|null;initialReport?:ExecutiveReport;initialPreferences?:DashboardPreferences;compact?:boolean}) {
  const [preset,setPreset]=useState("30d"),[compare,setCompare]=useState("previous"),[range,setRange]=useState({from:"",to:""}),[appliedRange,setAppliedRange]=useState({from:"",to:""});
  const [storedReport,setReport]=useState<ExecutiveReport|null>(initialReport??null),[error,setError]=useState(""),[reload,setReload]=useState(0),[selected,setSelected]=useState<ExecutiveKey>("net_revenue");
  const [sourceGate,setSourceGate]=useState("");
  const [pending,setPending]=useState(!initialReport),[showDates,setShowDates]=useState(false);
  const defaults=normalizeDashboardPreferences(initialReport&&initialPreferences?initialPreferences:{...dashboardPreferencePreset(initialReport?"sales":"owner"),...(initialReport?{widgets:dashboardPreferencePreset("sales").widgets.map(w=>({...w,size:"standard"}))}:{})}),[preferences,setPreferences]=useState<DashboardPreferences>(defaults),[draft,setDraft]=useState<DashboardPreferences>(defaults);
  const [showCustomize,setShowCustomize]=useState(false),[preferenceStatus,setPreferenceStatus]=useState(""),[savingPreferences,setSavingPreferences]=useState(false);
  const [preferenceError,setPreferenceError]=useState(""),[preferencesReady,setPreferencesReady]=useState(Boolean(initialReport)),[preferenceRetry,setPreferenceRetry]=useState(0);
  const [draftScope,setDraftScope]=useState<DashboardDraftScope|null>(null),[draftBaseline,setDraftBaseline]=useState(""),[recovery,setRecovery]=useState<DashboardPreferences|null>(null);
  const [draftStorageStatus,setDraftStorageStatus]=useState(""),[changedSaved,setChangedSaved]=useState<DashboardPreferences|null>(null);
  const savingRef=useRef(false);
  const dirty=JSON.stringify(draft)!==JSON.stringify(changedSaved??preferences);
  const overviewId=useId().replaceAll(":","");
  const [metricOpen,setMetricOpen]=useState(false),metricOrigin=useRef<HTMLElement|null>(null);
  const motion=useMotionPreference();
  const metricGrid=useRef<HTMLDivElement>(null),detailPanel=useRef<HTMLElement>(null),preferencesLoaded=useRef(false);
  const reveal=(element:HTMLElement|null)=>{if(!element)return;element.focus({preventScroll:true});element.scrollIntoView({block:"start",behavior:motion?"smooth":"auto"});};
  const selectMetric=(key:ExecutiveKey,origin:HTMLElement)=>{metricOrigin.current=origin;setSelected(key);setMetricOpen(true);};
  const scope=JSON.stringify([preset,compare,appliedRange,activeLocationId,basis,reload,refreshKey]);
  const [responseScope,setResponseScope]=useState(scope);
  // POS timestamps alone cannot detect midnight, reviewed journal edits or a
  // corrected historical import. Re-query the authoritative report periodically.
  useEffect(()=>{
    if(initialReport)return;
    let lastRefresh=Date.now();
    const refresh=()=>{if(document.visibilityState==="visible"&&Date.now()-lastRefresh>=15000){lastRefresh=Date.now();setReload(value=>value+1);}};
    const timer=window.setInterval(refresh,60000);
    window.addEventListener("focus",refresh);document.addEventListener("visibilitychange",refresh);
    return()=>{window.clearInterval(timer);window.removeEventListener("focus",refresh);document.removeEventListener("visibilitychange",refresh);};
  },[initialReport]);
  const report=initialReport??(responseScope===scope?storedReport:null);
  const visiblePending=!initialReport&&(pending||responseScope!==scope);
  const visibleError=responseScope===scope?error:"";
  useEffect(()=>{
    if(initialReport)return;
    let active=true;
    void apiFetch("/api/v1/preferences",{headers:{Accept:"application/json"}}).then(async response=>{
      if(!response.ok)throw Error("Dashboard settings could not load.");
      const body=await response.json();
      if(!active)return;
      const next=normalizeDashboardPreferences(body.dashboardPreferences);
      const verifiedScope=dashboardDraftScope(body.preferenceScope);
      let baseline="",recovered:DashboardPreferences|null=null,storageStatus=verifiedScope?"":"Browser recovery is unavailable. Unsaved changes stay in this open page.";
      if(verifiedScope)try{
        baseline=await dashboardDraftFingerprint(next);
        const key=dashboardDraftKey(verifiedScope),result=recoverDashboardDraft(window.sessionStorage.getItem(key),baseline,next);
        recovered=result.draft;
        if(result.status!=="none"&&result.status!=="available"){
          window.sessionStorage.removeItem(key);
          storageStatus=result.status==="changed"?"An older draft was removed because your saved dashboard changed.":"An expired or unreadable layout draft was removed.";
        }
      }catch{storageStatus="Browser recovery is unavailable. Unsaved changes stay in this open page.";}
      if(!active)return;
      // Editing remains disabled until this authoritative baseline is loaded.
      setPreferences(next);setDraft(next);setDraftScope(verifiedScope);setDraftBaseline(baseline);setRecovery(recovered);setDraftStorageStatus(storageStatus);setPreferencesReady(true);setPreferenceError("");
      if(!preferencesLoaded.current){setPreset(next.defaultPeriod);setCompare(next.comparison);setRange(next.customDates);setAppliedRange(next.customDates);preferencesLoaded.current=true;}
    }).catch(()=>{if(active)setPreferenceError("Your saved dashboard could not load. Retry before changing its layout.");});
    return()=>{active=false;};
  },[initialReport,preferenceRetry]);
  useEffect(()=>{
    if(initialReport||!preferencesReady||!draftScope||!draftBaseline||recovery||changedSaved||savingPreferences)return;
    let active=true;
    try{
      const key=dashboardDraftKey(draftScope);
      if(JSON.stringify(dashboardLayoutDraft(draft))===JSON.stringify(dashboardLayoutDraft(preferences)))window.sessionStorage.removeItem(key);
      else window.sessionStorage.setItem(key,serializeDashboardDraft(draft,draftBaseline));
    }catch{queueMicrotask(()=>{if(active)setDraftStorageStatus("Browser recovery is unavailable. Unsaved changes stay in this open page.");});}
    return()=>{active=false;};
  },[draft,preferences,draftScope,draftBaseline,initialReport,preferencesReady,recovery,changedSaved,savingPreferences]);
  useEffect(()=>{
    if(initialReport)return;
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),30000);
    let active=true;
    const params=new URLSearchParams({executive:"1",period:preset,compare,basis});
    if(activeLocationId)params.set("location",activeLocationId);
    if(preset==="custom"){params.set("from",appliedRange.from);params.set("to",appliedRange.to);}
    queueMicrotask(()=>{if(active){setPending(true);setResponseScope(scope);setReport(null);setError("");setSourceGate("");}});
    void apiFetch(`/api/v1/command-centre?${params}`,{signal:controller.signal,headers:{Accept:"application/json"}}).then(async response=>{
      const payload=await response.json();if(!response.ok&&["SOURCE_SYNCING","SALES_SOURCE_CONFLICT"].includes(payload.error?.code)&&active)setSourceGate(payload.error.code);if(!response.ok)throw Error(payload.error?.message??"This overview could not load. Try again.");
      if(!payload.executiveReport)throw Error("The overview is unavailable. Refresh and try again.");
      if(active)setReport(payload.executiveReport);
    }).catch(cause=>{if(active)setError(cause instanceof Error&&cause.name!=="AbortError"?cause.message:"The request timed out. Try again.");}).finally(()=>{clearTimeout(timeout);if(active)setPending(false);});
    return()=>{active=false;controller.abort();clearTimeout(timeout);};
  },[preset,compare,appliedRange,activeLocationId,basis,reload,refreshKey,initialReport,scope]);
  const orderedWidgets=new Map(preferences.widgets.map((widget,index)=>[widget.id,{...widget,index}]));
  const visibleMetrics=report?.metrics.filter(metric=>orderedWidgets.get(metric.key)?.visible!==false).sort((a,b)=>(orderedWidgets.get(a.key)?.index??99)-(orderedWidgets.get(b.key)?.index??99))??[];
  const metric=report?.metrics.find(m=>m.key===selected&&orderedWidgets.get(m.key)?.visible!==false)??visibleMetrics[0];
  const clearDraftCache=()=>{if(!initialReport&&draftScope)try{window.sessionStorage.removeItem(dashboardDraftKey(draftScope));}catch{/* Keep the explicit form action available. */}};
  const closeCustomizer=()=>{setShowCustomize(false);if(dirty)setPreferenceStatus("Unsaved changes kept. Reopen Customize to continue or discard them.");};
  const openCustomizer=()=>{if(!preferencesReady||recovery)return;if(!changedSaved)setPreferenceError("");setShowCustomize(true);};
  useEffect(()=>{if(!preferencesReady||recovery||window.location.hash!=="#dashboard/customize")return;queueMicrotask(()=>setShowCustomize(true));window.history.replaceState(null,"",window.location.pathname+window.location.search);},[preferencesReady,recovery]);
  const discardDraft=()=>{
    const next=changedSaved??preferences;
    clearDraftCache();setRecovery(null);setDraft(next);setPreferences(next);setChangedSaved(null);setPreferenceError("");setPreferenceStatus("Unsaved changes discarded. Your saved layout is unchanged.");
    if(changedSaved){setPreset(next.defaultPeriod);setCompare(next.comparison);setRange(next.customDates);setAppliedRange(next.customDates);void dashboardDraftFingerprint(next).then(setDraftBaseline).catch(()=>setDraftBaseline(""));}
  };
  const savePreferences=async()=>{
    if(savingRef.current||!preferencesReady)return;
    setPreferenceError("");
    if(draft.defaultPeriod==="custom"&&(!validDashboardDates(draft.customDates.from,draft.customDates.to)||draft.customDates.to>new Date().toISOString().slice(0,10))){setPreferenceError("Choose valid custom dates, no longer than 366 days and not in the future.");return;}
    for(const key of draft.goalRings) if(draft.targets[key]!==undefined && (draft.targets[key]!<=0 || !validDashboardDates(draft.goalRules[key]?.from,draft.goalRules[key]?.to))){setPreferenceError("Each target needs a positive amount and valid start and target dates.");return;}
    if(initialReport){setPreferences(draft);setShowCustomize(false);setPreferenceStatus("Sample layout updated for this preview only.");return;}
    savingRef.current=true;setSavingPreferences(true);setPreferenceStatus("");
    try{
      const verification=await apiFetch("/api/v1/preferences",{headers:{Accept:"application/json"}});
      const latest=await verification.json();if(!verification.ok)throw Error("The current saved layout could not be checked. Your changes are kept; retry saving.");
      const currentScope=dashboardDraftScope(latest.preferenceScope);
      if(!draftScope||!currentScope||dashboardDraftKey(currentScope)!==dashboardDraftKey(draftScope))throw Error("Your account or workspace changed. Reload before saving this layout.");
      const current=normalizeDashboardPreferences(latest.dashboardPreferences);
      // Check again before an explicit save; a recovered draft must not replace a newer layout.
      const {collections:_currentCollections,...currentOverview}=current,{collections:_savedCollections,...savedOverview}=preferences;
      void _currentCollections;void _savedCollections;
      if(JSON.stringify(currentOverview)!==JSON.stringify(savedOverview)){setChangedSaved(current);throw Error("Your saved dashboard changed elsewhere. Your draft is kept. Discard changes to load the current layout before editing again.");}
      const response=await apiFetch("/api/v1/preferences",{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({dashboardPreferences:{...draft,collections:current.collections},expectedDashboardPreferences:latest.dashboardPreferences,expectedPreferenceScope:latest.preferenceScope})});
      const body=await response.json();if(!response.ok)throw Error(body.error?.message??"Dashboard settings could not be saved.");
      const saved=normalizeDashboardPreferences(body.dashboardPreferences);clearDraftCache();setRecovery(null);setChangedSaved(null);setPreferences(saved);setDraft(saved);setPreset(saved.defaultPeriod);setCompare(saved.comparison);setRange(saved.customDates);setAppliedRange(saved.customDates);setShowCustomize(false);setPreferenceStatus("Dashboard saved.");
      try{setDraftBaseline(await dashboardDraftFingerprint(saved));}catch{setDraftBaseline("");}
    }catch(cause){setPreferenceError(cause instanceof Error?cause.message:"Dashboard settings could not be saved. Your changes are kept.");}finally{savingRef.current=false;setSavingPreferences(false);}
  };
  return <section className={`executive-overview executive-commerce-layout commerce-reference${compact?" executive-compact":""}`} aria-label="Executive overview" aria-busy={visiblePending}>
    <header className="executive-heading"><div><h3>Performance overview</h3></div><div className="executive-heading-actions"><button type="button" disabled={!preferencesReady||Boolean(recovery)} onClick={openCustomizer} aria-expanded={showCustomize} aria-controls={`${overviewId}-customize`}>{dirty?"Continue Customizing":"Customize"}</button>{!initialReport&&<button type="button" onClick={()=>setReload(reload+1)} disabled={visiblePending}>{visiblePending?"Refreshing…":"Refresh"}</button>}</div></header>
    {initialReport&&<p className="dashboard-sample-banner">Sample Preview · Fictional Data · Changes stay in this preview</p>}
    {recovery&&<div className="executive-preference-status" role="status"><p>An unsaved layout is available from this tab. Restore it to review before saving. Financial targets and named views were not stored.</p><button type="button" onClick={()=>{setDraft(recovery);setRecovery(null);setPreferenceStatus("Layout draft restored for review. Nothing has been saved.");setShowCustomize(true);}}>Restore Layout Draft</button><button type="button" onClick={discardDraft}>Discard Draft</button></div>}
    {showCustomize&&<DashboardCustomizer draft={draft} onChange={next=>{setDraft(next);if(!changedSaved)setPreferenceError("");}} onClose={closeCustomizer} onDiscard={discardDraft} dirty={dirty} draftStatus={initialReport?"Changes stay in this preview until you save the sample layout.":draftStorageStatus||"Layout choices can be recovered in this tab for 24 hours. Target values, goal details and named views stay only in this open form until saved."} onSave={()=>void savePreferences()} saving={savingPreferences} error={preferenceError} currency={currency} industry={industry} period={report?.period} locationId={activeLocationId}/>}

    {preferenceStatus&&<p className="executive-preference-status" role="status">{preferenceStatus}</p>}
    {!showCustomize&&preferenceError&&<p className="executive-preference-status" role="alert">{preferenceError} {!preferencesReady&&<button type="button" onClick={()=>{setPreferenceError("");setPreferenceRetry(value=>value+1);}}>Retry Saved Layout</button>}</p>}
    {!initialReport&&<div className="executive-filters"><label>Period <select aria-label="Reporting period" value={showDates?"custom":preset} onChange={event=>{const key=event.target.value;if(key==="custom"){if(report)setRange({from:report.period.from,to:report.period.to});setShowDates(true);}else{setPreset(key);setShowDates(false);}}}>{periods.map(([key,,description])=><option key={key} value={key}>{description}</option>)}</select></label><label>Compare <select value={compare} onChange={e=>setCompare(e.target.value)}><option value="previous">Previous period</option><option value="yoy">Previous year</option><option value="budget">Budget</option><option value="target">Target</option></select></label></div>}
    {showDates&&<form id={`${overviewId}-dates`} className="executive-dates" aria-label="Custom reporting dates" onSubmit={e=>{e.preventDefault();setAppliedRange(range);setPreset("custom");setShowDates(false);}}><label>From <input type="date" required value={range.from} onChange={e=>setRange({...range,from:e.target.value})}/></label><label>To <input type="date" required min={range.from} value={range.to} onChange={e=>setRange({...range,to:e.target.value})}/></label><button type="submit">Apply Dates</button><button type="button" onClick={()=>setShowDates(false)}>Cancel</button></form>}
    {visiblePending?<WorkspaceSkeleton label="Loading executive overview" variant="overview" heading={false} compact={compact} overview={preferences} summary={basis==="commerce"}/>:visibleError&&sourceGate?<ExecutiveStatusFrame message={visibleError} syncing={sourceGate==="SOURCE_SYNCING"} preferences={preferences} onSources={()=>navigate("Reports")} onConnections={()=>navigate("Integrations")} onRetry={()=>setReload(reload+1)}/>:visibleError?<div className="executive-error" role="alert"><p>{visibleError}</p><button onClick={()=>setReload(reload+1)}>Try Again</button></div>:report&&<>
      {!initialReport&&report.bankCash&&<section className="executive-bank-cash" aria-label="Latest connected bank cash"><div><span>{report.bankCash.label}</span><strong>{display(report.bankCash.balanceCents,"money",currency)}</strong></div><div><p>{report.bankCash.reason??"Reviewed bank-feed balances, shown separately from the selected reporting period."}</p><small>{report.bankCash.oldestSyncAt?("Oldest included balance updated "+formatRecordedTimestamp(report.bankCash.oldestSyncAt)):"Balance update unavailable"} · {report.bankCash.accountsUsed} eligible accounts</small><details><summary>How this differs from ledger cash</summary><p>{report.bankCash.boundary}</p></details></div><button type="button" onClick={()=>navigate("Integrations")}>{report.bankCash.balanceCents===null?"Review bank source":"Manage bank source"}</button></section>}
      <div className="executive-period-label"><span>{date(report.period.from)} to {date(report.period.to)}, {report.period.to.slice(0,4)} · {currency}</span><span>{basis==="commerce"&&!report.sourceCoverage?"Add or review records to complete this period.":"Select a card to explore its trend and source."}</span></div>
      <div className="executive-kpis" ref={metricGrid} role="group" aria-label="Select a metric to inspect its trend and sources">{visibleMetrics.map(m=>{
        const goal=goalResult(m.value===null?null:m.unit==="money"?m.value/100:m.unit==="percent"?m.value*100:m.value,preferences.targets[m.key],preferences.goalRules[m.key],{...report.period,locationId:activeLocationId,eligible:m.goalEligible===true});
        const savedTarget=goal.progress!==null||goal.complete?preferences.targets[m.key]:undefined;
        const target=compare==="target"?(savedTarget!==undefined?(m.unit==="percent"?savedTarget*.01:m.unit==="count"?savedTarget:Math.round(savedTarget*100)):null):m.budget;
        const validTarget=target!==null&&Number.isFinite(target)?target:null;
        const benchmark=compare==="budget"||compare==="target"?validTarget:m.previous;
        const variance=m.value!==null&&benchmark!==null?m.value-benchmark:null;
        const percent=variance!==null&&benchmark!==null?(m.unit==="percent"?variance*100:benchmark!==0?variance/Math.abs(benchmark)*100:null):null;
        const size=orderedWidgets.get(m.key)?.size??"standard";
        const hasTrend=m.trend.some(point=>point.value!==null);
        const updated=formatRecordedTimestamp(m.sourceTimestamp);
        return <button type="button" key={m.key} id={`${overviewId}-${m.key}`} className={`executive-kpi size-${size} ${metric?.key===m.key?"selected":""}`} aria-pressed={metric?.key===m.key} aria-haspopup="dialog" aria-expanded={metricOpen&&metric?.key===m.key} onClick={event=>selectMetric(m.key,event.currentTarget)}>
          <span className="executive-kpi-label">{m.label}<i aria-hidden="true">↗</i></span>
          <strong className={m.value===null?"unavailable":""}>{m.value===null?"—":display(m.value,m.unit,currency)}</strong>
          <span className={`executive-change${percent===null?"":percent>0?" change-up":percent<0?" change-down":""}`}>{percent===null?(m.value===null?"Ready for your records":"Comparison not yet available"):`${percent>0?"+":""}${number(percent)}${m.unit==="percent"?" pp":"%"}`}{percent!==null&&<small>{compare==="previous"?"vs previous period":compare==="yoy"?"vs previous year":compare==="target"?"vs your target":"vs ledger budget"}</small>}</span>
          {m.previous!==null&&<span className="executive-prior">Previous: {display(m.previous,m.unit,currency)}</span>}
          {(compare==="target"||compare==="budget"||validTarget!==null)&&<span className="executive-target">{compare==="target"?"Target":"Budget"}: {validTarget===null?"Not set":display(validTarget,m.unit,currency)}{m.value!==null&&validTarget!==null?` · ${m.unit==="percent"?`${number((m.value-validTarget)*100)} pp`:display(m.value-validTarget,m.unit,currency)} variance`:""}</span>}
          <div className="executive-mini-chart">{hasTrend?<MetricSparkline values={m.trend.map(point=>point.value??NaN)} tone="indigo"/>:<span className="executive-empty-spark" aria-label="Empty trend grid, no recorded values"><i/><i/><i/></span>}</div>
          <span className="executive-source"><span>{m.source.replaceAll("_"," ")}</span><small>{updated?`Updated ${updated}`:m.value===null?"View setup & sources":"Update time unavailable"}</small></span>
        </button>;
      })}{!visibleMetrics.length&&<div className="executive-no-widgets"><b>No metrics are visible.</b><span>Open Customize and choose the metrics you want to monitor.</span></div>}</div>
      <div className="executive-visual-grid executive-workbench">
      {metric&&<article className="executive-detail" id={`${overviewId}-detail`} ref={detailPanel} tabIndex={-1} aria-labelledby={`${overviewId}-metric-title`}><header><div><h3 id={`${overviewId}-metric-title`}>{metric.key==="net_revenue"?"Sales performance":`${metric.label} performance`}</h3><span>{metric.formula}</span></div><div className="executive-detail-actions"><button type="button" onClick={()=>{const selectedButton=metricGrid.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');reveal(selectedButton??null);}}>All Metrics</button><button type="button" onClick={()=>navigate(metric.drill,{from:report.period.from,to:report.period.to})}>View Records ↗</button></div></header>{compare==="target"&&<button type="button" className="executive-target-input" onClick={openCustomizer}>Edit Comparison Targets</button>}<ExecutiveTrend key={metric.key+report.period.from+report.period.to} metric={metric} currency={currency} chart={preferences.chart} compact={compact} showTable={false} period={report.period} onSetup={()=>navigate(metric.drill==="BookLoQ"?"BookLoQ":"Integrations")}/><details className="executive-source-details" key={metric.key}><summary>Source, Coverage and Calculation</summary>{metric.key==="net_revenue"&&<RevenueSourceDetail attribution={report.revenueSources} currency={currency} onOpenRecords={()=>navigate("Sales",{from:report.period.from,to:report.period.to})}/>}<dl><div><dt>Source</dt><dd>{metric.source.replaceAll("_"," ")}</dd></div><div><dt>Last Updated</dt><dd>{formatRecordedTimestamp(metric.sourceTimestamp)??(metric.value===null?"Awaiting source":"Update time unavailable")}</dd></div><div><dt>Confidence</dt><dd>{metric.confidence}</dd></div></dl>{metric.reason&&<p>{metric.reason}</p>}<p>Current: {report.period.from} to {report.period.to}. Comparison: {report.period.comparisonFrom} to {report.period.comparisonTo}.</p>{metric.limitations.map((line,i)=><p key={i}>{line}</p>)}<p>Budget variance requires a complete ledger budget covering these exact dates. POS and ledger totals are not interchangeable.</p></details></article>}

      {!compact&&<>
      <OperatingRing locationId={activeLocationId} report={report} preferences={preferences} currency={currency} onCustomize={openCustomizer}/>
      {preferences.sections.needsAttention&&<div className="executive-insights"><header><h3>Needs your attention</h3><button onClick={()=>navigate("Intelligence")}>Explore Drivers ↗</button></header>{report.insights.length?report.insights.slice(0,3).map(item=><details key={item.id}><summary>{item.title}<small>{item.confidence} confidence</small></summary><p><b>What changed:</b> {item.whatHappened}</p><p><b>Possible driver:</b> {item.probableCause}</p><p><b>Financial impact:</b> {item.financialImpact}</p><p><b>Next step:</b> {item.recommendedAction}</p><p>These are patterns in recorded data, not proof of a cause.</p></details>):<div className="executive-insight-empty"><span aria-hidden="true">↗</span><b>Your next decision starts here.</b><p>Review a sales import or connect a source. Patterns and changes appear when there is enough history to compare.</p><button type="button" onClick={()=>navigate("Integrations")}>Review Connections</button></div>}</div>}
      <OverviewAdvisor report={report} sample={Boolean(initialReport)} onAsk={onAsk?question=>onAsk({question,from:report.period.from,to:report.period.to,locationId:activeLocationId??null}):undefined} onExplore={()=>navigate("Intelligence",{from:report.period.from,to:report.period.to})}/>
      </>}</div>
      {!compact&&preferences.sections.collections&&<InvoiceOverview currency={currency} sample={Boolean(initialReport)} sampleEmpty={!report.sourceCoverage} sampleAsOf={report.period.to} onOpen={()=>navigate("BookLoQ")}/>}
      {!compact&&basis==="commerce"&&<ExecutiveSummaryPanels report={report} currency={currency} onRecords={()=>navigate("Sales",{from:report.period.from,to:report.period.to})} onConnect={()=>navigate("Integrations")}/>}
      {!compact&&preferences.sections.financialDetail&&(report.finance?<FinanceDetails data={report.finance} currency={currency}/>:<details className="executive-financial-details"><summary>Financial Detail</summary><p>{report.financeReason??"Activate BookLoQ and post your reviewed records to see period-specific statements, aging and ratios."}</p><button onClick={()=>navigate("BookLoQ")}>Open BookLoQ</button></details>)}
    </>}
    <ExpandingSurface open={metricOpen} onClose={()=>setMetricOpen(false)} originRef={metricOrigin} title={metric?.label??"Metric details"}>
      {visiblePending?<div role="status" className="metric-detail-state"><b>Updating this view</b><p>The selected reporting period is being checked. Values will appear when it finishes.</p></div>:visibleError?<div role="alert" className="metric-detail-state"><p>{visibleError}</p><button type="button" onClick={()=>setReload(value=>value+1)}>Try again</button></div>:metric&&report?<div className="executive-overview metric-expanded-content">
        <p className="metric-detail-context">{date(report.period.from)} to {date(report.period.to)}, {report.period.to.slice(0,4)} · {currency}{initialReport?" · Fictional sample":""}</p>
        <div className="metric-detail-values"><article><span>Recorded {metric.label.toLowerCase()}</span><strong>{display(metric.value,metric.unit,currency)}</strong></article><article><span>{compare==="yoy"?"Previous year":"Previous comparable period"}</span><strong>{display(metric.previous,metric.unit,currency)}</strong></article></div>
        <p className="metric-detail-formula">{metric.formula}</p>
        <ExecutiveTrend metric={metric} currency={currency} chart={preferences.chart} period={report.period} onSetup={()=>{setMetricOpen(false);navigate(metric.drill==="BookLoQ"?"BookLoQ":"Integrations");}}/>
        <details className="executive-source-details"><summary>Source, coverage and calculation</summary>{metric.key==="net_revenue"&&<RevenueSourceDetail attribution={report.revenueSources} currency={currency} onOpenRecords={()=>{setMetricOpen(false);navigate("Sales",{from:report.period.from,to:report.period.to});}}/>}<dl><div><dt>Source</dt><dd>{metric.source.replaceAll("_"," ")}</dd></div><div><dt>Updated</dt><dd>{formatRecordedTimestamp(metric.sourceTimestamp)??"Update time unavailable"}</dd></div><div><dt>Confidence</dt><dd>{metric.confidence}</dd></div></dl>{metric.reason&&<p>{metric.reason}</p>}<p>Comparison: {report.period.comparisonFrom} to {report.period.comparisonTo}.</p>{metric.limitations.map((line,index)=><p key={index}>{line}</p>)}</details>
        <button type="button" className="metric-record-action" onClick={()=>{setMetricOpen(false);navigate(metric.drill,{from:report.period.from,to:report.period.to});}}>Open source records ↗</button>
      </div>:<div className="metric-detail-state"><p>This metric is no longer available in the selected view.</p></div>}
    </ExpandingSurface>
  </section>;
}

function OverviewAdvisor({report,sample,onAsk,onExplore}:{report:ExecutiveReport;sample:boolean;onAsk?:(question:string)=>void;onExplore:()=>void}) {
  const [question,setQuestion]=useState("");
  const questionId=useId();
  const hasRecords=report.metrics.some(metric=>metric.value!==null);
  const suggestion=hasRecords?"What changed in this period, and what should I review first?":"Which records should I connect to understand my business?";
  return <aside className="executive-advisor" aria-label="Vanteloq AI">
    <header><VanteloqAiLogo size={28} decorative/><h3>Vanteloq AI</h3><span>{sample?"Preview":"Ask your business"}</span></header>
    <h4>{hasRecords?"Turn a change into a next step.":"Start with a clearer picture."}</h4>
    <p>{hasRecords?"Explore your sales, margins and next steps using the records you choose to share.":"Find out which sales, costs and cash records will make your overview useful."}</p>
    {onAsk?<><button type="button" className="advisor-question" onClick={()=>onAsk(suggestion)}>{suggestion}<span aria-hidden="true">↗</span></button><form onSubmit={event=>{event.preventDefault();const value=question.trim();if(value && value.length<=ADVISOR_QUESTION_LIMIT)onAsk(value);}}><label className="sr-only" htmlFor={questionId}>Ask about your business</label><input id={questionId} value={question} maxLength={ADVISOR_QUESTION_LIMIT} onChange={event=>setQuestion(event.target.value)} placeholder="Ask about your business…"/><button type="submit" aria-label="Open question in Vanteloq AI" disabled={!question.trim()||question.trim().length>ADVISOR_QUESTION_LIMIT}>↑</button></form></>:<button type="button" className="advisor-question" onClick={onExplore}>{sample?"Explore the interactive demo":"Explore your insights"}<span aria-hidden="true">↗</span></button>}
    <small>{sample?"Preview only. No AI answer has been generated.":"You control which workspace data AI can use."}</small>
  </aside>;
}

function OperatingRing({report,preferences,currency,onCustomize,locationId}:{report:ExecutiveReport;preferences:DashboardPreferences;currency:string;onCustomize:()=>void;locationId?:string|null}) {
  const [selected,setSelected]=useState<string>(preferences.goalRings[0]);
  const goals=preferences.goalRings.map((key,index)=>{
    const metric=report.metrics.find(m=>m.key===key), stored=preferences.targets[key];
    const actual=metric?.value==null?null:metric.unit==="money"?metric.value/100:metric.unit==="percent"?metric.value*100:metric.value;
    const result=goalResult(actual,stored,preferences.goalRules[key],{...report.period,locationId,eligible:metric?.goalEligible===true});
    return {key,index,metric,stored,actual,label:metric?.label??key,...result};
  });
  const active=goals.find(goal=>goal.key===selected)??goals[0];
  const configured=goals.filter(g=>g.stored!==undefined),complete=goals.filter(g=>g.complete).length;
  const value=(amount:number,unit:string|undefined)=>unit==="money"?`${currency} ${number(amount)}`:`${number(amount)}${unit==="percent"?"%":""}`;
  return <section className="executive-operating-ring interactive-operating-goals" aria-label="Your goals">
    <div className="operating-goal-ring-stage"><InteractiveGoalRings goals={goals} selected={active?.key??""} onSelect={setSelected} label="Select a goal to inspect progress"/></div>
    <div className="operating-ring-copy"><h3>Business Pulse</h3>
      <span>{configured.length?`${complete} of ${configured.length} goals reached.`:"Choose a target to get started."} Select a ring to explore.</span>
      <div className="operating-selected-goal" aria-live="polite" aria-atomic="true"><b>{active?.label}</b>
        <span>{active?.progress!=null&&active.actual!=null?`${value(active.actual,active.metric?.unit)} recorded`:active?.status}</span>
        {active?.stored!==undefined&&<small>Target {value(active.stored,active.metric?.unit)}</small>}
      </div>
    </div>
    <div className="operating-goal-list" role="group" aria-label="Goal details">{goals.map(g=><button type="button" key={g.key} aria-pressed={active?.key===g.key} onClick={()=>setSelected(g.key)}>
      <i className={`ring-${["sales","margin","cash"][g.index]}`} aria-hidden="true"/><b>{g.label}</b>
      <small>{g.progress!==null?`${number(g.progress)}% of target`:g.status}</small><span className={`goal-progress-track ring-tone-${g.index}`} aria-hidden="true"><span style={{width:`${g.visual}%`}}/></span>
      {g.stored!==undefined&&<small>Target {value(g.stored,g.metric?.unit)}{preferences.goalRules[g.key]?` · ${preferences.goalRules[g.key]!.to}`:""}</small>}
    </button>)}</div>
    <div className="operating-ring-action"><button type="button" onClick={onCustomize}>Edit Goals</button><details><summary>How Progress Works</summary><span>Targets use their saved dates and location. Progress through {report.period.to} follows eligible recorded data. Missing or incomplete inputs do not count as progress. The ring stops at 100%; the label preserves results above target. Ledger progress describes posted records, not an audit. Lower targets without a starting value show attainment only.</span></details></div>
  </section>;
}

function FinanceDetails({data,currency}:{data:NonNullable<ExecutiveReport["finance"]>;currency:string}) {
  const f=data.current,b=data.closing;
  const rows=(items:[string,number|null][])=> <dl>{items.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{cash(value,currency)}</dd></div>)}</dl>;
  return <details className="executive-financial-details"><summary>Financial Detail <span>P&amp;L, cash flow, aging and working capital</span></summary><p>{data.boundary}</p><div className="executive-finance-grid"><article><h4>Profit and Loss</h4>{f?rows([["Operating revenue",f.operatingRevenueCents],["Cost of goods sold",data.accountCoverage.costs?-f.cogsCents:null],["Gross profit",data.accountCoverage.costs?f.grossProfitCents:null],["Operating expenses",-f.operatingExpensesCents],["Operating profit",data.accountCoverage.costs?f.operatingProfitCents:null],["Other income",f.otherIncomeCents],["Finance costs and income tax",-f.financeAndTaxCents],["Recorded net earnings",data.accountCoverage.costs?f.netProfitCents:null]]):<p>No posted entries in this period.</p>}</article><article><h4>Balance Sheet</h4>{rows([["Assets",b.assetsCents],["Liabilities",b.liabilitiesCents],["Equity including recorded earnings",b.equityCents],["Balance check",b.balanceDifferenceCents]])}<p>A balanced ledger is a bookkeeping check, not an audit.</p></article><article><h4>Cash Flow by Activity</h4>{data.cashClassification&&data.accountCoverage.cash?rows([["Operating",data.cashClassification.operating],["Investing",data.cashClassification.investing],["Financing",data.cashClassification.financing],["Needs classification review",data.cashClassification.unclassified],["Net recorded movement",data.cashClassification.total]]):<p>Use the detailed ledger to review this volume of entries.</p>}<p>Only unambiguous account classifications are assigned. Mixed journals, interest and income tax require review.</p></article><article><h4>Liquidity and Tax</h4>{rows([["Working capital",b.workingCapitalCents],["Monthly net cash burn",data.monthlyBurnCents],["GST collected",b.gstCollectedCents],["GST recoverable",b.gstRecoverableCents],["Net recorded GST",b.gstNetCents]])}<p>Current ratio: {number(b.currentRatio)} · Quick ratio: {number(b.quickRatio)}</p><p>Cash runway: {number(data.runwayMonths)}{data.runwayMonths===null?"":" months"}. Ratios require classified current balances. Tax figures are working papers, not a filed return.</p></article>{[["Receivables",data.receivables],["Payables",data.payables]].map(([label,buckets])=><article key={String(label)}><h4>{String(label)} Aging</h4>{Array.isArray(buckets)?rows(buckets.map(row=>[row.label,row.cents])):<p>{data.agingBoundary}</p>}</article>)}<article><h4>Expenses by Category</h4>{f?rows(f.expenseCategories.filter(r=>r.cents!==0).map(r=>[r.name,r.cents])):<p>No posted expense entries.</p>}</article><article><h4>Expenses by Supplier</h4>{data.vendors.length?rows(data.vendors.map(r=>[r.name,r.cents])):<p>Named supplier records require the appropriate contact permission.</p>}</article></div></details>;
}
