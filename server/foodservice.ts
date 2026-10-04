import { getD1 } from "../db";
import { foodserviceRecordReport, validateFoodserviceContent, FoodserviceInputError, type FoodSavedRecord } from "../domain/foodservice";
import { businessClock } from "../domain/intraday-sales";
import { ApiError } from "./api";
import { requireAccess, type AccessContext } from "./authorization";
import { effectivePermissions, requirePermission } from "./permissions";
import { accessibleLocations, requireAccessibleLocation } from "./location-access";
import { getWorkspaceIndustry } from "./industry-configuration";

const roles = ["owner", "admin", "manager", "employee", "read_only"] as const;
export async function foodserviceAccess(request: Request) {
  const context = await requireAccess(request, roles, "inventory.lots");
  const industry = await getWorkspaceIndustry(context);
  if (!industry.configuration.capabilities.includes("food_costing")) throw new ApiError(403, "FOODSERVICE_INDUSTRY", "Enable Recipe and food costs in Settings → Business type & tools before using this activity.");
  await requirePermission(context, "inventory.view"); await requirePermission(context, "inventory.value");
  const permissions = await effectivePermissions(context);
  const periodRead = ["metrics.revenue", "metrics.profit", "payroll.totals"].every(p => permissions.includes(p as typeof permissions[number]));
  return { context, permissions: { recipeWrite: permissions.includes("inventory.adjust"), periodRead, periodWrite: periodRead && permissions.includes("inventory.adjust") && permissions.includes("payroll.edit") } };
}
type Row = { id: string; locationId: string; currency: string; kind: "recipe" | "period"; name: string; source: string; asOfDate: string; from: string; to: string; payloadJson: string; version: number; updatedAt: number };
const columns = "id, location_id AS locationId, currency, kind, name, source_label AS source, as_of_date AS asOfDate, period_from AS `from`, period_to AS `to`, payload_json AS payloadJson, version, updated_at AS updatedAt";
function dto(row: Row): FoodSavedRecord {
  const content = validateFoodserviceContent({ ...row, payload: JSON.parse(row.payloadJson) });
  return { ...content, id: row.id, locationId: row.locationId, version: row.version, updatedAt: row.updatedAt };
}
export function foodserviceId(value: unknown) {
  if (typeof value !== "string" || !value || value.length > 200 || /[\u0000-\u0020\u007f]/.test(value)) throw new ApiError(400, "FOODSERVICE_ID", "Choose a valid saved record or location.");
  return value;
}
export async function readFoodservice(context: AccessContext, periodRead: boolean, requested: string | null) {
  const all = await accessibleLocations(context);
  const location = requested ? await requireAccessibleLocation(context, foodserviceId(requested)) : all.length === 1 ? all[0] : null;
  // Require one explicit location. No cross-currency or cross-location aggregate is returned.
  const rows = location ? await getD1().prepare(`SELECT ${columns} FROM foodservice_records WHERE organization_id=? AND location_id=? ${periodRead ? "" : "AND kind='recipe'"} ORDER BY updated_at DESC,id DESC LIMIT 201`).bind(context.organizationId, location.id).all<Row>() : { results: [] };
  const records = (rows.results ?? []).slice(0, 200).map(dto);
  return { locations: all.map(l => ({ id: l.id, name: l.name, currency: l.currency, timezone: l.timezone })), locationId: location?.id ?? null, records: records.map(record => ({ ...record, report: foodserviceRecordReport(record) })), truncated: (rows.results ?? []).length > 200 };
}
export async function saveFoodservice(context: AccessContext, permissions: { recipeWrite: boolean; periodWrite: boolean }, body: Record<string, unknown>) {
  if (body.reviewed !== true) throw new ApiError(400, "FOODSERVICE_REVIEW", "Review the quantities, costs, source and dates before saving.");
  let content;
  try { content = validateFoodserviceContent(body.record); }
  catch (error) { if (error instanceof FoodserviceInputError) throw new ApiError(400, "FOODSERVICE_INPUT", error.message); throw error; }
  if (!permissions[content.kind === "recipe" ? "recipeWrite" : "periodWrite"]) throw new ApiError(403, "FOODSERVICE_PERMISSION", "You do not have permission to save these cost records.");
  const locationId = foodserviceId(body.locationId), location = await requireAccessibleLocation(context, locationId);
  if (content.payload.currency !== location.currency) throw new ApiError(400, "FOODSERVICE_CURRENCY", "Use the selected location's currency.");
  const today = businessClock(new Date(), location.timezone)?.date;
  if (!today) throw new ApiError(503, "FOODSERVICE_DATE", "The location's reporting date is unavailable.");
  if (content.asOfDate > today) throw new ApiError(400, "FOODSERVICE_DATE", "The source date cannot be in the future at this location.");
  const id = body.id == null ? crypto.randomUUID() : foodserviceId(body.id), db = getD1(), now = Date.now();
  const prior = body.id == null ? null : await db.prepare(`SELECT ${columns} FROM foodservice_records WHERE organization_id=? AND id=?`).bind(context.organizationId, id).first<Row>();
  if (body.id != null && !prior) throw new ApiError(404, "FOODSERVICE_MISSING", "The saved record was not found.");
  if (prior) {
    await requireAccessibleLocation(context, prior.locationId);
    if (prior.locationId !== locationId || prior.kind !== content.kind || prior.currency !== content.payload.currency) throw new ApiError(409, "FOODSERVICE_SCOPE", "A saved record's location, currency and type cannot be changed.");
  }
  if (body.expectedVersion !== (prior?.version ?? null)) throw new ApiError(409, "FOODSERVICE_CONFLICT", "This record changed. Reload and review the latest version before saving.");
  const recordKey = content.kind === "recipe" ? content.name.toLowerCase() : `${content.from}:${content.to}`;
  try {
    const update = prior ? db.prepare(`UPDATE foodservice_records SET record_key=?,name=?,source_label=?,as_of_date=?,period_from=?,period_to=?,payload_json=?,version=version+1,updated_by=?,updated_at=? WHERE organization_id=? AND location_id=? AND id=? AND version=?`)
      .bind(recordKey, content.name, content.source, content.asOfDate, content.from, content.to, JSON.stringify(content.payload), context.userId, now, context.organizationId, locationId, id, prior.version)
      : db.prepare(`INSERT INTO foodservice_records(id,organization_id,location_id,kind,record_key,name,currency,source_label,as_of_date,period_from,period_to,payload_json,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(id, context.organizationId, locationId, content.kind, recordKey, content.name, location.currency, content.source, content.asOfDate, content.from, content.to, JSON.stringify(content.payload), context.userId, context.userId, now, now);
    const retain = (version:number) => db.prepare(`INSERT OR IGNORE INTO foodservice_revisions(id,record_id,organization_id,version,content_json,recorded_by,recorded_at)
      SELECT ?,id,organization_id,version,json_object('kind',kind,'name',name,'source',source_label,'asOfDate',as_of_date,'from',period_from,'to',period_to,'payload',json(payload_json)),updated_by,updated_at
      FROM foodservice_records WHERE organization_id=? AND id=? AND version=?`).bind(`${id}:v${version}`,context.organizationId,id,version);
    // Snapshot actual persisted rows in the same transaction as the guarded update.
    // A losing writer cannot invent or replace an already retained revision.
    const results = await db.batch([...(prior ? [retain(prior.version)] : []), update, retain((prior?.version ?? 0)+1)]);
    if (results[prior ? 1 : 0].meta.changes !== 1) throw new ApiError(409, "FOODSERVICE_CONFLICT", "The record changed. Reload before saving.");
  } catch (error) {
    if (/unique constraint/i.test(String(error))) throw new ApiError(409, "FOODSERVICE_DUPLICATE", "A recipe with this name or this exact review period already exists here. Reload and edit that record.");
    throw error;
  }
  return { ...content, id, locationId, version: (prior?.version ?? 0) + 1, updatedAt: now, report: foodserviceRecordReport(content) };
}

export async function readFoodserviceHistory(context: AccessContext, periodRead: boolean, recordId: string) {
  const row = await getD1().prepare(`SELECT ${columns} FROM foodservice_records WHERE organization_id=? AND id=?`).bind(context.organizationId, foodserviceId(recordId)).first<Row>();
  if (!row) throw new ApiError(404, "FOODSERVICE_MISSING", "The saved record was not found.");
  await requireAccessibleLocation(context, row.locationId);
  if (row.kind === "period" && !periodRead) throw new ApiError(403, "FOODSERVICE_PERMISSION", "You do not have access to this period's financial records.");
  const history = await getD1().prepare("SELECT version,content_json content,recorded_at recordedAt FROM foodservice_revisions WHERE organization_id=? AND record_id=? ORDER BY version DESC LIMIT 101")
    .bind(context.organizationId, row.id).all<{version:number;content:string;recordedAt:number}>();
  return { recordId: row.id, currentVersion: row.version, truncated: (history.results ?? []).length > 100,
    revisions: (history.results ?? []).slice(0,100).map(item => { const record=validateFoodserviceContent(JSON.parse(item.content)); return {version:item.version, recordedAt:item.recordedAt, record, report:foodserviceRecordReport(record)}; }),
    note: "Retained reviewed snapshots. Older overwritten versions cannot be reconstructed. Source as-of dates are evidence dates, not proof of historical sales consumption." };
}
