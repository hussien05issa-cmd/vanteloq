import { getD1 } from "../db";
import type { AccessContext } from "./authorization";
import { ApiError, hashIdentifier } from "./api";
import { authorizedLocationScope, requireAccessibleLocation } from "./location-access";
import { getTenantEntitlements } from "./entitlements/engine";
import { businessClock } from "../domain/intraday-sales";
import {
  DEALERSHIP_APPOINTMENT_STATUSES, DEALERSHIP_BOUNDARY, DEALERSHIP_COST_CATEGORIES, DEALERSHIP_LEAD_STAGES,
  DEALERSHIP_PHYSICAL_STATUSES, DEALERSHIP_PREP_STATUSES, DEALERSHIP_TASK_STATUSES,
  allocateDealershipAmount, dealershipCents, dealershipDate, dealershipEnum, dealershipId, dealershipInstant,
  dealershipText, dealershipVersion, parseDealershipCsv, requireDealershipCurrency, validateDealershipAcquire, validateDealershipCredits,
  type DealershipAcquire, type DealershipAttentionTask, type DealershipAppointment, type DealershipCost, type DealershipCredit, type DealershipDashboard,
  type DealershipLead, type DealershipPermissions, type DealershipSale, type DealershipStock, type DealershipSummaryCurrency, type DealershipTask,
} from "../domain/dealership";

const db = () => getD1();
const statement = (sql: string, values: unknown[] = []) => db().prepare(sql).bind(...values);
const all = async <T>(sql: string, values: unknown[] = []) => (await statement(sql, values).all<T>()).results ?? [];
const stockFields = `s.id,s.vehicle_id AS vehicleId,s.version,s.location_id AS locationId,s.location_name AS locationName,
 v.identifier_kind AS identifierKind,v.identifier,v.model_year AS year,v.make,v.model,s.stock_number AS stockNumber,s.currency,s.acquired_date AS acquiredDate,
 s.ownership,s.physical_status AS physicalStatus,s.prep_status AS prepStatus,s.availability,s.asking_cents AS askingCents,
 s.cost_complete AS costComplete,s.source,s.legacy_incomplete AS legacyIncomplete,
 (SELECT sum(c.amount_cents) FROM dealership_cost_lines c WHERE c.organization_id=s.organization_id AND c.episode_id=s.id AND c.status='posted') AS postedCostCents,
 (SELECT r.id FROM dealership_reservations r WHERE r.organization_id=s.organization_id AND r.episode_id=s.id AND r.status='active') AS reservationId,
 (SELECT r.expires_at FROM dealership_reservations r WHERE r.organization_id=s.organization_id AND r.episode_id=s.id AND r.status='active') AS reservationExpiresAt`;
const stockJoin = "FROM dealership_stock_episodes s JOIN dealership_vehicle_identities v ON v.id=s.vehicle_id AND v.organization_id=s.organization_id";
const leadFields = "id,location_id AS locationId,customer_name AS customerName,contact,stage,assignee_id AS assigneeId,next_action_date AS nextActionDate,version";

export async function dealershipPermissions(context: AccessContext, permissions: readonly string[]): Promise<DealershipPermissions> {
  const has = (...keys: string[]) => keys.every(key => permissions.includes(key));
  const features = (await getTenantEntitlements(context)).features;
  const sales = has("sales.transactions", "metrics.revenue") && features.includes("analytics.sales.basic");
  return { stockEdit: has("inventory.adjust"), import: has("inventory.adjust", "data.import"), export: has("reports.export") && features.includes("reporting.exports"), costs: has("inventory.value"),
    profit: sales && has("inventory.value", "metrics.profit") && features.includes("products.margin"),
    costEdit: has("inventory.value", "inventory.adjust"), costApprove: has("inventory.value", "inventory.adjust", "operations.manage"), tasks: has("operations.tasks"), tasksEdit: has("operations.tasks", "operations.manage"),
    sales, salesEdit: sales && has("inventory.adjust", "operations.manage"), customers: has("customers.identity"), customersEdit: has("customers.identity", "operations.manage") };
}
function permitted(value: boolean) { if (!value) throw new ApiError(403, "DEALERSHIP_PERMISSION_REQUIRED", "Your permissions do not allow this dealership action."); }
function notFound(): never { throw new ApiError(404, "DEALERSHIP_RECORD_UNAVAILABLE", "This dealership record is not available in your location scope."); }
async function stock(context: AccessContext, id: unknown) {
  const row = await statement(`SELECT ${stockFields},s.is_active AS isActive ${stockJoin} WHERE s.organization_id=? AND s.id=?`, [context.organizationId, dealershipId(id, "stock record")]).first<DealershipStock & { isActive: number }>();
  if (!row) notFound();
  await requireAccessibleLocation(context, row.locationId);
  return row;
}
async function lead(context: AccessContext, id: unknown) {
  const row = await statement(`SELECT ${leadFields} FROM dealership_leads WHERE organization_id=? AND id=?`, [context.organizationId, dealershipId(id, "lead")]).first<DealershipLead>();
  if (!row) notFound();
  await requireAccessibleLocation(context, row.locationId);
  return row;
}
async function person(context: AccessContext, value: unknown): Promise<{ id: string; name: string } | null> {
  if (value === null || value === undefined || value === "") return null;
  const id = dealershipId(value, "person");
  const row = await statement("SELECT u.id,u.display_name AS name FROM memberships m JOIN users u ON u.id=m.user_id LEFT JOIN team_members t ON t.organization_id=m.organization_id AND t.user_id=m.user_id WHERE m.organization_id=? AND m.user_id=? AND m.status='active' AND u.status='active' AND (t.id IS NULL OR t.status='active') LIMIT 1", [context.organizationId, id]).first<{ id: string; name: string }>();
  if (!row) throw new ApiError(400, "DEALERSHIP_PERSON_UNAVAILABLE", "Choose an active workspace member or leave the work unassigned.");
  return row;
}
function currentDate(timezone: string) {
  const clock = businessClock(new Date(), timezone);
  if (!clock) throw new ApiError(503, "DEALERSHIP_DATE_UNAVAILABLE", "The configured business date is unavailable.");
  return clock.date;
}

export async function readDealership(context: AccessContext, permissions: DealershipPermissions, params: URLSearchParams): Promise<DealershipDashboard> {
  const access = await authorizedLocationScope(context, params.get("locationId"));
  const ids = access.locationIds ?? access.locations.map(row => row.id), scope = JSON.stringify(ids), org = context.organizationId;
  const today = currentDate(access.selectedLocation?.timezone ?? context.organization.timezone);
  const from = dealershipDate(params.get("from") || `${today.slice(0, 7)}-01`, "period start")!, to = dealershipDate(params.get("to") || today, "period end")!;
  if (from > to || Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > 366 * 86_400_000) throw new Error("Choose an ordered reporting period no longer than 367 calendar days.");
  const query = dealershipText(params.get("q") ?? "", "search", 100, true).toLowerCase();
  const after = params.get("after") ? dealershipId(params.get("after"), "cursor") : "";
  const scoped = "s.organization_id=? AND s.location_id IN (SELECT value FROM json_each(?))";
  const search = " AND (?='' OR instr(lower(s.stock_number||' '||v.identifier||' '||v.make||' '||v.model),?)>0)";
  const [stockRows, inventorySummary, legacy, people] = await Promise.all([
    all<DealershipStock>(`SELECT ${stockFields} ${stockJoin} WHERE ${scoped}${search} AND s.id>? ORDER BY s.id LIMIT 101`, [org, scope, query, query, after]),
    statement(`SELECT coalesce(sum(s.is_active),0) AS activeStock,coalesce(sum(CASE WHEN s.is_active=1 AND s.availability='available' AND s.physical_status='on_lot' AND s.prep_status='ready' AND s.ownership IN ('owned','consignment') THEN 1 ELSE 0 END),0) AS availableStock,coalesce(sum(s.legacy_incomplete),0) AS legacyIncomplete ${stockJoin} WHERE ${scoped}${search}`, [org, scope, query, query]).first<{ activeStock: number; availableStock: number; legacyIncomplete: number }>(),
    statement("SELECT count(*) AS total FROM inventory_vehicles v WHERE v.organization_id=? AND v.location_id IN (SELECT value FROM json_each(?)) AND NOT EXISTS(SELECT 1 FROM dealership_stock_episodes s WHERE s.organization_id=v.organization_id AND s.legacy_vehicle_id=v.id)", [org, scope]).first<{ total: number }>(),
    permissions.tasksEdit || permissions.salesEdit || permissions.customersEdit ? all<{ id: string; name: string }>("SELECT DISTINCT u.id,u.display_name AS name FROM memberships m JOIN users u ON u.id=m.user_id LEFT JOIN team_members t ON t.user_id=u.id AND t.organization_id=m.organization_id WHERE m.organization_id=? AND m.status='active' AND u.status='active' AND (t.id IS NULL OR t.status='active') ORDER BY u.display_name LIMIT 300", [org]) : Promise.resolve([]),
  ]);
  const [costs, tasks, leads, appointments, saleRows, currencies] = await Promise.all([
    permissions.costs ? all<DealershipCost>(`SELECT c.id,c.episode_id AS episodeId,c.category,c.status,c.amount_cents AS amountCents,c.currency,c.description,c.source_reference AS sourceReference FROM dealership_cost_lines c JOIN dealership_stock_episodes s ON s.id=c.episode_id AND s.organization_id=c.organization_id WHERE ${scoped} ORDER BY c.created_at DESC,c.id LIMIT 101`, [org, scope]) : Promise.resolve([]),
    permissions.tasks ? all<DealershipTask>(`SELECT t.id,t.episode_id AS episodeId,t.lead_id AS leadId,t.title,t.status,t.assignee_id AS assigneeId,t.due_date AS dueDate,t.blocked_reason AS blockedReason,t.version FROM dealership_tasks t LEFT JOIN dealership_stock_episodes s ON s.id=t.episode_id AND s.organization_id=t.organization_id LEFT JOIN dealership_leads l ON l.id=t.lead_id AND l.organization_id=t.organization_id WHERE t.organization_id=? AND ((s.location_id IN (SELECT value FROM json_each(?))) OR (?=1 AND l.location_id IN (SELECT value FROM json_each(?)))) ORDER BY t.updated_at DESC,t.id LIMIT 101`, [org, scope, permissions.customers ? 1 : 0, scope]) : Promise.resolve([]),
    permissions.customers ? all<DealershipLead>(`SELECT ${leadFields} FROM dealership_leads WHERE organization_id=? AND location_id IN (SELECT value FROM json_each(?)) ORDER BY updated_at DESC,id LIMIT 101`, [org, scope]) : Promise.resolve([]),
    permissions.customers ? all<DealershipAppointment>("SELECT a.id,a.lead_id AS leadId,a.scheduled_at AS scheduledAt,a.status,a.version FROM dealership_appointments a JOIN dealership_leads l ON l.id=a.lead_id AND l.organization_id=a.organization_id WHERE a.organization_id=? AND l.location_id IN (SELECT value FROM json_each(?)) ORDER BY a.scheduled_at DESC,a.id LIMIT 101", [org, scope]) : Promise.resolve([]),
    permissions.sales ? all<Omit<DealershipSale, "credits" | "unallocatedBps">>("SELECT d.id,d.episode_id AS episodeId,s.stock_number AS stockNumber,d.delivered_date AS deliveredDate,d.channel,d.amount_cents AS amountCents,d.currency,d.cost_cents AS costCents,CASE WHEN d.cost_cents IS NOT NULL THEN d.amount_cents-d.cost_cents END AS grossCents,d.status,d.reversal_date AS reversalDate FROM dealership_sales d JOIN dealership_stock_episodes s ON s.id=d.episode_id AND s.organization_id=d.organization_id WHERE d.organization_id=? AND d.location_id IN (SELECT value FROM json_each(?)) AND (d.delivered_date BETWEEN ? AND ? OR d.reversal_date BETWEEN ? AND ?) ORDER BY d.delivered_date DESC,d.id LIMIT 101", [org, scope, from, to, from, to]) : Promise.resolve([]),
    permissions.sales ? all<DealershipSummaryCurrency>(`SELECT currency,
      sum(CASE WHEN delivered_date BETWEEN ? AND ? THEN 1 ELSE 0 END) AS deliveredUnits,
      sum(CASE WHEN delivered_date BETWEEN ? AND ? THEN amount_cents ELSE 0 END) AS vehicleSalesCents,
      sum(CASE WHEN delivered_date BETWEEN ? AND ? AND cost_cents IS NOT NULL THEN amount_cents-cost_cents END) AS grossCents,
      sum(CASE WHEN delivered_date BETWEEN ? AND ? AND cost_cents IS NOT NULL THEN 1 ELSE 0 END) AS grossEligibleUnits,
      sum(CASE WHEN delivered_date BETWEEN ? AND ? AND cost_cents IS NULL THEN 1 ELSE 0 END) AS missingCostUnits,
      sum(CASE WHEN reversal_date BETWEEN ? AND ? THEN 1 ELSE 0 END) AS reversedUnits,
      sum(CASE WHEN reversal_date BETWEEN ? AND ? THEN amount_cents ELSE 0 END) AS reversedSalesCents
      FROM dealership_sales WHERE organization_id=? AND location_id IN (SELECT value FROM json_each(?)) AND (delivered_date BETWEEN ? AND ? OR reversal_date BETWEEN ? AND ?) GROUP BY currency`, [...Array.from({ length: 7 }, () => [from, to]).flat(), org, scope, from, to, from, to]) : Promise.resolve([]),
  ]);
  // Evaluate due dates in each authorized location, independently of recent-row pagination.
  const localDates = JSON.stringify(access.locations.map(location => ({id:location.id,date:currentDate(location.timezone)})));
  const attentionTasks = permissions.tasks ? await all<DealershipAttentionTask & {totalRows:number}>(`SELECT
    t.id,t.episode_id AS episodeId,t.lead_id AS leadId,t.title,t.status,t.assignee_id AS assigneeId,
    t.due_date AS dueDate,t.blocked_reason AS blockedReason,t.version,
    coalesce(s.location_id,l.location_id) AS locationId,loc.name AS locationName,
    CASE WHEN t.episode_id IS NOT NULL THEN 'Stock '||s.stock_number ELSE 'Lead: '||l.customer_name END AS linkedLabel,
    json_extract(d.value,'$.date') AS localDate,u.display_name AS assigneeName,count(*) OVER() AS totalRows
    FROM dealership_tasks t
    LEFT JOIN dealership_stock_episodes s ON s.id=t.episode_id AND s.organization_id=t.organization_id
    LEFT JOIN dealership_leads l ON l.id=t.lead_id AND l.organization_id=t.organization_id
    JOIN organization_locations loc ON loc.id=coalesce(s.location_id,l.location_id) AND loc.organization_id=t.organization_id
    JOIN json_each(?) d ON json_extract(d.value,'$.id')=loc.id
    LEFT JOIN memberships m ON m.user_id=t.assignee_id AND m.organization_id=t.organization_id AND m.status='active'
    LEFT JOIN users u ON u.id=m.user_id
    WHERE t.organization_id=? AND loc.id IN (SELECT value FROM json_each(?))
      AND (t.episode_id IS NOT NULL OR ?=1) AND t.status<>'done'
      AND (t.status='blocked' OR t.assignee_id IS NULL OR t.due_date<=json_extract(d.value,'$.date'))
    ORDER BY CASE WHEN t.status='blocked' THEN 0 ELSE 1 END,coalesce(t.due_date,'9999-12-31'),t.id LIMIT 50`, [localDates,org,scope,permissions.customers?1:0]) : [];
  const saleIds = JSON.stringify(saleRows.slice(0, 100).map(row => row.id));
  const credits = permissions.sales ? await all<DealershipCredit & { saleId: string }>("SELECT sale_id AS saleId,coalesce(person_id,'deleted:'||id) AS personId,person_name AS name,share_bps AS shareBps FROM dealership_sale_credits WHERE organization_id=? AND sale_id IN (SELECT value FROM json_each(?)) ORDER BY personId", [org, saleIds]) : [];
  const sales = saleRows.slice(0, 100).map(row => {
    const matched = credits.filter(item => item.saleId === row.id), allocated = allocateDealershipAmount(row.amountCents, matched);
    const gross = row.grossCents !== null && permissions.profit ? allocateDealershipAmount(row.grossCents, matched) : [];
    return { ...row, costCents: permissions.costs ? row.costCents : null, grossCents: permissions.profit ? row.grossCents : null,
      credits: matched.map(({ personId, shareBps, name }) => ({ personId, shareBps, name, allocatedSalesCents: allocated.find(item => item.personId === personId)!.amountCents, allocatedGrossCents: gross.find(item => item.personId === personId)?.amountCents ?? null })), unallocatedBps: 10_000 - matched.reduce((sum, item) => sum + item.shareBps, 0) };
  });
  return { locations: access.locations.map(({ id, name, currency, timezone }) => ({ id, name, currency, timezone })), people, permissions,
    stock: stockRows.slice(0, 100).map(row => ({ ...row, postedCostCents: permissions.costs ? row.postedCostCents : null, costComplete: permissions.costs && !!row.costComplete, legacyIncomplete: !!row.legacyIncomplete })),
    costs: costs.slice(0, 100), tasks: tasks.slice(0, 100), leads: leads.slice(0, 100), appointments: appointments.slice(0, 100), sales,
    summary: { from, to, ...inventorySummary!, currencies: currencies.map(row => ({ ...row, grossCents: permissions.profit ? row.grossCents : null, grossEligibleUnits: permissions.profit ? row.grossEligibleUnits : 0, missingCostUnits: permissions.profit ? row.missingCostUnits : 0 })) },
    attention: {tasks:attentionTasks.map(({totalRows,...task})=>{ void totalRows; return task; }),totalTasks:attentionTasks[0]?.totalRows??0,truncated:(attentionTasks[0]?.totalRows??0)>50},
    nextCursor: stockRows.length > 100 ? stockRows[99].id : null, legacyAvailable: legacy?.total ?? 0, boundary: `${DEALERSHIP_BOUNDARY} Sales summaries show deliveries and dated reversals separately, not net accounting revenue. Available stock means on-lot, preparation-ready stock recorded as available.`,
    limits: { relatedRows: 100, truncated: [costs, tasks, leads, appointments, saleRows].some(rows => rows.length > 100) }, generatedAt: new Date().toISOString() };
}

/** Exports cover the complete selected scope or fail explicitly; they never truncate silently. */
export async function exportDealership(context: AccessContext, permissions: DealershipPermissions, params: URLSearchParams) {
  permitted(permissions.export);
  const kind = dealershipEnum(params.get("export") ?? "stock", ["stock", "sales", "summary"], "export");
  if (kind !== "stock") permitted(permissions.sales);
  const access = await authorizedLocationScope(context, params.get("locationId"));
  const scope = JSON.stringify(access.locationIds ?? access.locations.map(row => row.id)), org = context.organizationId;
  const csvCell = (value: unknown) => { const raw = value === null || value === undefined ? "" : String(value); return `"${(/^[=+@\-\t\r]/.test(raw) && typeof value !== "number" ? "'" : "") + raw.replaceAll('"', '""')}"`; };
  let rows: Record<string, unknown>[], columns: string[];
  if (kind === "stock") {
    const query = dealershipText(params.get("q") ?? "", "search", 100, true).toLowerCase();
    rows = await all(`SELECT ${stockFields} ${stockJoin} WHERE s.organization_id=? AND s.location_id IN (SELECT value FROM json_each(?)) AND (?='' OR instr(lower(s.stock_number||' '||v.identifier||' '||v.make||' '||v.model),?)>0) ORDER BY s.id LIMIT 5001`, [org, scope, query, query]);
    columns = ["id", "vehicleId", "locationId", "locationName", "identifierKind", "identifier", "year", "make", "model", "stockNumber", "currency", "acquiredDate", "ownership", "physicalStatus", "prepStatus", "availability", "askingCents", "source", "legacyIncomplete", "version", "reservationExpiresAt"];
    if (permissions.costs) columns.push("postedCostCents", "costComplete");
  } else {
    const today = currentDate(access.selectedLocation?.timezone ?? context.organization.timezone);
    const from = dealershipDate(params.get("from") || `${today.slice(0, 7)}-01`, "period start")!, to = dealershipDate(params.get("to") || today, "period end")!;
    if (from > to || Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > 366 * 86_400_000) throw new Error("Choose an ordered reporting period no longer than 367 calendar days.");
    if (kind === "summary") {
      rows = (await readDealership(context, permissions, params)).summary.currencies.map(row => ({ periodFrom: from, periodTo: to, ...row }));
      columns = ["periodFrom", "periodTo", "currency", "deliveredUnits", "vehicleSalesCents", "reversedUnits", "reversedSalesCents"];
      if (permissions.profit) columns.push("grossCents", "grossEligibleUnits", "missingCostUnits");
    } else {
      rows = await all(`SELECT d.id,d.episode_id AS episodeId,d.location_id AS locationId,s.stock_number AS stockNumber,v.identifier,d.delivered_date AS deliveredDate,d.channel,d.amount_cents AS amountCents,d.currency,d.cost_cents AS costCents,CASE WHEN d.cost_cents IS NOT NULL THEN d.amount_cents-d.cost_cents END AS grossCents,d.status,d.reversal_date AS reversalDate,d.created_at AS recordedAt,? AS periodFrom,? AS periodTo FROM dealership_sales d JOIN dealership_stock_episodes s ON s.id=d.episode_id AND s.organization_id=d.organization_id JOIN dealership_vehicle_identities v ON v.id=s.vehicle_id AND v.organization_id=s.organization_id WHERE d.organization_id=? AND d.location_id IN (SELECT value FROM json_each(?)) AND (d.delivered_date BETWEEN ? AND ? OR d.reversal_date BETWEEN ? AND ?) ORDER BY d.delivered_date,d.id LIMIT 5001`, [from, to, org, scope, from, to, from, to]);
      columns = ["id", "episodeId", "locationId", "stockNumber", "identifier", "deliveredDate", "channel", "amountCents", "currency", "status", "reversalDate", "recordedAt", "periodFrom", "periodTo"];
      if (permissions.costs) columns.push("costCents");
      if (permissions.profit) columns.push("grossCents");
    }
  }
  if (rows.length > 5000) throw new ApiError(422, "DEALERSHIP_EXPORT_SCOPE_TOO_LARGE", "This export exceeds 5,000 records. Narrow the location, search or sales period; no partial export was generated.");
  return { filename: `dealership-${kind}.csv`, csv: [columns.join(","), ...rows.map(row => columns.map(column => csvCell(row[column])).join(","))].join("\r\n") + "\r\n" };
}

type MutationResult = { saved: true; id: string; count?: number; replayed?: boolean };
export async function mutateDealership(context: AccessContext, permissions: DealershipPermissions, body: Record<string, unknown>): Promise<MutationResult | { entries: DealershipAcquire[]; count: number; fingerprint: string }> {
  const action = dealershipText(body.action, "action", 40), org = context.organizationId, now = Date.now();
  const allowed: Record<string, boolean> = { acquire: permissions.stockEdit, preview: permissions.import, confirm: permissions.import, adopt_legacy: permissions.stockEdit,
    update_stock: permissions.stockEdit, transfer: permissions.stockEdit, add_cost: permissions.costEdit, save_task: permissions.tasksEdit,
    save_lead: permissions.customersEdit, save_appointment: permissions.customersEdit, reserve: permissions.salesEdit,
    release_reservation: permissions.salesEdit, deliver: permissions.salesEdit, reverse_sale: permissions.salesEdit };
  if (!(action in allowed)) throw new Error("Choose a supported dealership action.");
  permitted(allowed[action]);
  const mutationKey = action === "preview" ? "preview" : dealershipId(body.mutationKey, "mutation key");
  let requestHash = await hashIdentifier(JSON.stringify([context.userId, body]));
  const receipt = async () => statement("SELECT request_hash AS requestHash,result_json AS resultJson FROM dealership_mutations WHERE organization_id=? AND mutation_key=?", [org, mutationKey]).first<{ requestHash: string; resultJson: string }>();
  const previous = ["preview", "confirm"].includes(action) ? null : await receipt();
  if (previous) {
    if (previous.requestHash !== requestHash) throw new ApiError(409, "DEALERSHIP_MUTATION_REUSED", "This save key belongs to different data. Start a new reviewed action.");
    return { ...JSON.parse(previous.resultJson) as MutationResult, replayed: true };
  }
  const writes: D1PreparedStatement[] = [], guards: string[] = [];
  const guard = (condition: string, values: unknown[]) => { const id = crypto.randomUUID(); guards.push(id); writes.push(statement(`INSERT INTO dealership_write_guards(id,organization_id,permitted) SELECT ?,?,CASE WHEN ${condition} THEN 1 ELSE 0 END`, [id, org, ...values])); };
  const versionGuard = (table: string, id: string, version: unknown, extra = "") => guard(`EXISTS(SELECT 1 FROM ${table} WHERE organization_id=? AND id=? AND version=? ${extra})`, [org, id, dealershipVersion(version)]);
  let result: MutationResult = { saved: true, id: crypto.randomUUID() }, details: Record<string, unknown> = { action };
  const acquireStatements = (entry: DealershipAcquire, location: { id: string; name: string; currency: string }, source: "manual" | "csv") => {
    const identityId = crypto.randomUUID(), id = crypto.randomUUID(), v = entry.vehicle;
    writes.push(statement("INSERT INTO dealership_vehicle_identities(id,organization_id,identifier_kind,identifier,model_year,make,model,created_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(organization_id,identifier) DO NOTHING", [identityId, org, v.identifierKind, v.identifier, v.year, v.make, v.model, now]));
    guard("EXISTS(SELECT 1 FROM dealership_vehicle_identities WHERE organization_id=? AND identifier=? AND identifier_kind=? AND model_year=? AND make=? AND model=?)", [org, v.identifier, v.identifierKind, v.year, v.make, v.model]);
    writes.push(statement(`INSERT INTO dealership_stock_episodes(id,organization_id,vehicle_id,location_id,location_name,stock_number,currency,acquired_date,ownership,physical_status,prep_status,availability,asking_cents,source,created_at,updated_at)
      SELECT ?,?,id,?,?,?,?,?,?,?,?,?,?,?,?,? FROM dealership_vehicle_identities WHERE organization_id=? AND identifier=?`, [id, org, location.id, location.name, v.stockNumber, location.currency, v.acquiredDate, entry.ownership, entry.physicalStatus, entry.prepStatus, entry.availability, entry.askingCents, source, now, now, org, v.identifier]));
    return id;
  };
  if (["acquire", "preview", "confirm"].includes(action)) {
    const location = await requireAccessibleLocation(context, dealershipId(body.locationId, "location"));
    if (action !== "acquire" && typeof body.csv !== "string") throw new Error("Choose a dealership stock CSV.");
    const entries = action === "acquire" ? [validateDealershipAcquire(body, location.currency)] : parseDealershipCsv(body.csv as string, location.currency);
    const today = currentDate(location.timezone);
    if (entries.some(row => row.vehicle.acquiredDate > today)) throw new Error("Acquisition cannot be after today in the selected location.");
    const fingerprint = await hashIdentifier(JSON.stringify(["dealership-stock-v1", org, context.userId, location.id, entries]));
    if (action === "preview") return { entries, count: entries.length, fingerprint };
    if (action === "confirm" && body.fingerprint !== fingerprint) throw new ApiError(409, "DEALERSHIP_PREVIEW_CHANGED", "Preview the current CSV and location again before saving.");
    if (action === "confirm") {
      requestHash = await hashIdentifier(JSON.stringify([context.userId, "dealership-import", fingerprint]));
      const repeated = await receipt() ?? await statement("SELECT request_hash AS requestHash,result_json AS resultJson FROM dealership_mutations WHERE organization_id=? AND request_hash=? LIMIT 1", [org, requestHash]).first<{ requestHash: string; resultJson: string }>();
      if (repeated) {
        if (repeated.requestHash !== requestHash) throw new ApiError(409, "DEALERSHIP_MUTATION_REUSED", "This save key belongs to different data. Start a new reviewed action.");
        return { ...JSON.parse(repeated.resultJson) as MutationResult, replayed: true };
      }
    }
    const ids = entries.map(row => acquireStatements(row, location, action === "acquire" ? "manual" : "csv"));
    result = { saved: true, id: ids[0], count: ids.length }; details = { action, count: ids.length, locationId: location.id };
  } else if (action === "adopt_legacy") {
    const location = await requireAccessibleLocation(context, dealershipId(body.locationId, "location"));
    requireDealershipCurrency(location.currency);
    const rows = await all<{ id: string; identifierKind: string; identifier: string; year: number; make: string; model: string; stockNumber: string; status: string; acquiredDate: string; currency: string; acquisitionCents: number | null; reconditioningCents: number | null }>("SELECT id,identifier_kind AS identifierKind,identifier,model_year AS year,make,model,stock_number AS stockNumber,status,acquired_date AS acquiredDate,currency,acquisition_cents AS acquisitionCents,reconditioning_cents AS reconditioningCents FROM inventory_vehicles v WHERE organization_id=? AND location_id=? AND NOT EXISTS(SELECT 1 FROM dealership_stock_episodes s WHERE s.organization_id=v.organization_id AND s.legacy_vehicle_id=v.id) ORDER BY id LIMIT 100", [org, location.id]);
    if (!rows.length) throw new Error("There are no remaining legacy records in this location to bring into dealership operations.");
    for (const row of rows) {
      requireDealershipCurrency(row.currency);
      const id = crypto.randomUUID();
      writes.push(statement("INSERT INTO dealership_vehicle_identities(id,organization_id,identifier_kind,identifier,model_year,make,model,created_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(organization_id,identifier) DO NOTHING", [crypto.randomUUID(), org, row.identifierKind, row.identifier, row.year, row.make, row.model, now]));
      guard("EXISTS(SELECT 1 FROM dealership_vehicle_identities WHERE organization_id=? AND identifier=? AND identifier_kind=? AND model_year=? AND make=? AND model=?)", [org, row.identifier, row.identifierKind, row.year, row.make, row.model]);
      writes.push(statement(`INSERT INTO dealership_stock_episodes(id,organization_id,vehicle_id,location_id,location_name,stock_number,currency,acquired_date,ownership,physical_status,prep_status,availability,is_active,source,legacy_vehicle_id,legacy_incomplete,created_at,updated_at)
        SELECT ?,?,id,?,?,?,?,?,'unknown','unknown',?,?,?,'legacy',?,1,?,? FROM dealership_vehicle_identities WHERE organization_id=? AND identifier=?`, [id, org, location.id, location.name, row.stockNumber, row.currency, row.acquiredDate, row.status === "reconditioning" ? "in_progress" : "unknown", row.status === "sold" ? "legacy_sold" : row.status === "archived" ? "archived" : "held", ["sold", "archived"].includes(row.status) ? 0 : 1, row.id, now, now, org, row.identifier]));
      for (const [category, amount] of [["acquisition", row.acquisitionCents], ["preparation", row.reconditioningCents]] as const) if (amount !== null) writes.push(statement("INSERT INTO dealership_cost_lines(id,organization_id,episode_id,category,status,amount_cents,currency,description,source_reference,created_at) VALUES(?,?,?,?,'recorded',?,?,?, ?,?)", [crypto.randomUUID(), org, id, category, amount, row.currency, "Legacy amount; posting status and full cost coverage unknown", `legacy:${row.id}`, now]));
    }
    result = { saved: true, id: rows[0].id, count: rows.length }; details = { action, count: rows.length, locationId: location.id };
  } else if (["update_stock", "transfer", "add_cost", "reserve", "release_reservation", "deliver"].includes(action)) {
    const row = await stock(context, body.episodeId); result.id = row.id;
    requireDealershipCurrency(row.currency);
    guard("EXISTS(SELECT 1 FROM dealership_stock_episodes WHERE organization_id=? AND id=? AND location_id=?)", [org, row.id, row.locationId]);
    if (!row.isActive) throw new ApiError(409, "DEALERSHIP_STOCK_CLOSED", "This stock episode is closed. Reacquisition requires a new episode.");
    if (action === "update_stock") {
      versionGuard("dealership_stock_episodes", row.id, body.expectedVersion, "AND is_active=1");
      const physical = dealershipEnum(body.physicalStatus, DEALERSHIP_PHYSICAL_STATUSES, "physical status"), prep = dealershipEnum(body.prepStatus, DEALERSHIP_PREP_STATUSES, "preparation status");
      const ownership = dealershipEnum(body.ownership ?? row.ownership, ["owned", "consignment", "unknown"], "ownership");
      const availability = dealershipEnum(body.availability, ["available", "held", "archived", "reserved"], "availability");
      if (row.availability === "reserved" || availability === "reserved") {
        if (availability !== row.availability) throw new Error("Use the reservation actions to reserve or release this stock.");
      }
      let complete = !!row.costComplete;
      if (body.costComplete !== undefined) { permitted(permissions.costApprove); if (typeof body.costComplete !== "boolean") throw new Error("Choose whether posted cost coverage was reviewed."); complete = body.costComplete; }
      if (complete) guard("EXISTS(SELECT 1 FROM dealership_cost_lines WHERE organization_id=? AND episode_id=? AND status='posted')", [org, row.id]);
      writes.push(statement("UPDATE dealership_stock_episodes SET ownership=?,physical_status=?,prep_status=?,availability=?,asking_cents=?,cost_complete=?,is_active=?,version=version+1,updated_at=? WHERE organization_id=? AND id=?", [ownership, physical, prep, availability, dealershipCents(body.askingCents, true), complete ? 1 : 0, availability === "archived" ? 0 : 1, now, org, row.id]));
      details = { action, previousVersion: row.version, ownership, physical, prep, availability, costComplete: complete };
    } else if (action === "transfer") {
      versionGuard("dealership_stock_episodes", row.id, body.expectedVersion, "AND is_active=1");
      guard("NOT EXISTS(SELECT 1 FROM dealership_reservations WHERE organization_id=? AND episode_id=? AND status='active')", [org, row.id]);
      const location = await requireAccessibleLocation(context, dealershipId(body.locationId, "destination location"));
      if (location.currency !== row.currency) throw new Error("Cross-currency transfers require a separately reviewed currency policy and are unavailable.");
      writes.push(statement("UPDATE dealership_stock_episodes SET location_id=?,location_name=?,version=version+1,updated_at=? WHERE organization_id=? AND id=?", [location.id, location.name, now, org, row.id]));
      details = { action, fromLocationId: row.locationId, toLocationId: location.id, acquiredDate: row.acquiredDate };
    } else if (action === "add_cost") {
      const category = dealershipEnum(body.category, DEALERSHIP_COST_CATEGORIES, "cost category"), status = dealershipEnum(body.status, ["estimated", "approved", "posted"], "cost state");
      if (status !== "estimated") permitted(permissions.costApprove);
      const reference = dealershipText(body.sourceReference, "source reference", 200, status !== "posted");
      guard("EXISTS(SELECT 1 FROM dealership_stock_episodes WHERE organization_id=? AND id=? AND is_active=1)", [org, row.id]);
      result.id = crypto.randomUUID();
      writes.push(statement("INSERT INTO dealership_cost_lines(id,organization_id,episode_id,category,status,amount_cents,currency,description,source_reference,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)", [result.id, org, row.id, category, status, dealershipCents(body.amountCents), row.currency, dealershipText(body.description, "cost description", 300), reference, now]));
      writes.push(statement("UPDATE dealership_stock_episodes SET cost_complete=0,version=version+1,updated_at=? WHERE organization_id=? AND id=?", [now, org, row.id]));
      details = { action, episodeId: row.id, category, status };
    } else if (action === "reserve") {
      versionGuard("dealership_stock_episodes", row.id, body.expectedVersion, "AND is_active=1");
      const expires = dealershipInstant(body.expiresAt);
      if (Date.parse(expires) <= now) throw new Error("Reservation expiry must be in the future.");
      let leadId: string | null = null;
      if (body.leadId) { permitted(permissions.customers); const linked = await lead(context, body.leadId); if (linked.locationId !== row.locationId) throw new Error("The reservation lead must be in the vehicle's location."); leadId = linked.id; }
      writes.push(statement("UPDATE dealership_reservations SET status='expired',updated_at=? WHERE organization_id=? AND episode_id=? AND status='active' AND expires_at<=?", [now, org, row.id, new Date(now).toISOString()]));
      writes.push(statement("UPDATE dealership_stock_episodes SET availability='available' WHERE organization_id=? AND id=? AND availability='reserved' AND NOT EXISTS(SELECT 1 FROM dealership_reservations r WHERE r.organization_id=? AND r.episode_id=? AND r.status='active')", [org, row.id, org, row.id]));
      writes.push(statement("INSERT INTO dealership_reservations(id,organization_id,episode_id,lead_id,expires_at,status,created_at,updated_at) VALUES(?,?,?,?,?,'active',?,?)", [crypto.randomUUID(), org, row.id, leadId, expires, now, now]));
      writes.push(statement("UPDATE dealership_stock_episodes SET availability='reserved',version=version+1,updated_at=? WHERE organization_id=? AND id=?", [now, org, row.id]));
    } else if (action === "release_reservation") {
      versionGuard("dealership_stock_episodes", row.id, body.expectedVersion, "AND is_active=1");
      guard("EXISTS(SELECT 1 FROM dealership_stock_episodes WHERE organization_id=? AND id=? AND is_active=1 AND availability='reserved')", [org, row.id]);
      writes.push(statement("UPDATE dealership_reservations SET status='released',updated_at=? WHERE organization_id=? AND episode_id=? AND status='active'", [now, org, row.id]));
      writes.push(statement("UPDATE dealership_stock_episodes SET availability='available',version=version+1,updated_at=? WHERE organization_id=? AND id=?", [now, org, row.id]));
    } else {
      versionGuard("dealership_stock_episodes", row.id, body.expectedVersion, "AND is_active=1");
      const location = await requireAccessibleLocation(context, row.locationId), delivered = dealershipDate(body.deliveredDate, "delivery date")!;
      if (delivered < row.acquiredDate || delivered > currentDate(location.timezone)) throw new Error("Delivery must be on or after acquisition and no later than today in this location.");
      const credits = validateDealershipCredits(body.credits ?? []), approved = await Promise.all(credits.map(async credit => ({ ...credit, person: await person(context, credit.personId) })));
      const channel = dealershipEnum(body.channel, ["retail", "wholesale"], "sale channel"), amount = dealershipCents(body.amountCents)!;
      result.id = crypto.randomUUID();
      // Capture cost coverage at delivery. Later costs cannot rewrite the original sale evidence.
      writes.push(statement(`INSERT INTO dealership_sales(id,organization_id,episode_id,location_id,delivered_date,channel,amount_cents,currency,cost_cents,created_at)
        SELECT ?,?,?,location_id,?,?,?,currency,CASE WHEN cost_complete=1 AND ownership='owned' THEN (SELECT sum(amount_cents) FROM dealership_cost_lines c WHERE c.organization_id=s.organization_id AND c.episode_id=s.id AND c.status='posted') END,? FROM dealership_stock_episodes s WHERE organization_id=? AND id=?`, [result.id, org, row.id, delivered, channel, amount, now, org, row.id]));
      for (const credit of approved) writes.push(statement("INSERT INTO dealership_sale_credits(id,organization_id,sale_id,person_id,person_name,share_bps,approved_by,created_at) VALUES(?,?,?,?,?,?,?,?)", [crypto.randomUUID(), org, result.id, credit.personId, credit.person!.name, credit.shareBps, context.userId, now]));
      writes.push(statement("UPDATE dealership_stock_episodes SET availability='delivered',is_active=0,exit_date=?,version=version+1,updated_at=? WHERE organization_id=? AND id=?", [delivered, now, org, row.id]));
      writes.push(statement("UPDATE dealership_reservations SET status='delivered',updated_at=? WHERE organization_id=? AND episode_id=? AND status='active'", [now, org, row.id]));
      details = { action, episodeId: row.id, deliveredDate: delivered, channel, approvedCreditBps: credits.reduce((sum, credit) => sum + credit.shareBps, 0) };
    }
  } else if (action === "save_lead") {
    const location = await requireAccessibleLocation(context, dealershipId(body.locationId, "location"));
    const assigned = await person(context, body.assigneeId), stage = dealershipEnum(body.stage, DEALERSHIP_LEAD_STAGES, "lead stage");
    const values = [dealershipText(body.customerName, "customer name", 160), dealershipText(body.contact, "contact reference", 200, true), stage, assigned?.id ?? null, dealershipDate(body.nextActionDate, "next action date", true)];
    if (body.id) {
      const previousLead = await lead(context, body.id); result.id = previousLead.id;
      if (location.id !== previousLead.locationId) throw new Error("Lead location transfers are unavailable in this workflow.");
      versionGuard("dealership_leads", result.id, body.expectedVersion);
      writes.push(statement("UPDATE dealership_leads SET customer_name=?,contact=?,stage=?,assignee_id=?,next_action_date=?,version=version+1,updated_at=? WHERE organization_id=? AND id=?", [...values, now, org, result.id]));
      details = { action, previousStage: previousLead.stage, previousAssigneeId: previousLead.assigneeId, stage, assigneeId: assigned?.id ?? null };
    } else writes.push(statement("INSERT INTO dealership_leads(id,organization_id,location_id,customer_name,contact,stage,assignee_id,next_action_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)", [result.id, org, location.id, ...values, now, now]));
  } else if (action === "save_task") {
    if (!!body.episodeId === !!body.leadId) throw new Error("Link a task to exactly one stock episode or lead.");
    let episodeId: string | null = null, leadId: string | null = null;
    if (body.episodeId) {
      const linked = await stock(context, body.episodeId); episodeId = linked.id;
      guard("EXISTS(SELECT 1 FROM dealership_stock_episodes WHERE organization_id=? AND id=? AND location_id=?)", [org, linked.id, linked.locationId]);
    }
    else { permitted(permissions.customers); leadId = (await lead(context, body.leadId)).id; }
    const assigned = await person(context, body.assigneeId), status = dealershipEnum(body.status, DEALERSHIP_TASK_STATUSES, "task status");
    const blockedReason = dealershipText(body.blockedReason, "blocked reason", 300, status !== "blocked");
    const values = [dealershipText(body.title, "task title", 200), status, assigned?.id ?? null, dealershipDate(body.dueDate, "due date", true), blockedReason];
    if (body.id) {
      result.id = dealershipId(body.id); const existing = await statement("SELECT episode_id AS episodeId,lead_id AS leadId FROM dealership_tasks WHERE organization_id=? AND id=?", [org, result.id]).first<{ episodeId: string | null; leadId: string | null }>();
      if (!existing || existing.episodeId !== episodeId || existing.leadId !== leadId) notFound();
      versionGuard("dealership_tasks", result.id, body.expectedVersion);
      writes.push(statement("UPDATE dealership_tasks SET title=?,status=?,assignee_id=?,due_date=?,blocked_reason=?,version=version+1,updated_at=? WHERE organization_id=? AND id=?", [...values, now, org, result.id]));
    } else writes.push(statement("INSERT INTO dealership_tasks(id,organization_id,episode_id,lead_id,title,status,assignee_id,due_date,blocked_reason,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)", [result.id, org, episodeId, leadId, ...values, now, now]));
    details = { action, episodeId, leadId, status, assigneeId: assigned?.id ?? null };
  } else if (action === "save_appointment") {
    const linked = await lead(context, body.leadId), scheduled = dealershipInstant(body.scheduledAt), status = dealershipEnum(body.status, DEALERSHIP_APPOINTMENT_STATUSES, "appointment status");
    if (["attended", "no_show"].includes(status) && Date.parse(scheduled) > now) throw new Error("A future appointment cannot be recorded as attended or missed.");
    if (body.id) {
      result.id = dealershipId(body.id);
      guard("EXISTS(SELECT 1 FROM dealership_appointments WHERE organization_id=? AND id=? AND lead_id=? AND version=?)", [org, result.id, linked.id, dealershipVersion(body.expectedVersion)]);
      writes.push(statement("UPDATE dealership_appointments SET scheduled_at=?,status=?,version=version+1,updated_at=? WHERE organization_id=? AND id=?", [scheduled, status, now, org, result.id]));
    } else writes.push(statement("INSERT INTO dealership_appointments(id,organization_id,lead_id,scheduled_at,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)", [result.id, org, linked.id, scheduled, status, now, now]));
    details = { action, leadId: linked.id, scheduledAt: scheduled, status };
  } else if (action === "reverse_sale") {
    result.id = dealershipId(body.saleId, "sale");
    const sale = await statement("SELECT location_id AS locationId,delivered_date AS deliveredDate,status FROM dealership_sales WHERE organization_id=? AND id=?", [org, result.id]).first<{ locationId: string; deliveredDate: string; status: string }>();
    if (!sale) notFound();
    const location = await requireAccessibleLocation(context, sale.locationId), date = dealershipDate(body.date, "reversal date")!;
    if (date < sale.deliveredDate || date > currentDate(location.timezone)) throw new Error("Reversal must be on or after delivery and no later than today.");
    guard("EXISTS(SELECT 1 FROM dealership_sales WHERE organization_id=? AND id=? AND status='delivered')", [org, result.id]);
    writes.push(statement("UPDATE dealership_sales SET status='reversed',reversal_date=?,reversal_reason=? WHERE organization_id=? AND id=?", [date, dealershipText(body.reason, "reversal reason", 300), org, result.id]));
    details = { action, date, inventoryRestored: false };
  }
  writes.push(statement("INSERT INTO dealership_events(id,organization_id,resource_id,action,actor_id,detail_json,created_at) VALUES(?,?,?,?,?,?,?)", [crypto.randomUUID(), org, result.id, action, context.userId, JSON.stringify(details), now]));
  for (const id of guards) writes.push(statement("DELETE FROM dealership_write_guards WHERE organization_id=? AND id=?", [org, id]));
  try {
    await db().batch([statement("INSERT INTO dealership_mutations(organization_id,mutation_key,request_hash,result_json,created_at) VALUES(?,?,?,?,?)", [org, mutationKey, requestHash, JSON.stringify(result), now]), ...writes]);
  } catch (error) {
    const raced = await receipt() ?? (action === "confirm" ? await statement("SELECT request_hash AS requestHash,result_json AS resultJson FROM dealership_mutations WHERE organization_id=? AND request_hash=? LIMIT 1", [org, requestHash]).first<{ requestHash: string; resultJson: string }>() : null);
    if (raced?.requestHash === requestHash) return { ...JSON.parse(raced.resultJson) as MutationResult, replayed: true };
    if (/constraint|dealership stock|dealership credit|dealership location/i.test(error instanceof Error ? error.message : String(error))) throw new ApiError(409, "DEALERSHIP_CONFLICT", "This record changed, is unavailable, or duplicates existing stock. Reload current records and review before retrying.");
    throw error;
  }
  return result;
}
