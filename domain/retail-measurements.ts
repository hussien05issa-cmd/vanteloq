import { parseCommercePeriod } from "./commerce-intelligence";
import type { RetailMeasurement } from "./retail-intelligence";

export type MeasurementKind = RetailMeasurement["kind"];
export const measurementTemplates = {
  stock: "reference,openingUnits,receivedUnits,openingValueCents,closingValueCents\n",
  labour: "reference,paidMinutes,wagesCents,attributedSalesCents,attributedTransactions,complete\n",
  loyalty: "reference,memberSince\n",
  catalog: "reference,category,itemType\n",
} as const;
export const measurementDescriptions = {
  stock: "Reference is the exact SKU at the selected outlet. Use opening stock and receipts for this reporting period. Inventory values are total costs in cents, not selling prices. Leave unknown values blank.",
  labour: "Use one row with reference location, total paid minutes and complete=true only after reviewing the entire outlet and period. Wages and staff-attributed sales are in cents. Leave unknown optional values blank.",
  loyalty: "Reference is the provider customer reference. Add a verified enrollment date. Unmatched buyers stay unknown; no identity data is sent to the AI. This does not enroll anyone in a program.",
  catalog: "Reference is the exact product reference or a unique SKU in this source. Add a category and item type. Ambiguous SKUs are rejected. These labels do not change the provider catalogue.",
};
function cells(text: string) {
  const rows: string[][] = []; let row: string[] = [], value = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { value += c; i++; } else quoted = !quoted; }
    else if (c === "," && !quoted) { row.push(value); value = ""; }
    else if ((c === "\n" || c === "\r") && !quoted) { if (c === "\r" && text[i + 1] === "\n") i++; row.push(value); if (row.some(v => v.trim())) rows.push(row); row = []; value = ""; }
    else value += c;
  }
  if (quoted) throw new Error("Close the quoted CSV value.");
  row.push(value); if (row.some(v => v.trim())) rows.push(row);
  return rows;
}
export function parseMeasurementCsv(kind: MeasurementKind, text: string) {
  if (text.length > 100_000) throw new Error("Use a CSV smaller than 100 KB.");
  const rows = cells(text.replace(/^\uFEFF/, ""));
  const expected = measurementTemplates[kind].trim().split(",");
  if (JSON.stringify(rows[0]?.map(v => v.trim())) !== JSON.stringify(expected)) throw new Error("Use the exact column headings in the template.");
  if (rows.length < 2 || rows.length > 201) throw new Error("Include 1 to 200 data rows.");
  const seen = new Set<string>();
  return rows.slice(1).map((row, index) => {
    if (row.length !== expected.length) throw new Error(`Row ${index + 2} has the wrong number of columns.`);
    const reference = row[0].trim().normalize("NFC");
    if (!reference || reference.length > 240 || /[\u0000-\u001f\u007f]/.test(reference)) throw new Error(`Row ${index + 2} needs a valid reference.`);
    if (seen.has(reference)) throw new Error(`Row ${index + 2} repeats a reference. Use one reviewed total per reference.`);
    seen.add(reference);
    const values: RetailMeasurement["values"] = {};
    expected.slice(1).forEach((field, column) => {
      const raw = row[column + 1].trim().normalize("NFC");
      if (field === "category" || field === "itemType") {
        if (!raw || raw.length > 100 || /[\u0000-\u001f\u007f]/.test(raw)) throw new Error(`Row ${index + 2} needs a ${field} of 1 to 100 characters.`);
        values[field] = raw;
      } else if (field === "memberSince") {
        parseCommercePeriod(raw, raw); values[field] = raw;
      } else if (field === "complete") {
        if (raw !== "true" && raw !== "false") throw new Error("Set complete to true or false.");
        values[field] = raw === "true";
      } else {
        if (!raw) { values[field] = null; return; }
        const decimal = field === "openingUnits" || field === "receivedUnits";
        if (!(decimal ? /^\d+(?:\.\d{1,3})?$/ : /^\d+$/).test(raw)) throw new Error(`Row ${index + 2}: ${field} must be non-negative${decimal ? " with at most 3 decimal places" : " whole units"}.`);
        const number = Number(raw);
        if (!Number.isSafeInteger(Math.round(number * (decimal ? 1000 : 1))) || number > 1_000_000_000) throw new Error(`Row ${index + 2}: ${field} is too large.`);
        values[field] = number;
      }
    });
    if (kind === "stock" && (values.openingUnits == null || values.receivedUnits == null)) throw new Error("Opening units and received units are required. Record an explicit zero only if verified.");
    if (kind === "labour" && (reference !== "location" || values.paidMinutes == null)) throw new Error("Labour needs reference location and total paid minutes.");
    if (kind === "labour" && ((values.attributedSalesCents == null) !== (values.attributedTransactions == null))) throw new Error("Supply both staff-attributed sales and transactions, or leave both blank.");
    return { reference, values };
  });
}
