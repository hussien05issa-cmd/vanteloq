import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { integrationConnections, integrationWebhookEvents } from "../../../../../../db/schema";
import { ApiError, handleApi, jsonResponse } from "../../../../../../server/api";
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
    const bytes = new Uint8Array(await request.arrayBuffer());
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
    const [connection] = await getDb().select({ organizationId: integrationConnections.organizationId }).from(integrationConnections).where(and(
      eq(integrationConnections.provider, STRIPE_PROVIDER),
      eq(integrationConnections.externalAccountRef, accountId),
      eq(integrationConnections.status, "connected"),
    )).limit(1);
    if (!connection) throw new ApiError(404, "STRIPE_CONNECTION_NOT_FOUND", "No verified Stripe connection matches this webhook.");
    const data = event.data && typeof event.data === "object" && !Array.isArray(event.data)
      ? event.data as Record<string, unknown>
      : {};
    const object = data.object && typeof data.object === "object" && !Array.isArray(data.object)
      ? data.object as Record<string, unknown>
      : {};
    const externalObjectRef = typeof object.id === "string" ? object.id.slice(0, 128) : null;
    const payloadHash = await sha256Hex(bytes);
    const result = await getDb().insert(integrationWebhookEvents).values({
      id: crypto.randomUUID(),
      organizationId: connection.organizationId,
      provider: STRIPE_PROVIDER,
      payloadHash,
      signatureHash: signature.signatureHash,
      eventType: eventType.slice(0, 160),
      externalObjectRef,
      status: "queued",
      receivedAt: new Date(),
      processedAt: null,
    }).onConflictDoNothing({
      target: [
        integrationWebhookEvents.organizationId,
        integrationWebhookEvents.provider,
        integrationWebhookEvents.payloadHash,
      ],
    }).returning({ id: integrationWebhookEvents.id });
    return jsonResponse({ received: true, duplicate: result.length === 0, queued: result.length > 0 }, { status: 200 });
  });
}
