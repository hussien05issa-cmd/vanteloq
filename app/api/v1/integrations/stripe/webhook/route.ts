import { and, eq, ne } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { integrationConnections, integrationWebhookEvents } from "../../../../../../db/schema";
import { ApiError, handleApi, jsonResponse, readRequestBytes } from "../../../../../../server/api";
import { sha256Hex, STRIPE_PROVIDER, verifyStripeWebhookSignature } from "../../../../../../server/integrations/stripe";

const MAXIMUM_WEBHOOK_BYTES = 256_000;

export async function POST(request: Request) {
  return handleApi(request, async () => {
    if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      throw new ApiError(415, "STRIPE_WEBHOOK_CONTENT_TYPE", "Stripe webhook content type is invalid.");
    }
    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAXIMUM_WEBHOOK_BYTES) {
      throw new ApiError(413, "STRIPE_WEBHOOK_TOO_LARGE", "The Stripe webhook is too large.");
    }
    const bytes = await readRequestBytes(request, MAXIMUM_WEBHOOK_BYTES, "STRIPE_WEBHOOK_TOO_LARGE", "The Stripe webhook is too large.");
    if (bytes.byteLength > MAXIMUM_WEBHOOK_BYTES) {
      throw new ApiError(413, "STRIPE_WEBHOOK_TOO_LARGE", "The Stripe webhook is too large.");
    }
    const signature = await verifyStripeWebhookSignature(bytes, request.headers.get("stripe-signature"));
    if (!signature.valid) {
      throw new ApiError(401, "STRIPE_WEBHOOK_SIGNATURE_INVALID", "The Stripe webhook signature is invalid or expired.");
    }
    let event: Record<string, unknown>;
    try {
      const parsed = JSON.parse(new TextDecoder().decode(bytes));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
      event = parsed as Record<string, unknown>;
    } catch {
      throw new ApiError(400, "STRIPE_WEBHOOK_PAYLOAD_INVALID", "The Stripe webhook payload is invalid.");
    }
    const eventId = typeof event.id === "string" ? event.id : "";
    const eventType = typeof event.type === "string" ? event.type : "";
    const accountId = typeof event.account === "string" ? event.account : "";
    if (!eventId.startsWith("evt_") || !eventType || !accountId.startsWith("acct_")) {
      throw new ApiError(400, "STRIPE_WEBHOOK_PAYLOAD_INVALID", "The Stripe webhook is missing its connected-account identity.");
    }
    const connections = await getDb().select({
      id: integrationConnections.id,
      organizationId: integrationConnections.organizationId,
    }).from(integrationConnections).where(and(
      eq(integrationConnections.provider, STRIPE_PROVIDER),
      eq(integrationConnections.externalAccountRef, accountId),
      eq(integrationConnections.status, "connected"),
    )).limit(2);
    if (connections.length > 1) {
      throw new ApiError(409, "STRIPE_CONNECTION_AMBIGUOUS", "The Stripe webhook could not be matched to one verified connection.");
    }
    const [connection] = connections;
    if (!connection) throw new ApiError(404, "STRIPE_CONNECTION_NOT_FOUND", "No verified Stripe connection matches this webhook.");
    const data = event.data && typeof event.data === "object" && !Array.isArray(event.data)
      ? event.data as Record<string, unknown>
      : {};
    const object = data.object && typeof data.object === "object" && !Array.isArray(data.object)
      ? data.object as Record<string, unknown>
      : {};
    const externalObjectRef = typeof object.id === "string" ? object.id.slice(0, 128) : null;
    const payloadHash = await sha256Hex(bytes);
    const receivedAt = new Date();
    const result = await getDb().insert(integrationWebhookEvents).values({
      id: crypto.randomUUID(),
      organizationId: connection.organizationId,
      provider: STRIPE_PROVIDER,
      connectionId: connection.id,
      payloadHash,
      signatureHash: signature.signatureHash,
      eventType: eventType.slice(0, 160),
      externalObjectRef,
      status: "processed",
      receivedAt,
      processedAt: receivedAt,
    }).onConflictDoNothing({
      target: [
        integrationWebhookEvents.organizationId,
        integrationWebhookEvents.provider,
        integrationWebhookEvents.connectionId,
        integrationWebhookEvents.payloadHash,
      ],
    }).returning({ id: integrationWebhookEvents.id });
    if (result.length === 0) {
      await getDb().update(integrationWebhookEvents).set({
        status: "processed",
        processedAt: receivedAt,
      }).where(and(
        eq(integrationWebhookEvents.organizationId, connection.organizationId),
        eq(integrationWebhookEvents.provider, STRIPE_PROVIDER),
        eq(integrationWebhookEvents.connectionId, connection.id),
        eq(integrationWebhookEvents.payloadHash, payloadHash),
        ne(integrationWebhookEvents.status, "processed"),
      ));
    }
    return jsonResponse({ received: true, duplicate: result.length === 0, processed: true, queued: false }, { status: 200 });
  });
}
