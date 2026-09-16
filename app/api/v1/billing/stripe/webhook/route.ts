import { and, eq, inArray, lt, or } from "drizzle-orm";
import { getD1, getDb } from "../../../../../../db";
import { stripeBillingEvents, tenantSubscriptions } from "../../../../../../db/schema";
import { ApiError, handleApi, jsonResponse, readRequestBytes } from "../../../../../../server/api";
import {
  normalizeStripeSubscription,
  retrieveStripeSubscription,
  sha256Hex,
  verifyStripeBillingSignature,
} from "../../../../../../server/billing/stripe";

import { persistStripeSubscription } from "../../../../../../server/billing/synchronize";

const MAXIMUM_BYTES = 256_000;

export async function POST(request: Request) {
  return handleApi(request, async () => {
    if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) throw new ApiError(415, "STRIPE_BILLING_CONTENT_TYPE", "Stripe Billing webhook content type is invalid.");
    const bytes = await readRequestBytes(request, MAXIMUM_BYTES, "STRIPE_BILLING_WEBHOOK_TOO_LARGE", "The Stripe Billing webhook is too large.");
    if (bytes.length > MAXIMUM_BYTES) throw new ApiError(413, "STRIPE_BILLING_WEBHOOK_TOO_LARGE", "The Stripe Billing webhook is too large.");
    if (!(await verifyStripeBillingSignature(bytes, request.headers.get("stripe-signature")))) throw new ApiError(401, "STRIPE_BILLING_SIGNATURE_INVALID", "The Stripe Billing webhook signature is invalid or expired.");
    let event: Record<string, unknown>;
    try {
      const parsed = JSON.parse(new TextDecoder().decode(bytes));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
      event = parsed as Record<string, unknown>;
    } catch { throw new ApiError(400, "STRIPE_BILLING_PAYLOAD_INVALID", "The Stripe Billing webhook payload is invalid."); }
    const eventId = typeof event.id === "string" ? event.id : "";
    const eventType = typeof event.type === "string" ? event.type : "";
    const eventCreated = typeof event.created === "number" ? event.created : 0;
    if (!/^evt_[A-Za-z0-9]{8,128}$/.test(eventId) || !eventType || eventType.length > 120 || !Number.isSafeInteger(eventCreated) || eventCreated <= 0) throw new ApiError(400, "STRIPE_BILLING_PAYLOAD_INVALID", "The Stripe Billing event envelope is invalid.");
    const now = new Date();
    await getDb().insert(stripeBillingEvents).values({
      eventId, organizationId: null, eventType, stripeCreatedAt: new Date(eventCreated * 1000), payloadHash: await sha256Hex(bytes), status: "received", errorCode: null, receivedAt: now, processedAt: null,
    }).onConflictDoNothing();
    const claimed = await getDb().update(stripeBillingEvents).set({ status: "processing", errorCode: null, receivedAt: now })
      .where(and(eq(stripeBillingEvents.eventId, eventId), or(inArray(stripeBillingEvents.status, ["received", "failed"]), and(eq(stripeBillingEvents.status, "processing"), lt(stripeBillingEvents.receivedAt, new Date(now.getTime() - 120_000))))))
      .returning({ eventId: stripeBillingEvents.eventId });
    if (!claimed.length) {
      const [existing] = await getDb().select().from(stripeBillingEvents).where(eq(stripeBillingEvents.eventId, eventId)).limit(1);
      if (existing?.status === "processing") throw new ApiError(409, "STRIPE_BILLING_PROCESSING", "This billing event is still processing. Retry shortly.");
      return jsonResponse({ received: true, duplicate: true });
    }
    try {
      const data = event.data && typeof event.data === "object" && !Array.isArray(event.data) ? event.data as Record<string, unknown> : {};
      const object = data.object && typeof data.object === "object" && !Array.isArray(data.object) ? data.object as Record<string, unknown> : {};
      const subscriptionId = eventType.startsWith("customer.subscription.")
        ? (typeof object.id === "string" ? object.id : "")
        : eventType === "checkout.session.completed" && typeof object.subscription === "string" ? object.subscription : "";
      if (!subscriptionId) {
        await getDb().update(stripeBillingEvents).set({ status: "ignored", processedAt: new Date() }).where(eq(stripeBillingEvents.eventId, eventId));
        return jsonResponse({ received: true, ignored: true });
      }
      const metadata = object.metadata && typeof object.metadata === "object" ? object.metadata as Record<string, unknown> : {};
      const hintedOrganization = typeof metadata.vanteloq_organization_id === "string" ? metadata.vanteloq_organization_id : null;
      // Checkout and subscription events often arrive together. Retry one version
      // conflict, reading both the version and Stripe again so no old snapshot wins.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const [current] = await getDb().select().from(tenantSubscriptions).where(hintedOrganization
          ? eq(tenantSubscriptions.organizationId, hintedOrganization)
          : eq(tenantSubscriptions.stripeSubscriptionId, subscriptionId)).limit(1);
        const normalized = normalizeStripeSubscription(await retrieveStripeSubscription(subscriptionId));
        if (normalized.subscriptionId !== subscriptionId || (hintedOrganization && hintedOrganization !== normalized.organizationId)
          || (current && current.organizationId !== normalized.organizationId)) {
          throw new ApiError(400, "STRIPE_SUBSCRIPTION_IDENTITY_MISMATCH", "Stripe subscription ownership could not be confirmed.");
        }
        try {
          const result = await persistStripeSubscription(getD1(), {
            subscription: normalized, eventId, eventCreated, expectedVersion: current?.version ?? 0,
          });
          if (result === "stale") {
            await getDb().update(stripeBillingEvents).set({ organizationId: normalized.organizationId, status: "ignored", processedAt: new Date() }).where(eq(stripeBillingEvents.eventId, eventId));
            return jsonResponse({ received: true, stale: true });
          }
          return jsonResponse({ received: true, synchronized: true });
        } catch (conflict) {
          if (attempt === 0 && conflict instanceof ApiError && conflict.code === "STRIPE_BILLING_SYNC_CONFLICT") continue;
          throw conflict;
        }
      }
      throw new ApiError(409, "STRIPE_BILLING_SYNC_CONFLICT", "Subscription access changed during synchronization. Stripe should retry this event.");
    } catch (error) {
      const code = error instanceof ApiError ? error.code : "STRIPE_BILLING_SYNC_FAILED";
      await getDb().update(stripeBillingEvents).set({ status: "failed", errorCode: code, processedAt: new Date() }).where(eq(stripeBillingEvents.eventId, eventId));
      throw error;
    }
  });
}
