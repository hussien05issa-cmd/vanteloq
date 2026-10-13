"use client";
import { useId, useState } from "react";
import type { StudioExecutiveReview } from "../domain/data-studio";
import { STUDIO_SQL_LIMITS, runStudioQuery, studioQuerySchema, type StudioQueryColumn, type StudioQueryResult, type StudioQueryValue } from "../domain/studio-query";

const defaultSql = "SELECT business_date, location_ref, net_sales_cents, transaction_count\nFROM sales\nORDER BY business_date DESC\nLIMIT 100;";
const examples = [
  { title: "Sales by day", sql: "SELECT business_date, SUM(net_sales_cents) AS total\nFROM sales\nGROUP BY business_date\nORDER BY business_date\nLIMIT 2000;" },
  { title: "Sales by location", sql: "SELECT location_ref, SUM(net_sales_cents) AS total, SUM(transaction_count) AS transactions\nFROM sales\nGROUP BY location_ref\nORDER BY total DESC\nLIMIT 2000;" },
  { title: "Recorded daily rows", sql: defaultSql },
];
function display(value: StudioQueryValue, column: StudioQueryColumn, currency: string): string {
  if (value === null) return "NULL";
  if (typeof value === "string") return value;
  if (column.type === "cents") {
    const exact = BigInt(value), positive = exact < BigInt(0) ? -exact : exact;
    return `${currency} ${exact < BigInt(0) ? "-" : ""}${String(positive / BigInt(100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${String(positive % BigInt(100)).padStart(2, "0")}`;
  }
  return new Intl.NumberFormat("en-CA", { maximumFractionDigits: column.type === "quantity" ? 3 : 0 }).format(value);
}
export default function StudioSql({ review, onPin, initialSql, onSqlChange }: {
  review: StudioExecutiveReview; onPin?: (sql: string) => void; initialSql?: string; onSqlChange?: (sql: string) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState({ initialSql, value: initialSql ?? defaultSql });
  const [execution, setExecution] = useState<{ review: StudioExecutiveReview; sql: string; result: StudioQueryResult } | null>(null);
  const [error, setError] = useState("");
  const [pinnedSql, setPinnedSql] = useState("");
  // Reconcile an explicitly changed parent draft during render. Old results are
  // already hidden by review and draft identity, including permission changes.
  if (draft.initialSql !== initialSql) setDraft({ initialSql, value: initialSql ?? defaultSql });
  const sql = draft.initialSql === initialSql ? draft.value : initialSql ?? defaultSql;
  const result = execution?.review === review && execution.sql === sql ? execution.result : null;
  const schema = studioQuerySchema(review);
  const change = (value: string) => { setDraft({ initialSql, value }); setError(""); setPinnedSql(""); onSqlChange?.(value); };
  const run = () => {
    setError(""); setPinnedSql(""); setExecution(null);
    try { setExecution({ review, sql, result: runStudioQuery(review, sql) }); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The query could not run. Review the supported grammar and try again."); }
  };
  const pin = () => {
    if (!onPin || !result || !result.rows.length || result.truncated) return;
    try { onPin(result.plan.normalizedSql); setPinnedSql(result.plan.normalizedSql); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The query could not be pinned. Try again."); }
  };
  return <section className="studio-sql" aria-labelledby={`${id}-title`}>
    <header className="studio-app-header"><div><p className="eyebrow">SQL</p><h2 id={`${id}-title`}>Query your recorded sales</h2><p>Read-only SELECT queries over the loaded review. Each source row is a daily summary, in {review.metadata.currency}.</p></div></header>
    <div className="studio-sql-layout">
      <div className="card studio-sql-editor">
        <form onSubmit={event => { event.preventDefault(); run(); }}>
          <label htmlFor={`${id}-query`}>SQL query</label>
          <p id={`${id}-help`}>Use the <code>sales</code> table and the permitted fields below. Amount comparisons use integer cents. Press Ctrl+Enter or Command+Enter to run.</p>
          <textarea id={`${id}-query`} className="studio-sql-input" value={sql} rows={10} maxLength={STUDIO_SQL_LIMITS.sqlBytes} spellCheck={false} autoCapitalize="off" autoCorrect="off" aria-describedby={`${id}-help ${id}-limits`} aria-invalid={error ? true : undefined} onChange={event => change(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); run(); } }}/>
          <div className="studio-actions"><button className="primary" type="submit" disabled={review.sales.state !== "recorded"}>Run query</button>{onPin && <button type="button" onClick={pin} disabled={!result || !result.rows.length || result.truncated}>Pin to Dashboard</button>}</div>
        </form>
        <p id={`${id}-limits`} className="studio-sql-limits">Up to 2,000 authorized daily rows, 16 selected columns, 16 comparisons and 8 KiB of SQL. Results default to 500 rows; LIMIT accepts 0 through 2000. Results above 2 MiB are refused.</p>
        {review.sales.state !== "recorded" && <p className="studio-access-note">{review.sales.reason ?? "Recorded sales are unavailable for this review. Choose a scope with recorded sales."}</p>}
        {error && <p className="studio-error" role="alert">{error}</p>}
        <p role="status" aria-live="polite">{result ? `${result.rows.length.toLocaleString("en-CA")} result rows shown from ${result.totalResultRows.toLocaleString("en-CA")} result rows. ${result.matchedRows.toLocaleString("en-CA")} recorded daily rows matched.${result.truncated ? " LIMIT omitted some result rows. Increase LIMIT to include them before pinning." : ""}` : "Run your query to see its results."}{result && pinnedSql === result.plan.normalizedSql ? " Query pinned to Dashboard." : ""}</p>
      </div>
      <aside className="studio-sql-reference" aria-label="SQL reference">
        <details className="card studio-sql-help"><summary>Supported SQL</summary>
          <p>One SELECT from <code>sales</code>. Select named fields, <code>*</code>, SUM, COUNT, MIN or MAX. Use <code>AS</code> for result aliases.</p>
          <p>WHERE supports <code>= != &lt;&gt; &lt; &lt;= &gt; &gt;=</code>, IS NULL, IS NOT NULL and AND. Quote text and dates with single quotes. Escape an apostrophe with two apostrophes.</p>
          <p>GROUP BY supports business_date, location_ref, or both. Every selected field outside an aggregate must appear in GROUP BY. ORDER BY accepts up to three selected result names with ASC or DESC.</p>
          <p>SUM, MIN and MAX exclude missing values and return NULL when no known value remains. COUNT(field) counts known values; COUNT(*) counts daily rows. NULL is missing evidence, not zero.</p>
          <p>This dialect does not support writes, joins, subqueries, OR, comments, expressions, additional functions or multiple statements. The full query must pass parsing before it runs.</p>
        </details>
        <details className="card studio-sql-schema" open><summary>Permitted sales schema</summary>
          <p>{review.margin.state === "restricted" ? "The schema reflects your current access permissions." : "Costs and row profit remain NULL where source evidence is missing."}</p>
          <dl>{schema.map(spec => <div key={spec.field}><dt><code>{spec.field}</code><span> {spec.type}{spec.nullable ? " · nullable" : ""}</span></dt><dd>{spec.description}</dd></div>)}</dl>
        </details>
        <div className="card studio-sql-examples"><h3>Start with an example</h3>{examples.map(example => <button type="button" key={example.title} onClick={() => change(example.sql)}>{example.title}</button>)}</div>
      </aside>
    </div>
    {result && <section className="card studio-sql-result" aria-labelledby={`${id}-results`}>
      <header><h3 id={`${id}-results`}>Query results</h3><p>{review.metadata.from} to {review.metadata.to} · {review.metadata.currency} · Snapshot {result.snapshotHash.slice(0, 12)}</p></header>
      {result.warnings.map(warning => <p className="studio-access-note" key={warning}>{warning}</p>)}
      {result.rows.length ? <div className="studio-table" tabIndex={0} aria-label="Query results, scroll horizontally if needed"><table><caption>Read-only results. Money is displayed in {result.currency}; calculations use exact integer cents. Hover or focus a money cell to read its original cents.</caption><thead><tr>{result.columnDetails.map(column => <th key={column.key} scope="col"><code>{column.key}</code><span> ({column.type === "cents" ? result.currency : column.type})</span></th>)}</tr></thead><tbody>{result.rows.map((row, index) => <tr key={index}>{result.columnDetails.map(column => <td key={column.key} title={column.type === "cents" && row[column.key] !== null ? `${row[column.key]} cents` : undefined} tabIndex={column.type === "cents" ? 0 : undefined}>{display(row[column.key], column, result.currency)}</td>)}</tr>)}</tbody></table></div> : <p>No result rows were returned. Check the filters and LIMIT. This does not imply the business had no sales outside this scope.</p>}
      <details><summary>Executed query</summary><pre><code>{result.plan.normalizedSql}</code></pre><p>{result.estimatedOperations.toLocaleString("en-CA")} estimated work units within the supported query budget.</p></details>
    </section>}
  </section>;
}
