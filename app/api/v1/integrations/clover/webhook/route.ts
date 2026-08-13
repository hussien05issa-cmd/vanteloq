import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { integrationConnections, integrationWebhookEvents } from "../../../../../../db/schema";
import { ApiError, handleApi, jsonResponse } from "../../../../../../server/api";
import { CLOVER_PROVIDER, cloverSha256, verifyCloverWebhookAppId, verifyCloverWebhookAuth } from "../../../../../../server/integrations/clover";

const MAXIMUM_WEBHOOK_BYTES = 256_000;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function POST(request: Request) {
  return handleApi(request, async () => {
    if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      throw new ApiError(415, "CLOVER_WEBHOOK_CONTENT_TYPE", "The Clover webhook content type is invalid.");
    }
    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAXIMUM_WEBHOOK_BYTES) throw new ApiError(413, "CLOVER_WEBHOOK_TOO_LARGE", "The Clover webhook is too large.");
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > MAXIMUM_WEBHOOK_BYTES) throw new ApiError(413, "CLOVER_WEBHOOK_TOO_LARGE", "The Clover webhook is too large.");
    let payload: Record<string, unknown>;
    try { payload = record(JSON.parse(new TextDecoder().decode(bytes))); }
    catch { throw new ApiError(400, "CLOVER_WEBHOOK_PAYLOAD_INVALID", "The Clover webhook payload is invalid."); }

    // Clover's one-time dashboard verification carries no merchant data and
    // cannot schedule work. It is safe to acknowledge without provider auth.
    if (typeof payload.verificationCode === "string" && payload.verificationCode.length <= 256 && Object.keys(payload).length === 1) {
      console.info("Clover webhook verification code", payload.verificationCode);
      return jsonResponse({ received: true, verification: true }, { status: 200 });
    }
    const auth = request.headers.get("x-clover-auth");
    if (!verifyCloverWebhookAuth(auth)) throw new ApiError(401, "CLOVER_WEBHOOK_AUTH_INVALID", "The Clover webhook authentication value is invalid.");
    const merchants = record(payload.merchants);
    if (!verifyCloverWebhookAppId(payload.appId)) throw new ApiError(401, "CLOVER_WEBHOOK_APP_INVALID", "The Clover webhook application identifier is invalid.");
    if (!Object.keys(merchants).length) throw new ApiError(400, "CLOVER_WEBHOOK_PAYLOAD_INVALID", "The Clover webhook is missing merchant events.");
    const signatureHash = await cloverSha256(auth ?? "");
    let queued = 0;
    let duplicates = 0;
    for (const [merchantId, notificationsValue] of Object.entries(merchants)) {
      if (!/^[A-Za-z0-9_-]{4,128}$/.test(merchantId) || !Array.isArray(notificationsValue)) continue;
      const connections = await getDb().select({ id: integrationConnections.id, organizationId: integrationConnections.organizationId }).from(integrationConnections).where(and(
        eq(integrationConnections.provider, CLOVER_PROVIDER), eq(integrationConnections.externalAccountRef, merchantId), eq(integrationConnections.status, "connected"),
      )).limit(2);
      if (connections.length !== 1) continue;
      const connection = connections[0];
      for (const notificationValue of notificationsValue.slice(0, 1000)) {
        const notification = record(notificationValue);
        const objectId = typeof notification.objectId === "string" ? notification.objectId.slice(0, 160) : null;
        const eventType = typeof notification.type === "string" ? notification.type.slice(0, 160) : "unknown";
        if (!objectId) continue;
        const payloadHash = await cloverSha256(`${merchantId}\0${eventType}\0${objectId}\0${String(notification.ts ?? "")}`);
        const inserted = await getDb().insert(integrationWebhookEvents).values({
          id: crypto.randomUUID(), organizationId: connection.organizationId, provider: CLOVER_PROVIDER,
          connectionId: connection.id, payloadHash, signatureHash, eventType, externalObjectRef: objectId,
          status: "queued", receivedAt: new Date(), processedAt: null,
        }).onConflictDoNothing({ target: [integrationWebhookEvents.organizationId, integrationWebhookEvents.provider, integrationWebhookEvents.connectionId, integrationWebhookEvents.payloadHash] }).returning({ id: integrationWebhookEvents.id });
        if (inserted) queued += 1; else duplicates += 1;
      }
    }
    return jsonResponse({ received: true, queued, duplicates, processed: false }, { status: 200 });
  });
}
