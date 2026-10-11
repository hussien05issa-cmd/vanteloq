"use client";
import { useState } from "react";
import { apiFetch } from "./supabase-browser";
import { BOOKLOQ_STARTING_ACCOUNTS, bookloqSetupInput } from "../domain/bookloq-setup";

export default function BookLoQSetup({ accountsExist, periodsExist, currency, canManage, refresh, showNotice }: {
  accountsExist: boolean; periodsExist: boolean; currency: string; canManage: boolean; refresh: () => Promise<void>; showNotice: (message: string) => void;
}) {
  const [opened, setOpened] = useState(false), [label, setLabel] = useState("");
  const [startDate, setStartDate] = useState(""), [endDate, setEndDate] = useState("");
  const [accepted, setAccepted] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState("");
  if (!canManage) return null;
  const initialize = !accountsExist;
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (pending || !accepted) return; setError("");
    try {
      const input = bookloqSetupInput({ initialize, label, startDate, endDate }); setPending(true);
      const response = await apiFetch("/api/v1/bookloq/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error?.message ?? "Accounting setup could not be saved.");
      await refresh(); setOpened(false); setAccepted(false); setLabel(""); setStartDate(""); setEndDate("");
      showNotice(initialize ? "Your chart of accounts and first period are ready. No balances or journals were added." : "Accounting period created with its review checklist.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Accounting setup could not be saved. Your entries are still here."); }
    finally { setPending(false); }
  }
  return <article className="bookloq-card bookloq-setup-card">
    <header><div><h3>{initialize ? "Set up your books" : "Accounting periods"}</h3><p>{initialize ? "Start with an empty chart of accounts and an open period. Bring in reviewed opening balances separately." : "Add the next period without changing prior entries or locked periods."}</p></div>
      <button type="button" aria-expanded={opened} disabled={pending} onClick={() => setOpened(!opened)}>{opened ? "Close setup" : initialize ? "Review setup" : periodsExist ? "Add a period" : "Create first period"}</button></header>
    {opened && <form onSubmit={save} className="bookloq-setup-form">
      <p>Base currency: <strong>{currency}</strong>. {initialize ? "New profiles use accrual accounting. Tax eligibility and opening balances need separate review." : "Period dates must not overlap an existing period."}</p>
      {initialize && <details><summary>Preview the {BOOKLOQ_STARTING_ACCOUNTS.length} starting accounts</summary><ul>{BOOKLOQ_STARTING_ACCOUNTS.map(account => <li key={account[0]}>{account[0]} · {account[1]}</li>)}</ul></details>}
      <label>Period name<input required maxLength={100} value={label} onChange={event => setLabel(event.target.value)} placeholder="October 2026" disabled={pending}/></label>
      <label>Start date<input type="date" required value={startDate} onChange={event => setStartDate(event.target.value)} disabled={pending}/></label>
      <label>End date<input type="date" required min={startDate || undefined} value={endDate} onChange={event => setEndDate(event.target.value)} disabled={pending}/></label>
      <label className="bookloq-setup-confirm"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} disabled={pending}/>I have reviewed this period{initialize ? " and starting chart" : ""}. This creates no opening balances or financial transactions.</label>
      {error && <p role="alert">{error}</p>}
      <button type="submit" className="primary" disabled={pending || !accepted}>{pending ? "Saving…" : initialize ? "Create chart and period" : "Create period"}</button>
    </form>}
  </article>;
}
