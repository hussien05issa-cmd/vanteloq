"use client";
import { useState } from "react";
import { resolveIndustryTemplate, type IndustryId } from "../domain/industry-templates";
import "./industry-fit-preview.css";

const choices: {id:IndustryId;label:string;detail:string}[]=[
  {id:"health",label:"Retail",detail:"Review product sales and returns, matched costs, purchasing and lot expiry where records support them."},
  {id:"dealership",label:"Dealerships",detail:"Track VINs, separate stock acquisitions, preparation, reservations, delivered sales and salesperson credit. Start with manual records or the vehicle CSV template."},
  {id:"cafe",label:"Cafés",detail:"Cost a recipe from purchase quantities and usable yield. Review food costs, recorded waste and labour for a selected location and period."},
  {id:"restaurant",label:"Restaurants",detail:"Compare theoretical recipe costs with recorded food consumption. Keep sales, labour and waste visible without counting waste twice."},
];
export default function IndustryFitPreview(){
 const [selected,setSelected]=useState<IndustryId>("health");
 const template=resolveIndustryTemplate(selected),choice=choices.find(c=>c.id===selected)!;
 return <section className="industry-fit" aria-labelledby="industry-fit-title">
  <div className="industry-fit-heading"><div><p className="demo-eyebrow">BUILT AROUND YOUR BUSINESS</p><h2 id="industry-fit-title">Different work. One clear picture.</h2></div><p>Choose your business type during setup. Change it in Settings as your operation evolves. Your records stay with you.</p></div>
  <div className="industry-fit-choices" aria-label="Explore business workflows">{choices.map(c=><button type="button" key={c.id} aria-pressed={selected===c.id} onClick={()=>setSelected(c.id)}>{c.label}</button>)}</div>
  <div className="industry-fit-panel" key={selected} aria-live="polite"><div><span className="industry-fit-label">{template.label}</span><h3>{template.questions[0]}</h3><p>{choice.detail}</p><a href="/how-it-works">See how setup works <span aria-hidden="true">→</span></a></div><div className="industry-fit-fields"><strong>The details that belong in your view</strong><ul>{template.fieldLabels.map(label=><li key={label}><span aria-hidden="true">✓</span>{label}</li>)}</ul><p>Recommended metrics and relevant tools. A dashboard you can customise.</p></div></div>
  <p className="industry-fit-note">Feature access depends on your plan and permissions. Manual operational records stay separate from posted accounting figures. Provider connections are available only as listed below.</p>
 </section>;
}
