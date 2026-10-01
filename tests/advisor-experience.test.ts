import test from "node:test";
import assert from "node:assert/strict";
import { advisorGreeting, advisorPreferences, isAdvisorGreeting } from "../domain/advisor-personalization.ts";
import { currentChatBinding, signAdvisorTurn, verifyAdvisorTurns } from "../server/advisor-current-chat.ts";
import { callAdvisor } from "../server/advisor-providers.ts";
import { readAdvisorAnswer } from "../app/advisor-client.ts";
const env={INTEGRATION_ENCRYPTION_KEY:btoa("a".repeat(32)),OPENAI_API_KEY:"fictional-test"};
test("greetings are brief and use only a safe known first name",()=>{
  assert.equal(advisorGreeting("Hello","Alex Morgan"),"Hi Alex. What would you like to work on today?");
  assert.equal(advisorGreeting("Hello","owner@example.invalid"),"Hi. What would you like to work on today?");
  assert.equal(isAdvisorGreeting("Hello, why are sales down?"),false);
  assert.equal(isAdvisorGreeting("HELLO!"),true);
});
test("personalisation is an enum allowlist without financial or personal facts",()=>{
  const p=advisorPreferences({length:"detailed",priorities:["cash","cash","123456"],name:"Private",balance:1234,explanation:"technical"});
  assert.deepEqual(p.priorities,["cash"]);assert.equal(p.length,"detailed");assert.equal("name" in p,false);assert.equal("balance" in p,false);
});
test("current chat is signed, bound to full access and session, expires, and carries file-derived privacy",async()=>{
  const stamp=JSON.stringify({historyGeneration:"before",role:"owner"});
  const binding=await currentChatBinding({org:"a",user:"one",session:"first"},stamp,{purpose:"analysis",locationId:"one"});
  const proof=await signAdvisorTurn(env,binding,"Profit?","Costs are missing.",true,null,1000);
  assert.ok(proof);
  const turns=[{question:"Profit?",answer:"Costs are missing.",proof}];
  const valid=await verifyAdvisorTurns(env,binding,turns,async()=>true,2000);assert.equal(valid.files,true);assert.match(valid.messages[1].content,/historical/);
  for(const input of [[{...turns[0],answer:"Profit is certain."}],[{...turns[0],proof:proof.slice(0,-3)+"zzz"}]]) await assert.rejects(verifyAdvisorTurns(env,binding,input,async()=>true,2000),/expired/);
  await assert.rejects(verifyAdvisorTurns(env,binding,turns,async()=>true,2_000_000),/expired/);
  for(const other of ["different workspace","different role","deleted all","different session"]) await assert.rejects(verifyAdvisorTurns(env,other,turns,async()=>true,2000),/expired/);
  const saved=await signAdvisorTurn(env,binding,"A","B",false,"deleted-chat",1000);
  await assert.rejects(verifyAdvisorTurns(env,binding,[{question:"A",answer:"B",proof:saved}],async()=>false,2000),/expired/);
});
test("provider streams real deltas before completion and ignores reasoning events",async()=>{
  const encoder=new TextEncoder();let release!:()=>void;const barrier=new Promise<void>(r=>release=r);let seen!:()=>void;const first=new Promise<void>(r=>seen=r);
  const request:typeof fetch=async(_url,init)=>{
    assert.equal(JSON.parse(String(init?.body)).stream,true);
    return new Response(new ReadableStream({async start(c){
      c.enqueue(encoder.encode('data: {"type":"response.reasoning.delta","delta":"private"}\n\n'));
      c.enqueue(encoder.encode('data: {"type":"response.output_text.delta","delta":"Gross margin "}\n\n'));
      await barrier;
      c.enqueue(encoder.encode('data: {"type":"response.output_text.delta","delta":"is 40%."}\n\n'));
      c.enqueue(encoder.encode('data: {"type":"response.completed","response":{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"Gross margin is 40%."}]}],"usage":{"input_tokens":100,"output_tokens":20}}}\n\n'));c.close();
    }}),{headers:{"content-type":"text/event-stream"}});
  };
  const parts:string[]=[];
  const pending=callAdvisor("openai","Fictional",env,request,"help",undefined,[],async text=>{parts.push(text);seen();});
  await first;assert.deepEqual(parts,["Gross margin "]);release();
  const result=await pending;assert.equal(result.text,"Gross margin is 40%.");assert.equal(result.configured&&result.usage.inputTokens,100);
});
test("client renders partial replies and rejects a stream without completion",async()=>{
  const encoder=new TextEncoder();const input={question:"Hi",provider:"openai" as const,conversationId:null,memoryEnabled:false,dataUseAccepted:true,stream:true};
  const fetcher=(complete:boolean):typeof fetch=>async()=>new Response(new ReadableStream({start(c){const text='{"type":"delta","text":"Café"}\n'+(complete?'{"type":"done","payload":{"answer":"Café","status":"answered"}}\n':'');const bytes=encoder.encode(text);for(const byte of bytes)c.enqueue(new Uint8Array([byte]));c.close();}}),{headers:{"content-type":"application/x-ndjson"}});
  const seen:string[]=[];const result=await readAdvisorAnswer(fetcher(true),input,new AbortController().signal,2000,v=>{if(v.text)seen.push(v.text);});assert.deepEqual(seen,["Café"]);assert.equal(result.payload.answer,"Café");
  await assert.rejects(readAdvisorAnswer(fetcher(false),input,new AbortController().signal,2000),/before this reply was complete/);
});

test("SSE accepts byte-split CRLF frames and Unicode",async()=>{
  const {advisorSse}=await import("../shared/advisor-stream.ts");
  const bytes=new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"Café"}\r\n\r\n');
  const stream=new ReadableStream<Uint8Array>({start(c){for(const byte of bytes)c.enqueue(new Uint8Array([byte]));c.close();}});
  const events=[];for await(const event of advisorSse(stream))events.push(event);
  assert.deepEqual(events,[{type:"response.output_text.delta",delta:"Café"}]);
});
