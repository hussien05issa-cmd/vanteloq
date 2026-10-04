import test from "node:test";
import assert from "node:assert/strict";
import {createEnvironment,createReportWorkspace,dispatch} from "./helpers/retail-worker-fixture.mjs";
const ok=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const record={kind:"custom",name:"TEST_ONLY supplier follow-up",source:"Fictional invoice",asOfDate:"2026-09-01",currency:"CAD",values:{template:"review-purchase",condition:"Invoice mismatch",owner:"Owner",dueDate:"2026-09-02",nextAction:"Check credit",approval:"owner-review",outcome:"Supplier confirmed credit"},groups:{checks:[{reference:"Credit",evidence:"TEST_ONLY credit",status:"complete"}]},costCoverage:false,note:"No external action."};
test("workflow saves are isolated, revision-safe, retry-safe and retained on correction",{timeout:120000},async()=>{
 const {worker,environment,database,dispose}=await createEnvironment();try{
 const a=await createReportWorkspace(worker,environment,database,"workflow-a"),b=await createReportWorkspace(worker,environment,database,"workflow-b");
 const get=(owner=a.owner)=>dispatch(worker,environment,`/api/v1/business-workflows?locationId=${a.locationId}`,owner);
 const post=(body,owner=a.owner)=>dispatch(worker,environment,"/api/v1/business-workflows",{...owner,method:"POST",body});
 const req={id:crypto.randomUUID(),locationId:a.locationId,requestId:crypto.randomUUID(),expectedVersion:null,action:"save",record};
 await ok(await post(req));assert.equal((await ok(await post(req))).replayed,true);assert.equal((await post({...req,record:{...record,name:"Changed replay"}})).status,409);
 assert.equal((await get(b.owner)).status,403);assert.equal((await post({...req,requestId:crypto.randomUUID()},b.owner)).status,403);
 let data=await ok(await get());assert.equal(data.records.length,1);assert.equal(data.records[0].version,1);
 const change={...req,expectedVersion:1,record:{...record,note:"Revision two."}};
 const race=await Promise.all([post({...change,requestId:crypto.randomUUID()}),post({...change,requestId:crypto.randomUUID()})]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
 data=await ok(await get());assert.equal(data.records[0].version,2);
 const transition=(action,version,reason="")=>post({id:req.id,locationId:a.locationId,requestId:crypto.randomUUID(),expectedVersion:version,action,reason,reviewed:true});
 await ok(await transition("review",2));assert.equal((await post({...req,requestId:crypto.randomUUID(),expectedVersion:3})).status,400);await ok(await transition("complete",3));await ok(await transition("reopen",4,"Correct supplier reference"));
 const history=await ok(await dispatch(worker,environment,`/api/v1/business-workflows?history=${req.id}`,a.owner));assert.equal(history.revisions.length,5);assert.equal(history.revisions[0].reason,"Correct supplier reference");assert.equal(history.revisions[4].snapshot.record.note,record.note);
 assert.equal((await dispatch(worker,environment,`/api/v1/business-workflows?history=${req.id}`,b.owner)).status,404);
 await database.prepare("UPDATE memberships SET role='admin' WHERE user_id=? AND organization_id=?").bind(a.userId,a.organizationId).run();const deniedApproval=await transition("review",5);assert.equal(deniedApproval.status,403);assert.equal((await deniedApproval.json()).error.code,"WORKFLOW_OWNER_REVIEW");
 await database.prepare("UPDATE memberships SET role='read_only' WHERE user_id=? AND organization_id=?").bind(a.userId,a.organizationId).run();assert.equal((await transition("review",5)).status,403);
 }finally{await dispose();}
});
