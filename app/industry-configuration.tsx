"use client";
import { useEffect, useState } from "react";
import { CAPABILITY_LABELS, INDUSTRY_TEMPLATES, availableIndustryCapabilities, defaultIndustryConfiguration, resolveIndustryTemplate, type IndustryConfiguration, type industryChangePreview } from "../domain/industry-templates";
import { apiFetch } from "./supabase-browser";
import "./industry-configuration.css";

export function IndustryConfigurationFields({value,onChange,disabled=false}: {value:IndustryConfiguration;onChange:(next:IndustryConfiguration)=>void;disabled?:boolean}) {
  const template=resolveIndustryTemplate(value.templateId);
  return <div className="industry-fields">
    <label>What kind of business do you run?<select value={value.templateId} disabled={disabled} onChange={event=>onChange(defaultIndustryConfiguration(event.target.value))}>{INDUSTRY_TEMPLATES.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    <label>Business format<select value={value.subtype} disabled={disabled} onChange={event=>onChange({...value,subtype:event.target.value})}>{template.subtypes.map(item=><option key={item}>{item}</option>)}</select></label>
    <div className="industry-preview" aria-live="polite"><strong>{template.description}</strong><p>{template.fieldLabels.join(" · ")}</p><small>Your permissions, subscription and available records still determine what you can use.</small></div>
    <details className="industry-options"><summary>What else do you sell or prepare?</summary><p>Add a supported activity to this business. Its records stay in this workspace; adding another separately owned business requires a separate workspace.</p><fieldset disabled={disabled}><legend>Tools and recommendations</legend>{availableIndustryCapabilities(template).map(capability=>{
      const recommendationOnly=capability==="variants"||capability==="lots"||(capability==="products"&&template.id!=="dealership"&&!template.capabilities.includes(capability));
      return recommendationOnly?<p key={capability}><strong>{CAPABILITY_LABELS[capability]}</strong><small>Suggested data for this business. This profile does not enable or hide these tools; availability follows your plan, permissions and recorded data.</small></p>:<label key={capability}><input type="checkbox" checked={value.capabilities.includes(capability)} disabled={template.capabilities.includes(capability)} onChange={event=>onChange({...value,capabilities:event.target.checked?[...value.capabilities,capability]:value.capabilities.filter(c=>c!==capability)})}/>{CAPABILITY_LABELS[capability]}{template.capabilities.includes(capability)&&<small>Included in this business profile</small>}</label>;
    })}{value.templateId==="dealership"&&<><label>Stock age to review (calendar days)<input type="number" min={1} max={730} value={value.agingReviewDays} onChange={event=>onChange({...value,agingReviewDays:Number(event.target.value)})}/></label><small>This is your review threshold, not an industry benchmark.</small></>}</fieldset></details>
  </div>;
}
type Payload={configuration:IndustryConfiguration;revision:number;canEdit:boolean;updatedAt:number|null};
type Preview={preview:ReturnType<typeof industryChangePreview>;fingerprint:string};
async function read(response:Response) {const result=await response.json();if(!response.ok)throw new Error(result.error?.message??"Unable to load business settings.");return result;}
export default function IndustryConfigurationSettings() {
  const [saved,setSaved]=useState<Payload|null>(null),[draft,setDraft]=useState<IndustryConfiguration|null>(null),[preview,setPreview]=useState<Preview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const [reload,setReload]=useState(0),[loading,setLoading]=useState(true);
  useEffect(()=>{const controller=new AbortController();apiFetch("/api/v1/industry-configuration",{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])}).then(read).then((body:Payload)=>{if(!controller.signal.aborted){setSaved(body);setDraft(body.configuration);setPreview(null);}}).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[reload]);
  async function submit(action:"preview"|"save") {
    if(!saved||!draft||busy||loading)return;setBusy(true);setError("");setNotice("");
    try {const body=await read(await apiFetch("/api/v1/industry-configuration",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,configuration:draft,expectedRevision:saved.revision,fingerprint:preview?.fingerprint}),signal:AbortSignal.timeout(20000)}));
      if(action==="preview")setPreview(body);else{setSaved(body);setDraft(body.configuration);setPreview(null);setNotice("Business settings saved. Your historical records and personal layout are preserved.");window.dispatchEvent(new CustomEvent("vanteloq:industry-changed",{detail:{industry:body.industry,configuration:body.configuration}}));}
    }catch(e){setError(e instanceof Error?e.message:"Unable to save. Reload the latest settings before retrying.");}finally{setBusy(false);}
  }
  return <section className="industry-settings" aria-labelledby="industry-settings-title"><header><div><p>YOUR BUSINESS</p><h2 id="industry-settings-title">Business type & tools</h2><p>A workspace that fits what you sell and how you operate.</p></div><button type="button" disabled={busy||loading} onClick={()=>{setLoading(true);setError("");setReload(n=>n+1);}}>Reload saved settings</button></header>
    {error&&<p role="alert" className="industry-error">{error}</p>}{notice&&<p role="status" className="industry-success">{notice}</p>}
    {!draft&&!error&&<div className="industry-loading" role="status">Loading your business configuration…</div>}
    {draft&&saved&&<><IndustryConfigurationFields value={draft} disabled={busy||loading||!saved.canEdit} onChange={next=>{setDraft(next);setPreview(null);setNotice("");}}/>{saved.canEdit?<div className="industry-actions"><button type="button" className="primary" disabled={busy||loading} onClick={()=>void submit("preview")}>{busy?"Checking…":"Review changes"}</button><button type="button" disabled={busy||loading} onClick={()=>{setDraft(saved.configuration);setPreview(null);}}>Reset to saved</button></div>:<p>An administrator with organization settings permission can change this configuration.</p>}
    {preview&&<section className="industry-change-review" aria-label="Review business configuration"><h3>{preview.preview.previous===preview.preview.next?"Review your tools":`${preview.preview.previous} → ${preview.preview.next}`}</h3><p>{preview.preview.note}</p>{preview.preview.added.length>0&&<p><b>Added to the business profile:</b> {preview.preview.added.map(c=>CAPABILITY_LABELS[c]).join(", ")}</p>}{preview.preview.hidden.length>0&&<p><b>Removed from the business profile:</b> {preview.preview.hidden.map(c=>CAPABILITY_LABELS[c]).join(", ")}. Historical records remain preserved.</p>}<p><b>Preserved:</b> {preview.preview.preserved.join(", ").toLowerCase()}.</p><div className="industry-actions"><button type="button" className="primary" disabled={busy||loading} onClick={()=>void submit("save")}>{busy?"Saving…":"Confirm business settings"}</button><button type="button" disabled={busy||loading} onClick={()=>setPreview(null)}>Keep reviewing</button></div></section>}</>}
  </section>;
}
