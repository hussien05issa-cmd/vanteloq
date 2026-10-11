import { isCalendarDate } from "./calendar-date.ts";
import { invoiceLineAmounts, invoiceTotals } from "./invoice-amounts.ts";

export type InvoiceAccountingCommand =
  | { type: "issue"; invoiceId: string; date: string; revenueAccountId: string; taxAccountId: string | null; reviewed: true }
  | { type: "payment"; invoiceId: string; date: string; cashAccountId: string; amountCents: number; transactionId: string | null; reference: string; reviewed: true }
  | { type: "reverse_payment"; invoiceId: string; date: string; paymentId: string; reason: string; reviewed: true }
  | { type: "void"; invoiceId: string; date: string; reason: string; reviewed: true };

function text(value: unknown, maximum: number, name: string): string {
  if (typeof value !== "string") throw Error(`Enter ${name}.`);
  const clean = value.trim().normalize("NFC");
  if (!clean || clean.length > maximum || /[\u0000-\u001f\u007f]/.test(clean)) throw Error(`Enter a valid ${name}.`);
  return clean;
}
const id = (value: unknown) => text(value, 80, "record identifier");

export function invoiceAccountingCommand(body: Record<string, unknown>): InvoiceAccountingCommand {
  if (!isCalendarDate(body.date)) throw Error("Select a valid accounting date.");
  if (body.reviewed !== true) throw Error("Review and confirm the accounting entry before posting.");
  const base = { invoiceId: id(body.invoiceId), date: body.date, reviewed: true as const };
  let command: InvoiceAccountingCommand;
  if (body.type === "issue") command = { type: "issue", ...base, revenueAccountId: id(body.revenueAccountId), taxAccountId: body.taxAccountId == null ? null : id(body.taxAccountId) };
  else if (body.type === "payment") {
    if (!Number.isSafeInteger(body.amountCents) || Number(body.amountCents) <= 0) throw Error("Enter a positive payment in exact cents.");
    command = { type: "payment", ...base, cashAccountId: id(body.cashAccountId), amountCents: body.amountCents as number, transactionId: body.transactionId == null ? null : id(body.transactionId), reference: text(body.reference, 180, "payment reference") };
  } else if (body.type === "reverse_payment") command = { type: "reverse_payment", ...base, paymentId: id(body.paymentId), reason: text(body.reason, 500, "correction reason") };
  else if (body.type === "void") command = { type: "void", ...base, reason: text(body.reason, 500, "void reason") };
  else throw Error("Choose an invoice accounting action.");
  if (Object.keys(body).some(key => !(key in command))) throw Error("The request contains an unsupported field.");
  return command;
}

export type AccountingInvoice = {
  id: string; invoiceNumber: string; invoiceDate: string; customerId: string; currency: string;
  subtotalCents: number; taxCents: number; totalCents: number; paidCents: number;
  status: string; journalEntryId: string | null; locationRef: string; demoRecord: number;
};
export type AccountingInvoiceLine = { quantityMilli: number; unitPriceCents: number; taxRateBasisPoints: number; subtotalCents: number; taxCents: number; totalCents: number };

export function validateInvoiceForAccounting(invoice: AccountingInvoice, lines?: AccountingInvoiceLine[]) {
  for (const n of [invoice.subtotalCents, invoice.taxCents, invoice.totalCents, invoice.paidCents])
    if (!Number.isSafeInteger(n) || n < 0) throw Error("The invoice amounts require review.");
  if (!isCalendarDate(invoice.invoiceDate) || invoice.totalCents <= 0 || invoice.paidCents > invoice.totalCents || BigInt(invoice.subtotalCents) + BigInt(invoice.taxCents) !== BigInt(invoice.totalCents)) throw Error("The invoice totals require review.");
  if (lines) {
    if (!lines.length || lines.length > 100) throw Error("Review the invoice lines before posting.");
    for (const line of lines) {
      if (!Number.isSafeInteger(line.quantityMilli) || line.quantityMilli <= 0) throw Error("The invoice quantity requires review.");
      const expected = invoiceLineAmounts(line.quantityMilli, line.unitPriceCents, line.taxRateBasisPoints);
      if (expected.subtotalCents !== line.subtotalCents || expected.taxCents !== line.taxCents || expected.totalCents !== line.totalCents) throw Error("The invoice line amounts require review.");
    }
    const totals = invoiceTotals(lines);
    if (totals.subtotalCents !== invoice.subtotalCents || totals.taxCents !== invoice.taxCents || totals.totalCents !== invoice.totalCents) throw Error("The invoice lines do not agree with its totals.");
  }
}

export function invoicePaymentStatus(totalCents: number, paidCents: number): "due" | "partially_paid" | "paid" {
  if (![totalCents, paidCents].every(Number.isSafeInteger) || totalCents <= 0 || paidCents < 0 || paidCents > totalCents) throw Error("The payment balance requires review.");
  return paidCents === totalCents ? "paid" : paidCents ? "partially_paid" : "due";
}
