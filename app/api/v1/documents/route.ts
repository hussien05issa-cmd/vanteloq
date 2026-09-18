import { and, desc, eq } from "drizzle-orm";
import { getD1, getDb, getR2, getRuntimeEnv } from "../../../../db";
import { cleanupCompletedDocument, processDocument, processingSummary, readProcessing } from "../../../../server/document-processing";
import { deleteDocument, documentDeletionSummary } from "../../../../server/document-deletion";
import { documentCleanupRetrySummary } from "../../../../server/document-cleanup-state";
import { documentProviderConfiguration } from "../../../../server/document-providers";
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
  readRequestBytes,
} from "../../../../server/api";
import { effectivePermissions, requirePermission } from "../../../../server/permissions";
import { requireOrganizationWideLocationAccess } from "../../../../server/location-access";

import { safeName, verifiedType, quarantineDocument } from "../../../../server/document-ingest";
import { documentEmailConfigured } from "../../../../server/document-email";

const users = ["owner", "admin", "manager", "employee", "read_only"] as const;
const maximumBytes = 10 * 1024 * 1024;

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
    documents: documents.map(({ extractedJson, ...document }) => ({ ...document, ...processingSummary(extractedJson), ...documentDeletionSummary(extractedJson, document.status), ...documentCleanupRetrySummary(extractedJson, document.status) })),
    pipeline: {
      upload: "live",
      tenantStorage: "live",
      duplicateDetection: "live",
      mimeVerification: "live",
      malwareScanning: providers.scanning ? "configured" : "not_configured",
      ocrExtraction: providers.extraction ? "configured" : "not_configured",
      emailForwarding: documentEmailConfigured(undefined,organizationId) ? "configured" : "not_configured",
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
    if (document.status === "deletion_pending") throw new ApiError(409, "DOCUMENT_DELETION_PENDING", "This document is unavailable while deletion is being completed.");
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
    if (document.scanStatus !== "clean" || object.customMetadata?.securityState !== "clean" || object.customMetadata?.organizationId !== context.organizationId) {
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
    const canViewDocuments = (await effectivePermissions(context)).includes("documents.view");
    await enforceRateLimit("documents:write", context.userId, 30, 3_600);
    const contentType = request.headers.get("content-type") ?? "";
    if (!/^multipart\/form-data(?:\s*;|$)/i.test(contentType))
      throw new ApiError(415, "UNSUPPORTED_CONTENT_TYPE", "Send the document as a multipart upload.");
    // Bound actual streamed bytes before multipart parsing. Content-Length may be absent.
    const uploadBytes = await readRequestBytes(request, maximumBytes + 100_000,
      "FILE_TOO_LARGE", "Documents must be 10 MB or smaller.");
    let form: FormData;
    try {
      form = await new Response(uploadBytes.buffer as ArrayBuffer, {
        headers: { "Content-Type": contentType },
      }).formData();
    } catch {
      throw new ApiError(400, "INVALID_MULTIPART", "The document upload could not be read. Choose the file and try again.");
    }
    const file = form.get("file");
    if (!(file instanceof File) || file.size <= 0 || file.size > maximumBytes)
      throw new ApiError(400, "INVALID_FILE", "Choose a document up to 10 MB.");
    const type = String(form.get("documentType") || "other");
    if (
      ![
        "invoice",
        "receipt",
        "bank_statement",
        "supplier_statement",
        "packing_slip",
        "purchase_order",
        "other",
      ].includes(type)
    )
      throw new ApiError(400, "INVALID_TYPE", "Select a valid document type.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const verified = verifiedType(bytes, file.type);
    const stored = await quarantineDocument({ database: getD1(), bucket: getR2(), organizationId: context.organizationId, authorizedByUserId: context.userId, bytes, fileName: file.name, contentType: file.type, documentType: type });
    if (stored.duplicate) throw new ApiError(409, "DUPLICATE_DOCUMENT", canViewDocuments ? `This file already exists as ${stored.fileName}.` : "This file has already been uploaded.");
    const id = stored.id;
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
    return jsonResponse({ ...(canViewDocuments ? await list(context.organizationId) : {}), uploadedId: id }, { status: 201 });
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
    if (body.action === "cleanup") {
      await enforceRateLimit("documents:cleanup", context.organizationId, 60, 3600);
      const result = await cleanupCompletedDocument({ database: getD1(), env: getRuntimeEnv(), organizationId: context.organizationId, documentId: body.id });
      await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
        action: "document.processing_cleanup_retried", resourceType: "document", resourceId: body.id,
        details: { state: result.state, cleanupPending: result.cleanupPending, newProcessingStarted: false } });
      return jsonResponse({ ...await list(context.organizationId), cleanupState: result.state });
    }
    if (body.action !== undefined && body.action !== "process") throw new ApiError(400, "INVALID_ACTION", "Choose document processing or cleanup.");
    const result = await processDocument({ database: getD1(), bucket: getR2(), env: getRuntimeEnv(), organizationId: context.organizationId, documentId: body.id, actorUserId: context.userId, noticeVersion: body.noticeVersion, retry: body.retry === true, beforeProviderCall: () => enforceRateLimit("documents:provider-work", context.organizationId, 60, 3600) });
    if (result.newlyAuthorized) await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId, action: "document.processing_authorized", resourceType: "document", resourceId: body.id, details: { noticeVersion: String(body.noticeVersion), providers: "azure-defender,azure-document-intelligence", purpose: "Security scan and provisional extraction; no ledger posting" } });
    return jsonResponse({ ...await list(context.organizationId), processingState: result.state });
  });
}

export async function DELETE(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, users, "invoice.basic");
    await requirePermission(context, "documents.retention");
    await requireOrganizationWideLocationAccess(context);
    await enforceRateLimit("documents:delete", context.userId, 30, 3600);
    const id = new URL(request.url).searchParams.get("id");
    if (!id || id.length > 200) throw new ApiError(400, "INVALID_FIELD", "Select a document.");
    const result = await deleteDocument({ database: getD1(), bucket: getR2(), env: getRuntimeEnv(),
      organizationId: context.organizationId, documentId: id, actorUserId: context.userId });
    await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
      action: result.deleted ? "document.deleted" : "document.deletion_pending", resourceType: "document", resourceId: id,
      details: { pendingSteps: result.pendingSteps.join(",") } });
    return jsonResponse({ ...result, ok: result.deleted, message: result.deleted
      ? "The original file and tracked processing copies were deleted. Provider recovery copies remain subject to their disclosed retention policy."
      : "Deletion is not complete. The file is unavailable while remaining copies are removed. Retry deletion to check cleanup." },
      { status: result.deleted ? 200 : 202 });
  });
}
