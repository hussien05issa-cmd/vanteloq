import { getD1, getR2, getRuntimeEnv } from "../../../../../../db";
import { recordAudit } from "../../../../../../server/audit";
import { requireAccess } from "../../../../../../server/authorization";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../../../server/api";
import { requireBookLoQPermission } from "../../../../../../server/bookloq";
import { requirePermission } from "../../../../../../server/permissions";

const writers = ["owner", "admin", "manager"] as const;
const emailPattern = /^[^\s@]{1,64}@[^\s@]{1,190}$/;

function safeText(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim().normalize("NFC").slice(0, 500) : fallback;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function base64(bytes: Uint8Array) {
  let value = "";
  const chunk = 16_384;
  for (let index = 0; index < bytes.length; index += chunk) value += String.fromCharCode(...bytes.subarray(index, index + chunk));
  return btoa(value);
}

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, writers, "bookloq.ar");
    await requirePermission(context, "finance.ap_ar");
    requireBookLoQPermission(context.role, "edit_drafts");
    await enforceRateLimit("bookloq:invoice:email", context.userId, 30, 3_600);
    const body = await readJsonObject(request, 4_096);
    const unknown = Object.keys(body).find((key) => !["invoiceId", "to", "message"].includes(key));
    if (unknown) throw new ApiError(400, "UNKNOWN_FIELD", `Unexpected field: ${unknown}.`);
    const invoiceId = safeText(body.invoiceId);
    const recipient = safeText(body.to).toLowerCase();
    const message = safeText(body.message);
    if (!invoiceId || !emailPattern.test(recipient)) throw new ApiError(400, "INVALID_EMAIL", "Choose an invoice and enter a valid recipient email.");
    const database = getD1();
    const invoice = await database.prepare(`SELECT i.id, i.invoice_number invoiceNumber, i.invoice_date invoiceDate, i.due_date dueDate,
      i.total_cents totalCents, i.currency, i.status, i.issuer_snapshot_json issuerJson, i.customer_snapshot_json customerJson,
      i.document_id documentId, d.object_key objectKey, d.file_name fileName
      FROM customer_invoices i JOIN workspace_documents d ON d.id = i.document_id AND d.organization_id = i.organization_id
      WHERE i.organization_id = ? AND i.id = ? AND d.security_state = 'clean'`)
      .bind(context.organizationId, invoiceId).first<{ id: string; invoiceNumber: string; invoiceDate: string; dueDate: string; totalCents: number; currency: string; status: string; issuerJson: string; customerJson: string; documentId: string; objectKey: string; fileName: string }>();
    if (!invoice) throw new ApiError(404, "INVOICE_NOT_FOUND", "Invoice not found.");
    if (invoice.status === "void") throw new ApiError(409, "INVOICE_VOID", "A void invoice cannot be emailed.");
    const object = await getR2().get(invoice.objectKey);
    if (!object) throw new ApiError(404, "INVOICE_FILE_NOT_FOUND", "The saved invoice PDF could not be found.");
    const pdfBytes = new Uint8Array(await new Response(object.body).arrayBuffer());
    const env = getRuntimeEnv();
    const apiKey = env.RESEND_API_KEY?.trim();
    if (!apiKey) throw new ApiError(503, "EMAIL_NOT_CONFIGURED", "Invoice email delivery is not configured. The PDF remains saved in Files.");
    let issuer: Record<string, unknown> = {};
    let customer: Record<string, unknown> = {};
    try { issuer = JSON.parse(invoice.issuerJson) as Record<string, unknown>; } catch { issuer = {}; }
    try { customer = JSON.parse(invoice.customerJson) as Record<string, unknown>; } catch { customer = {}; }
    const issuerName = safeText(issuer.name, context.organization.businessName);
    const customerName = safeText(customer.name, "there");
    const formattedTotal = new Intl.NumberFormat("en-CA", { style: "currency", currency: invoice.currency, minimumFractionDigits: 2 }).format(invoice.totalCents / 100);
    const personalMessage = message ? `<p style="margin:0 0 18px;color:#38516b;line-height:1.55">${escapeHtml(message)}</p>` : "";
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.INVOICE_EMAIL_FROM?.trim() || `${issuerName} <invoices@vanteloq.com>`,
        reply_to: env.INVOICE_EMAIL_REPLY_TO?.trim() || safeText(issuer.email) || context.organization.businessEmail,
        to: [recipient],
        subject: `Invoice ${invoice.invoiceNumber} from ${issuerName}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#102f4d"><div style="border-bottom:3px solid #1557d0;padding:22px 0"><strong style="font-size:20px">${escapeHtml(issuerName)}</strong></div><div style="padding:28px 0"><p style="margin:0 0 16px">Hello ${escapeHtml(customerName)},</p>${personalMessage}<p style="line-height:1.55;color:#38516b">Invoice <strong>${escapeHtml(invoice.invoiceNumber)}</strong> for <strong>${escapeHtml(formattedTotal)}</strong> is attached as a PDF. It was issued on ${escapeHtml(invoice.invoiceDate)} and is due ${escapeHtml(invoice.dueDate)}.</p><p style="line-height:1.55;color:#38516b">If anything needs to be corrected, reply directly to this email.</p></div><div style="border-top:1px solid #dce5ee;padding:18px 0;color:#718196;font-size:12px">Sent securely through BookLoQ by Vanteloq.</div></div>`,
        attachments: [{ filename: invoice.fileName, content: base64(pdfBytes), content_type: "application/pdf" }],
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      console.error(JSON.stringify({ level: "error", event: "invoice.email_failed", requestId, status: response.status, invoiceId }));
      throw new ApiError(502, "EMAIL_DELIVERY_FAILED", "The invoice is saved, but email delivery failed. Try again after checking the sender configuration.");
    }
    const result = await response.json().catch(() => ({})) as { id?: unknown };
    const now = Math.floor(Date.now() / 1_000);
    await database.prepare("UPDATE customer_invoices SET status = 'sent', sent_at = ?, emailed_to = ?, updated_at = ? WHERE organization_id = ? AND id = ?")
      .bind(now, recipient, now, context.organizationId, invoiceId).run();
    await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId, action: "customer_invoice.emailed", resourceType: "customer_invoice", resourceId: invoiceId, details: { recipient, providerMessageId: typeof result.id === "string" ? result.id : null, documentId: invoice.documentId } });
    return jsonResponse({ emailed: true, invoiceId, to: recipient, status: "sent" });
  });
}
