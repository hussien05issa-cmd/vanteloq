import assert from "node:assert/strict";
import test from "node:test";
import { parsePlanSelection, planSelectionUrl, readPlanSelection, savePlanSelection, clearPlanSelection, reconcilePlanSelection } from "../shared/plan-selection";

test("purchase preferences accept only real plan keys and an explicit add-on", () => {
  assert.equal(parsePlanSelection("enterprise", true), null);
  assert.equal(parsePlanSelection({plan:"pro"},true),null);
  assert.deepEqual(parsePlanSelection("starter","true"),{plan:"starter",bookloq:false});
  assert.deepEqual(parsePlanSelection("growth","1"),{plan:"growth",bookloq:true});
  assert.deepEqual(parsePlanSelection("bookloq","1"),{plan:"bookloq",bookloq:false});
  assert.equal(planSelectionUrl({plan:"growth",bookloq:true}),"/?start=signup&plan=growth&bookloq=1");
  assert.equal(planSelectionUrl({plan:"bookloq",bookloq:true}),"/?start=signup&plan=bookloq");
});

test("verified Free activation replaces stale paid intent and existing Free upgrades retain their choice", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  const records = new Map<string,string>();
  let location = new URL("https://vanteloq.example/?start=signup&plan=growth&bookloq=1");
  const browser = { get location() { return location; }, sessionStorage: {
    getItem:(key:string)=>records.get(key)??null, setItem:(key:string,value:string)=>records.set(key,value), removeItem:(key:string)=>records.delete(key),
  }, history: { replaceState(_state:unknown,_title:string,url:string) { location = new URL(url, location); } } };
  Object.defineProperty(globalThis, "window", { configurable:true, value:browser });
  try {
    reconcilePlanSelection({plan:"free",addons:[],accessType:"free"},true);
    assert.equal(location.search, "");
    assert.deepEqual(readPlanSelection(),{plan:"free",bookloq:false});
    location = new URL("https://vanteloq.example/?start=signup&plan=pro&bookloq=1");
    assert.deepEqual(reconcilePlanSelection({plan:"free",addons:[],accessType:"free"},false),{plan:"pro",bookloq:true});
    assert.equal(location.hash,"#billing");
    assert.deepEqual(readPlanSelection(),{plan:"pro",bookloq:true});
    reconcilePlanSelection({plan:"pro",addons:["bookloq"],accessType:"subscription"},false);
    assert.equal(readPlanSelection(),null);
  } finally { if(original) Object.defineProperty(globalThis,"window",original); else Reflect.deleteProperty(globalThis,"window"); }
});
test("plan choice survives a same-browser verification journey and expires safely", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis,"window");
  const records = new Map<string,string>();
  const location = {search:"?start=signup&plan=pro&bookloq=1"};
  const storage = {getItem:(k:string)=>records.get(k)??null,setItem:(k:string,v:string)=>records.set(k,v),removeItem:(k:string)=>records.delete(k)};
  Object.defineProperty(globalThis,"window",{configurable:true,value:{location,sessionStorage:storage}});
  try {
    assert.deepEqual(readPlanSelection(),{plan:"pro",bookloq:true});
    location.search="";
    assert.deepEqual(readPlanSelection(),{plan:"pro",bookloq:true});
    savePlanSelection({plan:"starter",bookloq:false});
    assert.deepEqual(readPlanSelection(),{plan:"starter",bookloq:false});
    for(const key of records.keys()) records.set(key,JSON.stringify({plan:"pro",bookloq:true,savedAt:Date.now()-8*86400000}));
    assert.equal(readPlanSelection(),null);
    clearPlanSelection(); assert.equal(records.size,0);
    location.search="?plan=__proto__&bookloq=1"; assert.equal(readPlanSelection(),null);
  } finally {if(original)Object.defineProperty(globalThis,"window",original);else Reflect.deleteProperty(globalThis,"window");}
});
