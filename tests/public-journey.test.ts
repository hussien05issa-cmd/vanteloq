import assert from "node:assert/strict";
import test from "node:test";
import { planForCapacity, demoRetailSection } from "../domain/public-journey.ts";
test("capacity matching uses both location and team limits",()=>{
 assert.equal(planForCapacity(1,3),"starter");
 assert.equal(planForCapacity(1,5),"growth");
 assert.equal(planForCapacity(3,10),"growth");
 assert.equal(planForCapacity(4,10),"pro");
 assert.equal(planForCapacity(10,25),"pro");
 assert.equal(planForCapacity(11,25),null);
 assert.equal(planForCapacity(1,26),null);
});
test("invalid capacity cannot produce a purchasable match",()=>{
 for(const invalid of [0,-1,1.5,NaN,Infinity]){
  assert.equal(planForCapacity(invalid,1),null);
  assert.equal(planForCapacity(1,invalid),null);
 }
});
test("advertised feature links resolve to the intended demo section",()=>{
 assert.equal(demoRetailSection("#products"),"Products");
 assert.equal(demoRetailSection("#baskets"),"Baskets");
 assert.equal(demoRetailSection("#inventory"),"Inventory");
 assert.equal(demoRetailSection("#retail"),"Why it changed");
 assert.equal(demoRetailSection("#operations"),"Operations");
 assert.equal(demoRetailSection("#customers"),"Customers");
 for(const hash of ["","toString","__proto__","#unknown","#Products","#bookloq"]) assert.equal(demoRetailSection(hash),null);
});

