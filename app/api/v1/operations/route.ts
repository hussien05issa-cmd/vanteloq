import { getD1 } from "../../../../db";
import { recordAudit } from "../../../../server/audit";
import { requireAccess } from "../../../../server/authorization";
import { enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../server/api";
import { buildInventoryWrites, confirmationCopy, eventKey, parsePaymentSettlement } from "../../../../server/operations";
import { requirePermission } from "../../../../server/permissions";

const readers = ["owner", "admin", "manager", "read_only"] as const;
const writers = ["owner", "admin", "manager"] as const;

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, readers);
    await requirePermission(context, "customers.identity");
    await enforceRateLimit("operations:feed", context.userId, 120, 60);
    const url = new URL(request.url);
    const after = Math.max(0, Number.parseInt(url.searchParams.get("after") || "0", 10) || 0);
    const database = getD1();
    type RawEvent = { id: string; eventType: string; aggregateType: string; aggregateId: string; sourceSystem: string; payloadJson: string; occurredAt: number; recordedAt: number };
    const [eventResult, messageResult, inventoryResult] = await Promise.all([
      database.prepare(`SELECT id, event_type AS eventType, aggregate_type AS aggregateType, aggregate_id AS aggregateId,
        source_system AS sourceSystem, payload_json AS payloadJson, occurred_at AS occurredAt, recorded_at AS recordedAt
        FROM operational_events WHERE organization_id = ? AND recorded_at > ? ORDER BY recorded_at ASC, id ASC LIMIT 200`)
        .bind(context.organizationId, after).all<RawEvent>(),
      database.prepare(`SELECT id, channel, recipient, subject, status, attempt_count AS attemptCount,
        created_at AS createdAt, updated_at AS updatedAt FROM outbound_messages
        WHERE organization_id = ? ORDER BY created_at DESC LIMIT 100`).bind(context.organizationId).all(),
      database.prepare(`WITH inventory_keys AS (
          SELECT location_ref, sku, name FROM inventory_balances WHERE organization_id = ?
          UNION
          SELECT location_ref, sku, MAX(item_name) AS name FROM inventory_movements WHERE organization_id = ? GROUP BY location_ref, sku
        )
        SELECT k.location_ref AS locationRef, k.sku, k.name,
          COALESCE(b.on_hand_quantity, 0) + COALESCE(SUM(m.quantity_delta), 0) AS projectedQuantity,
          COALESCE(b.reorder_point, 0) AS reorderPoint, COALESCE(b.updated_at, MAX(m.occurred_at)) AS updatedAt
        FROM inventory_keys k LEFT JOIN inventory_balances b
          ON b.organization_id = ? AND b.location_ref = k.location_ref AND b.sku = k.sku
        LEFT JOIN inventory_movements m
          ON m.organization_id = ? AND m.location_ref = k.location_ref AND m.sku = k.sku
        GROUP BY k.location_ref, k.sku, k.name, b.id ORDER BY projectedQuantity ASC LIMIT 250`)
        .bind(context.organizationId, context.organizationId, context.organizationId, context.organizationId).all(),
    ]);
    const events = (eventResult.results ?? []).map((row) => ({ ...row, payload: JSON.parse(row.payloadJson), payloadJson: undefined }));
    const cursor = events.reduce((maximum, row) => Math.max(maximum, Number(row.recordedAt)), after);
    return jsonResponse({ cursor, events, messages: messageResult.results, inventory: inventoryResult.results });
  });
}

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, writers);
    await requirePermission(context, "inventory.adjust");
    await enforceRateLimit("operations:settle", context.userId, 120, 60);
    const settlement = parsePaymentSettlement(await readJsonObject(request, 131_072));
    const eventId = eventKey(context.organizationId, settlement);
    const movements = buildInventoryWrites(eventId, settlement);
    const messageId = `${eventId}:confirmation`;
    const message = confirmationCopy(settlement);
    const now = new Date();
    const database = getD1();
    const existing = await database.prepare("SELECT id FROM operational_events WHERE organization_id = ? AND id = ?").bind(context.organizationId, eventId).first();
    if (existing) return jsonResponse({ accepted: true, replayed: true, eventId }, { status: 200 });

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
      ...(settlement.customerEmail ? [database.prepare(`INSERT OR IGNORE INTO outbound_messages
        (id, organization_id, operational_event_id, channel, recipient, subject, body_text, status, attempt_count, created_at, updated_at)
        VALUES (?, ?, ?, 'email', ?, ?, ?, 'held', 0, ?, ?)`).bind(messageId, context.organizationId, eventId, settlement.customerEmail, message.subject, message.bodyText, now, now)] : []),
    ];
    await database.batch(statements);
    await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId, action: "payment.settlement_recorded", resourceType: "operational_event", resourceId: eventId, details: { sourceSystem: settlement.sourceSystem, lineCount: settlement.lines.length, confirmationHeld: Boolean(settlement.customerEmail) } });
    return jsonResponse({ accepted: true, replayed: false, eventId, inventoryMovements: movements.length, confirmationStatus: settlement.customerEmail ? "held_until_email_provider_is_configured" : "not_requested" }, { status: 202 });
  });
}
