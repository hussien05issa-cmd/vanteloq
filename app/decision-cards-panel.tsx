"use client";

import { useId, useRef, useState } from "react";
import type { DecisionCard } from "../domain/decision-cards";
import "./decision-cards-panel.css";

export function decisionCardValue(card: DecisionCard): string {
  if (card.status === "unavailable" || !card.value || !Number.isFinite(card.value.amount)) return "Needs more evidence";
  const { amount, unit, currency } = card.value;
  if (unit === "minor_currency" && currency) {
    const format = new Intl.NumberFormat("en-CA", { style: "currency", currency, currencyDisplay: "code" });
    return format.format(amount / 10 ** (format.resolvedOptions().maximumFractionDigits ?? 2));
  }
  if (unit === "basis_points") return `${new Intl.NumberFormat("en-CA", { maximumFractionDigits: 2, signDisplay: "exceptZero" }).format(amount / 100)} pp`;
  return `${new Intl.NumberFormat("en-CA", { maximumFractionDigits: 3 }).format(amount)} units`;
}

const statuses = { recorded: "Recorded calculation", estimate: "Planning estimate", unavailable: "Missing inputs" };
type Props = { cards: DecisionCard[]; title?: string; onEvidence?: (card: DecisionCard) => void | Promise<void>; onAction?: (card: DecisionCard) => void | Promise<void> };

/** Read-only arithmetic and reviewed next steps remain separate from accounting mutations. */
export default function DecisionCardsPanel({ cards, title = "Decisions from your records", onEvidence, onAction }: Props) {
  const id = useId();
  const pending = useRef(false);
  const [busy, setBusy] = useState<string | null>(null), [error, setError] = useState<{ id: string; message: string } | null>(null);
  async function invoke(card: DecisionCard, action: "evidence" | "action") {
    const callback = action === "evidence" ? onEvidence : onAction;
    if (!callback || pending.current) return;
    pending.current = true;
    setError(null); setBusy(card.id);
    try { await callback(card); }
    catch { setError({ id: card.id, message: "This view could not open. Your records were not changed. Please try again." }); }
    finally { pending.current = false; setBusy(null); }
  }
  if (!cards.length) return null;
  return <section className="source-decision-cards" aria-labelledby={`${id}-heading`}>
    <header><h3 id={`${id}-heading`}>{title}</h3><p>Inspect the calculation, then choose the next step.</p></header>
    <div className="source-decision-grid">{cards.map(card => <article key={card.id} className={`source-decision-card is-${card.status}`}>
      <div className="source-decision-status"><span>{statuses[card.status]}</span><small>{card.evidence.asOf ? `Source as of ${card.evidence.asOf}` : "Source date not supplied"}</small></div>
      <h4>{card.title}</h4><strong className="source-decision-value">{decisionCardValue(card)}</strong><p>{card.summary}</p>
      <details key={`${card.id}:${card.evidence.asOf ?? "missing"}`}><summary>Calculation and source coverage</summary>
        <p>{card.evidence.formula}</p>
        {card.evidence.period && <p>Evidence period: {card.evidence.period.from} to {card.evidence.period.to}.</p>}
        {card.evidence.sources.map((source, index) => <div className="source-decision-origin" key={`${source.system}:${index}`}><b>{source.system} · {source.currency}</b><p>{source.recordCount} source records. {source.recordIds.length ? `Record references: ${source.recordIds.slice(0, 12).join(", ")}${source.recordIds.length > 12 || source.referencesTruncated ? ". This is a reference preview. Open the source record list for the complete selection." : "."}` : "No individual record references supplied."}</p></div>)}
        {card.missingFields.length > 0 && <div><b>Needed before this calculation can be used</b><ul>{card.missingFields.map(field => <li key={field}>{field.replaceAll("_", " ")}</li>)}</ul></div>}
        {card.evidence.limitations.length > 0 && <ul>{card.evidence.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul>}
      </details>
      {error?.id === card.id && <p className="source-decision-error" role="alert">{error.message}</p>}
      <div className="source-decision-actions">
        {onEvidence && <button type="button" disabled={busy !== null} onClick={() => void invoke(card, "evidence")}>View source records</button>}
        {onAction && <button className="source-decision-primary" type="button" disabled={busy !== null} onClick={() => void invoke(card, "action")}>{busy === card.id ? "Opening…" : card.action.label}</button>}
      </div>
    </article>)}</div>
  </section>;
}
