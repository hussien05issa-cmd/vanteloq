import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { POST, ADVISOR_CONSENT_VERSIONS } from "../app/api/v1/advisor/chat/route.ts";
import { createEnvironment, createReportWorkspace, dispatch, identityHeaders, origin } from "./helpers/retail-worker-fixture.mjs";

test("Free AI counts delivered text on cancellation and refunds failures before output", {timeout:180000}, async()=>{
  const {worker,environment,database,dispose}=await createEnvironment();
  const originalFetch=globalThis.fetch,originalEnv=globalThis.__vanteloqEnv;
  let release,fail=false;
  try {
    const a=await createReportWorkspace(worker,environment,database,"free-stream");
    await database.prepare("UPDATE tenant_subscriptions SET status='canceled' WHERE organization_id=?").bind(a.organizationId).run();
    await database.prepare("INSERT INTO free_plan_enrollments VALUES (?,'free-origin-1',?)").bind(a.organizationId,Date.now()).run();
    environment.OPENAI_API_KEY="fictional";environment.INTEGRATION_ENCRYPTION_KEY=btoa("b".repeat(32));
    const consent=await dispatch(worker,environment,"/api/v1/advisor/consent",{...a.owner,method:"POST",body:{...ADVISOR_CONSENT_VERSIONS,accepted:true,purpose:"analysis"}});
    assert.equal(consent.status,200,await consent.text());
    globalThis.__vanteloqEnv=environment;
    globalThis.fetch=async(input,init)=>{
      if(String(input)!=="https://api.openai.com/v1/responses")return originalFetch(input,init);
      if(fail)return new Response("Unavailable",{status:503});
      const encoder=new TextEncoder(),gate=new Promise(resolve=>release=resolve);
      const answer="This fictional reply explains that complete costs are needed to calculate gross margin.";
      return new Response(new ReadableStream({async start(c){
        c.enqueue(encoder.encode('data: '+JSON.stringify({type:"response.output_text.delta",delta:answer})+'\n\n'));
        await gate;
        c.enqueue(encoder.encode('data: '+JSON.stringify({type:"response.completed",response:{status:"completed",output:[{type:"message",content:[{type:"output_text",text:answer}]}]}})+'\n\n'));c.close();
      }}),{headers:{"content-type":"text/event-stream"}});
    };
    const ask=turnId=>POST(new Request(origin+"/api/v1/advisor/chat",{method:"POST",headers:identityHeaders(a.owner.email,a.owner.name,true),body:JSON.stringify({...ADVISOR_CONSENT_VERSIONS,question:"Explain gross margin",purpose:"help",provider:"openai",dataUseAccepted:true,memoryEnabled:false,stream:true,turnId})}));
    const turn=crypto.randomUUID(),response=await ask(turn);
    assert.equal(response.status,200);const reader=response.body.getReader(),decoder=new TextDecoder();let text="";
    while(!text.includes('"type":"delta"')) {const part=await reader.read();assert.equal(part.done,false);text+=decoder.decode(part.value);}
    await reader.cancel();release();
    let state;
    for(let i=0;i<100;i++) { state=(await database.prepare("SELECT state FROM advisor_requests WHERE organization_id=? AND turn_id=?").bind(a.organizationId,turn).first())?.state;if(state==="failed")break;await delay(25); }
    assert.equal(state,"failed");
    const used=async()=>Number((await database.prepare("SELECT used FROM free_plan_usage WHERE organization_id=? AND metric='ai_replies'").bind(a.organizationId).first())?.used??0);
    assert.equal(await used(),1);
    fail=true;const failure=await ask(crypto.randomUUID());assert.match(await failure.text(),/"type":"error"/);
    assert.equal(await used(),1);
  } finally {release?.();globalThis.fetch=originalFetch;globalThis.__vanteloqEnv=originalEnv;await dispose();}
});
