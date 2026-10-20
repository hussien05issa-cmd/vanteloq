import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { getDb } from "../db/index.ts";
import { workspaces } from "../db/schema.ts";
import { eq } from "drizzle-orm";
import type { AccessContext } from "../server/authorization.ts";
import { captureOutcomeSales, outcomeLinkChoices, previewOutcomeSales, readableOutcomeLinks, requireOutcomeLinks } from "../server/workflow-outcomes.ts";
import { mutateBusinessWorkflow, readBusinessWorkflows } from "../server/business-workflows.ts";
import { validateBusinessWorkflow } from "../domain/business-workflows.ts";
import { defaultForecastSettings } from "../domain/forecasting.ts";
import { activateTestSubscription } from "./helpers/subscription-fixture.mjs";
const code=(expected:string)=>(e:unknown)=>!!e&&typeof e==='object'&&'code'in e&&e.code===expected;
test('linked outcome evidence is scoped, permission-safe, exact and retained on save',{timeout:120000},async t=>{
  const mf=new Miniflare({modules:true,script:"export default {fetch(){return new Response('ok')}}",d1Databases:{DB:crypto.randomUUID()}}),prior=(globalThis as typeof globalThis&{__vanteloqEnv?:unknown}).__vanteloqEnv;
  try{
    const db=await mf.getD1Database('DB') as unknown as D1Database;
    for(const file of (await readdir(new URL('../drizzle/',import.meta.url))).filter(f=>/^\d{4}.*\.sql$/.test(f)).sort())for(const sql of (await readFile(new URL(`../drizzle/${file}`,import.meta.url),'utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
    (globalThis as typeof globalThis&{__vanteloqEnv?:unknown}).__vanteloqEnv={DB:db};
    await db.prepare("INSERT INTO users(id,email,display_name,created_at,updated_at) VALUES ('actor','outcome@example.invalid','TEST_ONLY Owner',1,1),('member','member@example.invalid','TEST_ONLY Member',1,1)").run();
    for(const id of ['org','other']){await db.prepare("INSERT INTO workspaces(id,owner_name,business_name,legal_name,business_email,industry,city,address,postal_code,hours_json,timezone,currency,created_at,updated_at) VALUES (?,'Test','TEST_ONLY outcomes','TEST_ONLY outcomes','outcome@example.invalid','Retail','Edmonton','Test','T5A1A1','[]','America/Edmonton','CAD',1,1)").bind(id).run();await activateTestSubscription(db,id);}
    for(const [id,org]of [['loc','org'],['second','org'],['foreign','other']])await db.prepare("INSERT INTO organization_locations(id,organization_id,name,status,country_code,address_line_1,locality,administrative_area,postal_code,timezone,currency,locale,validation_status,created_at,updated_at) VALUES (?,?,?,'active','CA','Test','Edmonton','AB','T5A1A1','America/Edmonton','CAD','en-CA','entered',1,1)").bind(id,org,`TEST_ONLY ${id}`).run();
    const [organization]=await getDb().select().from(workspaces).where(eq(workspaces.id,'org'));
    const ctx={organizationId:'org',userId:'actor',role:'owner',organization} as AccessContext;
    const a={context:ctx,kinds:['outcome'] as const,canWrite:true,canReopen:true,canApproveOwnerReview:true,canExport:true};
    const access={...a,kinds:[...a.kinds]};
    for(const [id,org,loc]of [[1,'org','loc'],[2,'org','second'],[3,'other','foreign'],[4,'org',null]])await db.prepare("INSERT INTO workspace_tasks(id,organization_id,title,detail,location_id,idempotency_key,created_by_user_id,created_at,updated_at) VALUES (?,?,'TEST_ONLY task','No financial detail',?,?,'actor',1,1)").bind(id,org,loc,`task-${id}`).run();
    const windows={baselineFrom:'2026-10-03',baselineTo:'2026-10-04',followupFrom:'2026-10-05',followupTo:'2026-10-06'};
    const record=validateBusinessWorkflow({kind:'outcome',name:'TEST_ONLY margin response',source:'TEST_ONLY reviewed sales',asOfDate:'2026-10-06',currency:'CAD',values:{...windows,taskId:'1',measurementMode:'recorded-net-sales',metric:'Net sales',unit:'CAD',coverage:'not-yet',guardrail:'Stockouts',guardrailBefore:'0',guardrailAfter:'0',decision:'keep'},groups:{},costCoverage:false,note:'Observed comparison only. No causal attribution.'});
    const stamp=Math.floor(Date.now()/1000);
    for(const [day,amount]of [['2026-10-03',1000],['2026-10-04',-100],['2026-10-05',1300],['2026-10-06',0]] as const)await db.prepare("INSERT INTO daily_business_metrics(organization_id,business_date,location_ref,gross_sales_cents,net_sales_cents,cost_of_goods_cents,transaction_count,units_sold,refunds_cents,discounts_cents,labour_cost_cents,created_by_user_id,created_at,updated_at) VALUES ('org',?,'loc',?,?,0,1,1,0,0,0,'actor',?,?)").bind(day,Math.max(0,amount),amount,stamp,stamp).run();
    const settings={...defaultForecastSettings(),reviewedFrom:'2026-10-03',reviewedThrough:'2026-10-06',reviewedAt:new Date(Date.now()+1000).toISOString()};
    await db.prepare("INSERT INTO forecasting_settings(organization_id,location_id,settings_json,updated_by,updated_at) VALUES ('org','loc',?,'actor',1)").bind(JSON.stringify(settings)).run();
    await t.test('same-location and organisation-wide tasks link, foreign and other-location tasks do not',async()=>{
      assert.equal((await requireOutcomeLinks(ctx,'loc',record)).task?.id,1);
      assert.equal((await requireOutcomeLinks(ctx,'loc',{...record,values:{...record.values,taskId:'4'}})).task?.id,4);
      for(const id of ['2','3'])await assert.rejects(()=>requireOutcomeLinks(ctx,'loc',{...record,values:{...record.values,taskId:id}}),code(id==='3'?'TASK_NOT_AVAILABLE':'OUTCOME_TASK'));
      const choices=await outcomeLinkChoices(ctx,'loc');assert.deepEqual(choices.tasks.map(t=>t.id),[4,1]);
    });
    await t.test('recorded net sales fill only reviewed exact periods, retaining negative refunds',async()=>{
      const preview=await previewOutcomeSales(ctx,'loc',record);assert.equal(preview.available,true);assert.equal(preview.baseline,'9.00');assert.equal(preview.followup,'13.00');assert.equal(preview.snapshot?.locationId,'loc');
      await assert.rejects(()=>previewOutcomeSales(ctx,'loc',{...record,values:{...record.values,taskId:''}}),code('OUTCOME_LINK_REQUIRED'));
      await assert.rejects(()=>previewOutcomeSales(ctx,'loc',{...record,currency:'USD'}),code('OUTCOME_CURRENCY'));
      await assert.rejects(()=>previewOutcomeSales(ctx,'loc',{...record,values:{...record.values,followupTo:'2026-10-07'}}),code('OUTCOME_PERIOD'));
      const missing=await previewOutcomeSales(ctx,'loc',{...record,values:{...record.values,...{baselineFrom:'2026-10-01',baselineTo:'2026-10-02'}}});assert.equal(missing.available,false);assert.equal(missing.baseline,null);assert.equal(missing.snapshot,null);
    });
    await t.test('saving captures server values and replay/history preserve the exact recorded evidence',async()=>{
      const request={id:'outcome-1',locationId:'loc',requestId:crypto.randomUUID(),expectedVersion:null,action:'save',record:{...record,values:{...record.values,baseline:'999',followup:'999'}}};
      assert.equal((await mutateBusinessWorkflow(access,request)).replayed,false);assert.equal((await mutateBusinessWorkflow(access,request)).replayed,true);
      const data=await readBusinessWorkflows(access,'loc',null),saved=data.records![0];assert.equal(saved.values.baseline,'9.00');assert.equal(saved.values.followup,'13.00');assert.equal(saved.outcomeLinks?.task?.id,1);assert.ok(saved.outcomeSnapshot?.fingerprint);
      const history=await readBusinessWorkflows(access,null,'outcome-1');assert.ok('revisions'in history);assert.deepEqual(history.revisions![0].snapshot.record.outcomeSnapshot,saved.outcomeSnapshot);
      await mutateBusinessWorkflow(access,{id:'outcome-1',locationId:'loc',requestId:crypto.randomUUID(),expectedVersion:1,action:'review',reviewed:true});
      await db.prepare("UPDATE daily_business_metrics SET net_sales_cents=1301,updated_at=? WHERE organization_id='org' AND business_date='2026-10-05'").bind(stamp+5).run();
      await assert.rejects(()=>mutateBusinessWorkflow(access,{id:'outcome-1',locationId:'loc',requestId:crypto.randomUUID(),expectedVersion:2,action:'complete',reviewed:true}),code('OUTCOME_SOURCE_INCOMPLETE'));
      await db.prepare("UPDATE forecasting_settings SET settings_json=? WHERE organization_id='org' AND location_id='loc'").bind(JSON.stringify({...settings,reviewedAt:new Date((stamp+10)*1000).toISOString()})).run();
      await assert.rejects(()=>mutateBusinessWorkflow(access,{id:'outcome-1',locationId:'loc',requestId:crypto.randomUUID(),expectedVersion:2,action:'complete',reviewed:true}),code('OUTCOME_SOURCE_CHANGED'));
      assert.equal((await db.prepare("SELECT state FROM business_workflow_records WHERE id='outcome-1'").first())?.state,'reviewed');
      await mutateBusinessWorkflow(access,{id:'outcome-1',locationId:'loc',requestId:crypto.randomUUID(),expectedVersion:2,action:'reopen',reason:'Refresh changed sales source'});
      const draft=(await readBusinessWorkflows(access,'loc',null)).records![0];await mutateBusinessWorkflow(access,{id:'outcome-1',locationId:'loc',requestId:crypto.randomUUID(),expectedVersion:3,action:'save',record:{...record,values:draft.values,outcomeSnapshot:draft.outcomeSnapshot}});
      assert.equal((await readBusinessWorkflows(access,'loc',null)).records![0].values.followup,'13.01');
      await mutateBusinessWorkflow(access,{id:'outcome-1',locationId:'loc',requestId:crypto.randomUUID(),expectedVersion:4,action:'review',reviewed:true});
      await mutateBusinessWorkflow(access,{id:'outcome-1',locationId:'loc',requestId:crypto.randomUUID(),expectedVersion:5,action:'complete',reviewed:true});
    });
    await t.test('financial permissions and location restrictions are rechecked on reads, previews and writes',async()=>{
      const permissions=['operations.tasks','operations.manage','finance.costs','metrics.profit','sales.view'];
      await db.prepare("INSERT INTO access_roles(id,organization_id,name,permissions_json,created_by_user_id,created_at,updated_at) VALUES ('role','org','TEST_ONLY restricted',?,'actor',1,1)").bind(JSON.stringify(permissions)).run();
      await db.prepare("INSERT INTO team_members(id,organization_id,user_id,role_id,first_name,last_name,email,employee_code,primary_location_id,permitted_locations_json,status,remote_login,created_by_user_id,created_at,updated_at) VALUES ('profile','org','member','role','Test','Member','member@example.invalid','T1','loc','[\"loc\"]','active',1,'actor',1,1)").run();
      const member={...ctx,userId:'member',role:'manager' as const};
      await assert.rejects(()=>previewOutcomeSales(member,'loc',record),code('INSUFFICIENT_PERMISSION'));
      await assert.rejects(()=>requireOutcomeLinks(member,'second',record),code('LOCATION_ACCESS_DENIED'));
      const saved=(await readBusinessWorkflows(access,'loc',null)).records![0];assert.deepEqual(await readableOutcomeLinks(member,'loc',[saved]),[null]);
      const limited={...access,context:member};assert.equal((await readBusinessWorkflows(limited,'loc',null)).records!.length,0);assert.equal((await readBusinessWorkflows(limited,null,'outcome-1')).revisions?.length,0);
      await assert.rejects(()=>mutateBusinessWorkflow({...access,canWrite:false},{id:'outcome-1',locationId:'loc',requestId:crypto.randomUUID(),expectedVersion:6,action:'reopen',reason:'No write access'}),code('WORKFLOW_WRITE'));
      await db.prepare("UPDATE access_roles SET permissions_json=? WHERE id='role'").bind(JSON.stringify([...permissions,'metrics.revenue'])).run();
      assert.equal((await previewOutcomeSales(member,'loc',record)).available,true);assert.equal((await outcomeLinkChoices(member,'loc')).tasks.some(t=>t.id===4),false);
    });
    await t.test('saved findings require matching location and retained financial evidence permissions',async()=>{
      for(const [id,org,scope,required]of [['finding','org','loc',['metrics.cash']],['other-finding','other','foreign',[]],['global-finding','org','all',[]],['second-finding','org','second',[]]] as const)await db.prepare("INSERT INTO opportunity_reviews(id,organization_id,scope_key,scope_label,rule_id,period_start,period_end,snapshot_json,required_permissions_json,status,version,mutation_key,created_by_user_id,created_at,updated_at) VALUES (?,?,?,'TEST_ONLY shop','TEST_ONLY finding','2026-10-01','2026-10-02','{\"title\":\"TEST_ONLY action\"}',?,'reviewed',1,?,'actor',1,1)").bind(id,org,scope,JSON.stringify(required),id).run();
      assert.equal((await requireOutcomeLinks(ctx,'loc',{...record,values:{...record.values,opportunityId:'finding'}})).opportunity?.id,'finding');
      for(const id of ['other-finding','global-finding','second-finding'])await assert.rejects(()=>requireOutcomeLinks(ctx,'loc',{...record,values:{...record.values,opportunityId:id}}));
      await db.prepare("UPDATE workspace_tasks SET source_type='decision',source_ref='opportunity:finding' WHERE id=1").run();
      await assert.rejects(()=>requireOutcomeLinks(ctx,'loc',{...record,values:{...record.values,opportunityId:'second-finding'}}),code('OUTCOME_LINK_MISMATCH'));
      const member={...ctx,userId:'member',role:'manager' as const};await assert.rejects(()=>requireOutcomeLinks(member,'loc',record),code('OPPORTUNITY_NOT_FOUND'));assert.equal((await outcomeLinkChoices(member,'loc')).tasks.length,0);
    });
    await t.test('source failures leave supported values unavailable and manual metrics remain manual',async()=>{
      await db.prepare("INSERT INTO integration_connections(id,organization_id,provider,status,scopes_json,created_at,updated_at) VALUES ('unapproved','org','square','error','[]',1,1)").run();
      await db.prepare("UPDATE daily_business_metrics SET source_provider='square',source_connection_id='unapproved' WHERE organization_id='org' AND business_date='2026-10-04'").run();
      const preview=await previewOutcomeSales(ctx,'loc',record);assert.equal(preview.available,false);assert.equal(preview.baseline,null);
      const manual={...record,values:{...record.values,measurementMode:'manual',metric:'Waste',baseline:'10',followup:'8',coverage:'confirmed'},outcomeSnapshot:null};assert.equal((await captureOutcomeSales(ctx,'loc',manual,true)).values.baseline,'10');
      await db.prepare("UPDATE organization_locations SET currency='USD' WHERE id='loc'").run();await assert.rejects(()=>previewOutcomeSales(ctx,'loc',record),code('OUTCOME_CURRENCY'));
    });
  }finally{(globalThis as typeof globalThis&{__vanteloqEnv?:unknown}).__vanteloqEnv=prior;await mf.dispose();}
});
