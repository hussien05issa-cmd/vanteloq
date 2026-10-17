import { ApiError, enforceRateLimit, handleApi, jsonResponse } from "../../../../../server/api";
import { executiveReview, revalidateStudioPolicy, studioPolicy } from "../../../../../server/data-studio";
import { executiveReviewXlsx, STUDIO_XLSX_TYPE } from "../../../../../server/data-studio-xlsx";
import { StudioValidationError, type StudioScope } from "../../../../../domain/data-studio";
import { recordAudit } from "../../../../../server/audit";

export async function GET(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    try {
      const params = new URL(request.url).searchParams;
      for (const key of params.keys()) if (!["from", "to", "location", "connection", "format", "snapshot", "workspace"].includes(key) || params.getAll(key).length !== 1) throw new ApiError(400, "STUDIO_FILTER_INVALID", "Use the supported report filters once each.");
      const format = params.get("format") ?? "preview";
      if (!["preview", "xlsx"].includes(format)) throw new ApiError(400, "STUDIO_FORMAT_UNSUPPORTED", "Choose Preview or the Executive Review XLSX workbook.");
      const expectedSnapshot = params.get("snapshot");
      if (expectedSnapshot !== null && !/^[a-f0-9]{64}$/.test(expectedSnapshot)) throw new ApiError(400, "STUDIO_SNAPSHOT_INVALID", "Refresh the analysis before exporting.");
      const scope: StudioScope = { from: params.get("from") ?? "", to: params.get("to") ?? "", location: params.get("location"), connection: params.get("connection") };
      const exporting = format === "xlsx", policy = await studioPolicy(request, scope, exporting);
      await enforceRateLimit(exporting ? "studio:export" : "studio:preview", `${policy.context.organizationId}:${policy.context.userId}`, exporting ? 6 : 30, 60);
      const review = await executiveReview(policy, scope);
      if (expectedSnapshot !== null && expectedSnapshot !== review.metadata.snapshotHash) throw new ApiError(409, "STUDIO_RECORDS_CHANGED", "The underlying records or permitted sections changed. Refresh the review before exporting so your workbook matches it.");
      if (!exporting) { await revalidateStudioPolicy(request, scope, false, policy.fingerprint); return jsonResponse(review); }
      const bytes = await executiveReviewXlsx(review);
      await revalidateStudioPolicy(request, scope, true, policy.fingerprint);
      await recordAudit({ request, requestId, organizationId: policy.context.organizationId, actorUserId: policy.context.userId, action: "data_studio.export_generated", resourceType: "executive_review", resourceId: review.metadata.specificationHash, details: { format: "xlsx", rowCount: review.metadata.rowCount, bytes: bytes.byteLength, snapshotHash: review.metadata.snapshotHash, version: review.version } });
      return new Response(new Blob([new Uint8Array(bytes)]), { headers: { "Content-Type": STUDIO_XLSX_TYPE, "Content-Disposition": `attachment; filename="vanteloq-executive-review-${scope.from}-${scope.to}.xlsx"`,
        "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Studio-Snapshot": review.metadata.snapshotHash, "X-Report-Generated-At": review.metadata.generatedUtc } });
    } catch (error) {
      if (error instanceof StudioValidationError) throw new ApiError(error.code.includes("SCOPE") || error.code.includes("PERIOD") ? 400 : 409, error.code, error.message);
      throw error;
    }
  });
}
