import { getD1, getR2 } from "../../../../../db";
import { parseCustomerInvoice } from "../../../../../domain/invoice";
import { recordAudit } from "../../../../../server/audit";
import { requireAccess } from "../../../../../server/authorization";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, requireSameOrigin } from "../../../../../server/api";
import { requireBookLoQPermission } from "../../../../../server/bookloq";
import { createInvoicePdf } from "../../../../../server/invoice-pdf";
import { requirePermission } from "../../../../../server/permissions";

const writers = ["owner", "admin", "manager"] as const;
const maximumLogoBytes = 1_000_000;

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256(bytes: Uint8Array) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer)));
}

function safeFilePart(value: string) {
  return value.normalize("NFC").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "invoice";
}

function verifiedLogo(file: File): Promise<{ bytes: Uint8Array; contentType: "image/png" | "image/jpeg" }> {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    if (!bytes.length || bytes.length > maximumLogoBytes) throw new ApiError(400, "INVALID_LOGO", "Choose a PNG or JPEG logo up to 1 MB.");
    const png = [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (png && file.type === "image/png") return { bytes, contentType: "image/png" };
    if (jpeg && ["image/jpeg", "image/jpg"].includes(file.type)) return { bytes, contentType: "image/jpeg" };
    throw new ApiError(400, "INVALID_LOGO", "Choose a verified PNG or JPEG logo.");
  });
}

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, writers);
    await requirePermission(context, "finance.ap_ar");
    requireBookLoQPermission(context.role, "edit_drafts");
    await enforceRateLimit("bookloq:invoice:create", context.userId, 60, 3_600);
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > 2_500_000) throw new ApiError(413, "REQUEST_TOO_LARGE", "Invoice requests must be 2.5 MB or smaller.");
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")) {
      throw new ApiError(415, "UNSUPPORTED_CONTENT_TYPE", "Send the invoice as multipart form data.");
    }
    const form = await request.formData();
    const rawInvoice = form.get("invoice");
    if (typeof rawInvoice !== "string" || new TextEncoder().encode(rawInvoice).byteLength > 100_000) {
      throw new ApiError(400, "INVALID_INVOICE", "Invoice details are required.");
    }
    let parsed: unknown;
    try { parsed = JSON.parse(rawInvoice); } catch { throw new ApiError(400, "INVALID_INVOICE", "Invoice details are not valid JSON."); }
    const invoice = parseCustomerInvoice(parsed);
    const logo = form.get("logo");
    const verified = logo instanceof File && logo.size > 0 ? await verifiedLogo(logo) : null;
    const database = getD1();
    const duplicate = await database.prepare("SELECT id FROM customer_invoices WHERE organization_id = ? AND invoice_number = ?")
      .bind(context.organizationId, invoice.invoiceNumber).first<{ id: string }>();
    if (duplicate) throw new ApiError(409, "INVOICE_NUMBER_EXISTS", "Use a unique invoice number.");

    let customerId = invoice.customerId;
    let createCustomer = false;
    if (customerId) {
      const customer = await database.prepare("SELECT id FROM bookloq_contacts WHERE organization_id = ? AND id = ? AND contact_type IN ('customer','both') AND active = 1")
        .bind(context.organizationId, customerId).first<{ id: string }>();
      if (!customer) throw new ApiError(400, "CUSTOMER_NOT_FOUND", "Select a valid active customer.");
    } else {
      customerId = crypto.randomUUID();
      createCustomer = true;
    }

    const id = crypto.randomUUID();
    const documentId = crypto.randomUUID();
    const nowMs = Date.now();
    const nowSeconds = Math.floor(nowMs / 1_000);
    const pdf = await createInvoicePdf(invoice, verified?.bytes ?? null, verified?.contentType ?? null);
    if (pdf.byteLength > 10 * 1024 * 1024) throw new ApiError(413, "INVOICE_TOO_LARGE", "The generated invoice is too large to store.");
    const digest = await sha256(pdf);
    const objectKey = `${context.organizationId}/documents/generated/${documentId}.pdf`;
    await getR2().put(objectKey, new Uint8Array(pdf).buffer, {
      httpMetadata: { contentType: "application/pdf", cacheControl: "private, no-store" },
      customMetadata: { organizationId: context.organizationId, generatedBy: context.userId, invoiceId: id, securityState: "application-generated" },
    });

    const statements = [];
    if (createCustomer) {
      statements.push(database.prepare(`INSERT INTO bookloq_contacts
        (id, organization_id, contact_type, name, email, phone, billing_address, payment_terms_days, credit_limit_cents, notes, active, created_at, updated_at)
        VALUES (?, ?, 'customer', ?, ?, ?, ?, 30, 0, '', 1, ?, ?)`)
        .bind(customerId, context.organizationId, invoice.customer.name, invoice.customer.email, invoice.customer.phone, invoice.customer.address, nowSeconds, nowSeconds));
    }
    statements.push(database.prepare(`INSERT INTO workspace_documents
      (id, organization_id, document_type, file_name, object_key, content_type, size_bytes, sha256_hex, security_state, status, extraction_status, extracted_json, uploaded_by_user_id, created_at, updated_at)
      VALUES (?, ?, 'invoice', ?, ?, 'application/pdf', ?, ?, 'clean', 'approved', 'complete', ?, ?, ?, ?)`)
      .bind(documentId, context.organizationId, `${safeFilePart(invoice.invoiceNumber)}.pdf`, objectKey, pdf.byteLength, digest, JSON.stringify({ source: "bookloq_generated", invoiceId: id }), context.userId, nowMs, nowMs));
    statements.push(database.prepare(`INSERT INTO customer_invoices
      (id, organization_id, customer_id, invoice_number, invoice_date, due_date, status, subtotal_cents, tax_cents, total_cents, paid_cents, currency, location_ref, purchase_order_ref, issuer_snapshot_json, customer_snapshot_json, notes, payment_instructions, document_id, demo_record, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`)
      .bind(id, context.organizationId, customerId, invoice.invoiceNumber, invoice.invoiceDate, invoice.dueDate, invoice.subtotalCents, invoice.taxCents, invoice.totalCents, invoice.currency, invoice.locationRef, invoice.purchaseOrderRef, JSON.stringify(invoice.issuer), JSON.stringify(invoice.customer), invoice.notes, invoice.paymentInstructions, documentId, nowSeconds, nowSeconds));
    invoice.lines.forEach((line, index) => statements.push(database.prepare(`INSERT INTO customer_invoice_lines
      (id, organization_id, invoice_id, line_number, description, quantity_milli, unit_price_cents, tax_rate_basis_points, subtotal_cents, tax_cents, total_cents, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), context.organizationId, id, index + 1, line.description, line.quantityMilli, line.unitPriceCents, line.taxRateBasisPoints, line.subtotalCents, line.taxCents, line.totalCents, nowSeconds)));
    try {
      await database.batch(statements);
    } catch (error) {
      await getR2().delete(objectKey);
      throw error;
    }
    await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId, action: "customer_invoice.created", resourceType: "customer_invoice", resourceId: id, details: { invoiceNumber: invoice.invoiceNumber, customerId, currency: invoice.currency, totalCents: invoice.totalCents, lineCount: invoice.lines.length, documentId } });
    return jsonResponse({ invoice: { id, invoiceNumber: invoice.invoiceNumber, documentId, downloadUrl: `/api/v1/documents?id=${encodeURIComponent(documentId)}`, status: "draft", customerEmail: invoice.customer.email, totalCents: invoice.totalCents, currency: invoice.currency } }, { status: 201 });
  });
}
