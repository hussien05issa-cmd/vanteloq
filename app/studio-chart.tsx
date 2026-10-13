"use client";
import { useId, useState } from "react";
import { excelMoneyValue } from "../domain/data-studio";
import type { StudioQueryResult } from "../domain/studio-query";

export function studioChartValue(value:number|null,currency:string,money:boolean) {
  if(value===null)return "Missing";
  if(!money)return value.toLocaleString("en-CA");
  const exact=excelMoneyValue(value);
  return typeof exact === "string" ? `${currency} ${exact}` : new Intl.NumberFormat("en-CA",{style:"currency",currency}).format(exact!);
}

export type StudioSourceSelection = {field:"business_date"|"location_ref"|"record_id";value:string}[];
export default function StudioChart({result,currency,kind="line",onInspect}:{result:StudioQueryResult;currency:string;kind?:"line"|"bar";onInspect?:(selection:StudioSourceSelection)=>void}) {
  const id=useId(),[selected,setSelected]=useState(0);
  const valueColumn=result.columnDetails.find(column=>["cents","count","quantity"].includes(column.type));
  const labelColumn=result.columnDetails.find(column=>column.type==="text" || column.type==="date");
  if(!valueColumn)return <p className="studio-note">This query returns a table. Select a numeric measure to build a chart.</p>;
  const labels:Record<string,string>={net_sales_cents:"Net sales",gross_profit_cents:"Gross profit",transaction_count:"Transactions",units_sold:"Units sold",cost_of_goods_cents:"Cost of goods",refunds_cents:"Refunds",discounts_cents:"Discounts"};
  const measure=valueColumn.aggregate==="COUNT"?"Record count":labels[valueColumn.field]??valueColumn.label;
  const points=result.rows.map((row,index)=>({label:labelColumn?String(row[labelColumn.key]??"Missing"):String(index+1),value:typeof row[valueColumn.key]==="number"?row[valueColumn.key] as number:null}));
  const values=points.flatMap(point=>point.value===null?[]:[point.value]);
  if(!values.length)return <div className="studio-chart-empty"><h3>No plotted values in this scope.</h3><p>Connect a source, choose another period or review missing inputs.</p></div>;
  const minimum=Math.min(0,...values),maximum=Math.max(0,...values),range=maximum-minimum||1;
  const y=(value:number)=>240-(value-minimum)/range*200,x=(index:number)=>52+(points.length===1?380:index/(points.length-1)*760);
  const isMoney=valueColumn.type==="cents",current=points[Math.min(selected,points.length-1)];
  const selectedRow=result.rows[Math.min(selected,result.rows.length-1)];
  const selection:StudioSourceSelection=result.columnDetails.flatMap(column=>{
    if(column.aggregate||!["business_date","location_ref","record_id"].includes(column.field)||typeof selectedRow?.[column.key]!=="string")return [];
    return [{field:column.field as StudioSourceSelection[number]["field"],value:selectedRow[column.key] as string}];
  });
  const segments:string[]=[];let segment:string[]=[];
  for(const [index,point] of points.entries()){if(point.value===null){if(segment.length)segments.push(segment.join(" "));segment=[];}else segment.push(`${x(index)},${y(point.value)}`);}if(segment.length)segments.push(segment.join(" "));
  return <section className="studio-chart" aria-label={`${measure} chart`}>
    <div className="studio-chart-heading"><strong>{measure}{isMoney?` · ${currency}`:""}</strong><span>{points.length.toLocaleString("en-CA")} result {points.length===1?"row":"rows"}{result.truncated?" · Limited result":""}</span></div>
    <p className="studio-chart-range">Recorded range: {studioChartValue(Math.min(...values),currency,isMoney)} to {studioChartValue(Math.max(...values),currency,isMoney)}</p>
    <svg viewBox="0 0 860 290" role="img" aria-labelledby={`${id}-title ${id}-description`}><title id={`${id}-title`}>{measure}</title><desc id={`${id}-description`}>Recorded query results. Missing values are gaps. Use the record selector or result table for exact values.</desc>
      {[0,.5,1].map(fraction=><g key={fraction}><line x1="52" x2="812" y1={240-fraction*200} y2={240-fraction*200} className="studio-chart-grid"/><text x="44" y={244-fraction*200} textAnchor="end">{isMoney?((minimum+range*fraction)/100).toLocaleString("en-CA",{notation:"compact",maximumFractionDigits:1}):(minimum+range*fraction).toLocaleString("en-CA",{notation:"compact",maximumFractionDigits:1})}</text></g>)}
      <line x1="52" x2="812" y1={y(0)} y2={y(0)} className="studio-chart-zero"/>
      {kind==="line"?segments.map((path,index)=><polyline key={index} points={path} fill="none" vectorEffect="non-scaling-stroke" className="studio-chart-line"/>):points.map((point,index)=>point.value!==null&&<rect key={index} x={x(index)-Math.min(20,650/points.length)/2} y={Math.min(y(0),y(point.value))} width={Math.min(20,650/points.length)} height={Math.max(1,Math.abs(y(point.value)-y(0)))} rx="2" className={point.value<0?"studio-chart-loss":"studio-chart-bar"}/>)}
      {current?.value!==null&&current&&<circle cx={x(Math.min(selected,points.length-1))} cy={y(current.value)} r="5" className="studio-chart-point"/>}
      <text x="52" y="272">{points[0]?.label}</text><text x="812" y="272" textAnchor="end">{points.at(-1)?.label}</text>
    </svg>
    <div className="studio-chart-readout"><label>Inspect result<select value={Math.min(selected,points.length-1)} onChange={event=>setSelected(Number(event.target.value))}>{points.map((point,index)=><option key={index} value={index}>{point.label}</option>)}</select></label><strong>{studioChartValue(current?.value??null,currency,isMoney)}</strong>{onInspect&&<button type="button" onClick={()=>onInspect(selection)}>Open source sheet</button>}</div>
    <p className="studio-note">Values follow the result order. Missing values remain gaps; this chart does not infer zero sales or a complete provider history.</p>
    {result.warnings.length>0&&<ul className="studio-note">{result.warnings.map(warning=><li key={warning}>{warning}</li>)}</ul>}
  </section>;
}
