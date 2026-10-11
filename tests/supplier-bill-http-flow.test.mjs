import assert from "node:assert/strict";
import test from "node:test";
import { GET,POST } from "../app/api/v1/bookloq/bills/route.ts";
import { PATCH as reverseJournal } from "../app/api/v1/bookloq/journals/route.ts";
import { createEnvironment,createReportWorkspace,dispatch,identityHeaders,origin } from "./helpers/retail-worker-fixture.mjs";

test("supplier bill HTTP authority, privacy and journal correction boundaries",{timeout:120000},async()=>{
  const {worker,environment,database,dispose}=await createEnvironment(),previousEnv=globalThis.__vanteloqEnv;
  try{
    const workspace=await createReportWorkspace(worker,environment,database,'supplier-bill-http'),other=await createReportWorkspace(worker,environment,database,'supplier-bill-other'),org=workspace.organizationId,now=Math.floor(Date.now()/1000);
    for(const account of [workspace,other])await database.prepare("INSERT INTO tenant_addons(id,organization_id,addon_key,status,created_at,updated_at) VALUES(?,?,'bookloq','active',?,?)").bind(crypto.randomUUID(),account.organizationId,now,now).run();
    const expect=async(response,status)=>{const body=await response.json();assert.equal(response.status,status,JSON.stringify(body));return body;};
    await expect(await dispatch(worker,environment,'/api/v1/bookloq/setup',{...workspace.owner,method:'POST',body:{initialize:true,label:'October',startDate:'2026-10-01',endDate:'2026-10-31'}}),201);
    const supplier=crypto.randomUUID();await database.prepare("INSERT INTO bookloq_contacts(id,organization_id,contact_type,name,created_at,updated_at) VALUES(?,?,'supplier','Fictional supplier',?,?)").bind(supplier,org,now,now).run();
    globalThis.__vanteloqEnv=environment;
    const call=(method,body,key=crypto.randomUUID(),identity=workspace.owner,extra={})=>{const headers={...identityHeaders(identity.email,identity.name,method!=='GET'),'Idempotency-Key':key,...extra},request=new Request(origin+'/api/v1/bookloq/bills',{method,headers,body:body?JSON.stringify(body):undefined});return method==='POST'?POST(request):GET(request);};
    await expect(await GET(new Request(origin+'/api/v1/bookloq/bills')),401);
    const draft={action:'create',supplierId:supplier,billNumber:'HTTP-1',invoiceDate:'2026-10-04',dueDate:'2026-10-31',subtotalCents:10000,taxCents:500,reference:'Fictional supplier document',reviewed:true};
    await expect(await call('POST',draft,crypto.randomUUID(),workspace.owner,{origin:'https://other.example'}),403);
    const created=await expect(await call('POST',draft),201),billId=created.event.billId;
    const wrongTenant=new Request(origin+`/api/v1/bookloq/bills?billId=${billId}`,{headers:identityHeaders(other.owner.email,other.owner.name)});await expect(await GET(wrongTenant),404);
    await database.prepare("UPDATE memberships SET role='manager' WHERE organization_id=? AND user_id=?").bind(org,workspace.userId).run();
    await expect(await call('POST',{action:'approve',billId,reference:'Reviewed supplier invoice',reviewed:true}),403);
    await database.prepare("UPDATE memberships SET role='owner' WHERE organization_id=? AND user_id=?").bind(org,workspace.userId).run();
    await expect(await call('POST',{action:'approve',billId,reference:'Reviewed supplier invoice',reviewed:true}),201);
    const cost=await database.prepare("SELECT id FROM financial_accounts WHERE organization_id=? AND system_key='inventory_asset'").bind(org).first(),tax=await database.prepare("SELECT id FROM financial_accounts WHERE organization_id=? AND system_key='gst_recoverable'").bind(org).first();assert.ok(cost?.id&&tax?.id);
    const posted=await expect(await call('POST',{action:'post',billId,date:'2026-10-04',costAccountId:cost.id,taxAccountId:tax.id,reviewed:true}),201);
    const request=new Request(origin+'/api/v1/bookloq/journals',{method:'PATCH',headers:{...identityHeaders(workspace.owner.email,workspace.owner.name,true),'Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({entryId:posted.event.journalEntryId,reason:'Generic route must not bypass supplier history',reversalDate:'2026-10-04'})});
    const blocked=await expect(await reverseJournal(request),409);assert.equal(blocked.error.code,'BILL_CORRECTION_REQUIRED');
    const history=await expect(await GET(new Request(origin+`/api/v1/bookloq/bills?billId=${billId}`,{headers:identityHeaders(workspace.owner.email,workspace.owner.name)})),200);assert.equal(history.bill.journalEntryId,posted.event.journalEntryId);assert.equal(history.events.length,3);assert.equal(history.bill.paidCents,0);
  }finally{globalThis.__vanteloqEnv=previousEnv;await dispose();}
});
