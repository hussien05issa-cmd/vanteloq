import { ApiError, enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../../server/api";
import { requireAccess } from "../../../../../server/authorization";
import { studioPolicy } from "../../../../../server/data-studio";
import { deleteStudioDefinition, listStudioDefinitions, saveStudioDefinition } from "../../../../../server/studio-definitions";
import { businessClock } from "../../../../../domain/intraday-sales";
import { StudioValidationError } from "../../../../../domain/data-studio";
import { STUDIO_DEFINITION_BODY_BYTES, validateStudioDefinitionApp, validateStudioDefinitionDelete, validateStudioDefinitionWrite } from "../../../../../domain/studio-definitions";

const readers = ["owner", "admin", "manager", "employee", "read_only"] as const;
const writers = ["owner", "admin", "manager", "employee"] as const;
async function access(request: Request, writing: boolean) {
  const parameters = new URL(request.url).searchParams;
  for (const key of parameters.keys()) if (!["workspace", ...(writing ? [] : ["app"])].includes(key) || parameters.getAll(key).length !== 1) throw new ApiError(400, "STUDIO_FILTER_INVALID", "Use each supported saved analysis filter once.");
  const context = await requireAccess(request, writing ? writers : readers, "reporting.basic");
  const clock = businessClock(new Date(), context.organization.timezone);
  if (!clock) throw new ApiError(409, "STUDIO_SETTINGS_REVIEW", "Review the business time zone before opening saved analyses.");
  return { today: clock.date, policy: await studioPolicy(request, { from: clock.date, to: clock.date, location: null, connection: null }, false) };
}
function validation(error: unknown): never {
  if (error instanceof StudioValidationError) throw new ApiError(400, error.code, error.message);
  throw error;
}
export async function GET(request: Request) {
  return handleApi(request, async () => {
    try {
      const { policy } = await access(request, false);
      await enforceRateLimit("studio:definitions:read", `${policy.context.organizationId}:${policy.context.userId}`, 30, 60);
      const app = new URL(request.url).searchParams.get("app");
      if (app !== null) validateStudioDefinitionApp(app);
      return jsonResponse({ analyses: await listStudioDefinitions(request, policy, app) });
    } catch (error) { validation(error); }
  });
}
export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    try {
      requireSameOrigin(request);
      const { today, policy: base } = await access(request, true);
      await enforceRateLimit("studio:definitions:write", `${base.context.organizationId}:${base.context.userId}`, 30, 60);
      const input = validateStudioDefinitionWrite(await readJsonObject(request, STUDIO_DEFINITION_BODY_BYTES), today);
      const policy = await studioPolicy(request, input.scope, false);
      return jsonResponse({ analysis: await saveStudioDefinition(request, requestId, policy, input) }, { status: input.id ? 200 : 201 });
    } catch (error) { validation(error); }
  });
}
export async function DELETE(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    try {
      requireSameOrigin(request);
      const { policy } = await access(request, true);
      await enforceRateLimit("studio:definitions:write", `${policy.context.organizationId}:${policy.context.userId}`, 30, 60);
      const input = validateStudioDefinitionDelete(await readJsonObject(request, STUDIO_DEFINITION_BODY_BYTES));
      await deleteStudioDefinition(request, requestId, policy, input);
      return jsonResponse({ deleted: true, id: input.id });
    } catch (error) { validation(error); }
  });
}
