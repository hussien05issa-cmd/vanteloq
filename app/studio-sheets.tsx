"use client";

import { useId, useMemo, useState } from "react";
import { studioQuantityMilli, type StudioExecutiveReview, type StudioSalesRow } from "../domain/data-studio";
import {
  createStudioSheetDraft, evaluateStudioSheet, formatStudioDecimal, STUDIO_SHEET_MAX_CELLS, STUDIO_SHEET_MAX_INPUT,
  STUDIO_SHEET_SOURCE_NAMES, validateStudioSheetDraft, type StudioFormulaResult, type StudioSheetDraft,
  type StudioSheetFormat,
} from "../domain/studio-formulas";

export type { StudioSheetDraft } from "../domain/studio-formulas";
export type StudioSheetsProps = {
  review: StudioExecutiveReview; draft?: StudioSheetDraft; onDraftChange?: (draft: StudioSheetDraft) => void; initialFilter?:string; sourceRows?:StudioSalesRow[]; initialSheet?:"source"|"assumptions";
};
type SourceColumn = "date" | "location" | "source" | "netSales" | "transactions" | "units" | "cost" | "profit";
const columns: { key: SourceColumn; label: string; optional?: boolean; margin?: boolean }[] = [
  { key: "date", label: "Business Date" }, { key: "location", label: "Location" },
  { key: "source", label: "Source", optional: true }, { key: "netSales", label: "Net Sales" },
  { key: "transactions", label: "Transactions" }, { key: "units", label: "Units Sold", optional: true },
  { key: "cost", label: "Cost of Goods", margin: true }, { key: "profit", label: "Gross Profit", margin: true },
];
const PAGE_SIZE = 50, HISTORY_LIMIT = 40;
function centsText(cents: number | bigint): string {
  const amount = BigInt(cents), negative = amount < BigInt(0), absolute = negative ? -amount : amount;
  return `${negative ? "-" : ""}${absolute / BigInt(100)}.${String(absolute % BigInt(100)).padStart(2, "0")}`;
}
function sourceValue(row: StudioSalesRow, column: SourceColumn): string | bigint | null {
  switch (column) {
    case "date": return row.businessDate; case "location": return row.locationRef;
    case "source": return row.sourceKind === "owner_summary" ? "Owner record" : "Provider record";
    case "netSales": return Number.isSafeInteger(row.netSalesCents) ? BigInt(row.netSalesCents) : null;
    case "transactions": return Number.isSafeInteger(row.transactionCount) ? BigInt(row.transactionCount) : null;
    case "units": try { return BigInt(studioQuantityMilli(row.unitsSold)); } catch { return null; }
    case "cost": return row.costOfGoodsCents !== null && row.costOfGoodsCents !== undefined && Number.isSafeInteger(row.costOfGoodsCents) ? BigInt(row.costOfGoodsCents) : null;
    case "profit": return row.costOfGoodsCents !== null && row.costOfGoodsCents !== undefined && Number.isSafeInteger(row.costOfGoodsCents) && Number.isSafeInteger(row.netSalesCents) ? BigInt(row.netSalesCents) - BigInt(row.costOfGoodsCents) : null;
  }
}
function sourceDisplay(row: StudioSalesRow, column: SourceColumn, currency: string): string {
  const value = sourceValue(row, column);
  if (value === null) return "Unavailable";
  if (typeof value === "string") return value;
  if (["netSales", "cost", "profit"].includes(column)) return formatStudioDecimal(centsText(value), "money", currency);
  if (column === "units") {
    const negative = value < BigInt(0), absolute = negative ? -value : value;
    return formatStudioDecimal(`${negative ? "-" : ""}${absolute / BigInt(1000)}.${String(absolute % BigInt(1000)).padStart(3, "0")}`.replace(/\.?0+$/, ""), "number", currency);
  }
  return formatStudioDecimal(String(value), "number", currency);
}
const resultLabel = (result: StudioFormulaResult, format: StudioSheetFormat, currency: string) => result.state === "value"
  ? formatStudioDecimal(result.value, format, currency) : result.code === "RESTRICTED" ? "Restricted" : result.code === "MISSING_SOURCE" ? "Source unavailable" : `#${result.code}`;

/** Native text editing keeps caret and browser undo behavior. Sheet history records committed cell edits. */
function CellEditor({ value, label, maxLength, describedBy, invalid, onCommit }: {
  value: string; label: string; maxLength: number; describedBy?: string; invalid?: boolean; onCommit: (value: string) => void;
}) {
  const [pending, setPending] = useState(value);
  return <input type="text" value={pending} aria-label={label} maxLength={maxLength} spellCheck={false}
    aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={event => setPending(event.target.value)}
    onBlur={() => { if (pending !== value) onCommit(pending); }}
    onKeyDown={event => {
      if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
      if (event.key === "Escape") { event.preventDefault(); setPending(value); }
    }} />;
}

export default function StudioSheets({ review, draft, onDraftChange, initialFilter="", sourceRows, initialSheet="source" }: StudioSheetsProps) {
  const id = useId();
  let incoming: StudioSheetDraft, invalidDraft = false;
  try { incoming = draft ? validateStudioSheetDraft(draft) : createStudioSheetDraft(); }
  catch { incoming = createStudioSheetDraft(); invalidDraft = true; }
  const incomingKey = JSON.stringify(incoming);
  const organizationId = review.metadata.organizationId;
  const [history, setHistory] = useState(() => ({ organizationId, externalKey: incomingKey, past: [] as StudioSheetDraft[], present: incoming, future: [] as StudioSheetDraft[] }));
  // A newly loaded definition replaces local history. Parent callbacks echo the current definition without resetting undo.
  if (organizationId !== history.organizationId || incomingKey !== history.externalKey) {
    setHistory(organizationId === history.organizationId && incomingKey === JSON.stringify(history.present) ? { ...history, externalKey: incomingKey }
      : { organizationId, externalKey: incomingKey, past: [], present: incoming, future: [] });
  }
  const current = organizationId !== history.organizationId || (incomingKey !== history.externalKey && incomingKey !== JSON.stringify(history.present)) ? incoming : history.present;
  // Recompute against this render's review. Definitions and undo history never retain source results.
  const calculation = evaluateStudioSheet(current, review);
  const [sheet, setSheet] = useState<"source" | "assumptions">(initialSheet);
  const [filter, setFilter] = useState(initialFilter);
  const [location, setLocation] = useState("");
  const [page, setPage] = useState(0);
  const [visibleOptional, setVisibleOptional] = useState<SourceColumn[]>(["units"]);
  const [sort, setSort] = useState<{ key: SourceColumn; ascending: boolean }>({ key: "date", ascending: true });
  const sourceRecords = useMemo(() => review.sales.state === "recorded" ? sourceRows ?? review.sales.rows : [], [review.sales.state, review.sales.rows, sourceRows]);
  const marginAllowed = review.margin.state !== "restricted";
  const allowedColumns = columns.filter(column => !column.margin || marginAllowed);
  const visibleColumns = allowedColumns.filter(column => !column.optional || visibleOptional.includes(column.key));
  const activeSort = allowedColumns.some(column => column.key === sort.key) ? sort : { key: "date" as const, ascending: true };
  const rows = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase("en-CA");
    return sourceRecords.filter(row => (!location || row.locationRef === location) && (!query || `${row.businessDate} ${row.locationRef} ${row.sourceKind === "owner_summary" ? "owner record" : "provider record"}`.toLocaleLowerCase("en-CA").includes(query)))
      .map((row, index) => ({ row, index })).sort((a, b) => {
        const left = sourceValue(a.row, activeSort.key), right = sourceValue(b.row, activeSort.key);
        if (left === null || right === null) return left === right ? a.index - b.index : left === null ? 1 : -1;
        const direction = left < right ? -1 : left > right ? 1 : 0;
        return (activeSort.ascending ? direction : -direction) || a.index - b.index;
      }).map(item => item.row);
  }, [sourceRecords, filter, location, activeSort.key, activeSort.ascending]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE)), currentPage = Math.min(page, pages - 1);
  const displayedRows = rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const locations = [...new Set(sourceRecords.map(row => row.locationRef))].sort();
  const errorCount = Object.values(calculation.cells).filter(result => result.state === "error").length;
  const commit = (next: StudioSheetDraft) => {
    const valid = validateStudioSheetDraft(next);
    if (JSON.stringify(valid) === JSON.stringify(current)) return;
    setHistory({ organizationId, externalKey: history.externalKey, past: [...history.past, current].slice(-HISTORY_LIMIT), present: valid, future: [] });
    onDraftChange?.(valid);
  };
  const editCell = (address: string, field: "name" | "input" | "format", value: string) => commit({ ...current, cells: current.cells.map(cell => cell.address === address ? { ...cell, [field]: value } : cell) });
  const undo = () => {
    const previous = history.past.at(-1); if (!previous) return;
    setHistory({ ...history, past: history.past.slice(0, -1), present: previous, future: [current, ...history.future].slice(0, HISTORY_LIMIT) }); onDraftChange?.(previous);
  };
  const redo = () => {
    const next = history.future[0]; if (!next) return;
    setHistory({ ...history, past: [...history.past, current].slice(-HISTORY_LIMIT), present: next, future: history.future.slice(1) }); onDraftChange?.(next);
  };
  const addCell = () => {
    if (current.cells.length >= STUDIO_SHEET_MAX_CELLS) return;
    for (let column = 65; column <= 90; column++) for (let row = 1; row <= 99; row++) {
      const address = `${String.fromCharCode(column)}${row}`;
      if (!current.cells.some(cell => cell.address === address)) {
        commit({ ...current, cells: [...current.cells, { address, name: "New assumption", input: "", format: "number" }] }); return;
      }
    }
  };
  return <section className="studio-app studio-sheets" aria-labelledby={`${id}-title`}>
    <header className="studio-app-header"><div><p className="studio-eyebrow">VANTELOQ STUDIO / SHEETS</p><h2 id={`${id}-title`}>Work Through Your Numbers</h2>
      <p>Inspect your recorded data and build a separate scenario with your own assumptions.</p></div>
      <span className="studio-badge">{review.metadata.currency} · {review.metadata.from} to {review.metadata.to}</span></header>
    {invalidDraft && <p role="alert" className="studio-notice">The saved assumption definition could not be read. The starter scenario is shown.</p>}
    {sourceRows && <p className="studio-notice">Source rows retain the chart query and selected dimensions. Assumption formulas use the full loaded period, independently of this source-table filter.</p>}
    <div className="studio-toolbar studio-sheet-switch" role="group" aria-label="Choose a sheet">
      <button type="button" aria-pressed={sheet === "assumptions"} onClick={() => setSheet("assumptions")}>Assumptions <span>{current.cells.length}</span></button>
      <button type="button" aria-pressed={sheet === "source"} onClick={() => setSheet("source")}>Source Records <span>{sourceRecords.length.toLocaleString("en-CA")}</span></button>
    </div>
    {sheet === "source" ? <div className="studio-sheet-panel">
      <div className="studio-panel-heading"><div><h3>Source Records</h3><p>Source cells are read only. Filters and sorting change this view, while formulas use the full reporting scope.</p></div><span className="studio-badge">Protected source</span></div>
      {review.sales.state !== "recorded" && <p className="studio-notice">{review.sales.reason || "Sales records are unavailable for this scope."}</p>}
      {!marginAllowed && <p className="studio-notice">Cost and gross profit columns require margin permission.</p>}
      <div className="studio-toolbar">
        <label>Filter Records<input type="search" placeholder="Date, location or source" value={filter} onChange={event => { setFilter(event.target.value); setPage(0); }} /></label>
        <label>Location<select value={location} onChange={event => { setLocation(event.target.value); setPage(0); }}><option value="">All recorded locations</option>{locations.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <details className="studio-columns"><summary>Columns</summary><div>{allowedColumns.filter(column => column.optional).map(column => <label key={column.key}><input type="checkbox" checked={visibleOptional.includes(column.key)} onChange={event => setVisibleOptional(values => event.target.checked ? [...values, column.key] : values.filter(value => value !== column.key))} />{column.label}</label>)}</div></details>
      </div>
      <div className="studio-table-wrap" tabIndex={0} role="region" aria-label="Source records table, scroll horizontally for additional columns">
        <table className="studio-source-table"><caption>{review.metadata.currency} source records, {rows.length.toLocaleString("en-CA")} matching rows. Read only.</caption>
          <thead><tr>{visibleColumns.map(column => <th key={column.key} scope="col" aria-sort={activeSort.key === column.key ? activeSort.ascending ? "ascending" : "descending" : "none"}>
            <button type="button" aria-label={`Sort by ${column.label}${activeSort.key === column.key ? activeSort.ascending ? ", currently ascending" : ", currently descending" : ""}`} onClick={() => { setSort({ key: column.key, ascending: activeSort.key === column.key ? !activeSort.ascending : true }); setPage(0); }}>{column.label}<span aria-hidden="true">{activeSort.key === column.key ? activeSort.ascending ? " ↑" : " ↓" : ""}</span></button>
          </th>)}</tr></thead>
          <tbody>{displayedRows.map((row, index) => <tr key={`${row.id}:${index}`}>{visibleColumns.map(column => <td key={column.key}>{sourceDisplay(row, column.key, review.metadata.currency)}</td>)}</tr>)}
            {!displayedRows.length && <tr><td colSpan={visibleColumns.length}>{sourceRecords.length ? "No records match these filters." : "There are no recorded source rows in this scope."}</td></tr>}</tbody>
        </table>
      </div>
      <div className="studio-toolbar studio-pagination"><p role="status">{rows.length ? `${currentPage * PAGE_SIZE + 1} to ${Math.min((currentPage + 1) * PAGE_SIZE, rows.length)} of ${rows.length.toLocaleString("en-CA")} rows` : "0 matching rows"}</p>
        <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><button type="button" disabled={currentPage >= pages - 1} onClick={() => setPage(currentPage + 1)}>Next</button></div>
    </div> : <div className="studio-sheet-panel">
      <div className="studio-panel-heading"><div><h3>Assumption Sheet</h3><p>Editable scenario inputs. The starter growth rates are examples you can change.</p></div><span className="studio-badge">Scenario only</span></div>
      <div className="studio-toolbar"><label>Sheet Name<CellEditor key={`title:${current.title}`} value={current.title} label="Assumption sheet name" maxLength={80} onCommit={title => commit({ ...current, title })} /></label>
        <button type="button" disabled={!history.past.length} onClick={undo}>Undo</button><button type="button" disabled={!history.future.length} onClick={redo}>Redo</button><button type="button" disabled={current.cells.length >= STUDIO_SHEET_MAX_CELLS} onClick={addCell}>Add Cell</button>
      </div>
      <div className="studio-source-references" aria-label="Current source references">{STUDIO_SHEET_SOURCE_NAMES.map(name => <div key={name}><code>{name}</code><strong>{resultLabel(calculation.sources[name], name === "TRANSACTIONS" ? "number" : "money", review.metadata.currency)}</strong></div>)}</div>
      <p id={`${id}-formula-help`} className="studio-help">Enter a number or a formula beginning with =. Use decimal growth rates such as 0.05 for 5%. Press Enter or leave a cell to apply an edit; Escape restores that edit.</p>
      <div className="studio-table-wrap" tabIndex={0} role="region" aria-label="Assumption cells table, scroll horizontally for additional columns">
        <table className="studio-assumptions-table"><caption>{current.title || "Untitled assumption sheet"}. Results use the current source scope.</caption>
          <thead><tr><th scope="col">Cell</th><th scope="col">Name</th><th scope="col">Value or Formula</th><th scope="col">Display</th><th scope="col">Result</th><th scope="col">Actions</th></tr></thead>
          <tbody>{current.cells.map(cell => {
            const result = calculation.cells[cell.address], resultId = `${id}-${cell.address}-result`;
            return <tr key={cell.address}><th scope="row"><code>{cell.address}</code></th>
              <td><CellEditor key={`name:${cell.name}`} value={cell.name} label={`${cell.address} assumption name`} maxLength={40} onCommit={value => editCell(cell.address, "name", value)} /></td>
              <td><CellEditor key={`input:${cell.input}`} value={cell.input} label={`${cell.address} value or formula, ${cell.name || "unnamed assumption"}`} maxLength={STUDIO_SHEET_MAX_INPUT} describedBy={`${id}-formula-help ${resultId}`} invalid={result.state === "error"} onCommit={value => editCell(cell.address, "input", value)} /></td>
              <td><select aria-label={`${cell.address} result display format`} value={cell.format} onChange={event => editCell(cell.address, "format", event.target.value)}><option value="number">Number</option><option value="money">Currency</option><option value="percent">Percent</option></select></td>
              <td id={resultId} className={`studio-cell-result ${result.state === "error" ? "has-error" : ""}`}><strong>{resultLabel(result, cell.format, review.metadata.currency)}</strong>
                {result.state === "error" ? <small>{result.message}</small> : cell.format !== "number" && <small>Exact value: {result.value}</small>}</td>
              <td><button type="button" aria-label={`Remove assumption ${cell.address}, ${cell.name || "unnamed"}`} disabled={current.cells.length === 1} onClick={() => commit({ ...current, cells: current.cells.filter(value => value.address !== cell.address) })}>Remove</button></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      <p role="status" className="studio-help">{errorCount ? `${errorCount} ${errorCount === 1 ? "cell needs" : "cells need"} review. No unavailable or restricted source value was replaced with zero.` : `${current.cells.length} cells calculated from the current source scope.`} Undo keeps the last {HISTORY_LIMIT} committed edits.</p>
      <details className="studio-formula-guide"><summary>Supported Formulas and Limits</summary><p>Use +, -, *, / and parentheses; source names NET_SALES, GROSS_PROFIT and TRANSACTIONS; and declared assumption addresses A1 to Z99.</p>
        <p><code>=SUM(A1:A3,10)</code> adds declared numeric cells. <code>=IF(A1&gt;0,A2/A1,0)</code> tests a value and calculates its chosen branch. Comparisons =, &lt;&gt;, &lt;, &gt;, &lt;= and &gt;= are supported in IF tests.</p>
        <p>Calculations preserve exact decimal values up to 12 decimal places and 40 coefficient digits. Recurring division reports a precision error. Currency and percentages round only the displayed result to two decimal places; the exact value appears below it.</p>
        <p>Up to 32 cells and 256 characters per formula. Cell names are labels; formulas reference addresses. Missing cells are errors. Source filters do not change formula totals. This sheet does not edit source records or an Excel workbook.</p>
      </details>
    </div>}
  </section>;
}
