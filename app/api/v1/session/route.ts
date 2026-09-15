import { getD1 } from "../../../../db";
import { handleApi, jsonResponse, requireSameOrigin } from "../../../../server/api";
import { requireBillingAccess } from "../../../../server/authorization";
import { requireActiveWorkspaceSession, sessionLeaseId } from "../../../../server/session-policy";

const roles = ["owner", "admin", "manager", "employee", "read_only", "integration"] as const;
export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireBillingAccess(request, roles);
    const row = await getD1().prepare("SELECT expires_at AS expiresAt, last_seen_at AS lastSeenAt FROM workspace_sessions WHERE id = ?").bind(await sessionLeaseId(context)).first();
    return jsonResponse({ ...row, serverTime: Date.now() });
  });
}
// Only the activity heartbeat advances idle expiry. Dashboard polling, token
// refresh and other background API reads cannot keep an idle session alive.
export async function POST(request: Request) {
  return handleApi(request, async () => {
    requireSameOrigin(request);
    const context = await requireBillingAccess(request, roles);
    const row = await requireActiveWorkspaceSession(context, Date.now(), true);
    return jsonResponse({ ...row, serverTime: Date.now() });
  });
}
export async function DELETE(request: Request) {
  return handleApi(request, async () => {
    requireSameOrigin(request);
    const context = await requireBillingAccess(request, roles);
    await getD1().prepare("UPDATE workspace_sessions SET revoked = 1 WHERE id = ?").bind(await sessionLeaseId(context)).run();
    return jsonResponse({ signedOut: true });
  });
}
