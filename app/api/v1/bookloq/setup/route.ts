import { getD1 } from "../../../../../db";
import { requireAccess } from "../../../../../server/authorization";
import { ApiError, clientSource, enforceRateLimit, handleApi, hashIdentifier, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../../server/api";
import { requireBookLoQPermission } from "../../../../../server/bookloq";
import { configureBookLoQ } from "../../../../../server/bookloq-setup";
import { bookloqSetupInput } from "../../../../../domain/bookloq-setup";
import { requirePermission } from "../../../../../server/permissions";
import { requireAddon } from "../../../../../server/entitlements/engine";
import { requireOrganizationWideLocationAccess } from "../../../../../server/location-access";
import { COUNTRIES, REGIONS } from "../../../../address-data";

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, ["owner", "admin"], "bookloq.chart_of_accounts");
    await requireAddon(context, "bookloq");
    await requireOrganizationWideLocationAccess(context);
    await requirePermission(context, "finance.journal_post");
    await requirePermission(context, "finance.periods");
    requireBookLoQPermission(context.role, "post_journals");
    await enforceRateLimit("bookloq:setup", context.userId, 12, 3600);
    const body = await readJsonObject(request, 4000);
    let input;
    try { input = bookloqSetupInput(body); } catch (error) { throw new ApiError(400,"BOOKLOQ_SETUP_INPUT",error instanceof Error ? error.message : "Review the accounting period."); }
    const country = COUNTRIES.find(item => item.code === context.organization.country || item.name.toLowerCase() === context.organization.country.toLowerCase())?.code;
    if (!country) throw new ApiError(409,"BOOKLOQ_COUNTRY_REQUIRED","Review the business country in workspace settings before configuring the books.");
    const province = REGIONS[country]?.find(item => item.code === context.organization.province || item.name.toLowerCase() === context.organization.province.toLowerCase())?.code ?? context.organization.province;
    const result = await configureBookLoQ(getD1(), {
      organizationId: context.organizationId, userId: context.userId, currency: context.organization.currency,
      country, province,
      fiscalYearStartMonth: ["January","February","March","April","May","June","July","August","September","October","November","December"].indexOf(context.organization.fiscalYearStart) + 1,
      requestId, sourceHash: await hashIdentifier(clientSource(request)),
    }, input);
    return jsonResponse(result, { status: result.replayed ? 200 : 201 });
  });
}
