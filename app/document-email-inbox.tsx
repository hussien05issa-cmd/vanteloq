"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "./supabase-browser";
import { DOCUMENT_EMAIL_NOTICE, DOCUMENT_EMAIL_NOTICE_VERSION } from "../shared/document-email";
import "./document-email-inbox.css";
import { createDocumentEmailRequests } from "./document-email-client";

type Inbox={configured:boolean;validationOnly:boolean;enabled:boolean;address:string|null;pendingCleanup:number;pendingReview:number;recent:{documentId:string;fileName:string;sender:string;receivedAt:number}[]};
export default function DocumentEmailInbox({refreshDocuments}:{refreshDocuments:()=>Promise<void>}){
  const [data,setData]=useState<Inbox|null>(null),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState(""),[managing,setManaging]=useState(false);
  const requests=useRef(createDocumentEmailRequests());
  const clearAccess=useCallback(()=>{setData(null);setConsent(false);setManaging(false);setMessage("");setError("");},[]);
  const load=useCallback(()=>{
    const request=requests.current.begin();return apiFetch("/api/v1/documents/email",{signal:AbortSignal.any([request.signal,AbortSignal.timeout(15000)])}).then(async(response)=>{if(!request.current())return;setError("");if(response.status===401||response.status===403){clearAccess();return;}
      const body=await response.json();if(!request.current())return;if(!response.ok)throw new Error(body.error?.message||"Email settings could not load.");setData(body);
    }).catch(e=>{if(request.current())setError(e instanceof Error?e.message:"Email settings could not load.");});
  },[clearAccess]);
  useEffect(()=>{const activeRequests=requests.current;void load();return()=>activeRequests.cancel();},[load]);
  async function change(action:string){
    if(busy)return;const request=requests.current.begin();setBusy(true);setError("");setMessage("");
    try{const response=await apiFetch("/api/v1/documents/email",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,consent,noticeVersion:DOCUMENT_EMAIL_NOTICE_VERSION}),signal:AbortSignal.any([request.signal,AbortSignal.timeout(15000)])});
      if(!request.current())return;if(response.status===401||response.status===403){clearAccess();return;}
      const body=await response.json();if(!request.current())return;if(!response.ok)throw new Error(body.error?.message||"Email settings could not be saved.");setData(body);setConsent(false);setManaging(false);setMessage(action==="cleanup"?"Cleanup status refreshed.":action==="disable"?"Forwarding disabled. Existing documents are unchanged.":"Forwarding address is ready. Keep it private.");
    }catch(e){if(request.current())setError(e instanceof Error?e.message:"Email settings could not be saved.");}finally{if(request.current())setBusy(false);}
  }
  if(!data)return error?<p role="alert">{error} <button type="button" onClick={()=>void load()}>Try Again</button></p>:null;
  return <details className="document-email-inbox card"><summary><span>Email Documents</span><small>{data.enabled?"Enabled":data.configured?"Optional":"Coming Soon"}</small></summary>
    {!data.configured?<p>Forwarding is being configured. You can upload documents above.</p>:<div className="document-email-content">
      {data.validationOnly&&<p role="status">Forwarding is available to this workspace for a controlled test. Confirm each file appears in Documents.</p>}
      <p>Forward up to 5 PDF, JPEG, PNG or WEBP attachments, totalling 10 MB, to this workspace. They arrive in Documents for review. Email text and links are not imported.</p>
      {data.address&&<div className="document-email-address"><label htmlFor="document-email-address">Private Forwarding Address</label><input id="document-email-address" readOnly value={data.address}/><button type="button" onClick={async()=>{try{await navigator.clipboard.writeText(data.address!);setMessage("Address copied.");}catch{setError("Select the address and copy it manually.");}}}>Copy Address</button></div>}
      {data.enabled&&<div className="document-email-actions"><button type="button" disabled={busy} onClick={async()=>{await load();await refreshDocuments();}}>Refresh Received Files</button><button type="button" disabled={busy} aria-expanded={managing} aria-controls="document-forwarding-settings" onClick={()=>{setManaging(!managing);setConsent(false);}}>{managing?"Close Settings":"Forwarding Settings"}</button></div>}
      {(!data.enabled||managing)&&<section id="document-forwarding-settings" className="document-email-settings" aria-label="Forwarding settings">
        <p className="document-email-notice">{DOCUMENT_EMAIL_NOTICE} <a href="/subprocessors" target="_blank" rel="noreferrer">Provider Details</a></p>
        {data.enabled&&<p>Replacing your address stops delivery to the old address. Disabling forwarding keeps your existing documents.</p>}
        <label className="document-email-consent"><input type="checkbox" checked={consent} onChange={event=>setConsent(event.target.checked)} disabled={busy}/><span>I authorize storing forwarded attachments in this workspace.</span></label>
        <div className="document-email-actions"><button type="button" disabled={!consent||busy} onClick={()=>void change(data.enabled?"rotate":"enable")}>{busy?"Saving…":data.enabled?"Replace Address":"Enable Forwarding"}</button>{data.enabled&&<button type="button" disabled={busy} onClick={()=>void change("disable")}>Disable Forwarding</button>}</div>
      </section>}
      {data.enabled&&<p>Files wait for your review. Check the sender before selecting Scan and Read. <a href="/subprocessors" target="_blank" rel="noreferrer">Privacy and Storage Details</a></p>}
      {data.recent.length>0&&<div className="document-email-recent"><h3>Recently Received</h3><ul>{data.recent.map((file,index)=><li key={`${file.documentId}:${index}`}><b>{file.fileName}</b><span>{file.sender} · Sender unverified</span><time dateTime={new Date(file.receivedAt*1000).toISOString()}>{new Date(file.receivedAt*1000).toLocaleDateString()}</time></li>)}</ul></div>}
    </div>}{data.pendingCleanup>0&&<p role="status">{data.pendingCleanup} incomplete upload{data.pendingCleanup===1?"":"s"} awaiting private storage cleanup. <button type="button" disabled={busy} onClick={()=>void change("cleanup")}>Retry Cleanup</button></p>}{data.pendingReview>0&&<p role="status">{data.pendingReview} interrupted upload{data.pendingReview===1?"":"s"} need review before cleanup. <a href="/contact">Contact Support</a>. These files have not been added to your reports.</p>}{error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  </details>;
}
