import { getD1 } from "../../../../db";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../server/api";
import { requireAccess, requirePrivacyAccess } from "../../../../server/authorization";
import { requirePermission } from "../../../../server/permissions";
import { requireOrganizationWideLocationAccess } from "../../../../server/location-access";
import { recordAudit } from "../../../../server/audit";
import { LINKED_FILE_NOTICE_VERSION, fileProvider, remoteFileId, snapshotCsv } from "../../../../domain/linked-files";
import { activeFileOwner, beginCloudAuthorization, cloudFileConfiguration, cloudFileMetadata, listCloudFiles, ownedCloudConnection, refreshLinkedFile, revealFileSnapshot, type LinkedFile } from "../../../../server/linked-files";

function checkedInput<T>(parse: () => T): T {
  try { return parse(); } catch (error) { throw new ApiError(400, "FILE_INPUT_INVALID", error instanceof Error ? error.message : "Choose a valid file connection."); }
}
async function access(request: Request) {
  const context = await requireAccess(request, ["owner"], "invoice.basic");
  await requirePermission(context, "documents.view");
  await requirePermission(context, "integrations.manage");
  await requireOrganizationWideLocationAccess(context);
  return context;
}
export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await access(request);
    await enforceRateLimit("linked-files:read", context.userId, 90, 60);
    const params = new URL(request.url).searchParams;
    const connectionId = params.get("connection");
    if (connectionId) {
      const connection = await ownedCloudConnection(context, connectionId);
      const remoteId = params.get("remote"), folder = params.get("folder") || "";
      if (remoteId) checkedInput(() => remoteFileId(remoteId));
      if (folder) checkedInput(() => remoteFileId(folder));
      return jsonResponse(remoteId ? await cloudFileMetadata(connection, remoteId) : await listCloudFiles(connection, folder, params.get("cursor") || ""));
    }
    const id = params.get("id");
    if (id) {
      const file = await getD1().prepare("SELECT * FROM linked_files WHERE id=? AND organization_id=? AND user_id=?").bind(id, context.organizationId, context.userId).first<LinkedFile>();
      if (!file) throw new ApiError(404, "LINKED_FILE_NOT_FOUND", "This linked file is not in your workspace.");
      const snapshot = await revealFileSnapshot(file);
      if (params.get("format") === "csv") {
        if (!snapshot) throw new ApiError(409, "FILE_SNAPSHOT_REQUIRED", "Refresh the selected sheet before importing.");
        return jsonResponse({ csv: snapshotCsv(snapshot), name: file.name, revision: file.revision });
      }
      return jsonResponse({ snapshot, revision: file.revision, documentId: file.document_id, lastCheckedAt: file.last_checked_at, lastChangedAt: file.last_changed_at, errorCode: file.error_code });
    }
    const connections = await getD1().prepare("SELECT id,provider,status,created_at createdAt FROM cloud_file_connections WHERE organization_id=? AND user_id=? AND status='connected' ORDER BY created_at DESC").bind(context.organizationId,context.userId).all();
    const sources = await getD1().prepare(`SELECT l.id,l.connection_id connectionId,c.provider,l.name,l.kind,l.sheet_name sheetName,l.enabled,l.last_checked_at lastCheckedAt,l.last_changed_at lastChangedAt,l.error_code errorCode,l.document_id documentId FROM linked_files l JOIN cloud_file_connections c ON c.id=l.connection_id WHERE l.organization_id=? AND l.user_id=? ORDER BY l.created_at DESC LIMIT 30`).bind(context.organizationId,context.userId).all();
    return jsonResponse({ connections: connections.results || [], sources: sources.results || [], providers: ["google-files", "microsoft-files"].map(value => { const provider = fileProvider(value); return { provider, available: cloudFileConfiguration(provider).ready }; }), refreshMode: "while_open", noticeVersion: LINKED_FILE_NOTICE_VERSION });
  });
}
export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const input = await readJsonObject(request, 4000), db = getD1(), now = Math.floor(Date.now()/1000);
    const cleanup = ["disconnect", "unlink", "pause"].includes(String(input.action));
    const context = cleanup ? await requirePrivacyAccess(request, ["owner"]) : await access(request);
    if (!cleanup) await requirePermission(context, "documents.upload");
    await enforceRateLimit("linked-files:write", context.userId, 60, 60);
    if (input.action === "authorize") {
      await enforceRateLimit("linked-files:authorize", context.userId, 6, 3600);
      if (input.accepted !== true || input.noticeVersion !== LINKED_FILE_NOTICE_VERSION) throw new ApiError(400,"FILE_CONSENT_REQUIRED","Review and accept the file connection notice first.");
      const provider = checkedInput(() => fileProvider(input.provider));
      const result = await beginCloudAuthorization(context, provider);
      await recordAudit({ request,requestId,organizationId:context.organizationId,actorUserId:context.userId,action:"linked_files.authorization_started",resourceType:"integration",resourceId:provider,details:{noticeVersion:LINKED_FILE_NOTICE_VERSION,scope:cloudFileConfiguration(provider).scopes,mode:"selected_files_while_open",automaticPosting:false} });
      return jsonResponse({ authorizationUrl: result.authorizationUrl }, { headers: { "Set-Cookie": result.cookie } });
    }
    if (input.action === "attach") {
      const connection = await ownedCloudConnection(context, String(input.connectionId || ""));
      const count = await db.prepare("SELECT COUNT(*) count FROM linked_files WHERE organization_id=? AND user_id=?").bind(context.organizationId,context.userId).first<{count:number}>();
      if ((count?.count || 0) >= 20) throw new ApiError(409,"LINKED_FILE_LIMIT","You can link up to 20 files. Unlink one before adding another.");
      const remote = checkedInput(() => remoteFileId(input.remoteId)), meta = await cloudFileMetadata(connection,remote);
      const sheetName = typeof input.sheetName === "string" ? input.sheetName : "";
      if (meta.kind === "sheet" && !meta.tabs.includes(sheetName)) throw new ApiError(400,"SHEET_SELECTION_REQUIRED","Choose the sheet tab you want to link.");
      const id = crypto.randomUUID();
      const inserted = await db.prepare(`INSERT INTO linked_files(id,organization_id,user_id,connection_id,remote_id,sheet_name,name,kind,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM cloud_file_connections c WHERE c.id=? AND c.organization_id=? AND c.user_id=? AND c.status='connected' AND ${activeFileOwner("c")}) ON CONFLICT(connection_id,remote_id,sheet_name) DO NOTHING`).bind(id,context.organizationId,context.userId,connection.id,remote,meta.kind === "sheet" ? sheetName : "",meta.name,meta.kind,now,now,connection.id,context.organizationId,context.userId).run();
      if (!inserted.meta.changes) { await ownedCloudConnection(context,connection.id); }
      return jsonResponse({ attached:true });
    }
    if (input.action === "disconnect") {
      const connection = await ownedCloudConnection(context,String(input.connectionId || ""));
      await db.batch([
        db.prepare("UPDATE cloud_file_connections SET status='revoked',token_ciphertext=NULL,verifier_ciphertext='',updated_at=? WHERE id=? AND organization_id=? AND user_id=?").bind(now,connection.id,context.organizationId,context.userId),
        db.prepare("DELETE FROM linked_files WHERE connection_id=? AND organization_id=? AND user_id=?").bind(connection.id,context.organizationId,context.userId),
      ]);
      await recordAudit({request,requestId,organizationId:context.organizationId,actorUserId:context.userId,action:"linked_files.disconnected",resourceType:"integration",resourceId:connection.id,details:{localCredentialsRemoved:true,previousDocumentImportsRetained:true}});
      return jsonResponse({ disconnected:true });
    }
    const file = await db.prepare("SELECT * FROM linked_files WHERE id=? AND organization_id=? AND user_id=?").bind(String(input.id || ""),context.organizationId,context.userId).first<LinkedFile>();
    if (!file) throw new ApiError(404,"LINKED_FILE_NOT_FOUND","This file is not linked to your workspace.");
    if (input.action === "refresh") {
      await enforceRateLimit("linked-files:refresh",context.userId,120,3600);
      return jsonResponse(await refreshLinkedFile(context,file));
    }
    if (input.action === "pause" || input.action === "resume") {
      await db.prepare("UPDATE linked_files SET enabled=?,updated_at=? WHERE id=? AND organization_id=? AND user_id=?").bind(input.action === "resume" ? 1 : 0,now,file.id,context.organizationId,context.userId).run();
      return jsonResponse({ updated:true });
    }
    if (input.action === "unlink") {
      await db.prepare("DELETE FROM linked_files WHERE id=? AND organization_id=? AND user_id=?").bind(file.id,context.organizationId,context.userId).run();
      return jsonResponse({ unlinked:true,previousDocumentImportsRetained:true });
    }
    throw new ApiError(400,"FILE_ACTION_INVALID","Choose a valid linked-file action.");
  });
}
