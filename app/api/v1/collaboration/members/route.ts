import { requireAccess } from "../../../../../server/authorization";
import { clientSource, enforceRateLimit, handleApi, jsonResponse } from "../../../../../server/api";
import { requirePermission } from "../../../../../server/permissions";
import { collaborationCapabilities, collaborationMembers, collaborationReaders, collaborationScope, requireCollaborationChannel } from "../../../../../server/collaboration";

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, collaborationReaders, "operations.basic");
    await requirePermission(context, "operations.tasks");
    await enforceRateLimit("collaboration:members", `${context.userId}:${clientSource(request)}`, 30, 60);
    const locationId = new URL(request.url).searchParams.get("location");
    const scope = await collaborationScope(context, locationId);
    // The directory exposes display names only, never private employee contacts.
    const members = locationId !== null || scope.organizationWide
      ? (await requireCollaborationChannel(context, locationId, null), await collaborationMembers(context, locationId)) : [];
    return jsonResponse({ members, locations: scope.locations.map(location => ({ id: location.id, name: location.name })), organizationWide: scope.organizationWide, ...await collaborationCapabilities(context) });
  });
}
