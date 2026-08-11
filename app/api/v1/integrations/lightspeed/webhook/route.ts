import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import {
  integrationConnections,
  integrationWebhookEvents,
} from "../../../../../../db/schema";
import { ApiError, handleApi } from "../../../../../../server/api";
import {
  LIGHTSPEED_PROVIDER,
  sha256Hex,
  validateDomainPrefix,
  verifyLightspeedWebhookSignature,
} from "../../../../../../server/integrations/lightspeed";

const MAXIMUM_WEBHOOK_BYTES = 256_000;

export async function POST(request: Request) {
  return handleApi(request, async () => {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("application/x-www-form-urlencoded")) {
      throw new ApiError(415, "LIGHTSPEED_WEBHOOK_CONTENT_TYPE", "Lightspeed webhook encoding is invalid.");
    }
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > MAXIMUM_WEBHOOK_BYTES) {
      throw new ApiError(413, "LIGHTSPEED_WEBHOOK_TOO_LARGE", "The Lightspeed webhook is too large.");
    }
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > MAXIMUM_WEBHOOK_BYTES) {
      throw new ApiError(413, "LIGHTSPEED_WEBHOOK_TOO_LARGE", "The Lightspeed webhook is too large.");
    }
    const signature = await verifyLightspeedWebhookSignature(bytes, request.headers.get("x-signature"));
    if (!signature.valid) {
      throw new ApiError(401, "LIGHTSPEED_WEBHOOK_SIGNATURE_INVALID", "The Lightspeed webhook signature is invalid.");
    }
    const form = new URLSearchParams(new TextDecoder().decode(bytes));
    const domainPrefix = validateDomainPrefix(form.get("domain_prefix") ?? "");
    const payloadText = form.get("payload") ?? "";
    if (!payloadText || payloadText.length > 240_000) {
      throw new ApiError(400, "LIGHTSPEED_WEBHOOK_PAYLOAD_INVALID", "The Lightspeed webhook payload is missing.");
    }
    let payload: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(payloadText);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
      payload = parsed as Record<string, unknown>;
    } catch {
      throw new ApiError(400, "LIGHTSPEED_WEBHOOK_PAYLOAD_INVALID", "The Lightspeed webhook payload is invalid.");
    }
    const [connection] = await getDb().select({
      id: integrationConnections.id,
      organizationId: integrationConnections.organizationId,
    }).from(integrationConnections).where(and(
      eq(integrationConnections.provider, LIGHTSPEED_PROVIDER),
      eq(integrationConnections.domainPrefix, domainPrefix),
      eq(integrationConnections.status, "connected"),
    )).limit(1);
    if (!connection) throw new ApiError(404, "LIGHTSPEED_CONNECTION_NOT_FOUND", "No verified Lightspeed connection matches this webhook.");
    const payloadHash = await sha256Hex(bytes);
    const eventType = typeof payload.type === "string"
      ? payload.type.slice(0, 80)
      : typeof payload.event === "string"
        ? payload.event.slice(0, 80)
        : "provider.change";
    const externalObjectRef = typeof payload.id === "string" ? payload.id.slice(0, 160) : null;
    const receivedAt = new Date();
    await getDb().insert(integrationWebhookEvents).values({
      id: crypto.randomUUID(),
      organizationId: connection.organizationId,
      provider: LIGHTSPEED_PROVIDER,
      connectionId: connection.id,
      payloadHash,
      signatureHash: signature.signatureHash,
      eventType,
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
    });
    // The signed notification is only a recovery signal. Polling remains the
    // source of truth, as required by Lightspeed's delivery guidance.
    return new Response(null, { status: 204 });
  });
}
