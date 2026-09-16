import assert from "node:assert/strict";
import test from "node:test";
import { documentEmailConfigured, verifiedEmailPayload } from "../server/document-email.ts";
import { DOCUMENT_EMAIL_MAX_BYTES,DOCUMENT_EMAIL_PATH,documentDigest,emailSignature } from "../shared/document-email.ts";
import emailWorker, { receiveEmail } from "../email-worker/worker.ts";

const secret="fictional-test-secret-"+"a".repeat(44), recipient=`inbox-${"a".repeat(48)}@documents.vanteloq.com`;
function payload(content="%PDF-1.4\nFictional\n%%EOF") {return {version:1,recipient,sender:"fictional@example.invalid",attachments:[{fileName:"fictional.pdf",contentType:"application/pdf",content:btoa(content)}]};}
export async function signedEmailRequest(value:unknown=payload(),id="a".repeat(64),time=Math.floor(Date.now()/1000)) {
  const body=JSON.stringify(value),timestamp=String(time),digest=await documentDigest(new TextEncoder().encode(body));
  const signature=await emailSignature(secret,timestamp,id,digest);
  return new Request(`https://vanteloq.com${DOCUMENT_EMAIL_PATH}`,{method:"POST",headers:{"Content-Type":"application/json","X-Vanteloq-Email-Time":timestamp,"X-Vanteloq-Email-Id":id,"X-Vanteloq-Email-Signature":signature},body});
}
test("inbox requires both operator activation flags and a strong shared secret",()=>{
  const env={DOCUMENT_EMAIL_ENABLED:"true",DOCUMENT_EMAIL_VERIFIED:"true",DOCUMENT_EMAIL_SECRET:secret};
  assert.equal(documentEmailConfigured(env),true);
  for(const key of Object.keys(env))assert.equal(documentEmailConfigured({...env,[key]:""}),false);
  const validation={DOCUMENT_EMAIL_SECRET:secret,DOCUMENT_EMAIL_VALIDATION_ORGANIZATION_ID:"isolated-owner-workspace"};
  assert.equal(documentEmailConfigured(validation),false);
  assert.equal(documentEmailConfigured(validation,"isolated-owner-workspace"),true);
  assert.equal(documentEmailConfigured(validation,"other-workspace"),false);
  assert.equal(documentEmailConfigured({...validation,DOCUMENT_EMAIL_SECRET:""},"isolated-owner-workspace"),false);
});
test("delivery signature binds the raw body, delivery id and timestamp",async()=>{
  const verified=await verifiedEmailPayload(await signedEmailRequest(),secret);assert.equal(verified.files.length,1);
  const request=await signedEmailRequest();const headers=new Headers(request.headers);
  await assert.rejects(()=>verifiedEmailPayload(new Request(request.url,{method:"POST",headers,body:JSON.stringify(payload("%PDF tampered"))}),secret),/authentication/);
  headers.set("X-Vanteloq-Email-Id","b".repeat(64));await assert.rejects(()=>verifiedEmailPayload(new Request(request.url,{method:"POST",headers,body:JSON.stringify(payload())}),secret),/authentication/);
  await assert.rejects(()=>signedEmailRequest(undefined,undefined,Math.floor(Date.now()/1000)-301).then(r=>verifiedEmailPayload(r,secret)),/authentication/);
});
test("signed payload still enforces exact tenant alias, MIME magic, count and decoded totals",async()=>{
  for(const value of [{...payload(),recipient:"support@vanteloq.com"},{...payload(),recipient:`inbox-${"a".repeat(48)}@documents.vanteloq.com.attacker.invalid`},{...payload(),attachments:Array(6).fill(payload().attachments[0])},payload("MZ executable"),{...payload(),html:"<script>evil</script>"}])
    await assert.rejects(()=>signedEmailRequest(value).then(request=>verifiedEmailPayload(request,secret)));
  const oversized={...payload(),attachments:[{fileName:"large.pdf",contentType:"application/pdf",content:Buffer.concat([Buffer.from("%PDF"),Buffer.alloc(DOCUMENT_EMAIL_MAX_BYTES)]).toString("base64")}]};
  await assert.rejects(()=>signedEmailRequest(oversized).then(request=>verifiedEmailPayload(request,secret)),/attachment|size|10 MB/);
});
function mime(attachment:string="%PDF-1.4\nFictional\n%%EOF",type="application/pdf"){
  return new TextEncoder().encode(`From: fictional@example.invalid\r\nTo: header-is-not-routing@example.invalid\r\nSubject: Confidential text must not be forwarded\r\nMessage-ID: <fictional@example.invalid>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=test\r\n\r\n--test\r\nContent-Type: text/html\r\n\r\n<b>PRIVATE BODY</b>\r\n--test\r\nContent-Type: ${type}\r\nContent-Disposition: attachment; filename="receipt.pdf"\r\nContent-Transfer-Encoding: base64\r\n\r\n${btoa(attachment)}\r\n--test--\r\n`);
}
function email(raw:Uint8Array){let rejection="";return {message:{from:"fictional@example.invalid",to:recipient,raw:new Blob([new Uint8Array(raw)]).stream(),rawSize:raw.length,setReject:(reason:string)=>{rejection=reason;}},rejected:()=>rejection};}
test("real MIME parser routes by envelope, excludes message body and sends only signed attachments to the fixed HTTPS endpoint",async()=>{
  const incoming=email(mime());let calls=0;
  await receiveEmail(incoming.message,{DOCUMENT_EMAIL_SECRET:secret},async(url,options)=>{
    calls++;assert.equal(url,`https://vanteloq.com${DOCUMENT_EMAIL_PATH}`);assert.equal(options?.redirect,"error");
    const body=String(options!.body);assert.equal(body.includes("PRIVATE BODY"),false);assert.equal(body.includes("Confidential text"),false);
    const verified=await verifiedEmailPayload(new Request(String(url),options),secret);assert.equal(verified.payload.recipient,recipient);assert.equal(verified.files[0].bytes[0],37);
    return Response.json({received:true});
  });
  assert.equal(calls,1);assert.equal(incoming.rejected(),"");
});
test("email handler explicitly rejects malformed or oversized input and uncertain delivery without sending files elsewhere",async()=>{
  for(const raw of [mime("MZ","application/pdf"),new TextEncoder().encode("Subject: no attachment\r\n\r\nhello")]){
    const incoming=email(raw);let calls=0;await receiveEmail(incoming.message,{DOCUMENT_EMAIL_SECRET:secret},async()=>{calls++;return Response.json({received:true});});assert.equal(calls,0);assert.ok(incoming.rejected());
  }
  const large=email(mime());large.message.rawSize=16*1024*1024;let calls=0;await receiveEmail(large.message,{DOCUMENT_EMAIL_SECRET:secret},async()=>{calls++;return Response.json({received:true});});assert.equal(calls,0);assert.ok(large.rejected());
  const uncertain=email(mime());await receiveEmail(uncertain.message,{DOCUMENT_EMAIL_SECRET:secret},async()=>Response.json({received:false}));assert.ok(uncertain.rejected());
});
test("production handler ignores the Cloudflare execution context as a transport",async()=>{
  const prior=globalThis.fetch,incoming=email(mime());let called=false;
  globalThis.fetch=async()=>{called=true;return Response.json({received:true});};
  try{await Reflect.apply(emailWorker.email,emailWorker,[incoming.message,{DOCUMENT_EMAIL_SECRET:secret},{waitUntil(){},passThroughOnException(){}}]);assert.equal(called,true);assert.equal(incoming.rejected(),"");}
  finally{globalThis.fetch=prior;}
});
