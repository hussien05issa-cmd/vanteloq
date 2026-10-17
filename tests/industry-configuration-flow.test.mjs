import test from "node:test";
import assert from "node:assert/strict";
import {createEnvironment,createReportWorkspace,dispatch,onboardingBody} from "./helpers/retail-worker-fixture.mjs";
import {defaultIndustryConfiguration} from "../domain/industry-templates.ts";
import {dashboardPreferencePreset} from "../domain/dashboard-preferences.ts";
async function ok(response,status=200){assert.equal(response.status,status,await response.clone().text());return response.json();}
test("industry changes require exact preview, isolate tenants, preserve records and reject races",{timeout:120000},async()=>{
 const {worker,environment,database,dispose}=await createEnvironment();try{
 const a=await createReportWorkspace(worker,environment,database,"industry-a"),b=await createReportWorkspace(worker,environment,database,"industry-b");
 const read=(owner=a.owner)=>dispatch(worker,environment,"/api/v1/industry-configuration",owner);
 const write=body=>dispatch(worker,environment,"/api/v1/industry-configuration",{...a.owner,method:"POST",body});
 const before=await ok(await read()),config=defaultIndustryConfiguration("dealership");assert.equal(before.configuration.templateId,"retail");
 const request={action:"preview",configuration:config,expectedRevision:before.revision};const preview=await ok(await write(request));
 assert.equal((await write({...request,action:"save"})).status,409);
 const attempts=await Promise.all([write({...request,action:"save",fingerprint:preview.fingerprint}),write({...request,action:"save",fingerprint:preview.fingerprint})]);assert.deepEqual(attempts.map(x=>x.status).sort(),[200,409]);
 const after=await ok(await read());assert.equal(after.configuration.templateId,"dealership");assert.equal(after.revision,before.revision+1);assert.equal((await ok(await read(b.owner))).configuration.templateId,"retail");
 assert.equal((await database.prepare("SELECT industry FROM workspaces WHERE id=?").bind(a.organizationId).first()).industry,"Car dealership");
 assert.equal((await database.prepare("SELECT count(*) n FROM workspace_industry_history WHERE organization_id=?").bind(a.organizationId).first()).n,2);
 assert.equal((await database.prepare("SELECT status FROM tenant_subscriptions WHERE organization_id=?").bind(a.organizationId).first()).status,"active");
 assert.equal((await database.prepare("SELECT count(*) n FROM organization_locations WHERE organization_id=?").bind(a.organizationId).first()).n,1);
 const invalid={...config,capabilities:["vehicles","dealership_operations","unapproved"]};assert.equal((await write({action:"preview",configuration:invalid,expectedRevision:after.revision})).status,400);
 }finally{await dispose();}
});
test("onboarding draft reload, stale discard protection, expiry and completion cleanup",{timeout:120000},async()=>{
 const {worker,environment,database,dispose}=await createEnvironment();try{
 const a=await createReportWorkspace(worker,environment,database,"draft-a"),b=await createReportWorkspace(worker,environment,database,"draft-b");
 await database.prepare("UPDATE workspaces SET setup_complete=0 WHERE id IN (?,?)").bind(a.organizationId,b.organizationId).run();
 const form=onboardingBody(a.owner.name,"Saved Café");const draft={step:3,form,industryConfiguration:defaultIndustryConfiguration("cafe"),overview:dashboardPreferencePreset("finance"),hours:form.hours};
 const read=(owner=a.owner)=>dispatch(worker,environment,"/api/v1/onboarding/draft",owner);
 const save=expectedRevision=>dispatch(worker,environment,"/api/v1/onboarding/draft",{...a.owner,method:"POST",body:{draft,expectedRevision}});
 await ok(await save(0));const saved=await ok(await read());assert.equal(saved.draft.form.industry,"Café & coffee shop");assert.equal(saved.draft.form.taxNumber,undefined);assert.equal(saved.draft.form.legalAccepted,undefined);assert.equal((await ok(await read(b.owner))).draft,null);
 const race=await Promise.all([save(1),save(1)]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
 const latest=await ok(await read());assert.equal(latest.revision,2);
 const discard=expectedRevision=>dispatch(worker,environment,"/api/v1/onboarding/draft",{...a.owner,method:"DELETE",body:expectedRevision===undefined?{}:{expectedRevision}});
 const missingRevision=await ok(await discard(undefined),400);assert.equal(missingRevision.error.code,"SETUP_DRAFT_REVISION");
 const staleDiscard=await ok(await discard(1),409);assert.equal(staleDiscard.error.code,"SETUP_DRAFT_CHANGED");
 const retained=await ok(await read());assert.equal(retained.revision,latest.revision);assert.deepEqual(retained.draft,latest.draft);
 assert.equal((await ok(await discard(latest.revision))).deleted,true);
 const empty=await ok(await read());assert.equal(empty.draft,null);assert.equal(empty.revision,0);
 assert.equal((await discard(latest.revision)).status,409);
 await ok(await save(0));
 await database.prepare("UPDATE onboarding_drafts SET expires_at=1 WHERE user_id=?").bind(a.userId).run();assert.equal((await ok(await read())).draft,null);
 await ok(await save(0));
 await ok(await dispatch(worker,environment,"/api/v1/onboarding",{...a.owner,method:"POST",body:{...form,industry:"Café & coffee shop",industryConfiguration:draft.industryConfiguration}}),201);
 assert.equal((await database.prepare("SELECT count(*) n FROM onboarding_drafts WHERE user_id=?").bind(a.userId).first()).n,0);
 assert.equal((await read()).status,409);
 }finally{await dispose();}
});

test("onboarding draft organization scope is server-bound and old or unscoped drafts cannot resume",{timeout:120000},async()=>{
 const {worker,environment,database,dispose}=await createEnvironment();try{
 const a=await createReportWorkspace(worker,environment,database,"draft-scope-a"),b=await createReportWorkspace(worker,environment,database,"draft-scope-b");
 await database.prepare("UPDATE workspaces SET setup_complete=0 WHERE id IN (?,?)").bind(a.organizationId,b.organizationId).run();
 const form=onboardingBody(a.owner.name,"Current organization setup");
 const draft={step:2,form,industryConfiguration:defaultIndustryConfiguration("retail"),overview:dashboardPreferencePreset(),hours:form.hours};
 const read=owner=>dispatch(worker,environment,"/api/v1/onboarding/draft",owner);
 const save=(owner,value=draft)=>dispatch(worker,environment,"/api/v1/onboarding/draft",{...owner,method:"POST",body:{expectedRevision:0,draft:value}});
 // A client-supplied organization key cannot replace the authenticated scope.
 await ok(await save(a.owner,{...draft,organizationId:b.organizationId}));
 const stored=await database.prepare("SELECT draft_json FROM onboarding_drafts WHERE user_id=?").bind(a.userId).first();
 const envelope=JSON.parse(stored.draft_json);assert.equal(envelope.organizationId,a.organizationId);
 const otherForm=onboardingBody(b.owner.name,"Other owner's retained setup");
 await ok(await save(b.owner,{...draft,form:otherForm,hours:otherForm.hours}));
 const otherBefore=await ok(await read(b.owner));
 // Simulate retained JSON from a previous workspace for this same account.
 await database.prepare("UPDATE onboarding_drafts SET draft_json=? WHERE user_id=?").bind(JSON.stringify({...envelope,organizationId:b.organizationId,form:{...envelope.form,businessName:"Old organization only"}}),a.userId).run();
 const isolated=await ok(await read(a.owner));assert.equal(isolated.draft,null);assert.equal(isolated.revision,0);
 assert.equal((await database.prepare("SELECT count(*) n FROM onboarding_drafts WHERE user_id=?").bind(a.userId).first()).n,0);
 assert.deepEqual(await ok(await read(b.owner)),otherBefore);
 // Legacy drafts without an organization key are equally unsafe to resume.
 await ok(await save(a.owner));
 const unscoped={...envelope};delete unscoped.organizationId;
 await database.prepare("UPDATE onboarding_drafts SET draft_json=? WHERE user_id=?").bind(JSON.stringify(unscoped),a.userId).run();
 assert.equal((await ok(await read(a.owner))).draft,null);
 assert.equal((await database.prepare("SELECT count(*) n FROM onboarding_drafts WHERE user_id=?").bind(a.userId).first()).n,0);
 assert.deepEqual(await ok(await read(b.owner)),otherBefore);
 }finally{await dispose();}
});
