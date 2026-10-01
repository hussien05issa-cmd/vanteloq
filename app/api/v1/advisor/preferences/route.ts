import { getD1 } from "../../../../../db";
import { requirePrivacyAccess } from "../../../../../server/authorization";
import { enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../../server/api";
import { advisorPreferences } from "../../../../../domain/advisor-personalization";
const readers = ["owner", "admin", "manager", "employee", "read_only"] as const;
export async function GET(request: Request) {
  return handleApi(request, async () => {
    const c = await requirePrivacyAccess(request, readers);
    const row = await getD1().prepare("SELECT preferences_json FROM advisor_preferences WHERE organization_id=? AND user_id=?").bind(c.organizationId, c.userId).first<{preferences_json:string}>();
    return jsonResponse({ preferences: advisorPreferences(row ? JSON.parse(row.preferences_json) : null), saved: Boolean(row) });
  });
}
export async function PUT(request: Request) {
  return handleApi(request, async () => {
    requireSameOrigin(request);
    const c = await requirePrivacyAccess(request, readers);
    await enforceRateLimit("advisor:preferences", c.userId, 20, 60);
    const body = await readJsonObject(request, 2000), preferences = advisorPreferences(body.preferences);
    // Explicit allowlist only. No name, financial figures, free text or history.
    await getD1().prepare("INSERT INTO advisor_preferences VALUES(?,?,?,?) ON CONFLICT(organization_id,user_id) DO UPDATE SET preferences_json=excluded.preferences_json,updated_at=excluded.updated_at").bind(c.organizationId,c.userId,JSON.stringify(preferences),Date.now()).run();
    return jsonResponse({preferences,saved:true});
  });
}
export async function DELETE(request: Request) {
  return handleApi(request, async () => {
    requireSameOrigin(request);
    const c = await requirePrivacyAccess(request, readers);
    await getD1().prepare("DELETE FROM advisor_preferences WHERE organization_id=? AND user_id=?").bind(c.organizationId,c.userId).run();
    return jsonResponse({preferences:advisorPreferences(null),saved:false});
  });
}
