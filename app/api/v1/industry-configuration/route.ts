import { getD1 } from "../../../../db";
import { industryChangePreview, resolveIndustryTemplate, validateIndustryConfiguration } from "../../../../domain/industry-templates";
import { getWorkspaceIndustry } from "../../../../server/industry-configuration";
import { requireAccess } from "../../../../server/authorization";
import { effectivePermissions, requirePermission } from "../../../../server/permissions";
import { ApiError, handleApi, jsonResponse, readJsonObject, requireSameOrigin, enforceRateLimit, hashIdentifier } from "../../../../server/api";
const readers = ["owner","admin","manager","employee","read_only"] as const;
export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, readers, "business.settings");
    await enforceRateLimit("industry:read", context.userId, 90, 60);
    return jsonResponse({ ...await getWorkspaceIndustry(context), canEdit: (await effectivePermissions(context)).includes("organization.settings") });
  });
}
export async function POST(request: Request) {
  return handleApi(request, async () => {
    requireSameOrigin(request);
    const context = await requireAccess(request, readers, "business.settings");
    await requirePermission(context,"organization.settings");
    await enforceRateLimit("industry:write",context.userId,30,3600);
    const body = await readJsonObject(request,12_000);
    if (body.action !== "preview" && body.action !== "save") throw new ApiError(400,"INDUSTRY_ACTION_INVALID","Preview the configuration before saving.");
    let next;
    try { next = validateIndustryConfiguration(body.configuration); } catch(error) { throw new ApiError(400,"INDUSTRY_INVALID",error instanceof Error ? error.message : "Review the business configuration."); }
    const current = await getWorkspaceIndustry(context);
    if (body.expectedRevision !== current.revision) throw new ApiError(409,"INDUSTRY_CHANGED","Another administrator changed the business configuration. Reload it and review again.");
    const fingerprint = await hashIdentifier(JSON.stringify([context.organizationId,context.userId,current.revision,next]));
    const preview = industryChangePreview(current.configuration,next);
    if (body.action === "preview") return jsonResponse({ preview, fingerprint });
    if (body.fingerprint !== fingerprint) throw new ApiError(409,"INDUSTRY_PREVIEW_REQUIRED","Review this exact configuration before saving.");
    const label = resolveIndustryTemplate(next.templateId).label, now=Date.now();
    // One compare-and-swap statement. Triggers preserve history and update the business label atomically.
    const result = current.revision === 0
      ? await getD1().prepare("INSERT INTO workspace_industry_config(organization_id,industry_label,config_json,revision,updated_by,updated_at) VALUES(?,?,?,1,?,?) ON CONFLICT(organization_id) DO NOTHING RETURNING revision").bind(context.organizationId,label,JSON.stringify(next),context.userId,now).first<{revision:number}>()
      : await getD1().prepare("UPDATE workspace_industry_config SET industry_label=?,config_json=?,revision=revision+1,updated_by=?,updated_at=? WHERE organization_id=? AND revision=? RETURNING revision").bind(label,JSON.stringify(next),context.userId,now,context.organizationId,current.revision).first<{revision:number}>();
    if (!result) throw new ApiError(409,"INDUSTRY_CHANGED","The configuration changed while you were saving. Reload it before trying again.");
    return jsonResponse({ configuration: next, revision: result.revision, updatedAt: now, canEdit:true, industry:label });
  });
}
