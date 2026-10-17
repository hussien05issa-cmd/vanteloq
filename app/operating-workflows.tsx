"use client";
import { lazy, Suspense, useState, type ReactNode } from "react";
import type { IndustryConfiguration } from "../domain/industry-templates";
import "./operating-workflows.css";
const InventoryWorkflows = lazy(() => import("./inventory-workflows"));
const SectorOperations = lazy(() => import("./sector-operations"));
const BusinessWorkflows = lazy(() => import("./business-workflows"));
const WorkflowFollowup = lazy(() => import("./workflow-followup"));

export function WorkflowDisclosure({ title, children }: { title: string; children: ReactNode }) {
  const [open,setOpen]=useState(false),[visited,setVisited]=useState(false);
  return <section className="workflow-disclosure"><button type="button" aria-expanded={open} onClick={()=>{setOpen(!open);setVisited(true);}}><span>{title}</span><span aria-hidden="true">{open?"−":"+"}</span></button>{visited&&<div hidden={!open}><Suspense fallback={<p role="status">Loading your tools…</p>}>{children}</Suspense></div>}</section>;
}

export default function OperatingWorkflows({activeLocationId,configuration,permissions,subscriptionFeatures,canScheduleBriefings=false,children}:{activeLocationId:string|null;configuration:IndustryConfiguration;permissions:readonly string[];subscriptionFeatures:readonly string[];canScheduleBriefings?:boolean;children:ReactNode}) {
  const [selected,setSelected]=useState("overview"),[visited,setVisited]=useState(["overview"]);
  const stock=subscriptionFeatures.includes("inventory.lots")&&configuration.capabilities.includes("products")&&permissions.includes("inventory.view")&&permissions.includes("inventory.value");
  const sector=["cafe","restaurant","furniture","dealership","hospitality"].includes(configuration.templateId);
  const choices=[{id:"overview",label:"Tasks & priorities"},...(stock?[{id:"stock",label:"Stock & purchasing"}]:[]),...(sector?[{id:"sector",label:configuration.templateId==="dealership"?"Funding & handover":configuration.templateId==="hospitality"?"Rooms & stays":configuration.templateId==="furniture"?"Orders & delivery":"Prep & service"}]:[]),{id:"work",label:"Work & results"},...(canScheduleBriefings?[{id:"briefings",label:"Daily briefings"}]:[])];
  const current=choices.some(x=>x.id===selected)?selected:"overview";
  return <div className="operating-workflows"><nav className="operating-workflow-tabs" aria-label="Operations tools">{choices.map(c=><button key={c.id} type="button" aria-pressed={current===c.id} onClick={()=>{setSelected(c.id);setVisited(v=>v.includes(c.id)?v:[...v,c.id]);}}>{c.label}</button>)}</nav>{choices.filter(c=>visited.includes(c.id)).map(c=><div className="operating-workflow-panel" hidden={current!==c.id} key={`${c.id}:${activeLocationId??"all"}`}><Suspense fallback={<p role="status">Loading your saved work…</p>}>{c.id==="overview"?children:c.id==="stock"?<InventoryWorkflows activeLocationId={activeLocationId}/>:c.id==="sector"?<SectorOperations activeLocationId={activeLocationId}/>:c.id==="briefings"?<WorkflowFollowup mode="briefings"/>:<BusinessWorkflows activeLocationId={activeLocationId}/>}</Suspense></div>)}</div>;
}
