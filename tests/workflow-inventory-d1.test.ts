import test from "node:test";
import assert from "node:assert/strict";
import { readdir,readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { mutateInventoryWorkflow,prepareManagedInventoryChanges,readInventoryWorkflows,type InventoryWorkflowActor } from "../server/workflow-inventory";

test("real D1 atomically receives, replays, rejects concurrent stock and reverses without tenant leakage",{timeout:120000},async()=>{
  const runtime=new Miniflare({modules:true,script:"export default {fetch(){return new Response('TEST_ONLY')}}",d1Databases:{DB:`inventory-${crypto.randomUUID()}`}});
  try{
    const db=await runtime.getD1Database("DB") as unknown as D1Database;
    for(const file of (await readdir(new URL("../drizzle/",import.meta.url))).filter(f=>/^\d{4}.*\.sql$/.test(f)).sort()){
      for(const statement of (await readFile(new URL(`../drizzle/${file}`,import.meta.url),"utf8")).split("--> statement-breakpoint").map(v=>v.trim()).filter(Boolean))await db.prepare(statement).run();
    }
    const now=Date.now();
    for(const suffix of ["a","b"])await db.batch([
      db.prepare("INSERT INTO users(id,email,display_name,status,created_at,updated_at) VALUES(?,?,?,'active',?,?)").bind(`user-${suffix}`,`${suffix}@example.invalid`,"TEST_ONLY Owner",now,now),
      db.prepare("INSERT INTO workspaces(id,owner_name,business_name,legal_name,business_email,industry,city,address,postal_code,hours_json,created_at,updated_at) VALUES(?,'Test','Fictional','Fictional',?,'Retail','Edmonton','TEST_ONLY','T1T1T1','[]',?,?)").bind(`org-${suffix}`,`${suffix}@example.invalid`,now,now),
      db.prepare("INSERT INTO organization_locations(id,organization_id,name,country_code,address_line_1,locality,administrative_area,timezone,currency,created_at,updated_at) VALUES(?,?,'TEST_ONLY Store','CA','TEST_ONLY','Edmonton','AB','America/Edmonton','CAD',?,?)").bind(`site-${suffix}`,`org-${suffix}`,now,now),
    ]);
    const actor:InventoryWorkflowActor={organizationId:"org-a",userId:"user-a",locationIds:["site-a"],permissions:["inventory.view","inventory.value","inventory.adjust","purchasing.view","purchasing.receive","purchasing.match"],features:["inventory.lots","inventory.reorder_ai","invoice.matching"],capabilities:["products","lots"]};
    const run=(body:Record<string,unknown>)=>mutateInventoryWorkflow(actor,{locationId:"site-a",mutationKey:crypto.randomUUID(),reviewed:true,date:"2026-09-01",...body},db);
    await run({action:"open_stock",sku:"SKU",productName:"TEST_ONLY Item",unit:"each",quantityMilli:10000,source:"TEST_ONLY physical count"});
    await db.batch([
      db.prepare("INSERT INTO purchase_orders(id,organization_id,order_number,supplier_name,delivery_location_id,order_date,currency,status,subtotal_cents,total_cents,created_by_user_id,created_at,updated_at) VALUES('po','org-a','TEST-PO','Fictional Supplier','site-a','2026-08-01','CAD','sent',2000,2000,'user-a',?,?)").bind(now,now),
      db.prepare("INSERT INTO purchase_order_lines(id,organization_id,purchase_order_id,line_number,sku,description,quantity,received_quantity,unit_cost_cents,created_at,updated_at) VALUES('line','org-a','po',1,'SKU','TEST_ONLY Item',20,0,100,?,?)").bind(now,now),
    ]);
    const request={action:"receive",purchaseOrderId:"po",source:"TEST_ONLY delivery",lines:[{lineId:"line",accepted:5,rejected:2}],mutationKey:crypto.randomUUID()};
    const receipt=await run(request);
    assert.equal((await run(request)).replayed,true);
    const quantity=async()=>await db.prepare("SELECT quantity_milli n FROM workflow_inventory_positions WHERE organization_id='org-a' AND sku='SKU'").first<number>("n");
    assert.equal(await quantity(),15000);
    assert.equal(await db.prepare("SELECT received_quantity n FROM purchase_order_lines WHERE id='line'").first<number>("n"),5);
    const move={sku:"SKU",unit:"each" as const,quantityMilli:-1000,reason:"TEST_ONLY review",sourceReference:"D1-review",occurredDate:"2026-09-02"};
    const first=await prepareManagedInventoryChanges(db,actor,"site-a",[move]),stale=await prepareManagedInventoryChanges(db,actor,"site-a",[{...move,sourceReference:"D1-stale"}]);
    await db.batch(first);await assert.rejects(db.batch(stale),/constraint/i);assert.equal(await quantity(),14000);
    await assert.rejects(db.batch(await prepareManagedInventoryChanges(db,actor,"site-a",[move])),/unique/i);assert.equal(await quantity(),14000);
    await run({action:"reverse_receipt",id:receipt.id,source:"TEST_ONLY reversal",date:"2026-09-03"});assert.equal(await quantity(),9000);
    assert.equal(await db.prepare("SELECT received_quantity n FROM purchase_order_lines WHERE id='line'").first<number>("n"),0);
    const other={...actor,organizationId:"org-b",userId:"user-b",locationIds:["site-b"]};
    assert.equal((await readInventoryWorkflows(other,"site-b",db)).positions.length,0);
    await assert.rejects(readInventoryWorkflows(other,"site-a",db),/available to your account/i);
    assert.equal(await db.prepare("SELECT count(*) n FROM workflow_inventory_guards").first<number>("n"),0);
    await db.prepare("DELETE FROM workspaces WHERE id='org-a'").run();
    for(const table of ["workflow_inventory_positions","workflow_inventory_movements","workflow_inventory_receipts","workflow_inventory_mutations"])assert.equal(await db.prepare(`SELECT count(*) n FROM ${table} WHERE organization_id='org-a'`).first<number>("n"),0);
    assert.equal(await db.prepare("SELECT count(*) n FROM workspaces WHERE id='org-b'").first<number>("n"),1);
    assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results,[]);
  }finally{await runtime.dispose();}
});
