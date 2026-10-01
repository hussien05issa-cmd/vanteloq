"use client";
import { useState } from 'react';
import { executiveDefinitions } from '../domain/executive-metrics';
import { overviewPriorities, recommendedOverview } from '../domain/dashboard-personalization';
import type { DashboardPreferences } from '../domain/dashboard-preferences';
import './dashboard-personalization.css';

export default function BuildYourOverview({industry,value,onChange}:{industry:string;value:DashboardPreferences;onChange:(next:DashboardPreferences)=>void}) {
  const [choose,setChoose]=useState(false);
  const visible=value.widgets.filter(w=>w.visible);
  return <section className="build-overview" aria-label="Build your overview">
    <p>A starting layout for {industry.toLowerCase()}. Choose what matters now. You can change everything later.</p>
    <div className="overview-priorities">{overviewPriorities.map(([id,label,description])=><button type="button" key={id} aria-pressed={value.priorities.includes(id)} onClick={()=>onChange(recommendedOverview(industry,value.priorities.includes(id)?value.priorities.filter(p=>p!==id):[...value.priorities,id]))}><b>{label}</b><span>{description}</span><i aria-hidden="true">{value.priorities.includes(id)?'✓':'+'}</i></button>)}</div>
    <div className="onboarding-layout-preview" aria-label="Your layout preview"><header><b>Your Layout Preview</b><span>{visible.length} metrics · No sample amounts</span></header><div>{visible.map(w=><article key={w.id}><span>{executiveDefinitions.find(m=>m.key===w.id)?.label}</span><b>—</b><small>Connect a source</small></article>)}</div><section><b>Performance Trend</b><div className="onboarding-preview-grid"/><small>Your recorded trend appears here.</small></section>{value.sections.collections&&<p>Invoices &amp; Bills · Current balances and due dates</p>}</div>
    <div className="overview-choice-actions"><button type="button" onClick={()=>{onChange(recommendedOverview(industry));setChoose(false);}}>Use Recommended Layout</button><button type="button" aria-expanded={choose} onClick={()=>setChoose(!choose)}>Choose My Metrics</button></div>
    {choose&&<fieldset><legend>Metrics to Show</legend>{value.widgets.map((w,index)=><label key={w.id}><input type="checkbox" checked={w.visible} onChange={e=>onChange({...value,widgets:value.widgets.map((item,i)=>i===index?{...item,visible:e.target.checked}:item)})}/>{executiveDefinitions.find(m=>m.key===w.id)?.label}</label>)}</fieldset>}
    <p>Recommendations are starting points, not universal benchmarks. Financial panels depend on your plan, permissions and records.</p>
  </section>;
}
