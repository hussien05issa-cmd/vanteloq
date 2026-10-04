import assert from "node:assert/strict";
import test from "node:test";
import { visibleBookLoQAlert, visibleBookLoQInvoice, visibleBookLoQJournal, visibleBookLoQMatch, visibleBookLoQSupplier, visibleBookLoQTransaction } from "../server/bookloq-visibility.ts";
import { buildThirteenWeekCashFlow } from "../domain/thirteen-week-cash-flow.ts";

const customer = "Private Person";
const supplier = "Private Supplier";
const invoice = { id: "invoice", customerName: customer, customerEmail: "private@example.invalid", emailedTo: "recipient@example.invalid", invoiceNumber: "INV-17", totalCents: 42000, paidCents: 1000, dueDate: "2026-10-05", currency: "CAD" };
const bill = { id: "bill", supplierName: supplier, billNumber: "BILL-18", totalCents: 24000, paidCents: 0, dueDate: "2026-10-06", currency: "CAD" };
const transaction = { id: "bank-transaction", amountCents: 42000, postingDate: "2026-10-05", currency: "CAD", description: `Payment from ${customer}`, originalDescription: "private@example.invalid", contactName: customer, sourceSystem: "plaid" };
const match = { id: "match", transactionId: transaction.id, status: "confirmed", matchedAmountCents: 42000, supplierBillId: null, customerInvoiceId: invoice.id, documentId: null, targetLabel: invoice.invoiceNumber, note: `Spoke to ${customer}`, reasonsJson: JSON.stringify([`Received from ${customer}`]) };

test("identity-denied financial readers retain amounts and references without structured names or free-text bank identities", () => {
  const safeInvoice = visibleBookLoQInvoice(invoice, false);
  const safeBill = visibleBookLoQSupplier(bill, false);
  const safeTransaction = visibleBookLoQTransaction(transaction, false);
  assert.doesNotMatch(JSON.stringify([safeInvoice, safeBill, safeTransaction]), /Private Person|Private Supplier|private@|recipient@/);
  assert.equal(safeInvoice.totalCents, invoice.totalCents); assert.equal(safeInvoice.invoiceNumber, invoice.invoiceNumber);
  assert.equal(safeBill.totalCents, bill.totalCents); assert.equal(safeBill.billNumber, bill.billNumber);
  assert.equal(safeTransaction.amountCents, transaction.amountCents); assert.equal(safeTransaction.sourceSystem, "plaid");
  assert.equal(safeTransaction.contactName, null);
  assert.equal(invoice.customerName, customer, "Redaction must not mutate internal source records");
  assert.equal(transaction.description, `Payment from ${customer}`);
});

test("target permissions redact confirmed match IDs and private details independently of identity permission", () => {
  const restricted = visibleBookLoQMatch(match, { contactIdentity: true, accountsPayableReceivable: false, documents: true });
  assert.equal(restricted.customerInvoiceId, null); assert.equal(restricted.targetLabel, "Restricted supporting record");
  assert.equal(restricted.note, ""); assert.equal(restricted.reasonsJson, "[]");
  assert.equal(restricted.transactionId, transaction.id); assert.equal(restricted.status, "confirmed", "Retain an anonymous match marker so the client cannot offer a second target");
  assert.equal(restricted.matchedAmountCents, match.matchedAmountCents);
  const document = { ...match, customerInvoiceId: null, documentId: "private-document", targetLabel: "Private Person receipt.pdf" };
  const noDocuments = visibleBookLoQMatch(document, { contactIdentity: true, accountsPayableReceivable: true, documents: false });
  assert.equal(noDocuments.documentId, null); assert.doesNotMatch(JSON.stringify(noDocuments), /private-document|Private Person|receipt\.pdf/);
  const noIdentity = visibleBookLoQMatch(document, { contactIdentity: false, accountsPayableReceivable: true, documents: true });
  assert.equal(noIdentity.documentId, document.documentId); assert.equal(noIdentity.targetLabel, "Receipt");
  assert.equal(noIdentity.note, ""); assert.equal(noIdentity.reasonsJson, "[]");
  const supplierMatch = { ...match, customerInvoiceId: null, supplierBillId: "bill" };
  assert.equal(visibleBookLoQMatch(supplierMatch, { contactIdentity: true, accountsPayableReceivable: false, documents: true }).supplierBillId, null);
});

test("redacting before cash planning keeps calculation results and removes names from derived schedule labels", () => {
  const safeInvoice = visibleBookLoQInvoice(invoice, false), safeBill = visibleBookLoQSupplier(bill, false);
  const items = (i: typeof invoice, b: typeof bill) => [
    { id: i.id, label: `${i.customerName} invoice ${i.invoiceNumber}`, dueDate: i.dueDate, amountCents: i.totalCents - i.paidCents, direction: "in" as const, certainty: "expected" as const },
    { id: b.id, label: `${b.supplierName} bill ${b.billNumber}`, dueDate: b.dueDate, amountCents: b.totalCents - b.paidCents, direction: "out" as const, certainty: "confirmed" as const },
  ];
  const safeItems = items({ ...invoice, ...safeInvoice, emailedTo: "" }, safeBill);
  const flow = (forecastItems: ReturnType<typeof items>) => buildThirteenWeekCashFlow({ asOf: "2026-10-04", openingCashCents: 100000, safetyThresholdCents: 0, forecastItems, actualTransactions: [] });
  const authorized = flow(items(invoice, bill)), denied = flow(safeItems);
  assert.deepEqual(denied.weeks, authorized.weeks);
  assert.doesNotMatch(JSON.stringify(safeItems), /Private Person|Private Supplier/);
  assert.equal(safeItems[0].amountCents, 41000);
});

test("identity denial removes journal and alert prose while fully permitted callers retain exact records", () => {
  const journal = { id: "journal", memo: `Paid ${customer}`, sourceRef: "private@example.invalid", totalDebitCents: 42000 };
  const alert = { id: "alert", title: `${customer} overdue`, explanation: `Call ${customer}`, supportingRecordsJson: JSON.stringify([customer]), recommendedAction: `Email ${customer}`, resolutionHistoryJson: JSON.stringify([customer]), severity: "attention", dollarImpactCents: 42000 };
  assert.doesNotMatch(JSON.stringify([visibleBookLoQJournal(journal, false), visibleBookLoQAlert(alert, false)]), /Private Person|private@example/);
  assert.equal(visibleBookLoQJournal(journal, false).totalDebitCents, 42000);
  assert.equal(visibleBookLoQAlert(alert, false).dollarImpactCents, 42000);
  assert.deepEqual(visibleBookLoQInvoice(invoice, true), invoice);
  assert.deepEqual(visibleBookLoQSupplier(bill, true), bill);
  assert.deepEqual(visibleBookLoQTransaction(transaction, true), transaction);
  assert.deepEqual(visibleBookLoQMatch(match, { contactIdentity: true, accountsPayableReceivable: true, documents: true }), match);
  assert.deepEqual(visibleBookLoQJournal(journal, true), journal);
  assert.deepEqual(visibleBookLoQAlert(alert, true), alert);
});
