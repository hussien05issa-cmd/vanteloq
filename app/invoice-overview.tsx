"use client";
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from './supabase-browser';
import type { CollectionsDashboard, CollectionsFilter, OpenCollectionRecord } from '../domain/collections-dashboard';
import { collectionsDemo } from '../domain/collections-demo';

const labels: Record<string,string> = {current:'Not Yet Overdue','1-30':'1–30 Days Overdue','31-60':'31–60 Days Overdue','61-90':'61–90 Days Overdue','91+':'Over 90 Days',undated:'No Due Date'};
type Payload = {report: CollectionsDashboard; records: OpenCollectionRecord[]; total: number};

export default function InvoiceOverview({currency,sample=false,sampleEmpty=true,sampleAsOf='2026-09-30',onOpen}: {
  currency:string; sample?:boolean; sampleEmpty?:boolean; sampleAsOf?:string; onOpen:()=>void;
}) {
  const [kind,setKind] = useState<'receivable'|'payable'>('receivable');
  const [filter,setFilter] = useState<CollectionsFilter>('all');
  const [result,setResult] = useState<{scope:string; payload:Payload|null; error:string}|null>(null);
  const scope = kind + ':' + filter;
  const example = useMemo(() => sample ? collectionsDemo(sampleAsOf,kind,filter,sampleEmpty) : null,[sample,sampleAsOf,kind,filter,sampleEmpty]);
  const payload = example ?? (result?.scope===scope ? result.payload : null);
  const loading = !sample && result?.scope!==scope;
  const status = result?.scope===scope ? result.error : '';

  useEffect(() => {
    if (sample) return;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(),15_000);
    let active = true;
    void apiFetch('/api/v1/bookloq/collections?kind='+kind+'&filter='+filter,{signal:abort.signal})
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw Error(response.status===403 ? 'Open BookLoQ to review your access to invoices and bills.' : body.error?.message ?? 'Balances could not load. Open BookLoQ to retry.');
        if (body.demonstration) throw Error('BookLoQ is in sample mode. Sample balances do not appear in your business overview.');
        if (active && !abort.signal.aborted) setResult({scope,payload:body,error:''});
      })
      .catch(error => { if(active) setResult({scope,payload:null,error:abort.signal.aborted ? 'Balances took too long to load. Open BookLoQ to retry.' : error instanceof Error ? error.message : 'Balances could not load.'}); })
      .finally(() => clearTimeout(timer));
    return () => {active=false;abort.abort();clearTimeout(timer);};
  },[kind,filter,sample,scope]);

  const totals = payload?.report[kind==='receivable'?'receivables':'payables'];
  const money = (n:number) => new Intl.NumberFormat('en-CA',{style:'currency',currency:payload?.report.currency??currency}).format(n/100);
  const empty = sample && sampleEmpty;
  return <section className="invoice-overview" aria-label="Invoices and bills" aria-busy={loading}>
    <header><div><h3>Invoices &amp; Bills</h3><p>{sample?'Fictional documents. Try an aging bucket.':'Outstanding balances by days overdue.'}</p></div><div role="group" aria-label="Balance type">
      <button type="button" aria-pressed={kind==='receivable'} onClick={()=>{setKind('receivable');setFilter('all');}}>Receivables</button>
      <button type="button" aria-pressed={kind==='payable'} onClick={()=>{setKind('payable');setFilter('all');}}>Payables</button>
    </div></header>
    <div className="invoice-overview-body"><div><span>{kind==='receivable'?'To Collect':'To Pay'}</span><strong>{loading||!totals||payload?.report.invalidCount||empty?'—':money(totals.totalCents)}</strong>
      <small>{loading?'Loading balances…':empty?'Your reviewed invoices and bills appear here.':payload?'As of '+payload.report.asOf+' · '+(totals?.count??0)+' open '+((totals?.count??0)===1?'record':'records'):status}</small>
      {!!payload?.report.invalidCount&&<small role="status">{payload.report.invalidCount} invalid balances need review. The total is withheld; aging shows eligible records only.</small>}
      {!!payload?.report.otherCurrencyCount&&<small>{payload.report.otherCurrencyCount} records in other currencies are excluded. No conversion is applied.</small>}
      <button type="button" onClick={onOpen}>Open BookLoQ →</button>
    </div><div className="invoice-aging-bars">{(totals?.aging??Object.keys(labels).map(bucket=>({bucket,cents:0,count:0}))).map(row=><button type="button" key={row.bucket} disabled={!payload||empty} aria-pressed={filter===row.bucket} onClick={()=>setFilter(filter===row.bucket?'all':row.bucket as CollectionsFilter)}>
      <span>{labels[row.bucket]}</span><i aria-hidden="true"><b style={{width:totals&&totals.totalCents?(row.cents/totals.totalCents*100)+'%':'0%'}}/></i><b>{payload&&!empty?money(row.cents):'—'}</b>
    </button>)}</div></div>
    {payload&&filter!=='all'&&<div className="invoice-records"><div><b>{labels[filter]} · {payload.total} {payload.total===1?'record':'records'}</b><button type="button" onClick={()=>setFilter('all')}>Clear Filter</button></div>
      <table><caption>{sample?'Fictional example documents.':'First '+payload.records.length+' matching records. Manage all records in BookLoQ.'}</caption><thead><tr><th scope="col">Document</th><th scope="col">Due</th><th scope="col">Outstanding</th></tr></thead><tbody>{payload.records.length?payload.records.map(r=><tr key={r.id}><td>{r.reference}</td><td>{r.dueDate??'Not set'}</td><td>{money(r.outstandingCents)}</td></tr>):<tr><td colSpan={3}>No records in this bucket.</td></tr>}</tbody></table>
    </div>}
    <details><summary>What These Balances Include</summary><p>Current recorded document balances, including tax, across all permitted workspace locations. They are separate from the trend chart’s reporting period. Payments and credits must be recorded. These totals can differ from posted ledger balances.</p></details>
  </section>;
}
