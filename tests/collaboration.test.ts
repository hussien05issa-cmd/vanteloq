import assert from "node:assert/strict";
import test from "node:test";
import { collaborationMessageInput, taskInCollaborationScope, validCollaborationDate } from "../domain/collaboration.ts";
test("legacy global tasks stay private to location-limited members",()=>{
  assert.equal(taskInCollaborationScope({locationId:null},{organizationWide:false,locationIds:["a"]}),false);
  assert.equal(taskInCollaborationScope({locationId:"a"},{organizationWide:false,locationIds:["a"]}),true);
  assert.equal(taskInCollaborationScope({locationId:"b"},{organizationWide:false,locationIds:["a"]}),false);
});
test("message validation preserves plain text and refuses invalid task IDs, control characters and unknown fields",()=>{
  assert.deepEqual(collaborationMessageInput({body:"  Update\nSecond line  ",taskId:3}),{body:"Update\nSecond line",locationId:null,taskId:3});
  for(const body of [{body:""},{body:"x",taskId:-1},{body:"x",taskId:"3"},{body:"x\u0000"},{body:"x",organizationId:"foreign"}])assert.throws(()=>collaborationMessageInput(body));
  assert.equal(validCollaborationDate("2026-02-30"),false);assert.equal(validCollaborationDate("2028-02-29"),true);
});
