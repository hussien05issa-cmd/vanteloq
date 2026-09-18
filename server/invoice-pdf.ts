import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { CustomerInvoiceInput } from "../domain/invoice";
import { ApiError } from "./api";

const WIDTH = 612, HEIGHT = 792, MARGIN = 48, CONTENT = WIDTH - MARGIN * 2;
const NAVY = rgb(.035, .12, .22), BLUE = rgb(.08, .34, .82), MUTED = rgb(.36, .44, .52);
const LINE = rgb(.84, .88, .92), PALE = rgb(.95, .97, .99);
const money = (cents: number, currency: string) => new Intl.NumberFormat("en-CA", { style: "currency", currency, minimumFractionDigits: 2 }).format(cents / 100);

// Preserve paragraphs and wrap long references as well as words.
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  return text.split("\n").flatMap(paragraph => {
    const output: string[] = [];
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && font.widthOfTextAtSize(line + " " + word, size) <= width) { line += " " + word; continue; }
      if (line) { output.push(line); line = ""; }
      for (const character of word) {
        if (line && font.widthOfTextAtSize(line + character, size) > width) { output.push(line); line = ""; }
        line += character;
      }
    }
    output.push(line);
    return output;
  });
}
function fitRight(page: PDFPage, text: string, font: PDFFont, size: number, right: number, y: number, width: number, color = NAVY) {
  const renderedSize = Math.min(size, size * width / Math.max(1, font.widthOfTextAtSize(text, size)));
  page.drawText(text, { x: right - font.widthOfTextAtSize(text, renderedSize), y, size: renderedSize, font, color });
}
export async function createInvoicePdf(input: CustomerInvoiceInput, logoBytes: Uint8Array | null, logoContentType: string | null): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  // Reject unsupported scripts before saving, never silently alter legal names.
  const fields: [string, string][] = [
    ["invoice number", input.invoiceNumber], ["purchase order reference", input.purchaseOrderRef],
    ["payment instructions", input.paymentInstructions], ["notes", input.notes],
    ...Object.entries(input.issuer).map(([key, value]): [string, string] => ["business " + key, value]),
    ...Object.entries(input.customer).map(([key, value]): [string, string] => ["customer " + key, value]),
    ...input.lines.map((line, index): [string, string] => ["description for line " + (index + 1), line.description]),
    ["currency", money(input.totalCents, input.currency)],
  ];
  for (const [field, value] of fields) {
    try { for (const line of value.split("\n")) { regular.encodeText(line); bold.encodeText(line); } }
    catch { throw new ApiError(400, "INVOICE_TEXT_UNSUPPORTED", "The " + field + " contains a character the invoice PDF font does not support. Use Latin text, or contact support for this script."); }
  }
  pdf.setTitle("Invoice " + input.invoiceNumber); pdf.setAuthor(input.issuer.name);
  pdf.setSubject("Customer invoice for " + input.customer.name); pdf.setCreator("BookLoQ by Vanteloq"); pdf.setCreationDate(new Date());
  let page = pdf.addPage([WIDTH, HEIGHT]), y = HEIGHT - MARGIN;
  const nextPage = () => { page = pdf.addPage([WIDTH, HEIGHT]); y = HEIGHT - MARGIN; };
  const ensure = (height: number) => { if (y - height < 62) nextPage(); };
  const paragraph = (text: string, size = 9, font = regular, color = NAVY) => {
    for (const line of wrap(text, font, size, CONTENT)) {
      ensure(size * 1.45); page.drawText(line, { x: MARGIN, y, size, font, color }); y -= size * 1.45;
    }
  };
  const heading = (title: string) => { ensure(40); y -= 12; paragraph(title, 8, bold, BLUE); y -= 5; };
  if (logoBytes && ["image/png", "image/jpeg"].includes(logoContentType ?? "")) {
    const logo = logoContentType === "image/png" ? await pdf.embedPng(logoBytes) : await pdf.embedJpg(logoBytes);
    const scale = Math.min(110 / logo.width, 42 / logo.height, 1);
    page.drawImage(logo, { x: MARGIN, y: y - 32, width: logo.width * scale, height: logo.height * scale });
  } else {
    page.drawRectangle({ x: MARGIN, y: y - 32, width: 38, height: 38, color: BLUE });
    const initial = input.issuer.name.slice(0, 1);
    page.drawText(initial, { x: MARGIN + 19 - bold.widthOfTextAtSize(initial, 19) / 2, y: y - 21, size: 19, font: bold, color: rgb(1, 1, 1) });
  }
  fitRight(page, "INVOICE", bold, 25, WIDTH - MARGIN, y - 10, 300);
  fitRight(page, input.invoiceNumber, regular, 10, WIDTH - MARGIN, y - 30, 380, MUTED);
  y -= 55; page.drawLine({ start: { x: MARGIN, y }, end: { x: WIDTH - MARGIN, y }, thickness: 1, color: BLUE }); y -= 23;
  paragraph(input.issuer.name, 12, bold); paragraph(input.issuer.address, 9, regular, MUTED);
  for (const value of [input.issuer.email, input.issuer.phone, input.issuer.taxNumber && "Tax number: " + input.issuer.taxNumber].filter(Boolean)) paragraph(value, 8, regular, MUTED);
  heading("INVOICE DETAILS");
  paragraph("Issued " + input.invoiceDate + "   ·   Due " + input.dueDate + "   ·   " + input.currency, 9);
  if (input.purchaseOrderRef) paragraph("Purchase order: " + input.purchaseOrderRef, 9);
  heading("BILL TO"); paragraph(input.customer.name, 11, bold); paragraph(input.customer.address, 9, regular, MUTED);
  for (const value of [input.customer.email, input.customer.phone].filter(Boolean)) paragraph(value, 8, regular, MUTED);
  y -= 20;
  const tableHeader = () => {
    ensure(56);
    page.drawRectangle({ x: MARGIN, y: y - 8, width: CONTENT, height: 25, color: NAVY });
    const white = rgb(1, 1, 1);
    page.drawText("DESCRIPTION", { x: MARGIN + 8, y, size: 7, font: bold, color: white });
    for (const [title, right, width] of [["QTY", 337, 42], ["RATE", 425, 80], ["TAX", 469, 38], ["AMOUNT", 556, 81]] as const)
      fitRight(page, title, bold, 7, right, y, width, white);
    y -= 29;
  };
  tableHeader();
  input.lines.forEach((line, index) => {
    const description = wrap(line.description, regular, 9, 230);
    let position = 0;
    do {
      if (y - 28 < 62) { nextPage(); tableHeader(); }
      const count = Math.max(1, Math.min(description.length - position, Math.floor((y - 70) / 13)));
      const height = Math.max(28, count * 13 + 10);
      if (index % 2) page.drawRectangle({ x: MARGIN, y: y - height + 13, width: CONTENT, height, color: PALE });
      for (let i = 0; i < count; i++) page.drawText(description[position + i], { x: MARGIN + 8, y: y - i * 13, size: 9, font: regular, color: NAVY });
      if (position === 0) {
        fitRight(page, String(line.quantityMilli / 1000), regular, 8, 337, y, 42);
        fitRight(page, money(line.unitPriceCents, input.currency), regular, 8, 425, y, 80);
        fitRight(page, String(line.taxRateBasisPoints / 100) + "%", regular, 8, 469, y, 38);
        fitRight(page, money(line.totalCents, input.currency), bold, 8, 556, y, 81);
      }
      y -= height; position += count;
      page.drawLine({ start: { x: MARGIN, y: y + 13 }, end: { x: WIDTH - MARGIN, y: y + 13 }, thickness: .5, color: LINE });
    } while (position < description.length);
  });
  y -= 8; ensure(100);
  for (const [title, cents] of [["Subtotal", input.subtotalCents], ["Tax", input.taxCents], ["INVOICE TOTAL", input.totalCents]] as const) {
    page.drawText(title, { x: 310, y, size: 9, font: title === "INVOICE TOTAL" ? bold : regular, color: NAVY });
    fitRight(page, money(cents, input.currency), bold, 11, WIDTH - MARGIN, y, 146); y -= 24;
  }
  if (input.paymentInstructions) { heading("PAYMENT INSTRUCTIONS"); paragraph(input.paymentInstructions, 9, regular, MUTED); }
  if (input.notes) { heading("NOTES"); paragraph(input.notes, 9, regular, MUTED); }
  y -= 12; ensure(25); paragraph("Thank you for your business.", 9, bold);
  pdf.getPages().forEach((current, index) => {
    current.drawLine({ start: { x: MARGIN, y: 39 }, end: { x: WIDTH - MARGIN, y: 39 }, thickness: .6, color: LINE });
    fitRight(current, "Invoice " + input.invoiceNumber, regular, 7.5, 400, 25, 352, MUTED);
    fitRight(current, "Page " + (index + 1) + " of " + pdf.getPageCount(), regular, 7.5, WIDTH - MARGIN, 25, 130, MUTED);
  });
  return pdf.save();
}
