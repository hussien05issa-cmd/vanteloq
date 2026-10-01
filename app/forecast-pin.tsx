"use client";
import {useEffect,useState} from "react";
import {apiFetch} from "./supabase-browser";
import type {ForecastReport} from "../domain/forecasting";
import {forecastFormat} from "./forecast-chart";
import "./forecasting-workspace.css";
type Props={locationId:string|null;currency:string;onOpen:()=>void};
export default function ForecastPin(props:Props){return <ForecastPinContent key={props.locationId??"all"} {...props}/>;}
function ForecastPinContent({locationId,currency,onOpen}:Props){
 const [loaded,setReport]=useState<{report:ForecastReport;locationId:string|null}|null>(null);
 useEffect(()=>{const controller=new AbortController();void apiFetch(`/api/v1/forecasting?horizon=7${locationId?`&location=${encodeURIComponent(locationId)}`:""}`,{signal:controller.signal}).then(async r=>{if(!r.ok)return;const d=await r.json();if(!controller.signal.aborted&&d.preferences?.pinned)setReport({report:d.report,locationId});}).catch(()=>{});return()=>controller.abort();},[locationId]);
 const report=loaded?.locationId===locationId?loaded.report:null;
 if(!report)return null;
 return <section className="fc-pin"><div><strong>Next seven days</strong><p>{report.totals.transactions===null?"Review the inputs for your next forecast.":`${forecastFormat(report.totals.transactions,"transactions",currency)} transactions · ${forecastFormat(report.totals.netSalesCents,"netSalesCents",currency)} expected net sales`}</p></div><button onClick={onOpen}>Open forecasting</button></section>;
}
