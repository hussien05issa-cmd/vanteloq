import test from "node:test";
import assert from "node:assert/strict";
import { applyFoodModifiers, validateFoodModifiers, type FoodModifier } from "../domain/foodservice-modifiers";
import { foodservicePeriodMetrics, validateFoodserviceContent, type FoodRecipe } from "../domain/foodservice";
const cad=(minor:number)=>({currency:"CAD",minor});
const beans={id:"beans",purchaseQuantity:{amount:"1000",unit:"g" as const},purchaseCost:cad(2000),recipeQuantity:{amount:"18",unit:"g" as const},preparationYield:"1"};
const milk={id:"milk",purchaseQuantity:{amount:"1",unit:"l" as const},purchaseCost:cad(400),recipeQuantity:{amount:"200",unit:"ml" as const},preparationYield:"1"};
const cup={id:"cup",purchaseQuantity:{amount:"100",unit:"each" as const},purchaseCost:cad(1000),recipeQuantity:{amount:"1",unit:"each" as const},preparationYield:"1"};
const recipe:FoodRecipe={currency:"CAD",portions:"1",ingredients:[beans,milk,cup]};
const extra:FoodModifier={id:"shot",label:"Extra shot",operation:"add",targetId:null,ingredient:{...beans,purchaseCost:{minor:2000,currency:"CAD"},preparationYield:"1.0",recipeQuantity:{amount:"0.009",unit:"kg"}}};
const oat:FoodModifier={id:"oat",label:"Oat milk",operation:"replace",targetId:"milk",ingredient:{...milk,id:"oat milk",purchaseCost:cad(500)}};
test("substitutions and extras preserve units, exact cost and independence from click order",()=>{
 const mapped={...recipe,modifiers:[extra,oat]};
 const result=applyFoodModifiers(mapped,["shot","oat"]);
 assert.equal(result.status,"mapped");if(result.status!=="mapped")throw Error("missing mapping");
 assert.equal(result.ingredients.find(i=>i.id==="beans")?.recipeQuantity?.amount,"27.000000");
 assert.ok(!result.ingredients.some(i=>i.id==="milk"));
 assert.equal(result.ingredients.find(i=>i.id==="oat milk")?.recipeQuantity?.amount,"200");
 assert.equal(result.cost.status,"available");if(result.cost.status==="available")assert.equal(result.cost.value.totalMinor,164);
 assert.deepEqual(result,applyFoodModifiers(mapped,["oat","shot"]));
 assert.equal(recipe.ingredients?.[0].recipeQuantity?.amount,"18");
});
test("unknown, conflicting, malformed and incompatible modifiers never imply a complete cost",()=>{
 assert.equal(applyFoodModifiers({...recipe,modifiers:[extra]},["unknown"]).status,"unmapped");
 assert.throws(()=>applyFoodModifiers({...recipe,modifiers:[extra]},["shot","shot"]),/once/);
 assert.throws(()=>validateFoodModifiers([{...oat,operation:["remove"]}],recipe),/Choose/);
 assert.throws(()=>applyFoodModifiers({...recipe,modifiers:[oat,{id:"none",label:"No milk",operation:"remove",targetId:"milk",ingredient:null}]},["oat","none"]),/same ingredient/);
 assert.throws(()=>validateFoodModifiers([{...extra,ingredient:{...beans,recipeQuantity:{amount:"2",unit:"ml"}}}],recipe),/dimension/);
 const missing=applyFoodModifiers({...recipe,modifiers:[{...oat,ingredient:{...oat.ingredient!,purchaseCost:null}}]},["oat"]);
 assert.equal(missing.status==="mapped"&&missing.cost.status,"unavailable");
});
test("normal record validation retains modifiers and refuses orphaned targets",()=>{
 const input={kind:"recipe",name:"Latte",source:"Reviewed pack costs",asOfDate:"2026-09-30",payload:{...recipe,modifiers:[oat,extra]}};
 const saved=validateFoodserviceContent(input);assert.equal(saved.kind,"recipe");if(saved.kind!=="recipe")throw Error("wrong kind");
 assert.equal(saved.payload.modifiers?.length,2);
 assert.throws(()=>validateFoodserviceContent({...input,payload:{...input.payload,ingredients:[beans,cup]}}),/not in this recipe/);
});
test("recorded waste explains variance without becoming an additional expense",()=>{
 const p={currency:"CAD",actualCost:cad(30000),theoreticalCost:cad(28000),recordedWasteCost:cad(1000),availableInventoryCost:cad(50000),foodNetSales:cad(100000),totalNetSales:cad(100000),labourCost:null,otherVariableCosts:null,closedChecks:10};
 const r=foodservicePeriodMetrics(p);
 assert.deepEqual(r.costVariance,{status:"available",value:cad(2000)});
 assert.deepEqual(r.unexplainedCostVariance,{status:"available",value:cad(1000)});
 assert.deepEqual(r.foodContribution,{status:"available",value:cad(70000)});
 assert.equal(foodservicePeriodMetrics({...p,recordedWasteCost:null}).unexplainedCostVariance.status,"unavailable");
 assert.deepEqual(foodservicePeriodMetrics({...p,recordedWasteCost:cad(31000)}).unexplainedCostVariance,{status:"unavailable",reason:"inconsistent_waste",fields:["recordedWasteCost","actualCost"]});
});

test("an extra cannot turn an unknown base recipe into a complete cost",()=>{
 const result=applyFoodModifiers({...recipe,ingredients:null,modifiers:[extra]},["shot"]);
 assert.equal(result.status,"incomplete_base");
 assert.equal(result.ingredients,null);
 assert.equal(result.cost?.status,"unavailable");
});
