import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToString } from 'react-dom/server';
import HomeDashboardPreview from '../app/home-dashboard-preview';
import ExecutiveOverview from '../app/executive-overview';
import DashboardGreeting from '../app/dashboard-greeting';
import { dashboardDemoPreferences, dashboardDemoReport } from '../app/dashboard-demo-report';
import { formatRecordedTimestamp } from '../domain/executive-presentation';

test('recorded timestamps use an explicit UTC instant and preserve unavailable values',()=>{
  assert.equal(formatRecordedTimestamp('2026-06-24T18:15:00-06:00'),'2026-06-25 00:15 UTC');
  assert.equal(formatRecordedTimestamp('not a timestamp'),null);
  assert.equal(formatRecordedTimestamp(null),null);
});

test('homepage and expanded dashboard first-render markup is independent of the server or browser time zone',()=>{
  const previousZone=process.env.TZ;
  try {
    const report=dashboardDemoReport(), preferences=dashboardDemoPreferences(report);
    // Exercise source attribution timestamps as well as KPI and selected-metric timestamps.
    report.revenueSources!.sources[0].updatedAt='2026-06-25T00:15:00Z';
    const render=()=>[
      renderToString(<HomeDashboardPreview/>),
      renderToString(<ExecutiveOverview currency="CAD" initialReport={report} initialPreferences={preferences} navigate={()=>{}}/>),
      renderToString(<DashboardGreeting accountName="Alex" sourceName="Reviewed records" latestBusinessDate="2026-06-25" lastSuccessfulSyncAt="2026-06-25T00:15:00Z" needsAttention={false} onConnections={()=>{}}/>),
    ];
    process.env.TZ='UTC';
    const server=render();
    assert.match(server[2],/Welcome back/);
    assert.match(server[2],/Last sync recorded/);
    for (const zone of ['America/Denver','Asia/Tokyo']) {
      process.env.TZ=zone;
      const clientInitial=render();
      for (let index=0; index<server.length; index++) assert.ok(clientInitial[index]===server[index],`First-render markup ${index} must match with a ${zone} browser`);
    }
  } finally {
    if (previousZone===undefined) delete process.env.TZ; else process.env.TZ=previousZone;
  }
});
