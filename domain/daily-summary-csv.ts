import { isCalendarDate } from "./calendar-date";

const requiredHeaders = ["business_date", "gross_sales", "net_sales", "cogs", "transactions", "units"];

function csvCells(line: string, row: number): string[] {
  const cells: string[] = [];
  let cell = "", quoted = false, closed = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else cell += char;
    } else if (char === ",") { cells.push(cell.trim()); cell = ""; closed = false; }
    else if (char === '"' && !cell.trim() && !closed) { quoted = true; cell = ""; }
    else if (char === '"' || (closed && char.trim())) throw new Error(`Row ${row}: invalid CSV quotation.`);
    else cell += char;
  }
  if (quoted) throw new Error(`Row ${row}: close the quoted field. Use one line per daily record.`);
  cells.push(cell.trim());
  return cells;
}

export function parseDailyCsv(text: string) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).map((line, i) => ({ line, row: i + 1 })).filter(({ line }) => line.trim());
  if (lines.length < 2) throw new Error("The CSV needs a header and at least one data row.");
  const headers = csvCells(lines[0].line, lines[0].row).map(v => v.toLowerCase().replace(/\s+/g, "_"));
  if (headers.some(h => !h) || new Set(headers).size !== headers.length) throw new Error("Every CSV column needs a unique, nonblank header.");
  for (const name of requiredHeaders) if (!headers.includes(name)) throw new Error(`Missing required column: ${name}.`);
  if (lines.length > 367) throw new Error("Import a maximum of 366 daily rows at a time.");
  const seen = new Set<string>();
  return lines.slice(1).map(({ line, row }) => {
    const cells = csvCells(line, row);
    if (cells.length !== headers.length) throw new Error(`Row ${row}: expected ${headers.length} columns, found ${cells.length}.`);
    const get = (name: string) => cells[headers.indexOf(name)] ?? "";
    for (const name of requiredHeaders) if (!get(name)) throw new Error(`Row ${row}: ${name} is required. Enter 0 only when the actual value is zero.`);
    const businessDate = get("business_date");
    if (!isCalendarDate(businessDate)) throw new Error(`Row ${row}: business_date must be a valid date in YYYY-MM-DD format.`);
    const locationRef = get("location") || "all";
    const key = JSON.stringify([businessDate, locationRef]);
    if (seen.has(key)) throw new Error(`Row ${row}: this date and location already appear in the file.`);
    seen.add(key);
    const money = (name: string, nullable = false): number | null => {
      const raw = get(name);
      if (!raw) return nullable ? null : 0;
      if (!/^\$?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(raw)) throw new Error(`Row ${row}: ${name} must be a nonnegative amount with no more than 2 decimal places.`);
      const [whole, decimals = ""] = raw.replace(/[$,]/g, "").split(".");
      const cents = Number(whole) * 100 + Number(decimals.padEnd(2, "0"));
      if (!Number.isSafeInteger(cents)) throw new Error(`Row ${row}: ${name} is too large.`);
      return cents;
    };
    const integer = (name: string) => {
      const raw = get(name), value = Number(raw);
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value)) throw new Error(`Row ${row}: ${name} must be a nonnegative whole number.`);
      return value;
    };
    return {
      businessDate, locationRef,
      grossSalesCents: money("gross_sales")!, netSalesCents: money("net_sales")!, costOfGoodsCents: money("cogs")!,
      transactionCount: integer("transactions"), unitsSold: integer("units"), refundsCents: money("refunds")!,
      discountsCents: money("discounts")!, labourCostCents: money("labour_cost")!,
      inventoryValueCents: money("inventory_value", true), cashBalanceCents: money("cash_balance", true), accountsPayableCents: money("accounts_payable", true),
    };
  });
}
