import PostalMime from "postal-mime";
import { DOCUMENT_EMAIL_DOMAIN,DOCUMENT_EMAIL_ENDPOINT,DOCUMENT_EMAIL_MAX_RAW,DOCUMENT_EMAIL_MAX_BYTES,DOCUMENT_EMAIL_MAX_FILES,documentFileType,documentFileName,documentDigest,emailSignature } from "../shared/document-email.ts";

export type IncomingEmail={from:string;to:string;raw:ReadableStream<Uint8Array>;rawSize:number;setReject(reason:string):void};
type Env={DOCUMENT_EMAIL_SECRET?:string};
async function boundedRaw(message:IncomingEmail){
  if(!Number.isSafeInteger(message.rawSize)||message.rawSize<=0||message.rawSize>DOCUMENT_EMAIL_MAX_RAW)throw new Error("unsupported");
  const reader=message.raw.getReader(),chunks:Uint8Array[]=[];let total=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>DOCUMENT_EMAIL_MAX_RAW){await reader.cancel();throw new Error("too_large");}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
function base64(bytes:Uint8Array){let binary="";for(let offset=0;offset<bytes.length;offset+=16384)binary+=String.fromCharCode(...bytes.subarray(offset,offset+16384));return btoa(binary);}

export async function receiveEmail(message:IncomingEmail,env:Env,transport:typeof fetch=fetch){
  try{
    if(!/^[A-Za-z0-9_-]{43,128}$/.test(env.DOCUMENT_EMAIL_SECRET??"")||!new RegExp(`^inbox-[a-f0-9]{48}@${DOCUMENT_EMAIL_DOMAIN.replaceAll(".","\\.")}$`).test(message.to))throw new Error("not_configured");
    const raw=await boundedRaw(message);
    const parsed=await PostalMime.parse(raw,{attachmentEncoding:"arraybuffer",maxNestingDepth:16,maxHeadersSize:32768,maxRfc822NestingDepth:0,forceRfc822Attachments:true});
    // Email HTML, text, header credentials and inline signature graphics are never forwarded or logged.
    const attachments=parsed.attachments.filter(file=>!file.related);
    if(!attachments.length||attachments.length>DOCUMENT_EMAIL_MAX_FILES)throw new Error("unsupported");
    let total=0;
    const files=attachments.map(file=>{
      if(!(file.content instanceof ArrayBuffer)||file.rfc822DepthExceeded)throw new Error("unsupported");
      const bytes=new Uint8Array(file.content);total+=bytes.length;
      if(!bytes.length||total>DOCUMENT_EMAIL_MAX_BYTES||!documentFileType(bytes,file.mimeType))throw new Error("unsupported");
      return {fileName:documentFileName(file.filename??"document"),contentType:file.mimeType,content:base64(bytes)};
    });
    const body=JSON.stringify({version:1,recipient:message.to,sender:message.from,attachments:files});
    const digest=await documentDigest(new TextEncoder().encode(body));
    const deliveryId=await documentDigest(new TextEncoder().encode(`${message.to}\n${await documentDigest(raw)}`));
    const timestamp=String(Math.floor(Date.now()/1000));
    const signature=await emailSignature(env.DOCUMENT_EMAIL_SECRET!,timestamp,deliveryId,digest);
    const response=await transport(DOCUMENT_EMAIL_ENDPOINT,{method:"POST",headers:{"Content-Type":"application/json","X-Vanteloq-Email-Time":timestamp,"X-Vanteloq-Email-Id":deliveryId,"X-Vanteloq-Email-Signature":signature},body,redirect:"error",signal:AbortSignal.timeout(45000)});
    if(response.status!==200)throw new Error("delivery_failed");
    const result=await response.json() as {received?:boolean};if(result.received!==true)throw new Error("delivery_failed");
  }catch{
    // Never silently accept, store raw mail, or forward customer records to an operator's inbox.
    message.setReject("Vanteloq could not accept this email. Check Documents and upload the attachment directly. Use up to 5 PDF or image attachments totalling 10 MB.");
  }
}
const documentEmailWorker={email(message:IncomingEmail,env:Env){return receiveEmail(message,env);}};
export default documentEmailWorker;
