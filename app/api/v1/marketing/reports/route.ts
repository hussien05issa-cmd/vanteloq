import { requireAccess } from "../../../../../server/authorization";
import { ApiError, enforceRateLimit, handleApi, jsonResponse } from "../../../../../server/api";
import { requirePermission } from "../../../../../server/permissions";
import { accessibleMarketingSources } from "../../../../../server/marketing-evidence";
import { marketingAccessToken } from "../../../../../server/integrations/marketing";
import { fetchMarketingReport } from "../../../../../server/integrations/marketing-reporting";
import type { ReportView } from "../../../../../domain/marketing-reporting";

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, ["owner", "admin", "manager", "employee", "read_only"], "growth.strategy");
    await requirePermission(context, "marketing.view");
    const url = new URL(request.url), selectionId = url.searchParams.get("selectionId");
    const location = url.searchParams.get("location");
    await enforceRateLimit("marketing:reports", context.organizationId, selectionId ? 30 : 120, 60);
    const sources = await accessibleMarketingSources(context, location);
    if (!selectionId) return jsonResponse({ sources: sources.map(({ selection, connection }) => ({ id: selection.id, dataset: selection.dataset, name: selection.externalResourceName, status: connection.status === "connected" && connection.promotion === "approved" ? "ready" : "approval_required", lastSyncAt: connection.lastSyncAt?.toISOString() ?? null })), organicMeta: "Facebook Page and Instagram organic reporting require separately approved Meta permissions and resource selection; they are not included in ad-account access." });
    if (!/^[\w-]{8,80}$/.test(selectionId)) throw new ApiError(400, "MARKETING_SELECTION_INVALID", "Choose a valid reporting source.");
    const selected = sources.find(({ selection }) => selection.id === selectionId);
    if (!selected) throw new ApiError(404, "MARKETING_SOURCE_NOT_FOUND", "This reporting source is unavailable for your account and location.");
    if (selected.connection.status !== "connected" || selected.connection.promotion !== "approved") throw new ApiError(409, "MARKETING_APPROVAL_REQUIRED", "Connect this source, choose its resource and approve the sample in Integrations before reporting.");
    const token = await marketingAccessToken(context.organizationId, selected.selection.connectionId, selected.selection.provider);
    const report = await fetchMarketingReport(token, selected.selection, (url.searchParams.get("view") || "daily") as ReportView, Number(url.searchParams.get("days") || "28"));
    // Fail closed if a disconnect, scope edit or reauthorization happened during the fetch.
    const current = (await accessibleMarketingSources(context, location)).find(({ selection }) => selection.id === selectionId);
    if (!current || current.connection.status !== "connected" || current.connection.promotion !== "approved" || current.connection.selectionVersion !== selected.connection.selectionVersion) throw new ApiError(409, "MARKETING_SOURCE_CHANGED", "This connection changed while its report was loading. Refresh the source list.");
    return jsonResponse({ report, source: { name: selected.selection.externalResourceName, id: selectionId }, storage: "not_persisted" });
  });
}
