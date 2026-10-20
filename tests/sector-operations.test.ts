import assert from "node:assert/strict";
import test from "node:test";
import { SECTOR_DEFINITIONS, sectorKindsFor, sectorNextState, sectorReport, sectorScaled, validateSectorContent, type SectorKind, type SectorRecord } from "../domain/sector-operations.ts";
function content(kind:SectorKind, values:Record<string,unknown>={}){
  const defaults:Record<string,unknown>={};for(const f of SECTOR_DEFINITIONS[kind].fields)defaults[f.key]=f.optional?null:["integer","quantity","money"].includes(f.type)?0:f.type==="boolean"?false:f.type==="date"?"2026-09-01":f.type==="choice"?f.options![0]:`source-${f.key}`;
  return validateSectorContent({kind,title:"Reviewed source",source:"Fictional test sheet",sourceDate:"2026-09-01",dueDate:"",notes:"",currency:"CAD",values:{...defaults,...values},batch:null});
}
const record=(kind:SectorKind,values:Record<string,unknown>={}):SectorRecord=>({...content(kind,values),id:"test-id",locationId:"test-location",version:1,state:"draft",updatedAt:1});
const metric=(kind:SectorKind,values:Record<string,unknown>,label:string)=>sectorReport(content(kind,values)).metrics.find(m=>m.label===label)!.value;
test("business capability gating does not show hotel rooms or vehicles to a cafe",()=>{
  assert.deepEqual(sectorKindsFor({templateId:"cafe",capabilities:["products","food_costing"]}),["prep_plan","prep_batch","supplier_check","service_period","delivery_order"]);
  assert.deepEqual(sectorKindsFor({templateId:"hospitality",capabilities:["products"]}),["room","reservation"]);
  assert.deepEqual(sectorKindsFor({templateId:"dealership",capabilities:["vehicles"]}),["dealer_funding"]);
  assert.deepEqual(sectorKindsFor({templateId:"retail",capabilities:["products"]}),[]);
});
test("prep planning subtracts usable and already planned portions before batch rounding",()=>{
  const values={demand:120500,buffer:10000,usable:15000,planned:10000,batch:12000,shelfLifeDays:1};
  assert.equal(metric("prep_plan",values,"Suggested portions"),108000);
  assert.equal(metric("prep_plan",{...values,usable:200000},"Suggested portions"),0);
  assert.equal(metric("prep_plan",{...values,demand:null},"Suggested portions"),null);
  assert.throws(()=>content("prep_plan",{...values,batch:0}),/greater than zero/);
});
test("delivery contribution and payout gap use different bases without counting tax as revenue",()=>{
  const values={netSales:10000,taxTips:1000,fees:2500,adjustments:0,payout:8500,foodCost:2000,packaging:500,incrementalLabour:0,resolved:false};
  const report=sectorReport(content("delivery_order",values));
  assert.equal(report.metrics.find(m=>m.label==="Expected settlement")!.value,8500);
  assert.equal(report.metrics.find(m=>m.label==="Unreconciled settlement")!.value,0);
  assert.equal(report.metrics.find(m=>m.label==="Order contribution")!.value,5000);
  assert.equal(report.canComplete,true);
  assert.equal(sectorReport(content("delivery_order",{...values,payout:8000})).canComplete,false);
  assert.equal(metric("delivery_order",{...values,foodCost:null},"Order contribution"),null);
});
test("service period requires reviewed coverage and handles zero denominators as unknown",()=>{
  const values={projectedSales:200000,netSales:180000,plannedMinutes:600,paidMinutes:720,labourCost:40000,orders:60,lateOrders:6,coverageComplete:true};
  assert.equal(metric("service_period",values,"Sales per paid hour"),15000);
  assert.equal(metric("service_period",values,"Labour cost / net sales"),2222);
  assert.equal(metric("service_period",values,"Late order rate"),1000);
  assert.equal(metric("service_period",{...values,paidMinutes:0},"Sales per paid hour"),null);
  assert.equal(metric("service_period",{...values,coverageComplete:false},"Sales per paid hour"),null);
  assert.throws(()=>content("service_period",{...values,lateOrders:61}),/cannot exceed/);
});
test("supplier reconciliation cannot close an unexplained receiving discrepancy",()=>{
  const values={ordered:10000,received:9000,invoiced:10000,invoiceAmount:10000,creditExpected:1000,creditReceived:0,disposition:"matched"};
  assert.equal(sectorReport(content("supplier_check",values)).canComplete,false);
  assert.equal(metric("supplier_check",values,"Supplier credit outstanding"),1000);
  const fixed=content("supplier_check",{...values,creditReceived:1000,disposition:"resolved"});
  assert.equal(sectorReport(fixed).canComplete,false);fixed.notes="One unit short; supplier issued and paid the documented credit.";assert.equal(sectorReport(fixed).canComplete,true);
});
test("furniture and dealer release require payment and delivery evidence",()=>{
  const order={orderTotal:120000,deposit:20000,otherPayments:100000,supplierCost:50000,deliveryStatus:"delivered",accepted:true,creditTerms:false};
  assert.equal(sectorReport(content("furniture_order",order)).canComplete,true);
  assert.equal(sectorReport(content("furniture_order",{...order,otherPayments:110000,creditTerms:true})).canComplete,false);
  assert.equal(sectorReport(content("furniture_order",{...order,accepted:false})).canComplete,false);
  const deal={fundingExpected:1500000,fundingReceived:1500000,payoffDue:300000,payoffPaid:300000,customerDue:500000,customerReceived:500000,documentsReady:true,releaseReady:true};
  assert.equal(sectorReport(content("dealer_funding",deal)).canComplete,true);
  assert.equal(sectorReport(content("dealer_funding",{...deal,fundingReceived:1499999})).canComplete,false);
});
test("hospitality separates room readiness, stay nights and folio balance",()=>{
  assert.equal(sectorReport(content("room",{condition:"inspected",occupied:false,blocked:false})).canComplete,true);
  assert.equal(sectorReport(content("room",{condition:"clean",occupied:false,blocked:false})).canComplete,false);
  assert.throws(()=>content("room",{blocked:true,blockReason:null}),/service block/);
  const values={arrival:"2026-09-01",departure:"2026-09-04",roomRevenue:60000,folioTotal:65000,payments:60000,arTransferred:5000,arRef:"AR-1"};
  assert.equal(metric("reservation",values,"Room nights"),3);assert.equal(metric("reservation",values,"Average room rate"),20000);assert.equal(sectorReport(content("reservation",values)).canComplete,true);
  assert.throws(()=>content("reservation",{...values,arRef:null}),/AR transfer/);
  assert.throws(()=>content("reservation",{...values,departure:"2026-09-01"}),/after arrival/);
});
test("vehicle holding estimates preserve unknowns and use exact rate times calendar days",()=>{
  const absent=content("dealer_funding");
  assert.equal(sectorReport(absent).metrics.find(m=>m.label==="Holding-cost estimate")!.value,null);
  assert.equal(sectorReport(absent).metrics.find(m=>m.label==="Holding days")!.value,null);
  assert.equal(sectorReport(absent).metrics.find(m=>m.label==="Reviewed daily holding cost")!.value,null);
  const partial=content("dealer_funding",{holdingDailyCost:1234});
  assert.deepEqual(sectorReport(partial).missing,["Holding period starts","Holding period ends"]);
  assert.throws(()=>sectorNextState({...partial,id:"holding",locationId:"location",version:1,state:"draft",updatedAt:1},"review"),/required evidence/);
  const leap={holdingDailyCost:1234,holdingFrom:"2024-02-28",holdingTo:"2024-03-01"};
  assert.equal(metric("dealer_funding",leap,"Holding days"),2);
  assert.equal(metric("dealer_funding",leap,"Holding-cost estimate"),2468);
  const dst={holdingDailyCost:999,holdingFrom:"2026-03-07",holdingTo:"2026-03-10"};
  assert.equal(metric("dealer_funding",dst,"Holding days"),3);
  assert.equal(metric("dealer_funding",dst,"Holding-cost estimate"),2997);
  assert.equal(metric("dealer_funding",{...dst,holdingDailyCost:0},"Holding-cost estimate"),0);
  assert.equal(metric("dealer_funding",{...dst,holdingTo:dst.holdingFrom},"Holding-cost estimate"),0);
  assert.throws(()=>content("dealer_funding",{...dst,holdingTo:"2026-03-06"}),/cannot precede/);
  assert.throws(()=>content("dealer_funding",{...dst,holdingTo:"2026-09-02"}),/source as-of/);
  assert.throws(()=>content("dealer_funding",{...dst,holdingFrom:"2026-02-30"}),/valid/);
  assert.throws(()=>metric("dealer_funding",{holdingDailyCost:1_000_000_000_000,holdingFrom:"1900-01-01",holdingTo:"2026-09-01"},"Holding-cost estimate"),/supported range/);
});
test("reviewed evidence is immutable until reopen and requires a full completion cycle",()=>{
  const row=record("room",{condition:"inspected",occupied:false,blocked:false});
  assert.equal(sectorNextState(row,"review"),"reviewed");row.state="reviewed";assert.equal(sectorNextState(row,"complete"),"completed");row.state="completed";assert.equal(sectorNextState(row,"reopen"),"draft");
  assert.throws(()=>sectorNextState(row,"review"),/not available/);
  const reservation=record("reservation",{arrival:"2026-09-01",departure:"2026-09-02",roomRevenue:10000,folioTotal:10000,payments:10000,arTransferred:0});reservation.state="reviewed";assert.throws(()=>sectorNextState(reservation,"complete"),/Check in/);assert.equal(sectorNextState(reservation,"start"),"active");
});
test("decimal input and stock transformations cannot silently round or combine incompatible SKUs",()=>{
  assert.equal(sectorScaled("0.125",3),125);assert.equal(sectorScaled("12.34",2),1234);assert.equal(sectorScaled("100",0),100);assert.equal(sectorScaled("",2),null);
  for(const v of ["1e3","-1","01","Infinity","1.001"])assert.throws(()=>sectorScaled(v,2));
  const batch=content("prep_batch",{portions:10000,wastePortions:0});assert.equal(sectorReport(batch).missing.includes("Ingredient and output stock lines"),true);
  assert.throws(()=>validateSectorContent({...batch,batch:{output:{sku:"A",unit:"each",quantityMilli:1000},inputs:[{sku:"A",unit:"g",quantityMilli:1000}]}}),/separate/);
  assert.throws(()=>validateSectorContent({...batch,values:{...batch.values,wastePortions:11000}}),/cannot exceed/);
});
