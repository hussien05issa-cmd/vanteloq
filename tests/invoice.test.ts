import assert from "node:assert/strict";
import test from "node:test";
import { parseCustomerInvoice } from "../domain/invoice";
import { createInvoicePdf } from "../server/invoice-pdf";

const fixture = {
  invoiceNumber: "INV-20260811-01",
  invoiceDate: "2026-08-11",
  dueDate: "2026-09-10",
  currency: "CAD",
  locationRef: "all",
  purchaseOrderRef: "PO-441",
  issuer: { name: "Northline Retail Ltd.", address: "101 Jasper Avenue, Edmonton, AB", email: "billing@example.com", phone: "780-555-0100", taxNumber: "GST 123456789" },
  customerId: null,
  customer: { name: "Example Customer", address: "202 River Road, Edmonton, AB", email: "customer@example.com", phone: "", taxNumber: "" },
  notes: "Thank you for your business.",
  paymentInstructions: "Payment is due within 30 days.",
  lines: [
    { description: "Inventory planning service", quantityMilli: 1_500, unitPriceCents: 20_000, taxRateBasisPoints: 500 },
    { description: "Monthly reporting", quantityMilli: 1_000, unitPriceCents: 8_000, taxRateBasisPoints: 500 },
  ],
};

test("invoice totals are calculated server-side from validated lines", () => {
  const invoice = parseCustomerInvoice(fixture);
  assert.equal(invoice.subtotalCents, 38_000);
  assert.equal(invoice.taxCents, 1_900);
  assert.equal(invoice.totalCents, 39_900);
});

test("invoice validation rejects a due date before the issue date", () => {
  assert.throws(() => parseCustomerInvoice({ ...fixture, dueDate: "2026-08-10" }), /due date/i);
});

test("invoice validation rejects client-supplied totals and empty line descriptions", () => {
  assert.throws(() => parseCustomerInvoice({ ...fixture, totalCents: 1 }), /Unexpected invoice field/i);
  assert.throws(() => parseCustomerInvoice({ ...fixture, lines: [{ ...fixture.lines[0], description: "" }] }), /description/i);
});

test("invoice PDF is generated as a valid document", async () => {
  const bytes = await createInvoicePdf(parseCustomerInvoice(fixture), null, null);
  assert.ok(bytes.byteLength > 2_000);
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 5)), "%PDF-");
});
