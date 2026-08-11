import { getD1 } from "../../../../db";
import { recordAudit } from "../../../../server/audit";
import { requireAccess } from "../../../../server/authorization";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../server/api";
import { buildInventoryWrites, confirmationCopy, eventKey, parsePaymentSettlement } from "../../../../server/operations";
import { requirePermission } from "../../../../server/permissions";
import { authorizedLocationDataScope } from "../../../../server/location-access";

const readers = ["owner", "admin", "manager", "read_only"] as const;
const writers = ["owner", "admin", "manager"] as const;

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, readers);
    await requirePermission(context, "customers.identity");
    await enforceRateLimit("operations:feed", context.userId, 120, 60);
    const url = new URL(request.url);
    const scope = await authorizedLocationDataScope(context, url.searchParams.get("location"));
    const locationRefs = scope.locationRefs;
    const placeholders = locationRefs?.map(() => "?").join(", ") ?? "";
    const eventLocationClause = locationRefs === null ? "" : locationRefs.length
      ? ` AND json_extract(payload_json, '$.locationRef') IN (${placeholders})`
      : " AND 1 = 0";
    const messageLocationClause = locationRefs === null ? "" : locationRefs.length
      ? ` AND json_extract(e.payload_json, '$.locationRef') IN (${placeholders})`
      : " AND 1 = 0";
    const inventoryLocationClause = locationRefs === null ? "" : locationRefs.length
      ? ` AND location_ref IN (${placeholders})`
      : " AND 1 = 0";
    const after = Math.max(0, Number.parseInt(url.searchParams.get("after") || "0", 10) || 0);
    const database = getD1();
    type RawEvent = { id: string; eventType: string; aggregateType: string; aggregateId: string; sourceSystem: string; payloadJson: string; occurredAt: number; recordedAt: number };
    type RawMessage = { id: string; channel: string; recipient: string; subject: string; status: string; attemptCount: number; createdAt: number; updatedAt: number; payloadJson: string };
    type RawInventory = { locationRef: string; sku: string; name: string; projectedQuantity: number; reorderPoint: number; updatedAt: number };
    const [eventResult, messageResult, inventoryResult] = await Promise.all([
      database.prepare(`SELECT id, event_type AS eventType, aggregate_type AS aggregateType, aggregate_id AS aggregateId,
        source_system AS sourceSystem, payload_json AS payloadJson, occurred_at AS occurredAt, recorded_at AS recordedAt
        FROM operational_events WHERE organization_id = ? AND recorded_at > ?${eventLocationClause} ORDER BY recorded_at ASC, id ASC LIMIT 200`)
        .bind(context.organizationId, after, ...(locationRefs ?? [])).all<RawEvent>(),
      database.prepare(`SELECT m.id, m.channel, m.recipient, m.subject, m.status, m.attempt_count AS attemptCount,
        m.created_at AS createdAt, m.updated_at AS updatedAt, e.payload_json AS payloadJson
        FROM outbound_messages m INNER JOIN operational_events e
          ON e.organization_id = m.organization_id AND e.id = m.operational_event_id
        WHERE m.organization_id = ?${messageLocationClause} ORDER BY m.created_at DESC LIMIT 100`).bind(context.organizationId, ...(locationRefs ?? [])).all<RawMessage>(),
      database.prepare(`WITH trusted_balances AS (
          SELECT b.* FROM inventory_balances b
          WHERE b.organization_id = ?
            AND (
              b.source_connection_id IS NULL
              OR EXISTS (
                SELECT 1 FROM integration_connections approved
                WHERE approved.id = b.source_connection_id
                  AND approved.organization_id = b.organization_id
                  AND approved.provider = b.source_provider
                  AND approved.status = 'connected'
                  AND approved.data_promotion_status = 'approved'
                  AND approved.sync_lease_owner IS NULL
              )
            )
        ), inventory_keys AS (
          SELECT location_ref, sku, name FROM trusted_balances WHERE 1 = 1${inventoryLocationClause}
          UNION
          SELECT location_ref, sku, MAX(item_name) AS name FROM inventory_movements WHERE organization_id = ?${inventoryLocationClause} GROUP BY location_ref, sku
        )
        SELECT k.location_ref AS locationRef, k.sku, k.name,
          COALESCE(b.on_hand_quantity, 0) + COALESCE(SUM(m.quantity_delta), 0) AS projectedQuantity,
          COALESCE(b.reorder_point, 0) AS reorderPoint, COALESCE(b.updated_at, MAX(m.occurred_at)) AS updatedAt
        FROM inventory_keys k LEFT JOIN trusted_balances b
          ON b.location_ref = k.location_ref AND b.sku = k.sku
        LEFT JOIN inventory_movements m
          ON m.organization_id = ? AND m.location_ref = k.location_ref AND m.sku = k.sku
        GROUP BY k.location_ref, k.sku, k.name, b.id ORDER BY projectedQuantity ASC LIMIT 250`)
        .bind(
          context.organizationId, ...(locationRefs ?? []),
          context.organizationId, ...(locationRefs ?? []),
          context.organizationId,
        ).all<RawInventory>(),
    ]);
    const parsePayload = (value: string) => {
      try { return JSON.parse(value) as { locationRef?: unknown }; } catch { return {}; }
    };
    const rawEvents = eventResult.results ?? [];
    const events = rawEvents.flatMap((row) => {
      const payload = parsePayload(row.payloadJson);
      return [{ ...row, payload, payloadJson: undefined }];
    });
    const messages = (messageResult.results ?? []).map((row) => ({
      id: row.id,
      channel: row.channel,
      recipient: row.recipient,
      subject: row.subject,
      status: row.status,
      attemptCount: row.attemptCount,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
    const inventory = inventoryResult.results ?? [];
    const cursor = rawEvents.reduce((maximum, row) => Math.max(maximum, Number(row.recordedAt)), after);
    return jsonResponse({ cursor, events, messages, inventory });
  });
}

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, writers);
    await requirePermission(context, "inventory.adjust");
    await enforceRateLimit("operations:settle", context.userId, 120, 60);
    const settlement = parsePaymentSettlement(await readJsonObject(request, 131_072));
    const scope = await authorizedLocationDataScope(context, new URL(request.url).searchParams.get("location"));
    if (scope.locationRefs !== null && !scope.locationRefs.includes(settlement.locationRef)) {
      throw new ApiError(403, "LOCATION_ACCESS_DENIED", "This settlement location is not available to your account.");
    }
    const eventId = eventKey(context.organizationId, settlement);
    const movements = buildInventoryWrites(eventId, settlement);
    const messageId = `${eventId}:confirmation`;
    const message = confirmationCopy(settlement);
    const now = new Date();
    const database = getD1();
    const existing = await database.prepare("SELECT id FROM operational_events WHERE organization_id = ? AND id = ?").bind(context.organizationId, eventId).first();
    if (existing) return jsonResponse({ accepted: true, replayed: true, eventId }, { status: 200 });

    const requestedLots = new Map<string, { sku: string; quantity: number }>();
    let untracedLotUnits = 0;
    for (const line of settlement.lines) {
      if (!line.lotId) {
        untracedLotUnits += line.quantity;
        continue;
      }
      const current = requestedLots.get(line.lotId);
      if (current && current.sku !== line.sku) {
        throw new ApiError(409, "LOT_SKU_CONFLICT", "A single inventory lot cannot be assigned to different SKUs in one settlement.");
      }
      requestedLots.set(line.lotId, { sku: line.sku, quantity: (current?.quantity ?? 0) + line.quantity });
    }
    type LotRow = { id: string; sku: string; locationRef: string; quantityRemaining: number; status: string };
    const tracedLots: { lot: LotRow; quantity: number }[] = [];
    for (const [lotId, requested] of requestedLots) {
      const lot = await database.prepare(`SELECT id, sku, location_ref AS locationRef,
        quantity_remaining AS quantityRemaining, status FROM inventory_lots
        WHERE organization_id = ? AND id = ?`).bind(context.organizationId, lotId).first<LotRow>();
      if (!lot) throw new ApiError(404, "LOT_NOT_FOUND", `Inventory lot ${lotId} was not found for this business.`);
      if (lot.sku !== requested.sku || lot.locationRef !== settlement.locationRef) {
        throw new ApiError(409, "LOT_MISMATCH", `Inventory lot ${lotId} does not match the settlement SKU and location.`);
      }
      if (lot.status !== "active" || Number(lot.quantityRemaining) < requested.quantity) {
        throw new ApiError(409, "LOT_UNAVAILABLE", `Inventory lot ${lotId} is not active or does not have enough recorded units.`);
      }
      tracedLots.push({ lot, quantity: requested.quantity });
    }

    const statements = [
      database.prepare(`INSERT OR IGNORE INTO operational_events
        (id, organization_id, event_type, aggregate_type, aggregate_id, source_system, source_event_id, payload_json, occurred_at, recorded_at)
        VALUES (?, ?, 'payment.settled', 'sale', ?, ?, ?, ?, ?, ?)`).bind(
          eventId, context.organizationId, settlement.paymentId, settlement.sourceSystem, settlement.sourceEventId,
          JSON.stringify({ paymentId: settlement.paymentId, locationRef: settlement.locationRef, totalCents: settlement.totalCents, currency: settlement.currency, lineCount: settlement.lines.length }),
          settlement.occurredAt, now,
        ),
      ...movements.map((movement) => database.prepare(`INSERT OR IGNORE INTO inventory_movements
        (id, organization_id, operational_event_id, location_ref, sku, item_name, quantity_delta, reason, occurred_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'sale', ?)`).bind(movement.movementId, context.organizationId, eventId, settlement.locationRef, movement.sku, movement.name, movement.quantityDelta, settlement.occurredAt)),
      ...tracedLots.flatMap(({ lot, quantity }, index) => [
        database.prepare(`INSERT INTO inventory_lot_movements
          (id, organization_id, lot_id, operational_event_id, quantity_delta, reason, notes, occurred_at, created_by_user_id, created_at)
          VALUES (?, ?, ?, ?, ?, 'sale', 'Provider-supplied lot trace', ?, ?, ?)`).bind(
            `${eventId}:lot:${index + 1}`, context.organizationId, lot.id, eventId, -quantity,
            settlement.occurredAt, context.userId, now,
          ),
        database.prepare(`UPDATE inventory_lots SET quantity_remaining = quantity_remaining - ?,
          status = CASE WHEN quantity_remaining - ? = 0 THEN 'depleted' ELSE status END,
          version = version + 1, updated_by_user_id = ?, updated_at = ?
          WHERE organization_id = ? AND id = ? AND status = 'active' AND quantity_remaining >= ?`).bind(
            quantity, quantity, context.userId, now, context.organizationId, lot.id, quantity,
          ),
      ]),
      ...(settlement.customerEmail ? [database.prepare(`INSERT OR IGNORE INTO outbound_messages
        (id, organization_id, operational_event_id, channel, recipient, subject, body_text, status, attempt_count, created_at, updated_at)
        VALUES (?, ?, ?, 'email', ?, ?, ?, 'held', 0, ?, ?)`).bind(messageId, context.organizationId, eventId, settlement.customerEmail, message.subject, message.bodyText, now, now)] : []),
    ];
    await database.batch(statements);
    await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId, action: "payment.settlement_recorded", resourceType: "operational_event", resourceId: eventId, details: {
      sourceSystem: settlement.sourceSystem,
      lineCount: settlement.lines.length,
      tracedLotUnits: tracedLots.reduce((sum, item) => sum + item.quantity, 0),
      untracedLotUnits,
      confirmationHeld: Boolean(settlement.customerEmail),
    } });
    return jsonResponse({ accepted: true, replayed: false, eventId, inventoryMovements: movements.length,
      lotTrace: {
        recordedUnits: tracedLots.reduce((sum, item) => sum + item.quantity, 0),
        untracedUnits: untracedLotUnits,
        status: untracedLotUnits > 0 ? "partial_or_unavailable_without_provider_lot_id" : "recorded_from_provider_lot_id",
      },
      confirmationStatus: settlement.customerEmail ? "held_until_email_provider_is_configured" : "not_requested" }, { status: 202 });
  });
}
