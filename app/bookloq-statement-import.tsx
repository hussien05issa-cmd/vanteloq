"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "./supabase-browser";
import { bookloqRequest, bookloqAccessDenied } from "./bookloq-request";
import { createDocumentEmailRequests } from "./document-email-client";
import { formatBookloqMoney } from "../domain/bookloq-presentation";

type Account = { id: string; name: string; institutionName: string; maskedNumber: string; currency: string };
type SourceDocument = { id: string; fileName: string; documentType: string; extractionReady: boolean };
type Import = { id: string; bankAccountId: string; startDate: string; endDate: string; rowCount: number; inflowCents: number; outflowCents: number; closingBalanceCents: number };
type Catalog = { accounts: Account[]; documents: SourceDocument[]; imports: Import[]; statementCashEnabled: boolean; boundary: string };
type DraftRow = { postingDate: string; description: string; amount: string };
type Preview = { rowCount: number; inflowCents: number; outflowCents: number; openingBalanceCents: number; closingBalanceCents: number; differenceCents: number };

function cents(value: string) {
  const normalized = value.trim().replace(/[$,\s]/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(normalized)) throw new Error("Enter amounts with up to 2 decimal places. Use a minus sign for money leaving the account.");
  const negative = normalized.startsWith("-");
  const [whole, decimal = ""] = normalized.replace(/^-/, "").split(".");
  const result = (Number(whole) * 100 + Number(decimal.padEnd(2, "0"))) * (negative ? -1 : 1);
  if (!Number.isSafeInteger(result)) throw new Error("An amount is too large. Check the statement.");
  return result;
}
async function request(path: string, body?: unknown, signal?: AbortSignal) {
  return bookloqRequest(apiFetch, path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal } : { signal });
}

export default function BookloqStatementImport({ currency, onUploaded, onComplete }: { currency: string; onUploaded: () => void; onComplete: () => Promise<void> }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const catalogRequests = useRef(createDocumentEmailRequests());
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [newAccount, setNewAccount] = useState({ name: "", institutionName: "", last4: "" });
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [opening, setOpening] = useState("");
  const [closing, setClosing] = useState("");
  const [rows, setRows] = useState<DraftRow[]>([{ postingDate: "", description: "", amount: "" }]);
  const [tables, setTables] = useState<{ page: number | null; rows: string[][] }[]>([]);
  const [tableIndex, setTableIndex] = useState(0);
  const [mapping, setMapping] = useState({ date: "0", description: "1", debit: "2", credit: "3" });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewFingerprint, setPreviewFingerprint] = useState("");
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [undo, setUndo] = useState<{ id: string; reason: string; confirmation: string } | null>(null);
  const load = useCallback(async () => {
    const active = catalogRequests.current.begin();
    setCatalogLoading(true); setCatalogError("");
    try {
      const result = await request("/api/v1/bookloq/statements", undefined, active.signal);
      if (active.current()) setCatalog(result);
    } catch (caught) {
      if (active.current()) { if (bookloqAccessDenied(caught)) setCatalog(null); setCatalogError(caught instanceof Error ? caught.message : "Statement sources could not be loaded."); }
    } finally { if (active.current()) setCatalogLoading(false); }
  }, []);
  useEffect(() => { const requests = catalogRequests.current; const timer = window.setTimeout(() => { if (expanded) void load(); }, 0); return () => { window.clearTimeout(timer); requests.cancel(); }; }, [expanded, load]);
  const payload = () => ({ documentId, documentKindConfirmed: "bank_statement", ...(bankAccountId ? { bankAccountId } : { newAccount }), currency, startDate, endDate, openingBalanceCents: cents(opening), closingBalanceCents: cents(closing), rows: rows.map(row => ({ postingDate: row.postingDate, description: row.description, amountCents: cents(row.amount) })) });
  const balanceCheck = (() => {
    try {
      const amounts = rows.map(row => cents(row.amount));
      const inflow = amounts.filter(value => value > 0).reduce((sum, value) => sum + value, 0);
      const outflow = -amounts.filter(value => value < 0).reduce((sum, value) => sum + value, 0);
      const calculated = cents(opening) + inflow - outflow;
      const difference = calculated - cents(closing);
      return [inflow, outflow, calculated, difference].every(Number.isSafeInteger) ? { inflow, outflow, calculated, difference } : null;
    } catch { return null; }
  })();
  const updateRow = (index: number, key: keyof DraftRow, value: string) => setRows(current => current.map((row, i) => i === index ? { ...row, [key]: value } : row));
  const downloadOriginal = async () => {
    setBusy(true); setError("");
    try {
      const response = await apiFetch(`/api/v1/documents?id=${encodeURIComponent(documentId)}`, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) { const result = await response.json(); throw new Error(result.error?.message || "The original document is unavailable."); }
      const blob = await response.blob();
      if (!["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(blob.type)) throw new Error("The original returned an unsupported file type.");
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = (catalog?.documents.find(document => document.id === documentId)?.fileName || "bank-statement").replace(/[^A-Za-z0-9._-]/g, "-"); link.rel = "noopener"; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(e instanceof Error ? e.message : "The original document could not be downloaded."); }
    finally { setBusy(false); }
  };
  const undoImport = async () => {
    if (!undo) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      await request("/api/v1/bookloq/statements", { action: "undo", importId: undo.id, reason: undo.reason, confirmation: undo.confirmation });
      await onComplete(); await load(); setUndo(null);
      setSuccess("Import undone. The original document and manual account remain. Review the statement again before importing corrected rows.");
    } catch (e) { setError(e instanceof Error ? e.message : "The import could not be undone."); }
    finally { setBusy(false); }
  };
  const next = async () => {
    setBusy(true); setError(""); setSuccess("");
    try {
      if (step === 1) {
        if (!documentId) throw new Error("Choose the clean statement you uploaded.");
        if (!bankAccountId && (!newAccount.name.trim() || !newAccount.institutionName.trim() || !/^\d{4}$/.test(newAccount.last4))) throw new Error("Enter the account name, institution and last 4 digits, or choose an existing account.");
        const detail = await request(`/api/v1/bookloq/statements?documentId=${encodeURIComponent(documentId)}`);
        setTables(detail.extraction?.tables ?? []); setStep(2);
      } else if (step === 2) {
        const result = await request("/api/v1/bookloq/statements", { action: "preview", ...payload() });
        setPreview(result.preview); setPreviewFingerprint(result.previewFingerprint); setReviewConfirmed(false); setStep(3);
      } else {
        if (!reviewConfirmed) throw new Error("Confirm that you checked the statement and every imported row.");
        const result = await request("/api/v1/bookloq/statements", { action: "confirm", ...payload(), previewFingerprint, reviewConfirmed });
        await onComplete(); await load();
        setSuccess(result.replayed ? "This statement was already imported. No duplicate transactions were added." : "Statement imported. Review transaction categories before treating outflows as expenses. No journals were posted.");
        setStep(1); setDocumentId(""); setPreview(null); setReviewConfirmed(false);
        setBankAccountId(result.bankAccountId ?? bankAccountId); setRows([{ postingDate: "", description: "", amount: "" }]);
        setStartDate(""); setEndDate(""); setOpening(""); setClosing(""); setTables([]); setPreviewFingerprint("");
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Check your entries and try again."); }
    finally { setBusy(false); }
  };
  const useTable = () => {
    setError("");
    try {
      const table = tables[tableIndex];
      if (!table) return;
      const mapped = table.rows.slice(1).filter(row => row.some(cell => cell.trim())).map(row => {
        const debit = row[Number(mapping.debit)]?.trim() || "0", credit = row[Number(mapping.credit)]?.trim() || "0";
        return { postingDate: row[Number(mapping.date)]?.trim() || "", description: row[Number(mapping.description)]?.trim() || "", amount: ((Math.abs(cents(credit)) - Math.abs(cents(debit))) / 100).toFixed(2) };
      });
      if (!mapped.length || mapped.length > 500) throw new Error("Choose a table containing between 1 and 500 transactions.");
      setRows(mapped);
    } catch { setError("This table needs manual correction. Check the debit and credit columns and enter only transaction rows below."); }
  };
  return <section className="bookloq-card statement-import" aria-label="Bank statement imports">
    <header className="statement-import-heading"><div><p className="bookloq-muted">BANK STATEMENTS</p><h3>Bring Your Statement Into BookLoQ</h3><p>Upload a statement, check the extracted rows, then import balanced cash activity.</p></div><button type="button" className="bookloq-primary" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "Close Import" : "Import a Statement"}</button></header>
    {expanded && <>
      <div className="statement-progress" aria-label={`Step ${step} of 3`}><progress value={step} max={3}/><span>{step} of 3 · {step === 1 ? "Choose Your Source" : step === 2 ? "Check the Numbers" : "Confirm Import"}</span></div>
      {catalogLoading && <div className="statement-loading" role="status">{catalog ? "Updating statement sources…" : "Loading your statement sources…"}</div>}
      {catalogError && <div className="statement-error" role="alert"><p>{catalogError}{catalog ? " Previously loaded sources are still shown." : ""}</p><button type="button" disabled={catalogLoading} onClick={() => void load()}>Try Again</button></div>}
      {catalog && <><p className="calculation-note">{catalog.boundary || "Statements supply historical cash movements. They do not confirm today's available balance or post accounting entries."}</p>
        {!catalog.statementCashEnabled && <p className="statement-warning" role="status">A live Plaid source is active. Statement activity stays separate from combined cash charts to prevent duplicate counting.</p>}
        <form className="statement-form" onSubmit={event => { event.preventDefault(); void next(); }}>
          {step > 1 && <button type="button" disabled={busy} onClick={() => void downloadOriginal()}>Download Original for Comparison</button>}
          {step === 1 && <>
            <button type="button" className="secondary" onClick={onUploaded}>Upload or Scan a Statement</button>
            <label><span>Statement Document <span aria-hidden="true">*</span></span><select required value={documentId} onChange={e => setDocumentId(e.target.value)}><option value="">Choose a clean uploaded statement</option>{catalog.documents.map(doc => <option key={doc.id} value={doc.id}>{doc.fileName}{doc.extractionReady ? " · Text extracted" : " · Manual review"}</option>)}</select></label>
            {!catalog.documents.length && <p>Upload your PDF in Documents and complete Scan and Read. Return here when its security state is Clean.</p>}
            <label><span>Cash Account <span aria-hidden="true">*</span></span><select value={bankAccountId} onChange={e => setBankAccountId(e.target.value)}><option value="">Create a manual statement account</option>{catalog.accounts.map(account => <option key={account.id} value={account.id}>{account.name} · {account.maskedNumber} · {account.currency}</option>)}</select></label>
            {!bankAccountId && <><label><span>Account Name <span aria-hidden="true">*</span></span><input required maxLength={100} value={newAccount.name} onChange={e => setNewAccount({ ...newAccount, name: e.target.value })} placeholder="Business chequing"/></label><label><span>Bank or Institution <span aria-hidden="true">*</span></span><input required maxLength={100} value={newAccount.institutionName} onChange={e => setNewAccount({ ...newAccount, institutionName: e.target.value })}/></label><label><span>Last 4 Account Digits <span aria-hidden="true">*</span></span><input required inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={newAccount.last4} onChange={e => setNewAccount({ ...newAccount, last4: e.target.value.replace(/\D/g, "").slice(0, 4) })}/><small>Do not enter the full account number.</small></label></>}
          </>}
          {step === 2 && <>
            <label><span>Statement Start Date <span aria-hidden="true">*</span></span><input type="date" required value={startDate} onChange={e => setStartDate(e.target.value)}/></label>
            <label><span>Statement End Date <span aria-hidden="true">*</span></span><input type="date" required value={endDate} min={startDate || undefined} onChange={e => setEndDate(e.target.value)}/></label>
            <label><span>Opening Balance ({currency}) <span aria-hidden="true">*</span></span><input required inputMode="decimal" value={opening} onChange={e => setOpening(e.target.value)} placeholder="0.00"/></label>
            <label><span>Closing Balance ({currency}) <span aria-hidden="true">*</span></span><input required inputMode="decimal" value={closing} onChange={e => setClosing(e.target.value)} placeholder="0.00"/></label>
            {tables.length > 0 && <details className="statement-extraction"><summary>Use Extracted Table Rows</summary><p>OCR is a draft. The first row is treated as a header. Check dates, signs and all transactions against the original.</p><label>Table<select value={tableIndex} onChange={e => setTableIndex(Number(e.target.value))}>{tables.map((table, index) => <option key={index} value={index}>Table {index + 1} · Page {table.page ?? "unknown"} · {table.rows.length} rows</option>)}</select></label>{([['date','Date'],['description','Description'],['debit','Withdrawals'],['credit','Deposits']] as const).map(([key, name]) => <label key={key}>{name} Column<select value={mapping[key]} onChange={e => setMapping({ ...mapping, [key]: e.target.value })}>{(tables[tableIndex]?.rows[0] ?? []).map((cell, index) => <option key={index} value={index}>{index + 1}. {cell || "Untitled"}</option>)}</select></label>)}<button type="button" onClick={useTable}>Copy Rows for Review</button></details>}
            <div><h4>Transactions</h4><p>Use YYYY-MM-DD dates. Deposits are positive; withdrawals are negative. Transfers and loan principal are cash movements, not automatically income or expenses.</p></div>
            <div className="statement-rows">{rows.map((row, index) => <fieldset key={index}><legend>Transaction {index + 1}</legend><label>Posting Date *<input type="date" required value={row.postingDate} onChange={e => updateRow(index, "postingDate", e.target.value)}/></label><label>Description *<input required maxLength={300} value={row.description} onChange={e => updateRow(index, "description", e.target.value)}/></label><label>Signed Amount ({currency}) *<input required inputMode="decimal" value={row.amount} onChange={e => updateRow(index, "amount", e.target.value)} placeholder="-42.50"/></label><button type="button" disabled={rows.length <= 1} onClick={() => setRows(rows.filter((_, i) => i !== index))}>Remove Row</button></fieldset>)}</div>
            {balanceCheck && <div aria-label="Statement balance check"><dl className="statement-review">{[["Deposits", balanceCheck.inflow], ["Withdrawals", balanceCheck.outflow], ["Calculated Closing Balance", balanceCheck.calculated], ["Difference", balanceCheck.difference]].map(([title,value]) => <div key={String(title)}><dt>{title}</dt><dd>{formatBookloqMoney(Number(value), currency)}</dd></div>)}</dl><p role="status">{balanceCheck.difference === 0 ? "The rows balance. Review the account, dates and categories before importing." : `The calculated closing balance is ${formatBookloqMoney(Math.abs(balanceCheck.difference), currency)} ${balanceCheck.difference > 0 ? "higher" : "lower"} than the statement. Check for missing or duplicated transactions.`}</p></div>}
            <button type="button" disabled={rows.length >= 500} onClick={() => setRows([...rows, { postingDate: endDate, description: "", amount: "" }])}>Add Transaction</button>
          </>}
          {step === 3 && preview && <><p><strong>{catalog.documents.find(item => item.id === documentId)?.fileName}</strong><br/>{bankAccountId ? `${catalog.accounts.find(item => item.id === bankAccountId)?.name} · ${catalog.accounts.find(item => item.id === bankAccountId)?.maskedNumber}` : `${newAccount.name} · ••••${newAccount.last4}`}<br/>{startDate} to {endDate}</p><dl className="statement-review">{[["Transactions", String(preview.rowCount)], ["Opening Balance", formatBookloqMoney(preview.openingBalanceCents, currency)], ["Money In", formatBookloqMoney(preview.inflowCents, currency)], ["Money Out", formatBookloqMoney(preview.outflowCents, currency)], ["Closing Balance", formatBookloqMoney(preview.closingBalanceCents, currency)], ["Difference", formatBookloqMoney(preview.differenceCents, currency)]].map(([title,value]) => <div key={title}><dt>{title}</dt><dd>{value}</dd></div>)}</dl><p>Opening balance + deposits − withdrawals must equal the closing balance. A balanced statement still needs accurate categories and accounting review.</p><label className="statement-confirm"><input type="checkbox" required checked={reviewConfirmed} onChange={e => setReviewConfirmed(e.target.checked)}/><span>I checked the account, dates and every row against the original statement. This is the complete statement period.</span></label></>}
          {error && <p className="statement-error" role="alert">{error}</p>}
          <footer>{step > 1 && <button type="button" disabled={busy} onClick={() => { setStep(step - 1); setError(""); setPreviewFingerprint(""); }}>Back</button>}<button className="bookloq-primary" disabled={busy || !catalog.documents.length} type="submit">{busy ? "Checking…" : step === 1 ? "Continue to Review" : step === 2 ? "Validate Statement" : "Import Reviewed Statement"}</button></footer>
        </form>
        {catalog.imports.length > 0 && <details className="statement-history"><summary>Imported Statements ({catalog.imports.length})</summary>{catalog.imports.map(item => <article className="statement-history-item" key={item.id}><div><strong>{catalog.accounts.find(account => account.id === item.bankAccountId)?.name ?? "Statement Account"}</strong><p>{item.startDate} to {item.endDate} · {item.rowCount} movements · Closing {formatBookloqMoney(item.closingBalanceCents, currency)}</p></div><button type="button" disabled={busy} onClick={() => { setUndo({ id: item.id, reason: "", confirmation: "" }); setError(""); }}>Undo Import</button>
          {undo?.id === item.id && <form className="statement-form statement-undo" onSubmit={event => { event.preventDefault(); void undoImport(); }}><p>Undo removes these imported movements from cash reports and reopens the original document for review. The PDF and account remain. Posted journals, confirmed matches or reconciled transactions must be resolved through accounting review first.</p><label><span>Reason <span aria-hidden="true">*</span></span><input required minLength={5} maxLength={500} value={undo.reason} onChange={e => setUndo({ ...undo, reason: e.target.value })}/></label><label><span>Type UNDO IMPORT to Confirm <span aria-hidden="true">*</span></span><input required autoComplete="off" value={undo.confirmation} onChange={e => setUndo({ ...undo, confirmation: e.target.value })}/></label><footer><button type="button" disabled={busy} onClick={() => setUndo(null)}>Keep Import</button><button type="submit" disabled={busy || undo.confirmation !== "UNDO IMPORT"}>{busy ? "Checking…" : "Undo Reviewed Import"}</button></footer>{error && <p role="alert" className="statement-error">{error}</p>}</form>}
        </article>)}</details>}
      </>}
      {!catalog && error && <p className="statement-error" role="alert">{error}</p>}
      {success && <p className="statement-success" role="status">{success}</p>}
    </>}
  </section>;
}
