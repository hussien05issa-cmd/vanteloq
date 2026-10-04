"use client";
import { useId, useMemo, useState } from 'react';
import ExecutiveOverview from './executive-overview';
import DashboardGreeting from './dashboard-greeting';
import ProductBrandLogo from './product-brand-logo';
import WorkspaceIcon from './workspace-icon';
import { dashboardDemoPreferences, dashboardDemoReport } from './dashboard-demo-report';
import './home-dashboard-preview.css';

export default function HomeDashboardPreview() {
  const [empty, setEmpty] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const previewId = useId();
  const report = useMemo(() => dashboardDemoReport('all', empty), [empty]);
  const preferences = useMemo(() => dashboardDemoPreferences(report), [report]);

  return <div className={`home-live-product${expanded ? ' is-expanded' : ''}`}>
    <div className="home-live-controls">
      <span>EXPLORE YOUR DASHBOARD</span>
      <button type="button" aria-pressed={empty} onClick={() => setEmpty(!empty)}>{empty ? 'Show sample records' : 'Before connecting'}</button>
      <button type="button" aria-expanded={expanded} aria-controls={previewId} onClick={() => setExpanded(!expanded)}>{expanded ? 'Show overview' : 'Show more detail'}</button>
    </div>
    <div className="home-monitor">
      <div className="home-monitor-body">
        <aside className="home-preview-sidebar">
          <div className="home-preview-brand"><ProductBrandLogo product="vanteloq"/><b>Vanteloq</b></div>
          <div className="home-preview-workspace"><strong>Sample workspace</strong><span>Retail · CAD</span></div>
          <nav aria-label="Explore product demo">
            <a href="/demo#retail" aria-label="Explore the overview" className="is-current"><WorkspaceIcon name="Dashboard"/><span>Overview</span></a>
            {[["Sales", "retail"], ["Inventory", "inventory"], ["BookLoQ", "bookloq"]].map(([name, anchor]) => <a key={name} aria-label={`Explore ${name}`} href={`/demo#${anchor}`}><WorkspaceIcon name={name}/><span>{name}</span></a>)}
            <a href="#connections" aria-label="Explore connections"><WorkspaceIcon name="Integrations"/><span>Connections</span></a>
            <a href="#vanteloq-ai" className="home-preview-ai-link"><WorkspaceIcon name="Vanteloq AI"/><span>Vanteloq AI</span></a>
          </nav>
          <small>Vanteloq 1.0 Origin<br/>Fictional sample records</small>
        </aside>
        <div className="home-monitor-main">
          <div className="home-monitor-top"><span>Workspace <i aria-hidden="true">/</i> <b>Overview</b></span><span className="home-preview-data-badge">Sample data</span><a href="#connections">Connect your business <span aria-hidden="true">↗</span></a></div>
          <div className="home-monitor-screen" id={previewId}>
            <DashboardGreeting accountName="" sourceName="Sample receipts" latestBusinessDate={empty ? null : report.period.to} lastSuccessfulSyncAt={null} needsAttention={false} showSourceStatus={false} onConnections={() => { window.location.hash = 'connections'; }}/>
            <ExecutiveOverview key={empty ? 'empty' : 'sample'} currency="CAD" industry="Retail" compact={false} initialReport={report} initialPreferences={preferences} navigate={view => { window.location.href = view === 'Integrations' ? '#connections' : view === 'BookLoQ' ? '/demo#bookloq' : view === 'Intelligence' ? '#vanteloq-ai' : '/demo#retail'; }}/>
          </div>
        </div>
      </div>
    </div>
    <p className="home-live-caption">Select a metric, explore its source or try Customize. {!empty && 'Sample goals use previous-period results as illustrative targets, not business recommendations. '}<a href="/demo">Open the full demo <span aria-hidden="true">↗</span></a></p>
  </div>;
}
