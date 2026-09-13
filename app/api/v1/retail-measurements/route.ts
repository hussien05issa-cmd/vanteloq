import { getD1 } from "../../../../db";
import { requireAccess } from "../../../../server/authorization";
import { ApiError, handleApi, jsonResponse, enforceRateLimit, readJsonObject, requireSameOrigin } from "../../../../server/api";
import { effectivePermissions, requirePermission } from "../../../../server/permissions";
import { requireOrganizationWideLocationAccess } from "../../../../server/location-access";
import { retailAccess, retailOutlets, retailPeriod, readRetailMeasurements } from "../../../../server/retail-intelligence";
import { measurementTemplates, parseMeasurementCsv, type MeasurementKind } from "../../../../domain/retail-measurements";
import { recordAudit } from "../../../../server/audit";
import type { AccessContext } from "../../../../server/authorization";

const roles = ["owner", "admin", "manager"] as const;
function kindOf(value: unknown): MeasurementKind {
  if (typeof value !== "string" || !Object.hasOwn(measurementTemplates, value)) throw new ApiError(400, "RETAIL_INPUT_KIND", "Choose inventory, labour, loyalty or product labels.");
  return value as MeasurementKind;
}
async function authorizeKind(context: AccessContext, kind: MeasurementKind) {
  await requirePermission(context, "data.import");
  const access = await retailAccess(context);
  const permissions = await effectivePermissions(context);
  if (kind === "labour") { await requirePermission(context, "payroll.edit"); if (!access.labour) throw new ApiError(403, "RETAIL_LABOUR_ACCESS", "Payroll totals access is required."); }
  if (kind === "stock" || kind === "catalog") { await requirePermission(context, "inventory.adjust"); if (!access.inventory) throw new ApiError(403, "RETAIL_INVENTORY_ACCESS", "Inventory access is required."); }
  if (kind === "stock" && !access.costs) throw new ApiError(403, "RETAIL_COST_ACCESS", "Inventory cost access is required to review stock evidence.");
  if (kind === "loyalty" && (!access.customers || !permissions.includes("customers.identity"))) throw new ApiError(403, "RETAIL_CUSTOMER_ACCESS", "Customer identity and analytics access is required to review enrollment evidence.");
  if (kind === "catalog" || kind === "loyalty") await requireOrganizationWideLocationAccess(context);
  return access;
}
export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, roles, "analytics.sales.basic");
    const url = new URL(request.url), kind = kindOf(url.searchParams.get("kind"));
    const access = await authorizeKind(context, kind);
    const locationId = url.searchParams.get("location");
    const [outlets, records] = await Promise.all([retailOutlets(context, locationId), readRetailMeasurements(context, locationId, access)]);
    const choices = kind === "catalog" || kind === "loyalty"
      ? [...new Map(outlets.map(row => [row.connectionId, { ...row, outletRef: "", label: row.provider + " · " + row.connectionId.slice(-8) }])).values()]
      : kind === "labour" ? [...new Map([...outlets].reverse().map(row => [row.locationId, { ...row, label: row.label + " · all approved feeds at this location" }])).values()] : outlets;
    return jsonResponse({ choices, datasets: records.filter(row => row.kind === kind).map(({ valuesJson: _values, ...row }) => { void _values; return row; }) });
  });
}
export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, roles, "analytics.sales.basic");
    await enforceRateLimit("retail-measurements:write", context.userId, 30, 3600);
    const body = await readJsonObject(request, 120_000), kind = kindOf(body.kind);
    await authorizeKind(context, kind);
    if (!["save", "delete"].includes(String(body.action))) throw new ApiError(400, "RETAIL_INPUT_ACTION", "Choose save or delete.");
    if (body.reviewed !== true) throw new ApiError(400, "RETAIL_INPUT_REVIEW", "Review the source, period and replacement before saving.");
    const period = retailPeriod(typeof body.from === "string" ? body.from : null, typeof body.to === "string" ? body.to : null, context.organization.timezone);
    const global = kind === "catalog" || kind === "loyalty", from = global ? "" : period.from, to = global ? "" : period.to;
    const locationId = typeof body.locationId === "string" ? body.locationId : null;
    const outlets = await retailOutlets(context, locationId);
    const chosen = outlets.find(row => row.provider === body.provider && row.connectionId === body.connectionId && (global || row.outletRef === body.outletRef));
    if (!chosen) throw new ApiError(403, "RETAIL_INPUT_SOURCE", "Choose an approved, mapped source in an accessible location.");
    if (kind === "labour" && (outlets.find(row => row.locationId === chosen.locationId)?.connectionId !== chosen.connectionId || outlets.find(row => row.locationId === chosen.locationId)?.outletRef !== chosen.outletRef)) throw new ApiError(409, "RETAIL_LABOUR_SOURCE", "Use the first source offered for this physical location so paid hours are recorded only once.");
    const outlet = global ? "" : chosen.outletRef;
    if (body.expectedVersion != null && (!Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion) < 1)) throw new ApiError(400, "RETAIL_INPUT_VERSION", "Reload the saved evidence before editing.");
    const db = getD1();
    const prior = await db.prepare(`SELECT id, version FROM retail_measurements WHERE organization_id=? AND connection_id=? AND outlet_ref=? AND kind=? AND reference='dataset' AND period_from=? AND period_to=?`)
      .bind(context.organizationId, chosen.connectionId, outlet, kind, from, to).first<{ id: string; version: number }>();
    if ((prior?.version ?? null) !== (body.expectedVersion ?? null)) throw new ApiError(409, "RETAIL_INPUT_CONFLICT", "Another person changed this evidence. Reload it and review their changes.");
    if (body.action === "delete") {
      if (!prior) throw new ApiError(404, "RETAIL_INPUT_MISSING", "This dataset no longer exists.");
      const result = await db.prepare("DELETE FROM retail_measurements WHERE organization_id=? AND id=? AND version=?").bind(context.organizationId, prior.id, prior.version).run();
      if (result.meta.changes !== 1) throw new ApiError(409, "RETAIL_INPUT_CONFLICT", "The dataset changed. Reload before deleting.");
      await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId, action: "retail.evidence_deleted", resourceType: "retail_measurement", resourceId: prior.id, details: { kind, from, to } });
      return jsonResponse({ deleted: true });
    }
    const source = typeof body.source === "string" ? body.source.trim().normalize("NFC") : "";
    if (!source || source.length > 120 || /[\u0000-\u001f\u007f]/.test(source)) throw new ApiError(400, "RETAIL_INPUT_SOURCE_LABEL", "Name the source record using 1 to 120 characters.");
    let entries;
    try { entries = parseMeasurementCsv(kind, typeof body.csv === "string" ? body.csv : ""); }
    catch (error) { throw new ApiError(400, "RETAIL_INPUT_INVALID", error instanceof Error ? error.message : "Review the CSV."); }
    if (kind === "catalog") {
      // A SKU is convenient for merchants, but is accepted only when it resolves
      // unambiguously to one product inside this exact source account.
      const matches = new Map(entries.map(row => [row.reference, new Set<string>()]));
      for (let offset = 0; offset < entries.length; offset += 40) {
        const chunk = entries.slice(offset, offset + 40), placeholders = chunk.map(() => "?").join(",");
        const refs = await db.prepare(`SELECT external_product_id AS reference, sku FROM commerce_products WHERE organization_id=? AND connection_id=? AND provider=? AND archived=0 AND (external_product_id IN (${placeholders}) OR sku IN (${placeholders}))`)
          .bind(context.organizationId, chosen.connectionId, chosen.provider, ...chunk.map(row => row.reference), ...chunk.map(row => row.reference)).all<{ reference: string; sku: string | null }>();
        for (const row of refs.results ?? []) { matches.get(row.reference)?.add(row.reference); if (row.sku) matches.get(row.sku)?.add(row.reference); }
      }
      if ([...matches.values()].some(ids => ids.size !== 1)) throw new ApiError(400, "RETAIL_INPUT_REFERENCE", "A product reference or SKU is missing or ambiguous in this source. Use its exact product reference.");
      entries = entries.map(row => ({ ...row, reference: [...matches.get(row.reference)!][0] }));
      if (new Set(entries.map(row => row.reference)).size !== entries.length) throw new ApiError(400, "RETAIL_INPUT_REFERENCE", "Two rows resolve to the same product. Keep one reviewed row per product.");
    } else if (kind !== "labour") {
      const table = kind === "stock" ? "inventory_balances" : "commerce_customers";
      const column = kind === "stock" ? "sku" : "external_customer_id";
      const connectionColumn = kind === "stock" ? "source_connection_id" : "connection_id";
      const providerColumn = kind === "stock" ? "source_provider" : "provider";
      const found = new Set<string>();
      for (let offset = 0; offset < entries.length; offset += 75) {
        const chunk = entries.slice(offset, offset + 75);
        const refs = await db.prepare(`SELECT ${column} AS reference FROM ${table} WHERE organization_id=? AND ${connectionColumn}=? AND ${providerColumn}=?
          ${kind === "stock" ? "AND location_ref=?" : ""} AND ${column} IN (${chunk.map(() => "?").join(",")})`)
          .bind(context.organizationId, chosen.connectionId, chosen.provider, ...(kind === "stock" ? [chosen.provider + ":" + outlet] : []), ...chunk.map(row => row.reference)).all<{ reference: string }>();
        for (const row of refs.results ?? []) found.add(row.reference);
      }
      const missing = entries.find(row => !found.has(row.reference));
      if (missing) throw new ApiError(400, "RETAIL_INPUT_REFERENCE", "A reference does not match a record in the selected source. Check the exact SKU, product or customer reference.");
    }
    const id = prior?.id ?? crypto.randomUUID(), now = Date.now();
    try {
      const result = prior ? await db.prepare(`UPDATE retail_measurements SET values_json=?, source_label=?, updated_by_user_id=?, updated_at=?, version=version+1 WHERE organization_id=? AND id=? AND version=?`)
        .bind(JSON.stringify(entries), source, context.userId, now, context.organizationId, id, prior.version).run()
        : await db.prepare(`INSERT INTO retail_measurements (id, organization_id, connection_id, provider, outlet_ref, kind, reference, period_from, period_to, source_label, values_json, updated_by_user_id, updated_at)
          VALUES (?,?,?,?,?,?,'dataset',?,?,?,?,?,?)`).bind(id, context.organizationId, chosen.connectionId, chosen.provider, outlet, kind, from, to, source, JSON.stringify(entries), context.userId, now).run();
      if (result.meta.changes !== 1) throw new ApiError(409, "RETAIL_INPUT_CONFLICT", "The dataset changed. Reload before saving.");
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (String(error).includes("UNIQUE")) throw new ApiError(409, "RETAIL_INPUT_CONFLICT", "Another person saved evidence here. Reload before replacing it.");
      throw error;
    }
    await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId, action: "retail.evidence_saved", resourceType: "retail_measurement", resourceId: id, details: { kind, from, to, rows: entries.length, version: (prior?.version ?? 0) + 1 } });
    return jsonResponse({ saved: true, rows: entries.length, version: (prior?.version ?? 0) + 1 });
  });
}
