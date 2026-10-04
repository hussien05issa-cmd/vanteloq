import assert from "node:assert/strict";
import test from "node:test";
import { dashboardPreferencePreset, normalizeDashboardPreferences } from "../domain/dashboard-preferences.ts";
import { DASHBOARD_DRAFT_LIFETIME, dashboardDraftScope, dashboardDraftKey, dashboardDraftFingerprint, serializeDashboardDraft, recoverDashboardDraft } from "../domain/dashboard-draft.ts";

const now = Date.UTC(2026, 9, 3, 12);

test("dashboard drafts are isolated by authenticated user and workspace", () => {
  assert.equal(dashboardDraftScope(null), null);
  assert.equal(dashboardDraftScope({userId:"owner",workspaceId:""}), null);
  assert.equal(dashboardDraftScope({userId:"a\n",workspaceId:"one"}), null);
  const scope=dashboardDraftScope({userId:"owner",workspaceId:"one",name:"not stored"})!;
  assert.deepEqual(scope,{userId:"owner",workspaceId:"one"});
  assert.notEqual(dashboardDraftKey(scope),dashboardDraftKey({...scope,userId:"member"}));
  assert.notEqual(dashboardDraftKey(scope),dashboardDraftKey({...scope,workspaceId:"two"}));
  assert.notEqual(dashboardDraftKey({userId:"a:b",workspaceId:"c"}),dashboardDraftKey({userId:"a",workspaceId:"b:c"}));
});

test("only presentation choices recover; financial values and named views never enter the cache", async () => {
  const saved=normalizeDashboardPreferences({...dashboardPreferencePreset(),targets:{net_revenue:47123},goalRules:{net_revenue:{direction:"higher",from:"2026-10-01",to:"2026-10-31",locationId:"private-location",start:41987}}});
  const draft=normalizeDashboardPreferences({...saved,chart:"bar",defaultPeriod:"7d",targets:{net_revenue:999887},views:[{name:"Private customer forecast 77123",layout:saved}],goalRules:{net_revenue:{...saved.goalRules.net_revenue,start:888773}}});
  const baseline=await dashboardDraftFingerprint(saved),raw=serializeDashboardDraft(draft,baseline,now);
  for(const secret of ["47123","41987","999887","888773","77123","Private customer","private-location",'"targets"','"goalRules"','"views"'])assert.equal(raw.includes(secret),false,secret);
  assert.equal(Object.hasOwn(JSON.parse(raw).layout,"collections"),false);
  const recovered=recoverDashboardDraft(raw,baseline,saved,now+1000);
  assert.equal(recovered.status,"available");
  assert.equal(recovered.draft!.chart,"bar");
  assert.equal(recovered.draft!.defaultPeriod,"7d");
  assert.deepEqual(recovered.draft!.targets,saved.targets);
  assert.deepEqual(recovered.draft!.goalRules,saved.goalRules);
  assert.deepEqual(recovered.draft!.views,saved.views);
  assert.deepEqual(recovered.draft!.collections,saved.collections);
});

test("draft recovery rejects changed baselines, expiry, future dates and unknown versions", async () => {
  const saved=dashboardPreferencePreset(),baseline=await dashboardDraftFingerprint(saved);
  const raw=serializeDashboardDraft({...saved,chart:"bar"},baseline,now),value=JSON.parse(raw);
  assert.equal(recoverDashboardDraft(raw,baseline,saved,now+DASHBOARD_DRAFT_LIFETIME-1).status,"available");
  assert.equal(recoverDashboardDraft(raw,baseline,saved,now+DASHBOARD_DRAFT_LIFETIME).status,"expired");
  assert.equal(recoverDashboardDraft(raw,baseline,saved,now-1).status,"invalid");
  assert.equal(recoverDashboardDraft(JSON.stringify({...value,version:2}),baseline,saved,now).status,"invalid");
  const changed=normalizeDashboardPreferences({...saved,targets:{net_revenue:1000}});
  assert.equal(recoverDashboardDraft(raw,await dashboardDraftFingerprint(changed),changed,now).status,"changed");
});

test("tampered, oversized and unchanged cached layouts cannot overwrite protected saved fields", async () => {
  const saved=dashboardPreferencePreset(),baseline=await dashboardDraftFingerprint(saved);
  const value=JSON.parse(serializeDashboardDraft({...saved,chart:"bar"},baseline,now));
  value.layout.targets={net_revenue:400000};value.layout.views=[{name:"Injected",layout:saved}];value.layout.goalRules={net_revenue:{from:"2026-10-01",to:"2026-10-31",locationId:"other"}};
  const recovered=recoverDashboardDraft(JSON.stringify(value),baseline,saved,now);
  assert.deepEqual(recovered.draft!.targets,saved.targets);assert.deepEqual(recovered.draft!.views,saved.views);assert.deepEqual(recovered.draft!.goalRules,saved.goalRules);
  assert.equal(recoverDashboardDraft("x".repeat(12001),baseline,saved,now).status,"invalid");
  assert.equal(recoverDashboardDraft("{",baseline,saved,now).status,"invalid");
  assert.equal(recoverDashboardDraft(serializeDashboardDraft(saved,baseline,now),baseline,saved,now).status,"none");
});
