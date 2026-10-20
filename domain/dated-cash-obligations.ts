import { isCalendarDate } from "./calendar-date";
import { exactSum } from "./executive-metrics";
import type { ThirteenWeekCashFlowItem } from "./thirteen-week-cash-flow";

export type DatedCashBill = {
  id: string; billNumber: string; supplierName: string; dueDate: string;
  totalCents: number; paidCents: number; status: string; currency: string;
  approvalStatus: string; demoRecord: number | boolean; purchaseOrderRef: string | null;
};
export type DatedCashInvoice = {
  id: string; invoiceNumber: string; customerName: string; dueDate: string;
  totalCents: number; paidCents: number; status: string; currency: string; demoRecord: number | boolean;
};
export type DatedCashOrder = {
  id: string; orderNumber: string; supplierName: string; committedCashDate: string | null;
  expectedDeliveryDate: string | null; totalCents: number; currency: string; status: string;
};
const billStatuses = new Set(["draft", "received", "extracted", "under_review", "matched", "awaiting_approval", "approved", "scheduled", "partially_paid", "disputed"]);
const orderStatuses = new Set(["sent", "acknowledged", "partially_received", "received", "partially_invoiced", "invoiced", "disputed"]);
const confirmedBill = (bill: DatedCashBill) => ["approved", "scheduled", "partially_paid"].includes(bill.status)
  && ["approved", "not_required"].includes(bill.approvalStatus);
const remaining = (record: { totalCents: number; paidCents: number }) => Math.max(0, exactSum([record.totalCents, -record.paidCents]));

/** One contract for forecasts and purchasing. A PO and its bills represent one
 * purchase exposure, with payments reducing it once. Receivables are expected,
 * never spendable purchasing authority. Unreviewed bills remain reserved. */
export function buildDatedCashObligations(input: {
  baseCurrency: string; asOf: string; bills: readonly DatedCashBill[];
  invoices: readonly DatedCashInvoice[]; orders: readonly DatedCashOrder[];
}) {
  if (!isCalendarDate(input.asOf)) throw new Error("Choose a valid cash planning date.");
  const currency = input.baseCurrency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Review the cash planning currency.");
  for (const records of [input.bills, input.invoices, input.orders]) {
    if (new Set(records.map(row => row.id)).size !== records.length) throw new Error("Duplicate obligation records require review.");
    for (const row of records) {
      if (!Number.isSafeInteger(row.totalCents) || row.totalCents < 0
        || ("paidCents" in row && (!Number.isSafeInteger(row.paidCents) || row.paidCents < 0 || row.paidCents > row.totalCents))) {
        throw new Error("Cash obligations require exact non-negative cents and valid payment balances.");
      }
    }
  }
  const bills = input.bills.filter(bill => !bill.demoRecord && bill.status !== "void");
  const openBills = bills.filter(bill => billStatuses.has(bill.status) && remaining(bill) > 0);
  const orders = input.orders.filter(order => orderStatuses.has(order.status));
  const linkedIds = new Set<string>();
  const schedule: ThirteenWeekCashFlowItem[] = [];
  const exposures: number[] = [];
  let excludedCurrencyItemCount = 0, undatedCommittedItemCount = 0;
  const blocks: string[] = [];
  const addBill = (bill: DatedCashBill, amountCents: number) => {
    if (!amountCents) return;
    if (!isCalendarDate(bill.dueDate)) { undatedCommittedItemCount++; return; }
    schedule.push({ id: `bill:${bill.id}`, dueDate: bill.dueDate, amountCents, direction: "out",
      certainty: confirmedBill(bill) ? "confirmed" : "expected", label: `${bill.supplierName} bill ${bill.billNumber}` });
  };
  for (const order of orders) {
    const linked = bills.filter(bill => bill.purchaseOrderRef === order.id || bill.purchaseOrderRef === order.orderNumber);
    for (const bill of linked) {
      if (linkedIds.has(bill.id)) throw new Error("A bill is linked to multiple purchase orders. Review its allocation.");
      linkedIds.add(bill.id);
    }
    if (linked.some(bill => bill.currency.toUpperCase() !== order.currency.toUpperCase())) blocks.push("linked_bill_currency_mismatch");
    const sameCurrency = linked.filter(bill => bill.currency.toUpperCase() === order.currency.toUpperCase());
    const openLinked = sameCurrency.filter(bill => billStatuses.has(bill.status) && remaining(bill) > 0);
    const paidCents = exactSum(sameCurrency.map(bill => bill.paidCents));
    const orderRemaining = Math.max(0, exactSum([order.totalCents, -paidCents]));
    const billRemaining = exactSum(openLinked.map(remaining));
    const exposure = Math.max(orderRemaining, billRemaining);
    if (!exposure) continue;
    if (order.currency.toUpperCase() !== currency) { excludedCurrencyItemCount++; continue; }
    exposures.push(exposure);
    // Bills supply their own due dates; the unbilled remainder keeps the PO date.
    for (const bill of openLinked) addBill(bill, remaining(bill));
    const unbilled = Math.max(0, exactSum([exposure, -billRemaining]));
    if (unbilled > 0) {
      if (!isCalendarDate(order.committedCashDate)) { undatedCommittedItemCount++; continue; }
      schedule.push({ id: `purchase-order:${order.id}`, dueDate: order.committedCashDate,
        amountCents: unbilled, direction: "out", certainty: "confirmed",
        label: `${order.supplierName} purchase order ${order.orderNumber}` });
    }
  }
  for (const bill of openBills.filter(bill => !linkedIds.has(bill.id))) {
    if (bill.currency.toUpperCase() !== currency) { excludedCurrencyItemCount++; continue; }
    exposures.push(remaining(bill)); addBill(bill, remaining(bill));
  }
  for (const invoice of input.invoices.filter(invoice => !invoice.demoRecord
    && ["approved", "sent", "viewed", "due", "partially_paid", "overdue"].includes(invoice.status) && remaining(invoice) > 0)) {
    if (invoice.currency.toUpperCase() !== currency) continue;
    if (!isCalendarDate(invoice.dueDate)) { blocks.push("undated_receivable"); continue; }
    schedule.push({ id: `invoice:${invoice.id}`, dueDate: invoice.dueDate, amountCents: remaining(invoice),
      direction: "in", certainty: "expected", label: `${invoice.customerName} invoice ${invoice.invoiceNumber}` });
  }
  if (excludedCurrencyItemCount) blocks.push("foreign_currency_obligations");
  if (undatedCommittedItemCount) blocks.push("undated_purchase_commitments");
  schedule.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
  const exposureCents = exactSum(exposures);
  return { schedule, exposureCents, reservedPurchasingObligationsCents: exposureCents,
    // Compatibility with the existing purchasing guard: this reserve includes
    // unreviewed exposure and must be labelled "reserved", not "confirmed".
    confirmedPurchasingObligationsCents: exposureCents,
    confirmedOutflowsCents: exactSum(schedule.filter(item => item.direction === "out" && item.certainty === "confirmed").map(item => item.amountCents)),
    excludedCurrencyItemCount, undatedCommittedItemCount, blocks: [...new Set(blocks)],
    boundary: "Open supplier bills and purchase orders are reserved once, including bills still under review. Invoice receipts are expected, not guaranteed cash. Rent, payroll, tax and other commitments need a dated recorded bill or an explicit additional plan; their absence never proves they are zero." };
}

export function datedPurchasingCapacity(input: {
  openingCashCents: number | null; safetyReserveCents: number;
  obligations: ReturnType<typeof buildDatedCashObligations>;
}) {
  if (input.openingCashCents === null || input.obligations.blocks.length) return null;
  if (!Number.isSafeInteger(input.openingCashCents) || !Number.isSafeInteger(input.safetyReserveCents) || input.safetyReserveCents < 0) throw new Error("Review the exact cash balance and safety reserve.");
  return Math.max(0, exactSum([input.openingCashCents, -input.safetyReserveCents, -input.obligations.exposureCents]));
}
