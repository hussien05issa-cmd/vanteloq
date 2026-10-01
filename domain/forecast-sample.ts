import {buildForecast,defaultForecastSettings,shiftForecastDate,type ForecastDay} from "./forecasting";
/** Explicitly fictional, isolated from customer records and never persisted. */
export function sampleForecast(horizon:7|28,issuedAt=new Date().toISOString()){
 const today=issuedAt.slice(0,10),settings={...defaultForecastSettings(),hours:Array.from({length:7},()=>({open:true,from:"09:00",to:"18:00"})),reviewedAt:issuedAt,reviewedFrom:shiftForecastDate(today,-364),reviewedThrough:shiftForecastDate(today,-1)};
 const days:ForecastDay[]=Array.from({length:364},(_,i)=>{const date=shiftForecastDate(today,i-364),weekday=new Date(date+"T12:00:00Z").getUTCDay(),transactions=Math.round(42+[0,-11,-8,-4,0,12,18][weekday]+Math.sin(i*1.7)*4);return {date,status:"complete",transactions,units:transactions*2,netSalesCents:transactions*3250};});
 return buildForecast([{id:"fictional",name:"Sample retail store",timezone:"UTC",currency:"CAD",settings,days,sourceIds:[],sourceCutoff:issuedAt,blocked:[]}],horizon,issuedAt);
}
