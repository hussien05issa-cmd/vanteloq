"use client";
import { useMemo, useState } from 'react';
import ExecutiveOverview from './executive-overview';
import DashboardGreeting from './dashboard-greeting';
import ProductBrandLogo from './product-brand-logo';
import WorkspaceIcon from './workspace-icon';
import { dashboardDemoPreferences, dashboardDemoReport } from './dashboard-demo-report';
import './home-dashboard-preview.css';

export default function HomeDashboardPreview() {
  const [empty,setEmpty]=useState(false),[expanded,setExpanded]=useState(false);
  const report=useMemo(()=>dashboardDemoReport('all',empty),[empty]);
  const preferences=useMemo(()=>dashboardDemoPreferences(report),[report]);
  return <div className={`home-live-product${expanded?' is-expanded':''}`}>
    <div className="home-live-controls"><span>REAL INTERFACE · SAMPLE RECORDS</span><button type="button" aria-pressed={empty} onClick={()=>setEmpty(!empty)}>{empty?'Show Sample Data':'Before Connecting'}</button><button type="button" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?'Compact View':'Expand Dashboard'}</button></div>
    <div className="home-monitor"><div className="home-monitor-top"><ProductBrandLogo product="vanteloq"/><b>Vanteloq</b><span>Sample workspace</span></div><div className="home-monitor-body"><nav className="home-preview-sidebar" aria-label="Explore product demo"><a href="/demo#retail" aria-label="Explore the overview" className="is-current"><WorkspaceIcon name="Dashboard"/><span>Overview</span></a>{[["Sales","retail"],["Inventory","inventory"],["BookLoQ","bookloq"]].map(([name,anchor])=><a key={name} aria-label={"Explore "+name} href={"/demo#"+anchor}><WorkspaceIcon name={name}/><span>{name}</span></a>)}<a href="#connections" aria-label="Explore connections"><WorkspaceIcon name="Integrations"/><span>Connections</span></a><small>Vanteloq<br/>v1.0 Origin</small></nav><div className="home-monitor-screen">
      <DashboardGreeting accountName="" sourceName="Sample receipts" latestBusinessDate={empty?null:report.period.to} lastSuccessfulSyncAt={null} needsAttention={false} onConnections={()=>{window.location.hash='connections';}}/>
      <ExecutiveOverview key={empty?'empty':'sample'} currency="CAD" industry="Retail" compact={!expanded} initialReport={report} initialPreferences={preferences} navigate={view=>{window.location.href=view==='Integrations'?'#connections':view==='BookLoQ'?'/demo#bookloq':'/demo#retail';}}/>
    </div></div></div><div className="home-monitor-foot" aria-hidden="true"/>
    <p className="home-live-caption">Your dashboard, arranged around your work. Select a card or try Customize. {!empty&&'Sample goals use previous-period results as illustrative targets, not business recommendations. '}<a href="/demo">Open the Full Demo ↗</a></p>
  </div>;
}
