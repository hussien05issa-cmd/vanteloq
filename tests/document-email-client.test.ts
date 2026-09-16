import assert from "node:assert/strict";
import test from "node:test";
import { createDocumentEmailRequests,documentEmailAccessKey } from "../app/document-email-client.ts";

test("inbox identity changes for role, permission and location restrictions without changing for order alone",()=>{
  const organization={role:"admin",permissions:["documents.view","organization.settings"],scopeLabel:"All locations",locations:[{id:"one"},{id:"two"}],selectedLocation:null};
  const original=documentEmailAccessKey(organization);
  for(const change of [{role:"employee"},{permissions:["documents.view"]},{scopeLabel:"Accessible locations"},{locations:[{id:"one"}]},{selectedLocation:{id:"one"}}])assert.notEqual(documentEmailAccessKey({...organization,...change}),original);
  assert.equal(documentEmailAccessKey({...organization,permissions:[...organization.permissions].reverse(),locations:[...organization.locations].reverse()}),original);
});
test("a newer permission response or unmount cancels old requests and cannot restore stale inbox data",async()=>{
  const requests=createDocumentEmailRequests();let resolveOld!:()=>void;const late=new Promise<void>(resolve=>{resolveOld=resolve;});let displayed="old private address";
  const old=requests.begin();const response=late.then(()=>{if(old.current())displayed="stale private address";});
  const current=requests.begin();assert.equal(old.signal.aborted,true);assert.equal(current.current(),true);displayed="";
  resolveOld();await response;assert.equal(displayed,"");requests.cancel();assert.equal(current.current(),false);assert.equal(current.signal.aborted,true);
  const remounted=requests.begin();assert.equal(remounted.current(),true,"React effect restart can safely issue a fresh request");
});
