import { and, eq, or } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { bankAccounts, integrationConnections, integrationWebhookEvents } from "../../../../../../db/schema";
import { ApiError, handleApi, jsonResponse } from "../../../../../../server/api";
import { PLAID_PROVIDER, plaidRequiresUserRepair, syncPlaidTransactions, verifyPlaidWebhook } from "../../../../../../server/integrations/plaid";

const MAXIMUM_WEBHOOK_BYTES = 256_000;

async function sha256(value: string | Uint8Array) {
  const input = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const buffer = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buffer));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function POST(request: Request) {
  return handleApi(request, async () => {
    if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      throw new ApiError(415, "PLAID_WEBHOOK_CONTENT_TYPE", "Plaid webhook content type is invalid.");
    }
    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAXIMUM_WEBHOOK_BYTES) {
      throw new ApiError(413, "PLAID_WEBHOOK_TOO_LARGE", "The Plaid webhook is too large.");
    }
    const signature = request.headers.get("Plaid-Verification")?.trim() ?? "";
    if (!signature) throw new ApiError(401, "PLAID_WEBHOOK_SIGNATURE_REQUIRED", "Plaid webhook verification is required.");
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > MAXIMUM_WEBHOOK_BYTES) throw new ApiError(413, "PLAID_WEBHOOK_TOO_LARGE", "The Plaid webhook is too large.");
    const rawBody = new TextDecoder().decode(bytes);
    await verifyPlaidWebhook(rawBody, signature);
    let body: { item_id?: unknown; webhook_type?: unknown; webhook_code?: unknown; error?: unknown };
    try { body = JSON.parse(rawBody); } catch { throw new ApiError(400, "INVALID_JSON", "The webhook body is invalid."); }
    if (typeof body.item_id !== "string" || typeof body.webhook_type !== "string" || typeof body.webhook_code !== "string") {
      throw new ApiError(400, "PLAID_WEBHOOK_INVALID", "The webhook body is invalid.");
    }
    const [connection] = await getDb().select({ organizationId: integrationConnections.organizationId })
      .from(integrationConnections).where(and(
        eq(integrationConnections.provider, PLAID_PROVIDER),
        eq(integrationConnections.externalAccountRef, body.item_id),
        or(eq(integrationConnections.status, "connected"), eq(integrationConnections.status, "error")),
      )).limit(1);
    if (!connection) return jsonResponse({ accepted: true });
    const payloadHash = await sha256(bytes);
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
    const providerError = body.error && typeof body.error === "object" && !Array.isArray(body.error)
      ? (body.error as { error_code?: unknown }).error_code
      : null;
    const issueCode = typeof providerError === "string" && providerError.length <= 100
      ? providerError
      : body.webhook_code;
    if (body.webhook_type === "ITEM" && plaidRequiresUserRepair(issueCode)) {
      const now = new Date();
      await getDb().update(integrationConnections).set({ status: "error", lastErrorCode: issueCode, updatedAt: now }).where(and(
        eq(integrationConnections.organizationId, connection.organizationId),
        eq(integrationConnections.provider, PLAID_PROVIDER),
      ));
      await getDb().update(bankAccounts).set({ connectionStatus: "error", updatedAt: now }).where(and(
        eq(bankAccounts.organizationId, connection.organizationId),
        eq(bankAccounts.provider, PLAID_PROVIDER),
      ));
      await getDb().update(integrationWebhookEvents).set({ status: "processed", processedAt: now }).where(eq(integrationWebhookEvents.id, eventId));
      return jsonResponse({ accepted: true, repairRequired: true });
    }
    if (body.webhook_type === "ITEM" && body.webhook_code === "LOGIN_REPAIRED") {
      const now = new Date();
      await getDb().update(integrationConnections).set({ status: "connected", lastErrorCode: null, updatedAt: now }).where(and(
        eq(integrationConnections.organizationId, connection.organizationId),
        eq(integrationConnections.provider, PLAID_PROVIDER),
      ));
      await getDb().update(bankAccounts).set({ connectionStatus: "healthy", updatedAt: now }).where(and(
        eq(bankAccounts.organizationId, connection.organizationId),
        eq(bankAccounts.provider, PLAID_PROVIDER),
      ));
      await getDb().update(integrationWebhookEvents).set({ status: "processed", processedAt: now }).where(eq(integrationWebhookEvents.id, eventId));
      return jsonResponse({ accepted: true, repaired: true });
    }
    if (body.webhook_type === "TRANSACTIONS" && body.webhook_code === "SYNC_UPDATES_AVAILABLE") {
      try {
        await syncPlaidTransactions(connection.organizationId);
        await getDb().update(integrationWebhookEvents).set({ status: "processed", processedAt: new Date() }).where(eq(integrationWebhookEvents.id, eventId));
      } catch {
        return jsonResponse({ accepted: true, queued: true });
      }
    }
    await getDb().update(integrationWebhookEvents).set({ status: "processed", processedAt: new Date() }).where(eq(integrationWebhookEvents.id, eventId));
    return jsonResponse({ accepted: true });
  });
}
