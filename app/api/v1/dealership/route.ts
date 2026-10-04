import { getWorkspaceIndustry } from "../../../../server/industry-configuration";
import { requireAccess } from "../../../../server/authorization";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../server/api";
import { effectivePermissions, requirePermission } from "../../../../server/permissions";
import { dealershipPermissions, exportDealership, mutateDealership, readDealership } from "../../../../server/dealership";

async function access(request: Request) {
  const context = await requireAccess(request, ["owner", "admin", "manager", "employee", "read_only"], "inventory.lots");
  await requirePermission(context, "inventory.view");
  const { configuration } = await getWorkspaceIndustry(context);
  if (configuration.templateId !== "dealership" || !configuration.capabilities.includes("dealership_operations")) throw new ApiError(403, "DEALERSHIP_NOT_CONFIGURED", "Configure the dealership industry before using this workspace.");
  return { context, permissions: await dealershipPermissions(context, await effectivePermissions(context)) };
}
function inputError(error: unknown): never {
  if (error instanceof ApiError) throw error;
  if (error instanceof Error && !/D1_|SQLITE|database/i.test(error.message)) throw new ApiError(400, "DEALERSHIP_INPUT_INVALID", error.message);
  throw error;
}
export async function GET(request: Request) {
  return handleApi(request, async () => {
    const { context, permissions } = await access(request);
    await enforceRateLimit("dealership:read", context.userId, 90, 60);
    try {
      const params = new URL(request.url).searchParams;
      if (params.get("format") === "csv") {
        const result = await exportDealership(context, permissions, params);
        return new Response(result.csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${result.filename}"`, "cache-control": "no-store", "x-content-type-options": "nosniff" } });
      }
      return jsonResponse(await readDealership(context, permissions, params));
    } catch (error) { inputError(error); }
  });
}
export async function POST(request: Request) {
  return handleApi(request, async () => {
    requireSameOrigin(request);
    const { context, permissions } = await access(request);
    await enforceRateLimit("dealership:write", context.userId, 120, 3600);
    const body = await readJsonObject(request, 120_000);
    try { return jsonResponse(await mutateDealership(context, permissions, body)); } catch (error) { inputError(error); }
  });
}
