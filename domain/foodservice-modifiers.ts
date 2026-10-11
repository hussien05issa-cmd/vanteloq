import { convertFoodQuantity, costRecipe, type FoodIngredient, type FoodRecipe } from "./foodservice";

export type FoodModifier = { id: string; label: string; operation: "add" | "replace" | "remove"; targetId: string | null; ingredient: FoodIngredient | null };
function identifier(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 120 || /[\u0000-\u001f\u007f]/.test(value)) throw Error("Use a readable modifier identifier and label, up to 120 characters.");
  return value.trim();
}
export function validateFoodModifiers(value: unknown, recipe: FoodRecipe): FoodModifier[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 40) throw Error("Use up to 40 reviewed modifier mappings.");
  const ids = new Set<string>();
  return value.map(raw => {
    if (!raw || typeof raw !== "object") throw Error("Review this modifier mapping.");
    const row = raw as Record<string,unknown>, id = identifier(row.id), label = identifier(row.label);
    if (ids.has(id)) throw Error("Modifier identifiers must be unique."); ids.add(id);
    if (typeof row.operation !== "string" || !["add","replace","remove"].includes(row.operation)) throw Error("Choose Add, Replace or Remove for each modifier.");
    const operation = row.operation as FoodModifier["operation"];
    const targetId = operation === "add" ? null : identifier(row.targetId);
    if (targetId && !recipe.ingredients?.some(i=>i.id===targetId)) throw Error(`Modifier ${label} targets an ingredient that is not in this recipe.`);
    let ingredient:FoodIngredient|null=null;
    if (operation !== "remove") {
      if (!row.ingredient || typeof row.ingredient !== "object") throw Error(`Enter the ingredient for ${label}.`);
      const i = row.ingredient as FoodIngredient;
      const readQuantity = (q: FoodIngredient["recipeQuantity"]) => q == null ? null : { amount:q.amount??null,unit:q.unit };
      ingredient = {id:identifier(i.id),purchaseQuantity:readQuantity(i.purchaseQuantity),purchaseCost:i.purchaseCost==null?null:{currency:i.purchaseCost.currency,minor:i.purchaseCost.minor},recipeQuantity:readQuantity(i.recipeQuantity),preparationYield:i.preparationYield??null};
      costRecipe({currency:recipe.currency,portions:"1",ingredients:[ingredient]});
    }
    return {id,label,operation,targetId,ingredient};
  });
}
function addIngredient(left:FoodIngredient,right:FoodIngredient):FoodIngredient {
  const equalDecimal = (a:string|null|undefined,b:string|null|undefined) => a == null || b == null ? a == null && b == null : a.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") === b.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  if (left.purchaseQuantity?.unit!==right.purchaseQuantity?.unit || !equalDecimal(left.purchaseQuantity?.amount,right.purchaseQuantity?.amount) || left.purchaseCost?.currency!==right.purchaseCost?.currency || left.purchaseCost?.minor!==right.purchaseCost?.minor || !equalDecimal(left.preparationYield,right.preparationYield)) throw Error(`Use the same purchase cost and yield basis for ${left.id}.`);
  if (!left.recipeQuantity || !right.recipeQuantity || left.recipeQuantity.amount===null || right.recipeQuantity.amount===null) return {...left,recipeQuantity:{unit:left.recipeQuantity?.unit??right.recipeQuantity?.unit??"each",amount:null}};
  const addition = convertFoodQuantity(right.recipeQuantity,left.recipeQuantity.unit);
  if(addition.status!=="available") throw Error(`Review the quantity for ${left.id}.`);
  const scale=BigInt(1000000),n=BigInt(addition.value.numerator)*scale,d=BigInt(addition.value.denominator);
  if(n%d!==BigInt(0)) throw Error(`The converted ${left.id} quantity needs more than six decimal places. Use a compatible explicit base unit.`);
  const [whole,places=""]=left.recipeQuantity.amount.split(".");
  const total=BigInt(whole+places.padEnd(6,"0"))+n/d;
  const amount=(total/scale).toString()+"."+(total%scale).toString().padStart(6,"0");
  return {...left,recipeQuantity:{unit:left.recipeQuantity.unit,amount}};
}
/** Substitution removes its base allocation. Unknown or conflicting combinations
 * never receive a complete cost, and no stock movement is implied. */
export function applyFoodModifiers(recipe:FoodRecipe, selected:readonly string[]) {
  const baseCost=costRecipe(recipe);
  if (!recipe.ingredients?.length) return {status:"incomplete_base" as const,unknown:[],ingredients:null,cost:baseCost};
  const modifiers=validateFoodModifiers(recipe.modifiers,recipe);
  if(selected.length>40 || new Set(selected).size!==selected.length) throw Error("Choose each modifier once.");
  const unknown=selected.filter(id=>!modifiers.some(m=>m.id===id));
  if(unknown.length) return {status:"unmapped" as const,unknown,ingredients:null,cost:null};
  const chosen=selected.map(id=>modifiers.find(m=>m.id===id)!);
  const targets=chosen.filter(m=>m.targetId).map(m=>m.targetId);
  if(new Set(targets).size!==targets.length) throw Error("Two selected modifiers replace or remove the same ingredient. Choose one.");
  const ingredients=(recipe.ingredients??[]).filter(i=>!targets.includes(i.id)).map(i=>({...i}));
  // Replacements precede additions, independent of checkbox/click order.
  for(const modifier of [...chosen.filter(m=>m.operation==="replace"),...chosen.filter(m=>m.operation==="add")]) {
    const ingredient=modifier.ingredient!,index=ingredients.findIndex(i=>i.id===ingredient.id);
    if(index<0) ingredients.push({...ingredient}); else ingredients[index]=addIngredient(ingredients[index],ingredient);
  }
  if(!ingredients.length) throw Error("This combination removes every ingredient. Review the recipe.");
  return {status:"mapped" as const,unknown:[],ingredients,cost:costRecipe({...recipe,ingredients})};
}
