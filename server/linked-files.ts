import { getD1, getR2, getRuntimeEnv } from "../db";
import { ApiError } from "./api";
import type { AccessContext } from "./authorization";
import { decryptIntegrationSecret, encryptIntegrationSecret, newOAuthState, sha256Hex } from "./integrations/lightspeed";
import { oauthBrowserCookie, requireOAuthBrowser } from "./integrations/oauth-browser";
import { quarantineDocument } from "./document-ingest";
import { selectedSheetRange, sheetSnapshot, remoteFileId, type FileProvider, type LinkedSheetSnapshot } from "../domain/linked-files";

const origin = "https://vanteloq.com";
const seconds = () => Math.floor(Date.now() / 1000);
const scopes = { "google-files": "https://www.googleapis.com/auth/drive.readonly", "microsoft-files": "offline_access Files.Read" };
export type CloudConnection = { id: string; organization_id: string; user_id: string; auth_subject: string; provider: FileProvider; token_ciphertext: string | null; verifier_ciphertext: string; state_hash: string; status: string };
export type LinkedFile = { id: string; organization_id: string; user_id: string; connection_id: string; remote_id: string; sheet_name: string; name: string; kind: "sheet" | "document"; enabled: number; revision: string | null; snapshot_ciphertext: string | null; document_id: string | null; last_checked_at: number | null; last_changed_at: number | null; error_code: string | null };
type Tokens = { access: string; refresh: string; expires: number };
type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number | string };
type GoogleDriveFile = { id: string; name: string; mimeType: string; modifiedTime?: string; version?: string; trashed?: boolean };
type GoogleDriveList = { files?: GoogleDriveFile[]; nextPageToken?: string };
type MicrosoftDriveItem = { id: string; name: string; file?: { mimeType?: string }; folder?: { childCount?: number }; eTag?: string; lastModifiedDateTime?: string };
type MicrosoftDriveList = { value?: MicrosoftDriveItem[]; "@odata.nextLink"?: string };
type GoogleSheetsMetadata = { sheets?: { properties: { title: string } }[] };
type GoogleSheetsValues = { values?: unknown[][] };

export function cloudFileConfiguration(provider: FileProvider) {
  const env = getRuntimeEnv();
  const google = provider === "google-files";
  const clientId = google ? env.GOOGLE_FILES_CLIENT_ID || env.GOOGLE_MARKETING_CLIENT_ID : env.MICROSOFT_FILES_CLIENT_ID;
  const clientSecret = google ? env.GOOGLE_FILES_CLIENT_SECRET || env.GOOGLE_MARKETING_CLIENT_SECRET : env.MICROSOFT_FILES_CLIENT_SECRET;
  const enabled = (google ? env.GOOGLE_FILES_ENABLED : env.MICROSOFT_FILES_ENABLED) === "true";
  return { enabled, ready: enabled && Boolean(clientId && clientSecret && env.INTEGRATION_ENCRYPTION_KEY), clientId: clientId || "", clientSecret: clientSecret || "", redirectUri: `${origin}/api/v1/linked-files/${provider}/callback`, scopes: scopes[provider] };
}
function configured(provider: FileProvider) {
  const config = cloudFileConfiguration(provider);
  if (!config.ready) throw new ApiError(503, "FILE_CONNECTOR_SETUP_REQUIRED", "This file connection is coming soon. You can continue using file uploads.");
  return config;
}
async function bounded(response: Response, limit: number) {
  if (Number(response.headers.get("content-length")) > limit) { await response.body?.cancel(); throw new ApiError(413, "LINKED_FILE_TOO_LARGE", "Choose a smaller file or table."); }
  const reader = response.body?.getReader();
  if (!reader) throw new ApiError(502, "LINKED_FILE_EMPTY", "The provider returned no content.");
  const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > limit) { void reader.cancel(); throw new ApiError(413, "LINKED_FILE_TOO_LARGE", "Choose a smaller file or table."); } chunks.push(part.value); } } finally { reader.releaseLock(); }
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    await response.body?.cancel();
    throw new ApiError(response.status === 401 ? 409 : 502, response.status === 401 ? "FILE_RECONNECT_REQUIRED" : "FILE_PROVIDER_UNAVAILABLE", response.status === 401 ? "Reconnect your file account to continue." : "The provider could not read this file. Check its permissions and try again.");
  }
  const bytes = await bounded(response, 600_000);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}
function tokenUrl(provider: FileProvider) { return provider === "google-files" ? "https://oauth2.googleapis.com/token" : "https://login.microsoftonline.com/common/oauth2/v2.0/token"; }
async function requestTokens(provider: FileProvider, values: Record<string, string>, previousRefresh = ""): Promise<Tokens> {
  const config = configured(provider);
  const result = await json<TokenResponse>(await fetch(tokenUrl(provider), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...values }), redirect: "manual", signal: AbortSignal.timeout(20_000) }));
  if (typeof result.access_token !== "string" || !result.access_token || !(result.refresh_token || previousRefresh)) throw new ApiError(409, "FILE_RECONNECT_REQUIRED", "Connect again and allow continued file access.");
  return { access: result.access_token, refresh: result.refresh_token || previousRefresh, expires: seconds() + Math.max(30, Math.min(86400, Number(result.expires_in) || 3600)) };
}
export async function ownedCloudConnection(context: Pick<AccessContext, "organizationId" | "userId" | "authSubject">, id: string) {
  const row = await getD1().prepare("SELECT * FROM cloud_file_connections WHERE id=? AND organization_id=? AND user_id=? AND auth_subject=? AND status='connected'").bind(id, context.organizationId, context.userId, context.authSubject).first<CloudConnection>();
  if (!row) throw new ApiError(404, "FILE_CONNECTION_NOT_FOUND", "This file account is not connected to your workspace.");
  return row;
}
async function accessToken(connection: CloudConnection) {
  configured(connection.provider);
  if (!connection.token_ciphertext) throw new ApiError(409, "FILE_RECONNECT_REQUIRED", "Reconnect your file account.");
  const token = JSON.parse(await decryptIntegrationSecret(connection.token_ciphertext)) as Tokens;
  if (token.expires > seconds() + 60) return token.access;
  const next = await requestTokens(connection.provider, { grant_type: "refresh_token", refresh_token: token.refresh, ...(connection.provider === "microsoft-files" ? { scope: scopes[connection.provider] } : {}) }, token.refresh);
  const ciphertext = await encryptIntegrationSecret(JSON.stringify(next));
  const update = await getD1().prepare("UPDATE cloud_file_connections SET token_ciphertext=?,updated_at=? WHERE id=? AND organization_id=? AND status='connected' AND token_ciphertext=?").bind(ciphertext, seconds(), connection.id, connection.organization_id, connection.token_ciphertext).run();
  if (update.meta.changes !== 1) throw new ApiError(409, "FILE_CONNECTION_CHANGED", "The connection changed. Refresh this view before retrying.");
  connection.token_ciphertext = ciphertext;
  return next.access;
}
async function providerJson<T>(connection: CloudConnection, path: string, sheets = false): Promise<T> {
  const base = connection.provider === "google-files" ? sheets ? "https://sheets.googleapis.com/v4/" : "https://www.googleapis.com/drive/v3/" : "https://graph.microsoft.com/v1.0/";
  return json<T>(await fetch(base + path, { headers: { Authorization: `Bearer ${await accessToken(connection)}` }, redirect: "manual", signal: AbortSignal.timeout(20_000) }));
}
export async function beginCloudAuthorization(context: AccessContext, provider: FileProvider) {
  const config = configured(provider), now = seconds();
  await getD1().prepare("DELETE FROM cloud_file_connections WHERE user_id=? AND status='pending' AND state_expires_at<?").bind(context.userId, now).run();
  const count = await getD1().prepare("SELECT COUNT(*) count FROM cloud_file_connections WHERE organization_id=? AND user_id=? AND status IN ('pending','connected')").bind(context.organizationId, context.userId).first<{ count: number }>();
  if ((count?.count || 0) >= 6) throw new ApiError(409, "FILE_CONNECTION_LIMIT", "Disconnect an unused file account before adding another.");
  const state = newOAuthState(), verifier = newOAuthState();
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const challenge = btoa(String.fromCharCode(...digest)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const url = new URL(provider === "google-files" ? "https://accounts.google.com/o/oauth2/v2/auth" : "https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
  url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: "code", scope: config.scopes, state, code_challenge: challenge, code_challenge_method: "S256", ...(provider === "google-files" ? { access_type: "offline", prompt: "consent" } : { prompt: "select_account" }) }).toString();
  await getD1().prepare("INSERT INTO cloud_file_connections(id,organization_id,user_id,auth_subject,provider,state_hash,state_expires_at,verifier_ciphertext,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(), context.organizationId, context.userId, context.authSubject, provider, await sha256Hex(state), now + 600, await encryptIntegrationSecret(verifier), now, now).run();
  return { authorizationUrl: url.toString(), cookie: oauthBrowserCookie(provider, state) };
}
export async function finishCloudAuthorization(request: Request, provider: FileProvider) {
  const url = new URL(request.url), state = url.searchParams.get("state") || "", code = url.searchParams.get("code") || "";
  requireOAuthBrowser(request, provider, state);
  const now = seconds(), db = getD1();
  const row = await db.prepare(`SELECT c.* FROM cloud_file_connections c JOIN users u ON u.id=c.user_id JOIN memberships m ON m.user_id=u.id AND m.organization_id=c.organization_id WHERE c.state_hash=? AND c.provider=? AND c.status='pending' AND c.consumed_at IS NULL AND c.state_expires_at>? AND u.status='active' AND u.auth_subject=c.auth_subject AND m.status='active' AND m.role='owner' AND NOT EXISTS(SELECT 1 FROM account_deletion_jobs j WHERE j.stage IN('confirmed','local_deleted') AND (j.user_id=c.user_id OR (j.scope='workspace' AND j.organization_id=c.organization_id)))`).bind(await sha256Hex(state), provider, now).first<CloudConnection>();
  if (!row) throw new ApiError(400, "FILE_OAUTH_EXPIRED", "This connection request expired. Start it again from Vanteloq.");
  const claimed = await db.prepare("UPDATE cloud_file_connections SET consumed_at=? WHERE id=? AND consumed_at IS NULL AND status='pending'").bind(now, row.id).run();
  if (claimed.meta.changes !== 1) throw new ApiError(400, "FILE_OAUTH_USED", "This connection request was already used.");
  if (url.searchParams.has("error") || !code || code.length > 4096) throw new ApiError(400, "FILE_OAUTH_CANCELLED", "The file connection was not authorised.");
  const config = configured(provider), verifier = await decryptIntegrationSecret(row.verifier_ciphertext);
  const token = await requestTokens(provider, { grant_type: "authorization_code", code, redirect_uri: config.redirectUri, code_verifier: verifier });
  const updated = await db.prepare(`UPDATE cloud_file_connections SET token_ciphertext=?,verifier_ciphertext='',status='connected',updated_at=? WHERE id=? AND status='pending' AND EXISTS(SELECT 1 FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.id=cloud_file_connections.user_id AND u.status='active' AND u.auth_subject=cloud_file_connections.auth_subject AND m.organization_id=cloud_file_connections.organization_id AND m.status='active' AND m.role='owner') AND NOT EXISTS(SELECT 1 FROM account_deletion_jobs j WHERE j.stage IN('confirmed','local_deleted') AND (j.user_id=cloud_file_connections.user_id OR (j.scope='workspace' AND j.organization_id=cloud_file_connections.organization_id)))`).bind(await encryptIntegrationSecret(JSON.stringify(token)), now, row.id).run();
  if (updated.meta.changes !== 1) throw new ApiError(403, "FILE_AUTHORIZATION_CHANGED", "Workspace access changed during authorisation.");
  return new Response(null, { status: 303, headers: { Location: `${origin}/?linkedFiles=connected`, "Set-Cookie": oauthBrowserCookie(provider, state).replace("Max-Age=600", "Max-Age=0") } });
}
export async function listCloudFiles(connection: CloudConnection, folder = "", cursor = "") {
  if (folder) remoteFileId(folder);
  if (cursor.length > 2000) throw new ApiError(400, "FILE_CURSOR_INVALID", "Refresh the file list.");
  if (connection.provider === "google-files") {
    const query = new URLSearchParams({ pageSize: "50", fields: "nextPageToken,files(id,name,mimeType,modifiedTime)", q: `trashed=false and (mimeType='application/vnd.google-apps.spreadsheet' or mimeType='application/vnd.google-apps.document' or mimeType='application/vnd.google-apps.presentation' or mimeType='application/pdf')`, orderBy: "modifiedTime desc", ...(cursor ? { pageToken: cursor } : {}) });
    const result = await providerJson<GoogleDriveList>(connection, `files?${query}`);
    return { files: result.files || [], nextCursor: result.nextPageToken || "" };
  }
  // No arbitrary @odata.nextLink is accepted from the client.
  const result = await providerJson<MicrosoftDriveList>(connection, `me/drive/${folder ? `items/${encodeURIComponent(folder)}` : "root"}/children?$top=100&$select=id,name,file,folder,lastModifiedDateTime`);
  return { files: (result.value || []).filter(item => item.folder || /\.(xlsx?|pptx?|docx?|pdf)$/i.test(item.name || "")).map(item => ({ id: item.id, name: item.name, mimeType: item.folder ? "folder" : item.file?.mimeType, modifiedTime: item.lastModifiedDateTime })), nextCursor: "", limited: Boolean(result["@odata.nextLink"]) };
}
export async function cloudFileMetadata(connection: CloudConnection, remoteId: string) {
  remoteFileId(remoteId);
  if (connection.provider === "google-files") {
    const meta = await providerJson<GoogleDriveFile>(connection, `files/${encodeURIComponent(remoteId)}?fields=id,name,mimeType,version,modifiedTime,trashed`);
    if (meta.trashed) throw new ApiError(404, "LINKED_FILE_REMOVED", "This file is in the provider's trash.");
    const sheet = meta.mimeType === "application/vnd.google-apps.spreadsheet";
    if (!sheet && !["application/vnd.google-apps.document", "application/vnd.google-apps.presentation", "application/pdf"].includes(meta.mimeType)) throw new ApiError(400, "LINKED_FILE_UNSUPPORTED", "Choose a Google Sheet, Doc, Slide deck or PDF.");
    const tabs = sheet ? await providerJson<GoogleSheetsMetadata>(connection, `spreadsheets/${encodeURIComponent(remoteId)}?fields=sheets(properties(title))`, true) : null;
    return { id: remoteId, name: String(meta.name), kind: sheet ? "sheet" as const : "document" as const, mime: String(meta.mimeType), revision: String(meta.version || meta.modifiedTime), tabs: tabs?.sheets?.map(s => s.properties.title) || [] };
  }
  const meta = await providerJson<MicrosoftDriveItem>(connection, `me/drive/items/${encodeURIComponent(remoteId)}?$select=id,name,file,eTag,lastModifiedDateTime`);
  if (!/\.(xlsx?|pptx?|docx?|pdf)$/i.test(meta.name || "")) throw new ApiError(400, "LINKED_FILE_UNSUPPORTED", "Choose an Excel workbook, PowerPoint presentation, Word document or PDF.");
  return { id: remoteId, name: String(meta.name), kind: "document" as const, mime: String(meta.file?.mimeType), revision: String(meta.eTag || meta.lastModifiedDateTime), tabs: [] as string[] };
}
export function allowedMicrosoftDownload(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  return url.protocol === "https:" && !url.username && !url.password && !url.port && ["sharepoint.com", "1drv.com", "onedrive.com"].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
}
async function filePdf(connection: CloudConnection, remoteId: string, mime: string) {
  const google = connection.provider === "google-files";
  const path = google ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(remoteId)}${mime === "application/pdf" ? "?alt=media" : "/export?mimeType=application%2Fpdf"}` : `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(remoteId)}/content${mime === "application/pdf" ? "" : "?format=pdf"}`;
  let response = await fetch(path, { headers: { Authorization: `Bearer ${await accessToken(connection)}` }, redirect: "manual", signal: AbortSignal.timeout(25_000) });
  if (!google && [301,302,303,307,308].includes(response.status)) {
    const location = response.headers.get("location") || "";
    if (!allowedMicrosoftDownload(location)) throw new ApiError(502, "FILE_DOWNLOAD_UNVERIFIED", "The provider returned an unsupported download location.");
    response = await fetch(location, { redirect: "manual", signal: AbortSignal.timeout(25_000) });
  }
  if (!response.ok) throw new ApiError(502, "FILE_EXPORT_FAILED", "This file could not be exported to PDF. Check access or upload a PDF version.");
  return bounded(response, 10 * 1024 * 1024);
}
export function activeFileOwner(table: string) {
  return `EXISTS(SELECT 1 FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.id=${table}.user_id AND u.status='active' AND u.auth_subject=${table}.auth_subject AND m.organization_id=${table}.organization_id AND m.status='active' AND m.role='owner') AND NOT EXISTS(SELECT 1 FROM account_deletion_jobs j WHERE j.stage IN('confirmed','local_deleted') AND (j.user_id=${table}.user_id OR (j.scope='workspace' AND j.organization_id=${table}.organization_id)))`;
}
export async function refreshLinkedFile(context: AccessContext, file: LinkedFile) {
  const db = getD1(), now = seconds(), lease = crypto.randomUUID();
  const claim = await db.prepare("UPDATE linked_files SET lease=?,lease_expires_at=? WHERE id=? AND organization_id=? AND user_id=? AND enabled=1 AND lease_expires_at<=? AND (last_checked_at IS NULL OR last_checked_at<=?)").bind(lease, now+90, file.id, context.organizationId, context.userId, now, now-30).run();
  if (claim.meta.changes !== 1) return { coalesced: true };
  const guard = { sql: `EXISTS(SELECT 1 FROM linked_files l JOIN cloud_file_connections c ON c.id=l.connection_id WHERE l.id=? AND l.organization_id=? AND l.user_id=? AND l.enabled=1 AND l.lease=? AND c.status='connected' AND ${activeFileOwner("c")})`, values: [file.id, context.organizationId, context.userId, lease] };
  try {
    const connection = await ownedCloudConnection(context, file.connection_id), meta = await cloudFileMetadata(connection, file.remote_id);
    if (file.kind !== "sheet" && meta.revision === file.revision) { await db.prepare("UPDATE linked_files SET last_checked_at=?,name=?,error_code=NULL WHERE id=? AND lease=?").bind(now,meta.name,file.id,lease).run(); return { unchanged: true }; }
    let encrypted: string | null = null, documentId = file.document_id, revision = meta.revision;
    if (file.kind === "sheet") {
      if (!meta.tabs.includes(file.sheet_name)) throw new ApiError(409, "FILE_SHEET_CHANGED", "The selected sheet tab was renamed or removed. Link its new tab to continue.");
      const response = await providerJson<GoogleSheetsValues>(connection, `spreadsheets/${encodeURIComponent(file.remote_id)}/values/${encodeURIComponent(selectedSheetRange(file.sheet_name))}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`, true);
      let snapshot: LinkedSheetSnapshot;
      try { snapshot = sheetSnapshot(response.values || []); } catch (error) { throw new ApiError(422, "FILE_TABLE_INVALID", error instanceof Error ? error.message : "The table could not be read."); }
      revision = await sha256Hex(JSON.stringify(snapshot));
      if (revision === file.revision) { await db.prepare("UPDATE linked_files SET last_checked_at=?,name=?,error_code=NULL WHERE id=? AND lease=?").bind(now,meta.name,file.id,lease).run(); return { unchanged: true }; }
      encrypted = await encryptIntegrationSecret(JSON.stringify(snapshot));
    } else {
      const bytes = await filePdf(connection, file.remote_id, meta.mime);
      const stored = await quarantineDocument({ database: db, bucket: getR2(), organizationId: context.organizationId, authorizedByUserId: context.userId, bytes, fileName: `${meta.name.replace(/\.[^.]+$/, "")} · ${new Date().toISOString().slice(0,10)}.pdf`, contentType: "application/pdf", documentType: "other", guard });
      documentId = stored.id;
    }
    const result = await db.prepare(`UPDATE linked_files SET name=?,revision=?,snapshot_ciphertext=?,document_id=?,last_checked_at=?,last_changed_at=?,error_code=NULL,updated_at=? WHERE id=? AND lease=? AND enabled=1 AND EXISTS(SELECT 1 FROM cloud_file_connections c WHERE c.id=linked_files.connection_id AND c.status='connected' AND ${activeFileOwner("c")})`).bind(meta.name,revision,encrypted,documentId,now,now,now,file.id,lease).run();
    if (result.meta.changes !== 1) throw new ApiError(409,"FILE_CONNECTION_CHANGED","The linked file was paused or disconnected during refresh.");
    return { updated: true, documentId };
  } catch (error) {
    const code = error instanceof ApiError ? error.code : "FILE_REFRESH_FAILED";
    await db.prepare("UPDATE linked_files SET last_checked_at=?,error_code=? WHERE id=? AND lease=?").bind(now,code,file.id,lease).run();
    throw error;
  } finally { await db.prepare("UPDATE linked_files SET lease=NULL,lease_expires_at=0 WHERE id=? AND lease=?").bind(file.id,lease).run(); }
}
export async function revealFileSnapshot(file: LinkedFile): Promise<LinkedSheetSnapshot | null> {
  return file.snapshot_ciphertext ? JSON.parse(await decryptIntegrationSecret(file.snapshot_ciphertext)) : null;
}
