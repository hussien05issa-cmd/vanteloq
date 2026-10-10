import assert from "node:assert/strict";
import test from "node:test";
import { collaborationMessageInput, taskInCollaborationScope, validCollaborationDate, reconcileMessagePage, taskArchiveCursor, messageLatestPageNeedsReset } from "../domain/collaboration.ts";
test("legacy global tasks stay private to location-limited members",()=>{
  assert.equal(taskInCollaborationScope({locationId:null},{organizationWide:false,locationIds:["a"]}),false);
  assert.equal(taskInCollaborationScope({locationId:"a"},{organizationWide:false,locationIds:["a"]}),true);
  assert.equal(taskInCollaborationScope({locationId:"b"},{organizationWide:false,locationIds:["a"]}),false);
});
test("authoritative empty and complete message refreshes discard deleted cached history", () => {
  const cached = [{id:1,body:"Old"},{id:2,body:"Removed"}];
  assert.deepEqual(reconcileMessagePage(cached, [], false, false), []);
  assert.deepEqual(reconcileMessagePage(cached, [{id:1,body:"Current"}], false, false), [{id:1,body:"Current"}]);
  assert.deepEqual(reconcileMessagePage(cached, [{id:3,body:"New"}], false, true, true), [{id:3,body:"New"}]);
});
test("loading earlier conversation pages preserves current messages without duplicates", () => {
  assert.deepEqual(reconcileMessagePage([{id:3,body:"Current"}], [{id:1,body:"First"},{id:3,body:"Updated"}], true, false), [{id:1,body:"First"},{id:3,body:"Updated"}]);
  assert.equal(taskArchiveCursor(null), null); assert.equal(taskArchiveCursor("42"), 42);
  for (const value of ["", "0", "-1", "1.5", "2x", "9007199254740992"]) assert.throws(() => taskArchiveCursor(value));
});
test("a nonoverlapping latest page restores reachable older history after a burst of messages", () => {
  const cached = Array.from({length:10}, (_,index) => ({id:index+1,body:"Previously read"}));
  const incoming = Array.from({length:60}, (_,index) => ({id:index+31,body:"Latest page"}));
  const reset = messageLatestPageNeedsReset(10, incoming, true);
  assert.equal(reset, true, "The client must restore server hasEarlier on a gap reset");
  assert.deepEqual(reconcileMessagePage(cached, incoming, false, true, reset), incoming);
  assert.equal(messageLatestPageNeedsReset(40, incoming, true), false, "An overlapping page can retain previously read history");
  assert.equal(messageLatestPageNeedsReset(null, incoming, true), false, "Initial reads already adopt server pagination");
  assert.equal(messageLatestPageNeedsReset(10, [], false), false);
  const withLocalSend = [...cached, {id:90,body:"Locally sent"}];
  assert.deepEqual(reconcileMessagePage(withLocalSend, incoming, false, true, reset), incoming, "An optimistic sent message does not prove the intermediate messages were read");
});
test("message validation preserves plain text and refuses invalid task IDs, control characters and unknown fields",()=>{
  assert.deepEqual(collaborationMessageInput({body:"  Update\nSecond line  ",taskId:3}),{body:"Update\nSecond line",locationId:null,taskId:3});
  for(const body of [{body:""},{body:"x",taskId:-1},{body:"x",taskId:"3"},{body:"x\u0000"},{body:"x",organizationId:"foreign"}])assert.throws(()=>collaborationMessageInput(body));
  assert.equal(validCollaborationDate("2026-02-30"),false);assert.equal(validCollaborationDate("2028-02-29"),true);
});
