import { handleApi, jsonResponse } from "../../../../server/api";
import { runScheduledSyncTick } from "../../../../server/integrations/sync-scheduler";
export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => jsonResponse(await runScheduledSyncTick(request, requestId)));
}

