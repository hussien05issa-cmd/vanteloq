"use client";
import {useId,useState} from "react";
import type {ForecastReport,ForecastMetric} from "../domain/forecasting";

export const forecastLabel={transactions:"Transactions",units:"Recorded units",netSalesCents:"Net sales"};
export const forecastFormat=(value:number|null,metric:ForecastMetric,currency:string)=>value===null?"Not available":metric==="netSalesCents"?new Intl.NumberFormat("en-CA",{style:"currency",currency,maximumFractionDigits:0}).format(value/100):new Intl.NumberFormat("en-CA",{maximumFractionDigits:1}).format(value);
export default function ForecastChart({location,metric}:{location:ForecastReport["locations"][number];metric:ForecastMetric}){
  const id=useId(),[active,setActive]=useState<number|null>(null),series=location.series[metric];
  const rows=[...location.history.map(d=>({date:d.date,actual:["complete","closed"].includes(d.status)?d[metric]:null,forecast:null as number|null,low:null as number|null,high:null as number|null,state:d.status})),{date:location.today,actual:null,forecast:null,low:null,high:null,state:"Partial day excluded"},...series.points.map(d=>({date:d.date,actual:null,forecast:d.value,low:d.low,high:d.high,state:d.state}))];
  const values=rows.flatMap(d=>[d.actual,d.forecast,d.low,d.high]).filter((v):v is number=>v!==null),min=Math.min(0,...values),max=Math.max(1,...values),span=max-min;
  const x=(i:number)=>60+i*710/Math.max(1,rows.length-1),y=(n:number)=>230-(n-min)/span*195;
  const paths=(key:"actual"|"forecast")=>{const segments:string[]=[];let path="";rows.forEach((r,i)=>{if(r[key]===null){if(path)segments.push(path);path="";}else path+=`${path?"L":"M"}${x(i)},${y(r[key]!)}`;});if(path)segments.push(path);return segments;};
  const row=active===null?null:rows[active],format=(v:number|null)=>forecastFormat(v,metric,location.currency);
  return <section className="fc-chart" aria-labelledby={`${id}-title`}><header><div><h3 id={`${id}-title`}>{forecastLabel[metric]} ahead</h3><p>Solid: reviewed history · Dashed: forecast · Shaded: empirical range</p></div><small>{location.currency} · {location.timezone}</small></header>
    <div className="fc-plot" role="img" aria-label={`${forecastLabel[metric]} history and forecast. Exact values are in the table below.`}><svg viewBox="0 0 800 270" aria-hidden="true">
      {[0,.25,.5,.75,1].map(t=><g key={t}><line x1="60" x2="775" y1={y(min+t*span)} y2={y(min+t*span)} className="fc-grid"/><text x="52" y={y(min+t*span)+4} textAnchor="end">{new Intl.NumberFormat("en-CA",{notation:"compact",maximumFractionDigits:1}).format((min+t*span)/(metric==="netSalesCents"?100:1))}</text></g>)}
      {rows.map((r,i)=>r.low===null||r.high===null?null:<rect key={r.date} x={x(i)-3} y={y(r.high)} width="6" height={Math.max(1,y(r.low)-y(r.high))} fill="#1974ed" opacity=".13"/>)}
      {paths("actual").map((d,i)=><path key={`a${i}`} d={d} className="fc-actual"/>)}{paths("forecast").map((d,i)=><path key={`f${i}`} d={d} className="fc-future"/>)}
      <line x1={x(location.history.length)} x2={x(location.history.length)} y1="25" y2="235" stroke="#768ba8" strokeDasharray="3 4"/><text x={x(location.history.length)+5} y="17">Issue day</text>
      {[0,location.history.length,rows.length-1].map(i=><text key={i} x={x(i)} y="256" textAnchor="middle">{rows[i].date.slice(5)}</text>)}
      {rows.map((r,i)=><rect key={r.date} x={x(i)-6} y="28" width="12" height="205" fill="transparent" onPointerMove={()=>setActive(i)}/>)}</svg></div>
    <p className="fc-chart-readout" aria-live="polite">{row?`${row.date}: ${format(row.actual??row.forecast)} · ${row.state}${row.low!==null?` · Range ${format(row.low)} to ${format(row.high)}`:""}`:"Select a date below to inspect the value. Gaps indicate missing records, not zero sales."}</p>
    <details><summary>View accessible data table</summary><div className="fc-table-scroll"><table><caption>{forecastLabel[metric]} · {location.name}</caption><thead><tr><th>Date</th><th>Actual</th><th>Forecast</th><th>Range</th><th>Status</th></tr></thead><tbody>{rows.map((r,i)=><tr key={r.date}><th><button onClick={()=>setActive(i)}>{r.date}</button></th><td>{format(r.actual)}</td><td>{format(r.forecast)}</td><td>{r.low===null?"Not calibrated":`${format(r.low)} to ${format(r.high)}`}</td><td>{r.state}</td></tr>)}</tbody></table></div></details>
  </section>;
}
