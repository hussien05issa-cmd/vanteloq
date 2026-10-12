import type { Worksheet } from "exceljs";
import { excelCountValue, excelQuantityValue, excelMoneyValue, STUDIO_MAX_RECORDS, type StudioExecutiveReview } from "../domain/data-studio";
import { ApiError } from "./api";

export const STUDIO_XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const STUDIO_XLSX_MAX_BYTES = 5 * 1024 * 1024;
type Cell = string | number | null;

function table(sheet: Worksheet, headers: string[], records: Cell[][], moneyColumns: number[] = []) {
  sheet.columns = headers.map((header, index) => ({ header, width: index === 0 ? 30 : /source|reason|boundary|note|UTC|hash/i.test(header) ? 48 : 24 }));
  sheet.addRows(records);
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, records.length + 1), column: headers.length } };
  sheet.getRow(1).font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF10233F" } };
  sheet.getRow(1).height = 26;
  sheet.eachRow((row, index) => {
    if (index > 1) { row.font = { name: "Calibri", size: 11, color: { argb: "FF17243A" } }; row.alignment = { vertical: "top", wrapText: true }; }
  });
  for (const column of moneyColumns) sheet.getColumn(column).numFmt = '#,##0.00;[Red](#,##0.00);0.00';
  sheet.pageSetup = { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
}
const amount = (value: number | null | undefined) => excelMoneyValue(value ?? null);
const cents = (value: number | null | undefined) => value === undefined || value === null ? null : String(value);

/** Value-only XLSX. Untrusted names/IDs are strings, never formulas or links. */
export async function executiveReviewXlsx(review: StudioExecutiveReview): Promise<Uint8Array> {
  if (review.sales.rows.length > STUDIO_MAX_RECORDS || review.metadata.rowCount !== review.sales.rows.length || review.metadata.truncated !== false) throw new ApiError(409, "STUDIO_EXPORT_INCOMPLETE", "Refresh a complete bounded analysis before exporting. No partial workbook was created.");
  const { default: ExcelJS } = await import("exceljs/lib/exceljs.bare.js");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Vanteloq"; workbook.title = "Executive Review"; workbook.subject = "Authorized stored records and separately labelled posted ledger figures";
  workbook.created = new Date(review.metadata.generatedUtc); workbook.modified = workbook.created;
  const add = (name: string) => workbook.addWorksheet(name);
  const m = review.metadata, s = review.sales.summary;
  const overview: Cell[][] = [["Report", "Executive Review", null, null], ["Period", `${m.from} to ${m.to}`, null, null],
    ["Currency", m.currency, null, null], ["Business time zone", m.timeZone, null, null], ["Sales extraction UTC", m.extractionUtc, null, null],
    ["Generated UTC", m.generatedUtc, null, null], ["Recorded daily rows", m.rowCount, null, null],
    ["Recorded net sales", review.sales.state === "recorded" ? amount(s?.netSalesCents) : null, cents(s?.netSalesCents), review.sales.reason],
    ["Recorded transactions", excelCountValue(s?.transactionCount ?? null), null, "Daily summary counts, not counts of returned rows. Values exceeding Excel's 15-digit precision remain text."],
    ["Recorded units", excelQuantityValue(s?.unitsSold ?? null), null, "Recorded POS quantities, using exact thousandths; excessive precision is refused. Values exceeding Excel's precision remain text."],
    ...(review.margin.state === "restricted" ? [] : [["Recorded gross profit", amount(s?.grossProfitCents), cents(s?.grossProfitCents), review.margin.reason] as Cell[], ["Weighted gross margin", s?.grossMargin ?? null, null, "Total recorded gross profit divided by positive total net sales"] as Cell[]]),
    ...(review.ledger ? [["Accounting data mode", review.ledger.dataMode, null, "Separate accrual accounting evidence, not added to operational sales"] as Cell[], ...([
      ["Posted ledger revenue", review.ledger.revenueCents], ["Posted gross profit", review.ledger.grossProfitCents], ["Posted operating profit", review.ledger.operatingProfitCents], ["Posted net earnings", review.ledger.netEarningsCents],
      ["Posted assets", review.ledger.assetsCents], ["Posted liabilities", review.ledger.liabilitiesCents], ["Posted equity including earnings", review.ledger.equityCents],
    ] as [string, number][]).map(([label, value]) => [label, amount(value), cents(value), `${review.ledger!.dataMode === "demonstration" ? "Demonstration accounting data. " : ""}${review.ledger!.boundary}`] as Cell[])] : [])];
  const overviewSheet = add("Overview");
  table(overviewSheet, ["Measure", "Value", "Exact minor units (text)", "Source / note"], overview);
  overview.forEach((row, index) => {
    if (/gross margin/i.test(String(row[0]))) overviewSheet.getRow(index + 2).getCell(2).numFmt = "0.0%";
    else if (/net sales|gross profit|ledger revenue|net earnings|operating profit|assets|liabilities|equity/i.test(String(row[0]))) overviewSheet.getRow(index + 2).getCell(2).numFmt = '#,##0.00;[Red](#,##0.00);0.00';
  });
  const sourceColumns = review.sales.rows.some(row => row.sourceProvider !== undefined);
  const refunds = review.sales.rows.some(row => row.refundsCents !== undefined);
  const salesHeaders = ["Record ID (text)", "Business date (ISO text)", "Location reference", "Evidence type", `Net sales (${m.currency})`, "Net sales minor units (text)", "Transactions", "Units",
    ...(refunds ? [`Discounts (${m.currency})`, `Refunds (${m.currency})`] : []), ...(sourceColumns ? ["Provider", "Connection reference", "Import reference"] : []), "Record updated UTC"];
  table(add("Sales"), salesHeaders, review.sales.rows.map(row => [row.id, row.businessDate, row.locationRef, row.sourceKind,
    amount(row.netSalesCents), cents(row.netSalesCents), excelCountValue(row.transactionCount), excelQuantityValue(row.unitsSold),
    ...(refunds ? [amount(row.discountsCents), amount(row.refundsCents)] : []), ...(sourceColumns ? [row.sourceProvider ?? null, row.sourceConnectionId ?? null, row.sourceImportId ?? null] : []), row.updatedUtc ?? null]), [5, ...(refunds ? [9, 10] : [])]);
  const marginRows: Cell[][] = review.margin.state === "restricted" ? [["Unavailable in this access scope", null, null, null, null]]
    : review.sales.rows.map(row => [row.id, row.businessDate, amount(row.netSalesCents), amount(row.costOfGoodsCents), row.costOfGoodsCents === undefined || row.costOfGoodsCents === null ? null : amount(row.netSalesCents - row.costOfGoodsCents)]);
  table(add("Margin"), ["Record / status", "Business date", `Net sales (${m.currency})`, `Recorded cost (${m.currency})`, `Recorded gross profit (${m.currency})`], marginRows, [3, 4, 5]);
  table(add("Inventory"), ["Evidence", `Value (${m.currency})`, "Exact minor units (text)", "As of", "Boundary"], [[review.inventory.state === "recorded" ? "Posted ledger inventory" : "Unavailable in this scope", amount(review.inventory.ledgerCents), cents(review.inventory.ledgerCents), m.to, review.inventory.reason]], [2]);
  table(add("Cash"), ["Evidence", `Value (${m.currency})`, "Exact minor units (text)", "As of", "Boundary"], [[review.cash.state === "recorded" ? "Posted ledger cash" : "Unavailable in this scope", amount(review.cash.ledgerCents), cents(review.cash.ledgerCents), m.to, review.cash.reason]], [2]);
  table(add("Data Quality"), ["Check", "State / explanation"], [["Stored row extraction", "Full accepted scope; no truncation"], ["Provider history certification", "Not certified"], ["Recorded calendar dates", `${m.recordedDayCount} of ${m.calendarDayCount} dates have at least one recorded row. This does not certify every location or prove the business was closed on other dates.`], ["Latest source record update UTC", m.latestRecordUpdateUtc], ["Sales", review.sales.reason ?? "Recorded facts available"], ["Margin", review.margin.reason],
    ...(review.ledger ? [["Excluded foreign-currency posted entries", String(review.ledger.foreignCurrencyEntriesExcluded)], ["Posted balance difference (exact cents)", String(review.ledger.balanceDifferenceCents)]] as Cell[][] : []), ...review.limitations.map(note => ["Boundary", note])]);
  table(add("Sources"), ["Property", "Value"], [["Business reference", m.organizationId], ["Location references", m.locationIds.join(", ")], ["Data mode", m.dataMode], ["Source authority", m.sourceAuthority], ["Calculation version", m.calculationVersion], ["Specification SHA-256", m.specificationHash], ["Result snapshot SHA-256", m.snapshotHash],
    ["Consistency", "Each component uses a bounded read transaction; separate component timestamps are retained"], ["Sales extraction UTC", m.extractionUtc], ["Workbook generated UTC", m.generatedUtc],
    ...(review.ledger ? [["Posted ledger generated UTC", review.ledger.generatedUtc], ["Last posted UTC", review.ledger.lastPostedUtc], ["Ledger calculation version", review.ledger.calculationVersion], ["Ledger data mode", review.ledger.dataMode], ["Ledger boundary", review.ledger.boundary]] as Cell[][] : []),
    ["Money", "Exact canonical cents are retained as text. Amounts beyond the conservative Excel numeric precision boundary remain decimal text."], ["Dates and identifiers", "ISO dates, UTC timestamps and identifiers are text; no date serial inference or formula execution."], ["Restricted fields", "Omitted before export"], ["Workbook features", "Precomputed values only; no macros, external relationships, formulas, native charts or PivotTables."]]);
  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  if (bytes.byteLength > STUDIO_XLSX_MAX_BYTES) throw new ApiError(409, "STUDIO_EXPORT_TOO_LARGE", "The generated workbook exceeds the tested file limit. Narrow the scope. No partial file was returned.");
  return bytes;
}
