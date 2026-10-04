import { getD1 } from "../../../../db";
import { parseVehicleCsv, validateVehicle, vehicleExportCsv, type VehicleInput, type VehicleRecord } from "../../../../domain/vehicles";
import { businessClock } from "../../../../domain/intraday-sales";
import { requireAccess, type AccessContext } from "../../../../server/authorization";
import { ApiError, enforceRateLimit, handleApi, hashIdentifier, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../server/api";
import { effectivePermissions, requirePermission } from "../../../../server/permissions";
import { authorizedLocationScope, requireAccessibleLocation } from "../../../../server/location-access";
import { getTenantEntitlements } from "../../../../server/entitlements/engine";
import { recordAudit } from "../../../../server/audit";
import { getWorkspaceIndustry } from "../../../../server/industry-configuration";

const roles = ["owner", "admin", "manager", "employee", "read_only"] as const;
const fields = `v.id, v.location_id AS locationId, l.name AS locationName, v.identifier_kind AS identifierKind,
  v.identifier, v.model_year AS year, v.make, v.model, v.stock_number AS stockNumber, v.status,
  v.acquired_date AS acquiredDate, v.currency, v.acquisition_cents AS acquisitionCents,
  v.reconditioning_cents AS reconditioningCents, v.source, v.version, v.created_at AS createdAt, v.updated_at AS updatedAt`;
const join = "FROM inventory_vehicles v JOIN organization_locations l ON l.id=v.location_id AND l.organization_id=v.organization_id";
function boundedId(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim() || value.length > 200 || /[\u0000-\u0020\u007f]/.test(value)) throw new ApiError(400, "VEHICLE_INPUT_INVALID", `Choose a valid ${label}.`);
  return value;
}
function validate(input: unknown) {
  try { return validateVehicle(input); } catch (error) { throw new ApiError(400, "VEHICLE_INPUT_INVALID", error instanceof Error ? error.message : "Review this vehicle."); }
}
function publicRecord(row: VehicleRecord, costs: boolean) {
  return { ...row, acquisitionCents: costs ? row.acquisitionCents : null, reconditioningCents: costs ? row.reconditioningCents : null };
}
async function permissionContext(request: Request, write = false) {
  const context = await requireAccess(request, roles, "inventory.lots");
  if (!(await getWorkspaceIndustry(context)).configuration.capabilities.includes("vehicles")) throw new ApiError(403,"VEHICLE_INDUSTRY_REQUIRED","Vehicle records are available in a dealership workspace. An administrator can review the business type in Settings.");
  await requirePermission(context, "inventory.view");
  if (write) await requirePermission(context, "inventory.adjust");
  const permissions = await effectivePermissions(context);
  return { context, permissions, costs: permissions.includes("inventory.value") };
}
async function chosenLocation(context: AccessContext, locationId: unknown, entries: VehicleInput[]) {
  const location = await requireAccessibleLocation(context, boundedId(locationId, "location"));
  if (entries.some(row => row.currency !== location.currency)) throw new ApiError(400, "VEHICLE_CURRENCY_MISMATCH", "Use the selected location's currency for every vehicle cost.");
  const clock = businessClock(new Date(), location.timezone);
  if (!clock) throw new ApiError(503, "VEHICLE_DATE_UNAVAILABLE", "The location date is unavailable. Try again shortly.");
  if (entries.some(row => row.acquiredDate > clock.date)) throw new ApiError(400, "VEHICLE_ACQUISITION_DATE_INVALID", "The acquisition date cannot be after today in the selected location.");
  return location;
}
function requireCostAccess(entries: VehicleInput[], costs: boolean) {
  if (!costs && entries.some(row => row.acquisitionCents !== null || row.reconditioningCents !== null)) throw new ApiError(403, "VEHICLE_COST_PERMISSION_REQUIRED", "Inventory value permission is required to record vehicle costs.");
}
async function readRecord(organizationId: string, id: string) {
  return getD1().prepare(`SELECT ${fields} ${join} WHERE v.organization_id=? AND v.id=?`).bind(organizationId, id).first<VehicleRecord>();
}
async function ensureNew(context: AccessContext, entries: VehicleInput[]) {
  const matches = await getD1().prepare(`SELECT 1 FROM inventory_vehicles WHERE organization_id=? AND
    (identifier IN (SELECT json_extract(value,'$.identifier') FROM json_each(?)) OR stock_number IN (SELECT json_extract(value,'$.stockNumber') FROM json_each(?))) LIMIT 1`)
    .bind(context.organizationId, JSON.stringify(entries.map(({ identifier }) => ({ identifier }))), JSON.stringify(entries.map(({ stockNumber }) => ({ stockNumber })))).first();
  if (matches) throw new ApiError(409, "VEHICLE_DUPLICATE", "A vehicle identifier or stock number is already used in this workspace. Review the existing record or use a different stock number.");
}
function duplicate(error: unknown): never {
  if (/unique constraint/i.test(error instanceof Error ? error.message : String(error))) throw new ApiError(409, "VEHICLE_DUPLICATE", "A vehicle identifier or stock number is already used in this workspace. No duplicate record was saved.");
  throw error;
}

export async function GET(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    const { context, permissions, costs } = await permissionContext(request);
    await enforceRateLimit("vehicles:read", context.userId, 90, 60);
    const params = new URL(request.url).searchParams;
    const scope = await authorizedLocationScope(context, params.get("locationId"));
    const locationIds = scope.locationIds ?? scope.locations.map(location => location.id);
    const exportCsv = params.get("format") === "csv";
    const canExport = permissions.includes("reports.export") && (await getTenantEntitlements(context)).features.includes("reporting.exports");
    if (exportCsv && !canExport) throw new ApiError(403, "VEHICLE_EXPORT_FORBIDDEN", "Your plan and permissions must allow report exports.");
    const cursor = params.get("after");
    if (cursor) boundedId(cursor, "record cursor");
    const limit = exportCsv ? 5001 : 101;
    const rows = locationIds.length ? (await getD1().prepare(`SELECT ${fields} ${join} WHERE v.organization_id=? AND v.location_id IN (SELECT value FROM json_each(?)) ${cursor && !exportCsv ? "AND v.id>?" : ""} ORDER BY v.id LIMIT ?`)
      .bind(context.organizationId, JSON.stringify(locationIds), ...(cursor && !exportCsv ? [cursor] : []), limit).all<VehicleRecord>()).results ?? [] : [];
    if (exportCsv) {
      if (rows.length > 5000) throw new ApiError(413, "VEHICLE_EXPORT_LIMIT", "Choose a location with at most 5,000 vehicles to export.");
      await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId, action: "inventory.vehicles_exported", resourceType: "inventory_vehicle", details: { rows: rows.length, includesCosts: costs } });
      return new Response(vehicleExportCsv(rows, costs), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="vehicle-inventory.csv"', "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" } });
    }
    return jsonResponse({ vehicles: rows.slice(0, 100).map(row => publicRecord(row, costs)), nextCursor: rows.length > 100 ? rows[99].id : null,
      locations: scope.locations.map(location => ({ id: location.id, name: location.name, currency: location.currency })),
      permissions: { edit: permissions.includes("inventory.adjust"), import: permissions.includes("inventory.adjust") && permissions.includes("data.import"), costs, export: canExport },
      source: "User-recorded vehicle inventory. Identifiers are structurally validated, not decoded or independently verified. Costs do not post to BookLoQ or forecasts." });
  });
}

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const { context, costs } = await permissionContext(request, true);
    await enforceRateLimit("vehicles:write", context.userId, 40, 3600);
    const body = await readJsonObject(request, 120_000);
    const action = body.action;
    if (action !== "create" && action !== "preview" && action !== "confirm") throw new ApiError(400, "VEHICLE_ACTION_INVALID", "Choose manual entry or preview and confirm a CSV.");
    const csv = action !== "create";
    if (csv) await requirePermission(context, "data.import");
    let entries: VehicleInput[];
    if (csv) {
      if (typeof body.csv !== "string") throw new ApiError(400, "VEHICLE_CSV_REQUIRED", "Choose a vehicle CSV.");
      try { entries = parseVehicleCsv(body.csv); } catch (error) { throw new ApiError(400, "VEHICLE_CSV_INVALID", error instanceof Error ? error.message : "Review the CSV."); }
    } else entries = [validate(body.vehicle)];
    requireCostAccess(entries, costs);
    const location = await chosenLocation(context, body.locationId, entries);
    const fingerprint = await hashIdentifier(JSON.stringify(["vehicle-import-v1", context.organizationId, context.userId, location.id, entries]));
    await ensureNew(context, entries);
    if (action === "preview") return jsonResponse({ entries, fingerprint, location: { id: location.id, name: location.name }, count: entries.length });
    if (action === "confirm" && body.fingerprint !== fingerprint) throw new ApiError(409, "VEHICLE_PREVIEW_CHANGED", "Preview the current file and selected location again before confirming.");
    const now = Date.now(), ids = entries.map(() => crypto.randomUUID());
    try {
      await getD1().batch(entries.map((row, index) => getD1().prepare(`INSERT INTO inventory_vehicles
        (id,organization_id,location_id,identifier_kind,identifier,model_year,make,model,stock_number,status,acquired_date,currency,acquisition_cents,reconditioning_cents,source,version,created_by,updated_by,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)`).bind(ids[index], context.organizationId, location.id, row.identifierKind, row.identifier, row.year, row.make, row.model, row.stockNumber, row.status, row.acquiredDate, row.currency, row.acquisitionCents, row.reconditioningCents, csv ? "csv" : "manual", context.userId, context.userId, now, now)));
    } catch (error) { duplicate(error); }
    await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId, action: csv ? "inventory.vehicles_imported" : "inventory.vehicle_created", resourceType: "inventory_vehicle", details: { rows: entries.length, source: csv ? "csv" : "manual" } });
    return jsonResponse({ saved: entries.length, ids }, { status: 201 });
  });
}

export async function PATCH(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const { context, costs } = await permissionContext(request, true);
    await enforceRateLimit("vehicles:write", context.userId, 40, 3600);
    const body = await readJsonObject(request, 8_000);
    const id = boundedId(body.id, "vehicle");
    if (!Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion) < 1) throw new ApiError(400, "VEHICLE_VERSION_REQUIRED", "Refresh this vehicle before editing.");
    const current = await readRecord(context.organizationId, id);
    if (!current) throw new ApiError(404, "VEHICLE_NOT_FOUND", "This vehicle is not available.");
    await requireAccessibleLocation(context, current.locationId);
    const input = validate(body.vehicle);
    requireCostAccess([input], costs);
    const location = await chosenLocation(context, body.locationId, [input]);
    if (!costs && location.currency !== current.currency) throw new ApiError(403, "VEHICLE_COST_PERMISSION_REQUIRED", "Inventory value permission is required to change this record's currency.");
    // A user without cost permission can edit stock metadata without erasing hidden costs.
    if (!costs) { input.acquisitionCents = current.acquisitionCents; input.reconditioningCents = current.reconditioningCents; }
    if (location.currency !== current.currency && (current.acquisitionCents !== null || current.reconditioningCents !== null)) throw new ApiError(409, "VEHICLE_CURRENCY_TRANSFER", "Clear the recorded costs in the original currency before moving this record to a different currency. No automatic conversion is performed.");
    let saved: { id: string } | null;
    try {
      saved = await getD1().prepare(`UPDATE inventory_vehicles SET location_id=?,identifier_kind=?,identifier=?,model_year=?,make=?,model=?,stock_number=?,status=?,acquired_date=?,currency=?,acquisition_cents=?,reconditioning_cents=?,version=version+1,updated_by=?,updated_at=?
        WHERE id=? AND organization_id=? AND location_id=? AND version=? RETURNING id`)
        .bind(location.id, input.identifierKind, input.identifier, input.year, input.make, input.model, input.stockNumber, input.status, input.acquiredDate, input.currency, input.acquisitionCents, input.reconditioningCents, context.userId, Date.now(), id, context.organizationId, current.locationId, body.expectedVersion).first<{ id: string }>();
    } catch (error) { duplicate(error); }
    if (!saved) throw new ApiError(409, "VEHICLE_VERSION_CONFLICT", "This vehicle changed while you were editing. Reload its latest values before saving.");
    await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId, action: "inventory.vehicle_updated", resourceType: "inventory_vehicle", resourceId: id, details: { previousVersion: Number(body.expectedVersion) } });
    return jsonResponse({ saved: true, version: Number(body.expectedVersion) + 1 });
  });
}
