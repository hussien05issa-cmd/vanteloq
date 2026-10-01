import { isCalendarDate } from "./calendar-date";
import { csvCells } from "./daily-summary-csv";
import { csvCell } from "./csv";

export const VEHICLE_STATUSES = ["available", "reconditioning", "reserved", "sold", "archived"] as const;
export type VehicleStatus = typeof VEHICLE_STATUSES[number];
export type VehicleInput = {
  identifierKind: "vin" | "legacy"; identifier: string; year: number; make: string; model: string;
  stockNumber: string; status: VehicleStatus; acquiredDate: string; currency: string;
  acquisitionCents: number | null; reconditioningCents: number | null;
};
export type VehicleRecord = VehicleInput & {
  id: string; locationId: string; locationName: string; version: number;
  source: "manual" | "csv"; createdAt: number; updatedAt: number;
};
export const VEHICLE_IMPORT_LIMIT = 100;
export const VEHICLE_CSV_HEADERS = ["identifier_kind", "identifier", "year", "make", "model", "stock_number", "status", "acquired_date", "currency", "acquisition_amount", "reconditioning_amount"] as const;
export const VEHICLE_CSV_TEMPLATE = `${VEHICLE_CSV_HEADERS.join(",")}\n`;
const MAX_COST_CENTS = 1_000_000_000;

function text(value: unknown, label: string, maximum: number) {
  if (typeof value !== "string") throw new Error(`Enter ${label}.`);
  const result = value.trim().normalize("NFC");
  if (!result || result.length > maximum || /[\u0000-\u001f\u007f]/.test(result)) throw new Error(`Enter ${label} using 1 to ${maximum} characters without control characters.`);
  return result;
}
function cents(value: unknown, label: string) {
  if (value === null || value === undefined || value === "") return null;
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > MAX_COST_CENTS) throw new Error(`${label} must be a nonnegative amount no greater than 10,000,000.00.`);
  return Number(value);
}

/** Structural validation only. No decoding, title, history or ownership verification. */
export function validateVehicle(value: unknown, now = new Date()): VehicleInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Enter a vehicle record.");
  const input = value as Record<string, unknown>;
  const year = input.year;
  if (!Number.isInteger(year) || Number(year) < 1886 || Number(year) > now.getUTCFullYear() + 2) throw new Error(`Enter a model year from 1886 to ${now.getUTCFullYear() + 2}.`);
  const identifierKind = input.identifierKind;
  if (identifierKind !== "vin" && identifierKind !== "legacy") throw new Error("Choose VIN or pre-1981 legacy identifier.");
  const identifier = text(input.identifier, "the vehicle identifier", 40).toUpperCase();
  if (identifierKind === "vin" && !/^[A-HJ-NPR-Z0-9]{17}$/.test(identifier)) throw new Error("A VIN needs exactly 17 letters or digits, without I, O, Q, spaces or punctuation.");
  if (identifierKind === "legacy" && (Number(year) >= 1981 || !/^[A-Z0-9][A-Z0-9 .-]{0,39}$/.test(identifier))) throw new Error("Legacy identifiers are only for model years before 1981. Use letters, digits, spaces, periods or hyphens.");
  const stockNumber = text(input.stockNumber, "the stock number", 40).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9 ._/-]{0,39}$/.test(stockNumber)) throw new Error("Use a stock number beginning with a letter or digit, without spreadsheet formulas.");
  if (!VEHICLE_STATUSES.includes(input.status as VehicleStatus)) throw new Error("Choose a valid vehicle status.");
  if (!isCalendarDate(input.acquiredDate)) throw new Error("Enter an acquisition date in YYYY-MM-DD format.");
  // Permit the current day in every time zone without turning a planned receipt into an acquisition.
  if (input.acquiredDate > new Date(now.getTime() + 14 * 3_600_000).toISOString().slice(0, 10)) throw new Error("The acquisition date cannot be in the future.");
  const currency = text(input.currency, "the three-letter currency", 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Use the location's three-letter currency.");
  return { identifierKind, identifier, year: Number(year), make: text(input.make, "the make", 80), model: text(input.model, "the model", 120), stockNumber,
    status: input.status as VehicleStatus, acquiredDate: input.acquiredDate, currency,
    acquisitionCents: cents(input.acquisitionCents, "Acquisition cost"), reconditioningCents: cents(input.reconditioningCents, "Reconditioning cost") };
}

export function vehicleAmountToCents(value: string): number | null {
  const amount = value.trim();
  if (!amount) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(amount)) throw new Error("Use a nonnegative amount with up to two decimal places and no currency symbols or separators.");
  const [whole, fraction = ""] = amount.split(".");
  return cents(Number(whole) * 100 + Number(fraction.padEnd(2, "0")), "Vehicle cost");
}
export function vehicleAmount(cents: number | null): string {
  return cents === null ? "" : `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}
export function parseVehicleCsv(csv: string, now = new Date()): VehicleInput[] {
  if (new TextEncoder().encode(csv).byteLength > 100_000) throw new Error("Use a vehicle CSV smaller than 100 KB.");
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).map((line, i) => ({ line, row: i + 1 })).filter(item => item.line.trim());
  if (lines.length < 2 || lines.length > VEHICLE_IMPORT_LIMIT + 1) throw new Error(`Include 1 to ${VEHICLE_IMPORT_LIMIT} vehicle rows.`);
  const headers = csvCells(lines[0].line, lines[0].row).map(header => header.toLowerCase());
  if (JSON.stringify(headers) !== JSON.stringify(VEHICLE_CSV_HEADERS)) throw new Error("Use the vehicle template's exact column headings and order.");
  const identifiers = new Set<string>(), stocks = new Set<string>();
  return lines.slice(1).map(({ line, row }) => {
    try {
      const values = csvCells(line, row);
      if (values.length !== headers.length) throw new Error("Use the same number of columns as the template.");
      const [identifierKind, identifier, year, make, model, stockNumber, status, acquiredDate, currency, acquisition, reconditioning] = values;
      if (!/^\d{4}$/.test(year)) throw new Error("Enter a four-digit model year.");
      const vehicle = validateVehicle({ identifierKind, identifier, year: Number(year), make, model, stockNumber, status, acquiredDate, currency,
        acquisitionCents: vehicleAmountToCents(acquisition), reconditioningCents: vehicleAmountToCents(reconditioning) }, now);
      if (identifiers.has(vehicle.identifier) || stocks.has(vehicle.stockNumber)) throw new Error("A vehicle identifier or stock number is repeated in this file.");
      identifiers.add(vehicle.identifier); stocks.add(vehicle.stockNumber);
      return vehicle;
    } catch (error) { throw new Error(`Row ${row}: ${error instanceof Error ? error.message : "Review this vehicle."}`); }
  });
}

export function vehicleExportCsv(records: VehicleRecord[], canViewCosts: boolean): string {
  const headers = [...VEHICLE_CSV_HEADERS.slice(0, 9), ...(canViewCosts ? VEHICLE_CSV_HEADERS.slice(9) : []), "record_id", "location_id", "location_name", "source", "version", "created_at", "updated_at"];
  return [headers.join(","), ...records.map(row => [row.identifierKind, row.identifier, row.year, row.make, row.model, row.stockNumber, row.status, row.acquiredDate, row.currency,
    ...(canViewCosts ? [vehicleAmount(row.acquisitionCents), vehicleAmount(row.reconditioningCents)] : []), row.id, row.locationId, row.locationName, row.source, row.version, new Date(row.createdAt).toISOString(), new Date(row.updatedAt).toISOString()].map(csvCell).join(","))].join("\r\n") + "\r\n";
}
