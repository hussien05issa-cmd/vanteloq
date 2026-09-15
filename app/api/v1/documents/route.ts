import { and, desc, eq } from "drizzle-orm";
import { getD1, getDb, getR2, getRuntimeEnv } from "../../../../db";
import { processDocument, processingSummary, readProcessing } from "../../../../server/document-processing";
import { documentProviderConfiguration, deleteExtractionResult } from "../../../../server/document-providers";
import { workspaceDocuments } from "../../../../db/schema";
import { recordAudit } from "../../../../server/audit";
import { requireAccess } from "../../../../server/authorization";
import {
  ApiError,
  enforceRateLimit,
  handleApi,
  jsonResponse,
  requireSameOrigin,
  readJsonObject,
} from "../../../../server/api";
import { requirePermission } from "../../../../server/permissions";
import { requireOrganizationWideLocationAccess } from "../../../../server/location-access";

const users = ["owner", "admin", "manager", "employee", "read_only"] as const;
const maximumBytes = 10 * 1024 * 1024;

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}
async function sha256(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes);
  return hex(
    new Uint8Array(await crypto.subtle.digest("SHA-256", copy.buffer)),
  );
}
function safeName(value: string) {
  return (
    value
      .normalize("NFC")
      .replace(/[\u0000-\u001f\u007f/\\]/g, "_")
      .slice(0, 160) || "document"
  );
}
function verifiedType(bytes: Uint8Array, declared: string) {
  const text = new TextDecoder().decode(bytes.slice(0, 12));
  if (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    declared === "application/pdf"
  )
    return { type: "application/pdf", extension: "pdf" };
  if (
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff &&
    ["image/jpeg", "image/jpg"].includes(declared)
  )
    return { type: "image/jpeg", extension: "jpg" };
  if (
    [137, 80, 78, 71, 13, 10, 26, 10].every(
      (value, index) => bytes[index] === value,
    ) &&
    declared === "image/png"
  )
    return { type: "image/png", extension: "png" };
  if (
    text.startsWith("RIFF") &&
    text.slice(8, 12) === "WEBP" &&
    declared === "image/webp"
  )
    return { type: "image/webp", extension: "webp" };
  throw new ApiError(
    400,
    "UNSUPPORTED_DOCUMENT",
    "Upload a verified PDF, JPEG, PNG or WEBP file. HEIC and TIFF remain disabled until their conversion and malware-scanning pipeline is configured.",
  );
}

async function list(organizationId: string) {
  const documents = await getDb()
    .select({
      id: workspaceDocuments.id,
      documentType: workspaceDocuments.documentType,
      fileName: workspaceDocuments.fileName,
      contentType: workspaceDocuments.contentType,
      sizeBytes: workspaceDocuments.sizeBytes,
      securityState: workspaceDocuments.securityState,
      status: workspaceDocuments.status,
      scanStatus: workspaceDocuments.scanStatus,
      scannedAt: workspaceDocuments.scannedAt,
      extractionStatus: workspaceDocuments.extractionStatus,
      extractedJson: workspaceDocuments.extractedJson,
      createdAt: workspaceDocuments.createdAt,
      updatedAt: workspaceDocuments.updatedAt,
    })
    .from(workspaceDocuments)
    .where(eq(workspaceDocuments.organizationId, organizationId))
    .orderBy(desc(workspaceDocuments.createdAt))
    .limit(200);
  const providers = documentProviderConfiguration(getRuntimeEnv());
  return {
    documents: documents.map(({ extractedJson, ...document }) => ({ ...document, ...processingSummary(extractedJson) })),
    pipeline: {
      upload: "live",
      tenantStorage: "live",
      duplicateDetection: "live",
      mimeVerification: "live",
      malwareScanning: providers.scanning ? "configured" : "not_configured",
      ocrExtraction: providers.extraction ? "configured" : "not_configured",
      emailForwarding: "not_configured",
      cameraCapture: "browser_supported",
    },
  };
}

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, users, "invoice.basic");
    await requirePermission(context, "documents.view");
    await requireOrganizationWideLocationAccess(context);
    await enforceRateLimit("documents:read", context.userId, 90, 60);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return jsonResponse(await list(context.organizationId));
    const review = new URL(request.url).searchParams.get("view") === "extraction";
    await requirePermission(context, review ? "documents.review" : "documents.download");
    const [document] = await getDb()
      .select()
      .from(workspaceDocuments)
      .where(
        and(
          eq(workspaceDocuments.id, id),
          eq(workspaceDocuments.organizationId, context.organizationId),
        ),
      )
      .limit(1);
    if (!document) throw new ApiError(404, "NOT_FOUND", "Document not found.");
    if (document.securityState !== "clean") {
      throw new ApiError(
        409,
        "DOCUMENT_QUARANTINED",
        "This document remains quarantined until malware scanning confirms it is safe.",
      );
    }
    const object = await getR2().get(document.objectKey);
    if (!object)
      throw new ApiError(404, "NOT_FOUND", "Document file not found.");
    if (document.scanStatus !== "clean" || object.customMetadata?.securityState !== "clean") {
      throw new ApiError(
        423,
        "DOCUMENT_QUARANTINED",
        "This document cannot be downloaded until its independent security scan is complete.",
      );
    }
    if (review) {
      const { extraction } = readProcessing(document.extractedJson);
      if (!extraction || document.extractionStatus !== "complete") throw new ApiError(409, "EXTRACTION_NOT_READY", "This document is not ready for extraction review.");
      return jsonResponse({ id: document.id, fileName: document.fileName, extraction, status: "review_required", postedToLedger: false });
    }
    return new Response(object.body, {
      headers: {
        "Content-Type": document.contentType,
        "Content-Disposition": `attachment; filename="${safeName(document.fileName)}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, users, "invoice.basic");
    await requirePermission(context, "documents.upload");
    await requireOrganizationWideLocationAccess(context);
    await enforceRateLimit("documents:write", context.userId, 30, 3_600);
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > maximumBytes + 100_000)
      throw new ApiError(
        413,
        "FILE_TOO_LARGE",
        "Documents must be 10 MB or smaller.",
      );
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size <= 0 || file.size > maximumBytes)
      throw new ApiError(400, "INVALID_FILE", "Choose a document up to 10 MB.");
    const type = String(form.get("documentType") || "other");
    if (
      ![
        "invoice",
        "receipt",
        "supplier_statement",
        "packing_slip",
        "purchase_order",
        "other",
      ].includes(type)
    )
      throw new ApiError(400, "INVALID_TYPE", "Select a valid document type.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const verified = verifiedType(bytes, file.type);
    const digest = await sha256(bytes);
    const [duplicate] = await getDb()
      .select({
        id: workspaceDocuments.id,
        fileName: workspaceDocuments.fileName,
      })
      .from(workspaceDocuments)
      .where(
        and(
          eq(workspaceDocuments.organizationId, context.organizationId),
          eq(workspaceDocuments.sha256Hex, digest),
        ),
      )
      .limit(1);
    if (duplicate)
      throw new ApiError(
        409,
        "DUPLICATE_DOCUMENT",
        `This file already exists as ${duplicate.fileName}.`,
      );
    const id = crypto.randomUUID();
    const objectKey = `${context.organizationId}/documents/quarantine/${id}.${verified.extension}`;
    const now = Date.now();
    await getR2().put(objectKey, bytes.buffer, {
      httpMetadata: {
        contentType: verified.type,
        cacheControl: "private, no-store",
      },
      customMetadata: {
        organizationId: context.organizationId,
        uploadedBy: context.userId,
        securityState: "awaiting-malware-provider",
      },
    });
    try {
      await getD1()
        .prepare(
          `INSERT INTO workspace_documents
      (id, organization_id, document_type, file_name, object_key, content_type, size_bytes, sha256_hex, security_state, status, scan_status, extraction_status, extracted_json, uploaded_by_user_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'quarantined', 'review_required', 'pending', 'not_configured', '{}', ?, ?, ?)`,
        )
        .bind(
          id,
          context.organizationId,
          type,
          safeName(file.name),
          objectKey,
          verified.type,
          file.size,
          digest,
          context.userId,
          now,
          now,
        )
        .run();
    } catch (error) {
      await getR2().delete(objectKey);
      throw error;
    }
    await recordAudit({
      request,
      requestId,
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "document.uploaded_to_quarantine",
      resourceType: "document",
      resourceId: id,
      details: {
        documentType: type,
        contentType: verified.type,
        sizeBytes: file.size,
        extractionStatus: "not_configured",
      },
    });
    return jsonResponse({ ...await list(context.organizationId), uploadedId: id }, { status: 201 });
  });
}

export async function PATCH(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, users, "invoice.basic");
    await requirePermission(context, "documents.upload");
    await requirePermission(context, "documents.view");
    await requireOrganizationWideLocationAccess(context);
    await enforceRateLimit("documents:process", context.organizationId, 90, 60);
    const body = await readJsonObject(request, 2048);
    if (typeof body.id !== "string" || body.id.length > 80) throw new ApiError(400, "INVALID_FIELD", "Select a document.");
    const result = await processDocument({ database: getD1(), bucket: getR2(), env: getRuntimeEnv(), organizationId: context.organizationId, documentId: body.id, actorUserId: context.userId, noticeVersion: body.noticeVersion, retry: body.retry === true, beforeProviderCall: () => enforceRateLimit("documents:provider-work", context.organizationId, 60, 3600) });
    if (result.newlyAuthorized) await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId, action: "document.processing_authorized", resourceType: "document", resourceId: body.id, details: { noticeVersion: String(body.noticeVersion), providers: "cloudmersive,azure-document-intelligence", purpose: "Security scan and provisional extraction; no ledger posting" } });
    return jsonResponse({ ...await list(context.organizationId), processingState: result.state });
  });
}

export async function DELETE(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, users, "invoice.basic");
    await requirePermission(context, "documents.retention");
    await requireOrganizationWideLocationAccess(context);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new ApiError(400, "INVALID_FIELD", "Select a document.");
    const [document] = await getDb()
      .select()
      .from(workspaceDocuments)
      .where(
        and(
          eq(workspaceDocuments.id, id),
          eq(workspaceDocuments.organizationId, context.organizationId),
        ),
      )
      .limit(1);
    if (!document) throw new ApiError(404, "NOT_FOUND", "Document not found.");
    if (document.status === "approved")
      throw new ApiError(
        409,
        "RECORD_PROTECTED",
        "Approved documents must follow the organization retention workflow and cannot be directly deleted.",
      );
    const { processing } = readProcessing(document.extractedJson);
    if (processing?.operation) await deleteExtractionResult(getRuntimeEnv(), processing.operation).catch(() => {});
    await getD1()
      .prepare(
        "DELETE FROM workspace_documents WHERE id = ? AND organization_id = ?",
      )
      .bind(id, context.organizationId)
      .run();
    await getR2().delete(document.objectKey);
    await recordAudit({
      request,
      requestId,
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "document.unprocessed_deleted",
      resourceType: "document",
      resourceId: id,
    });
    return jsonResponse({ ok: true });
  });
}
