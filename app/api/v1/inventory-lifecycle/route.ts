import { and, eq } from "drizzle-orm";
import { getD1, getDb } from "../../../../db";
import { inventoryBalances, inventoryLots } from "../../../../db/schema";
import { assessInventoryLot, fefoSort } from "../../../../domain/inventory-lifecycle";
import { recordAudit } from "../../../../server/audit";
import { requireAccess } from "../../../../server/authorization";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../server/api";
import { effectivePermissions, requirePermission } from "../../../../server/permissions";
import { authorizedLocationDataScope } from "../../../../server/location-access";
import { approvedFactSource } from "../../../../server/integrations/trusted-data";

const roles = ["owner", "admin", "manager", "employee", "read_only"] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function cleanText(value: unknown, label: string, maximum: number, required = true): string {
  if (value === undefined || value === null || value === "") {
    if (!required) return "";
    throw new ApiError(400, "INVALID_FIELD", `Enter a valid ${label}.`);
  }
  if (typeof value !== "string") throw new ApiError(400, "INVALID_FIELD", `Enter a valid ${label}.`);
  const result = value.trim().normalize("NFC");
  if ((required && !result) || result.length > maximum || /[\u0000-\u001f\u007f]/.test(result)) {
    throw new ApiError(400, "INVALID_FIELD", `Enter a valid ${label}.`);
  }
  return result;
}

function optionalDate(value: unknown, label: string): string | null {
  const result = cleanText(value, label, 10, false);
  if (!result) return null;
  const parsed = new Date(`${result}T00:00:00.000Z`);
  if (!DATE.test(result) || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== result) {
    throw new ApiError(400, "INVALID_FIELD", `Enter a valid ${label}.`);
  }
  return result;
}

function integer(value: unknown, label: string, minimum = 0, maximum = 1_000_000_000): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new ApiError(400, "INVALID_FIELD", `Enter a valid ${label}.`);
  }
  return Number(value);
}

function optionalInteger(value: unknown, label: string, minimum = 0): number | null {
  return value === null || value === undefined || value === "" ? null : integer(value, label, minimum);
}

function lotInput(input: Record<string, unknown>) {
  const receivedDate = optionalDate(input.receivedDate, "received date");
  if (!receivedDate) throw new ApiError(400, "INVALID_FIELD", "Enter a valid received date.");
  const manufacturingDate = optionalDate(input.manufacturingDate, "manufacturing date");
  if (manufacturingDate && manufacturingDate > receivedDate) {
    throw new ApiError(400, "INVALID_FIELD", "Manufacturing date cannot be after the received date.");
  }
  return {
    locationRef: cleanText(input.locationRef, "location", 96),
    sku: cleanText(input.sku, "SKU", 96).toUpperCase(),
    productName: cleanText(input.productName, "product name", 180),
    supplierName: cleanText(input.supplierName, "supplier", 160, false) || null,
    lotNumber: cleanText(input.lotNumber, "lot number", 100, false),
    batchNumber: cleanText(input.batchNumber, "batch number", 100, false),
    manufacturingDate,
    receivedDate,
    expirationDate: optionalDate(input.expirationDate, "expiration date"),
    bestBeforeDate: optionalDate(input.bestBeforeDate, "best-before date"),
    shelfLifeDays: optionalInteger(input.shelfLifeDays, "shelf life", 1),
    unitCostCents: optionalInteger(input.unitCostCents, "unit cost"),
    unitRetailCents: optionalInteger(input.unitRetailCents, "retail price"),
    quantityRemaining: integer(input.quantityRemaining, "quantity remaining"),
    storageNotes: cleanText(input.storageNotes, "storage notes", 1_000, false),
    status: input.status === "quarantined" ? "quarantined" as const : "active" as const,
  };
}

type LifecycleScope = {
  id: string;
  name: string;
  refs: Set<string>;
} | null;

async function requestScope(request: Request, context: Awaited<ReturnType<typeof requireAccess>>): Promise<LifecycleScope> {
  const requested = new URL(request.url).searchParams.get("location");
  const access = await authorizedLocationDataScope(context, requested);
  if (access.locationRefs === null) return null;
  return {
    id: access.selectedLocation?.id ?? "accessible",
    name: access.selectedLocation?.name ?? "Accessible locations",
    refs: new Set(access.locationRefs),
  };
}

async function lifecycleDto(organizationId: string, scope: LifecycleScope, canViewValue: boolean) {
  const [lots, posBalances] = await Promise.all([
    getDb().select().from(inventoryLots)
      .where(eq(inventoryLots.organizationId, organizationId)).limit(1_000),
    getDb().select({
      locationRef: inventoryBalances.locationRef,
      sku: inventoryBalances.sku,
      name: inventoryBalances.name,
      onHandQuantity: inventoryBalances.onHandQuantity,
      reorderPoint: inventoryBalances.reorderPoint,
      updatedAt: inventoryBalances.updatedAt,
    }).from(inventoryBalances)
      .where(and(
        eq(inventoryBalances.organizationId, organizationId),
        approvedFactSource(inventoryBalances.organizationId, inventoryBalances.sourceProvider, inventoryBalances.sourceConnectionId),
      )).limit(1_000),
  ]);
  const velocityResult = await getD1().prepare(`SELECT sku, location_ref AS locationRef,
      SUM(CASE WHEN occurred_at >= ? AND quantity_delta < 0 THEN -quantity_delta ELSE 0 END) AS unitsSold30Days,
      MIN(occurred_at) AS firstMovementAt
    FROM inventory_movements
    WHERE organization_id = ? AND reason = 'sale'
    GROUP BY sku, location_ref`).bind(Date.now() - 30 * 86_400_000, organizationId)
    .all<{ sku: string; locationRef: string; unitsSold30Days: number; firstMovementAt: number | null }>();
  const visibleLots = scope ? lots.filter((lot) => scope.refs.has(lot.locationRef)) : lots;
  const visibleBalances = scope ? posBalances.filter((balance) => scope.refs.has(balance.locationRef)) : posBalances;
  const velocity = new Map((velocityResult.results ?? [])
    .filter((row) => !scope || scope.refs.has(row.locationRef))
    .map(row => [`${row.locationRef}\u0000${row.sku}`, row]));
  const now = new Date();
  const assessed = visibleLots.map(lot => {
    const movement = velocity.get(`${lot.locationRef}\u0000${lot.sku}`);
    const historyDays = movement?.firstMovementAt
      ? Math.max(1, Math.floor((Date.now() - Number(movement.firstMovementAt)) / 86_400_000) + 1)
      : 0;
    const assessment = assessInventoryLot({
      id: lot.id,
      sku: lot.sku,
      productName: lot.productName,
      locationRef: lot.locationRef,
      lotNumber: lot.lotNumber,
      batchNumber: lot.batchNumber,
      receivedDate: lot.receivedDate,
      expirationDate: lot.expirationDate,
      bestBeforeDate: lot.bestBeforeDate,
      quantityRemaining: lot.quantityRemaining,
      unitCostCents: lot.unitCostCents,
      unitRetailCents: lot.unitRetailCents,
      unitsSold30Days: movement ? Number(movement.unitsSold30Days) : null,
      demandHistoryDays: historyDays,
    }, now);
    return {
      ...lot,
      unitsSold30Days: movement ? Number(movement.unitsSold30Days) : null,
      demandHistoryDays: historyDays,
      assessment,
    };
  });
  const ordered = fefoSort(assessed);
  const riskCounts = { healthy: 0, monitor: 0, at_risk: 0, urgent: 0, expired: 0, untracked: 0 };
  for (const lot of assessed) riskCounts[lot.assessment.risk] += 1;
  return {
    posBalances: visibleBalances.sort((left, right) =>
      left.onHandQuantity - right.onHandQuantity || left.name.localeCompare(right.name)),
    lots: assessed.sort((a, b) => b.updatedAt.valueOf() - a.updatedAt.valueOf()).map((lot) => ({
      ...lot,
      unitCostCents: canViewValue ? lot.unitCostCents : null,
      unitRetailCents: canViewValue ? lot.unitRetailCents : null,
      assessment: {
        ...lot.assessment,
        inventoryCostAtRiskCents: canViewValue ? lot.assessment.inventoryCostAtRiskCents : null,
        grossMarginOpportunityAtRiskCents: canViewValue ? lot.assessment.grossMarginOpportunityAtRiskCents : null,
      },
    })),
    fefo: ordered.filter(lot => lot.quantityRemaining > 0 && lot.status === "active").map((lot, index) => ({
      ...lot,
      unitCostCents: canViewValue ? lot.unitCostCents : null,
      unitRetailCents: canViewValue ? lot.unitRetailCents : null,
      assessment: {
        ...lot.assessment,
        inventoryCostAtRiskCents: canViewValue ? lot.assessment.inventoryCostAtRiskCents : null,
        grossMarginOpportunityAtRiskCents: canViewValue ? lot.assessment.grossMarginOpportunityAtRiskCents : null,
      },
      fefoRank: index + 1,
    })),
    summary: {
      totalLots: assessed.length,
      trackedLots: assessed.filter(lot => lot.assessment.trackedDate !== null).length,
      totalUnits: assessed.reduce((sum, lot) => sum + lot.quantityRemaining, 0),
      costAtRiskCents: canViewValue
        ? assessed.reduce((sum, lot) => sum + (lot.assessment.inventoryCostAtRiskCents ?? 0), 0)
        : null,
      costRiskKnownLots: canViewValue
        ? assessed.filter(lot => lot.assessment.inventoryCostAtRiskCents !== null).length
        : 0,
      riskCounts,
      posSkus: visibleBalances.length,
      posUnits: visibleBalances.reduce((sum, balance) => sum + balance.onHandQuantity, 0),
      lowStockSkus: visibleBalances.filter((balance) => balance.onHandQuantity <= balance.reorderPoint).length,
    },
    locationScope: scope ? { id: scope.id, name: scope.name } : null,
    source: {
      calculation: scope
        ? `Recorded lot quantities and POS balances mapped to ${scope.name}, joined to location-tagged SKU sale movements. Missing demand, cost, margin, and dates are never imputed.`
        : "Recorded lot quantities joined to tenant-scoped SKU sale movements; no missing demand, cost, margin, or dates are imputed.",
      generatedAt: now.toISOString(),
    },
  };
}

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, roles, "inventory.lots");
    await requirePermission(context, "inventory.view");
    await enforceRateLimit("inventory-lifecycle:read", context.userId, 90, 60);
    const scope = await requestScope(request, context);
    const canViewValue = (await effectivePermissions(context)).includes("inventory.value");
    return jsonResponse(await lifecycleDto(context.organizationId, scope, canViewValue));
  });
}

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, roles, "inventory.lots");
    await requirePermission(context, "inventory.adjust");
    await enforceRateLimit("inventory-lifecycle:write", context.userId, 50, 3_600);
    const input = await readJsonObject(request, 64_000);
    const action = cleanText(input.action, "action", 20);
    const data = lotInput(input);
    const scope = await requestScope(request, context);
    if (scope && !scope.refs.has(data.locationRef)) {
      throw new ApiError(403, "LOCATION_ACCESS_DENIED", "Save this lot to the selected location or switch the dashboard location first.");
    }
    const now = new Date();
    const database = getD1();

    if (action === "create") {
      const id = crypto.randomUUID();
      const status = data.quantityRemaining === 0 ? "depleted" : data.status;
      try {
        await database.batch([
          database.prepare(`INSERT INTO inventory_lots
            (id, organization_id, location_ref, sku, product_name, supplier_name, lot_number, batch_number,
             manufacturing_date, received_date, expiration_date, best_before_date, shelf_life_days,
             unit_cost_cents, unit_retail_cents, quantity_received, quantity_remaining, storage_notes,
             status, source_system, source_ref, version, created_by_user_id, updated_by_user_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', NULL, 1, ?, ?, ?, ?)`)
            .bind(id, context.organizationId, data.locationRef, data.sku, data.productName, data.supplierName,
              data.lotNumber, data.batchNumber, data.manufacturingDate, data.receivedDate, data.expirationDate,
              data.bestBeforeDate, data.shelfLifeDays, data.unitCostCents, data.unitRetailCents,
              data.quantityRemaining, data.quantityRemaining, data.storageNotes, status,
              context.userId, context.userId, now, now),
          ...(data.quantityRemaining > 0 ? [database.prepare(`INSERT INTO inventory_lot_movements
            (id, organization_id, lot_id, operational_event_id, quantity_delta, reason, notes, occurred_at, created_by_user_id, created_at)
            VALUES (?, ?, ?, NULL, ?, 'receipt', 'Manual lot opening balance', ?, ?, ?)`)
            .bind(crypto.randomUUID(), context.organizationId, id, data.quantityRemaining, new Date(`${data.receivedDate}T12:00:00Z`), context.userId, now)] : []),
        ]);
      } catch (error) {
        if (error instanceof Error && /unique/i.test(error.message)) {
          throw new ApiError(409, "LOT_EXISTS", "This SKU, location, lot, batch, and received-date combination already exists.");
        }
        throw error;
      }
      await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
        action: "inventory.lot_created", resourceType: "inventory_lot", resourceId: id,
        details: { sku: data.sku, locationRef: data.locationRef, quantity: data.quantityRemaining, expirationDate: data.expirationDate } });
    } else if (action === "update") {
      const id = cleanText(input.lotId, "inventory lot", 100);
      const version = integer(input.version, "record version", 1);
      const existing = await getDb().select().from(inventoryLots)
        .where(and(eq(inventoryLots.id, id), eq(inventoryLots.organizationId, context.organizationId))).limit(1);
      const before = existing[0];
      if (!before) throw new ApiError(404, "LOT_NOT_FOUND", "This inventory lot was not found.");
      if (scope && !scope.refs.has(before.locationRef)) {
        throw new ApiError(403, "LOCATION_ACCESS_DENIED", "This inventory lot is not available in the selected location scope.");
      }
      if (before.version !== version) {
        throw new ApiError(409, "STALE_RECORD", "This lot changed after you opened it. Reload and review the latest values.");
      }
      const delta = data.quantityRemaining - before.quantityRemaining;
      const status = data.quantityRemaining === 0 ? "depleted" : data.status;
      const update = database.prepare(`UPDATE inventory_lots SET
          location_ref = ?, sku = ?, product_name = ?, supplier_name = ?, lot_number = ?, batch_number = ?,
          manufacturing_date = ?, received_date = ?, expiration_date = ?, best_before_date = ?, shelf_life_days = ?,
          unit_cost_cents = ?, unit_retail_cents = ?, quantity_received = CASE WHEN ? > quantity_received THEN ? ELSE quantity_received END,
          quantity_remaining = ?, storage_notes = ?, status = ?, version = version + 1,
          updated_by_user_id = ?, updated_at = ?
        WHERE id = ? AND organization_id = ? AND version = ?`)
        .bind(data.locationRef, data.sku, data.productName, data.supplierName, data.lotNumber, data.batchNumber,
          data.manufacturingDate, data.receivedDate, data.expirationDate, data.bestBeforeDate, data.shelfLifeDays,
          data.unitCostCents, data.unitRetailCents, data.quantityRemaining, data.quantityRemaining,
          data.quantityRemaining, data.storageNotes, status, context.userId, now, id, context.organizationId, version);
      const statements = [update];
      if (delta !== 0) statements.push(database.prepare(`INSERT INTO inventory_lot_movements
        (id, organization_id, lot_id, operational_event_id, quantity_delta, reason, notes, occurred_at, created_by_user_id, created_at)
        VALUES (?, ?, ?, NULL, ?, 'adjustment', 'Authorized manual quantity correction', ?, ?, ?)`)
        .bind(crypto.randomUUID(), context.organizationId, id, delta, now, context.userId, now));
      const results = await database.batch(statements);
      if (!results[0]?.meta || Number((results[0].meta as { changes?: number }).changes ?? 0) !== 1) {
        throw new ApiError(409, "STALE_RECORD", "This lot changed after you opened it. Reload and review the latest values.");
      }
      await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
        action: "inventory.lot_updated", resourceType: "inventory_lot", resourceId: id,
        details: { sku: data.sku, locationRef: data.locationRef, quantityBefore: before.quantityRemaining,
          quantityAfter: data.quantityRemaining, expirationBefore: before.expirationDate, expirationAfter: data.expirationDate } });
    } else {
      throw new ApiError(400, "UNKNOWN_ACTION", "Select a supported inventory-lot action.");
    }
    const canViewValue = (await effectivePermissions(context)).includes("inventory.value");
    return jsonResponse(await lifecycleDto(context.organizationId, scope, canViewValue), { status: action === "create" ? 201 : 200 });
  });
}
