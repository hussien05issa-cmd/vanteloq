import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdir,readFile } from "node:fs/promises";
import { mutateInventoryWorkflow, prepareManagedInventoryChanges, readInventoryWorkflows, readInventoryWorkflowHistory, type InventoryWorkflowActor } from "../server/workflow-inventory";

async function fixture(){
  const sqlite=new DatabaseSync(":memory:");sqlite.exec("PRAGMA foreign_keys=ON");
  const database={prepare(query:string){const statement=sqlite.prepare(query);let args:(string|number|null)[]=[];return {bind(...values:(string|number|null)[]){args=values;return this;},async first(){return statement.get(...args)??null;},async all(){return {success:true,results:statement.all(...args)};},async run(){return {success:true,meta:statement.run(...args)};}};},async batch(statements:{all:()=>Promise<unknown>}[]){sqlite.exec("BEGIN");try{const result=[];for(const s of statements)result.push(await s.all());sqlite.exec("COMMIT");return result;}catch(error){sqlite.exec("ROLLBACK");throw error;}}};
  for(const file of (await readdir("drizzle")).filter(f=>/^\d{4}.*\.sql$/.test(f)).sort())for(const statement of (await readFile(`drizzle/${file}`,"utf8")).split("--> statement-breakpoint").map(v=>v.trim()).filter(Boolean))sqlite.exec(statement);
  assert.ok(sqlite.prepare("SELECT name FROM sqlite_master WHERE name='workflow_inventory_positions'").get(),"Root must generate the additive workflow migration before these flow tests.");
  const db=database as unknown as D1Database,actors:InventoryWorkflowActor[]=[];
  for(const suffix of ["a","b"]){const org=`org-${suffix}`,user=`user-${suffix}`,site=`site-${suffix}`,now=Date.now();
    sqlite.prepare("INSERT INTO users(id,email,display_name,status,created_at,updated_at) VALUES(?,?,?,'active',?,?)").run(user,`${suffix}@example.invalid`,"TEST_ONLY Owner",now,now);
    sqlite.prepare("INSERT INTO workspaces(id,owner_name,business_name,legal_name,business_email,industry,city,address,postal_code,hours_json,created_at,updated_at) VALUES(?,'Test','Fictional','Fictional',?,'Retail','Edmonton','TEST_ONLY','T1T1T1','[]',?,?)").run(org,`${suffix}@example.invalid`,now,now);
    sqlite.prepare("INSERT INTO organization_locations(id,organization_id,name,country_code,address_line_1,locality,administrative_area,timezone,currency,created_at,updated_at) VALUES(?,?,'TEST_ONLY Store','CA','TEST_ONLY','Edmonton','AB','America/Edmonton','CAD',?,?)").run(site,org,now,now);
    actors.push({organizationId:org,userId:user,locationIds:[site],permissions:["inventory.view","inventory.value","inventory.adjust","purchasing.view","purchasing.receive","purchasing.match","sales.transactions"],features:["inventory.lots","inventory.reorder_ai","invoice.matching"],capabilities:["products","lots","variants"]});
  }
  const a=actors[0],b=actors[1],run=(body:Record<string,unknown>,actor=a)=>mutateInventoryWorkflow(actor,{locationId:actor.locationIds[0],mutationKey:crypto.randomUUID(),reviewed:true,date:"2026-09-01",...body},db);
  function order(){const now=Date.now();sqlite.prepare("INSERT INTO purchase_orders(id,organization_id,order_number,supplier_name,delivery_location_id,order_date,currency,status,subtotal_cents,total_cents,created_by_user_id,created_at,updated_at) VALUES('po',?,'TEST-PO','Fictional Supplier',?,'2026-08-01','CAD','sent',2000,2000,?,?,?)").run(a.organizationId,a.locationIds[0],a.userId,now,now);sqlite.prepare("INSERT INTO purchase_order_lines(id,organization_id,purchase_order_id,line_number,sku,description,quantity,received_quantity,unit_cost_cents,created_at,updated_at) VALUES('line',?,'po',1,'SKU','TEST_ONLY Item',20,0,100,?,?)").run(a.organizationId,now,now);}
  return {sqlite,db,a,b,run,order,close:()=>sqlite.close()};
}
const opening={action:"open_stock",sku:"SKU",productName:"TEST_ONLY Item",unit:"each",quantityMilli:10000,source:"TEST_ONLY physical count"};
test("receipt accept/reject, retry, ledger and reversal form one auditable transaction",async()=>{
  const f=await fixture();try{await f.run(opening);f.order();const key=crypto.randomUUID(),body={action:"receive",purchaseOrderId:"po",source:"TEST_ONLY delivery",lines:[{lineId:"line",accepted:5,rejected:2}],mutationKey:key};
    const receipt=await f.run(body);assert.equal((f.sqlite.prepare("SELECT quantity_milli n FROM workflow_inventory_positions").get() as {n:number}).n,15000);
    assert.equal((f.sqlite.prepare("SELECT received_quantity n FROM purchase_order_lines").get() as {n:number}).n,5);
    assert.equal((await f.run(body)).replayed,true);assert.equal((f.sqlite.prepare("SELECT count(*) n FROM workflow_inventory_receipts").get() as {n:number}).n,1);
    await assert.rejects(f.run({...body,lines:[{lineId:"line",accepted:6,rejected:0}]}),/save key/i);
    await assert.rejects(f.run({...body,mutationKey:crypto.randomUUID(),lines:[{lineId:"line",accepted:16,rejected:0}]}),/over-delivery/i);
    await f.run({action:"reverse_receipt",id:receipt.id,source:"TEST_ONLY delivery cancelled"});assert.equal((f.sqlite.prepare("SELECT quantity_milli n FROM workflow_inventory_positions").get() as {n:number}).n,10000);assert.equal((f.sqlite.prepare("SELECT received_quantity n FROM purchase_order_lines").get() as {n:number}).n,0);
    assert.equal((f.sqlite.prepare("SELECT count(*) n FROM workflow_inventory_movements").get() as {n:number}).n,3);
    await assert.rejects(f.run({action:"reverse_receipt",id:receipt.id,source:"TEST_ONLY repeat"}),/unreversed/i);
  }finally{f.close();}
});
test("stock consumption prevents an impossible reversal and retains all original evidence",async()=>{
  const f=await fixture();try{await f.run({...opening,quantityMilli:0});f.order();const receipt=await f.run({action:"receive",purchaseOrderId:"po",source:"test",lines:[{lineId:"line",accepted:5,rejected:0}]});await f.run({action:"count_stock",sku:"SKU",quantityMilli:2000,expectedVersion:2,source:"TEST_ONLY documented stock consumption"});
    await assert.rejects(f.run({action:"reverse_receipt",id:receipt.id,source:"test"}),/resulting stock/i);assert.equal((f.sqlite.prepare("SELECT received_quantity n FROM purchase_order_lines").get() as {n:number}).n,5);assert.equal((f.sqlite.prepare("SELECT reversed_at n FROM workflow_inventory_receipts").get() as {n:null}).n,null);
  }finally{f.close();}
});
test("shared preparation changes are atomic, reject duplicate sources and stale versions",async()=>{
  const f=await fixture();try{await f.run({...opening,sku:"FLOUR",unit:"g",quantityMilli:100000});await f.run({...opening,sku:"DOUGH",unit:"g",quantityMilli:0});const changes=[{sku:"FLOUR",unit:"g" as const,quantityMilli:-10000,reason:"TEST_ONLY prep",sourceReference:"sector:batch:v1:review",occurredDate:"2026-09-02"},{sku:"DOUGH",unit:"g" as const,quantityMilli:9000,reason:"TEST_ONLY prep",sourceReference:"sector:batch:v1:review",occurredDate:"2026-09-02"}];
    const first=await prepareManagedInventoryChanges(f.db,f.a,"site-a",changes),stale=await prepareManagedInventoryChanges(f.db,f.a,"site-a",changes);await f.db.batch(first);await assert.rejects(f.db.batch(stale),/constraint/i);
    assert.equal((f.sqlite.prepare("SELECT quantity_milli n FROM workflow_inventory_positions WHERE sku='FLOUR'").get() as {n:number}).n,90000);assert.equal((f.sqlite.prepare("SELECT quantity_milli n FROM workflow_inventory_positions WHERE sku='DOUGH'").get() as {n:number}).n,9000);
    await assert.rejects(f.db.batch(await prepareManagedInventoryChanges(f.db,f.a,"site-a",changes)),/UNIQUE/i);assert.equal((f.sqlite.prepare("SELECT quantity_milli n FROM workflow_inventory_positions WHERE sku='FLOUR'").get() as {n:number}).n,90000);
    await assert.rejects(prepareManagedInventoryChanges(f.db,f.a,"site-a",[{...changes[0],unit:"ml"}]),/base unit/i);
  }finally{f.close();}
});
test("tenant, location and write permissions are checked before stock is exposed or changed",async()=>{
  const f=await fixture();try{await f.run(opening);await assert.rejects(readInventoryWorkflows(f.b,"site-a",f.db),/available to your account/i);await assert.rejects(f.run({...opening,sku:"FORBIDDEN"},{...f.a,permissions:["inventory.view"]}),/permissions/i);assert.equal((await readInventoryWorkflows(f.b,"site-b",f.db)).positions.length,0);await assert.rejects(f.run({...opening,locationId:"site-a"},{...f.b,locationIds:["site-a"]}),/unavailable/i);
  }finally{f.close();}
});
test("invoice evidence uses trusted PO facts and saved reviews retain revision history",async()=>{
  const f=await fixture();try{await f.run(opening);f.order();await f.run({action:"receive",purchaseOrderId:"po",source:"test",lines:[{lineId:"line",accepted:5,rejected:0}]});
    const record={purchaseOrderId:"po",invoiceReference:"TEST-INV",source:"TEST_ONLY invoice",asOf:"2026-09-03",lines:[{lineId:"line",ordered:999,accepted:999,agreedUnitCostCents:1,billed:6,billedUnitCostCents:110}]};const saved=await f.run({action:"save_record",kind:"invoice_review",record,date:record.asOf});const r=(await readInventoryWorkflows(f.a,"site-a",f.db)).records[0];assert.equal((r.payload as {lines:{accepted:number}[]}).lines[0].accepted,5);assert.equal((r.payload as {lines:{agreedUnitCostCents:number}[]}).lines[0].agreedUnitCostCents,100);
    await f.run({action:"save_record",kind:"invoice_review",id:saved.id,expectedVersion:1,record:{...record,source:"TEST_ONLY corrected invoice"},date:record.asOf});assert.equal((await readInventoryWorkflowHistory(f.a,saved.id,f.db)).entries.length,2);await assert.rejects(f.run({action:"save_record",kind:"invoice_review",id:saved.id,expectedVersion:1,record,date:record.asOf}),/changed/i);
    await assert.rejects(readInventoryWorkflowHistory(f.b,saved.id,f.db),/unavailable/i);
  }finally{f.close();}
});

test("workspace deletion cascades inventory evidence without affecting another business",async()=>{
  const f=await fixture();try{await f.run(opening);await f.run(opening,f.b);f.order();await f.run({action:"receive",purchaseOrderId:"po",source:"test",lines:[{lineId:"line",accepted:1,rejected:0}]});
    f.sqlite.prepare("DELETE FROM workspaces WHERE id=?").run(f.a.organizationId);
    for(const table of ["workflow_inventory_positions","workflow_inventory_movements","workflow_inventory_receipts","workflow_inventory_mutations"])assert.equal((f.sqlite.prepare(`SELECT count(*) n FROM ${table} WHERE organization_id=?`).get(f.a.organizationId) as {n:number}).n,0);
    assert.equal((f.sqlite.prepare("SELECT count(*) n FROM workflow_inventory_positions WHERE organization_id=?").get(f.b.organizationId) as {n:number}).n,1);
    assert.deepEqual(f.sqlite.prepare("PRAGMA foreign_key_check").all(),[]);
  }finally{f.close();}
});

test("historical movements cannot silently change a later reviewed stock count",async()=>{
  const f=await fixture();try{await f.run({...opening,date:"2026-09-05"});await assert.rejects(prepareManagedInventoryChanges(f.db,f.a,"site-a",[{sku:"SKU",unit:"each",quantityMilli:1000,reason:"TEST_ONLY old receipt",sourceReference:"old",occurredDate:"2026-09-04"}]),/latest recorded movement/i);
  }finally{f.close();}
});

test("location currency changes and future-dated evidence are rejected",async()=>{
  const f=await fixture();try{await f.run(opening);f.sqlite.prepare("UPDATE organization_locations SET currency='USD' WHERE id='site-a'").run();
    await assert.rejects(prepareManagedInventoryChanges(f.db,f.a,"site-a",[{sku:"SKU",unit:"each",quantityMilli:1000,reason:"test",sourceReference:"currency",occurredDate:"2026-09-05"}]),/currency changed/i);
    f.sqlite.prepare("UPDATE organization_locations SET currency='CAD' WHERE id='site-a'").run();
    const record={style:"Test",variant:"A",size:"M",colour:"Blue",source:"Fictional cohort",asOf:"2099-01-01",from:"2026-09-01",to:"2026-09-02",returnWindowDays:30,soldUnits:10,returnedUnits:2,fitReturns:2,defectReturns:0,otherReturns:0,restockableUnits:2,refundCents:null};
    await assert.rejects(f.run({action:"save_record",kind:"returns",record}),/future/i);
  }finally{f.close();}
});

test("unchanged physical counts still invalidate pending movements and reject backdating",async()=>{
  const f=await fixture();try{await f.run(opening);
    const pending=await prepareManagedInventoryChanges(f.db,f.a,"site-a",[{sku:"SKU",unit:"each",quantityMilli:1000,reason:"test",sourceReference:"pending",occurredDate:"2026-09-01"}]);
    await f.run({action:"count_stock",sku:"SKU",quantityMilli:10000,expectedVersion:1,source:"TEST_ONLY count confirmed",date:"2026-09-05"});
    await assert.rejects(f.db.batch(pending),/constraint/i);
    await assert.rejects(f.run({action:"count_stock",sku:"SKU",quantityMilli:10000,expectedVersion:2,source:"TEST_ONLY old count",date:"2026-09-04"}),/precede/i);
    assert.equal((f.sqlite.prepare("SELECT version FROM workflow_inventory_positions").get() as {version:number}).version,2);
  }finally{f.close();}
});
