import { isCalendarDate } from "./calendar-date";
import { csvCells } from "./daily-summary-csv";
import { validateVehicle, vehicleAmountToCents, type VehicleInput } from "./vehicles";

export const DEALERSHIP_OWNERSHIP = ["owned", "consignment", "unknown"] as const;
export const DEALERSHIP_PHYSICAL_STATUSES = ["on_lot", "offsite", "in_transit", "unknown"] as const;
export const DEALERSHIP_PREP_STATUSES = ["not_started", "in_progress", "ready", "blocked", "unknown"] as const;
export const DEALERSHIP_AVAILABILITY = ["available", "held", "reserved", "delivered", "archived", "legacy_sold"] as const;
export const DEALERSHIP_TASK_STATUSES = ["open", "in_progress", "blocked", "done"] as const;
export const DEALERSHIP_LEAD_STAGES = ["new", "contacted", "appointment", "negotiation", "lost"] as const;
export const DEALERSHIP_APPOINTMENT_STATUSES = ["scheduled", "attended", "no_show", "cancelled"] as const;
export const DEALERSHIP_COST_CATEGORIES = ["acquisition", "auction", "transport", "preparation", "other"] as const;
export const DEALERSHIP_COST_STATUSES = ["recorded", "estimated", "approved", "posted"] as const;
export const DEALERSHIP_CSV_HEADERS = ["identifier_kind", "identifier", "year", "make", "model", "stock_number", "acquired_date", "ownership", "physical_status", "prep_status", "asking_amount"] as const;
export const DEALERSHIP_CSV_TEMPLATE = `${DEALERSHIP_CSV_HEADERS.join(",")}\n`;
export const DEALERSHIP_BOUNDARY = "User-recorded dealership operations. Delivery, preparation and sales credit do not post accounting entries, collect payments, send messages or certify legal compliance. Gross is an operational calculation from explicitly reviewed cost evidence; tax, lender balances and accounting recognition remain in their authoritative systems.";

export type DealershipPermissions = { stockEdit: boolean; import: boolean; export: boolean; costs: boolean; profit: boolean; costEdit: boolean; costApprove: boolean; tasks: boolean; tasksEdit: boolean; sales: boolean; salesEdit: boolean; customers: boolean; customersEdit: boolean };
export type DealershipCredit = { personId: string; shareBps: number; name?: string; allocatedSalesCents?: number; allocatedGrossCents?: number | null };
export type DealershipStock = {
  id: string; vehicleId: string; version: number; locationId: string; locationName: string;
  identifierKind: "vin" | "legacy"; identifier: string; year: number; make: string; model: string; stockNumber: string; currency: string; acquiredDate: string;
  ownership: typeof DEALERSHIP_OWNERSHIP[number]; physicalStatus: typeof DEALERSHIP_PHYSICAL_STATUSES[number]; prepStatus: typeof DEALERSHIP_PREP_STATUSES[number];
  availability: typeof DEALERSHIP_AVAILABILITY[number]; askingCents: number | null; postedCostCents: number | null; costComplete: boolean; source: string; legacyIncomplete: boolean; reservationId: string | null; reservationExpiresAt: string | null;
};
export type DealershipCost = { id: string; episodeId: string; category: string; status: string; amountCents: number; currency: string; description: string; sourceReference: string };
export type DealershipTask = { id: string; episodeId: string | null; leadId: string | null; title: string; status: typeof DEALERSHIP_TASK_STATUSES[number]; assigneeId: string | null; dueDate: string | null; blockedReason: string; version: number };
export type DealershipLead = { id: string; locationId: string; customerName: string; contact: string; stage: typeof DEALERSHIP_LEAD_STAGES[number]; assigneeId: string | null; nextActionDate: string | null; version: number };
export type DealershipAppointment = { id: string; leadId: string; scheduledAt: string; status: typeof DEALERSHIP_APPOINTMENT_STATUSES[number]; version: number };
export type DealershipSale = { id: string; episodeId: string; stockNumber: string; deliveredDate: string; channel: "retail" | "wholesale"; amountCents: number; currency: string; costCents: number | null; grossCents: number | null; status: "delivered" | "reversed"; reversalDate: string | null; credits: DealershipCredit[]; unallocatedBps: number };
export type DealershipSummaryCurrency = { currency: string; deliveredUnits: number; vehicleSalesCents: number; grossCents: number | null; grossEligibleUnits: number; missingCostUnits: number; reversedUnits: number; reversedSalesCents: number };
export type DealershipAttentionTask = DealershipTask & { locationId: string; locationName: string; linkedLabel: string; localDate: string; assigneeName: string | null };
export type DealershipDashboard = {
  locations: { id: string; name: string; currency: string; timezone: string }[]; people: { id: string; name: string }[]; permissions: DealershipPermissions;
  stock: DealershipStock[]; costs: DealershipCost[]; tasks: DealershipTask[]; leads: DealershipLead[]; appointments: DealershipAppointment[]; sales: DealershipSale[];
  summary: { from: string; to: string; currencies: DealershipSummaryCurrency[]; activeStock: number; availableStock: number; legacyIncomplete: number };
  attention?: { tasks: DealershipAttentionTask[]; totalTasks: number; truncated: boolean };
  nextCursor: string | null; legacyAvailable: number; boundary: string; limits: { relatedRows: number; truncated: boolean }; generatedAt: string;
};
export type DealershipAcquire = { vehicle: VehicleInput; ownership: "owned" | "consignment"; physicalStatus: typeof DEALERSHIP_PHYSICAL_STATUSES[number]; prepStatus: typeof DEALERSHIP_PREP_STATUSES[number]; availability: "available" | "held"; askingCents: number | null };

export function dealershipText(value: unknown, label: string, maximum = 160, optional = false): string {
  if (optional && (value === undefined || value === null || value === "")) return "";
  if (typeof value !== "string") throw new Error(`Enter ${label}.`);
  const result = value.trim().normalize("NFC");
  if ((!optional && !result) || result.length > maximum || /[\u0000-\u001f\u007f]/.test(result)) throw new Error(`Enter ${label} using no more than ${maximum} characters without control characters.`);
  return result;
}
export function dealershipId(value: unknown, label = "record"): string {
  const id = dealershipText(value, label, 200);
  if (/\s/.test(id)) throw new Error(`Choose a valid ${label}.`);
  return id;
}
export function dealershipEnum<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (!values.includes(value as T)) throw new Error(`Choose a valid ${label}.`);
  return value as T;
}
export function dealershipCents(value: unknown, optional = false): number | null {
  if (optional && (value === null || value === undefined || value === "")) return null;
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 1_000_000_000) throw new Error("Enter a nonnegative amount in integer cents, no greater than 10,000,000.00.");
  return Number(value);
}
export function requireDealershipCurrency(currency: string) {
  let digits: number | undefined;
  try { digits = new Intl.NumberFormat("en-CA", { style: "currency", currency }).resolvedOptions().maximumFractionDigits; } catch { /* Reject unsupported currencies below. */ }
  if (digits !== 2) throw new Error("Dealership operations currently require a currency with two decimal minor units, such as CAD or USD. Zero- or three-decimal currencies are not supported.");
}
export function dealershipDate(value: unknown, label: string, optional = false): string | null {
  if (optional && (value === null || value === undefined || value === "")) return null;
  if (!isCalendarDate(value)) throw new Error(`Enter ${label} as a real YYYY-MM-DD date.`);
  return value;
}
export function dealershipInstant(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value)) || !isCalendarDate(value.slice(0, 10))) throw new Error("Enter a valid time including its timezone offset.");
  return new Date(value).toISOString();
}
export function dealershipVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error("Reload the latest record before saving.");
  return Number(value);
}
export function validateDealershipAcquire(value: Record<string, unknown>, currency: string, now = new Date()): DealershipAcquire {
  requireDealershipCurrency(currency);
  const v = value.vehicle;
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("Enter vehicle details.");
  const vehicle = validateVehicle({ ...v, currency, status: "available", acquisitionCents: null, reconditioningCents: null }, now);
  return { vehicle, ownership: dealershipEnum(value.ownership, ["owned", "consignment"], "ownership"),
    physicalStatus: dealershipEnum(value.physicalStatus, DEALERSHIP_PHYSICAL_STATUSES, "physical status"),
    prepStatus: dealershipEnum(value.prepStatus, DEALERSHIP_PREP_STATUSES, "preparation status"),
    availability: dealershipEnum(value.availability ?? "available", ["available", "held"], "availability"), askingCents: dealershipCents(value.askingCents, true) };
}
export function parseDealershipCsv(csv: string, currency: string, now = new Date()): DealershipAcquire[] {
  if (new TextEncoder().encode(csv).byteLength > 100_000) throw new Error("Use a CSV no larger than 100 KB.");
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).map((line, i) => ({ line, row: i + 1 })).filter(item => item.line.trim());
  if (lines.length < 2 || lines.length > 101) throw new Error("Include 1 to 100 stock records.");
  if (JSON.stringify(csvCells(lines[0].line, 1).map(v => v.toLowerCase())) !== JSON.stringify(DEALERSHIP_CSV_HEADERS)) throw new Error("Use the dealership stock template's exact headings and order.");
  const identifiers = new Set<string>(), stocks = new Set<string>();
  return lines.slice(1).map(({ line, row }) => {
    try {
      const values = csvCells(line, row);
      if (values.length !== DEALERSHIP_CSV_HEADERS.length) throw new Error("Use the template's number of columns.");
      const [identifierKind, identifier, year, make, model, stockNumber, acquiredDate, ownership, physicalStatus, prepStatus, asking] = values;
      if (!/^\d{4}$/.test(year)) throw new Error("Enter a four-digit model year.");
      const entry = validateDealershipAcquire({ vehicle: { identifierKind, identifier, year: Number(year), make, model, stockNumber, acquiredDate }, ownership, physicalStatus, prepStatus, askingCents: vehicleAmountToCents(asking) }, currency, now);
      if (identifiers.has(entry.vehicle.identifier) || stocks.has(entry.vehicle.stockNumber)) throw new Error("A VIN or stock number repeats within this file.");
      identifiers.add(entry.vehicle.identifier); stocks.add(entry.vehicle.stockNumber);
      return entry;
    } catch (error) { throw new Error(`Row ${row}: ${error instanceof Error ? error.message : "Review this record."}`); }
  });
}
export function validateDealershipCredits(value: unknown): DealershipCredit[] {
  if (!Array.isArray(value) || value.length > 10) throw new Error("Supply up to 10 sales-credit allocations, or an empty list for unassigned credit.");
  const people = new Set<string>();
  let total = 0;
  return value.map(item => {
    if (!item || typeof item !== "object") throw new Error("Review the sales-credit allocations.");
    const personId = dealershipId(item.personId, "salesperson");
    if (people.has(personId)) throw new Error("Each salesperson can appear only once.");
    if (!Number.isInteger(item.shareBps) || item.shareBps <= 0 || item.shareBps > 10_000) throw new Error("Enter each credit share in basis points from 1 to 10,000.");
    people.add(personId); total += item.shareBps;
    if (total > 10_000) throw new Error("Sales credit cannot exceed 100%. The remainder stays unassigned.");
    return { personId, shareBps: item.shareBps };
  });
}
/** Largest-remainder allocation includes the unassigned share and preserves every cent. */
export function allocateDealershipAmount(amountCents: number, credits: readonly DealershipCredit[]) {
  if (!Number.isSafeInteger(amountCents)) throw new Error("Allocation requires exact integer cents.");
  const total = credits.reduce((sum, row) => sum + row.shareBps, 0);
  if (total > 10_000 || credits.some(row => !Number.isInteger(row.shareBps) || row.shareBps < 1)) throw new Error("Invalid credit shares.");
  const sign = amountCents < 0 ? -1 : 1, absolute = BigInt(Math.abs(amountCents));
  const rows = [...credits.map(row => ({ personId: row.personId as string | null, shareBps: row.shareBps })), { personId: null, shareBps: 10_000 - total }].map(row => {
    const product = absolute * BigInt(row.shareBps);
    return { ...row, cents: Number(product / BigInt(10_000)), remainder: Number(product % BigInt(10_000)) };
  });
  let residual = Math.abs(amountCents) - rows.reduce((sum, row) => sum + row.cents, 0);
  for (const row of [...rows].sort((a, b) => b.remainder - a.remainder || (a.personId ?? "~").localeCompare(b.personId ?? "~"))) if (residual-- > 0) row.cents++;
  return rows.map(({ personId, shareBps, cents }) => ({ personId, shareBps, amountCents: cents * sign }));
}
