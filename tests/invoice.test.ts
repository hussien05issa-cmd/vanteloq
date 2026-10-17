import assert from "node:assert/strict";
import test from "node:test";
import { parseCustomerInvoice } from "../domain/invoice";
import { createInvoicePdf } from "../server/invoice-pdf";
import { PDFDocument, PDFPage } from "pdf-lib";
import { decimalUnits, formatInvoiceTaxPercent, invoiceLineAmounts, invoiceTaxRateUnits, invoiceTotals, parseInvoiceTaxPercent } from "../domain/invoice-amounts";
import { normalizedSourceTimestamp } from "../server/data-trust";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

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

test("invoice tax precision preserves GST, exact QST and combined calculations", () => {
  for (const [percent, basisPoints, expectedTax] of [
    ["0", 0, 0], ["5", 500, 5_000], ["9.975", 997.5, 9_975],
    ["14.975", 1497.5, 14_975], ["100", 10_000, 100_000], ["12.341", 1234.1, 12_341],
  ] as const) {
    const rate = parseInvoiceTaxPercent(percent);
    assert.equal(rate, basisPoints);
    assert.equal(formatInvoiceTaxPercent(rate), percent + "%");
    const preview = invoiceLineAmounts(1_000, 100_000, rate);
    const saved = parseCustomerInvoice({ ...fixture, lines: [{ ...fixture.lines[0], quantityMilli: 1_000, unitPriceCents: 100_000, taxRateBasisPoints: rate }] });
    assert.equal(preview.taxCents, expectedTax);
    assert.equal(saved.lines[0].taxRateBasisPoints, basisPoints);
    assert.equal(saved.taxCents, expectedTax);
    assert.equal(saved.totalCents, 100_000 + expectedTax);
    assert.equal(saved.totalCents, preview.totalCents);
  }
  assert.equal(invoiceLineAmounts(1_000, 2_000, 997.5).taxCents, 200, "QST half cent rounds up");
  assert.equal(invoiceLineAmounts(1_000, 2_000, 1497.5).taxCents, 300, "combined half cent rounds up");
  assert.equal(invoiceLineAmounts(1_000, 1_999, 997.5).taxCents, 199, "below half cent rounds down");
  assert.equal(formatInvoiceTaxPercent(parseInvoiceTaxPercent(".005")), "0.005%");
});

test("invoice tax inputs reject excessive precision and invalid or out-of-range rates without rounding", () => {
  for (const percent of ["9.9751", "14.97501", "100.001", "-1", "NaN", "Infinity", "1e1", "9,975", ""]) {
    assert.throws(() => parseInvoiceTaxPercent(percent), /tax rate.*three decimal/);
  }
  for (const value of [997.51, 1497.501, -1, 10_000.1, NaN, Infinity, "997.5", true]) {
    assert.throws(() => invoiceTaxRateUnits(value), /tax rate.*three decimal/);
    assert.throws(() => parseCustomerInvoice({ ...fixture, lines: [{ ...fixture.lines[0], taxRateBasisPoints: value }] }), /tax rate.*line 1/);
  }
  assert.throws(() => invoiceLineAmounts(1_000, 10_000, 997.51), /tax rate.*three decimal/);
});

test("all existing whole-basis-point tax rates retain the previous rounded amounts", () => {
  for (let rate = 0; rate <= 10_000; rate++) {
    const oldTax = Number((BigInt(99_995) * BigInt(rate) + BigInt(5_000)) / BigInt(10_000));
    assert.equal(invoiceLineAmounts(1_000, 99_995, rate).taxCents, oldTax, "basis points " + rate);
  }
});

test("existing invoice schema round-trips fractional rates and reopened PDF displays exact QST", async () => {
  const database = new DatabaseSync(":memory:");
  const drawn: string[] = [];
  const original = PDFPage.prototype.drawText;
  PDFPage.prototype.drawText = function(text, options) { drawn.push(text); return original.call(this, text, options); };
  try {
    database.exec("CREATE TABLE workspaces(id TEXT PRIMARY KEY); CREATE TABLE customer_invoices(id TEXT PRIMARY KEY); INSERT INTO workspaces VALUES('workspace'); INSERT INTO customer_invoices VALUES('invoice');");
    database.exec(readFileSync(new URL("../drizzle/0029_shallow_calypso.sql", import.meta.url), "utf8").split("--> statement-breakpoint")[0]);
    const rates = [500, 997.5, 1234.1, 0, 10_000];
    for (const [index, rate] of rates.entries()) {
      const amounts = invoiceLineAmounts(1_000, 100_000, rate);
      database.prepare("INSERT INTO customer_invoice_lines(id,organization_id,invoice_id,line_number,description,quantity_milli,unit_price_cents,tax_rate_basis_points,subtotal_cents,tax_cents,total_cents,created_at) VALUES(?,'workspace','invoice',?,'Tax precision fixture',1000,100000,?,?,?,?,1)").run(String(index), index + 1, rate, amounts.subtotalCents, amounts.taxCents, amounts.totalCents);
    }
    const rows = database.prepare("SELECT tax_rate_basis_points AS rate, tax_cents AS taxCents FROM customer_invoice_lines ORDER BY line_number").all();
    assert.deepEqual(rows.map(row => row.rate), rates);
    assert.equal(rows[1].taxCents, 9_975);
    const reopened = parseCustomerInvoice({ ...fixture, lines: [{ ...fixture.lines[0], quantityMilli: 1_000, unitPriceCents: 100_000, taxRateBasisPoints: rows[1].rate }] });
    const bytes = await createInvoicePdf(reopened, null, null);
    assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
    assert.ok(drawn.includes("9.975%"));
    assert.ok(!drawn.includes("9.98%"));
    assert.ok(drawn.some(text => text.includes("99.75")));
  } finally { PDFPage.prototype.drawText = original; database.close(); }
});

test("combined QST calculation cannot create an invoice with an undisclosed combined rate", async () => {
  const invoice = parseCustomerInvoice({ ...fixture, lines: [{ ...fixture.lines[0], quantityMilli: 1_000, unitPriceCents: 100_000, taxRateBasisPoints: 1497.5 }] });
  assert.equal(invoice.taxCents, 14_975);
  await assert.rejects(() => createInvoicePdf(invoice, null, null), error => {
    assert.equal((error as { code?: string }).code, "INVOICE_TAX_COMPONENTS_REQUIRED");
    assert.match((error as Error).message, /separate GST and QST disclosure/);
    return true;
  });
});

test("fractional quantities round half up identically in preview and persisted totals", () => {
  for (const [quantity, price, expected] of [["0.02", "7.25", 15], ["0.011", "5", 6], ["1", "1.005", null]] as const) {
    if (expected === null) { assert.throws(() => decimalUnits(price, 2)); continue; }
    const amounts = invoiceLineAmounts(decimalUnits(quantity, 3), decimalUnits(price, 2), 500);
    const saved = parseCustomerInvoice({ ...fixture, lines: [{ description: "Fractional service", quantityMilli: decimalUnits(quantity, 3), unitPriceCents: decimalUnits(price, 2), taxRateBasisPoints: 500 }] });
    assert.equal(amounts.subtotalCents, expected);
    assert.equal(saved.totalCents, amounts.totalCents);
  }
  assert.throws(() => invoiceTotals(Array.from({ length: 100 }, () => invoiceLineAmounts(90_000_000, 100_000_000_000, 10_000))), /supported amount/);
  assert.throws(() => parseCustomerInvoice({ ...fixture, lines: Array.from({ length: 100 }, () => ({ description: "Too large", quantityMilli: 90_000_000, unitPriceCents: 100_000_000_000, taxRateBasisPoints: 10_000 })) }), /supported amount/);
});

test("invoice dates are real calendar dates and multiline fields preserve paragraphs", () => {
  assert.throws(() => parseCustomerInvoice({ ...fixture, invoiceDate: "2026-02-30" }), /invoice date/);
  assert.throws(() => parseCustomerInvoice({ ...fixture, dueDate: "2026-09-31" }), /due date/);
  const invoice = parseCustomerInvoice({ ...fixture, issuer: { ...fixture.issuer, address: "101 Rue du Marché\r\nMontréal, QC" }, paymentInstructions: "First line\nSecond line" });
  assert.equal(invoice.issuer.address, "101 Rue du Marché\nMontréal, QC");
  assert.throws(() => parseCustomerInvoice({ ...fixture, notes: "bad\u0000control" }), /notes/);
});

test("unsupported invoice scripts fail with a clear field error before PDF persistence", async () => {
  assert.equal(decimalUnits(".5", 2), 50);
  assert.ok((await createInvoicePdf(parseCustomerInvoice({ ...fixture, issuer: { ...fixture.issuer, name: "µ Labs" } }), null, null)).length > 100);
  await assert.rejects(() => createInvoicePdf(parseCustomerInvoice({ ...fixture, customer: { ...fixture.customer, name: "李明" } }), null, null), /customer name.*font/);
});

test("long valid invoice text and unbroken references stay within every PDF page", async () => {
  const calls: { x: number; y: number; width: number }[] = [];
  const original = PDFPage.prototype.drawText;
  PDFPage.prototype.drawText = function(text, options) {
    calls.push({ x: options?.x ?? 0, y: options?.y ?? 0, width: options?.font?.widthOfTextAtSize(text, options?.size ?? 12) ?? 0 });
    return original.call(this, text, options);
  };
  try {
    const invoice = parseCustomerInvoice({ ...fixture, issuer: { ...fixture.issuer, name: "É".repeat(180) }, purchaseOrderRef: "P".repeat(120), paymentInstructions: "Payment instructions ".repeat(95).trim(), notes: "Invoice terms and conditions ".repeat(65).trim(), lines: Array.from({ length: 8 }, (_, index) => ({ ...fixture.lines[0], description: String(index) + "Z".repeat(499) })) });
    const bytes = await createInvoicePdf(invoice, null, null);
    assert.ok((await PDFDocument.load(bytes)).getPageCount() >= 3);
    for (const call of calls) { assert.ok(call.y >= 20 && call.y <= 744, JSON.stringify(call)); assert.ok(call.x >= 47.9 && call.x + call.width <= 564.1, JSON.stringify(call)); }
  } finally { PDFPage.prototype.drawText = original; }
});

test("source timestamps read seconds, milliseconds and legacy double-decoded dates consistently", () => {
  const now = 1789750500000;
  for (const value of [now, now / 1000, new Date(now), new Date(now * 1000)]) assert.equal(normalizedSourceTimestamp(value), new Date(now).toISOString());
  for (const value of [new Date(NaN), NaN, "", "not a date"]) assert.equal(normalizedSourceTimestamp(value), null);
});
