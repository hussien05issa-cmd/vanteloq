import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { integrationConnections, integrationWebhookEvents } from "../../../../../../db/schema";
import { ApiError, handleApi, jsonResponse, readRequestBytes } from "../../../../../../server/api";
import { record, SQUARE_PROVIDER, squareSha256, verifySquareWebhook } from "../../../../../../server/integrations/square";

const MAX_BYTES = 256_000;
export async function POST(request: Request) {
  return handleApi(request, async () => {
    const bytes = await readRequestBytes(request, MAX_BYTES, "SQUARE_WEBHOOK_TOO_LARGE", "The Square webhook is too large.");
    if (bytes.byteLength > MAX_BYTES) throw new ApiError(413, "SQUARE_WEBHOOK_TOO_LARGE", "The Square webhook is too large.");
    const raw = new TextDecoder().decode(bytes);
    if (!await verifySquareWebhook(raw, request.headers.get("x-square-hmacsha256-signature"))) throw new ApiError(401, "SQUARE_WEBHOOK_SIGNATURE_INVALID", "The Square webhook signature is invalid.");
    let payload: Record<string, unknown>;
    try { payload = record(JSON.parse(raw)); } catch { throw new ApiError(400, "SQUARE_WEBHOOK_PAYLOAD_INVALID", "The Square webhook payload is invalid."); }
    const eventId = typeof payload.event_id === "string" ? payload.event_id : "";
    const merchantId = typeof payload.merchant_id === "string" ? payload.merchant_id : "";
    const eventType = typeof payload.type === "string" ? payload.type.slice(0, 160) : "unknown";
    if (!eventId || !merchantId) throw new ApiError(400, "SQUARE_WEBHOOK_PAYLOAD_INVALID", "The Square webhook is missing its event or merchant identifier.");
    const connections = await getDb().select({ id: integrationConnections.id, organizationId: integrationConnections.organizationId }).from(integrationConnections).where(and(eq(integrationConnections.provider, SQUARE_PROVIDER), eq(integrationConnections.externalAccountRef, merchantId), eq(integrationConnections.status, "connected"))).limit(2);
    if (connections.length !== 1) return jsonResponse({ received: true, queued: false }, { status: 200 });
    const connection = connections[0];
    const payloadHash = await squareSha256(eventId);
    const signatureHash = await squareSha256(request.headers.get("x-square-hmacsha256-signature") ?? "");
    const inserted = await getDb().insert(integrationWebhookEvents).values({ id: crypto.randomUUID(), organizationId: connection.organizationId, provider: SQUARE_PROVIDER, connectionId: connection.id, payloadHash, signatureHash, eventType, externalObjectRef: eventId.slice(0, 160), status: "queued", receivedAt: new Date(), processedAt: null }).onConflictDoNothing({ target: [integrationWebhookEvents.organizationId, integrationWebhookEvents.provider, integrationWebhookEvents.connectionId, integrationWebhookEvents.payloadHash] }).returning({ id: integrationWebhookEvents.id });
    return jsonResponse({ received: true, queued: Boolean(inserted.length), duplicate: !inserted.length }, { status: 200 });
  });
}
