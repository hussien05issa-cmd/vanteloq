import test from "node:test";
import assert from "node:assert/strict";
import { invoiceExceptions, parseMinorAmount, parseQuantityMilli, supplierProposal, validateInventoryContent, variantReturnReport, type SupplierPolicy, type VariantReturns } from "../domain/workflow-inventory.ts";

const supplier:SupplierPolicy={sku:"COFFEE",supplier:"Fictional supplier",source:"TEST_ONLY purchase evidence",asOf:"2026-10-01",soldUnits:100,sellingDays:10,leadDays:4,reviewDays:3,safetyUnits:10,packSize:12,minimumOrder:24,onHand:20,inbound:12,committed:2,unitCostCents:155,cashBudgetCents:null,storageLimit:null,shelfDays:null};
test("supplier proposal uses inventory position, rounds cases and preserves exact money",()=>{
  const r=supplierProposal(supplier);assert.equal(r.inventoryPosition,30);assert.equal(r.targetUnits,80);assert.equal(r.proposedUnits,60);assert.equal(r.costCents,9300);assert.deepEqual(r.missingLimits,["Cash budget","Storage capacity","Shelf life"]);
});
test("minimum order cannot override shelf, storage or cash constraints",()=>{
  for(const constraint of [{cashBudgetCents:2000},{storageLimit:42},{shelfDays:4}]) {const r=supplierProposal({...supplier,...constraint});assert.equal(r.proposedUnits,0);assert.equal(r.status,"blocked");assert.ok(r.constraints.length);}
  const r=supplierProposal({...supplier,cashBudgetCents:5600});assert.equal(r.proposedUnits,36);assert.equal(r.status,"constrained");
});
test("observed zero demand does not produce an automatic minimum order",()=>{assert.equal(supplierProposal({...supplier,soldUnits:0,safetyUnits:0}).proposedUnits,0);});
test("decimal quantity and money parsing reject precision loss and exponent notation",()=>{
  assert.equal(parseQuantityMilli("0.125"),125);assert.equal(parseMinorAmount("12.30"),1230);for(const x of ["1e3","-1","NaN","1.1234"])assert.throws(()=>parseQuantityMilli(x));assert.throws(()=>parseMinorAmount("1.005"));assert.throws(()=>parseQuantityMilli("99999999999999999"));
});
const returns:VariantReturns={style:"Test shirt",variant:"T-M",size:"M",colour:"Blue",source:"TEST_ONLY matched sale and return lines",asOf:"2026-10-01",from:"2026-09-01",to:"2026-09-20",returnWindowDays:30,soldUnits:100,returnedUnits:10,fitReturns:5,defectReturns:2,otherReturns:1,restockableUnits:7,refundCents:20000};
test("return cohorts expose maturation, missing reasons and non-restockable units",()=>{
  const r=variantReturnReport(returns);assert.equal(r.returnRate,.1);assert.equal(r.cohortMature,false);assert.equal(r.daysUntilMature,19);assert.equal(r.reasonCoverage,.8);assert.equal(r.unclassified,2);assert.equal(r.unrestockableUnits,3);
  assert.equal(variantReturnReport({...returns,asOf:"2026-10-25"}).cohortMature,true);
});
test("invalid returns cannot fabricate more returned units or reasons than the cohort",()=>{
  assert.throws(()=>validateInventoryContent("returns",{...returns,returnedUnits:101}));assert.throws(()=>validateInventoryContent("returns",{...returns,fitReturns:11}));assert.throws(()=>validateInventoryContent("returns",{...returns,to:"2026-10-02"}));
});
test("line-level invoice review isolates quantity and price exceptions",()=>{
  const r=invoiceExceptions({purchaseOrderId:"p",invoiceReference:"i",source:"test",asOf:"2026-10-01",lines:[{lineId:"a",ordered:10,accepted:8,billed:10,agreedUnitCostCents:200,billedUnitCostCents:210},{lineId:"b",ordered:10,accepted:10,billed:10,agreedUnitCostCents:200,billedUnitCostCents:190}]});
  assert.equal(r[0].quantityDifference,2);assert.equal(r[0].priceDifferenceCents,100);assert.equal(r[0].status,"quantity_exception");assert.equal(r[1].priceDifferenceCents,-100);assert.equal(r[1].status,"price_exception");
});
test("lot resolution requires evidence and links cannot embed credentials",()=>{
  const lot={lotId:"l",issue:"quality",units:1,status:"resolved",source:"test",asOf:"2026-10-01",nextAction:"Retain evidence",resolution:"",evidenceUrl:"",creditCents:null};assert.throws(()=>validateInventoryContent("lot_case",lot));assert.throws(()=>validateInventoryContent("lot_case",{...lot,resolution:"Reviewed",evidenceUrl:"https://user:secret@example.com/"}));
});
