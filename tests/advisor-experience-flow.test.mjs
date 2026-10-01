import assert from "node:assert/strict";
import test from "node:test";
import { POST, DELETE as deleteChat, ADVISOR_CONSENT_VERSIONS } from "../app/api/v1/advisor/chat/route.ts";
import { GET as history, PATCH as rename, DELETE as clearHistory } from "../app/api/v1/advisor/conversations/route.ts";
import { GET as getPreferences, PUT as putPreferences, DELETE as deletePreferences } from "../app/api/v1/advisor/preferences/route.ts";
import { ADVISOR_ATTACHMENT_NOTICE_VERSION } from "../shared/advisor-attachments.ts";
import { createEnvironment, createReportWorkspace, dispatch, identityHeaders, origin } from "./helpers/retail-worker-fixture.mjs";

test("AI experience supports transient context, private preferences, saved names, deduplicated retries and real streaming",{timeout:600000},async()=>{
 const {worker,environment,database,dispose}=await createEnvironment();
 const originalFetch=globalThis.fetch,originalEnv=globalThis.__vanteloqEnv;
 const prompts=[];let streamMode=false,release,firstSent;
 const activate=()=>{globalThis.__vanteloqEnv=environment;};
 const req=(who,path,method="GET",body)=>new Request(origin+path,{method,headers:identityHeaders(who.owner.email,who.owner.name,method!=="GET"),body:body===undefined?undefined:JSON.stringify(body)});
 const payload=async(r,status=200)=>{assert.equal(r.status,status,await r.clone().text());return r.json();};
 try{
  const a=await createReportWorkspace(worker,environment,database,"ai-experience-a"),b=await createReportWorkspace(worker,environment,database,"ai-experience-b");
  environment.OPENAI_API_KEY="fictional";environment.INTEGRATION_ENCRYPTION_KEY=btoa("b".repeat(32));
  for(const who of [a,b]) await payload(await dispatch(worker,environment,"/api/v1/advisor/consent",{...who.owner,method:"POST",body:{...ADVISOR_CONSENT_VERSIONS,accepted:true,purpose:"analysis"}}));
  activate();
  const counts=async()=>Promise.all(["assistant_messages","assistant_conversations","workspace_documents","journal_entries"].map(async table=>(await database.prepare(`SELECT COUNT(*) n FROM ${table}`).first()).n));
  const baseline=await counts();
  globalThis.fetch=async(input,init)=>{
    if(String(input)!=="https://api.openai.com/v1/responses")return originalFetch(input,init);
    const body=JSON.parse(String(init.body));const prompt=typeof body.input==="string"?body.input:body.input[0].content[0].text;prompts.push(prompt);
    const answer="This is a fictional reply. Gross margin needs complete costs and matched sales.";
    if(!streamMode)return Response.json({status:"completed",output:[{type:"message",content:[{type:"output_text",text:answer}]}]});
    const encoder=new TextEncoder();const gate=new Promise(resolve=>release=resolve);
    return new Response(new ReadableStream({async start(c){c.enqueue(encoder.encode('data: '+JSON.stringify({type:"response.output_text.delta",delta:answer})+'\n\n'));firstSent?.();await gate;c.enqueue(encoder.encode('data: '+JSON.stringify({type:"response.completed",response:{status:"completed",output:[{type:"message",content:[{type:"output_text",text:answer}]}]}})+'\n\n'));c.close();}}),{headers:{"content-type":"text/event-stream"}});
  };
  const ask=(who,question,extra={})=>{activate();return POST(req(who,"/api/v1/advisor/chat","POST",{...ADVISOR_CONSENT_VERSIONS,question,purpose:"help",provider:"openai",dataUseAccepted:true,memoryEnabled:false,...extra}));};
  // Neither an old client notice nor an old saved receipt can authorize v9 disclosure.
  const staleNotice=await payload(await ask(a,"Explain gross margin",{noticeVersion:"vanteloq-ai-v8-reviewed-cash"}),409);
  assert.equal(staleNotice.error.code,"ADVISOR_CONSENT_NOTICE_STALE");assert.equal(prompts.length,0);
  await database.prepare("UPDATE integration_consents SET notice_version=? WHERE organization_id=? AND provider='openai' AND status='accepted'").bind("vanteloq-ai-v8-reviewed-cash",a.organizationId).run();
  const staleReceipt=await payload(await ask(a,"Explain gross margin"),409);
  assert.equal(staleReceipt.error.code,"ADVISOR_CONSENT_REQUIRED");assert.equal(prompts.length,0);assert.deepEqual(await counts(),baseline);
  await payload(await dispatch(worker,environment,"/api/v1/advisor/consent",{...a.owner,method:"POST",body:{...ADVISOR_CONSENT_VERSIONS,accepted:true,purpose:"analysis"}}));
  const hello=await payload(await ask(a,"Hello"));assert.match(hello.answer,/^Hi/);assert.doesNotMatch(hello.answer,/Evidence|missing|partial|Lightspeed/);assert.equal(prompts.length,0);
  const first=await payload(await ask(a,"Explain gross margin"));assert.ok(first.contextProof);
  const currentChat=[{question:"Explain gross margin",answer:first.answer,proof:first.contextProof}];
  await payload(await ask(a,"Explain that more simply",{currentChat}));assert.match(prompts.at(-1),/Earlier reply.*historical/);assert.match(prompts.at(-1),/Gross margin needs complete costs/);assert.deepEqual(await counts(),baseline);
  await payload(await ask(b,"Read that",{currentChat}),409);
  activate();await payload(await putPreferences(req(a,"/api/v1/advisor/preferences","PUT",{preferences:{length:"brief",priorities:["cash"],privateBalance:9999}})));
  assert.equal((await payload(await getPreferences(req(a,"/api/v1/advisor/preferences")))).preferences.length,"brief");assert.equal((await payload(await getPreferences(req(b,"/api/v1/advisor/preferences")))).preferences.length,"balanced");
  await payload(await deletePreferences(req(a,"/api/v1/advisor/preferences","DELETE")));assert.equal((await payload(await getPreferences(req(a,"/api/v1/advisor/preferences")))).saved,false);
  const turnId=crypto.randomUUID();const saved=await payload(await ask(a,"Explain cash flow",{memoryEnabled:true,turnId}));assert.ok(saved.conversationId);
  const afterSave=await counts();const retried=await payload(await ask(a,"Explain cash flow",{memoryEnabled:true,turnId}));assert.equal(retried.answer,saved.answer);assert.equal(retried.conversationId,saved.conversationId);assert.deepEqual(await counts(),afterSave);
  await payload(await ask(a,"A changed question",{memoryEnabled:true,turnId}),409);
  activate();await payload(await rename(req(a,"/api/v1/advisor/conversations","PATCH",{id:saved.conversationId,title:"Cash planning"})));
  const listed=await payload(await history(req(a,"/api/v1/advisor/conversations?titles=true")));assert.equal(listed.conversations[0].title,"Cash planning");
  await payload(await rename(req(b,"/api/v1/advisor/conversations","PATCH",{id:saved.conversationId,title:"Foreign"})),404);
  // File-derived summaries remain transient even when a client asks to save them.
  const form=new FormData();form.set("request",JSON.stringify({...ADVISOR_CONSENT_VERSIONS,question:"Read this fictional CSV",purpose:"help",dataUseAccepted:true,memoryEnabled:true,attachmentConsent:ADVISOR_ATTACHMENT_NOTICE_VERSION}));form.append("files",new File(["Item,Cost\nFictional,10"],"fictional.csv",{type:"text/csv"}));const headers=identityHeaders(a.owner.email,a.owner.name,true);delete headers["content-type"];
  activate();const file=await payload(await POST(new Request(origin+"/api/v1/advisor/chat",{method:"POST",headers,body:form})));
  assert.equal(file.memoryEnabled,false);assert.ok(file.contextProof);
  const follow=await payload(await ask(a,"What did the file say?",{memoryEnabled:true,currentChat:[{question:"Read this fictional CSV",answer:file.answer,proof:file.contextProof}]}));assert.equal(follow.memoryEnabled,false);assert.deepEqual(await counts(),afterSave);
  activate();await payload(await clearHistory(req(a,"/api/v1/advisor/conversations","DELETE",{confirmDeleteAll:true})));
  await payload(await ask(a,"Use the earlier chat",{currentChat}),409);
  streamMode=true;let seenResolve;const seen=new Promise(r=>seenResolve=r);firstSent=seenResolve;
  const response=await ask(a,"Explain a cash buffer",{stream:true,turnId:crypto.randomUUID()});assert.equal(response.status,200);assert.match(response.headers.get("content-type"),/ndjson/);
  const reader=response.body.getReader(),decoder=new TextDecoder();let text="";
  await seen;
  while(!text.includes('"type":"delta"')){const next=await reader.read();assert.equal(next.done,false);text+=decoder.decode(next.value);}
  assert.doesNotMatch(text,/"type":"done"/);release();
  while(true){const next=await reader.read();if(next.done)break;text+=decoder.decode(next.value);}assert.match(text,/"type":"done"/);
  streamMode=false;
  const deletable=await payload(await ask(a,"A saved deletion test",{memoryEnabled:true}));
  streamMode=true;firstSent=null;
  const revoked=await ask(a,"Continue the saved deletion test",{stream:true,memoryEnabled:true,conversationId:deletable.conversationId,turnId:crypto.randomUUID()});
  const revokedReader=revoked.body.getReader();let revokedText="";
  while(!revokedText.includes('"type":"delta"')){const next=await revokedReader.read();assert.equal(next.done,false);revokedText+=decoder.decode(next.value);}
  activate();await payload(await deleteChat(req(a,"/api/v1/advisor/chat","DELETE",{conversationId:deletable.conversationId})));
  release();while(true){const next=await revokedReader.read();if(next.done)break;revokedText+=decoder.decode(next.value);}
  assert.match(revokedText,/ADVISOR_CONTEXT_CHANGED/);assert.doesNotMatch(revokedText,/"type":"done"/);
  const after=await counts();assert.equal(after[2],baseline[2]);assert.equal(after[3],baseline[3]);
 }finally{release?.();globalThis.fetch=originalFetch;globalThis.__vanteloqEnv=originalEnv;await dispose();}
});
