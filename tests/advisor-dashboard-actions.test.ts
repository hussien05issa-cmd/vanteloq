import assert from "node:assert/strict";
import test from "node:test";
import { applyDashboardActions, dashboardReviewMatches, proposedDashboardActions } from "../domain/advisor-dashboard-actions";
import { dashboardPreferencePreset } from "../domain/dashboard-preferences";

test("explicit layout requests preserve independent actions and financial records", () => {
  const actions = proposedDashboardActions("Show cash balance and cash flow on my dashboard, hide net margin, and use a bar chart for the last 7 days.");
  assert.deepEqual(actions, [{kind:"chart",value:"bar"},{kind:"period",value:"7d"},{kind:"metric",id:"cash_balance",visible:true},{kind:"metric",id:"cash_flow",visible:true},{kind:"metric",id:"net_margin",visible:false}]);
  const before = dashboardPreferencePreset(); before.targets.net_revenue = 5000; before.views=[{name:"My saved view",layout: {...before, views:undefined, collections:undefined} as never}];
  const after=applyDashboardActions(before,actions);
  assert.equal(after.chart,"bar"); assert.equal(after.defaultPeriod,"7d");
  assert.equal(after.widgets.find(widget=>widget.id==="cash_balance")?.visible,true);
  assert.equal(after.widgets.find(widget=>widget.id==="net_margin")?.visible,false);
  assert.deepEqual(after.targets,before.targets); assert.deepEqual(after.collections,before.collections);
  assert.equal(after.views[0].name,"My saved view"); assert.equal(before.chart,"line");
});
test("negations, financial actions and ordinary analysis never turn into layout writes",()=>{
  for(const question of ["Why did revenue fall?","Show me a bar chart","Do not hide cash balance on my dashboard","Pay the invoice and change my dashboard","Delete the cash account from my dashboard","Show another user's dashboard"]){
    assert.deepEqual(proposedDashboardActions(question),[]);
  }
  const separate=proposedDashboardActions("Hide gross margin and show cash balance on my dashboard");
  assert.deepEqual(separate,[{kind:"metric",id:"gross_margin",visible:false},{kind:"metric",id:"cash_balance",visible:true}]);
});
test("review guard requires the same actor, workspace and current normalized layout",()=>{
  const before=dashboardPreferencePreset(), changed=applyDashboardActions(before,[{kind:"chart",value:"bar"}]);
  const input={current:before,expected:before,scope:{userId:"me",workspaceId:"one"},userId:"me",workspaceId:"one"};
  assert.equal(dashboardReviewMatches(input),true);
  assert.equal(dashboardReviewMatches({...input,current:changed}),false);
  assert.equal(dashboardReviewMatches({...input,userId:"other"}),false);
  assert.equal(dashboardReviewMatches({...input,workspaceId:"two"}),false);
  assert.equal(dashboardReviewMatches({...input,scope:null}),false);
});
