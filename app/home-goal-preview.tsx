"use client";
import { useMemo,useState } from "react";
import { dashboardDemoReport } from "./dashboard-demo-report";
import InteractiveGoalRings from "./interactive-goal-rings";
import { goalResult } from "../domain/dashboard-personalization";
export default function HomeGoalPreview(){
 const report=useMemo(()=>dashboardDemoReport(),[]),[selected,setSelected]=useState(0),[target,setTarget]=useState(30000);
 const items=[{key:"net_revenue",label:"Net Revenue",target,unit:"CAD"},{key:"gross_margin",label:"Gross Margin",target:55,unit:"%"},{key:"transactions",label:"Transactions",target:500,unit:"orders"}];
 const goals=items.map(item=>{const metric=report.metrics.find(m=>m.key===item.key)!;const actual=metric.value===null?null:metric.unit==="money"?metric.value/100:metric.unit==="percent"?metric.value*100:metric.value;return{...item,actual,...goalResult(actual,item.target,{direction:"higher",from:report.period.from,to:report.period.to,locationId:null},{...report.period,eligible:metric.goalEligible})};});
 const active=goals[selected];
 return <div className="home-goal-preview" data-motion-item="0"><div className="home-goal-ring-stage"><InteractiveGoalRings goals={goals} selected={active.key} onSelect={key=>setSelected(goals.findIndex(goal=>goal.key===key))} label="Explore sample goals"/></div><div className="home-goal-switches" role="group" aria-label="Sample goal">{goals.map((g,i)=><button type="button" key={g.key} aria-pressed={selected===i} onClick={()=>setSelected(i)}>{g.label}</button>)}</div><p>{active.unit==="CAD"?"CAD ":""}{active.actual?.toLocaleString("en-CA",{maximumFractionDigits:2})}{active.unit==="%"?"%":""} of {active.target.toLocaleString("en-CA")}{active.unit==="%"?"%":""} target</p><label>Try a revenue target<select value={target} onChange={e=>{setTarget(Number(e.target.value));setSelected(0);}}><option value={20000}>CAD 20,000</option><option value={30000}>CAD 30,000</option><option value={40000}>CAD 40,000</option></select></label><small>May 29 to June 25, 2026 · All sample locations<br/>Fictional records · Your dashboard uses the same calculations</small></div>;
}
