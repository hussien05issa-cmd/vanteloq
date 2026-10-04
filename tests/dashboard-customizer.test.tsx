import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import DashboardCustomizer from "../app/dashboard-customizer";
import ExecutiveOverview from "../app/executive-overview";
import { dashboardPreferencePreset } from "../domain/dashboard-preferences";
import { dashboardDemoReport } from "../app/dashboard-demo-report";

const props={draft:dashboardPreferencePreset(),onChange:()=>{},onClose:()=>{},onSave:()=>{},saving:false,currency:"CAD"};

test("recoverable customization makes keep, discard and failed-save state explicit",()=>{
  const html=renderToStaticMarkup(<DashboardCustomizer {...props} onDiscard={()=>{}} dirty draftStatus="Layout choices stay in this tab." error="Could not save. Your changes are kept."/>);
  assert.match(html,/Close and keep dashboard draft/);
  assert.match(html,/Keep Draft &amp; Close/);
  assert.match(html,/Discard Changes/);
  assert.match(html,/role="status">Unsaved changes\. Layout choices stay in this tab\./);
  assert.match(html,/role="alert">Could not save\. Your changes are kept\./);
  assert.doesNotMatch(html,/<fieldset[^>]*disabled/);
});

test("saving locks draft inputs until the submitted layout finishes saving",()=>{
  const html=renderToStaticMarkup(<DashboardCustomizer {...props} saving dirty onDiscard={()=>{}}/>);
  assert.match(html,/<fieldset class="dashboard-drawer-body" disabled=""/);
  assert.match(html,/<button type="button" disabled="">Discard Changes/);
  assert.match(html,/<button type="button" disabled="">Keep Draft &amp; Close/);
  assert.match(html,/<button type="button" class="dashboard-save" disabled="">Saving/);
});

test("optional recovery controls preserve generic customizer behaviour",()=>{
  const html=renderToStaticMarkup(<DashboardCustomizer {...props}/>);
  assert.match(html,/Cancel dashboard changes/);
  assert.match(html,/>Cancel<\/button>/);
  assert.doesNotMatch(html,/Discard Changes|Keep Draft/);
});

test("live customization waits for saved preferences while demo customization is immediately available",()=>{
  const live=renderToStaticMarkup(<ExecutiveOverview currency="CAD" navigate={()=>{}}/>);
  const demo=renderToStaticMarkup(<ExecutiveOverview currency="CAD" initialReport={dashboardDemoReport()} navigate={()=>{}}/>);
  assert.match(live,/<button type="button" disabled=""[^>]*>Customize<\/button>/);
  assert.doesNotMatch(demo,/<button type="button" disabled=""[^>]*>Customize<\/button>/);
  assert.match(demo,/Changes stay in this preview/);
});
