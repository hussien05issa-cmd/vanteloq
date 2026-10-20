"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import type { BookLoQData } from "./bookloq-workspace";
import type { InvoiceAccountingEvent } from "../server/invoice-accounting";
import { decimalUnits } from "../domain/invoice-amounts";
import { formatBookloqMoney as money } from "../domain/bookloq-presentation";
import { apiFetch } from "./supabase-browser";
import { bookloqRequest, BookloqRequestError } from "./bookloq-request";
import { useModalFocus } from "./use-modal-focus";
import { WorkspaceAppearanceBoundary } from "./workspace-appearance";
import "./bookloq-accounting-workflows.css";

type Invoice = BookLoQData["invoices"][number];
type History = { invoice: Pick<Invoice,"id"|"status"|"totalCents"|"paidCents"|"currency"|"demoRecord"|"journalEntryId">; events: InvoiceAccountingEvent[]; latestDate: string; today: string };
type Action = "issue" | "payment" | "reverse_payment" | "void";
const titles: Record<Action,string> = { issue:"Post earned invoice",payment:"Record received payment",reverse_payment:"Correct recorded payment",void:"Void posted invoice" };

export default function BookloqInvoiceAccounting({ data, invoice, close, saved }: { data: BookLoQData; invoice: Invoice; close: () => void; saved: () => Promise<void> }) {
  const ref = useRef<HTMLDivElement>(null), submitting = useRef(false);
  const pending = useRef<{ key: string; body: Record<string,unknown> } | null>(null);
  const [history,setHistory] = useState<History|null>(null), [error,setError] = useState(""), [busy,setBusy] = useState(false), [uncertain,setUncertain] = useState(false);
  const [action,setAction] = useState<Action>(invoice.journalEntryId ? "payment" : "issue");
  const [date,setDate] = useState(""), [amount,setAmount] = useState(((invoice.totalCents-invoice.paidCents)/100).toFixed(2));
  const accounts = data.accountCatalog ?? data.statements.accounts;
  const revenueAccounts = accounts.filter(a=>a.accountType==="revenue" && a.normalBalance==="credit");
  const taxAccounts = accounts.filter(a=>a.accountType==="liability" && a.accountSubtype==="tax_payable" && a.normalBalance==="credit");
  const cashAccounts = accounts.filter(a=>a.accountType==="asset" && a.normalBalance==="debit" && ["cash","bank"].includes(a.accountSubtype));
  const [revenue,setRevenue] = useState(revenueAccounts.find(a=>a.systemKey==="sales_revenue")?.id ?? revenueAccounts[0]?.id ?? "");
  const [tax,setTax] = useState(taxAccounts.find(a=>a.systemKey==="gst_collected")?.id ?? taxAccounts[0]?.id ?? "");
  const [cash,setCash] = useState(cashAccounts[0]?.id ?? ""), [source,setSource] = useState(""), [reference,setReference] = useState("");
  const [paymentId,setPaymentId] = useState(""), [reason,setReason] = useState(""), [reviewed,setReviewed] = useState(false);
  const canPost = data.permissions.includes("post_journals") && data.settings?.status==="active" && data.settings.dataMode==="live" && data.settings.accountingBasis==="accrual" && !invoice.demoRecord;
  const canPayment = canPost && data.permissions.includes("view_banking") && data.transactionAccess?.available!==false;
  const load = async (signal?: AbortSignal) => {
    const result = await bookloqRequest(apiFetch,`/api/v1/bookloq/invoices/accounting?invoiceId=${encodeURIComponent(invoice.id)}`,{ signal }) as History;
    return result;
  };
  useEffect(()=> {
    const controller=new AbortController();
    void bookloqRequest(apiFetch,`/api/v1/bookloq/invoices/accounting?invoiceId=${encodeURIComponent(invoice.id)}`,{signal:controller.signal})
      .then(value=>{if(controller.signal.aborted)return;const result=value as History;setHistory(result);setDate(current=>current||result.today);})
      .catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error ? e.message : "The invoice history could not be loaded.");});
    return ()=>controller.abort();
  },[invoice.id,data.organization.id]);
  useModalFocus(ref,true,()=>{if(!busy&&!uncertain)close();});
  let cents=0; try { cents=decimalUnits(amount,2); } catch { /* Validation appears on submit. */ }
  const current=history?.invoice ?? invoice;
  const activePayments=history?.events.filter(e=>e.eventType==="payment"&&!e.reversedByEventId) ?? [];
  const selectedPayment=activePayments.find(e=>e.id===paymentId);
  const closed=["void","written_off"].includes(current.status);
  const sourceRows=data.transactions.filter(t=>t.accountId===cash && !t.demoRecord && t.sourceState==="posted" && !t.journalEntryId && t.amountCents>0 && t.currency===invoice.currency && t.reconciliationStatus!=="reconciled");
  const period=data.periods.find(p=>p.startDate<=date&&p.endDate>=date);
  const changeAction=(next:Action)=>{setAction(next);setReviewed(false);setReason("");setSource("");setError("");};
  const submit=async(event:FormEvent)=>{
    event.preventDefault(); if(submitting.current||!history)return;
    setError("");
    let body: Record<string,unknown>;
    try {
      body=pending.current?.body ?? { type:action,invoiceId:invoice.id,date,reviewed };
      if(!pending.current) {
        if(action==="issue") Object.assign(body,{ revenueAccountId:revenue,taxAccountId:invoice.taxCents ? tax : null });
        if(action==="payment") Object.assign(body,{ cashAccountId:cash,amountCents:decimalUnits(amount,2),transactionId:source||null,reference });
        if(action==="reverse_payment") Object.assign(body,{paymentId,reason});
        if(action==="void") Object.assign(body,{reason});
        pending.current={key:crypto.randomUUID(),body};
      }
    } catch(e) {setError(e instanceof Error ? e.message : "Enter an exact payment amount.");return;}
    submitting.current=true;setBusy(true);
    try {
      await bookloqRequest(apiFetch,"/api/v1/bookloq/invoices/accounting",{method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":pending.current!.key},body:JSON.stringify(body)});
      pending.current=null;setUncertain(false);setReviewed(false);setReference("");setSource("");setReason("");
      const updated=await load();setHistory(updated);setDate(current=>current||updated.today);setAmount(((updated.invoice.totalCents-updated.invoice.paidCents)/100).toFixed(2));
      setAction(updated.invoice.journalEntryId ? "payment" : "issue");await saved();
    } catch(e) {
      const definite=e instanceof BookloqRequestError && e.status!==null && e.status>=400 && e.status<500;
      if(definite){pending.current=null;setUncertain(false);void load().then(updated=>setHistory(updated)).catch(()=>{});}else setUncertain(!!pending.current);
      setError(e instanceof Error ? e.message : "The posting could not be confirmed.");
    } finally {submitting.current=false;setBusy(false);}
  };
  const entries = action==="issue" ? [ ["Accounts receivable",invoice.totalCents,0], [accounts.find(a=>a.id===revenue)?.name ?? "Revenue",0,invoice.subtotalCents], ...(invoice.taxCents ? [[accounts.find(a=>a.id===tax)?.name ?? "Sales tax payable",0,invoice.taxCents]] : []) ]
    : action==="payment" ? [[accounts.find(a=>a.id===cash)?.name ?? "Cash / bank",cents,0],["Accounts receivable",0,cents]]
    : action==="void" ? [["Accounts receivable",0,invoice.totalCents],["Original revenue",invoice.subtotalCents,0],...(invoice.taxCents?[["Original tax liability",invoice.taxCents,0]]:[])]
    : [["Original cash / bank",0,selectedPayment?.amountCents ?? 0],["Accounts receivable",selectedPayment?.amountCents ?? 0,0]];
  return createPortal(<WorkspaceAppearanceBoundary><div className="bookloq-drawer"><div className="bookloq-overlay"><div ref={ref} className="invoice-composer accounting-dialog" role="dialog" aria-modal="true" aria-labelledby="invoice-accounting-title" tabIndex={-1}>
    <header><div><small>INVOICE ACCOUNTING</small><h3 id="invoice-accounting-title">{invoice.invoiceNumber}</h3><p>{invoice.customerName} · {invoice.currency}</p></div><button type="button" disabled={busy||uncertain} onClick={close} aria-label="Close invoice accounting">×</button></header>
    <div className="accounting-summary"><span>Total<b>{money(current.totalCents,invoice.currency)}</b></span><span>Received<b>{money(current.paidCents,invoice.currency)}</b></span><span>Outstanding<b>{money(closed?0:current.totalCents-current.paidCents,invoice.currency)}</b></span><span>Books<b>{current.journalEntryId ? closed?"Voided":"Posted":"Unposted draft"}</b></span></div>
    {!history && !error && <p role="status">Loading retained accounting history…</p>}
    {history && <><section className="accounting-history"><h4>Accounting history</h4>{!history.events.length && <p>This invoice has no linked ledger entry. Sending its PDF leaves the accounting review open.</p>}{history.events.map(e=><div key={e.id}><span><b>{titles[e.eventType]}</b><small>{e.eventDate} · {e.reference||e.reason||"Reviewed posting"}{e.sourceTransactionId ? " · bank receipt linked" : ""}</small></span><span>{money(e.amountCents,e.currency)}<small>{e.reversedByEventId ? "Corrected; original retained" : e.eventType==="issue"?"Receivable and revenue":e.eventType==="payment"?"Cash received; receivable reduced":"Reversal journal retained"}</small></span></div>)}</section>
    {!canPost ? <p className="calculation-note">Posting requires live accrual books, an open period and journal posting access. Your accounting history remains available.</p> : closed ? <p role="status">This invoice is closed. Its original and correcting entries remain in the history.</p> : <form onSubmit={submit}>
      <fieldset disabled={busy||uncertain} className="accounting-fields"><label>Accounting action<select value={action} onChange={e=>changeAction(e.target.value as Action)}>{!current.journalEntryId && <option value="issue">Post earned invoice</option>}{current.journalEntryId && <><option value="payment" disabled={!canPayment}>Record received payment</option>{activePayments.length>0 && <option value="reverse_payment" disabled={!canPayment}>Correct recorded payment</option>}{current.paidCents===0 && <option value="void">Void posted invoice</option>}</>}</select></label>
      <label>Accounting date<input type="date" required min={history.latestDate} max={history.today} value={date} onChange={e=>{setDate(e.target.value);setReviewed(false);setSource("");}}/><small>{period ? `${period.label} · ${period.status}` : "Choose a date in an open period."}</small></label>
      {action==="issue" && <><label>Earned revenue account<select required value={revenue} onChange={e=>{setRevenue(e.target.value);setReviewed(false);}}><option value="">Select account</option>{revenueAccounts.map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></label>{invoice.taxCents>0 && <label>Entered sales tax liability<select required value={tax} onChange={e=>{setTax(e.target.value);setReviewed(false);}}><option value="">Select account</option>{taxAccounts.map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></label>}<p className="calculation-note">Post after the goods or services have been supplied under your revenue policy. Deposits, deferred revenue and inventory cost require their own reviewed entries.</p></>}
      {action==="payment" && <><label>Receiving cash / bank account<select required value={cash} onChange={e=>{setCash(e.target.value);setSource("");setReviewed(false);}}><option value="">Select account</option>{cashAccounts.map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></label><label>Receipt evidence<select value={source} onChange={e=>{const row=sourceRows.find(t=>t.id===e.target.value);setSource(e.target.value);if(row){setAmount((row.amountCents/100).toFixed(2));setDate(row.postingDate);setReference(row.externalSourceId);}setReviewed(false);}}><option value="">Manually confirmed receipt</option>{sourceRows.map(t=><option key={t.id} value={t.id}>{t.postingDate} · {money(t.amountCents,t.currency)} · {t.description}</option>)}</select></label><label>Amount received<input required inputMode="decimal" value={amount} readOnly={!!source} onChange={e=>{setAmount(e.target.value);setReviewed(false);}}/><small>Up to {money(current.totalCents-current.paidCents,invoice.currency)}</small></label><label>Unique receipt reference<input required maxLength={180} value={reference} onChange={e=>setReference(e.target.value)} placeholder="Bank reference or receipt number"/></label><p className="calculation-note">This records money already received. A linked bank row is posted once and remains open for statement reconciliation.</p></>}
      {action==="reverse_payment" && <label>Recorded payment<select required value={paymentId} onChange={e=>{setPaymentId(e.target.value);setReviewed(false);}}><option value="">Select payment</option>{activePayments.map(e=><option key={e.id} value={e.id}>{e.eventDate} · {money(e.amountCents,e.currency)} · {e.reference}</option>)}</select></label>}
      {["reverse_payment","void"].includes(action) && <><label>Reason for correction<textarea required maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label><p className="calculation-note">A correcting journal reverses the original entry and keeps both records. Record actual refunds or credit notes separately.</p></>}
      <div className="accounting-preview"><h4>Journal preview</h4><table><thead><tr><th>Account</th><th>Debit</th><th>Credit</th></tr></thead><tbody>{entries.filter(e=>Number(e[1])||Number(e[2])).map((e,i)=><tr key={i}><td>{e[0]}</td><td>{money(Number(e[1]),invoice.currency)}</td><td>{money(Number(e[2]),invoice.currency)}</td></tr>)}</tbody></table></div>
      <label className="accounting-confirm"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)} required/><span>{action==="issue"?"I confirm the goods or services are supplied, revenue is earned, and these accounts, tax and date are correct.":"I reviewed the evidence, amount, accounts and date for this entry."}</span></label></fieldset>
      {uncertain && <p role="status">The result is uncertain. Retry the same request safely to retrieve its saved result. The details are frozen until that request is resolved.</p>}
      <footer><button type="submit" className="bookloq-primary" disabled={busy||(!uncertain&&(!reviewed||!period||!["open","review"].includes(period.status)||action==="payment"&&(!canPayment||cents<=0||cents>current.totalCents-current.paidCents)||action==="reverse_payment"&&!selectedPayment))}>{busy?"Confirming…":uncertain?"Resolve same posting":titles[action]}</button></footer>
    </form>}</>}
    {error && <p className="bookloq-form-error" role="alert">{error}</p>}
    {!busy&&!uncertain && <button type="button" className="table-action" onClick={close}>Done</button>}
  </div></div></div></WorkspaceAppearanceBoundary>,document.body);
}
