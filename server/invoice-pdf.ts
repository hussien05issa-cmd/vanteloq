import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import type { CustomerInvoiceInput } from "../domain/invoice";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 48;
const NAVY = rgb(0.035, 0.12, 0.22);
const BLUE = rgb(0.08, 0.34, 0.82);
const MUTED = rgb(0.36, 0.44, 0.52);
const LINE = rgb(0.84, 0.88, 0.92);
const PALE = rgb(0.95, 0.97, 0.99);

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency, minimumFractionDigits: 2 }).format(cents / 100);
}

function quantity(value: number) {
  const exact = value / 1_000;
  return Number.isInteger(exact) ? String(exact) : exact.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function linesFor(text: string, font: PDFFont, size: number, width: number): string[] {
  const paragraphs = text.replace(/\r/g, "").split("\n");
  const output: string[] = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) { output.push(""); continue; }
    let current = words.shift() ?? "";
    for (const word of words) {
      const candidate = `${current} ${word}`;
      if (font.widthOfTextAtSize(candidate, size) <= width) current = candidate;
      else { output.push(current); current = word; }
    }
    output.push(current);
  }
  return output;
}

function drawWrapped(page: PDFPage, text: string, font: PDFFont, size: number, x: number, y: number, width: number, color = NAVY, lineHeight = size * 1.35) {
  const lines = linesFor(text, font, size, width);
  lines.forEach((line, index) => page.drawText(line, { x, y: y - index * lineHeight, size, font, color }));
  return y - lines.length * lineHeight;
}

function right(page: PDFPage, text: string, font: PDFFont, size: number, x: number, y: number, color = NAVY) {
  page.drawText(text, { x: x - font.widthOfTextAtSize(text, size), y, size, font, color });
}

function drawFooter(page: PDFPage, regular: PDFFont, invoiceNumber: string, pageNumber: number) {
  page.drawLine({ start: { x: MARGIN, y: 34 }, end: { x: PAGE_WIDTH - MARGIN, y: 34 }, thickness: 0.6, color: LINE });
  page.drawText(`Invoice ${invoiceNumber}`, { x: MARGIN, y: 20, size: 7.5, font: regular, color: MUTED });
  right(page, `Page ${pageNumber}`, regular, 7.5, PAGE_WIDTH - MARGIN, 20, MUTED);
}

async function embedLogo(pdf: PDFDocument, bytes: Uint8Array | null, contentType: string | null): Promise<PDFImage | null> {
  if (!bytes || !contentType) return null;
  if (contentType === "image/png") return pdf.embedPng(bytes);
  if (contentType === "image/jpeg") return pdf.embedJpg(bytes);
  return null;
}

export async function createInvoicePdf(input: CustomerInvoiceInput, logoBytes: Uint8Array | null, logoContentType: string | null): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Invoice ${input.invoiceNumber}`);
  pdf.setAuthor(input.issuer.name);
  pdf.setSubject(`Customer invoice for ${input.customer.name}`);
  pdf.setCreator("BookLoQ by Vanteloq");
  pdf.setCreationDate(new Date());
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await embedLogo(pdf, logoBytes, logoContentType);
  let pageNumber = 0;
  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  pageNumber += 1;

  if (logo) {
    const scaled = logo.scale(Math.min(110 / logo.width, 58 / logo.height, 1));
    page.drawImage(logo, { x: MARGIN, y: PAGE_HEIGHT - MARGIN - scaled.height, width: scaled.width, height: scaled.height });
  } else {
    page.drawRectangle({ x: MARGIN, y: PAGE_HEIGHT - 92, width: 42, height: 42, color: BLUE });
    page.drawText(input.issuer.name.slice(0, 1).toUpperCase(), { x: 62, y: PAGE_HEIGHT - 80, size: 20, font: bold, color: rgb(1, 1, 1) });
  }
  right(page, "INVOICE", bold, 26, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 68, NAVY);
  right(page, input.invoiceNumber, regular, 10, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 88, MUTED);

  let y = PAGE_HEIGHT - 132;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 1.1, color: BLUE });
  y -= 26;
  page.drawText(input.issuer.name, { x: MARGIN, y, size: 12, font: bold, color: NAVY });
  y = drawWrapped(page, input.issuer.address, regular, 8.5, MARGIN, y - 15, 225, MUTED, 11);
  const issuerContact = [input.issuer.email, input.issuer.phone].filter(Boolean).join("  |  ");
  if (issuerContact) y = drawWrapped(page, issuerContact, regular, 8, MARGIN, y - 2, 225, MUTED, 10.5);
  if (input.issuer.taxNumber) page.drawText(`Tax number: ${input.issuer.taxNumber}`, { x: MARGIN, y: y - 2, size: 8, font: regular, color: MUTED });

  const metaX = 376;
  page.drawRectangle({ x: metaX - 14, y: PAGE_HEIGHT - 225, width: 188, height: 84, color: PALE, borderColor: LINE, borderWidth: 0.7 });
  const metadata = [["Invoice date", input.invoiceDate], ["Due date", input.dueDate], ["Currency", input.currency], ["Purchase order", input.purchaseOrderRef || "-"]];
  metadata.forEach(([label, value], index) => {
    const rowY = PAGE_HEIGHT - 159 - index * 17;
    page.drawText(label, { x: metaX, y: rowY, size: 7.5, font: regular, color: MUTED });
    right(page, value, bold, 8, PAGE_WIDTH - MARGIN - 1, rowY, NAVY);
  });

  y = PAGE_HEIGHT - 270;
  page.drawText("BILL TO", { x: MARGIN, y, size: 7.5, font: bold, color: BLUE });
  page.drawText(input.customer.name, { x: MARGIN, y: y - 19, size: 11, font: bold, color: NAVY });
  let customerY = drawWrapped(page, input.customer.address, regular, 8.5, MARGIN, y - 34, 290, MUTED, 11);
  const customerContact = [input.customer.email, input.customer.phone].filter(Boolean).join("  |  ");
  if (customerContact) customerY = drawWrapped(page, customerContact, regular, 8, MARGIN, customerY - 2, 300, MUTED, 10.5);
  y = Math.min(customerY - 20, PAGE_HEIGHT - 350);

  const columns = { description: MARGIN, quantity: 342, price: 405, tax: 477, amount: PAGE_WIDTH - MARGIN };
  const drawTableHeader = () => {
    page.drawRectangle({ x: MARGIN, y: y - 7, width: PAGE_WIDTH - MARGIN * 2, height: 27, color: NAVY });
    page.drawText("DESCRIPTION", { x: columns.description + 9, y: y + 2, size: 7, font: bold, color: rgb(1, 1, 1) });
    page.drawText("QTY", { x: columns.quantity, y: y + 2, size: 7, font: bold, color: rgb(1, 1, 1) });
    page.drawText("RATE", { x: columns.price, y: y + 2, size: 7, font: bold, color: rgb(1, 1, 1) });
    page.drawText("TAX", { x: columns.tax, y: y + 2, size: 7, font: bold, color: rgb(1, 1, 1) });
    right(page, "AMOUNT", bold, 7, columns.amount - 7, y + 2, rgb(1, 1, 1));
    y -= 18;
  };
  drawTableHeader();

  for (let index = 0; index < input.lines.length; index += 1) {
    const line = input.lines[index];
    const descriptionLines = linesFor(line.description, regular, 8.5, 270);
    const height = Math.max(29, descriptionLines.length * 11 + 12);
    if (y - height < 110) {
      drawFooter(page, regular, input.invoiceNumber, pageNumber);
      page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      pageNumber += 1;
      y = PAGE_HEIGHT - 72;
      page.drawText(`Invoice ${input.invoiceNumber} - continued`, { x: MARGIN, y: y + 24, size: 11, font: bold, color: NAVY });
      drawTableHeader();
    }
    if (index % 2 === 1) page.drawRectangle({ x: MARGIN, y: y - height + 8, width: PAGE_WIDTH - MARGIN * 2, height, color: PALE });
    descriptionLines.forEach((text, lineIndex) => page.drawText(text, { x: columns.description + 9, y: y - 8 - lineIndex * 11, size: 8.5, font: regular, color: NAVY }));
    page.drawText(quantity(line.quantityMilli), { x: columns.quantity, y: y - 8, size: 8, font: regular, color: NAVY });
    right(page, money(line.unitPriceCents, input.currency), regular, 8, 466, y - 8, NAVY);
    right(page, `${(line.taxRateBasisPoints / 100).toFixed(2).replace(/\.00$/, "")}%`, regular, 8, 515, y - 8, NAVY);
    right(page, money(line.totalCents, input.currency), bold, 8, columns.amount - 7, y - 8, NAVY);
    page.drawLine({ start: { x: MARGIN, y: y - height + 8 }, end: { x: PAGE_WIDTH - MARGIN, y: y - height + 8 }, thickness: 0.5, color: LINE });
    y -= height;
  }

  if (y < 190) {
    drawFooter(page, regular, input.invoiceNumber, pageNumber);
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pageNumber += 1;
    y = PAGE_HEIGHT - 72;
  }
  const totalX = 375;
  [["Subtotal", input.subtotalCents], ["Tax", input.taxCents]].forEach(([label, value], index) => {
    const rowY = y - index * 22;
    page.drawText(String(label), { x: totalX, y: rowY, size: 8.5, font: regular, color: MUTED });
    right(page, money(Number(value), input.currency), regular, 8.5, PAGE_WIDTH - MARGIN, rowY, NAVY);
  });
  page.drawRectangle({ x: totalX - 12, y: y - 67, width: PAGE_WIDTH - MARGIN - totalX + 12, height: 28, color: BLUE });
  page.drawText("AMOUNT DUE", { x: totalX, y: y - 57, size: 8, font: bold, color: rgb(1, 1, 1) });
  right(page, money(input.totalCents, input.currency), bold, 11, PAGE_WIDTH - MARGIN - 8, y - 59, rgb(1, 1, 1));

  let notesY = y - 98;
  if (input.paymentInstructions) {
    page.drawText("PAYMENT INSTRUCTIONS", { x: MARGIN, y: notesY, size: 7.5, font: bold, color: BLUE });
    notesY = drawWrapped(page, input.paymentInstructions, regular, 8, MARGIN, notesY - 14, 300, MUTED, 10.5) - 7;
  }
  if (input.notes) {
    page.drawText("NOTES", { x: MARGIN, y: notesY, size: 7.5, font: bold, color: BLUE });
    drawWrapped(page, input.notes, regular, 8, MARGIN, notesY - 14, 300, MUTED, 10.5);
  }
  page.drawText("Thank you for your business.", { x: MARGIN, y: 52, size: 8.5, font: bold, color: NAVY });
  drawFooter(page, regular, input.invoiceNumber, pageNumber);
  return pdf.save();
}
