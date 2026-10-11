"use client";
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import ExecutiveOverview from './executive-overview';
import DashboardGreeting from './dashboard-greeting';
import ProductBrandLogo from './product-brand-logo';
import WorkspaceIcon from './workspace-icon';
import { dashboardDemoPreferences, dashboardDemoReport } from './dashboard-demo-report';
import { setMotionPreference, useMotionPreference } from './use-motion-preference';
import './home-dashboard-preview.css';

export default function HomeDashboardPreview() {
  const [empty, setEmpty] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const previewId = useId();
  const monitor = useRef<HTMLDivElement>(null);
  const entryPlayed = useRef(false);
  const pointerFrame = useRef(0);
  const motion = useMotionPreference();
  const [reducedMotion, setReducedMotion] = useState(false);
  const report = useMemo(() => dashboardDemoReport('all', empty), [empty]);
  const preferences = useMemo(() => dashboardDemoPreferences(report), [report]);

  useEffect(() => {
    const element = monitor.current;
    if (!motion || !element || entryPlayed.current || document.hidden || element.contains(document.activeElement) || !element.animate) return;
    entryPlayed.current = true;
    const animation = element.animate([{ opacity: .92, translate: '0 10px' }, { opacity: 1, translate: '0 0' }], { duration: 650, easing: 'cubic-bezier(.16,1,.3,1)' });
    const cancel = () => animation.cancel();
    const visibility = () => { if (document.hidden) cancel(); };
    element.addEventListener('focusin', cancel); element.addEventListener('pointerdown', cancel); document.addEventListener('visibilitychange', visibility);
    return () => { cancel(); element.removeEventListener('focusin', cancel); element.removeEventListener('pointerdown', cancel); document.removeEventListener('visibilitychange', visibility); };
  }, [motion]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const read = () => setReducedMotion(media.matches);
    read(); media.addEventListener('change', read); return () => media.removeEventListener('change', read);
  }, []);
  useEffect(() => {
    if (motion) return;
    cancelAnimationFrame(pointerFrame.current); pointerFrame.current = 0;
    monitor.current?.style.removeProperty('--monitor-light-x');
  }, [motion]);
  useEffect(() => () => cancelAnimationFrame(pointerFrame.current), []);
  const resetLight = () => {
    cancelAnimationFrame(pointerFrame.current); pointerFrame.current = 0;
    monitor.current?.style.removeProperty('--monitor-light-x');
  };

  return <div className={`home-live-product${expanded ? ' is-expanded' : ''}`} data-motion-surface>
    <div className="home-live-controls">
      <span>EXPLORE YOUR DASHBOARD</span>
      <button type="button" aria-pressed={empty} onClick={() => setEmpty(!empty)}>{empty ? 'Show sample records' : 'Before connecting'}</button>
      <button type="button" aria-expanded={expanded} aria-controls={previewId} onClick={() => setExpanded(!expanded)}>{expanded ? 'Show overview' : 'Show more detail'}</button>
      <button type="button" className="home-motion-toggle" aria-pressed={motion} disabled={reducedMotion} title={reducedMotion ? 'Your device is set to reduce motion.' : 'Turn interface motion on or off.'} onClick={() => setMotionPreference(!motion)}>{reducedMotion ? 'Reduced motion' : motion ? 'Motion on' : 'Motion off'}</button>
    </div>
    <div className="home-monitor" ref={monitor} onPointerLeave={resetLight} onPointerMove={event => {
      if (!motion || event.pointerType !== 'mouse' || document.hidden || pointerFrame.current) return;
      const clientX = event.clientX;
      pointerFrame.current = requestAnimationFrame(() => {
        pointerFrame.current = 0;
        const element = monitor.current; if (!element) return;
        const box = element.getBoundingClientRect();
        element.style.setProperty('--monitor-light-x', `${Math.max(0, Math.min(100, (clientX - box.left) / Math.max(box.width, 1) * 100))}%`);
      });
    }}>
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
    <div className="home-monitor-stand" aria-hidden="true"><i/></div>
    <p className="home-live-caption">Select a metric, explore its source or try Customize. {!empty && 'Sample goals use previous-period results as illustrative targets, not business recommendations. '}<a href="/demo">Open the full demo <span aria-hidden="true">↗</span></a></p>
  </div>;
}
