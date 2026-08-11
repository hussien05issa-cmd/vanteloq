import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { integrationConnections, integrationWebhookEvents } from "../../../../../../db/schema";
import { ApiError, handleApi, jsonResponse } from "../../../../../../server/api";
import { PLAID_PROVIDER, syncPlaidTransactions, verifyPlaidWebhook } from "../../../../../../server/integrations/plaid";

async function sha256(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function POST(request: Request) {
  return handleApi(request, async () => {
    const signature = request.headers.get("Plaid-Verification")?.trim() ?? "";
    if (!signature) throw new ApiError(401, "PLAID_WEBHOOK_SIGNATURE_REQUIRED", "Plaid webhook verification is required.");
    const rawBody = await request.text();
    if (rawBody.length > 256_000) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "The webhook payload is too large.");
    await verifyPlaidWebhook(rawBody, signature);
    let body: { item_id?: unknown; webhook_type?: unknown; webhook_code?: unknown };
    try { body = JSON.parse(rawBody); } catch { throw new ApiError(400, "INVALID_JSON", "The webhook body is invalid."); }
    if (typeof body.item_id !== "string" || typeof body.webhook_type !== "string" || typeof body.webhook_code !== "string") {
      throw new ApiError(400, "PLAID_WEBHOOK_INVALID", "The webhook body is invalid.");
    }
    const [connection] = await getDb().select({ organizationId: integrationConnections.organizationId })
      .from(integrationConnections).where(and(
        eq(integrationConnections.provider, PLAID_PROVIDER),
        eq(integrationConnections.externalAccountRef, body.item_id),
        eq(integrationConnections.status, "connected"),
      )).limit(1);
    if (!connection) return jsonResponse({ accepted: true });
    const payloadHash = await sha256(rawBody);
    const [existing] = await getDb().select({ id: integrationWebhookEvents.id }).from(integrationWebhookEvents).where(and(
      eq(integrationWebhookEvents.organizationId, connection.organizationId),
      eq(integrationWebhookEvents.provider, PLAID_PROVIDER),
      eq(integrationWebhookEvents.payloadHash, payloadHash),
    )).limit(1);
    if (existing) return jsonResponse({ accepted: true, duplicate: true });
    const eventId = crypto.randomUUID();
    await getDb().insert(integrationWebhookEvents).values({
      id: eventId,
      organizationId: connection.organizationId,
      provider: PLAID_PROVIDER,
      payloadHash,
      signatureHash: await sha256(signature),
      eventType: `${body.webhook_type}:${body.webhook_code}`,
      externalObjectRef: body.item_id,
      status: "queued",
      receivedAt: new Date(),
    });
    if (body.webhook_type === "TRANSACTIONS" && body.webhook_code === "SYNC_UPDATES_AVAILABLE") {
      try {
        await syncPlaidTransactions(connection.organizationId);
        await getDb().update(integrationWebhookEvents).set({ status: "processed", processedAt: new Date() }).where(eq(integrationWebhookEvents.id, eventId));
      } catch {
        return jsonResponse({ accepted: true, queued: true });
      }
    }
    return jsonResponse({ accepted: true });
  });
}
